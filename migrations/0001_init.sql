-- BooksOutLoud CRM — initial schema
-- Run on Cloudflare D1 via:
--   wrangler d1 execute booksoutloud-crm --remote --file=migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  organization  TEXT,
  phone         TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  program         TEXT,
  event_date      TEXT,
  venue           TEXT,
  audience        TEXT,
  message         TEXT,
  notes           TEXT,
  status          TEXT    NOT NULL DEFAULT 'inquiry'
                  CHECK (status IN ('inquiry','quoted','tentative','confirmed','performed','declined','canceled')),
  fee_cents       INTEGER,
  source          TEXT    NOT NULL DEFAULT 'web'
                  CHECK (source IN ('web','manual','email','phone','referral')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS events_status_idx     ON events(status);
CREATE INDEX IF NOT EXISTS events_event_date_idx ON events(event_date);
CREATE INDEX IF NOT EXISTS events_contact_id_idx ON events(contact_id);
CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at);
