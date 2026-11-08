# Things to sync on

A running log kept while building the MVP (PLAN.md). Each item is something
where I made a call on your behalf, or that needs you (or the work laptop).
Newest at the bottom. Tick or strike items once we've talked them through.

## Needs you

- [ ] **Windows run.** The final checks in PLAN.md Task 24 (fresh clone,
  `start.cmd`, keyboard-only checklist in Edge) need the work laptop. I'll do
  the same run on Linux with Chromium here; please do the Windows one.

## Calls I made

- Packages are used straight from TypeScript source; there's no build step
  for `core` or `server` (Bun and Vite both run `.ts` directly).
- Undoing "Cancel" in the morning review also reopens the subtasks that were
  cancelled with it, matching how reopening works elsewhere.
- Moving with Ctrl+↑↓ and Tab skips over completed tasks that are hidden
  (closed more than a day ago), so a key press never seems to do nothing.
  Side effect: with "Show completed" on, a move can hop over an old
  completed task.
