-- Newsletter broadcasts log
-- Applied via the Cloudflare bindings MCP on 2026-05-22.

CREATE TABLE IF NOT EXISTS broadcasts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  subject           TEXT    NOT NULL,
  body_md           TEXT    NOT NULL,
  body_html         TEXT    NOT NULL,
  body_text         TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sending','sent','failed','test')),
  total_recipients  INTEGER NOT NULL DEFAULT 0,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  failures          TEXT,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS broadcasts_status_idx     ON broadcasts(status);
CREATE INDEX IF NOT EXISTS broadcasts_created_at_idx ON broadcasts(created_at);
