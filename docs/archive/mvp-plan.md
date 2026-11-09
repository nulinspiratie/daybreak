# Daybreak MVP Implementation Plan

> **Archived.** This plan is finished. Since it was written the docs moved: SPEC.md is now `docs/spec.md`, DESIGN.md is `docs/design.md`, SYNC.md became `docs/handoff.md`, since removed (its open items are in `context.md`) and `design/` is `docs/mockups/`. The text below still uses the old names.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phases 1–5 of SPEC.md section 9 (core, server, main window, morning review and daily logs), running from source in a browser tab on the Windows work laptop.

**Architecture:** This is a Bun-workspaces monorepo. `packages/core` holds all domain logic over SQLite: tree, scheduling, statuses, review and logs. It reaches SQLite through a two-driver adapter, `bun:sqlite` at runtime and `node:sqlite` under Vitest. `packages/server` is a Hono app over a single `Daybreak` facade from core. It does token and Host checks and sends an SSE change feed. It also serves the built `apps/web`, a React + Vite UI that refetches on SSE and sends mutations through a serial queue, so rapid keypresses apply in order.

**Tech Stack:** TypeScript (strict, ESM), Bun ≥ 1.2 (runtime, workspaces), Node ≥ 22.13 (tests only), Vitest, Hono, `fractional-indexing`, `nanoid`, React 19, Vite, `@tanstack/react-query`, `zustand`, `@dnd-kit/core` + `@dnd-kit/sortable`, `markdown-it`, `@testing-library/react` + `jsdom`.

**Spec:** [SPEC.md](../spec.md) (behaviour, data model, API) and [DESIGN.md](../design.md) (visuals, copy, key map; it wins on interaction details). Mock-ups are in `design/*.dc.html`. Where they disagree with DESIGN.md (old A/S/D/F keys, "Drop"), DESIGN.md wins. Read both before starting any task.

## Global Constraints

- Work data never enters the repo. The data dir is `DAYBREAK_DATA_DIR`, else `%LOCALAPPDATA%\Daybreak\`, else (on non-Windows dev machines) `$XDG_DATA_HOME/daybreak` or `~/.local/share/daybreak`. The server refuses to start if the resolved data dir is inside the repo.
- The data dir contains `daybreak.db`, `logs/`, `token` and `config.json`. `.gitignore` already covers `*.db`.
- The server binds `127.0.0.1` only. The default port is `47815`, configurable as `port` in `config.json`.
- The token is 32 random bytes, hex, created on first run in `<data-dir>/token`.
- No telemetry and no network calls at runtime. Fonts are system fonts, with no CDN.
- Ids are `nanoid` `customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)`, shown in logs as `#k3f9a2`.
- Times are ISO 8601 UTC strings. Dates are local `YYYY-MM-DD`.
- A day starts at `04:00` local time (`dayStartsAt` in `config.json`). "Today" is always computed by core from an injected clock, never with `new Date()` in UI code.
- Ordering uses fractional keys from `fractional-indexing` (`generateKeyBetween`). Every sibling or day query orders by `position, id` (or `day_position, id`).
- Soft delete: every core read excludes `deleted_at IS NOT NULL` unless a function says otherwise in its name (`…IncludingDeleted`).
- Markdown is rendered with `markdown-it` `{ html: false, linkify: true }`.
- Titles are single-line. Core's `normalizeTitle` trims the title and turns any run of `\r`/`\n`/tab into one space.
- Keys follow the DESIGN.md "Keyboard map". Mod is Ctrl on Windows and Linux, and Option (`altKey`) on macOS. Never bind Ctrl+N, Ctrl+1–9, Alt+← or Alt+→.
- UI copy is used verbatim from DESIGN.md where it is quoted there (empty state, toasts, placeholders, review headings).
- Theme colours come only from the DESIGN.md token table, as CSS variables. Text contrast must be ≥ 4.5:1.
- Real `<button>`, `<input>` and `<label>` elements, `aria-label` on icon-only buttons, and visible focus rings.
- Stay inside SPEC.md section 2. If something seems missing, add it to SPEC.md section 10 instead of building it.

## Review Focus

1. **Weekend gap.** If the app isn't opened Saturday or Sunday, Monday's review lists Friday's leftovers oldest first, and logs are written for every past day that has events (and only those). Test in Task 9 and Task 23.
2. **Rapid repeated keys.** Pressing Mod+↓ five times quickly moves the task exactly five slots, in order, with the selection following it. Test in Task 5 (core), Task 14 (mutation queue) and Task 16 (commands).
3. **Dropping a task into its own subtree** (by drag, or a crafted API call) is rejected with 400 and leaves the tree unchanged. Test in Task 5, Task 12 and Task 20.
4. **Pasted text with newlines, HTML or Markdown** in titles and notes: titles become one line, and notes never render raw HTML (`<img onerror>` shows as text). Test in Task 4, Task 17 and Task 21.
5. **Late night and DST.** At 01:30 the date is still yesterday's. `addDays` across the 2026-03-29 and 2026-10-25 DST changes gives the next calendar date. Test in Task 2.

## File Structure

```
package.json                 Bun workspaces root; scripts: dev, start, test, test:bun, typecheck, seed
tsconfig.base.json           strict ESM settings shared by all packages
vitest.config.ts             projects: packages/core, packages/server, apps/web; TZ=Europe/Copenhagen
start.cmd                    Windows double-click start
packages/core/src/
  index.ts                   public exports (createDaybreak, types, dates, errors, openDatabase)
  types.ts                   Task, TreeNode, TreeView, DayView, ReviewView, Mark, Status, Section, EventKind
  errors.ts                  DaybreakError(code: 'not_found' | 'invalid' | 'needs_confirmation', details?)
  ids.ts                     newId()
  clock.ts                   Clock, systemClock, fixedClock(iso) for tests
  dates.ts                   localDate, addDays, daysBetween, weekdayName, dayLabel, parseDayInput
  db/adapter.ts              Db interface + transaction()
  db/sqlite-node.ts          node:sqlite driver
  db/sqlite-bun.ts           bun:sqlite driver
  db/open.ts                 openDatabase(path) picks the driver; enables WAL + foreign_keys
  db/migrations.ts           migrate(db); schema v1 (SPEC §5 + deleted_at)
  ctx.ts                     Ctx = { db, clock, config }, today(ctx)
  events.ts                  recordEvent, eventsOn, lastEvent
  tasks/rows.ts              row <-> Task mapping, getTask, liveChildren, liveDescendants, pathOf
  tasks/create.ts            createTask, updateTask, normalizeTitle
  tasks/positions.ts         positionFor(siblings, {afterId, beforeId})
  tasks/move.ts              moveTask, indent, outdent, moveUp, moveDown
  tasks/status.ts            setStatus (close with subtree, reopen exactly those)
  tasks/marks.ts             setMark (one Doing), marksOn
  tasks/schedule.ts          schedule, dayView, dayCounts
  tasks/delete.ts            softDelete, restore
  tasks/tree.ts              treeView (visibility rules, counts)
  review.ts                  reviewView, decide, undoDecision, skipReview, finishReview, needsReview
  log.ts                     buildDayLog, writeMissingLogs
  export.ts                  exportProject (Markdown outline)
  service.ts                 createDaybreak(deps): Daybreak facade (transactions + onChange)
  seed.ts                    seed(daybreak) with the fictional lab data
packages/core/test/          one *.test.ts per src module; sqlite-bun.smoke.ts (bun:test)
packages/server/src/
  paths.ts                   resolveDataDir, assertOutsideRepo, loadConfig, loadOrCreateToken
  app.ts                     createApp({ daybreak, token, port, webDist? }): Hono
  auth.ts                    host + token middleware, cookie on index.html
  errors.ts                  DaybreakError -> HTTP status
  sse.ts                     ChangeBroker; GET /events/stream
  routes/tasks.ts, routes/day.ts, routes/review.ts, routes/misc.ts
  openLink.ts                open a stored link with the OS default handler
  rollover.ts                day-change ticker
  main.ts                    entry: wire everything, Bun.serve
packages/server/test/        *.test.ts using app.request()
apps/web/
  index.html, vite.config.ts (dev proxy to 47815 with token header)
  src/main.tsx, App.tsx
  src/api/client.ts, queue.ts, hooks.ts, sse.ts
  src/theme/tokens.css, global.css
  src/shell/TitleBar.tsx, KeyHints.tsx, Toast.tsx, toastStore.ts
  src/ui/store.ts            zustand: pane, selection, editing, draft, confirm, detail, theme
  src/keyboard/platform.ts, keymap.ts, commands.ts, useKeyboard.ts
  src/tree/flatten.ts, TreePane.tsx, TreeRow.tsx, DayCell.tsx, RowCheckbox.tsx, TitleEditor.tsx
  src/tree/projectDrop.ts, Dnd.tsx
  src/myday/MyDayPane.tsx, DayRow.tsx, AddField.tsx
  src/picker/dayGrid.ts, DayPicker.tsx
  src/detail/DetailPanel.tsx, Markdown.tsx
  src/review/ReviewScreen.tsx, ReviewCard.tsx, reviewKeys.ts
apps/web/test/               pure-module tests + a few Testing Library tests
```

