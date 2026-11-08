# Daybreak

A local task manager and daily planner for work, on Windows 11.

One nested task tree (Inbox plus projects), a My Day list for today, and a two-minute morning review that clears yesterday's leftovers before the day starts. Keyboard and mouse both do everything. Each day is also written out as a plain Markdown log.

- [SPEC.md](SPEC.md): what it does, data model, architecture, build plan, open questions
- [DESIGN.md](DESIGN.md): visual and interaction details from the design canvas

Status: the core and server are built; the UI is in progress.

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
