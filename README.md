# Gitrism

**See changes. Know history.**

Gitrism is a personal Git workspace for Visual Studio Code. Explore commit history, inspect changes, manage branches and worktrees, and organize commits using your local Git installation.

No account or subscription is required. Gitrism has no telemetry, external avatar requests, AI service, or cloud backend.

## Features

- **Commit graph:** actual parent relationships, branch and merge lanes, reference labels, and incremental loading of up to 2,000 commits.
- **Search and filters:** search messages, authors, hashes, or references; focus on a branch, tag, or file history.
- **Commit details:** full messages, author information, parent navigation, change statistics, and file status including renames.
- **Native diffs:** open changed files in VS Code's diff editor, including added and deleted files, the staging area, and working changes.
- **Working changes:** separate staged, unstaged, untracked, and conflicted files; stage or unstage individual files; preserve commit drafts across refreshes.
- **Branches and tags:** create and switch branches, safely delete merged local branches, browse remote branches, and create or delete local tags.
- **Reference comparison:** compare branches, tags, or commits; inspect final file differences and counts of commits unique to either side.
- **Stashes:** save work including untracked files, inspect saved changes, apply, pop, or delete entries.
- **Worktrees:** list and create worktrees, open them in a separate window, and remove them without forcing away local changes.
- **History operations:** cherry-pick, revert, merge, and rebase, with continue and abort controls when an operation is in progress.
- **Interactive rebase:** preview a linear history plan, reorder commits, squash, fixup, or drop them; create a backup branch before applying the plan.
- **File timeline:** follow renames through up to 500 commits, inspect monthly commit counts, and open commit details and diffs.
- **Blame and line history:** current-line or whole-file annotations, hover details, commit navigation, and history for selected lines.
- **Multiple repositories:** select workspace repositories and nested repositories discovered by VS Code's built-in Git extension.
- **Remote operations:** fetch, pull with `--ff-only`, push, and sync using existing Git credentials, with an optional SSH SOCKS5 proxy.

The editor graph and bottom panel share the same workspace interface. The interface currently uses Chinese labels, follows the active VS Code theme, and adapts to narrow panels.

## Install

Download [`gitrism-0.1.0.vsix`](https://github.com/SunboTax/gitrism/releases/tag/v0.1.0) from the private repository's Releases page. Sign in with an account that can access the repository.

In VS Code, choose **Extensions: Install from VSIX...**, or run:

```bash
code --install-extension gitrism-0.1.0.vsix --force
```

For Remote SSH, install the extension on the remote Extension Host. Reload the window after installation if VS Code requests it.

## Getting started

Open a Git repository and select the **Gitrism** tab in the bottom panel. You can also run **Gitrism: Open Bottom Panel** or **Gitrism: Open Commit Graph** from the Command Palette.

Click the repository name to switch repositories. Select a commit to inspect its details, then click a changed file to open a native diff. In the working changes view, stage the files you want to commit and enter a message. Only staged changes are committed.

Editor context menus provide file history, line blame, an inline blame toggle, and history for selected lines.

## Settings

Inline blame defaults to the current line when enabled:

```json
{
  "gitrism.inlineBlame.enabled": true,
  "gitrism.inlineBlame.mode": "currentLine",
  "gitrism.inlineBlame.maxLines": 1000
}
```

Set `gitrism.inlineBlame.mode` to `allLines` to annotate the whole file. Annotations are cleared while a document contains unsaved changes.

If SSH access depends on a SOCKS5 proxy configured only through a shell alias, configure it explicitly for the Extension Host:

```json
{
  "gitrism.sshProxy": "127.0.0.1:7890"
}
```

Leave the proxy setting empty to use the system SSH configuration. Remote Git operations use noninteractive credentials and a 60-second timeout.

Settings from the earlier Git Atlas installation are imported once where the corresponding Gitrism setting has not already been configured.

## Organizing history

In the history planning view, enter a base reference such as `HEAD~3`, or select a commit and choose the action to organize its subsequent history. The base commit remains in place; the plan covers commits after it through `HEAD`, ordered from oldest to newest.

Use the arrows to reorder commits and choose `pick`, `squash`, `fixup`, or `drop`. `squash` keeps the combined messages; `fixup` keeps the preceding message. The working tree must be clean, the range must be linear, and a plan may contain at most 100 commits.

Before applying a plan, Gitrism validates the current branch, tip, and commit set, then creates a local `gitrism-backup/...` branch. If conflicts occur, resolve and stage the files, then continue or abort the operation.

This release does not support rewording, merge-preserving interactive rebase, or selecting a mainline parent when cherry-picking or reverting a merge commit. Commit details show merge changes relative to the first parent.

## Development

Requirements: VS Code 1.85 or later, Git 2.31 or later, and Node.js 22 or later for the current development toolchain.

```bash
npm ci
npm run check
npm test
npm run package
```

Press `F5` in VS Code to launch an Extension Development Host. The package command creates `gitrism-0.1.0.vsix` locally; it does not publish the extension.

Tests create temporary Git repositories and cover topology, file paths and renames, staging, comparisons, stashes, worktrees, conflicts, and interactive rebase. Browser tests use Chrome to verify the real DOM, content security policy, escaping, draft persistence, themes, and narrow layouts.

Set `GITRISM_CHROME` if Chrome is installed at a different path. Browser tests report a skip when Chrome is unavailable. Screenshots are written to `/tmp/gitrism-preview` by default; override this with `GITRISM_SCREENSHOTS`.

## Scope and privacy

Git reads, diffs, and history analysis happen locally. Network operations occur when you request fetch, pull, push, or sync and use the repository's configured remotes. Git hooks and credential helpers follow the local Git configuration.

Gitrism independently implements common Git workflows. It does not include GitLens code or assets, modify GitLens, or bypass subscription checks. See [feature scope and roadmap](docs/feature-scope.md) for current limits and planned work, including CodeLens, pull request integrations, and optional AI assistance.

## License

[MIT](LICENSE).
