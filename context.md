# Context

## Overview

Daybreak is Serwan's planned work task manager and daily planner. It replaces Logseq for work task management; personal tasks stay in Tasks.org. Everything about what to build is in [docs/spec.md](docs/spec.md) and [docs/design.md](docs/design.md).

## Current state

- 2026-11-08: requirements settled in a long design conversation, mock-ups made on a design canvas, spec and design notes written. No code yet. Next: MVP with Claude Code, phases 1–5 of docs/spec.md section 9.
- 2026-11-09: the MVP (phases 1–5) is built and tested on Linux. The Windows check (below) is next, then one week of real use before phase 6.
  - CI (GitHub Actions, Windows and Linux) and a pre-commit hook guard the repo: typecheck, tests, a server smoke test, and a check that no task data is committed.
  - For phase 6: the server only accepts writes from its own page (`http://127.0.0.1:<port>` or `http://localhost:<port>`). The Tauri window's origin must be added to `originGuard` in `packages/server/src/auth.ts`, or every write is refused with 403.
- 2026-11-09, first round of use: My Day's Del takes a task off today (not a delete), Z is a general undo history, My Day rows can be dragged out, I adds to Inbox, edit mode looks distinct, double-click edits or folds, the fold button toggles. Behaviour is in docs/design.md; the keyboard inventory and its decisions in docs/keyboard.md.

## Needs the work laptop

- [ ] **Windows run**: fresh clone, `start.cmd`, and the keyboard-only checklist in Edge (the MVP plan's Task 24, docs/archive/mvp-plan.md).
- [ ] **Links on Windows**: clicking an http(s) or mailto link in a task's notes should open the default browser, or Outlook for mailto (the server runs `explorer.exe <url>`; only tested on Linux).

## Conventions

- Work task data never goes in this repo or anywhere off the work laptop. Use the fictional seed data from the design for development.
- Keep it lean: build only what's in V1 scope; add features when they're actually missed.
- All logic in TypeScript (`packages/core`, `packages/server`); Tauri only for windowing, tray and shortcuts.
