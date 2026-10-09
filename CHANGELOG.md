# Changelog

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
