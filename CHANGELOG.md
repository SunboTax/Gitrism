# Changelog

## 0.6.0

- Verify the existing VSIX in official Cursor 3.26.16 on Linux x64, locally and over Remote SSH 1.1.16, with execution in the remote workspace extension host.
- Check real merge graphs, webview keyboard navigation, bottom-panel activation, four theme variants, native revision diffs, current-line attribution, and optional function CodeLens.
- Add an isolated packaged-extension host driver, screenshots and result reports, and Cursor local/SSH installation and troubleshooting documentation.

## 0.5.0

- Enable cursor-line attribution by default in VS Code and Neovim, showing author, date, short commit, and message. Query only the selected line, clear old annotations immediately on line changes, and discard stale responses. Current-line mode supports large files without applying the whole-file annotation limit.
- Make function/class CodeLens opt-in through **Gitrism: Toggle Function Attribution**; keep Neovim function/selection authors available on demand.
- Add a native Neovim 0.10+ commit graph using asynchronous Git directly, without Node.js or a browser: merge lanes, bounded incremental history, message filters, rename-aware file history, and on-demand commit summaries/patches.
- Provide native line blame, optional inline attribution, LSP/selection/file author ranges, and line history. Cancel stale graph/detail queries, restore source window settings, and adapt detail splits to terminal width.
- Keep the shared Git workspace optional through `:GitrismWeb`, served on loopback with per-process tokens, strict origin checks, native browser prompts, text content previews, and browser-to-Neovim file/worktree opening.
- Extract editor-independent workspace sessions and attribution helpers while preserving the VS Code adapter and native diffs.
- Coordinate Gitrism mutations across hosts and linked worktrees through a common Git-directory lock; stop editor-owned servers on channel closure.
- Document native Neovim setup and real terminal previews, optional browser/SSH usage, and limitations.

## 0.4.2

- Show changed files in a directory tree by default, with a flat list switch and expand/collapse-all controls.
- Keep staged, working, and conflict groups separate; show descendant file counts, full-path tooltips, rename hints, and original diff/stage targets.
- Remember directory expansion independently per status group across refreshes and webview recreation; reset expansion when changing repository and keep the chosen layout mode.
- Preserve the working view's scroll position during refreshes and keep the layout toolbar reachable in long lists.
- Fix webview recreation switching away from Working changes when a commit was previously selected.
- Localize new controls in English, Simplified Chinese, and Traditional Chinese, and verify nested paths, unusual names, keyboard toggling, and narrow layouts.

## 0.4.1

- Add draggable dividers for the navigation sidebar and history/detail panes, including the file timeline.
- Preserve navigation width and detail proportions across refreshes, repository changes, and webview recreation, with separate preferences per view and size limits for smaller windows.
- Allow vertical graph-height adjustment when narrow windows stack the graph above details; keep horizontal navigation compact.
- Support keyboard sizing, larger Shift steps, Home/End limits, double-click or Enter reset, and Escape cancellation, with localized separator labels and size announcements.
- Resize without rebuilding the interface during a drag; preserve pointer capture, scrolling, and form content through concurrent repository updates, and adapt the personal calendar to the new pane width.
- Verify real pointer dragging, responsive layouts, keyboard controls, persistence, and strict CSP in English, Simplified Chinese, and Traditional Chinese.

## 0.4.0

- Add independently implemented editor CodeLens for function and class attribution, retained-line commit links, email-based author breakdowns, and URI-aware file history.
- Use language-provider symbols, file-level fallback, bounded caches, and guards for dirty documents, cancellation, and stale reads.
- Add advanced commit search with date ranges, multiple literal authors, merge modes, first-parent traversal, and personal email filtering.
- Add an adaptive personal activity calendar to the graph's unselected detail pane, with 13/26/52-week periods and day-to-search navigation.
- Count only the repository's configured email, exclude collaborators and synthetic stash/notes commits, deduplicate references, and include detached HEAD commits.
- Keep calendar aggregation and selected-day boundaries in the client's timezone, including Remote SSH and daylight saving transitions; cache activity reads and isolate failures.
- Localize the new features in English, Simplified Chinese, and Traditional Chinese; verify Git 2.25.1 compatibility and browser layouts.

## 0.3.0

- Follow the VS Code display language, with English, Simplified Chinese, and Traditional Chinese; use English for unsupported languages.
- Localize all nine workspace views, sidebar labels, command titles, settings, prompts, notifications, validation errors, accessibility labels, and date formatting.
- Share translation catalogs between the Extension Host and Webview, with local resources and no additional runtime dependencies.
- Preserve repository content and raw Git output, and keep localization payloads compatible with the existing content security policy.
- Verify catalog coverage, placeholder consistency, locale fallback, native confirmations, and browser interactions in all three languages.

## 0.2.0

- Introduce an original prism visual identity with theme-aware cyan and purple accents, consistent line icons, and clearer typography.
- Group repository navigation in a sidebar, with horizontal navigation for narrow windows and short bottom panels.
- Refine the commit graph, search controls, reference badges, author initials, and selection states.
- Prioritize commit details and changed files; group secondary history actions in an expandable section.
- Redesign working changes, commit composition, repository cards, comparisons, timelines, and rebase plans.
- Use flexible graph sizing and contained scrolling when filters wrap; simplify narrow graph rows while retaining metadata in commit details.
- Add browser coverage for all nine views at 320px, a filtered 300px-high panel, scroll preservation, and expandable commit actions.

## 0.1.1

- Support Git 2.25.1 by falling back to newline-delimited worktree output when `worktree list -z` is unavailable, and cache the detected capability.
- Preserve worktree paths and decode quoted lock reasons in the compatibility reader.
- Resolve commit references without requiring the newer `rev-parse --end-of-options` option; option-like references remain rejected.
- Keep repository status and history available when worktree discovery fails, with an error and retry control in the Worktrees view.
- Add regression coverage for legacy Git, fallback errors, and recovery in the controller and browser interface.
- Add the dated preliminary intellectual property review and clarify the project's independent status.

## 0.1.0

Initial Gitrism release.

- Shared repository workspace in the editor and bottom panel, with nine views, theme integration, and responsive layouts.
- Commit topology, typed search, branch and tag filters, structured details, native diffs, and reference comparison.
- File staging and commits, branch and tag management, stashes, worktrees, and multiple repository selection.
- Cherry-pick, revert, merge, ordinary rebase, and continue or abort controls.
- Interactive rebase planning with reorder, squash, fixup, drop, backup branches, and stale-plan validation.
- File timeline, monthly commit counts, inline blame, and selected-line history.
- Local author initials, no telemetry or external avatars, strict content security policy, and serialized repository mutations.
- Real Git and browser regression tests.
