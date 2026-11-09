# Daybreak

[![CI](https://github.com/nulinspiratie/daybreak/actions/workflows/ci.yml/badge.svg)](https://github.com/nulinspiratie/daybreak/actions/workflows/ci.yml)

A local task manager and daily planner for work, on Windows 11.

One nested task tree (Inbox plus projects), a My Day list for today, and a two-minute morning review that clears yesterday's leftovers before the day starts. Keyboard and mouse both do everything. Each day is also written out as a plain Markdown log.

- [docs/spec.md](docs/spec.md): what it does, data model, architecture, build plan, open questions
- [docs/design.md](docs/design.md): visual and interaction details from the design canvas
- [docs/keyboard.md](docs/keyboard.md): every key and mouse action, and the decisions behind them
- [context.md](context.md): where things stand

Status: MVP (phases 1–5) built; Windows check, then trial use.

## Running on Windows

You need [Bun](https://bun.sh). Node 22.13 or newer is only needed to run the tests.

```
git clone <repo-url> daybreak
cd daybreak
bun install
```

The committed lockfile uses versions verified on Microsoft's npm proxy, but names no
registry: each machine installs from the registry its own npm or Bun settings point at
(the work feed on the work laptop, public npm elsewhere), and the checksums in `bun.lock`
make sure it's the same package either way. Keep `bun.lock` when installing;
`bun install --frozen-lockfile` installs its exact resolutions without updating it. If a
`bun install` on the work laptop writes feed URLs back into `bun.lock`, don't commit them.

Then double-click `start.cmd`. It builds the web app, starts the server and opens http://127.0.0.1:47815.

Your data lives in `%LOCALAPPDATA%\Daybreak`: the database (`daybreak.db`), `logs\`, `token` and `backups\`.

### Settings

Settings are in `%USERPROFILE%\.daybreak.toml`, created with every setting written out and commented the first time Daybreak starts. Edit it and restart Daybreak.

```toml
[server]
port = 47815               # if you change it, also edit the URL in start.cmd

[day]
starts_at = "04:00"        # the day rolls over at this time, not midnight

[backup]
dir = '%OneDriveCommercial%\Daybreak backups'
retain_days = 14
```

Use single quotes around Windows paths, so the backslashes are kept as they are. `~` and `%NAME%` environment variables are expanded; `%OneDriveCommercial%` is your work OneDrive folder. If an older `config.json` is in the data folder, its port and day start are moved into the new file the first time, and it's renamed `config.json.old`.

`DAYBREAK_CONFIG` points Daybreak at another settings file. When `DAYBREAK_DATA_DIR` is set (development), Daybreak reads `daybreak.toml` in that folder instead of yours.

Never put DAYBREAK_DATA_DIR inside the repo.

### Backups

Daybreak copies its database to `dir` as `daybreak-YYYY-MM-DD.db` when it starts, at the start of each day, and once an hour while there are changes, so at most about an hour of work is ever missing from a copy. The daily logs are copied to `dir\logs\`. Copies older than `retain_days` are deleted, but the newest 3 are always kept. Without `dir`, copies go to `%LOCALAPPDATA%\Daybreak\backups`, which protects against a damaged database but not a lost laptop.

If a backup fails (for example the OneDrive folder isn't there), Daybreak keeps working, the title bar says **Backup failed** (hover it for the reason), and it tries again every hour.

To restore a copy:

1. Stop Daybreak (close the `start.cmd` window).
2. In `%LOCALAPPDATA%\Daybreak`, rename `daybreak.db` to keep it, and delete `daybreak.db-wal` and `daybreak.db-shm` if they're there.
3. Copy the backup you want into that folder as `daybreak.db`.
4. Start Daybreak again.

### Install as an app

With Daybreak open in Edge, choose **Install Daybreak** (the install icon at the right of the address bar, or `…` › Apps › Install this site as an app). It then opens in its own window with its own taskbar icon, and you can pin it. The server still has to be running: if it isn't, the window says so and opens Daybreak by itself once you start `start.cmd`. Nothing is stored offline; your tasks only ever come from the server.

To remove it, open `edge://apps` and uninstall Daybreak. This doesn't touch your data.

## Development

Use a scratch data folder, never the real one; `bun run seed` refuses to run without `DAYBREAK_DATA_DIR`. It fills a fresh folder with fictional tasks.

```
export DAYBREAK_DATA_DIR=$(mktemp -d)
bun run seed
bun run dev                    # API server on 127.0.0.1:47815, also allowing the Vite dev origin
bun run --cwd apps/web dev     # second terminal, same DAYBREAK_DATA_DIR: Vite on http://localhost:5173
```

Vite proxies `/api` and `/events` to the server, adding the token from the data folder, so start the server first. `bun run start` instead builds the web app and serves everything from the server, as `start.cmd` does.

Code is formatted and linted with [Biome](https://biomejs.dev) (`biome.json`; `bun run format` fixes everything it can). Before you commit, `bun run check` runs the lint, the typecheck, the Vitest suite (on Node 22.13+) and the `bun:sqlite` smoke test. `bun run smoke` builds the web app, starts the real server on a scratch folder and checks that it answers.

If you installed Bun through npm on Windows, Node-based tests need the actual
`bun.exe` on `PATH`, not just npm's launcher. Add its directory for the current
PowerShell session before running checks or committing:

```powershell
$env:Path = "$(Split-Path (bun -p 'process.execPath'));$env:Path"
```

`bun install` also turns on a pre-commit hook (`.githooks/pre-commit`). It refuses anything that looks like task data (database files, a `token`, daily logs), formats the staged code with Biome, and runs the typecheck and tests when code changed. CI runs the same checks, plus the smoke test, on Windows and Linux for every push and pull request.

[CLAUDE.md](CLAUDE.md) has the code layout and conventions.
