# Design files

Source of the Daybreak mock-ups, copied from the design canvas at https://claude.ai/artifact/VQCavjAkzp3vyn4wKeLoYv (it still says "Work Planner"). Each `.dc.html` file is one artboard; `canvas.json` holds the layout. They're reference material for building the UI, not app code. [DESIGN.md](../DESIGN.md) wins where it and these files disagree.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | Main window: tree with day column, My Day, task detail and day picker (light and dark via the `theme` prop) |
| `MainDark.dc.html` | Main window in dark mode |
| `TaskDetail.dc.html` | Main window with the task detail panel open |
| `SchedulePicker.dc.html` | Main window with the day picker open on a task (D) |
| `DayPicker.dc.html` | The shared day picker: next 9 days on 1–9, calendar with arrow keys |
| `MorningReviewList.dc.html` | Morning review as one running list |
| `TaskbarFlyout.dc.html` | My Day pop-up above the taskbar icon |
| `QuickAdd.dc.html` | Quick add from anywhere (Ctrl+Alt+Space) |
| `RowStates.dc.html` | A task row in every state, plus the drag moments |
| `DatePlacement.dc.html` | Day column colour scale |
