# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

Daybreak: a local Windows 11 task manager and daily planner for work. Read
[`docs/spec.md`](docs/spec.md) first (scope, data model, architecture, build
plan), then [`docs/design.md`](docs/design.md) for visual and interaction
details. `context.md` has the current state.

Phases 1–5 (the MVP) are built. Phase 6 (Tauri shell) waits for a week of real
use on the work laptop. `docs/archive/mvp-plan.md` is the finished MVP build
plan, kept for reference; don't execute it again.

## Conventions

- Work task data must never be committed or leave the work laptop. The app's
  database and logs live in `%LOCALAPPDATA%\Daybreak\` (or
  `DAYBREAK_DATA_DIR`), never in this repo. Use fictional seed data for dev.
- Stay inside the V1 scope in spec.md section 2. If something seems missing,
  add it to the open questions instead of building it.
- All logic in TypeScript (`packages/core`, `packages/server`). Tauri's Rust
  side only does windowing, tray, shortcuts and launching the server.
- Build in the phase order of spec.md section 9. `core` gets unit tests
  (Vitest) for every tree, scheduling and review rule.
- Where you make a judgment call on Serwan's behalf, say so when you report
  back, and write the resulting behaviour into design.md (or spec.md). Things
  that need the work laptop go under "Needs the work laptop" in `context.md`.
  Open product questions go in spec.md section 10.
- UI copy, sizes and colours come from design.md. Colours are tokens in
  `apps/web/src/theme/tokens.css`, with light and dark values.

## Layout

| Path | What's there |
|---|---|
| `packages/core` | Domain logic over SQLite: tree, scheduling, marks, review, export, daily logs. No HTTP. Tests in `packages/core/test`. |
| `packages/server` | Hono API, token/host/origin guards, SSE, day rollover, link opening, `main.ts` entry. |
| `apps/web` | React 19 + Vite UI. `api/` (queries, write queue, SSE), `keyboard/` (keymap and commands), `tree/`, `myday/`, `review/`, `detail/`, `picker/`. |
| `scripts` | `seed.ts`, `smoke.ts`, the pre-commit guard `check-staged.ts`, `install-hooks.ts`. |
| `docs` | Project docs: `spec.md`, `design.md`, `keyboard.md`, `future-ideas.md`, the canvas mock-ups in `mockups/` and the finished MVP plan in `archive/`. Also the ai-wiki knowledge base (see below). Not app code. |

Packages are consumed as TypeScript source; there is no build step except the
web bundle.

## Commands

```bash
bun install                  # also points git at .githooks/
bun run check                # Biome lint + typecheck + Vitest + bun:sqlite smoke test
bun run format               # Biome: format and apply safe lint fixes everywhere
bun run smoke                # build the web app, start the server on a scratch folder, ping it
bun run test                 # Vitest only (needs Node 22.13+)
bun run typecheck
```

To run the app in development, always with a scratch data folder:

```bash
export DAYBREAK_DATA_DIR=$(mktemp -d)
bun run seed
bun run dev                  # API on 127.0.0.1:47815
bun run --cwd apps/web dev   # second terminal, same DAYBREAK_DATA_DIR: http://localhost:5173
```

`bun run start` builds the web app and serves everything from the server, as
`start.cmd` does on Windows.

## Checks

- **Formatting and lint: Biome** (`biome.json`). 100 columns, 2 spaces,
  single quotes, no semicolons, trailing commas. Code only (TS, TSX, CSS,
  JSON, HTML); Markdown and YAML are left alone. When a rule is wrong for a
  line, suppress it with `// biome-ignore lint/<group>/<rule>: <reason>`;
  don't turn the rule off for everyone.
- **Pre-commit hook** (`.githooks/pre-commit`, installed by `bun install`):
  refuses database files, a data folder's `token` and daily logs; formats the
  staged code with Biome and stages the result (a file that also has unstaged
  changes is only checked); then runs typecheck and Vitest. Docs-only commits
  skip all of that but the data check.
  Don't bypass it with `--no-verify` to get a commit through; fix the cause.
- **CI** (`.github/workflows/ci.yml`) runs the data guard, `biome ci`, typecheck, both test
  suites and `bun run smoke` on Windows and Linux for pushes and PRs.

## Gotchas

- The server only accepts writes whose Origin is its own page
  (`originGuard` in `packages/server/src/auth.ts`). Phase 6 must add the Tauri
  window's origin there.
- The day rolls over at `dayStartsAt` (default 04:00), not midnight. Use
  `localDate` in `packages/core/src/dates.ts`, never `new Date()` slicing.
- Tests use a fixed clock and a temp database; never point a test or the seed
  at a real data folder (`assertOutsideRepo` refuses folders in the repo).

## Knowledge base

This project is an ai-wiki knowledge base. Content lives under `docs/` with its
own conventions; see [`docs/CLAUDE.md`](docs/CLAUDE.md) for layout, mutability,
page format, and synthesis rules.

## Workflows (skills)

- **wiki-capture**: capture a source or thought. Source with notes creates a note page and auto-synths; source without notes goes to the journal; a bare thought goes to the journal and auto-synths.
- **wiki-add-notes**: attach notes to something already captured. Extends an existing note. Resolves the target from your verbal reference. Auto-synths.
- **wiki-synthesize**: propagate changed notes into wiki pages over the git change-set since `processed_commit`.
