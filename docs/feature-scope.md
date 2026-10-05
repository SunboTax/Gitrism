# Feature scope and roadmap

Gitrism independently implements common local Git workflows. The initial design referenced the commands and workflow categories exposed by the locally installed GitLens 19.3.0 manifest. The Git service, topology layout, interface, and assets are independently implemented; Gitrism contains no GitLens code or assets and does not modify subscription checks.

This document describes actual behavior in Gitrism 0.1.0. It does not claim complete parity with another product or subscription tier.

| Workflow | Current support | Limits |
| --- | --- | --- |
| Commit graph | Parent topology, branch and merge lanes, references, and incremental loading | Up to 2,000 commits per graph query |
| Search and history | Messages, authors, hashes, branches, tags, and file paths | Explicit search field selection; filtered parents may be absent |
| Commit inspection | Messages, parents, authors, files, renames, statistics, and native diffs | Merge changes are relative to the first parent |
| Working changes | Staged, unstaged, untracked, and conflict groups; individual or bulk staging; commits | Commits include staged content only |
| Reference comparison | Final file content, rename-aware diffs, and counts of unique commits | Lists at most 200 destination-only commits |
| Branches and tags | Create, switch, safe branch deletion, remote branch browsing, and local tags | No force deletion or remote tag management |
| Stashes | Save including untracked files, inspect, apply, pop, and delete | Ignored files are not included |
| Worktrees | List, create from existing references, open in a new window, and remove | Removal does not force away changes or locks |
| History operations | Cherry-pick, revert, merge, ordinary rebase, continue, and abort | No mainline-parent selection for merge commits |
| Interactive rebase | Linear plan, reorder, pick, squash, fixup, drop, backups, and stale-plan checks | At most 100 commits; no reword or merge-preserving plan |
| File timeline | Rename-following history, monthly commit counts, details, and diffs | At most 500 commits; chart measures commit counts, not changed lines |
| Blame and line history | Current-line or whole-file annotations, hover details, commit links, and selected-line history | Annotations are cleared for unsaved documents |
| Multiple repositories | Workspace roots and nested repositories discovered by built-in Git | No independent recursive filesystem scan |
| Remote operations | Fetch and prune, fast-forward pull, push, and sync | Existing credentials; noninteractive operations; 60-second timeout |

## Next priorities

1. Reword and merge-preserving history plans.
2. CodeLens, history snapshots, changed-line trends, and range blame.
3. Optional GitHub or GitLab pull request integration, and local patch import/export.
4. Optional AI assistance through a user-configured provider, disabled by default and explicit about content sent externally.

Gitrism has no cloud patch service or team collaboration backend. Personal workflows remain the primary focus.

## Validation

- TypeScript compilation and checks.
- Temporary repositories covering unborn branches, dotted branch names, Unicode and unusual file names, staging and working changes, renames, initial commits, real branch topology, typed search, paging, and comparison.
- Stash inspection including untracked content, apply/pop/drop, safe worktree removal, merge conflict recovery, blame, and selected-line history.
- Interactive rebase tests covering reorder, squash and fixup message rules, dropping all commits, immutable backups, invalid plans, changed tips and branches, and aborting conflicting reordered patches.
- Controller tests covering stale repository reads, request validation, and mutation locks shared across panels.
- Chrome tests covering the real DOM, CSP, escaping, graph details, file diff requests, draft persistence, navigation, independent timelines, rebase plan editing, light/dark themes, and narrow views.

The tests do not push or pull the user's working repository and do not constitute a full VS Code Extension Host acceptance suite. Credential behavior and host integration depend on the installation environment.
