import { t } from "./localization";
import * as path from "node:path";
import { GitError, GitService, GraphOptions, RebaseStep, PersonalActivity, validateGraphOptions } from "./gitService";
import { withGitMutation } from "./mutationLock";
import { NetworkProxy, normalizeNetworkProxy, defaultNetworkProxy } from "./networkProxy";

export interface WorkspaceHost {
  postMessage(message: unknown): void;
  isTrusted(): boolean;
  confirm(message: string, detail: string): Promise<boolean>;
  input(prompt: string, value?: string): Promise<string | undefined>;
  pick(items: string[], prompt: string): Promise<string | undefined>;
  chooseRepository(): Promise<void>;
  openGraph(): Promise<void>;
  activeHistory(): Promise<void>;
  openDiff(git: GitService, from: string, to: string, file: string, oldFile?: string): Promise<void>;
  openFile(file: string): Promise<void>;
  openWorktree(directory: string): Promise<void>;
  copy(value: string): Promise<void>;
  networkInfo?(): { host: string; remote: boolean; scope: "workspace" | "session" };
  saveNetworkProxy?(config: NetworkProxy): Promise<void>;
}
export type WorkspaceMessage = Record<string, unknown> & { type: string; request?: number };
function text(message: WorkspaceMessage, key: string, fallback = ""): string {
  const value = message[key]; if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 100_000) throw new GitError(t("Invalid request parameter"));
  return value;
}
export class WorkspaceSession {
  private active = true;
  private options: GraphOptions = {};
  private limit = 100;
  private generation = 0;
  private refreshId = 0;
  private activityCache?: { key: string; expires: number; promise: Promise<PersonalActivity> };
  public constructor(private git: GitService | undefined, private readonly host: WorkspaceHost, private readonly changed: () => Promise<void>) {}
  public dispose(): void { this.active = false; this.generation++; }
  public setGit(git: GitService | undefined): void {
    if (this.git?.cwd !== git?.cwd) { this.options = {}; this.limit = 100; this.activityCache = undefined; this.post({ type: "reset" }); }
    this.git = git; this.generation++; void this.refresh();
  }
  public async revealCommit(hash: string): Promise<void> {
    this.post({ type: "revealCommit", hash });
  }
  public revealTimeline(file: string): void { this.post({ type: "timeline", file }); }
  public async refresh(): Promise<void> {
    if (!this.active) return;
    const git = this.git, generation = this.generation, request = ++this.refreshId;
    if (!git) { this.post({ type: "data", data: null }); return; }
    this.post({ type: "loading", value: true });
    try {
      const [status, branches, commits, tags, stashes, worktreeResult, operation] = await Promise.all([
        git.status(), git.branches(true), git.graph(this.limit + 1, this.options), git.tags(), git.stashes(),
        git.worktrees().then(worktrees => ({ worktrees, worktreesError: undefined }), error => ({ worktrees: [], worktreesError: formatError(error) })),
        git.operationState()
      ]);
      if (generation !== this.generation || request !== this.refreshId) return;
      this.post({ type: "data", data: { root: git.cwd, name: path.basename(git.cwd), status, branches, commits: commits.slice(0, this.limit), tags, stashes, ...worktreeResult, operation,
        network: { config: git.getNetworkProxy?.() || defaultNetworkProxy, legacySshProxy: git.getLegacySshProxy?.() || "", ...this.host.networkInfo?.() },
        hasMore: commits.length > this.limit && this.limit < 2000, options: this.options, limit: this.limit } });
      const activityKey = JSON.stringify([git.cwd, status.branch, branches.map(b => [b.name,b.hash]), tags.map(tag => [tag.name,tag.hash]), commits[0]?.hash]);
      void this.refreshActivity(git, generation, request, activityKey);
    } catch (error) {
      if (generation === this.generation && request === this.refreshId) this.post({ type: "error", message: formatError(error) });
    } finally {
      if (generation === this.generation && request === this.refreshId) this.post({ type: "loading", value: false });
    }
  }
  private async refreshActivity(git: GitService, generation: number, request: number, key: string): Promise<void> {
    let pending: Promise<PersonalActivity> | undefined;
    try {
      if (!this.activityCache || this.activityCache.key !== key || this.activityCache.expires < Date.now()) {
        this.activityCache = { key, expires: Date.now() + 60_000, promise: git.personalActivity() };
      }
      pending = this.activityCache.promise;
      const activity = await pending;
      if (generation === this.generation && request === this.refreshId) this.post({ type: "activity", root: git.cwd, activity });
    } catch (error) {
      if (this.activityCache?.promise === pending) this.activityCache = undefined;
      if (generation === this.generation && request === this.refreshId) this.post({ type: "activity", root: git.cwd, error: formatError(error) });
    }
  }
  private post(message: unknown): void { if (this.active) this.host.postMessage(message); }
  private async confirm(message: string, detail: string): Promise<boolean> {
    return this.host.confirm(message, detail);
  }
  public async handle(message: WorkspaceMessage): Promise<void> {
    const git = this.git, generation = this.generation;
    try {
      if (message.type === "ready" || message.type === "refresh") { if (message.type === "refresh") this.activityCache = undefined; await this.refresh(); return; }
      if (message.type === "chooseRepository") { await this.host.chooseRepository(); return; }
      if (message.type === "openGraph") { await this.host.openGraph(); return; }
      if (message.type === "activeHistory") { await this.host.activeHistory(); return; }
      if (message.type === "search") {
        const searchBy = text(message, "searchBy", "message");
        if (!["message", "author", "hash"].includes(searchBy)) throw new GitError(t("Unknown search type"));
        const options: GraphOptions = { query: text(message, "query"), searchBy: searchBy as GraphOptions["searchBy"], ref: text(message, "ref") || undefined, file: text(message, "file") || undefined,
          authors: message.authors as string[] | undefined, authorEmail: text(message, "authorEmail") || undefined,
          since: text(message, "since") || undefined, until: text(message, "until") || undefined,
          merges: text(message, "merges", "all") as GraphOptions["merges"], firstParent: message.firstParent as boolean | undefined };
        validateGraphOptions(options);
        this.options = options;
        this.limit = 100; await this.refresh(); return;
      }
      if (message.type === "more") { this.limit = Math.min(2000, this.limit + 100); await this.refresh(); return; }
      if (!git) return;
      if (message.type === "saveNetworkProxy") {
        if (!this.host.isTrusted()) throw new GitError(t("Trust this workspace before running Git operations"));
        if (!this.host.saveNetworkProxy) throw new GitError(t("Network proxy configuration is unavailable in this host"));
        const config = normalizeNetworkProxy(message.config);
        await withGitMutation(git, async () => {
          await this.host.saveNetworkProxy!(config);
          git.setNetworkProxy(config);
        });
        if (generation === this.generation) {
          this.post({ type: "networkProxySaved", config, request: message.request });
          await this.changed(); await this.refresh();
        }
        return;
      }
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
        await this.host.openDiff(git, text(message, "from"), text(message, "to"), text(message, "file"), text(message, "oldFile") || undefined); return;
      }
      if (message.type === "workingDiff") {
        const file = text(message, "file"), staged = message.staged === true;
        const item = (await git.status()).files.find(f => f.path === file);
        if (!item) throw new GitError(t("This file has no changes. Refresh the workspace."));
        if (item.conflict) { await this.host.openFile(git.filePath(file)); return; }
        if (staged) await this.host.openDiff(git, item.index === "A" || !(await git.hasHead()) ? "EMPTY" : await git.resolveCommit("HEAD"), item.index === "D" ? "EMPTY" : "INDEX", file, item.oldPath);
        else await this.host.openDiff(git, item.index === "?" ? "EMPTY" : "INDEX", item.working === "D" ? "EMPTY" : "WORKING", file);
        return;
      }
      if (message.type === "copy") { await this.host.copy(text(message, "value")); return; }
      if (message.type === "openWorktree") {
        const directory = text(message, "path");
        if (!(await git.worktrees()).some(w => w.path === directory)) throw new GitError(t("Unknown worktree"));
        await this.host.openWorktree(directory); return;
      }
      const mutations = ["fetch", "pull", "push", "sync", "stageAll", "unstageAll", "stage", "unstage", "commit", "checkout", "createBranch", "deleteBranch", "createTag", "deleteTag", "stashPush", "stashAction", "createWorktree", "removeWorktree", "operation", "finishOperation", "applyRebase"];
      if (!mutations.includes(message.type)) return;
      if (!this.host.isTrusted()) throw new GitError(t("Trust this workspace before running Git operations"));
      let acquired = false;
      try {
        await withGitMutation(git, async () => {
          acquired = true;
          this.post({ type: "busy", value: true });
          let completed = true;
          let successMessage = t("Operation completed");
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
              const name = await this.host.input(t("New branch name (switch after creating)"));
              if (name) await git.createBranch(name, text(message, "ref", "HEAD")); else completed = false; break;
            }
            case "deleteBranch": {
              const name = text(message, "branch");
              if (await this.confirm(t("Delete local branch {0}?", name), t("Only merged branches are deleted. Git keeps unmerged branches."))) await git.deleteBranch(name); else completed = false; break;
            }
            case "createTag": {
              const name = await this.host.input(t("New tag name (local tag only)"));
              if (name) await git.createTag(name, text(message, "ref", "HEAD")); else completed = false; break;
            }
            case "deleteTag": {
              const name = text(message, "tag");
              if (await this.confirm(t("Delete local tag {0}?", name), t("Remote tags will not be deleted."))) await git.deleteTag(name); else completed = false; break;
            }
            case "stashPush": {
              const name = await this.host.input(t("Save working changes to stash (include untracked, exclude ignored files)"), "Gitrism stash");
              if (name !== undefined) await git.stashPush(name); else completed = false; break;
            }
            case "stashAction": {
              const action = text(message, "action");
              if (!["apply", "pop", "drop"].includes(action)) throw new GitError(t("Unknown stash action"));
              if (action === "drop" && !(await this.confirm(t("Delete this stash?"), t("Saved changes will be removed from the stash list.")))) { completed = false; break; }
              await git.stashAction(action as "apply" | "pop" | "drop", text(message, "hash")); break;
            }
            case "createWorktree": {
              const branch = await this.host.pick((await git.branches(true)).map(b => b.name), t("Choose a branch not checked out in another worktree"));
              if (!branch) { completed = false; break; }
              const directory = await this.host.input(t("Absolute path for the new worktree (empty or nonexistent directory)"), path.join(path.dirname(git.cwd), path.basename(git.cwd) + "-worktree"));
              if (directory) await git.createWorktree(directory, branch); else completed = false; break;
            }
            case "removeWorktree": {
              const directory = text(message, "path");
              if (await this.confirm(t("Remove worktree?"), t("{0}\nGit refuses to remove a dirty or locked worktree.", directory))) await git.removeWorktree(directory); else completed = false; break;
            }
            case "operation": {
              const action = text(message, "action"), ref = text(message, "ref");
              if (!["cherry-pick", "revert", "merge", "rebase"].includes(action)) throw new GitError(t("Unknown Git operation"));
              if (await this.confirm(t("Run {0} on the current branch?", action), t("Target: {0}\n{1}", ref, action === "rebase" ? t("Rebase rewrites the current branch history. Confirm this branch is suitable for rebasing.") : t("This operation may cause conflicts. Continue or abort from the workspace.")))) await git.operation(action as "cherry-pick" | "revert" | "merge" | "rebase", ref); else completed = false; break;
            }
            case "finishOperation": {
              const action = text(message, "action");
              if (action !== "continue" && action !== "abort") throw new GitError(t("Unknown operation"));
              if (action === "abort" && !(await this.confirm(t("Abort the current Git operation?"), t("Git will try to restore the state before the operation.")))) { completed = false; break; }
              await git.finishOperation(action); break;
            }
            case "applyRebase": {
              if (!Array.isArray(message.steps) || message.steps.length > 100) throw new GitError(t("Invalid rebase plan"));
              const base = text(message, "base"), head = text(message, "head");
              const steps = message.steps as RebaseStep[];
              if (await this.confirm(t("Rewrite the current branch history using this plan?"), t("Base: {0}\nRange: {1} commits\nA gitrism-backup branch will be created first. squash keeps combined messages; fixup keeps the previous message. Confirm this history is suitable for rewriting.", base.slice(0,8), steps.length))) {
                const backup = await git.applyRebase(base, head, steps, text(message, "branch"));
                successMessage = t("Rebase completed. Backup branch: {0}", backup);
                this.post({ type: "rebased", backup });
              } else completed = false;
              break;
            }
          }
          if (completed) this.post({ type: "notice", message: successMessage });
        });
      } finally {
        if (acquired) {
          this.post({ type: "busy", value: false });
          await this.changed();
        }
      }
    } catch (error) { if (generation === this.generation) this.post({ type: "error", request: message.request, message: formatError(error) }); }
  }
}
export function formatError(error: unknown): string { return error instanceof GitError ? error.detail || error.message : String(error); }
