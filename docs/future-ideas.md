# Future ideas

Features that came up while designing Daybreak and were deliberately left out of V1. Each entry stands on its own, so any one can be picked up without reading the others. Before building one, check it against [spec.md](spec.md) section 2 and move it into scope there first.

Most of these were first sketched as alternative main-window layouts on the design canvas (https://claude.ai/artifact/VQCavjAkzp3vyn4wKeLoYv). Those layouts have since been removed from the canvas; the descriptions below are the record.

## Project progress bars

Top-level project rows in the tree show a thin progress bar and a done/total count (for example 4/13) right after the title. The count covers every task underneath the project, at any depth. Cancelled tasks are left out of both numbers, so cancelling work doesn't make a project look stuck.

Collapsed parents already show done/total in V1. This adds the always-visible bar, and only on top-level projects so deeper rows stay quiet.

## "Now" card in My Day

When a task is Doing, it gets a card pinned to the top of My Day showing its path, its title and three actions: Done (Space), Worked on (W) and Pause (S). The rest of My Day lists below the card under "Next". Finished items fold into a single "Done today · n" line that expands on click.

Decide first whether more than one task can be Doing at once. If yes, the card needs to handle several tasks; if no, starting a task should quietly pause the previous one.

## Zoom into a task

Logseq-style zoom. Ctrl+→, or clicking a task's bullet, narrows the tree to that task and its subtasks, with a breadcrumb along the top (All › Fridge 3 › Milestone 2). Ctrl+← or Esc steps back out one level, and clicking a breadcrumb jumps straight to that level.

While zoomed, new tasks, indenting and dragging all stay inside the zoomed task. My Day and the day column behave as usual. The app remembers the zoom across restarts.

## Project sidebar

A left sidebar listing My Day, Inbox and each top-level project, with its open-task count and a progress bar. Ctrl+1…9 jumps between entries. Choosing a project zooms the tree into it, so this builds on "Zoom into a task".

Only worth adding once the tree is too long to manage by collapsing. Until then it takes width away from the tree for little gain.

## One-outliner layout

An alternative layout with a single outline column instead of tree plus My Day side by side. My Day becomes the first section of the outline (numbered, in the order you'll do things), followed by Inbox and then Projects. T pins a row into the top section, and dragging between sections works the same as in the tree.

Best offered as a layout setting rather than a replacement. It suits a window snapped to half the screen, where two panes get cramped.

## Day filter panel

A small panel listing Overdue, Today, each remaining weekday, Next week, Later and No day, each with a count and a bar in the day-column colours (red overdue, blue today, fading grey after). Clicking an entry filters the tree to tasks scheduled then; clicking it again clears the filter.

Works with either layout and pairs naturally with the one-outliner layout.

## Cut and paste tasks

Ctrl+X on a selected task cuts it (with its subtree); Ctrl+V pastes it as the next sibling of the selected task, or as its first child with a modifier. The cut task stays visible, dimmed, until pasted, and Esc cancels the cut. Nothing is removed until the paste, so it's really a keyboard "move to here".

This is the planned answer for moving a task far across the tree. In V1, Mod+↑↓ moves one slot at a time and dragging covers longer distances. Browsers let pages use Ctrl+X / Ctrl+V, so it works in the browser version too.

## Fold to level

Keys that fold the whole tree to a given depth in one go: everything deeper than level N collapses, everything at or above it opens. For example Mod+Shift+1 shows only top-level projects, Mod+Shift+2 shows projects and their milestones, and so on, with Mod+Shift+0 expanding everything. The "Collapse all" / "Expand all" button in V1 covers the two extremes; this fills in the levels between.

Pick the keys with [keyboard.md](keyboard.md): Ctrl+1–9 are taken by the browser for tab switching while Daybreak runs in a tab, so the digits need Shift or the Tauri shell. Folding is stored per task (`collapsed`), so a fold to level is just a batch of collapse and expand writes and needs no new data.
