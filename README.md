# Daybreak

A local task manager and daily planner for work, on Windows 11.

One nested task tree (Inbox plus projects), a My Day list for today, and a two-minute morning review that clears yesterday's leftovers before the day starts. Keyboard and mouse both do everything. Each day is also written out as a plain Markdown log.

- [SPEC.md](SPEC.md): what it does, data model, architecture, build plan, open questions
- [DESIGN.md](DESIGN.md): visual and interaction details from the design canvas

Status: MVP (phases 1–5) built; Windows check, then trial use.

## Running on Windows

You need [Bun](https://bun.sh). Node 22.13 or newer is only needed to run the tests.

```
git clone <repo-url> daybreak
cd daybreak
bun install
```

Then double-click `start.cmd`. It builds the web app, starts the server and opens http://127.0.0.1:47815.

Your data lives in `%LOCALAPPDATA%\Daybreak`: the database (`daybreak.db`), `logs\`, `token` and `config.json`.

To change the port or the time a day starts, edit `config.json` in that folder (`port`, default 47815; `dayStartsAt`, default `04:00`) and restart. If you change `port`, also edit the URL in `start.cmd`.

Never put DAYBREAK_DATA_DIR inside the repo.

## Development

Use a scratch data folder, never the real one; `bun run seed` refuses to run without `DAYBREAK_DATA_DIR`. It fills a fresh folder with fictional tasks.

```
export DAYBREAK_DATA_DIR=$(mktemp -d)
bun run seed
bun run dev                    # API server on 127.0.0.1:47815, also allowing the Vite dev origin
bun run --cwd apps/web dev     # second terminal, same DAYBREAK_DATA_DIR: Vite on http://localhost:5173
```

Vite proxies `/api` and `/events` to the server, adding the token from the data folder, so start the server first. `bun run start` instead builds the web app and serves everything from the server, as `start.cmd` does.

Tests: `bun run test` (Vitest, on Node 22.13+), `bun run test:bun` (the `bun:sqlite` smoke test) and `bun run typecheck`.