`SPEC.md` §7 API table and `README.md` get updated in the tasks that change them.

---

# Phase 1: Core and data

### Task 1: Workspace, SQLite adapter, schema

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/db/{adapter,sqlite-node,sqlite-bun,open,migrations}.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/db.test.ts`, `packages/core/test/sqlite-bun.smoke.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RunResult { changes: number }
  interface Db {
    exec(sql: string): void
    run(sql: string, ...params: SqlValue[]): RunResult
    get<T>(sql: string, ...params: SqlValue[]): T | undefined
    all<T>(sql: string, ...params: SqlValue[]): T[]
    close(): void
  }
  type SqlValue = string | number | null
  function transaction<T>(db: Db, fn: () => T): T          // BEGIN IMMEDIATE / COMMIT / ROLLBACK; nested calls join the outer one
  function openDatabase(path: string | ':memory:'): Promise<Db>
  function migrate(db: Db): void                            // idempotent; sets meta.schema_version = '1'
  ```

- [ ] **Step 1: Scaffold the workspace.** Root `package.json` with `"private": true`, `"type": "module"`, `"workspaces": ["packages/*", "apps/*"]` and scripts:
  - `"test": "vitest run"`
  - `"test:bun": "bun test packages/core/test/sqlite-bun.smoke.ts"`
  - `"typecheck": "tsc -b"`

  `vitest.config.ts` uses `test.projects` for the three packages and sets `process.env.TZ = 'Europe/Copenhagen'` at the top of the file.
- [ ] **Step 2: Write the failing tests** in `db.test.ts`:
  - `migrate creates tasks, day_marks, events, meta`: assert `sqlite_master` contains those four tables plus the indexes `tasks_parent` and `tasks_day`.
  - `migrate is idempotent`: call it twice; `meta.schema_version === '1'`.
  - `tasks has deleted_at`: `PRAGMA table_info(tasks)` includes `deleted_at`.
  - `transaction rolls back on throw`: inserting into `meta` inside a throwing `transaction` leaves no row.
  - `nested transaction joins outer`: inner throw rolls back the outer insert too.
  - `file database uses WAL`: open a temp file path; `PRAGMA journal_mode` returns `wal`.
- [ ] **Step 3: Run `bun run test`**. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement.**
  - The schema is SPEC.md §5 verbatim plus `deleted_at TEXT` after `closed_at`.
  - `openDatabase` checks `typeof Bun !== 'undefined'` and loads `./sqlite-bun.js` or `./sqlite-node.js` with `await import(/* @vite-ignore */ specifier)` held in a variable, so Vite never tries to resolve `bun:sqlite`.
  - Both drivers run `PRAGMA journal_mode = WAL` (file DBs) and `PRAGMA foreign_keys = ON`.
- [ ] **Step 5: Write `sqlite-bun.smoke.ts`** with `bun:test`: open `:memory:`, migrate, insert and read back a `meta` row.
- [ ] **Step 6: Run `bun run test` and `bun run test:bun`**. Expected: both PASS.
- [ ] **Step 7: Commit** `feat(core): workspace, sqlite adapter and schema v1`.

### Task 2: Clock and dates

**Files:**
- Create: `packages/core/src/clock.ts`, `packages/core/src/dates.ts`
- Test: `packages/core/test/dates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Clock { now(): Date }
  const systemClock: Clock
  function fixedClock(iso: string): Clock & { set(iso: string): void }
  type ISODate = string
  function localDate(now: Date, dayStartsAt: string /* "HH:MM" */): ISODate
  function addDays(date: ISODate, n: number): ISODate        // calendar arithmetic, DST-safe
  function daysBetween(a: ISODate, b: ISODate): number       // b - a in whole days
  function weekdayName(date: ISODate, style: 'long' | 'short'): string   // "Monday" / "Mon"
  function dayLabel(date: ISODate, today: ISODate):
    { text: string; kind: 'overdue' | 'today' | 'week' | 'later'; fade: number }
  function parseDayInput(input: string, today: ISODate): ISODate | null
  ```

- [ ] **Step 1: Write the failing tests** (`TZ=Europe/Copenhagen`):
  - `localDate`:
    - `2026-11-10T00:30:00Z` with `"04:00"` gives `'2026-11-09'` (01:30 local).
    - `2026-11-10T03:30:00Z` gives `'2026-11-10'`.
    - With `"00:00"`, `2026-11-09T23:30:00Z` gives `'2026-11-10'`.
  - `addDays`:
    - `('2026-03-28', 1)` gives `'2026-03-29'`.
    - `('2026-03-29', 1)` gives `'2026-03-30'`.
    - `('2026-10-24', 2)` gives `'2026-10-26'`.
    - `('2026-12-31', 1)` gives `'2027-01-01'`.
    - `('2026-11-10', -1)` gives `'2026-11-09'`.
  - `daysBetween('2026-11-06','2026-11-10') === 4`.
  - `dayLabel` with today `2026-11-10` (Tuesday):
    - `2026-11-06` gives `{text:'6 Nov', kind:'overdue'}`.
    - `2026-11-10` gives `{text:'Today', kind:'today'}`.
    - `2026-11-11` gives `{text:'Wed', kind:'week', fade:0}`.
    - `2026-11-16` gives `{text:'Mon', kind:'week'}` (6 days out).
    - `2026-11-17` gives `{text:'17 Nov', kind:'later'}`.
    - `fade` is `min(1, (days-1)/13)`: 0 at +1, 1 at +14, 1 at +30.
  - `parseDayInput` with today `2026-11-10` (Tue):
    - `'today'` gives `'2026-11-10'`, and `'tomorrow'` and `'tom'` give `'2026-11-11'`.
    - `'fri'` and `'friday'` give `'2026-11-13'`.
    - `'tue'` gives `'2026-11-17'` (the next one, never today).
    - `'nov 20'`, `'20 nov'` and `'20 november'` give `'2026-11-20'`.
    - `'jan 5'` gives `'2027-01-05'` (a past month rolls to next year).
    - `'2026-12-01'` passes through.
    - `''` and `'blah'` give `null`. Input is case-insensitive.
- [ ] **Step 2: Run** `bun run test packages/core/test/dates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `localDate`: subtract the `dayStartsAt` offset from `now`, then read the local Y/M/D.
  - `addDays`: build `new Date(y, m-1, d + n)` at local noon and read Y/M/D (noon avoids DST edges).
  - `weekdayName` and the month names are fixed English arrays; don't use `Intl` with the locale.
- [ ] **Step 4: Run the tests**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): clock and date helpers`.

### Task 3: Context, events, ids, errors, types

**Files:**
- Create: `packages/core/src/{types,errors,ids,ctx,events}.ts`
- Test: `packages/core/test/events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Section = 'inbox' | 'projects'; type Status = 'open' | 'done' | 'cancelled'; type Mark = 'doing' | 'worked'
  type EventKind = 'created' | 'renamed' | 'moved' | 'scheduled' | 'unscheduled' | 'done' | 'reopened'
    | 'cancelled' | 'doing' | 'worked' | 'deleted' | 'restored'
    | 'review_today' | 'review_day' | 'review_backlog' | 'review_cancel' | 'review_skip' | 'review_undo'
  interface Task { id: string; parentId: string | null; section: Section; position: string; title: string;
    notes: string; link: string | null; scheduledOn: ISODate | null; dayPosition: string | null;
    status: Status; closedAt: string | null; deletedAt: string | null; collapsed: boolean;
    tags: string[]; createdAt: string; updatedAt: string }
  interface Config { dayStartsAt: string }
  interface Ctx { db: Db; clock: Clock; config: Config }
  function today(ctx: Ctx): ISODate
  function nowIso(ctx: Ctx): string
  class DaybreakError extends Error { code: 'not_found' | 'invalid' | 'needs_confirmation'; details?: Record<string, unknown> }
  function newId(): string
  interface EventRow { id: number; at: string; date: ISODate; taskId: string | null; kind: EventKind; data: any }
  function recordEvent(ctx: Ctx, kind: EventKind, taskId: string | null, data?: object): EventRow  // date = today(ctx)
  function eventsOn(ctx: Ctx, date: ISODate): EventRow[]         // ordered by id
  function eventsSince(ctx: Ctx, date: ISODate): EventRow[]      // date >= given
  ```

- [ ] **Step 1: Write the failing tests:**
  - `recordEvent stamps at and the 04:00-shifted date`: clock `2026-11-10T01:00:00Z` (02:00 local) gives `date === '2026-11-09'`.
  - `data round-trips as JSON`.
  - `eventsOn returns only that date in id order`.
  - `newId matches /^[0-9a-z]{6}$/`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): context, events, ids and types`.

### Task 4: Create, update, tree view

