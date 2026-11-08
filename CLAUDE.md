# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

Daybreak: a local Windows 11 task manager and daily planner for work. Read
[`SPEC.md`](SPEC.md) first (scope, data model, architecture, build plan), then
[`DESIGN.md`](DESIGN.md) for visual and interaction details. `context.md` has
the current state.

## Conventions

- Work task data must never be committed or leave the work laptop. The app's
  database and logs live in `%LOCALAPPDATA%\Daybreak\` (or
  `DAYBREAK_DATA_DIR`), never in this repo. Use fictional seed data for dev.
- Stay inside the V1 scope in SPEC.md section 2. If something seems missing,
  add it to the open questions instead of building it.
- All logic in TypeScript (`packages/core`, `packages/server`). Tauri's Rust
  side only does windowing, tray, shortcuts and launching the server.
- Build in the phase order of SPEC.md section 9. `core` gets unit tests
  (Vitest) for every tree, scheduling and review rule.

## Knowledge base

This project is an ai-wiki knowledge base. Content lives under `docs/` with its
own conventions; see [`docs/CLAUDE.md`](docs/CLAUDE.md) for layout, mutability,
page format, and synthesis rules.

## Workflows (skills)

- **wiki-capture**: capture a source or thought. Source with notes creates a note page and auto-synths; source without notes goes to the journal; a bare thought goes to the journal and auto-synths.
- **wiki-add-notes**: attach notes to something already captured. Extends an existing note. Resolves the target from your verbal reference. Auto-synths.
- **wiki-synthesize**: propagate changed notes into wiki pages over the git change-set since `processed_commit`.
