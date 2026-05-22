-- Newsletter subscribers
-- Applied via the Cloudflare bindings MCP on 2026-05-22.
-- Re-run-safe (every statement is IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS subscribers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL UNIQUE,
  name              TEXT,
  source            TEXT    NOT NULL DEFAULT 'web',
  status            TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','unsubscribed','bounced')),
  unsubscribe_token TEXT    NOT NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at   TEXT
);
CREATE INDEX IF NOT EXISTS subscribers_status_idx     ON subscribers(status);
CREATE INDEX IF NOT EXISTS subscribers_created_at_idx ON subscribers(created_at);
