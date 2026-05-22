// GET /admin/api/checkin/:id
//
// Returns the running ticket roster for one ticketed event — counts and the
// list of already-checked-in tickets. The door page polls this so the running
// totals stay correct across multiple staff devices.

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  const ev = await env.DB.prepare(
    `SELECT id, title, starts_at, location_name, capacity FROM ticketed_events WHERE id = ?`,
  ).bind(id).first();
  if (!ev) return json(404, { ok: false, message: 'Event not found.' });

  // Totals.
  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS sold,
       SUM(CASE WHEN t.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
     FROM tickets t
     JOIN ticket_orders o ON o.id = t.order_id
     WHERE o.ticketed_event_id = ? AND o.status = 'paid'`,
  ).bind(id).first();

  // Recent check-ins (last 20).
  const recentR = await env.DB.prepare(
    `SELECT t.code, t.holder_name, t.checked_in_at, tt.name AS tier_name, o.buyer_name, o.buyer_email
     FROM tickets t
     JOIN ticket_orders o ON o.id = t.order_id
     JOIN ticket_tiers tt ON tt.id = t.tier_id
     WHERE o.ticketed_event_id = ? AND t.checked_in_at IS NOT NULL
     ORDER BY t.checked_in_at DESC LIMIT 20`,
  ).bind(id).all();

  return json(200, {
    ok: true,
    event: ev,
    sold: totals?.sold || 0,
    checked_in: totals?.checked_in || 0,
    recent: recentR.results || [],
  });
}
