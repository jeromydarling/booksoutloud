// Shared helpers for the token-gated volunteer door endpoints.

export async function loadDoorEvent(env, idStr, token) {
  const id = parseInt(idStr, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!token || token.length < 16 || token.length > 64) return null;
  if (!/^[a-fA-F0-9]+$/.test(token)) return null;

  const ev = await env.DB.prepare(
    `SELECT te.*, v.name AS venue_name FROM ticketed_events te
     JOIN venues v ON v.id = te.venue_id
     WHERE te.id = ?1 AND te.door_token = ?2 LIMIT 1`,
  ).bind(id, token).first();
  return ev || null;
}

export function mintDoorToken() {
  // 32 hex chars = 128 bits of entropy. Plenty for a per-event token.
  return crypto.randomUUID().replace(/-/g, '');
}

export function normalizeCode(s) {
  const cleaned = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 10) return null;
  return cleaned.slice(0, 4) + '-' + cleaned.slice(4);
}