**Files:**
- Create: `packages/core/src/tasks/{rows,create,positions,tree}.ts`
- Test: `packages/core/test/tasks-create.test.ts`, `packages/core/test/tree-view.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  ```ts
  function getTask(ctx: Ctx, id: string): Task                       // throws not_found (also for deleted)
  function liveChildren(ctx: Ctx, parentId: string | null, section: Section): Task[]  // ordered
  function liveDescendants(ctx: Ctx, id: string): Task[]              // depth-first, ordered
  function pathOf(ctx: Ctx, id: string): string[]                     // ancestor titles, root first; Inbox tasks: ['Inbox']
  function positionFor(siblings: Task[], at: { afterId?: string; beforeId?: string }): string  // neither = end
  function normalizeTitle(raw: string): string
  interface CreateInput { title: string; section: Section; parentId?: string | null; afterId?: string;
    beforeId?: string; scheduledOn?: ISODate | null }
  function createTask(ctx: Ctx, input: CreateInput): Task          // event 'created' {title, section, parentId}
  interface TaskPatch { title?: string; notes?: string; link?: string | null; collapsed?: boolean; tags?: string[] }
  function updateTask(ctx: Ctx, id: string, patch: TaskPatch): Task // event 'renamed' {from,to} only when title changes
  interface TreeNode extends Task { children: TreeNode[]; mark: Mark | null; doneCount: number; totalCount: number }
  interface TreeView { today: ISODate; inbox: TreeNode[]; projects: TreeNode[]; hiddenCompletedCount: number }
  function treeView(ctx: Ctx, completed: 'recent' | 'all' | 'none'): TreeView
  ```

- [ ] **Step 1: Write the failing tests** (`tasks-create.test.ts`):
  - `creates at end of siblings`: three creates come back in creation order.
  - `afterId inserts right after`. `beforeId inserts right before`.
  - `title is normalized`: `'  a\n\nb\tc  '` becomes `'a b c'`.
  - `empty title after normalize is invalid`.
  - `inbox is flat`: a create in `inbox` with a `parentId` throws `invalid`.
  - `parentId must be a live task in projects`: a deleted or missing parent throws `not_found`.
  - `scheduledOn sets day_position at end of that day`.
  - `renamed event only on title change`.
  - `link and notes stored verbatim`: notes `'<img src=x onerror=alert(1)>'` round-trips unchanged (rendering is the UI's job).
  - `pathOf`: Inbox task gives `['Inbox']`. "Install TWPA…" under "Fridge 3 readout upgrade › Milestone 2 — Install and cooldown" gives those two titles.
- [ ] **Step 2: Write the failing tests** (`tree-view.test.ts`), with `fixedClock` set to `2026-11-10T09:00:00Z`:
  - `done/total counts every descendant, cancelled excluded from both`: a parent with 3 descendants (1 done, 1 cancelled, 1 open) gives `doneCount 1, totalCount 2`.
  - `recent hides tasks closed more than 24 h ago`. One closed 23 h ago is visible. `hiddenCompletedCount` counts the hidden ones.
  - `a closed task stays visible while any descendant is open`.
  - `all shows everything closed`. `none hides every closed task`.
  - `deleted tasks never appear and are not counted`.
  - `mark is today's day mark` (from `day_marks` for `today(ctx)`, `null` otherwise).
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `positionFor` uses `generateKeyBetween(prev?.position ?? null, next?.position ?? null)`.
  - `treeView` loads all live tasks in one query and builds the nodes in memory.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): create, update and tree view`.

### Task 5: Moving tasks

**Files:**
- Create: `packages/core/src/tasks/move.ts`
- Test: `packages/core/test/move.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  ```ts
  interface MoveTarget { parentId: string | null; section: Section; afterId?: string; beforeId?: string }
  function moveTask(ctx: Ctx, id: string, to: MoveTarget): Task   // event 'moved' {from:{parentId,section,position}, to:{…}}
  function indent(ctx: Ctx, id: string): Task                    // no-op returns task unchanged
  function outdent(ctx: Ctx, id: string): Task
  function moveUp(ctx: Ctx, id: string): Task
  function moveDown(ctx: Ctx, id: string): Task
  ```

The rules are in DESIGN.md "Moving with Mod+↑↓" and SPEC.md §3. Each test builds a small tree with a helper `build(ctx, outline)` in `test/helpers.ts`. It takes an indented string, so `"projects:\n  A\n    A1\n    A2\n  B\n    B1\ninbox:\n  i1\n  i2"`, and returns a `{ [title]: id }` map. A second helper `outline(ctx)` renders the live tree back in the same format, so tests assert on whole-tree strings.

- [ ] **Step 1: Write the failing tests:**
  - `moveTask carries the subtree`: A moved after B keeps A1 and A2 under A.
  - `moveTask rejects own descendant` (Review Focus 3): A moved under A1 throws `invalid` and `outline` is unchanged. Moving A under A itself also throws.
  - `moveTask into inbox requires no children and parentId null`.
  - `moveTask from inbox to projects updates section`.
  - `indent makes it the last child of the previous sibling and expands that sibling`: B indents under A, after A2. A becomes `collapsed=false`.
  - `indent with no previous sibling is a no-op`. `indent in inbox is a no-op`.
  - `outdent places it right after its parent`: A2 outdented lands between A and B. Top-level is a no-op.
  - `moveUp swaps with previous sibling`: A2 up gives A2, A1.
  - `moveUp from first child becomes last child of parent's previous sibling`: B1 up becomes A's last child (after A2), and A is expanded.
  - `moveUp with no such branch is a no-op`: A1 up when A is the first project.
  - `moveDown mirrors`: A2 down becomes B's first child (before B1).
  - `first top-level project moves up to the end of Inbox only if childless`: A (with children) up is a no-op. A childless project C moved to first, then up, lands after i2.
  - `last Inbox task moves down to the first top-level project`.
  - `last top-level project moveDown is a no-op`.
  - `five rapid moveDown calls move exactly five slots` (core half of Review Focus 2).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** All functions resolve to a `MoveTarget` and call `moveTask`, so the cycle and Inbox checks live in one place. Auto-expanding a branch is part of the same transaction and doesn't record an event.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): tree moves, indent, outdent, Logseq-style up/down`.

### Task 6: Scheduling and My Day

**Files:**
- Create: `packages/core/src/tasks/schedule.ts`
- Test: `packages/core/test/schedule.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces:
  ```ts
  function schedule(ctx: Ctx, id: string, date: ISODate | null, at?: { afterId?: string; beforeId?: string }): Task
  function scheduleToday(ctx: Ctx, id: string): Task    // append; no-op if already today
  interface DayItem { task: Task; path: string[]; mark: Mark | null; doneCount: number; totalCount: number }
  interface DayView { date: ISODate; items: DayItem[]; doneCount: number; totalCount: number }
  function dayView(ctx: Ctx, date: ISODate): DayView
  function dayCounts(ctx: Ctx, from: ISODate, to: ISODate): Record<ISODate, number>  // open tasks per day
  ```

- [ ] **Step 1: Write the failing tests:**
  - `schedule appends to the end of that day`.
  - `afterId and beforeId position within the day` (positions come from tasks on the same date).
  - `schedule null clears scheduled_on and day_position`. Event `unscheduled {from}`.
  - `rescheduling to the same day with a position only reorders`.
  - `scheduled event has {from, to}`.
  - `dayView lists in day order with paths and today's marks`.
  - `done stays listed`. `doneCount` and `totalCount` exclude cancelled (cancelled is listed but not counted).
  - `a parent scheduled today shows alone with done/total of its subtree`. Its children don't appear unless they're scheduled themselves.
  - `deleted tasks are excluded`.
  - `dayCounts counts open live tasks per date in range`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): scheduling and My Day`.

### Task 7: Statuses and day marks

**Files:**
- Create: `packages/core/src/tasks/status.ts`, `packages/core/src/tasks/marks.ts`
- Test: `packages/core/test/status.test.ts`, `packages/core/test/marks.test.ts`

**Interfaces:**
- Consumes: Task 4, and `scheduleToday` from Task 6 (used by `setMark`).
- Produces:
  ```ts
  function setStatus(ctx: Ctx, id: string, status: Status, opts?: { withOpenDescendants?: boolean }):
    { task: Task; changedIds: string[] }
  function setMark(ctx: Ctx, id: string, mark: Mark | null): void
  function marksOn(ctx: Ctx, date: ISODate): Map<string, Mark>
  function lastWorkedBefore(ctx: Ctx, id: string, date: ISODate): ISODate | null
  ```

- [ ] **Step 1: Write the failing tests** (`status.test.ts`):
  - `closing a leaf sets status and closed_at`. Event `done` has `data.closedIds = [id]`.
  - `closing a task with open descendants without the flag throws needs_confirmation` with `details.openCount === 4` (the count of open live descendants).
  - `closing with withOpenDescendants closes it and only its open descendants`. Already-done or cancelled descendants are untouched.
  - `reopen restores exactly the ids closed with it`: close the parent (closing 4), then reopen the parent. Those 4 are open again. A child closed earlier on its own stays done.
  - `reopen of a task closed on its own reopens only it`.
  - `done on a cancelled task switches only that task to done`.
  - `closing clears today's day mark` for every closed id.
  - `finishing the last open child does not close the parent`.
