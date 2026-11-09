# Keyboard: every way to move around and change things

A working inventory of how you navigate and change tasks in Daybreak, by keyboard and by mouse. It
exists so we can see the whole set at once, spot gaps and clashes, and then settle on a structure
that makes sense before adding more keys. [design.md](design.md), "Keyboard map", stays the
reference for what is built; this page is where changes to it are thought through first.

Started 2026-11-09, after the first round of real use. Status: **built** (in the app now),
**proposed** (worth doing, not built), **future** (in [future-ideas.md](future-ideas.md)).

## Principles so far

- **Plain arrows only move the selection.** They never change data.
- **Mod + the same arrow moves the task** the way the plain arrow moves the selection (Mod is Ctrl on
  Windows, Option on macOS). Mod+←→ is the exception: it folds, because "move left/right" is Tab and
  Shift+Tab.
- **One letter, one meaning, on every screen.** T is today in the tree, in My Day and in the morning
  review.
- **Two modes.** Navigate mode: letters are commands. Edit mode: letters type. Edit mode looks like a
  text field (a 2 px ring and an "Editing · Esc" tag) and the hint bar says EDITING, so you can always
  tell which one you're in.
- **Browser-reserved keys are avoided** while Daybreak runs in a browser tab: Ctrl+N, Ctrl+T, Ctrl+W,
  Ctrl+1–9, Alt+←→ (back/forward), F5.
- **Everything can be undone with Z**, one change per press.

## Moving the selection (navigate mode)

| Action | Tree | My Day | Mouse | Status |
| --- | --- | --- | --- | --- |
| Previous / next visible row, ignoring nesting | ↑ ↓ | ↑ ↓ | Click | built |
| Previous / next row at the same level or higher, skipping nested rows | Alt+↑ ↓ | ↑ ↓ (flat) | | built, see below |
| Parent | ← | n/a | | built |
| First child (expands a collapsed parent first) | → | n/a | | built |
| First / last row | Home / End | Home / End | | built |
| Switch between tree and My Day | M | M | Click in the pane | built |
| Clear the selection | Esc | Esc | | built |
| First / last sibling | | n/a | | idea |
| Jump to Inbox / Projects heading | | n/a | | idea |

### Skip over nested rows (Alt+↑↓)

↑ and ↓ walk every visible row, nested or not. With an expanded parent above you, ↑ from the row below
it lands on the parent's last descendant, and it takes many presses to get to the parent itself.

This move goes to the nearest row above (or below) that is **at the same level or higher**,
never deeper. With this tree, selected on "Milestone 3":

```
Fridge 3 readout upgrade
  Milestone 2 — Install and cooldown
    Order replacement coax lines
    Install TWPA on the mixing chamber plate
      Verify pump tone frequency with the VNA
  Milestone 3 — Characterise noise        ← selected
Parity-readout calibration pipeline
```

- **Up** goes straight to "Milestone 2" (its previous sibling), not to "Verify pump tone…".
- **Down** goes to "Parity-readout calibration pipeline": there is no next sibling, so it goes to the
  next row at a higher level.
- From "Milestone 2", **up** goes to "Fridge 3 readout upgrade" (the parent: no previous sibling).

In other words: up is "previous sibling, else parent"; down is "next sibling, else the next row after
the parent's subtree". Between Inbox and Projects it behaves like ↑↓. My Day is flat, so there it
would be the same as ↑↓.

Keys, decided 2026-11-09: **Alt+↑↓** on Windows. Shift+↑↓ stays free for selecting several rows
later. On macOS, where Option is Mod and Option+↑↓ already moves the task, it's Option+Shift+↑↓.
Alt+←→ stay unbound: they are the browser's Back and Forward.

## Folding

| Action | Tree | Mouse | Status |
| --- | --- | --- | --- |
| Collapse / expand the selected parent | Mod+← / Mod+→ | Chevron, or double-click the row beside the title | built |
| Collapse everything / expand everything | | The header's fold button (Collapse all, then Expand all) | built |
| Fold the whole tree to level N | Ctrl+Shift+1–9 (decided, not built) | | **future** ([future-ideas.md](future-ideas.md), "Fold to level") |
| Collapse all siblings except this one | | | idea |

