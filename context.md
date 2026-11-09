# Context

## Overview

Daybreak is Serwan's planned work task manager and daily planner. It replaces Logseq for work task management; personal tasks stay in Tasks.org. Everything about what to build is in [SPEC.md](SPEC.md) and [DESIGN.md](DESIGN.md).

## Current state

- 2026-11-08: requirements settled in a long design conversation, mock-ups made on a design canvas, spec and design notes written. No code yet. Next: MVP with Claude Code, phases 1–5 of SPEC.md section 9.
- 2026-11-09: the MVP (phases 1–5) is built and tested on Linux. The Windows check (SYNC.md) is next, then one week of real use before phase 6.

## Conventions

- Work task data never goes in this repo or anywhere off the work laptop. Use the fictional seed data from the design for development.
- Keep it lean: build only what's in V1 scope; add features when they're actually missed.
- All logic in TypeScript (`packages/core`, `packages/server`); Tauri only for windowing, tray and shortcuts.
