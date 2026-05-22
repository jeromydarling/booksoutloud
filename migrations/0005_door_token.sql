-- Per-event volunteer door tokens
-- Applied via the Cloudflare bindings MCP on 2026-05-22.
--
-- Each ticketed event can optionally have a long random token. The token, in
-- combination with the event id, lets a volunteer hit /door/<id>/<token> and
-- the corresponding /api/door/<id>/<token>/* endpoints WITHOUT being signed
-- into Cloudflare Access. The token has read+write access only to that one
-- event's check-in scope.

ALTER TABLE ticketed_events ADD COLUMN door_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ticketed_events_door_token_idx ON ticketed_events(door_token);