- [ ] **Step 2: Write the failing tests** (`marks.test.ts`):
  - `only one doing`: S on A then S on B leaves A `worked` today and B `doing`.
  - `doing or worked on a task not scheduled today schedules it today at the end of My Day`.
  - `doing again on the doing task clears it`: `setMark(id,'doing')` when already doing gives `null`. Same for `worked`.
  - `marks are per day`: after the clock moves to the next day, `marksOn(today)` is empty and yesterday's mark still exists.
  - `setMark on a closed task throws invalid`.
  - `lastWorkedBefore` returns the latest date before the given date that has a `worked` mark.
  - Events `doing` and `worked` are recorded with `{date}`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Keep the one-Doing rule in a single `const SINGLE_DOING = true` branch in `marks.ts`. Reopen looks up the most recent `done` or `cancelled` event with `task_id = id`, reads `data.closedIds`, and reopens those that are still closed and live.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): statuses with subtree close, one-doing marks`.

### Task 8: Soft delete and restore

**Files:**
- Create: `packages/core/src/tasks/delete.ts`
- Test: `packages/core/test/delete.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function softDelete(ctx: Ctx, id: string): { deletedIds: string[] }   // task + live subtree, same timestamp; event 'deleted' {ids}
  function restore(ctx: Ctx, id: string): { restoredIds: string[] }     // from the latest 'deleted' event of id; event 'restored' {ids}
  ```

- [ ] **Step 1: Write the failing tests:**
  - `deletes the subtree with one timestamp`.
  - `deleted tasks vanish from treeView, dayView, getTask and children`.
  - `restore brings back exactly that set at the same positions`: `outline` matches the outline before the delete.
  - `restore does not resurrect a child deleted separately earlier`.
  - `restore of a task that was never deleted throws invalid`.
  - `a deleted Doing task no longer shows in dayView`, and after restore it shows again with its mark.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): soft delete and restore`.

### Task 9: Review logic

**Files:**
- Create: `packages/core/src/review.ts`
- Test: `packages/core/test/review.test.ts`

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces:
  ```ts
  type ReviewChoice = 'today' | 'day' | 'backlog' | 'cancel'
  interface ReviewItem { task: Task; path: string[]; group: 'leftover' | 'suggestion';
    decision: { choice: ReviewChoice; date?: ISODate } | null; workedOn: ISODate | null; scheduledOn: ISODate | null }
  interface ReviewView { date: ISODate; leftovers: ReviewItem[]; suggestions: ReviewItem[];
    sortedCount: number; totalCount: number; todayCount: number; finished: boolean; skipped: boolean }
  function reviewView(ctx: Ctx, date: ISODate): ReviewView
  function decide(ctx: Ctx, date: ISODate, taskId: string, choice: ReviewChoice, targetDate?: ISODate): ReviewView
  function undoDecision(ctx: Ctx, date: ISODate): ReviewView
  function skipReview(ctx: Ctx, date: ISODate): void       // event review_skip; meta.last_review_date = date
  function finishReview(ctx: Ctx, date: ISODate): void     // meta.last_review_date = date
  function needsReview(ctx: Ctx): boolean                  // last_review_date !== today && there is anything to review
  ```

Rules: SPEC.md §4 plus decisions 4 and 5 of §10.
- **Leftovers** are open live tasks with `scheduled_on < date`, ordered by `scheduled_on`, then `day_position`, then `id`. Leftovers already decided on `date` keep their place: they're rebuilt from the decision events and listed first, in decision order.
- **Suggestions** are capped at 5, counting already-decided ones:
  - First, for each top-level project in tree order that has any event in its subtree within the last 7 days (`date >= addDays(date,-7)`), its first open, unscheduled live leaf in depth-first order. A leaf here is a task with no open live children.
  - Then Inbox tasks that are open, unscheduled, and created more than 7 days ago, oldest first.
  - Suggestions never include leftovers.
- **Decision events** carry `data = { reviewDate, group, previous: { scheduledOn, dayPosition, status, closedAt }, to? }`.
  - `today` calls `scheduleToday`.
  - `day` calls `schedule(id, targetDate)`.
  - `backlog` on a leftover sets `schedule(id, null)`. On a suggestion ("not today") it changes no task data.
  - `cancel` calls `setStatus(id,'cancelled',{withOpenDescendants:true})`.
- **Undo** finds the latest decision event of `date` that hasn't been undone, restores `previous`, and records `review_undo {undoneEventId}`. It works after a restart, since it reads only events.
- **`workedOn`** is `lastWorkedBefore(id, date)`.

- [ ] **Step 1: Write the failing tests:**
  - `leftovers are open tasks scheduled before today, oldest first`.
  - `tasks scheduled for today are not in the review` (decision 5).
  - `weekend gap` (Review Focus 1): tasks on Fri 2026-11-06 and Thu 2026-11-05, reviewed Mon 2026-11-09, list Thu first then Fri.
  - `decide today appends to My Day and the row stays in leftovers with decision`.
  - `decide day requires targetDate` (otherwise `invalid`).
  - `decide backlog on a suggestion does not touch the task`.
  - `decide cancel cancels with open descendants`.
  - `undo reverts the last decision only, repeatedly`.
  - `undo survives a new service instance on the same db`.
  - `sortedCount and totalCount`; `todayCount = dayView(date).totalCount`.
  - `workedOn reports the Monday mark` for a task marked worked on 2026-11-09 and reviewed 2026-11-10.
  - Suggestions:
    - A project with an event 3 days ago yields its first open unscheduled leaf.
    - A project idle for 8 days yields nothing.
    - An Inbox task 8 days old yields; 6 days old doesn't.
    - The cap is 5.
  - `needsReview false after skip or finish, true again next day when there are leftovers`.
  - `needsReview false when there is nothing to review`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): morning review logic`.

### Task 10: Service facade, export, seed

**Files:**
- Create: `packages/core/src/service.ts`, `packages/core/src/export.ts`, `packages/core/src/seed.ts`; finish `packages/core/src/index.ts`
- Create: `scripts/seed.ts` (root script `"seed": "bun scripts/seed.ts"`)
- Test: `packages/core/test/service.test.ts`, `packages/core/test/export.test.ts`

**Interfaces:**
- Consumes: everything in Phase 1.
- Produces (the only surface the server uses):
  ```ts
  interface DaybreakDeps { db: Db; clock: Clock; config: Config; logsDir?: string }
  type ChangeEvent = { type: 'changed' }
  interface Daybreak {
    today(): ISODate
    tree(completed?: 'recent' | 'all' | 'none'): TreeView
    day(date: ISODate): DayView
    dayCounts(from: ISODate, to: ISODate): Record<ISODate, number>
    getTask(id: string): Task
    create(input: CreateInput): Task
    update(id: string, patch: TaskPatch): Task
    move(id: string, to: MoveTarget): Task
    nudge(id: string, direction: 'up' | 'down' | 'indent' | 'outdent'): Task
    setStatus(id: string, status: Status, opts?: { withOpenDescendants?: boolean }): { task: Task; changedIds: string[] }
    setMark(id: string, mark: Mark | null): void
    schedule(id: string, date: ISODate | null, at?: { afterId?: string; beforeId?: string }): Task
    delete(id: string): { deletedIds: string[] }
    restore(id: string): { restoredIds: string[] }
    review(date: ISODate): ReviewView
    decide(date: ISODate, taskId: string, choice: ReviewChoice, targetDate?: ISODate): ReviewView
    undoDecision(date: ISODate): ReviewView
    skipReview(date: ISODate): void
    finishReview(date: ISODate): void
    needsReview(): boolean
    autoFinishEmptyReview(): void        // if !needsReview() and last_review_date !== today: finishReview(today)
    exportProject(id: string): string
    onChange(listener: (e: ChangeEvent) => void): () => void
  }
  function createDaybreak(deps: DaybreakDeps): Daybreak
  function seed(d: Daybreak): void
  ```

- [ ] **Step 1: Write the failing tests:**
  - `each mutation runs in one transaction`: a `move` that throws partway leaves no `moved` event.
  - `onChange fires once per successful mutation and never for reads or failed mutations`.
  - `unsubscribe stops notifications`.
  - `exportProject` on the seeded "Fridge 3 readout upgrade" starts `# Fridge 3 readout upgrade (#<id>)`. Children are lines like `- [ ] Order replacement coax lines (#<id>) · Today`, indented 2 spaces per level. The markers are `[x]` done, `[-]` cancelled and `[ ]` open. A task's notes follow as indented lines under its item.
  - `seed creates the Inbox and three projects from design/Main.dc.html`. Transcribe every `title:` from that file's data, in order and nested as shown there. Use "Hiring: lab engineer" as a fourth project. Some items are scheduled relative to `today()`: two overdue, four today with one doing, a few later this week.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Each mutating method is `transaction(db, () => fn(ctx, …))`, followed by emitting `{type:'changed'}`.
- [ ] **Step 4: Run them.** Expected: PASS. `bun run typecheck` is clean.
- [ ] **Step 5: Commit** `feat(core): service facade, export and seed data`.

---

# Phase 2: Server

### Task 11: Data dir, config, token, auth, app skeleton

