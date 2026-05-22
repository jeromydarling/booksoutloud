// GET /api/door/:id/:token
//
// Token-gated roster endpoint. Functionally identical to
// /admin/api/checkin/:id, but auth comes from the URL token instead of
// Cloudflare Access. Returns 404 (NOT 401) on bad token so the existence
// of a token can't be probed.

import { loadDoorEvent } from '../../../../_lib/door.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ request, params, env }) {
  const ev = await loadDoorEvent(env, params.id, params.token);
  if (!ev) return json(404, { ok: false, message: 'Not found.' });
  const wantFull = new URL(request.url).searchParams.get('full') === '1';

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS sold,
       SUM(CASE WHEN t.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
     FROM tickets t
     JOIN ticket_orders o ON o.id = t.order_id
     WHERE o.ticketed_event_id = ? AND o.status = 'paid'`,
  ).bind(ev.id).first();

  const recentR = await env.DB.prepare(
    `SELECT t.code, t.holder_name, t.checked_in_at, tt.name AS tier_name, o.buyer_name, o.buyer_email
     FROM tickets t
     JOIN ticket_orders o ON o.id = t.order_id
     JOIN ticket_tiers tt ON tt.id = t.tier_id
     WHERE o.ticketed_event_id = ? AND t.checked_in_at IS NOT NULL
     ORDER BY t.checked_in_at DESC LIMIT 20`,
  ).bind(ev.id).all();

  let allTickets;
  if (wantFull) {
    const rosterR = await env.DB.prepare(
      `SELECT t.code, t.holder_name, t.checked_in_at,
              tt.name AS tier_name,
              o.buyer_name, o.buyer_email
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.order_id
       JOIN ticket_tiers tt ON tt.id = t.tier_id
       WHERE o.ticketed_event_id = ? AND o.status = 'paid'`,
    ).bind(ev.id).all();
    allTickets = rosterR.results || [];
  }

  return json(200, {
    ok: true,
    event: { id: ev.id, title: ev.title, starts_at: ev.starts_at, location_name: ev.location_name, capacity: ev.capacity },
    sold: totals?.sold || 0,
    checked_in: totals?.checked_in || 0,
    recent: recentR.results || [],
    ...(wantFull ? { all: allTickets } : {}),
  });
}
