# Handoff

A running log kept while building the MVP ([archive/mvp-plan.md](archive/mvp-plan.md)). Each item is something
where I made a call on your behalf, or that needs you (or the work laptop).
Newest at the bottom. Tick or strike items once we've talked them through.

## Needs you

- [ ] **Windows run.** The final checks in the MVP plan's Task 24 (fresh clone,
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
- Images in notes aren't loaded; they show as link text. Loading one would
  send a request to an outside server whenever you open the task. Only http,
  https and mailto links are clickable; other links show as plain text.
- Dark-mode colours for the morning review aren't in DESIGN, so I picked
  them to match the dark palette: Today blue on dark blue, Another day lilac
  on dark purple, Backlog and Not today light grey on dark grey, Cancelled
  pink on dark red. Every one keeps text at 4.5:1 or better.
- In the review, a task moved to another day shows "Wed" if it's within the
  coming week and "Tue 17 Nov" if it's further out.
- The morning review's leftovers heading names the day ("LEFT OVER FROM
  FRIDAY") only when every leftover is from that one day and it was within
  the last 6 days. Otherwise it says "LEFT OVER FROM EARLIER", so a bare
  weekday never points at the wrong week.
- Daily logs list each task once. If you finished it, it's under Done. If
  you only worked on it, it's under Worked on, and keeps its "→ moved to …"
  from the next morning's review. Otherwise it's under Not done.
- A task you cancel during the day shows under Not done with "→ cancelled",
  as in SPEC's example. There's no separate Cancelled section.
- The first time logs are written, every past day with activity gets one.
  If writing a log fails (disk full, folder locked), finishing the review
  still works. The failed day and any after it are tried again at the next
  review.
- To edit a task's notes without the mouse, press Ctrl+O a second time while
  its details are open. Esc saves the notes and takes you back to the tree;
  a second Esc closes the details. (In the keyboard-only check, notes could
  only be reached by clicking.)
- The first time you press M, My Day selects its top row, so the next key
  acts on something straight away.
- Two small gaps I left for later:
  - If the server is down at the moment you press Z to undo a delete, the
    "Couldn't save" toast replaces the Undo toast, so Z can't retry once the
    server is back. The deleted tasks are still in the database (deletes are
    soft), but the app has no other way to bring them back yet.
  - If you set the day to start between 02:00 and 03:00, the night the
    clocks go back can count as the wrong day. The default (04:00) is fine.