**Files:**
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/{paths,app,auth,errors}.ts`
- Test: `packages/server/test/paths.test.ts`, `packages/server/test/auth.test.ts`, `packages/server/test/helpers.ts`

**Interfaces:**
- Consumes: `createDaybreak`, `openDatabase`, `migrate`, `fixedClock`, `DaybreakError`.
- Produces:
  ```ts
  function resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string
  function assertOutsideRepo(dataDir: string, repoRoot: string): void           // throws Error with a clear message
  interface ServerConfig { port: number; dayStartsAt: string }
  function loadConfig(dataDir: string): ServerConfig                           // writes defaults {port:47815, dayStartsAt:'04:00'} if missing
  function loadOrCreateToken(dataDir: string): string
  interface AppDeps { daybreak: Daybreak; token: string; port: number; webDist?: string }
  function createApp(deps: AppDeps): Hono
  // test helper:
  function testApp(opts?: { now?: string; seed?: boolean }): Promise<{ app: Hono; daybreak: Daybreak; clock: ReturnType<typeof fixedClock>; req: (path: string, init?: RequestInit) => Promise<Response> }>
  ```

Auth rules:
- Every `/api/*` and `/events/*` request needs a `Host` header equal to `127.0.0.1:<port>` or `localhost:<port>`, otherwise 403.
- It also needs `Authorization: Bearer <token>` or the cookie `daybreak_token=<token>`, otherwise 401.
- Serving `/` (index.html) with a valid Host sets that cookie: `HttpOnly; SameSite=Strict; Path=/`.
- Errors map as `not_found` → 404, `invalid` → 400 and `needs_confirmation` → 409, all with body `{ error: code, message, details? }`.

- [ ] **Step 1: Write the failing tests** (`paths.test.ts`):
  - `DAYBREAK_DATA_DIR wins`.
  - `win32 uses LOCALAPPDATA\Daybreak`.
  - `linux uses XDG_DATA_HOME/daybreak, else ~/.local/share/daybreak`.
  - `assertOutsideRepo throws for <repo>/data and passes for a sibling dir`.
  - `config defaults are written once`.
  - `token is 64 hex chars and stable across calls`.
- [ ] **Step 2: Write the failing tests** (`auth.test.ts`):
  - `403 on foreign Host` (`evil.example:47815`).
  - `401 without token`.
  - `200 with Bearer`.
  - `200 with cookie`.
  - `GET / sets the HttpOnly SameSite=Strict cookie`.
  - `DaybreakError maps to status and JSON body`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** `testApp` uses an in-memory DB and `fixedClock(opts.now ?? '2026-11-10T09:00:00Z')`, and sends the right Host and Bearer by default.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): data dir, config, token and auth`.

### Task 12: Task, day and review routes

**Files:**
- Create: `packages/server/src/routes/{tasks,day,review,misc}.ts`, `packages/server/src/openLink.ts`
- Modify: `packages/server/src/app.ts` (mount the routes), `SPEC.md` §7 API table (add the routes marked *new*)
- Test: `packages/server/test/routes.test.ts`, `packages/server/test/openLink.test.ts`

**Interfaces:**
- Consumes: `Daybreak` (Task 10).
- Produces, as HTTP. The JSON bodies are the core types as-is. Mutations return the changed `Task`, or the result object of the core call:

| Method | Path | Core call |
| --- | --- | --- |
| GET | `/api/status` *(new)* | `{ today, needsReview, dayStartsAt }` |
| GET | `/api/tree?completed=` | `tree()` |
| GET | `/api/day/:date` | `day()` |
| GET | `/api/days?from=&to=` *(new)* | `dayCounts()` |
| POST | `/api/tasks` | `create()` |
| PATCH | `/api/tasks/:id` | `update()` for title, notes, link, collapsed, tags. A `status` field calls `setStatus` with `withOpenDescendants` from the body |
| POST | `/api/tasks/:id/move` | `move()` |
| POST | `/api/tasks/:id/nudge` *(new)* | `{direction}` → `nudge()` |
| POST | `/api/tasks/:id/schedule` | `{date, afterId?, beforeId?}` → `schedule()` |
| POST | `/api/tasks/:id/mark` | `setMark()` |
| DELETE | `/api/tasks/:id` | `delete()` |
| POST | `/api/tasks/:id/restore` | `restore()` |
| POST | `/api/tasks/:id/open-link` *(new)* | `openLink(task.link)`, 204 |
| GET | `/api/review/:date` | `review()` |
| POST | `/api/review/:date/decide` | `decide()` |
| POST | `/api/review/:date/undo` | `undoDecision()` |
| POST | `/api/review/:date/skip` | `skipReview()` |
| POST | `/api/review/:date/finish` *(new)* | `finishReview()` |
| GET | `/api/projects/:id/export.md` | `exportProject()`, `text/markdown` |

  ```ts
  function openLink(link: string, platform?: NodeJS.Platform, spawnFn?: typeof spawn): void
  // win32: spawn('explorer.exe', [link]); darwin: spawn('open', [link]); else spawn('xdg-open', [link]); never via a shell
  ```

- [ ] **Step 1: Write the failing tests** (`routes.test.ts`, against `testApp({seed:true})`):
  - One happy-path test per row in the table.
  - `invalid date param gives 400` (`/api/day/2026-13-01`).
  - `PATCH status done on a parent with open children gives 409 with details.openCount`, then 200 with `withOpenDescendants:true`.
  - `move into own descendant gives 400 and GET /api/tree is unchanged` (Review Focus 3).
  - `unknown id gives 404`.
- [ ] **Step 2: Write the failing tests** (`openLink.test.ts`):
  - On `win32`, it spawns `explorer.exe` with the link as a single argument, even for `https://x.example/?a=1&b=2`.
  - An empty or null link throws `invalid`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** Validate bodies by hand with small type guards. Don't add a validation library.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(server): task, day and review routes`.

### Task 13: SSE, day rollover, entry point, start script

**Files:**
- Create: `packages/server/src/{sse,rollover,main}.ts`, `start.cmd`
- Modify: root `package.json` scripts (`"start": "bun run --cwd apps/web build && bun packages/server/src/main.ts"`, `"dev": "bun packages/server/src/main.ts --dev"`), `README.md` (a "Running on Windows" section)
- Test: `packages/server/test/sse.test.ts`, `packages/server/test/rollover.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class ChangeBroker { subscribe(fn: (event: 'changed' | 'day_changed', data: object) => void): () => void; publish(...) }
  function startRollover(d: Daybreak, broker: ChangeBroker, intervalMs = 30_000): () => void
  // on change of d.today(): d.autoFinishEmptyReview(); broker.publish('day_changed', { today })
  ```
  SSE events: `event: changed` / `data: {}` and `event: day_changed` / `data: {"today":"YYYY-MM-DD"}`, plus a `: ping` comment every 25 s.

- [ ] **Step 1: Write the failing tests:**
  - `GET /events/stream streams "changed" after a POST /api/tasks`: read the first event from `res.body`.
  - `stream requires auth`.
  - `rollover publishes day_changed once when the fixed clock crosses 04:00`: advance from `2026-11-10T02:50:00Z` to `03:10:00Z` and call the tick manually.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `main.ts` does the following in order:
  1. resolve the data dir and assert it's outside the repo
  2. load the config and token
  3. open and migrate `daybreak.db`
  4. `createDaybreak({ logsDir: <data-dir>/logs })`
  5. `autoFinishEmptyReview()`
  6. `startRollover`
  7. `Bun.serve({ hostname: '127.0.0.1', port, fetch: app.fetch })`
  8. print `Daybreak running at http://127.0.0.1:<port>`

  If the port is busy, print `Daybreak is already running on port <port>` and exit 1. The `--dev` flag allows `http://localhost:5173` as an extra Host in `auth.ts`.

  `start.cmd`:
  ```bat
  @echo off
  cd /d "%~dp0"
  start "" http://127.0.0.1:47815
  bun run start
  ```
- [ ] **Step 4: Run the tests.** Expected: PASS. Manually run `DAYBREAK_DATA_DIR=$(mktemp -d) bun run seed && bun run dev`, then `curl -H "Authorization: Bearer $(cat <dir>/token)" http://127.0.0.1:47815/api/tree`. It returns the seeded tree.
- [ ] **Step 5: Write the README "Running on Windows" section:**
  - Prerequisites: Bun, plus Node 22.13+ for tests only.
  - `git clone`, `bun install`, then double-click `start.cmd`.
  - Where the data lives (`%LOCALAPPDATA%\Daybreak`).
  - How to change the port or `dayStartsAt` in `config.json`.
  - The note: "Never put DAYBREAK_DATA_DIR inside the repo."
- [ ] **Step 6: Commit** `feat(server): SSE, day rollover, entry point and start script`.

---

# Phase 3: Main window in the browser

### Task 14: Web scaffold, theme, API client, mutation queue

**Files:**
- Create: `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json}`, `apps/web/src/{main.tsx,App.tsx}`, `apps/web/src/api/{client,queue,hooks,sse}.ts`, `apps/web/src/theme/{tokens.css,global.css}`, `apps/web/src/shell/TitleBar.tsx`, `apps/web/src/ui/store.ts`
- Modify: `packages/server/src/app.ts` (serve `webDist` statics; `/` serves index.html with the cookie)
- Test: `apps/web/test/queue.test.ts`

**Interfaces:**
- Consumes: the HTTP API (Task 12) and the SSE events (Task 13).
- Produces:
  ```ts
  // api/client.ts
  class ApiError extends Error { status: number; code: string; details?: any }
  const api: { get<T>(path: string): Promise<T>; send<T>(method: 'POST'|'PATCH'|'DELETE', path: string, body?: unknown): Promise<T> }
  // api/queue.ts
  function createMutationQueue(): { enqueue<T>(fn: () => Promise<T>): Promise<T>; idle(): Promise<void> }  // strictly serial
  // api/hooks.ts (react-query; keys ['tree', completed], ['day', date], ['review', date], ['status'], ['days', from, to])
  function useStatus(), useTree(completed), useDay(date), useReview(date), useDayCounts(from, to)
  function useMutate(): <T>(fn: () => Promise<T>) => Promise<T>   // enqueue, then invalidate all queries after the queue drains
  // api/sse.ts
  function connectEvents(onChanged: () => void, onDayChanged: (today: string) => void): () => void  // EventSource, auto-reconnect
  // ui/store.ts (zustand)
  interface UiState { pane: 'tree' | 'day'; treeSel: string | null; daySel: string | null;
    editing: { id: string | 'draft'; initial: string } | null; draft: Draft | null;
    confirm: { id: string; status: 'done' | 'cancelled'; openCount: number; until: number } | null;
    detailId: string | null; showCompleted: boolean; reviewOpen: boolean }
  interface Draft { section: Section; parentId: string | null; afterId?: string; beforeId?: string }
  ```

- [ ] **Step 1: Write the failing tests** (`queue.test.ts`):
  - `runs strictly in order even when earlier calls are slower` (Review Focus 2): five enqueued fns with random delays record their start and end order 0–4, and none overlap.
  - `a rejection does not stop later calls`.
  - `idle resolves after the last one`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Theme.** `tokens.css` defines every DESIGN.md token as `--win`, `--pane`, … for `:root` (light) and `[data-theme=dark]`. `prefers-color-scheme` sets the initial theme. Fonts and the 13 px base size follow DESIGN.md.
  - **TitleBar** (40 px) has the app icon, "Daybreak", today's date, an "Add to My Day" button that focuses the My Day add field, a "Morning review" button that sets `reviewOpen`, and a theme toggle. It has no window buttons in the browser; those belong to phase 6.
  - **Body layout** is the tree at ~60% and My Day at ~40%, with placeholders for now.
  - **`vite.config.ts`** proxies `/api` and `/events` to `127.0.0.1:47815`. The proxy sets `Authorization: Bearer <token>`, read from `resolveDataDir()`'s token file at startup (imported from `@daybreak/server/paths`).
- [ ] **Step 4: Run the tests.** Expected: PASS. `bun run --cwd apps/web build` succeeds, and `bun run start` serves the UI with the seeded data reachable (title bar renders and the tree request returns 200).
- [ ] **Step 5: Commit** `feat(web): scaffold, theme, API client and mutation queue`.

### Task 15: Tree rendering

**Files:**
- Create: `apps/web/src/tree/{flatten.ts,TreePane.tsx,TreeRow.tsx,DayCell.tsx,RowCheckbox.tsx}`, `apps/web/src/shell/KeyHints.tsx`
- Test: `apps/web/test/flatten.test.ts`, `apps/web/test/TreeRow.test.tsx`

**Interfaces:**
- Consumes: types from `@daybreak/core` (type-only imports) and `dayLabel` from `@daybreak/core/dates`. `packages/core/package.json` `exports` has `"."` and `"./dates"`. `dates.ts` and `types.ts` have no Node imports, so the browser bundle never pulls in SQLite.
- Produces:
  ```ts
  interface FlatRow { id: string; node: TreeNode; depth: number; section: Section; parentId: string | null; hasChildren: boolean; isDraft?: boolean }
  function flatten(view: TreeView, draft?: Draft | null): FlatRow[]   // visible rows only: skips children of collapsed nodes; inserts a draft row
  function rowIndex(rows: FlatRow[], id: string): number
  ```

- [ ] **Step 1: Write the failing tests:**
  - `flatten skips collapsed children`.
  - `depth counts from 0 at section top level`.
  - `draft row appears after afterId's subtree at the draft's depth`.
  - `TreeRow` renders:
    - the day cell text and colour class from `dayLabel`
    - a Doing row with the doing fill and a semibold title
    - a Done row struck through
    - a Cancelled row with × and strike-through
    - a Worked-on row with the half-filled orange mark
    - a collapsed parent showing `done/total`
    - a selected row with the accent ring and no blue fill
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** to DESIGN.md "Tree", "Day column" and "Row states":
  - 26 px rows, 22 px per level with 1 px guide lines, and a 16 px checkbox with 4 px radius.
  - The day column is 48 px. Its colour is `color-mix(in srgb, var(--far) calc(fade*100%), var(--near))`.
  - The header has "Tasks", a "Show completed (N)" toggle bound to `showCompleted` (uses `completed=all`), a "New task" button with an `N` hint, and a "Collapse all" button that sets `collapsed: true` on every expanded parent, through the mutation queue.
  - The section headers are INBOX and PROJECTS with their counts.
  - Rows show hover quick actions (S, T, D) and note or link icons.
  - Clicking a row selects it. Clicking the checkbox toggles done, following the double-press rule from Task 16 through `commands.ts`.
  - `KeyHints` shows the navigate or edit hint string from DESIGN.md.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): tree rendering`.

### Task 16: Keyboard model

**Files:**
- Create: `apps/web/src/keyboard/{platform,keymap,commands,useKeyboard}.ts`, `apps/web/src/shell/{Toast.tsx,toastStore.ts}`
- Test: `apps/web/test/keymap.test.ts`, `apps/web/test/commands.test.ts`

**Interfaces:**
- Consumes: `FlatRow`, `flatten`, `api`, `useMutate`, the UI store.
- Produces:
  ```ts
  type Command =
    | 'nav.up' | 'nav.down' | 'nav.parent' | 'nav.child' | 'nav.first' | 'nav.last'
    | 'fold.collapse' | 'fold.expand' | 'move.up' | 'move.down' | 'indent' | 'outdent'
    | 'pane.toggle' | 'edit.start' | 'new.below' | 'schedule.today' | 'schedule.pick' | 'schedule.backlog'
    | 'mark.doing' | 'mark.worked' | 'status.done' | 'status.cancel' | 'delete' | 'detail.open' | 'link.open'
    | 'escape' | 'toast.undo'
    | 'edit.commitNew' | 'edit.prev' | 'edit.next' | 'edit.deleteEmpty' | 'edit.exit'
  interface KeyCtx { mode: 'navigate' | 'edit'; pane: 'tree' | 'day'; isMac: boolean; titleEmpty: boolean }
  interface KeyLike { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
  function resolveKey(e: KeyLike, ctx: KeyCtx): Command | null
  function isMacPlatform(nav?: Navigator): boolean
  function runCommand(cmd: Command, env: CommandEnv): Promise<void>
  interface CommandEnv { rows: FlatRow[]; dayItems: DayItem[]; ui: UiState & UiActions; api: typeof api;
    mutate: ReturnType<typeof useMutate>; today: ISODate; now: () => number; toast: ToastApi }
  ```

- [ ] **Step 1: Write the failing tests** (`keymap.test.ts`). Use a table-driven test with one row per DESIGN.md "Keyboard map" entry, for both `isMac` values:
  - `ArrowUp` and `ArrowDown` in navigate give `nav.up` and `nav.down` in both panes.
  - `ArrowLeft` and `ArrowRight` in navigate give `nav.parent` and `nav.child` in the tree, and `null` in My Day.
  - Collapse and expand:
    - On Windows, Ctrl+← and Ctrl+→ give `fold.collapse` and `fold.expand`.
    - On Mac, the same comes from Alt+← and Alt+→.
    - Alt+← on Windows gives `null`.
    - Cmd+← on Mac gives `null`.
  - Mod+↑ and Mod+↓ give `move.up` and `move.down` in both modes.
  - Tab and Shift+Tab give `indent` and `outdent` in both modes in the tree.
  - Letters in navigate mode:
    - `m` gives `pane.toggle`, `n` gives `new.below`, `t` gives `schedule.today`, `d` gives `schedule.pick` and `b` gives `schedule.backlog`.
    - `s` gives `mark.doing`, `w` gives `mark.worked`, `' '` gives `status.done` and `x` gives `status.cancel`.
    - `Delete` gives `delete`, `o` gives `link.open`, Ctrl+o gives `detail.open`, `z` gives `toast.undo`, and `Enter` and `F2` give `edit.start`.
    - `Home` and `End` give `nav.first` and `nav.last`.
  - Edit mode:
    - `Enter` gives `edit.commitNew`, and `ArrowUp` and `ArrowDown` give `edit.prev` and `edit.next`.
    - `Escape` gives `edit.exit`.
    - `Backspace` with `titleEmpty` gives `edit.deleteEmpty`; without it, `null`.
    - Letters, `ArrowLeft`, Ctrl+`ArrowLeft`, `Home` and `Delete` give `null`, so the browser handles them as text editing.
  - `Ctrl+n`, `Ctrl+1` and Alt+`ArrowLeft` always give `null`.
- [ ] **Step 2: Write the failing tests** (`commands.test.ts`, with a fake `api` that records calls and a fake clock):
  - `status.done on a parent first sets confirm and shows the note, second press within 4 s sends withOpenDescendants` (the first call gets `ApiError 409` with `openCount 4`).
  - `the second press after 4 s starts over`.
  - `any other command clears confirm`.
  - `delete shows the toast "Deleted 'Port fit routines' and 6 subtasks · Undo (Z)"`. Then `toast.undo` calls restore.
  - `move.down ×5 sends five nudges in order and selection stays on the task` (Review Focus 2).
  - `nav.child on a collapsed parent expands it, then selects the first child`.
  - `pane.toggle keeps each pane's last selection`.
  - `schedule.today in My Day on a task already today is a no-op`.
  - `schedule.backlog in My Day removes it from today`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `useKeyboard` attaches one `keydown` listener on `window`. When the review is open, or while the day picker or detail inputs have focus, it hands control to those components instead.
  - It calls `preventDefault()` for every non-null command.
  - The toast is dark and bottom-centred, lasts 8 s, and a newer toast replaces an older one.
  - The confirm note renders under the row as "4 open subtasks. Press Space again to close them all." (or "… Press X again to cancel them all.").
  - The done toast after closing a subtree reads "Done 'Milestone 2' and 4 subtasks".
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(web): keyboard model with navigate mode commands`.

### Task 17: Inline editing and drafts

**Files:**
- Create: `apps/web/src/tree/TitleEditor.tsx`
- Modify: `apps/web/src/keyboard/commands.ts` (the edit commands), `apps/web/src/tree/TreeRow.tsx`
- Test: `apps/web/test/editing.test.tsx`

**Interfaces:**
- Consumes: Task 16 and `flatten` with a draft.
- Produces: the edit-mode behaviour in DESIGN.md "Edit mode", plus the decisions below.
  - A new row is a client-only **draft** until it has a non-empty title, so empty tasks never reach the database.
  - `N` in navigate mode opens a draft after the selected task's subtree, at its level.
  - Enter on a draft with text creates it with `afterId`, then opens the next draft. Enter on an empty draft discards it and returns to navigate mode, so pressing Enter twice ends a list.
  - Esc saves a draft with text and discards an empty one.
  - Tab on a draft sets `parentId` to the previous sibling (no-op in Inbox). Shift+Tab sets it to the grandparent, with `afterId` = the old parent.
  - Mod+↑↓ on a draft is ignored.
  - On a persisted task: Enter saves (PATCH only if changed), then opens a draft after it. Tab and Shift+Tab save, then nudge, and editing continues. Backspace on an empty title deletes it with the toast. ↑↓ save, then edit the adjacent visible row. Blur saves.
  - Pasting text with newlines: the input sends it as-is, the server normalizes it, and the row shows the normalized title after refetch.

- [ ] **Step 1: Write the failing tests** (Testing Library with the fake api):
  - `typing a list`: N, "a", Enter, "b", Enter, Enter creates two tasks in order and ends in navigate mode with "b" selected.
  - `Tab while typing a draft nests it under the previous sibling`.
  - `Backspace on an emptied persisted title deletes with toast`.
  - `Esc on an empty draft discards and calls nothing`.
  - `ArrowDown in edit saves and edits the next row`.
  - `a pasted multi-line title is sent as typed and rendered as the server returns it` (Review Focus 4, UI half).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): inline editing and draft rows`.

### Task 18: My Day pane

**Files:**
- Create: `apps/web/src/myday/{MyDayPane,DayRow,AddField}.tsx`
- Test: `apps/web/test/MyDayPane.test.tsx`

**Interfaces:**
- Consumes: `useDay(today)`, the commands from Task 16 (with `pane === 'day'`), `api`.
- Produces: My Day per DESIGN.md "My Day".
  - The header has "My Day", the date, "N of M done" and a 4 px progress bar.
  - Rows are 44–46 px: path (text3) above the title, an 18 px round checkbox, the Doing fill, a hover "Start" (S) action and a drag handle.
  - The inline add field ("N" focuses it) creates `{section:'inbox', scheduledOn: today}`.
  - The empty state reads "Drag tasks in from the tree, or press T on a selected task".
  - Mod+↑↓ reorders using `schedule(id, today, {beforeId|afterId})`.
  - Enter edits the title inline (Esc or Enter saves; no drafts here).

- [ ] **Step 1: Write the failing tests:**
  - `header shows "2 of 5 done" with cancelled excluded`.
  - `empty state copy`.
  - `adding "Order a spare SMA torque wrench" posts inbox + today and clears the field`.
  - `Mod+ArrowUp on the second item posts schedule with beforeId of the first`.
  - `Doing row has the doing class`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): My Day pane`.

### Task 19: Day picker

**Files:**
- Create: `apps/web/src/picker/{dayGrid.ts,DayPicker.tsx}`
- Modify: `apps/web/src/keyboard/commands.ts` (`schedule.pick` opens the picker for the selection)
- Test: `apps/web/test/dayGrid.test.ts`, `apps/web/test/DayPicker.test.tsx`

**Interfaces:**
- Consumes: `parseDayInput`, `addDays`, `useDayCounts`.
- Produces:
  ```ts
  function dayGrid(today: ISODate, weeks: number): { date: ISODate; inMonthLabel: string }[][]  // starts today's week, Monday first
  function DayPicker(props: { today: ISODate; initial?: ISODate | null; allowNoDay: boolean;
    onPick(date: ISODate | null): void; onClose(): void }): JSX.Element
  ```
  Keys:
  - `1`–`9` pick today+0…+8, but only while the text input is empty. Once text is typed, digits type, so "20 nov" works.
  - ←/→ move ±1 day and ↑/↓ move ±7.
  - Enter picks the highlighted day, or the parsed typed day if the input parses.
  - Esc closes.
  - "No day" (only with `allowNoDay`, i.e. in the tree) picks `null`.

  Each cell shows the open-task count for that day, and the layout is about 620 × 330 (DESIGN.md "Day picker").

- [ ] **Step 1: Write the failing tests:**
  - `dayGrid` puts today in the first row, Monday first.
  - `pressing 3 picks today+2`.
  - `typing "fri" then Enter picks Friday`.
  - `typing "20 nov" types digits instead of picking`.
  - `ArrowDown then Enter picks today+7`.
  - `Esc calls onClose`.
  - `No day button only when allowNoDay`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): day picker`.

### Task 20: Drag and drop

**Files:**
- Create: `apps/web/src/tree/{projectDrop.ts,Dnd.tsx}`
- Modify: `TreePane.tsx`, `MyDayPane.tsx` (wrap them in one `DndContext`)
- Test: `apps/web/test/projectDrop.test.ts`

**Interfaces:**
- Consumes: `FlatRow[]`, `api` move and schedule.
- Produces:
  ```ts
  interface DropProjection { parentId: string | null; section: Section; depth: number;
    afterId?: string; beforeId?: string; label: string }       // label: "Level 3 · becomes a sibling of 'Write loader…'"
  function projectDrop(rows: FlatRow[], activeId: string, overId: string, offsetX: number, indent = 22): DropProjection | null
  ```
  Rules:
  - The active task's descendants are removed from `rows` before projecting.
  - Depth is the active task's depth plus `round(offsetX / 22)`, clamped to `[next row's depth, previous row's depth + 1]`.
  - Inbox rows clamp to depth 0.
  - Dropping a task with children into Inbox gives `null` (no indicator, drop ignored).
  - In the label, titles are truncated at 16 characters with "…".

- [ ] **Step 1: Write the failing tests:**
  - `projectDrop`:
    - No offset keeps the active task's depth.
    - +22 px goes one level deeper under the row above.
    - +66 px is clamped to the previous row's depth + 1.
    - −44 px is clamped to the next row's depth.
    - A dragged subtree's children are excluded.
    - A parent dropped into Inbox gives `null`.
    - The label matches `"Level 3 · becomes a sibling of 'Write loader for…'"`.
  - `dropping on own descendant is impossible because they are excluded` (Review Focus 3, UI half).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with `@dnd-kit/core` and `@dnd-kit/sortable`, following DESIGN.md "Row states" for "Being dragged", "Drag to indent" and "Drag from tree into My Day":
  - The dragged item is a lifted card with a "+N" badge, and the drop indicator line starts at the projected x.
  - Esc cancels the drag.
  - A drop onto My Day calls `schedule(id, today, {afterId|beforeId})`, and the source row stays in the tree.
  - Dragging inside My Day reorders it the same way.
  - Use a pointer sensor with a 4 px activation distance, so a click still selects the row.
- [ ] **Step 4: Run the tests.** Expected: PASS. Manually drag a task three levels deep, into My Day and back to the top in Chrome or Edge.
- [ ] **Step 5: Commit** `feat(web): drag to reorder, indent and plan My Day`.

### Task 21: Task detail panel

**Files:**
- Create: `apps/web/src/detail/{DetailPanel,Markdown}.tsx`
- Modify: `App.tsx` (the detail panel replaces My Day while `detailId` is set; Esc returns)
- Test: `apps/web/test/Markdown.test.tsx`, `apps/web/test/DetailPanel.test.tsx`

**Interfaces:**
- Consumes: `getTask` via the tree data, `api`, `DayPicker`.
- Produces: DESIGN.md "Task detail panel".
  - Top: the path, "Back to My Day · Esc", and a 20 px checkbox with the title.
  - Scheduled: Today / Tomorrow / Pick a day… / No day.
  - Status: Open / Doing / Worked on / Done / Cancelled.
  - Link: a monospace input (placeholder "Paste a file, folder or URL") and an Open button that calls `open-link`.
  - In tree: the path.
  - Notes · Markdown: rendered, with click to edit in a textarea (placeholder "Add notes — **bold**, - lists and `code` work."). Saves on blur or Ctrl+Enter.
  - Subtasks · N of M done: rows with checkbox and day chip.
  - Key hints along the bottom.
  - While a textarea or input in the panel has focus, global letter commands are off.

- [ ] **Step 1: Write the failing tests:**
  - `Markdown renders **bold**, lists and code`.
  - `Markdown shows <img src=x onerror=alert(1)> as text, no img element` (Review Focus 4).
  - `links open with target=_blank rel=noopener`.
  - `Status segment Done on a parent goes through the same confirm flow`.
  - `typing "s" in the notes textarea does not mark Doing`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): task detail panel`.

---

# Phase 4: Morning review

### Task 22: Review screen

**Files:**
- Create: `apps/web/src/review/{ReviewScreen,ReviewCard}.tsx`, `apps/web/src/review/reviewKeys.ts`
- Modify: `App.tsx` (show `ReviewScreen` full-window when `status.needsReview` or `reviewOpen`; on `day_changed`, set a flag and refetch status on the next window `focus` or `keydown`)
- Test: `apps/web/test/reviewKeys.test.ts`, `apps/web/test/ReviewScreen.test.tsx`

**Interfaces:**
- Consumes: `useReview(today)`, `/api/review/*`, `DayPicker` (with `allowNoDay=false`).
- Produces:
  ```ts
  type ReviewCommand = 'today' | 'day' | 'backlog' | 'cancel' | 'undo' | 'start'
  function resolveReviewKey(e: KeyLike, ctx: { pickerOpen: boolean; allSorted: boolean }): ReviewCommand | null
  // t today, d day, b backlog, x cancel, z undo, ' ' start (only when allSorted); everything null while pickerOpen
  function currentItem(view: ReviewView): ReviewItem | null   // first undecided leftover, then first undecided suggestion
  ```
  The layout follows DESIGN.md "Morning review":
  - An 820 px centre column with "Good morning — Tuesday 10 November", "Plan today, top to bottom" and "x of y done".
  - The leftovers heading is "LEFT OVER FROM MONDAY · x of y sorted". It names the weekday when every leftover is from one day; otherwise it says "LEFT OVER FROM EARLIER · x of y sorted".
  - The suggestions heading is "ANYTHING ELSE FOR TODAY? · Suggestions from your tree and Inbox".
  - Decided rows are 36 px with the outcome tint and a chip: "Today", "Wed", "Backlog", "Cancelled" or "Not today".
  - The current card has the path, "3 of 7" or "Suggestion", a 20 px title, the "Worked on Monday · Continue today?" chip, the note, and buttons T Today / D Another day / B Backlog (or "Not today") / X Cancel (red).
  - Upcoming rows are 38 px.
  - The end row reads "N tasks for today" with "Start the day · Space". It turns blue when everything is sorted, and is clickable at any time.
  - A key legend sits on the right.
  - The title bar shows a "Skip for today" link.

- [ ] **Step 1: Write the failing tests:**
  - `resolveReviewKey`: `t`, `d`, `b`, `x` and `z` map as above. `a`, `s` and `f` give `null`. Space before all are sorted gives `null`. Everything gives `null` while the picker is open.
  - `currentItem` skips decided items and goes to suggestions after the leftovers.
  - `ReviewScreen`:
    - `T on the current card posts decide today and the row turns into a decided row with chip "Today"`.
    - `D opens the picker inside the card; pressing 3 posts decide day with today+2`.
    - `Z posts undo`.
    - `heading names the weekday when all leftovers are from one day` (Review Focus 1, UI half: Friday leftovers on a Monday give "LEFT OVER FROM FRIDAY").
    - `Space when all sorted posts finish and closes the screen`.
    - `Skip for today posts skip`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The screen never navigates away mid-review; the list just runs on.
- [ ] **Step 4: Run them.** Expected: PASS. Manually: seed, set `dayStartsAt` so the seeded overdue items are leftovers, run through the review with the keyboard only, restart the server mid-review, and confirm that Z still undoes.
- [ ] **Step 5: Commit** `feat(web): morning review`.

---

# Phase 5: Daily logs

### Task 23: Log writer

**Files:**
- Create: `packages/core/src/log.ts`
- Modify: `packages/core/src/service.ts` (`finishReview` and `skipReview` call `writeMissingLogs(ctx, logsDir)` inside the same call, when `logsDir` is set)
- Test: `packages/core/test/log.test.ts`

**Interfaces:**
- Consumes: events, `pathOf`, tasks including deleted (to exclude them).
- Produces:
  ```ts
  function buildDayLog(ctx: Ctx, date: ISODate): string | null    // null when the day has no events
  function writeMissingLogs(ctx: Ctx, logsDir: string): ISODate[]  // days in (meta.last_logged_date, today) with events; writes <logsDir>/<date>.md; sets last_logged_date
  ```
  The format is SPEC.md §6 exactly: `# 2026-11-09 · Monday`, then `## Done`, `## Worked on`, `## Not done` and `## Added`, leaving out empty sections. Each line is `- [x] <title> · <path joined by " › "> (#<id>)`.
  - **Done:** tasks whose last `done`/`reopened` event on that date is `done`.
  - **Worked on** (`- [~]`): tasks with a `worked` or `doing` day mark on that date that aren't in Done.
  - **Not done** (`- [ ]`): tasks whose review decision event has `previous.scheduledOn === date`, plus open tasks still scheduled on that date. The outcome suffix comes from the decision:
    - `today` or `day` gives ` → moved to <to>`.
    - `backlog` gives ` → backlog`.
    - `cancel` gives ` → cancelled`.
    - No decision gives no suffix.
  - **Added:** `created` events on that date, as `- <title> · <path> (#<id>)`.
  - Tasks with `deleted_at` set when the log is written are left out of every section.
  - An Inbox task's path is `Inbox`. For a top-level project the path is `Projects`.

- [ ] **Step 1: Write the failing tests:**
  - `matches the SPEC §6 example`: build that exact scenario with fixed ids (inject `newId` through a test seam in `ids.ts`) and compare the whole string.
  - `empty sections are omitted`; `a day without events gives null`.
  - `deleted tasks are left out`.
  - `cancelled in review shows "→ cancelled"`.
  - `weekend gap writes Fri only, not Sat or Sun, then sets last_logged_date` (Review Focus 1).
  - `already written logs are never rewritten`: rename a task after writing, and the file is unchanged.
  - `skipReview also writes logs`. `a review interrupted before finish writes at the next finish`.
  - `title is the title at write time; path uses " › "`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Write each file with `fs.writeFileSync` to a temp name, then rename it. Create `logsDir` if it's missing.
- [ ] **Step 4: Run them.** Expected: PASS. Then run the full suite with `bun run test && bun run test:bun && bun run typecheck`, and all three are clean.
- [ ] **Step 5: Commit** `feat(core): daily Markdown logs`.

### Task 24: MVP wrap-up on the work laptop

**Files:**
- Modify: `README.md` (status line), `context.md` ("Current state"), `SPEC.md` §10 (add anything found)

- [ ] **Step 1: Run the full suite** with `bun run test && bun run test:bun && bun run typecheck`. Expected: all PASS.
- [ ] **Step 2: Do a clean-machine run.** In a fresh clone, `bun install`, then `start.cmd` (or `bun run start` off Windows). With an empty data dir it opens the main window with an empty tree, and the data dir contains `daybreak.db`, `token` and `config.json`.
- [ ] **Step 3: Do a keyboard-only checklist** in Edge on Windows, with no mouse:
  1. Type a 6-item project with 2 levels using N, Enter and Tab.
  2. Reorder it with Ctrl+↑↓, and fold with Ctrl+←→.
  3. Use ← / → to go to parent and child.
  4. T three tasks, then M to My Day and reorder them there.
  5. S one, then S another (the first becomes Worked on).
  6. Double-Space a parent.
  7. Del a subtree, then Z.
  8. D, then "fri", then Enter.
  9. Ctrl+O, then edit the notes, then Esc.

  Record anything that fails in SPEC.md §10.
- [ ] **Step 4: Update the docs.** In `context.md` "Current state", add a dated line saying the MVP phases 1–5 are built and that the next step is one week of real use before phase 6. Change the README status to "MVP (phases 1–5) built; in trial use".
- [ ] **Step 5: Commit** `docs: MVP built, ready for trial week`.
