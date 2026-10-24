# Feature scope

Gitrism independently implements common local Git workflows. The initial design referenced the commands and workflow categories exposed by the locally installed GitLens 19.3.0 manifest. The Git service, topology layout, interface, and assets are independently implemented; Gitrism contains no GitLens code or assets and does not modify subscription checks.

This document describes actual behavior in Gitrism 0.6.0. It does not claim complete parity with another product or subscription tier.

| Workflow | Current support | Limits |
| --- | --- | --- |
| Adjustable panes | Sidebar width, history/detail proportions, narrow graph height, keyboard controls, and saved preferences | Navigation becomes horizontal in compact windows; preferences are stored separately per webview |
| Commit graph | Parent topology, branch and merge lanes, references, and incremental loading | Up to 2,000 commits per graph query |
| Search and history | Messages, multiple literal authors, personal email, hashes, branches, tags, paths, date ranges, merge modes, and first-parent traversal | Dates filter committer time in the client timezone; filtered parents may be absent |
| CodeLens (optional, disabled by default) | Language-provider function/class ranges, retained-line commit links, email-based author breakdowns, and file history | Current retained lines only; skips unsaved or untracked files; default limits of 5,000 lines and 100 symbol locations |
| Personal activity | Adaptive 13/26/52-week calendar, own-email counts, active days, and day filters | Reachable local non-merge commits by committer date; no collaborator, issue, or pull request counts; one configured email |
| Commit inspection | Messages, parents, authors, files, renames, statistics, and native diffs | Merge changes are relative to the first parent |
| Working changes | Directory tree or flat list; per-directory and bulk expand/collapse; staged, unstaged, untracked, and conflict groups; individual or bulk staging; commits | Commits include staged content only |
| Reference comparison | Final file content, rename-aware diffs, and counts of unique commits | Lists at most 200 destination-only commits |
| Branches and tags | Create, switch, safe branch deletion, remote branch browsing, and local tags | No force deletion or remote tag management |
| Stashes | Save including untracked files, inspect, apply, pop, and delete | Ignored files are not included |
| Worktrees | List, create from existing references, open in a new window, and remove; support legacy porcelain output | Removal does not force away changes or locks; Git 2.25.1 does not report lock/prune reasons; discovery failures stay within this view |
| History operations | Cherry-pick, revert, merge, ordinary rebase, continue, and abort | No mainline-parent selection for merge commits |
| Interactive rebase | Linear plan, reorder, pick, squash, fixup, drop, backups, and stale-plan checks | At most 100 commits; no reword or merge-preserving plan |
| File timeline | Rename-following history, monthly commit counts, details, and diffs | At most 500 commits; chart measures commit counts, not changed lines |
| Blame and line history | Current-line annotations enabled by default, with author/date/commit/message, hover details, commit links, and selected-line history; optional whole-file mode | Current-line mode queries only the cursor line; whole-file annotations have a configurable file-length limit; unsaved annotations are cleared |
| Multiple repositories | Workspace roots and nested repositories discovered by built-in Git | No independent recursive filesystem scan |
| Remote operations | Fetch and prune, fast-forward pull, push, and sync | Existing credentials; noninteractive operations; 60-second timeout |

## Neovim

The [Neovim guide](neovim.md) covers the native terminal interface, optional browser workspace, and installation requirements.

Gitrism has no cloud patch service or team collaboration backend. Personal workflows remain the primary focus.

## Cursor

The same VSIX runs in Cursor. See the [Cursor guide](cursor.md) for installation, the tested local/SSH environments, and compatibility limits.

## Validation

- TypeScript compilation and checks.
- Temporary repositories covering unborn branches, dotted branch names, Unicode and unusual file names, staging and working changes, renames, initial commits, real branch topology, typed search, paging, and comparison.
- Stash inspection including untracked content, apply/pop/drop, safe worktree removal, merge conflict recovery, blame, and selected-line history.
- Interactive rebase tests covering reorder, squash and fixup message rules, dropping all commits, immutable backups, invalid plans, changed tips and branches, and aborting conflicting reordered patches.
- CodeLens tests covering language symbol nesting and fallback, identity grouping, file limits, cache invalidation, cancellation, and stale documents.
- Personal activity tests covering own-email matching, collaborator exclusion, reference deduplication, detached HEAD, stash/notes exclusion, local calendar boundaries, and daylight saving transitions.
- Controller tests covering stale repository reads, request validation, and mutation locks shared across panels.
- Chrome tests covering the real DOM, CSP, escaping, graph details, file diff requests, draft persistence, navigation, independent timelines, rebase plan editing, light/dark themes, narrow views, real mouse resizing, keyboard size limits and resets, cancelled drags, layout persistence, and scroll preservation during concurrent updates, directory nesting, per-status expansion, layout persistence, keyboard toggling, and full-path file actions.

The separate `npm run test:cursor` acceptance suite uses the packaged extension in an actual Cursor host. It checks webviews, native diffs, commands, themes, keyboard navigation, CodeLens, and current-line annotations. Remote SSH acceptance also verifies execution in the remote workspace extension host.

The tests do not push or pull the user's working repository. They do not cover every VS Code-compatible host; credential behavior and host integration depend on the installation environment.
