-- D1 schema for the visitor log.
CREATE TABLE IF NOT EXISTS visits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,   -- unix epoch milliseconds
  ip        TEXT,               -- CF-Connecting-IP
  country   TEXT,
  region    TEXT,
  city      TEXT,
  asn       INTEGER,
  org       TEXT,               -- request.cf.asOrganization (best-guess connecting org)
  path      TEXT,
  referrer  TEXT,
  ua        TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);
