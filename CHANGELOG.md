# Changelog

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
