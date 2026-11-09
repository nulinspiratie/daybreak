import { type Db, transaction } from './adapter'

const SCHEMA_V1 = `
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
`

/** Bring the database to the latest schema. Safe to call repeatedly. */
export function migrate(db: Db): void {
  transaction(db, () => {
    const hasMeta = db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    const row = hasMeta
      ? db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")
      : undefined
    if (!row) {
      db.exec(SCHEMA_V1)
      db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '1')")
    }
  })
}
