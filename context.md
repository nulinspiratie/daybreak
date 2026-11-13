# Context

## Overview

Daybreak is Serwan's planned work task manager and daily planner. It replaces Logseq for work task management; personal tasks stay in Tasks.org. Everything about what to build is in [docs/spec.md](docs/spec.md) and [docs/design.md](docs/design.md).

## Current state

- 2026-11-08: requirements settled in a long design conversation, mock-ups made on a design canvas, spec and design notes written. No code yet. Next: MVP with Claude Code, phases 1–5 of docs/spec.md section 9.
- 2026-11-09: the MVP (phases 1–5) is built and tested on Linux. The Windows check (below) is next, then one week of real use before phase 6.
  - CI (GitHub Actions, Windows and Linux) and a pre-commit hook guard the repo: typecheck, tests, a server smoke test, and a check that no task data is committed.
  - Daybreak is also a thin PWA (added at Serwan's request, outside spec.md's V1 scope): it can be installed from Edge as its own window, and shows an "isn't running" page when the server is off. It caches nothing. Details in docs/design.md, "Installed app (PWA)".
  - For phase 6 and the PWA: the service worker isn't registered inside Tauri (`__TAURI_INTERNALS__` is checked in `apps/web/src/pwa/register.ts`), since workers don't run on Tauri's asset protocol and Tauri does its own windowing. Confirm on the laptop that `__TAURI_INTERNALS__` is present in whichever mode phase 6 uses. WebView2 has its own profile, so an Edge-installed worker never reaches the Tauri window. Once the Tauri app is in use, uninstall the Edge app (`edge://apps`), or there will be two Daybreak windows and taskbar icons. The PWA gives none of phase 6's tray, My Day pop-up or global quick add.
  - For phase 6: the server only accepts writes from its own page (`http://127.0.0.1:<port>` or `http://localhost:<port>`). The Tauri window's origin must be added to `originGuard` in `packages/server/src/auth.ts`, or every write is refused with 403.
- 2026-11-09, first round of use: My Day's Del takes a task off today (not a delete), Z is a general undo history, My Day rows can be dragged out, I adds to Inbox, edit mode looks distinct, double-click edits or folds, the fold button toggles. Behaviour is in docs/design.md; the keyboard inventory and its decisions in docs/keyboard.md.

- 2026-11-09: backups and a settings file. Settings moved from `config.json` in the data folder to `~/.daybreak.toml` (port, day start, backup folder and retention); the old file is migrated on first start. The database is copied daily (and hourly while there are changes) to the backup folder, by default `%LOCALAPPDATA%\Daybreak\backups`, meant to be the work OneDrive. The hard constraint now reads "never leaves the secure work environment", which includes the work OneDrive. Details in docs/spec.md §7.
- 2026-11-13: the morning review gets Done (Space) next to Cancel, and ↑↓ (or a click) move the card to any item, so an earlier choice can be changed. Items keep their place once decided. Space on the end row still starts the day. Details in docs/spec.md §4 and docs/design.md, "Morning review".

## Needs the work laptop

- [ ] **Windows run**: fresh clone, `start.cmd`, and the keyboard-only checklist in Edge (the MVP plan's Task 24, docs/archive/mvp-plan.md).
- [ ] **Install as an app on Windows**: Edge offers "Install Daybreak", the icon looks right on the taskbar and Start menu, stopping the server shows "Daybreak isn't running" and starting it brings the app back by itself. Also check whether IT policy allows installing sites as apps in Edge.
- [ ] **Backups to OneDrive**: set `dir = '%OneDriveCommercial%\Daybreak backups'` in `%USERPROFILE%\.daybreak.toml` and restart. Check that the old `config.json` was moved (now `config.json.old`), that `%OneDriveCommercial%` expands to the work OneDrive, that `daybreak-<today>.db` and `logs\` appear there and OneDrive syncs them, and that a rename of today's copy while OneDrive is uploading it doesn't fail (if it does, the title bar says "Backup failed" and it retries hourly). Then do one test restore (README, "Backups") into a scratch `DAYBREAK_DATA_DIR`.
- [ ] **Install from the feed**: `bun.lock` no longer names the Microsoft feed (2026-11-09, so the Mac can install from public npm). On the laptop, check that `bun install --frozen-lockfile` still installs from the feed through the laptop's own npm/Bun registry setting, and that it leaves `bun.lock` unchanged.
- [ ] **Links on Windows**: clicking an http(s) or mailto link in a task's notes should open the default browser, or Outlook for mailto (the server runs `explorer.exe <url>`; only tested on Linux).

## Conventions

- Work task data never goes in this repo or anywhere outside the secure work environment (the work laptop and the work OneDrive). Use the fictional seed data from the design for development.
- Keep it lean: build only what's in V1 scope; add features when they're actually missed.
- All logic in TypeScript (`packages/core`, `packages/server`); Tauri only for windowing, tray and shortcuts.
