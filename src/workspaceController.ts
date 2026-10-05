import * as vscode from "vscode";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { GitError, GitService, GraphOptions, RebaseStep } from "./gitService";
import { openDiff } from "./revisionProvider";

const lockedRepositories = new Set<string>();
export async function executeGitMutation(git: GitService, action: () => Promise<void>): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new GitError("请先信任此工作区，再执行 Git 操作");
  if (lockedRepositories.has(git.cwd)) throw new GitError("当前仓库正在执行 Git 操作，请稍后再试");
  lockedRepositories.add(git.cwd);
  try { await action(); } finally { lockedRepositories.delete(git.cwd); }
}
type Message = Record<string, unknown> & { type: string; request?: number };
function text(message: Message, key: string, fallback = ""): string {
  const value = message[key]; if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 100_000) throw new GitError("无效的请求参数");
  return value;
}
export class WorkspaceController implements vscode.Disposable {
  private webview?: vscode.Webview;
  private listener?: vscode.Disposable;
  private options: GraphOptions = {};
  private limit = 100;
  private generation = 0;
  private refreshId = 0;
  public constructor(private readonly extensionUri: vscode.Uri, private git: GitService | undefined, private readonly changed: () => Promise<void>) {}
  public dispose(): void { this.listener?.dispose(); this.webview = undefined; this.generation++; }
  public setGit(git: GitService | undefined): void {
    if (this.git?.cwd !== git?.cwd) { this.options = {}; this.limit = 100; this.post({ type: "reset" }); }
    this.git = git; this.generation++; void this.refresh();
  }
  public attach(webview: vscode.Webview): void {
    this.listener?.dispose(); this.webview = webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")] };
    this.listener = webview.onDidReceiveMessage((message: unknown) => {
      if (message && typeof message === "object" && typeof (message as Message).type === "string") void this.handle(message as Message);
    });
    webview.html = this.html(webview);
  }
  public async revealCommit(hash: string): Promise<void> {
    this.post({ type: "revealCommit", hash });
  }
  public revealTimeline(file: string): void { this.post({ type: "timeline", file }); }
  public async refresh(): Promise<void> {
    if (!this.webview) return;
    const git = this.git, generation = this.generation, request = ++this.refreshId;
    if (!git) { this.post({ type: "data", data: null }); return; }
    this.post({ type: "loading", value: true });
    try {
      const [status, branches, commits, tags, stashes, worktrees, operation] = await Promise.all([
        git.status(), git.branches(true), git.graph(this.limit + 1, this.options), git.tags(), git.stashes(), git.worktrees(), git.operationState()
      ]);
      if (generation !== this.generation || request !== this.refreshId) return;
      this.post({ type: "data", data: { root: git.cwd, name: path.basename(git.cwd), status, branches, commits: commits.slice(0, this.limit), tags, stashes, worktrees, operation,
        hasMore: commits.length > this.limit && this.limit < 2000, options: this.options, limit: this.limit } });
    } catch (error) {
      if (generation === this.generation && request === this.refreshId) this.post({ type: "error", message: formatError(error) });
    } finally {
      if (generation === this.generation && request === this.refreshId) this.post({ type: "loading", value: false });
    }
  }
  private post(message: unknown): void { void this.webview?.postMessage(message); }
  private async confirm(message: string, detail: string): Promise<boolean> {
    return await vscode.window.showWarningMessage(message, { modal: true, detail }, "执行") === "执行";
  }
  private async handle(message: Message): Promise<void> {
    const git = this.git, generation = this.generation;
    try {
      if (message.type === "ready" || message.type === "refresh") { await this.refresh(); return; }
      if (message.type === "chooseRepository") { await vscode.commands.executeCommand("gitrism.chooseRepository"); return; }
      if (message.type === "openGraph") { await vscode.commands.executeCommand("gitrism.openGraph"); return; }
      if (message.type === "activeHistory") { await vscode.commands.executeCommand("gitrism.showHistory"); return; }
      if (message.type === "search") {
        const searchBy = text(message, "searchBy", "message");
        if (!["message", "author", "hash"].includes(searchBy)) throw new GitError("未知搜索类型");
        this.options = { query: text(message, "query"), searchBy: searchBy as GraphOptions["searchBy"], ref: text(message, "ref") || undefined, file: text(message, "file") || undefined };
        this.limit = 100; await this.refresh(); return;
      }
      if (message.type === "more") { this.limit = Math.min(2000, this.limit + 100); await this.refresh(); return; }
      if (!git) return;
      if (message.type === "rebasePlan") {
        const plan = await git.rebasePlan(text(message, "ref"));
        if (generation === this.generation) this.post({ type: "rebasePlan", request: message.request, plan });
        return;
      }
      if (message.type === "timelineHistory") {
        const file = text(message, "file");
        const commits = await git.graph(500, { file, ref: "HEAD" });
        if (generation === this.generation) this.post({ type: "timelineHistory", file, commits, request: message.request });
        return;
      }
      if (message.type === "details") {
        const detail = await git.detail(text(message, "hash"));
        if (generation === this.generation) this.post({ type: "details", request: message.request, detail });
        return;
      }
      if (message.type === "compare") {
        const comparison = await git.compare(text(message, "from"), text(message, "to"));
        if (generation === this.generation) this.post({ type: "comparison", request: message.request, comparison });
        return;
      }
      if (message.type === "diff") {
        await openDiff(git, text(message, "from"), text(message, "to"), text(message, "file"), text(message, "oldFile") || undefined); return;
      }
      if (message.type === "workingDiff") {
        const file = text(message, "file"), staged = message.staged === true;
        const item = (await git.status()).files.find(f => f.path === file);
        if (!item) throw new GitError("该文件已无更改，请刷新");
        if (item.conflict) { await vscode.window.showTextDocument(vscode.Uri.file(git.filePath(file))); return; }
        if (staged) await openDiff(git, item.index === "A" || !(await git.hasHead()) ? "EMPTY" : await git.resolveCommit("HEAD"), item.index === "D" ? "EMPTY" : "INDEX", file, item.oldPath);
        else await openDiff(git, item.index === "?" ? "EMPTY" : "INDEX", item.working === "D" ? "EMPTY" : "WORKING", file);
        return;
      }
      if (message.type === "copy") { await vscode.env.clipboard.writeText(text(message, "value")); return; }
      if (message.type === "openWorktree") {
        const directory = text(message, "path");
        if (!(await git.worktrees()).some(w => w.path === directory)) throw new GitError("未知 worktree");
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(directory), { forceNewWindow: true }); return;
      }
      const mutations = ["fetch", "pull", "push", "sync", "stageAll", "unstageAll", "stage", "unstage", "commit", "checkout", "createBranch", "deleteBranch", "createTag", "deleteTag", "stashPush", "stashAction", "createWorktree", "removeWorktree", "operation", "finishOperation", "applyRebase"];
      if (!mutations.includes(message.type)) return;
      if (!vscode.workspace.isTrusted) throw new GitError("请先信任此工作区，再执行 Git 操作");
      if (lockedRepositories.has(git.cwd)) throw new GitError("当前仓库正在执行 Git 操作，请稍后再试");
      lockedRepositories.add(git.cwd); this.post({ type: "busy", value: true });
      try {
        let completed = true;
        let successMessage = "操作完成";
        switch (message.type) {
          case "fetch": await git.fetch(); break;
          case "pull": await git.pull(); break;
          case "push": await git.push(); break;
          case "sync": await git.sync(); break;
          case "stageAll": await git.stageAll(); break;
          case "unstageAll": await git.unstageAll(); break;
          case "stage": await git.stage(text(message, "file")); break;
          case "unstage": await git.unstage(text(message, "file")); break;
          case "commit": await git.commit(text(message, "message")); this.post({ type: "committed" }); break;
          case "checkout": await git.checkout(text(message, "branch")); break;
          case "createBranch": {
            const name = await vscode.window.showInputBox({ prompt: "新分支名称（创建后切换）", ignoreFocusOut: true });
            if (name) await git.createBranch(name, text(message, "ref", "HEAD")); else completed = false; break;
          }
          case "deleteBranch": {
            const name = text(message, "branch");
            if (await this.confirm(`删除本地分支 ${name}？`, "只删除已合并分支；Git 会保留未合并分支。")) await git.deleteBranch(name); else completed = false; break;
          }
          case "createTag": {
            const name = await vscode.window.showInputBox({ prompt: "新标签名称（仅创建本地标签）", ignoreFocusOut: true });
            if (name) await git.createTag(name, text(message, "ref", "HEAD")); else completed = false; break;
          }
          case "deleteTag": {
            const name = text(message, "tag");
            if (await this.confirm(`删除本地标签 ${name}？`, "远程标签不会被删除。")) await git.deleteTag(name); else completed = false; break;
          }
          case "stashPush": {
            const name = await vscode.window.showInputBox({ prompt: "保存工作区到 stash（包含未跟踪文件，不含忽略文件）", value: "Gitrism stash", ignoreFocusOut: true });
            if (name !== undefined) await git.stashPush(name); else completed = false; break;
          }
          case "stashAction": {
            const action = text(message, "action");
            if (!["apply", "pop", "drop"].includes(action)) throw new GitError("未知 stash 操作");
            if (action === "drop" && !(await this.confirm("删除这条 stash？", "保存的更改将从 stash 列表移除。"))) { completed = false; break; }
            await git.stashAction(action as "apply" | "pop" | "drop", text(message, "hash")); break;
          }
          case "createWorktree": {
            const branch = await vscode.window.showQuickPick((await git.branches(true)).map(b => b.name), { placeHolder: "选择尚未被其他 worktree 占用的分支" });
            if (!branch) { completed = false; break; }
            const directory = await vscode.window.showInputBox({ prompt: "新 worktree 的绝对路径（目录需为空或不存在）", value: path.join(path.dirname(git.cwd), path.basename(git.cwd) + "-worktree"), ignoreFocusOut: true });
            if (directory) await git.createWorktree(directory, branch); else completed = false; break;
          }
          case "removeWorktree": {
            const directory = text(message, "path");
            if (await this.confirm("移除 worktree？", `${directory}\nGit 会拒绝移除有未提交更改或已锁定的工作树。`)) await git.removeWorktree(directory); else completed = false; break;
          }
          case "operation": {
            const action = text(message, "action"), ref = text(message, "ref");
            if (!["cherry-pick", "revert", "merge", "rebase"].includes(action)) throw new GitError("未知 Git 操作");
            if (await this.confirm(`对当前分支执行 ${action}？`, `目标：${ref}\n${action === "rebase" ? "变基会重写当前分支历史，请确认该分支适合变基。" : "操作可能产生冲突，可在工作区中继续或中止。"}`)) await git.operation(action as "cherry-pick" | "revert" | "merge" | "rebase", ref); else completed = false; break;
          }
          case "finishOperation": {
            const action = text(message, "action");
            if (action !== "continue" && action !== "abort") throw new GitError("未知操作");
            if (action === "abort" && !(await this.confirm("中止当前 Git 操作？", "Git 会尝试恢复到操作开始前的状态。"))) { completed = false; break; }
            await git.finishOperation(action); break;
          }
          case "applyRebase": {
            if (!Array.isArray(message.steps) || message.steps.length > 100) throw new GitError("无效的变基计划");
            const base = text(message, "base"), head = text(message, "head");
            const steps = message.steps as RebaseStep[];
            if (await this.confirm("按此计划重写当前分支历史？", `基点：${base.slice(0,8)}\n范围：${steps.length} 条提交\n将先创建 gitrism-backup 备份分支。squash 默认保留组合消息，fixup 保留前一条消息。请确认该历史适合重写。`)) {
              const backup = await git.applyRebase(base, head, steps, text(message, "branch"));
              successMessage = "变基完成；备份分支：" + backup;
              this.post({ type: "rebased", backup });
            } else completed = false;
            break;
          }
        }
        if (completed) this.post({ type: "notice", message: successMessage });
      } finally {
        lockedRepositories.delete(git.cwd); this.post({ type: "busy", value: false });
        await this.changed();
      }
    } catch (error) { if (generation === this.generation) this.post({ type: "error", request: message.request, message: formatError(error) }); }
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("hex");
    const resource = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", name));
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource("workspace.css")}"><link rel="stylesheet" href="${resource("timeline.css")}"></head><body><main id="app" aria-busy="true"><div class="empty">正在读取本地仓库…</div></main><div id="toast" role="status" hidden></div><script nonce="${nonce}" src="${resource("graphLayout.js")}"></script><script nonce="${nonce}" src="${resource("workspace.js")}"></script></body></html>`;
  }
}
function formatError(error: unknown): string { return error instanceof GitError ? error.detail || error.message : String(error); }