## Changing the tree's structure

| Action | Tree | My Day | Mouse | Status |
| --- | --- | --- | --- | --- |
| Move up / down one slot, children along (Logseq-style) | Mod+↑ ↓ | Mod+↑ ↓ reorders the day | Drag | built |
| Indent / outdent | Tab / Shift+Tab | n/a | Drag left / right | built |
| Move between Inbox and Projects | Mod+↑ ↓ across the boundary | n/a | Drag onto the Projects heading, or into an empty Inbox | built |
| Move far across the tree | | n/a | Drag | built (mouse); cut and paste is **future** |
| Move to the top / bottom of its siblings | | | | idea |

Inbox is flat: a task with subtasks can't go there. A drag shows "Can't drop here · Inbox only takes
tasks without subtasks".

## Creating

| Action | Tree | My Day | Mouse | Status |
| --- | --- | --- | --- | --- |
| New task below the selected one, same level | N | n/a | "New task" button | built |
| New task at the end of Inbox, from anywhere | I | I | "+" on the Inbox heading; the empty-Inbox line | built |
| New task for today (goes to Inbox) | | N focuses the add field | The add field; title bar "Add to My Day" | built |
| New sibling while typing | Enter in edit mode | n/a | | built |
| New child of the selected task | | n/a | | idea (today: N then Tab) |
| Quick add from anywhere in Windows | Ctrl+Alt+Space | | | phase 6 |

## Editing text

| Action | Keys | Mouse | Status |
| --- | --- | --- | --- |
| Start editing the title | Enter or F2 | Double-click the title | built |
| Save and leave | Esc, or click elsewhere | | built |
| Save and edit the previous / next row | ↑ ↓ in edit mode | | built |
| Indent / outdent while typing | Tab / Shift+Tab | | built |
| Move the task while typing | Mod+↑ ↓ | | built |
| Delete an empty row and edit the one above | Backspace on an empty title | | built |
| Open the details; again to edit notes | Ctrl+O, Ctrl+O | Click the details | built |

## Planning the day

| Action | Tree | My Day | Mouse | Status |
| --- | --- | --- | --- | --- |
| Schedule today (end of My Day) | T | T | Quick action; drag into My Day | built |
| Pick a day | D | D | Quick action | built |
| Clear the day | B | B (takes it off today) | | built |
| Take it off today | | Del, B | Drag the My Day row onto the tree | built |

## Status and marks

| Action | Keys | Mouse | Status |
| --- | --- | --- | --- |
| Done / reopen (parents ask twice) | Space | Checkbox | built |
| Cancel / reopen | X | | built |
| Doing (one at a time) | S | Quick action, "Start" in My Day | built |
| Worked on | W | | built |
| Open the task's link | O | | built |

## Deleting and undoing

| Action | Tree | My Day | Status |
| --- | --- | --- | --- |
| Delete the task and its subtree (undo toast) | Del | Shift+Del | built |
| Undo the last change, again for the one before | Z or Ctrl+Z | Z or Ctrl+Z | built |
| Redo what Z undid | Ctrl+Shift+Z or Ctrl+Y | Ctrl+Shift+Z or Ctrl+Y | built |

What Z covers and what it doesn't: design.md, "Undo".

## Decided (2026-11-09)

- Skip-nesting move: Alt+↑↓ (Option+Shift+↑↓ on macOS); up goes to the previous sibling, else
  the parent.
- Shift+↑↓ and Shift+click are kept for selecting several rows, which may come later
  ([future-ideas.md](future-ideas.md), "Select several tasks").
- Redo: Ctrl+Shift+Z or Ctrl+Y.
- Fold to level: Ctrl+Shift+1–9, when it's built.

## Open questions

1. **Structure**: the current set grew key by key. One way to make it regular is a grid of "verb ×
   direction": plain arrows move the selection, Mod+arrows move the task, Alt+arrows jump by
   level, Shift+arrows (later) extend a selection, and letters act on the selection. Worth checking
   every row above against that grid before adding more.
