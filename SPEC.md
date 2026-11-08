# Daybreak: product and technical spec

Status: ready for an MVP build. Written 2026-11-08; open questions settled and keyboard model added the same day.

Related:
- Design canvas: https://claude.ai/artifact/VQCavjAkzp3vyn4wKeLoYv (chosen morning review: board 2, "running list with day picker")
- Design brief: https://claude.ai/artifact/XaFzRe2BwnVA5nByaoQ74X
- Visual and interaction details: [DESIGN.md](DESIGN.md)

## 1. What Daybreak is

Daybreak is a local task manager and daily planner for one person's work, running on a Windows 11 work laptop. It has to hold big multi-month projects and dozens of tiny one-offs ("message X about Y") in the same place, and make it easy to decide every morning what today is about.

It is not a team tool, not synced anywhere, and not on a phone. Personal tasks stay in Tasks.org.

The one thing that decides whether it sticks: a morning review that takes about two minutes, plus a task tree that is fast to reshape with either keyboard or mouse.

### Hard constraints

- **Work content never leaves the work laptop.** The database and logs live in a local data folder outside this repo. No cloud sync, no telemetry. Development on other machines uses fake seed data only.
- **Windows 11 desktop only** for V1. Built with web tech so a browser version can run later (for example on the NAS behind Cloudflare Access) without a rewrite.
- **Lean.** Nothing gets built until it's actually missed. The out-of-scope list below is deliberate.

## 2. Scope

### In V1

- One nested task tree: Inbox plus projects, any depth.
- Full keyboard control and full mouse control (drag to reorder, drag to indent, drag into My Day). The keyboard has to be as good as an outliner like Logseq: adding, deleting, reordering, re-nesting and moving tasks into and around My Day all without the mouse (DESIGN.md, "Keyboard map").
- Delete (Del), with an undo toast. Separate from cancel: delete is for mistakes, cancel is for work you decided not to do.
- My Day: the tasks scheduled for today, in the order they'll be done.
- Morning review: clears yesterday's leftovers one by one, then offers suggestions.
- Task detail panel: title, Markdown notes, link, scheduled day, status, subtasks.
- Statuses: open, doing, worked on, done, cancelled.
- Done and cancelled tasks hide from the tree after a while; a "Show completed" toggle brings them back.
- A frozen Markdown log per day, readable without the app.
- Quick add from anywhere in Windows (Ctrl+Alt+Space) and a small My Day pop-up from the tray or taskbar. These come after the core, not before.
- A CLI so AI agents can read and update tasks (after the UI works).

### Not in V1

Due dates (only a scheduled day exists), recurring tasks, visible tags or tag views, mobile, calendar or time blocks, Outlook integration, Azure DevOps links, sharing, search screens, archive screens, weekly review. Tags are stored from day one so tag views can come later without a migration.

## 3. Concepts

There is one kind of object, a **task**. A project, a milestone and a subtask are all tasks at different depths of the same tree.

| Concept | Meaning |
| --- | --- |
| Tree | Two fixed top-level sections: **Inbox** (flat list of one-offs, called "Loose" in early drafts) and **Projects** (nested as deep as needed). Manual order everywhere. |
| Scheduled day | "I plan to work on this on that day." The only date a task has. Optional. |
| My Day | The open tasks whose scheduled day is today, in their own day order (independent of tree order). A flat list; each item shows its tree path, e.g. `Fridge 3 › Milestone 2 › Install TWPA`. |
| Overdue | Scheduled day is in the past and the task is still open. Only happens if the review was skipped. |
| Backlog | Any open task with no scheduled day. Not a separate list, just the absence of a day. |
| Notes | Short Markdown on the task. Nested bullets are fine; real structure belongs in subtasks. |
| Link | One optional file path, folder path or URL. Opens in the default handler (editor, Explorer, browser). Used for long descriptions that live in a Markdown doc elsewhere. |

### Statuses

Exactly one at a time:

