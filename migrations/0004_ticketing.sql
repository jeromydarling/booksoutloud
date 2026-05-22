-- Ticketing schema (venues + ticketed events + tiers + orders + tickets)
-- Applied via the Cloudflare bindings MCP on 2026-05-22.

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  stripe_account_id TEXT UNIQUE,
  stripe_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stripe_status IN ('pending','onboarding','enabled','restricted','disabled')),
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  payouts_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  default_split_pct INTEGER NOT NULL DEFAULT 80,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS venues_status_idx ON venues(stripe_status);

CREATE TABLE IF NOT EXISTS ticketed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  event_id INTEGER REFERENCES events(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  doors_open_at TEXT,
  location_name TEXT,
  location_address TEXT,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','on_sale','sold_out','canceled','past')),
  split_pct INTEGER NOT NULL DEFAULT 80,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ticketed_events_slug_idx ON ticketed_events(slug);
CREATE INDEX IF NOT EXISTS ticketed_events_status_idx ON ticketed_events(status);
CREATE INDEX IF NOT EXISTS ticketed_events_starts_at_idx ON ticketed_events(starts_at);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticketed_event_id INTEGER NOT NULL REFERENCES ticketed_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  capacity INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticket_tiers_event_idx ON ticket_tiers(ticketed_event_id);

CREATE TABLE IF NOT EXISTS ticket_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticketed_event_id INTEGER NOT NULL REFERENCES ticketed_events(id),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  subtotal_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','refunded','partial_refund','failed','expired','canceled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  refunded_at TEXT
);
CREATE INDEX IF NOT EXISTS ticket_orders_event_idx ON ticket_orders(ticketed_event_id);
CREATE INDEX IF NOT EXISTS ticket_orders_status_idx ON ticket_orders(status);
CREATE INDEX IF NOT EXISTS ticket_orders_buyer_email_idx ON ticket_orders(buyer_email);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
  tier_id INTEGER NOT NULL REFERENCES ticket_tiers(id),
  code TEXT NOT NULL UNIQUE,
  holder_name TEXT,
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tickets_order_idx ON tickets(order_id);
CREATE INDEX IF NOT EXISTS tickets_code_idx ON tickets(code);
