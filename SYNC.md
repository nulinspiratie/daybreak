# Things to sync on

A running log kept while building the MVP (PLAN.md). Each item is something
where I made a call on your behalf, or that needs you (or the work laptop).
Newest at the bottom. Tick or strike items once we've talked them through.

## Needs you

- [ ] **Windows run.** The final checks in PLAN.md Task 24 (fresh clone,
  `start.cmd`, keyboard-only checklist in Edge) need the work laptop. I'll do
  the same run on Linux with Chromium here; please do the Windows one.
- [ ] **Links in notes on Windows.** Clicking an http(s) or mailto link in a
  task's notes asks the server to open it with the system handler
  (`explorer.exe <url>` on Windows). I can only test that on Linux. Please
  check that a link opens in your default browser, and a mailto link in
  Outlook.

## Calls I made

- Packages are used straight from TypeScript source; there's no build step
  for `core` or `server` (Bun and Vite both run `.ts` directly).
- Undoing "Cancel" in the morning review also reopens the subtasks that were
  cancelled with it, matching how reopening works elsewhere.
- Moving with Ctrl+↑↓ and Tab skips over completed tasks that are hidden
  (closed more than a day ago), so a key press never seems to do nothing.
  Side effect: with "Show completed" on, a move can hop over an old
  completed task.
- Morning review suggestions: once you've decided on a project's suggestion,
  that project doesn't offer another one in the same review. To change a
  decision, press Z (undo) and decide again.
- "Worked on Monday" in the review also counts a task left as Doing that day.
- Toasts appear only where the design asks for them: after a delete
  ("Deleted … · Undo (Z)") and after closing a task together with its
  subtasks. Ticking off a single task shows no toast, so it can't push a
  pending delete-undo off screen. Tell me if you'd like a toast for every
  close.
- X on a Done task cancels it, and X on a cancelled task reopens it (Space
  works the same way for Done).
- If a new task can't be saved (server down or restarted mid-typing), a
  toast says "Couldn't save '…'" so it's never lost silently; tasks typed
  after it in the same list still save. The wording is mine; DESIGN has no
  error copy.
- Day picker digits: pressing 1–9 in an empty picker picks that day after a
  short pause (0.4 s), or straight away if you press Enter. If you keep
  typing, it becomes a typed date instead, so "20 nov" works. (The plan's
  rule picked on the first digit, which made "20 nov" impossible to type.)
- The task detail panel (Ctrl+O) follows your selection: with it open, ↑/↓
  in the tree show the next task's details. Links in notes open through
  Daybreak's "open link" (your default browser or app), not inside the app.

- **Images in notes are not loaded.** Markdown images show as link text, so
  notes never fetch remote URLs (a fetch would leak to the image host that
  you opened the task). Only http, https and mailto links are clickable;
  others show as plain text.