| Status | Meaning | Key |
| --- | --- | --- |
| Open | Default. | |
| Doing | Working on it right now. Blue fill in My Day. | S |
| Worked on | Touched today, not finished. Still open; comes back in tomorrow's review as "Continue today?" | W |
| Done | Finished. | Space |
| Cancelled | Won't do. Kept, struck through, excluded from My Day's count. | X |

"Doing" and "worked on" are about today. Both fall back to plain open at the start of the next day, after being recorded in the day's log (see section 6). So in storage they're day marks, not task statuses (section 5).

### Rules that tie things together

- Anything typed into My Day becomes a real task in Inbox, scheduled today.
- Ticking a task in My Day completes the same task in the tree. There's only ever one object.
- Dragging a task from the tree into My Day schedules it for today at the drop position. It stays in the tree and gains a "Today" label in the day column.
- Done tasks stay visible, crossed out, in My Day until the day ends. In the tree they fade and hide about a day after completion, unless "Show completed" is on. Nothing is ever deleted by this.
- A parent's progress shows as `done/total` when collapsed.
- Only one task is Doing at a time. Starting one turns the previous Doing task into Worked on.
- Scheduling a parent for today puts only the parent in My Day, not its children (it shows its `done/total`). May be revisited after real use.
- S (Doing) or W (Worked on) on a task not scheduled today also schedules it today, appended to My Day: you're working on it today, so it belongs there, and if it's still open tomorrow it comes back in the review as "Continue today?". *(Builder's call.)*
- Inbox is flat: Tab does nothing on an Inbox task. To give it subtasks, move it into Projects first. *(Builder's call.)*
- Deleting a task deletes its whole subtree. It disappears from every view, the API and the CLI, and from logs written afterwards. A toast offers Undo (Z) for about 8 seconds, which brings the subtree back exactly where it was.

## 4. The morning review

Shown full-window the first time the app opens on a new day. "Skip for today" is always available, in which case leftovers just show as overdue in the tree.

It's one running list on one screen, worked top to bottom:

1. **Left over from yesterday** (really: every open task scheduled before today, oldest first). One item is "current", shown large with its path and notes. If it was marked worked on, it says "Worked on Monday · Continue today?"
2. **Anything else for today?** A few suggestions (see below).
3. **"N tasks for today · Start the day"** (Space), which goes to the main window.

Choices for a leftover item, left hand only. The letters mean the same as in the tree (T today, D pick a day, B backlog, X cancel), so there is one set of keys to learn:

| Key | Choice | Effect |
| --- | --- | --- |
| T | Today | Scheduled today, appended to the end of My Day |
| D | Another day | Opens the day picker: 1–9 = today up to 8 days out, or arrows then Enter; Esc closes |
| B | Backlog | Scheduled day cleared |
| X | Cancel | Status cancelled; kept in the tree history and the log |
| Z | Undo | Reverts the last choice |

For suggestions, the choices are T (add to today), D (another day), B (not today) and X (cancel the task).

Tasks already scheduled for today (for example added the night before) are not part of the review; they're already planned.

Each decision is applied right away (so a crash mid-review loses nothing) and recorded as an event so Z can undo it. Decided rows stay in the list, tinted by outcome: blue today, purple another day, grey backlog or not today, red cancelled.

**Suggestions, V1 rule (keep it simple and tune later):** up to 5 items from
- the first open, unscheduled leaf task in each project that had activity in the last 7 days ("next step, no day"), and
- Inbox tasks older than 7 days with no scheduled day.

## 5. Data model

SQLite, one file. WAL mode. All ids are short random strings (e.g. nanoid). Times are ISO 8601 UTC; dates are local `YYYY-MM-DD`.

```sql
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES tasks(id),   -- NULL = top level of its section
  section       TEXT NOT NULL CHECK (section IN ('inbox','projects')),
  position      TEXT NOT NULL,               -- fractional index among siblings
  title         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',    -- Markdown
  link          TEXT,                         -- file path, folder path or URL
  scheduled_on  TEXT,                         -- YYYY-MM-DD, NULL = backlog
  day_position  TEXT,                         -- fractional index within My Day for scheduled_on
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  closed_at     TEXT,                         -- when done/cancelled
  deleted_at    TEXT,                         -- soft delete; NULL = live
  collapsed     INTEGER NOT NULL DEFAULT 0,
  tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array, no UI in V1
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX tasks_parent ON tasks(parent_id, position);
CREATE INDEX tasks_day ON tasks(scheduled_on, day_position);

-- Today-scoped marks. At most one per task per day.
CREATE TABLE day_marks (
  date     TEXT NOT NULL,
  task_id  TEXT NOT NULL REFERENCES tasks(id),
  mark     TEXT NOT NULL CHECK (mark IN ('doing','worked')),
  PRIMARY KEY (date, task_id)
);

-- Append-only history. Feeds the daily logs, review undo and "worked on Monday".
CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL,
  date     TEXT NOT NULL,          -- local day it belongs to
  task_id  TEXT,
  kind     TEXT NOT NULL,          -- created | renamed | moved | scheduled | unscheduled
                                   -- | done | reopened | cancelled | doing | worked
                                   -- | deleted | restored
                                   -- | review_today | review_day | review_backlog | review_cancel
                                   -- | review_skip | review_undo
  data     TEXT NOT NULL DEFAULT '{}'  -- JSON: previous values, target date, etc.
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- schema_version, last_review_date, last_logged_date
```

Notes on the model:
- Ordering uses fractional indexing (the `fractional-indexing` npm package), so moving a task rewrites one row.
- Moving a task with children moves the subtree; children keep their parent.
- "Doing" is the `doing` day mark. Only one task can be doing at a time: setting it demotes the previous one to `worked` for today. Keep the rule in one place so it's a one-line change if that ever needs to relax.
- Delete is soft: it sets `deleted_at` on the task and its whole subtree, all with the same timestamp, and records one `deleted` event listing the ids. Restore clears `deleted_at` for exactly those ids. Rows are never physically removed in V1 because `events` and `day_marks` reference them. Every query excludes `deleted_at IS NOT NULL` rows; core exposes this as the default so it can't be forgotten.
- Hiding done tasks in the tree is a view rule (`closed_at` older than ~24 h and not "show completed"), not stored state.
- Undo for the review replays the `data` of the last review event.

## 6. Daily Markdown log

One file per day in `<data-dir>/logs/YYYY-MM-DD.md`. Written by the app, never parsed back in. Purpose: a self-contained record a person or AI can read years later, e.g. to summarise a year of work before a performance review.

When: once the morning review is finished (Start the day) or skipped, the app writes logs for every past day that has events and no log yet, then marks them frozen (`meta.last_logged_date`). Writing after the review means the "→" outcomes are known. If the review is interrupted (crash, closed tab), the logs are written at the next finish or skip; nothing is lost because all of it comes from events. The app doesn't need to be running at midnight. *(Order is the builder's call: the earlier draft wrote logs before the review, which contradicted the "→" outcomes.)* Later renames don't rewrite old logs; you see what a task was called back then.

Format:

```markdown
# 2026-11-09 · Monday

## Done
- [x] Review Jonas's PR on drift correction · Parity-readout calibration pipeline (#k3f9a2)

## Worked on
- [~] Write loader for HDF5 v2 files · Parity-readout › Port fit routines (#p2a1x7)

## Not done
- [ ] Update wiring diagram in the lab wiki · Fridge 3 › Milestone 2 (#m2c8d1) → moved to 2026-11-10
- [ ] Ask IT about VPN on the measurement PC · Inbox (#l6q0z3) → cancelled

## Added
- Order a spare SMA torque wrench · Inbox (#n7c2e9)
```

Every line has the title, the tree path at the time, and the task id, so it stands alone but can still be looked up. The "→" outcome is filled from the following morning's review when known. Tasks deleted before a log is written are left out of it; logs already written are never changed.

## 7. Architecture

```
daybreak/
  apps/
    web/        React + TypeScript + Vite. All UI: main window, review, pop-up, quick add.
    desktop/    Tauri 2 shell. Window chrome, tray, pop-up window, global shortcut, autostart.
  packages/
    core/       Domain logic + SQLite access. No UI, no HTTP. Fully unit-tested.
    server/     Hono HTTP API over core. Serves the built web UI too.
    cli/        `daybreak` command for humans and AI agents. Talks to the server.
```

Key decisions:
- **All logic lives in TypeScript** (`core` + `server`). Tauri's Rust side only does windowing, tray, shortcuts and launching the server. This keeps a future browser or NAS version a matter of running the server somewhere else.
- **Server runtime:** Bun, using `bun:sqlite`. Hono runs on it unchanged. Fallback if Bun causes trouble: Node 24 with the built-in `node:sqlite` (no native modules to bundle). `core` talks to SQLite through a thin adapter so switching is a one-file change.
- **How it runs on the work laptop:** from source. Clone the repo, `bun install`, then one start command (also a double-clickable `start.cmd`) builds the web UI if needed and starts the server; the UI is used in a browser tab at `http://127.0.0.1:47815`. No prebuilt or downloaded `.exe` in the MVP. A "Running on Windows" section in the README covers this.
- **Server binds to 127.0.0.1 only**, on a fixed port (default 47815, configurable), and requires a random token generated at first run (kept in the data folder). The UI and CLI read it from there.
- **Live updates:** server-sent events (`GET /events/stream`) so the main window, pop-up and CLI changes stay in sync.
- **What "today" is:** the server owns the date. A day starts at 04:00 local time (configurable as `dayStartsAt` in `config.json`), so working past midnight still counts as the same day. When the day rolls over, the server sends a `day_changed` SSE event; an open tab shows the morning review the next time it gets focus or input. Doing and Worked-on marks belong to the day they were set, so they lapse at rollover by construction. *(Builder's call.)*
- **Data folder:** `%LOCALAPPDATA%\Daybreak\` by default (`daybreak.db`, `logs\`, `token`, `config.json`), overridable with `DAYBREAK_DATA_DIR`. Never inside this repo. `.gitignore` covers `*.db` as a safety net.
- **Drag and drop:** `@dnd-kit/core` + `@dnd-kit/sortable`, sortable-tree pattern. Horizontal pointer offset picks depth, 22 px per level.
- **Markdown rendering** in notes: `marked` or `markdown-it` with HTML disabled. Editing is a plain textarea in V1.
- **Natural-language day input** in the day picker ("fri", "tomorrow", "nov 20"): a small hand-written parser in `core`, unit-tested. No big date library needed.
- **Tests:** Vitest for `core` and `server`. Vitest runs on Node, so tests use the `node:sqlite` side of the adapter (Node 24 needed on dev machines) and the app runs on `bun:sqlite`; both sides of the adapter get the same small smoke test. Playwright for a few UI flows later.

### HTTP API (V1)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/tree?completed=recent\|all\|none | Whole tree with statuses and today's marks |
| GET | /api/day/:date | My Day for a date, in day order, with paths |
| POST | /api/tasks | Create `{title, section, parentId?, after?, scheduledOn?}` |
| PATCH | /api/tasks/:id | Title, notes, link, status, collapsed, tags |
| DELETE | /api/tasks/:id | Soft-delete the task and its subtree; returns the deleted ids |
| POST | /api/tasks/:id/restore | Undo a delete (restores the same set of ids) |
| POST | /api/tasks/:id/move | `{parentId, section, beforeId?, afterId?}` |
| POST | /api/tasks/:id/schedule | `{date \| null, beforeId?, afterId?}` (date order) |
| POST | /api/tasks/:id/mark | `{mark: 'doing' \| 'worked' \| null}` for today |
| GET | /api/review/:date | Leftovers, suggestions, decisions so far |
| POST | /api/review/:date/decide | `{taskId, choice: 'today' \| 'day' \| 'backlog' \| 'cancel', date?}` |
| POST | /api/review/:date/undo | Undo last decision |
| POST | /api/review/:date/skip | Skip the review today |
| GET | /api/projects/:id/export.md | Project as a Markdown outline with ids (for agents) |
| GET | /events/stream | SSE change feed |

### CLI (after the UI)

```
daybreak list [--project <id|name>] [--today] [--json]
daybreak show <id>            # Markdown outline of a task and its subtree
daybreak add "<title>" [--under <id>] [--today | --on <date>] [--link <path>]
daybreak done <id> | daybreak worked <id> | daybreak cancel <id>
daybreak schedule <id> <date|today|none>
daybreak link <id> <path>
```

Output is Markdown by default and JSON with `--json`, since agents read Markdown well. A short `AGENTS.md` snippet will tell agents: "Tasks live in Daybreak. Use the `daybreak` CLI. When you finish a task, run `daybreak done <id>`, and also tick it in the linked doc."

Linked Markdown docs (long task descriptions) keep their own done/open state so they stay self-contained if Daybreak is ever abandoned. Agents update both places; a later hook or script can flag mismatches using the task id in each doc's header.

## 8. Windows integration (Tauri)

- Custom title bar with Windows-style minimise, maximise and close buttons (see DESIGN.md).
- **Quick add:** global shortcut Ctrl+Alt+Space via `tauri-plugin-global-shortcut` opens a small borderless window centred on screen. Enter adds and closes; Shift+Enter adds and stays open; Esc closes; Tab picks where to file it; Alt+T toggles "My Day" (on by default).
- **My Day pop-up:** a small window (380 × 560) that opens just above the taskbar, like the Windows 11 calendar flyout. V1 opens it from a **tray icon** (`tauri` tray API) with a badge for open items. The ideal is opening it from the pinned taskbar button itself; that needs window-activation tricks and is a stretch goal, not V1.
- Autostart at login (`tauri-plugin-autostart`), off by default.
- Single instance (`tauri-plugin-single-instance`).
- Avoid shipping an unsigned prebuilt `.exe` to the work laptop. Build the Tauri app on the laptop itself from source (needs the Rust toolchain and MSVC build tools; check those can be installed before starting this phase). The server can then run from source alongside it instead of as a compiled sidecar, or be compiled locally with `bun build --compile`. If none of that is allowed, keep using the browser version.

## 9. MVP build plan

Each phase should be usable on its own. Use seed data from the design (fictional lab tasks) on dev machines.

1. **Core and data.** Schema, migrations, tree operations (create, move with subtree, indent, outdent, reorder, soft delete and restore), scheduling, statuses and marks (one Doing at a time), completed-visibility rules, events. Unit tests for all of it. Seed script.
2. **Server.** Hono API above, token check, SSE. Integration tests against a temp DB.
3. **Main window in the browser.** Tree with the full keyboard model (navigate and edit modes, DESIGN.md "Keyboard map"), day column, drag to reorder and indent, My Day with its own order, drag from tree to My Day, inline add in My Day, delete with undo toast, task detail panel, show completed, light and dark themes. README section on running it on Windows.
4. **Morning review.** Running list, T/D/B/X/Z, day picker, suggestions, start the day, skip.
5. **Daily logs.** Writer, freezing, back-filling missed days.
6. **Tauri shell.** Built on the laptop from source (section 8); server alongside, title bar, tray with My Day pop-up, global quick add, single instance.
7. **CLI and agent docs.**

Definition of done for the MVP: phases 1–5 working in the browser on the work laptop, and used for real for a week before phase 6.

## 10. Decisions and open questions

Settled on 2026-11-08:

1. Cancel in the review (formerly "Drop", key F) marks the task cancelled, so the log stays complete. Key X, same as in the tree.
2. Only one task can be Doing at once; starting one demotes the previous to worked on.
3. When a parent is scheduled today, its children don't appear in My Day; only the parent, with its `done/total`. May revisit after real use.
4. Keys are consistent across screens: T today, D pick a day, B backlog, X cancel, S doing, W worked on, Space done, Z undo. The review uses T/D/B/X/Z.
5. The review doesn't include tasks already scheduled for today (e.g. added the night before).
7. Delete exists (Del), as a soft delete with an undo toast; see section 3.

Still open:

6. Suggestions rule (section 4) is a first guess. Tune after a week.
8. Check on the work laptop that the browser lets the page take Alt+← / Alt+→ (normally Back / Forward) once it has focus. If not, pick other collapse/expand keys.
