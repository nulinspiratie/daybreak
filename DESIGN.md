# Daybreak: design spec

Taken from the design canvas (https://claude.ai/artifact/VQCavjAkzp3vyn4wKeLoYv). The canvas still says "Work Planner"; the app is now **Daybreak**. Where this file and the canvas disagree, this file wins. In particular the canvas still shows the old review keys (A/S/D/F) and "Drop"; the keys below replace them. The mock-ups' source files are in [`design/`](design/). Ideas that came up and were left out of V1 are in [`docs/future-ideas.md`](docs/future-ideas.md).

## Feel

Calm, quick, keyboard-first and mouse-friendly. A native-feeling Windows 11 tool, around the quality of Things 3 or Linear. Lists are the product, so row design matters more than anything else. No modal dialogs for routine actions.

## Theme tokens

Font: `'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', Inter, system-ui, sans-serif`, base size 13 px. Monospace for paths and links: `Consolas, 'Cascadia Mono', monospace`.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| win | #F3F3F3 | #1C1C1C | Window background |
| pane | #FFFFFF | #272727 | Panels |
| pane2 | #FAFAFA | #232323 | Secondary surfaces |
| line | #E5E5E5 | #383838 | Dividers, indent guides |
| line2 | #C8C8C8 | #555555 | Key caps, stronger borders |
| cb | #8A8A8A | #9A9A9A | Empty checkbox border |
| text | #1B1B1B | #F2F2F2 | Primary text |
| text2 | #5C5C5C | #C4C4C4 | Secondary text, section headers |
| text3 | #6B6B6B | #A8A8A8 | Paths, hints |
| accent | #005FB8 | #5CC2F5 | Today, selection ring, primary buttons |
| onAccent | #FFFFFF | #0A1A24 | Text on accent |
| accentSoft | #E3EEFA | #1B3647 | Today chip, active button |
| doing | #DCEAF9 | #1B3647 | Row fill for Doing |
| overdue | #C42B1C | #FF99A4 | Overdue day label |
| near | #2B2B2B | #EDEDED | Day label tomorrow |
| far | #767676 | #8E8E8E | Day label two weeks+ |
| hover | #F3F3F3 | #303030 | Hover and selected fill |
| worked | #A85400 | #F0A35E | Worked-on mark |
| workedSoft | #FBEEE2 | #3B2B1D | Worked-on chip |
| done | #757575 | #9C9C9C | Done title |
| chip | #EFEFEF | #343434 | Neutral chip |

Review outcome tints (light): today #E3EEFA / #005FB8, another day #EFE8F8 / #6B3FA0, backlog #EDEDED / #4D4D4D, not today #F1F1F1 / #4D4D4D, cancelled #FBE9E7 / #B3261E.

All text meets 4.5:1 contrast, including the palest day labels. Keep it that way.

## Main window

- Target 1440 × 900. Must work at 1280 × 720 and snapped to half the screen.
- Custom title bar, 40 px: app icon (blue rounded square with a tick), app name, today's date, an "Add to My Day" button showing Ctrl+Alt+Space, a "Morning review" button, then Windows-style minimise / maximise / close (46 × 40 each).
- Body: **tree on the left (~60%)**, **My Day on the right (~40%)**.
- **Task detail opens in place of My Day**, so the tree never shrinks. Esc returns to My Day.
- A bar of key hints sits under the tree: Enter Edit · N New · Tab Indent · Ctrl+↑↓ Move · Ctrl+←→ Fold · M My Day · T Today · D Day · B Backlog · S Doing · W Worked on · Space Done · X Cancel · Del Delete · Ctrl+O Details. It shows the edit-mode hints (Enter New below · Tab Indent · Esc Done) while a title is being edited.

### Tree

- Header: "Tasks", a "Show completed" toggle with the count of hidden done tasks, "New task" (N), collapse all.
- Two section headers: **INBOX** (with open count) and **PROJECTS** (with count). 11 px, semibold, uppercase, 0.04em letter spacing, text2.
- **Rows are 26 px tall**, about 30 visible at 900 px. 22 px per nesting level, drawn with faint vertical guide lines (1 px `line` colour every 22 px).
- Row anatomy, left to right: day column, drag handle (visible on hover), indent, chevron (if it has children), 16 px square checkbox (4 px radius), title, then on hover the quick actions with their keys (S, T, D), plus small icons if it has notes or a link. Collapsed parents show `done/total`.
- Top-level projects are semibold.

### Day column

A fixed column (about 40–52 px, right-aligned, tabular numbers, 11 px) left of the tree. It shows the scheduled day:
- **Overdue:** the date (e.g. "6 Nov"), red, semibold.
- **Today:** "Today", accent blue, semibold.
- **Next six days:** weekday name ("Wed").
- **Later:** date ("20 Nov").
- Colour after today fades linearly from `near` (tomorrow) to `far` (14 days out), then stays `far`. Formula: `mix(near, far, min(1, (days - 1) / 13))`.
- Empty for done or cancelled tasks and for unscheduled tasks.

### My Day

- Header: "My Day", the date, "N of M done" and a 4 px progress bar (cancelled items are left out of both numbers).
- **Rows are 44–46 px**: drag handle on hover, 18 px round checkbox, then two lines: the grey path (10.5–12 px, text3) above the title (13.5 px).
- A Doing row gets the `doing` fill and a semibold title. A "Start" (S) action appears on hover for open items.
- Inline add at the bottom ("N" to focus): new items go to Inbox, scheduled today.
- Empty state: "Drag tasks in from the tree, or press T on a selected task".

### Task detail panel

From top: path, "Back to My Day · Esc", a 20 px checkbox with the title, then:
- **Scheduled:** segmented buttons Today / Tomorrow / Pick a day… / No day (D opens the picker).
- **Status:** segmented Open / Doing (S) / Worked on (W) / Done (Space) / Cancelled (X).
- **Link:** monospace path or URL with an "Open" button; placeholder "Paste a file, folder or URL".
- **In tree:** the path.
- **Notes · Markdown:** rendered Markdown; placeholder "Add notes — **bold**, - lists and `code` work."
- **Subtasks · N of M done:** child rows with checkbox and day chip.
- Key hints along the bottom.

## Row states

Shown on the canvas at 150%; real size is 26 px tall, 22 px per level, 13 px font.

| State | Look |
| --- | --- |
| Open | Resting, no chrome |
| Hover | Drag handle, a ghost worked-on mark, quick actions with keys |
| Selected | Grey fill plus a 1 px accent ring (blue fill is reserved for Doing) |
| Scheduled today | "Today" in the day column, blue, semibold |
| Overdue | Date in the day column, red, semibold |
| Scheduled another day | Weekday within a week, then a date, fading to grey by two weeks |
| Worked on | Half-filled orange circle (left half outline, right half filled). Still open. |
| Doing | Blue checkbox border (2 px), filled square inside, semibold title, blue row fill |
| Cancelled | × in the checkbox, struck through, text3 colour |
| Done | Filled accent checkbox with tick, struck through, dimmed (opacity ~0.85, `done` colour) |
| Collapsed parent | Chevron right, `done/total` count |
| Being dragged | Lifted card follows the pointer; children travel with it; a "+N" badge counts them |

### Drag to indent

While dragging, the pointer's horizontal offset picks the depth: every 22 px to the right is one level deeper. A drop indicator line starts at the x position where the task will land, with a label like "Level 3 · becomes a sibling of 'Write loader…'". Esc cancels the drag.

### Drag from tree into My Day

The source row stays in the tree. My Day shows an insertion line; a dashed "Today" chip previews the result. On drop, the tree row gains its Today label in the day column.

## Morning review (chosen design: running list)

- Full window, same title bar with "Morning review" and a "Skip for today" link.
- Centre column, 820 px wide. Above it: "Good morning — Tuesday 10 November" (12 px, text3) and the heading "Plan today, top to bottom" (24 px, semibold), with "x of y done" on the right.
- Sections: "LEFT OVER FROM MONDAY · x of y sorted", then "ANYTHING ELSE FOR TODAY? · Suggestions from your tree and Inbox", then the end row.
- **Decided rows:** 36 px, tinted by outcome, a small white circle with a tick in the outcome colour, the title (struck through if cancelled), and an outcome chip ("Today", "Wed", "Backlog", "Cancelled", "Not today").
- **Current item:** a white card, 12 px radius, 2 px accent ring, soft shadow. Path on top with "3 of 7" (or "Suggestion") on the right, the title at 20 px semibold, an optional "Worked on Monday · Continue today?" chip, an optional note, then the action buttons, each with its key cap (T Today / D Another day / B Backlog / X Cancel; on a suggestion B reads "Not today"). The first button is primary blue. Cancel text is red.
- **Upcoming rows:** 38 px, empty round checkbox, title, short project name on the right.
- **End row:** "N tasks for today" with a "Start the day · Space" button; it turns blue once everything is sorted.
- **Key legend** on the right (220 px): four key caps T D B X labelled "Today", "Another day", "Backlog / not today", "Cancel", then: "After D: 1–9 pick today up to 8 days out, or move with the arrows and press Enter. Z undoes the last choice." The screen never changes during the review; the list just runs on.

### Day picker

Opens inside the current card (about 620 × 330) on D in the review, or from D in the tree. A calendar grid starting today, where each day shows how many tasks are already on it, so you can spread the load. Keys: 1–9 for today up to 8 days out, arrows to move (←→ one day, ↑↓ one week), Enter to pick, Esc to close. In the tree's version there's also "No day" to clear. It should also accept typed input like "fri", "tomorrow" or "20 nov".

## My Day pop-up

- 380 × 560 window, 10 px radius, opens just above the app's tray or taskbar icon. The icon carries a badge with the number of open items today.
- Header: "My Day", the date, "x of y done" with a small progress bar.
- List rows: 44 px, round checkbox (tick off), path above title, worked-on mark if set. No reordering or nesting here.
- Footer: an "Add to My Day" input (Enter to add; "New items land in Inbox") and an "Open Daybreak" button.

## Quick add (Ctrl+Alt+Space)

- 620 px wide floating bar over whatever is open, 12 px radius, strong shadow.
- 60 px input row: empty round checkbox, 18 px input "Add to My Day…", Enter key cap.
- Below: a "My Day" toggle chip (Alt+T, on by default) and a "File under" chip (Tab), plus the hint "Shift+Enter adds and keeps the bar open · Esc closes".
- "File under" list: Inbox first, then recently used parents, 44 px rows with title and path. Tab and Shift+Tab move through it, Enter picks.
- After adding, a dark toast: "Added 'Order a spare SMA torque wrench' to My Day · Inbox".

## Keyboard map

The bar: as good as an outliner like Logseq without touching the mouse. One letter means the same thing on every screen.

### The modifier key

**Mod** is Ctrl on Windows and Option (Alt) on macOS. Ctrl+arrows have no browser meaning on Windows, and on macOS Cmd+← is browser Back while Option+arrows are free. V1 targets Windows; the Mac mapping just keeps development on other machines natural. Decide the platform once at startup; the key map refers to Mod everywhere.

### Two modes in the tree and My Day

- **Navigate mode** (default): one row is selected (grey fill, accent ring). Single letters are commands, so typing a letter never starts editing.
- **Edit mode**: the caret is in a row's title. Letters type. Changes save on Enter, Esc, Tab or leaving the row.

### Navigate mode

| Key | Action |
| --- | --- |
| ↑ ↓ | Previous / next visible row, regardless of hierarchy |
| ← | Go to parent (tree only) |
| → | Go to first child; on a collapsed parent, expand it first (tree only) |
| Home / End | First / last row |
| Mod+← / Mod+→ | Collapse / expand (tree only) |
| Mod+↑ / Mod+↓ | Move up / down, children travel along (see "Moving with Mod+↑↓"). In My Day: reorder the day |
| Tab / Shift+Tab | Indent / outdent (tree only; nothing in Inbox, which is flat) |
| M | Jump between the tree and My Day (keeps each pane's last selection; a pane with none, or whose selection is gone, selects its first row) |
| Enter or F2 | Edit title |
| N | New task below the selected one (tree) / focus the add field (My Day) |
| T | Schedule today (append to the end of My Day) |
| D | Pick a day |
| B | Backlog: clear the scheduled day (in My Day: take it off today) |
| S | Doing (only one at a time; the previous one becomes Worked on) |
| W | Worked on |
| Space | Done / undone. On a task with open subtasks, see "Closing a parent" |
| X | Cancel / reopen. Same double-press rule as Space |
| Del | Delete the task and its subtree (undo toast) |
| Ctrl+O | Open the detail panel; again to edit its notes |
| O | Open the task's link |
| Esc | Close detail panel, cancel drag, clear selection. In the notes: save and return to the tree with the panel still open; a second Esc closes it |
| Ctrl+Z | Undo last change (stretch goal) |

Plain letters (T, D, B, S, W, X, N, M, O) and Space work the same in the tree and My Day. Ctrl+N and Ctrl+1–9 are deliberately not used: browsers keep them for new window and tab switching, and the MVP runs in a browser tab. Ctrl+N can be added as an alias in the Tauri shell.

### Edit mode

| Key | Action |
| --- | --- |
| Enter | Save, create a new sibling below and edit it (type a list without stopping) |
| ↑ / ↓ | Save and edit the previous / next row |
| Tab / Shift+Tab | Indent / outdent while typing |
| Backspace on an empty title | Delete that row and edit the row above |
| Mod+↑ / Mod+↓ | Move the task, staying in edit mode |
| Esc | Save and return to navigate mode |
| ← → Ctrl+← Ctrl+→ Home End Del | Normal text editing (so collapse / expand only work in navigate mode) |

### Moving with Mod+↑↓

Logseq-style: the task (with its subtree) moves one slot at a time and keeps its depth.
- Normally it swaps with its previous / next sibling.
- At the edge of its siblings it carries on into the neighbouring branch at the same depth: moving up from a first child makes it the last child of the parent's previous sibling; moving down from a last child makes it the first child of the parent's next sibling. If there's no such branch, it doesn't move.
- Between sections: moving the first top-level project up puts it at the end of Inbox, and moving the last Inbox task down makes it the first top-level project. A task with subtasks can't go into Inbox (Inbox is flat), so it stops there.
- Depth changes only with Tab / Shift+Tab. Moving far away is a job for cut and paste, later (`docs/future-ideas.md`).

### Closing a parent

Space (or X) on a task with open subtasks doesn't act straight away. The first press shows an inline note under the row: "4 open subtasks. Press Space again to close them all." A second press within about 4 seconds closes the task and all its open subtasks; any other key or the timeout dismisses the note. The toast then says "Done 'Milestone 2' and 4 subtasks". Pressing Space again on that task reopens it and exactly the subtasks closed with it. Finishing the last open child never closes the parent automatically. Clicking a parent's checkbox follows the same rule: the first click shows the note, the second closes.

### Delete toast

Dark toast at the bottom of the window, same style as the quick-add toast: "Deleted 'Port fit routines' and 6 subtasks · Undo (Z)". Stays about 8 seconds; Z or clicking Undo restores the subtree exactly where it was. A newer delete replaces the toast, and Z then undoes the newest one.

### Morning review

T Today · D Another day · B Backlog (Not today for suggestions) · X Cancel · Z Undo · Space Start the day (once sorted). In the day picker: 1–9, arrows, Enter, Esc.

### Global

Ctrl+Alt+Space opens quick add from anywhere in Windows.

## Accessibility

Real `<button>`, `<input>` and `<label>` elements, `aria-label` on icon-only buttons, visible focus rings, text contrast at least 4.5:1, and colours that differ in lightness, not just hue (blue/orange rather than red/green for meaning).
