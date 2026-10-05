import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
const execFileAsync = promisify(execFile);
export interface RepositoryStatus { branch: string; upstream?: string; ahead: number; behind: number; staged: number; changed: number; untracked: number; conflicted: number; files: WorkingFile[] }
export interface WorkingFile { path: string; oldPath?: string; index: string; working: string; conflict: boolean }
export interface CommitSummary { hash: string; author: string; date: string; subject: string }
export interface GraphCommit extends CommitSummary { parents: string[]; refs: string }
export interface GraphOptions { query?: string; searchBy?: "message" | "author" | "hash"; ref?: string; file?: string; skip?: number }
export interface BranchSummary { name: string; current: boolean; remote?: string; isRemote?: boolean; hash?: string }
export interface BlameLine { hash: string; author: string; date: string; summary: string }
export interface ChangedFile { path: string; oldPath?: string; status: string; from?: string; to?: string }
export interface CommitDetail { hash: string; parents: string[]; author: string; email: string; date: string; message: string; files: ChangedFile[]; stats: string }
export interface TagSummary { name: string; hash: string; date: string; subject: string }
export interface StashSummary { ref: string; hash: string; subject: string; date: string }
export interface WorktreeSummary { path: string; hash: string; branch: string; locked?: string; prunable?: string; bare: boolean }
export interface Comparison { from: string; to: string; ahead: number; behind: number; files: ChangedFile[]; stats: string; commits: GraphCommit[] }
export type RebaseAction = "pick" | "squash" | "fixup" | "drop";
export interface RebaseStep { hash: string; action: RebaseAction }
export interface RebasePlan { base: string; head: string; branch: string; commits: GraphCommit[] }
export class GitError extends Error {
  public constructor(message: string, public readonly detail?: string) { super(message); this.name = "GitError"; }
}
function buildSshCommand(proxy: string): string {
  const value = proxy.trim().replace(/^socks5h?:\/\//, "");
  if (!/^[a-zA-Z0-9_.-]+:\d{1,5}$/.test(value)) throw new GitError("SSH 代理格式应为 host:port");
  return "ssh -o 'ProxyCommand=nc -X 5 -x " + value + " %h %p'";
}
function parseCommits(output: string): GraphCommit[] {
  return output.split("\x1e").map(r => r.replace(/^\r?\n/, "")).filter(r => r.trim()).map(record => {
    const [hash, parents, author, date, refs, ...subject] = record.split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], author, date, refs, subject: subject.join("\x1f") };
  });
}
function parseFiles(output: string): ChangedFile[] {
  const tokens = output.split("\0"), files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i++], first = tokens[i++];
    if (/^[RC]/.test(status)) files.push({ status: status[0], oldPath: first, path: tokens[i++] });
    else files.push({ status: status[0], path: first });
  }
  return files;
}
const logFormat = "%H%x1f%P%x1f%an%x1f%ad%x1f%D%x1f%s%x1e";
function unquoteGitValue(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const bytes: number[] = [];
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== "\\") {
      const codePoint = value.codePointAt(i)!;
      bytes.push(...Buffer.from(String.fromCodePoint(codePoint)));
      if (codePoint > 0xffff) i++;
    } else {
      const octal = value.slice(i + 1).match(/^[0-7]{1,3}/)?.[0];
      if (octal) { bytes.push(parseInt(octal, 8)); i += octal.length; }
      else {
        const escaped = value[++i];
        if (escapes[escaped] === undefined) throw new GitError("无法解析 Git 的引号转义信息");
        bytes.push(escapes[escaped]);
      }
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
export class GitService {
  private worktreeNullOutput = true;
  public constructor(public readonly cwd: string, private readonly sshProxy?: string) {}
  private async run(args: string[], literalPaths = false, extraEnv: Record<string, string> = {}): Promise<string> {
    try {
      return (await execFileAsync("git", ["--no-pager", ...(literalPaths ? ["--literal-pathspecs"] : []), ...args], {
        cwd: this.cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 60_000, killSignal: "SIGTERM",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_ASKPASS: "", SSH_ASKPASS: "",
          ...extraEnv,
          ...(this.sshProxy ? { GIT_SSH_COMMAND: buildSshCommand(this.sshProxy) } : {}) }
      })).stdout;
    } catch (error) {
      if (error instanceof GitError) throw error;
      const e = error as { code?: string | number; killed?: boolean; stderr?: string; message?: string };
      throw new GitError("Git 操作失败", e.code === "ETIMEDOUT" || e.killed
        ? "Git 操作超过 60 秒。请检查远程地址、SSH 密钥、代理和网络。" : e.stderr || e.message);
    }
  }
  public filePath(file: string): string {
    if (!file || path.isAbsolute(file) || file.includes("\0") || /(^|\/)\.\.($|\/)/.test(file)) throw new GitError("无效的仓库文件路径");
    const absolute = path.resolve(this.cwd, file);
    if (!absolute.startsWith(path.resolve(this.cwd) + path.sep)) throw new GitError("文件不在当前仓库中");
    return absolute;
  }
  private ref(ref: string): string {
    if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref)) throw new GitError("无效的 Git 引用");
    return ref;
  }
  public async resolveCommit(ref: string): Promise<string> {
    // ref() rejects option-like input, including on Git versions without --end-of-options.
    return (await this.run(["rev-parse", "--verify", this.ref(ref) + "^{commit}"])).trim();
  }
  public async hasHead(): Promise<boolean> { try { await this.resolveCommit("HEAD"); return true; } catch { return false; } }
  public async repositoryRoot(): Promise<string> { return (await this.run(["rev-parse", "--show-toplevel"])).trim(); }
  public async status(): Promise<RepositoryStatus> {
    const tokens = (await this.run(["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"])).split("\0");
    const header = tokens.shift() ?? "## HEAD";
    const match = header.match(/^## (.*?)(?:\.\.\.([^ ]+))?(?: \[.*\])?$/);
    const branch = (match?.[1] ?? "HEAD").replace(/^(?:No commits yet on |Initial commit on )/, "");
    const files: WorkingFile[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const line = tokens[i]; if (!line) continue;
      const index = line[0], working = line[1];
      const file: WorkingFile = { path: line.slice(3), index, working, conflict: /^(DD|AU|UD|UA|DU|AA|UU)$/.test(line.slice(0, 2)) };
      if (/[RC]/.test(index + working)) file.oldPath = tokens[++i];
      files.push(file);
    }
    return { branch, upstream: match?.[2], ahead: Number(header.match(/ahead (\d+)/)?.[1] ?? 0), behind: Number(header.match(/behind (\d+)/)?.[1] ?? 0),
      staged: files.filter(f => !f.conflict && f.index !== " " && f.index !== "?").length,
      changed: files.filter(f => !f.conflict && f.working !== " " && f.working !== "?").length,
      untracked: files.filter(f => f.index === "?").length, conflicted: files.filter(f => f.conflict).length, files };
  }
  public async branches(includeRemote = false): Promise<BranchSummary[]> {
    const output = await this.run(["for-each-ref", "--sort=-committerdate", "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname)%00%(refname)%00%(symref)", "refs/heads", ...(includeRemote ? ["refs/remotes"] : [])]);
    return output.split(/\r?\n/).filter(Boolean).map(line => {
      const [head, name, remote, hash, full, symref] = line.split("\0");
      return { name, current: head === "*", remote: remote || undefined, hash, isRemote: full.startsWith("refs/remotes/"), symref };
    }).filter(b => !b.symref);
  }
  public async fetch(): Promise<void> { await this.run(["fetch", "--all", "--prune"]); }
  public async pull(): Promise<void> { await this.run(["pull", "--ff-only"]); }
  public async push(): Promise<void> { await this.run(["push"]); }
  public async sync(): Promise<void> { await this.pull(); await this.push(); }
  public async stageAll(): Promise<void> { await this.run(["add", "-A"]); }
  public async unstageAll(): Promise<void> {
    if (await this.hasHead()) await this.run(["restore", "--staged", "--", "."]);
    else for (const file of (await this.status()).files.filter(f => f.index !== "?" && f.index !== " ")) await this.unstage(file.path);
  }
  public async stage(file: string): Promise<void> {
    this.filePath(file); const item = (await this.status()).files.find(f => f.path === file);
    await this.run(["add", "-A", "--", file, ...(item?.oldPath ? [item.oldPath] : [])], true);
  }
  public async unstage(file: string): Promise<void> {
    this.filePath(file); const item = (await this.status()).files.find(f => f.path === file);
    const paths = [file, ...(item?.oldPath ? [item.oldPath] : [])];
    if (await this.hasHead()) await this.run(["restore", "--staged", "--", ...paths], true);
    else await this.run(["rm", "--cached", "--force", "--", ...paths], true);
  }
  public async commit(message: string): Promise<void> {
    if (!message.trim()) throw new GitError("请填写提交消息");
    await this.run(["commit", "-m", message.trim()]);
  }
  public async checkout(branch: string): Promise<void> { await this.run(["switch", this.ref(branch)]); }
  public async createBranch(name: string, start = "HEAD"): Promise<void> {
    await this.run(["check-ref-format", "--branch", this.ref(name)]);
    await this.run(["switch", "-c", name, await this.resolveCommit(start)]);
  }
  public async deleteBranch(name: string): Promise<void> { await this.run(["branch", "-d", this.ref(name)]); }
  public async log(limit = 30, file?: string): Promise<CommitSummary[]> { return this.graph(limit, { ref: "HEAD", file }); }
  public async graph(limit = 100, options: GraphOptions | string = {}): Promise<GraphCommit[]> {
    const opts = typeof options === "string" ? { query: options } : options;
    if (!(await this.hasHead()) && !(await this.branches(true)).length) return [];
    const args = ["log", "--topo-order", "-n" + Math.max(1, Math.min(limit, 5000)), "--skip=" + Math.max(0, opts.skip ?? 0), "--date=iso-strict", "--pretty=format:" + logFormat];
    if (opts.query?.trim()) {
      if (opts.searchBy === "hash") args.push(await this.resolveCommit(opts.query.trim()), "--no-walk");
      else {
        args.push("--regexp-ignore-case", "--fixed-strings", (opts.searchBy === "author" ? "--author=" : "--grep=") + opts.query.trim());
        args.push(opts.ref ? await this.resolveCommit(opts.ref) : "--all");
      }
    } else args.push(opts.ref ? await this.resolveCommit(opts.ref) : "--all");
    if (opts.file) { this.filePath(opts.file); args.push("--follow", "--", opts.file); }
    return parseCommits(await this.run(args, Boolean(opts.file)));
  }
  public async commitDetails(ref: string): Promise<string> { return this.run(["show", "--stat", "--decorate=short", "--format=fuller", await this.resolveCommit(ref), "--"]); }
  public async detail(ref: string): Promise<CommitDetail> {
    const hash = await this.resolveCommit(ref);
    const metadata = await this.run(["show", "-s", "--date=iso-strict", "--format=%H%x00%P%x00%an%x00%ae%x00%ad%x00%B", hash, "--"]);
    const [id, parents, author, email, date, ...message] = metadata.split("\0"), parentList = parents ? parents.split(" ") : [];
    const diffArgs = parentList.length ? ["diff", "-M", parentList[0], hash] : ["diff-tree", "--root", "--no-commit-id", "-r", "-M", hash];
    const [files, stats] = await Promise.all([this.run([...diffArgs, "--name-status", "-z", "--"]), this.run([...diffArgs, "--stat", "--"])]);
    const changedFiles = parseFiles(files);
    let extraStats = "";
    if (parentList.length > 2 && (await this.stashes()).some(stash => stash.hash === hash)) {
      const untracked = parentList[2];
      const args = ["diff-tree", "--root", "--no-commit-id", "-r", untracked];
      const [names, summary] = await Promise.all([this.run([...args, "--name-status", "-z", "--"]), this.run([...args, "--stat", "--"])]);
      changedFiles.push(...parseFiles(names).map(file => ({ ...file, from: "EMPTY", to: untracked })));
      extraStats = "\n未跟踪文件：\n" + summary;
    }
    return { hash: id, parents: parentList, author, email, date, message: message.join("\0").trimEnd(), files: changedFiles, stats: stats + extraStats };
  }
  public async contentAt(ref: string, file: string): Promise<string> {
    this.filePath(file); if (ref === "EMPTY") return "";
    const revision = ref === "INDEX" ? "" : await this.resolveCommit(ref);
    return this.run(["show", revision + ":" + file]);
  }
  public async compare(from: string, to: string): Promise<Comparison> {
    const [left, right] = await Promise.all([this.resolveCommit(from), this.resolveCommit(to)]);
    const [counts, files, stats, commits] = await Promise.all([
      this.run(["rev-list", "--left-right", "--count", left + "..." + right, "--"]),
      this.run(["diff", "-M", "--name-status", "-z", left, right, "--"]), this.run(["diff", "--stat", left, right, "--"]),
      this.run(["log", "--topo-order", "-n200", "--date=iso-strict", "--pretty=format:" + logFormat, left + ".." + right, "--"])
    ]);
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
    return { from: left, to: right, behind, ahead, files: parseFiles(files), stats, commits: parseCommits(commits) };
  }
  public async tags(): Promise<TagSummary[]> {
    return (await this.run(["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%00%(objectname)%00%(creatordate:iso-strict)%00%(subject)", "refs/tags"]))
      .split(/\r?\n/).filter(Boolean).map(line => { const [name, hash, date, subject] = line.split("\0"); return { name, hash, date, subject }; });
  }
  public async createTag(name: string, ref: string): Promise<void> { await this.run(["tag", this.ref(name), await this.resolveCommit(ref)]); }
  public async deleteTag(name: string): Promise<void> { await this.run(["tag", "-d", this.ref(name)]); }
  public async stashes(): Promise<StashSummary[]> {
    return (await this.run(["stash", "list", "--format=%gd%x00%H%x00%gs%x00%aI"]))
      .split(/\r?\n/).filter(Boolean).map(line => { const [ref, hash, subject, date] = line.split("\0"); return { ref, hash, subject, date }; });
  }
  public async stashPush(message: string): Promise<void> { await this.run(["stash", "push", "--include-untracked", "-m", message || "Gitrism stash"]); }
  public async stashAction(action: "apply" | "pop" | "drop", hash: string): Promise<void> {
    const item = (await this.stashes()).find(s => s.hash === hash);
    if (!item) throw new GitError("该 stash 已不存在，请刷新");
    await this.run(["stash", action, item.ref]);
  }
  public async worktrees(): Promise<WorktreeSummary[]> {
    let output: string;
    if (this.worktreeNullOutput) {
      try { output = await this.run(["worktree", "list", "--porcelain", "-z"], false, { LC_ALL: "C" }); }
      catch (error) {
        if (!(error instanceof GitError) || !/unknown (?:switch|option)[^\r\n]*[\x60'\"]z['\"]/.test(error.detail ?? "")) throw error;
        output = await this.run(["worktree", "list", "--porcelain"]);
        this.worktreeNullOutput = false;
      }
    } else output = await this.run(["worktree", "list", "--porcelain"]);
    const result: WorktreeSummary[] = []; let item: WorktreeSummary | undefined;
    let readingPath = false;
    const tokens = this.worktreeNullOutput ? output.split("\0") : output.split(process.platform === "win32" ? /\r?\n/ : /\n/);
    for (const token of tokens) {
      // Older Git emits raw paths, even when they contain embedded newlines.
      if (item && readingPath && !/^HEAD [0-9a-f]{40,64}$/.test(token) && token !== "bare") { item.path += "\n" + token; continue; }
      if (token.startsWith("worktree ")) { item = { path: token.slice(9), hash: "", branch: "HEAD", bare: false }; result.push(item); readingPath = !this.worktreeNullOutput; }
      else if (item && token.startsWith("HEAD ")) { item.hash = token.slice(5); readingPath = false; }
      else if (item && token.startsWith("branch ")) item.branch = token.slice(7).replace(/^refs\/heads\//, "");
      else if (item && token === "bare") { item.bare = true; readingPath = false; }
      else if (item && (token === "locked" || token.startsWith("locked "))) item.locked = (this.worktreeNullOutput ? token.slice(7) : unquoteGitValue(token.slice(7))) || "已锁定";
      else if (item && (token === "prunable" || token.startsWith("prunable "))) item.prunable = token.slice(9) || "可清理";
    }
    if (readingPath) throw new GitError("无法读取 Worktree 路径，请升级 Git 后重试");
    return result;
  }
  public async createWorktree(directory: string, branch: string): Promise<void> {
    if (!path.isAbsolute(directory)) throw new GitError("Worktree 需要绝对路径");
    await this.run(["worktree", "add", "--", directory, this.ref(branch)]);
  }
  public async removeWorktree(directory: string): Promise<void> {
    if (!(await this.worktrees()).some(w => w.path === directory)) throw new GitError("该 worktree 已不存在");
    await this.run(["worktree", "remove", "--", directory]);
  }
  public async operation(action: "cherry-pick" | "revert" | "merge" | "rebase", ref: string): Promise<void> {
    const hash = await this.resolveCommit(ref);
    await this.run(action === "merge" || action === "revert" ? [action, "--no-edit", hash] : [action, hash]);
  }
  public async rebasePlan(ref: string): Promise<RebasePlan> {
    if (await this.operationState()) throw new GitError("请先完成或中止当前 Git 操作");
    const [base, head, status] = await Promise.all([this.resolveCommit(ref), this.resolveCommit("HEAD"), this.status()]);
    await this.run(["merge-base", "--is-ancestor", base, head]);
    const range = base + ".." + head;
    if ((await this.run(["rev-list", "--min-parents=2", range, "--"])).trim()) throw new GitError("此范围包含合并提交，请选择一段线性历史");
    const commits = parseCommits(await this.run(["log", "--reverse", "-n101", "--date=iso-strict", "--pretty=format:" + logFormat, range, "--"]));
    if (!commits.length) throw new GitError("基点之后没有提交可整理");
    if (commits.length > 100) throw new GitError("一次最多整理 100 条提交，请选择更近的基点");
    return { base, head, branch: status.branch, commits };
  }
  public async applyRebase(base: string, expectedHead: string, steps: RebaseStep[], expectedBranch?: string): Promise<string> {
    if ((await this.status()).files.length) throw new GitError("请先提交或 stash 工作区更改，再整理历史");
    const plan = await this.rebasePlan(base);
    if (plan.head !== expectedHead) throw new GitError("HEAD 已变化，请重新生成变基计划");
    if (expectedBranch !== undefined && plan.branch !== expectedBranch) throw new GitError("当前分支已变化，请重新生成变基计划");
    const expected = new Set(plan.commits.map(commit => commit.hash));
    if (!Array.isArray(steps) || steps.length !== expected.size) throw new GitError("变基计划必须包含范围中的每条提交");
    let hasPrevious = false;
    for (const step of steps) {
      if (!step || !expected.delete(step.hash) || !["pick", "squash", "fixup", "drop"].includes(step.action)) throw new GitError("变基计划存在重复、缺失或无效的提交");
      if ((step.action === "squash" || step.action === "fixup") && !hasPrevious) throw new GitError("squash / fixup 前必须有保留的提交");
      if (step.action !== "drop") hasPrevious = true;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "gitrism-rebase-"));
    try {
      const todoFile = path.join(directory, "plan.txt"), editorFile = path.join(directory, "sequence-editor.cjs");
      await writeFile(todoFile, steps.map(step => step.action + " " + step.hash).join("\n") + "\n", { mode: 0o600 });
      // Git invokes sequence.editor via a shell. Quote both generated filesystem paths.
      const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
      const expectedHashes = JSON.stringify(plan.commits.map(commit => commit.hash));
      const editorScript = "const fs=require('node:fs');const expected=" + expectedHashes + ";const hashes=fs.readFileSync(process.argv[2],'utf8').split(/\\r?\\n/).filter(line=>line.trim()&&!line.trim().startsWith('#')).map(line=>line.trim().split(/\\s+/)[1]);if(hashes.length!==expected.length||new Set(hashes).size!==expected.length||hashes.some(hash=>!expected.includes(hash)))throw new Error('Gitrism: history changed; regenerate the rebase plan');fs.copyFileSync(" + JSON.stringify(todoFile) + ", process.argv[2]);\n";
      await writeFile(editorFile, editorScript, { mode: 0o600 });
      const backup = "gitrism-backup/" + new Date().toISOString().slice(0,10) + "-" + plan.head.slice(0,8) + "-" + randomBytes(3).toString("hex");
      await this.run(["branch", backup, plan.head]);
      try {
        await this.run(["-c", "core.abbrev=" + plan.head.length, "-c", "rebase.updateRefs=false", "-c", "rebase.autoStash=false", "rebase", "--interactive", "--no-autosquash", plan.base], false,
          { GIT_SEQUENCE_EDITOR: quote(process.execPath) + " " + quote(editorFile), GIT_EDITOR: "true", ELECTRON_RUN_AS_NODE: "1" });
      } catch (error) {
        const message = error instanceof GitError ? error.detail || error.message : String(error);
        throw new GitError("变基未完成", message + "\n备份分支：" + backup + "\n可解决冲突后继续，或中止操作。");
      }
      return backup;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  public async operationState(): Promise<"merge" | "rebase" | "cherry-pick" | "revert" | undefined> {
    for (const [marker, operation] of [["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"]] as const) {
      const location = (await this.run(["rev-parse", "--git-path", marker])).trim();
      if (existsSync(path.resolve(this.cwd, location))) return operation;
    }
    return undefined;
  }
  public async finishOperation(action: "continue" | "abort"): Promise<void> {
    const operation = await this.operationState(); if (!operation) throw new GitError("没有进行中的合并或变基");
    await this.run(["-c", "core.editor=true", operation, "--" + action], false, { GIT_EDITOR: "true" });
  }
  public async lineHistory(file: string, start: number, end: number): Promise<string> {
    this.filePath(file); if (start < 1 || end < start || !Number.isInteger(start) || !Number.isInteger(end)) throw new GitError("无效的行范围");
    return this.run(["log", "-n50", "--format=medium", "-L", start + "," + end + ":" + file]);
  }
  public async blame(file: string, startLine?: number, endLine?: number): Promise<BlameLine[]> {
    this.filePath(file); const args = ["blame", "--line-porcelain"];
    if (startLine !== undefined && endLine !== undefined) args.push("-L", startLine + "," + endLine);
    args.push("--", file); const output = await this.run(args), result: BlameLine[] = []; let current: BlameLine | undefined;
    for (const line of output.split(/\r?\n/)) {
      const header = line.match(/^([0-9a-f^]{8,64})\s+\d+\s+\d+(?:\s+\d+)?$/);
      if (header) { current = { hash: header[1], author: "Unknown", date: "", summary: "" }; result.push(current); }
      else if (current && line.startsWith("author ")) current.author = line.slice(7);
      else if (current && line.startsWith("author-time ")) current.date = new Date(Number(line.slice(12)) * 1000).toISOString();
      else if (current && line.startsWith("summary ")) current.summary = line.slice(8);
    }
    return result;
  }
}
