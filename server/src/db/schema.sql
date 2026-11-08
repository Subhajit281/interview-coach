CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mode          TEXT NOT NULL,
  company       TEXT NOT NULL,
  position      TEXT NOT NULL,
  round         TEXT NOT NULL DEFAULT '',
  style         TEXT NOT NULL DEFAULT 'standard',
  difficulty    TEXT NOT NULL,
  personality   TEXT NOT NULL,
  duration_min  INTEGER NOT NULL,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  elapsed_sec   INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id  INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  board         TEXT,
  meta          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions_asked (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id  INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,
  topic         TEXT NOT NULL,
  title         TEXT NOT NULL,
  difficulty    TEXT,
  hints_used    INTEGER NOT NULL DEFAULT 0,
  solved        INTEGER NOT NULL DEFAULT 0,
  asked_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id  INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
  overall_score REAL NOT NULL,
  scores_json   TEXT NOT NULL,
  report_json   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- topic key is "<mode>:<topic>", score is 0-10
CREATE TABLE IF NOT EXISTS topic_stats (
  topic         TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  avg_score     REAL NOT NULL DEFAULT 0,
  hints_total   INTEGER NOT NULL DEFAULT 0,
  last_seen     TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interview_id);
CREATE INDEX IF NOT EXISTS idx_questions_interview ON questions_asked(interview_id);
CREATE INDEX IF NOT EXISTS idx_questions_mode ON questions_asked(mode);
CREATE INDEX IF NOT EXISTS idx_interviews_mode ON interviews(mode);
