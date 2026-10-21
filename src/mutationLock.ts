import { mkdir, realpath, rm } from "node:fs/promises";
import * as path from "node:path";
import { GitError, GitService } from "./gitService";
import { t } from "./localization";

const running = new Set<string>();
// The shared Git directory also coordinates different worktrees and host processes.
export async function withGitMutation(git: GitService, action: () => Promise<void>): Promise<void> {
  const key = git.cwd;
  if (running.has(key)) throw new GitError(t("A Git operation is already running in this repository. Try again later."));
  running.add(key);
  let lock: string | undefined;
  try {
    if (typeof git.commonDirectory === "function") {
      const directory = await realpath(await git.commonDirectory());
      const candidate = path.join(directory, "gitrism-operation.lock");
      try { await mkdir(candidate); lock = candidate; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new GitError(t("Another Gitrism operation holds {0}. If all Gitrism processes have stopped, remove this lock directory.", candidate));
        throw error;
      }
    }
    await action();
  } finally {
    try { if (lock) await rm(lock, { recursive: true, force: true }); }
    finally { running.delete(key); }
  }
}
