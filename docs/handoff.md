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
- A small gap I left for later:
  - If you set the day to start between 02:00 and 03:00, the night the
    clocks go back can count as the wrong day. The default (04:00) is fine.

## After the first round of use (2026-11-09)

Changes from Serwan's first test, and the calls I made doing them:

- In My Day, Del now takes the task off today instead of deleting it, with
  a "Removed '…' from My Day · Undo (Z)" toast. B does the same there.
  Shift+Del deletes the task itself, from My Day or the tree.
- Z (and Ctrl+Z) is now a general undo with a history, not just "undo the
  last delete". It covers scheduling, moves, Done / Cancel / reopen, Doing /
  Worked on, deletes, new tasks and title edits; each press goes one change
  further back and shows "Undone: …". It leaves out folding, notes and link
  edits in the detail panel, and changes from the CLI or another window.
  The history is in the page, so a reload clears it. If an undo fails (the
  server is down), the change stays in the history and Z can try again.
- Two undo results are approximate: a task moved back goes after the
  sibling that was visible above it (a hidden completed sibling can make it
  land one slot off), and undoing a reopen closes the task again with all
  its open subtasks, not only the ones that had been closed with it.
- Dragging a My Day row onto the tree takes it off today. While it's over
  the tree, the tree gets a grey frame and the card says "Remove from My
  Day".
- I adds a task at the end of Inbox from anywhere (also the "+" on the
  Inbox heading, and the dashed line an empty Inbox shows). Dragging a leaf
  task into an empty Inbox already worked (drop it on the Projects heading
  or just above it); a task with subtasks can't go into Inbox, and the bar
  under the tree now says so instead of doing nothing.
- Edit mode now looks like a text field: white, a 2 px ring, an "Editing ·
  Esc" tag, and an EDITING badge in the key-hint bar. That's option A of
  three in docs/mockups/edit-mode-options.png; B and C are easy to swap in
  if you prefer one.
- Double-click on a title edits it; double-click elsewhere on a parent row
  folds it. The quick actions (S, T, D, Start) ignore the second click of a
  double-click, since they appear under the pointer on the first one.
- The tree header's fold button now toggles: Collapse all, then Expand all,
  which opens every parent, including ones that were collapsed before.
- docs/keyboard.md lists every way to navigate and change tasks, with the
  proposed "skip over nested rows" move and its open questions (which key,
  multi-select). Fold to level is in future-ideas.md.
