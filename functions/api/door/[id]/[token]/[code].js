// POST   /api/door/:id/:token/:code  — check in a ticket
// DELETE /api/door/:id/:token/:code  — undo a check-in
//
// Token-gated mirror of /admin/api/checkin/:id/:code.

import { loadDoorEvent, normalizeCode } from '../../../../../_lib/door.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost({ params, env }) {
  const ev = await loadDoorEvent(env, params.id, params.token);
  if (!ev) return json(404, { ok: false, message: 'Not found.' });
  const code = normalizeCode(params.code);
  if (!code) return json(200, { ok: false, result: 'not_found', message: 'Code format invalid (expected 10 letters/digits).' });

  try {
    const row = await env.DB.prepare(
      `SELECT t.id, t.code, t.checked_in_at, t.holder_name,
              tt.name AS tier_name, o.buyer_name, o.buyer_email,
              o.ticketed_event_id, o.status AS order_status
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.order_id
       JOIN ticket_tiers tt ON tt.id = t.tier_id
       WHERE t.code = ? LIMIT 1`,
    ).bind(code).first();

    if (!row) return json(200, { ok: false, result: 'not_found', message: 'No ticket with that code.' });
    if (row.ticketed_event_id !== ev.id) {
      return json(200, { ok: false, result: 'wrong_event', message: 'Ticket belongs to a different event.' });
    }
    if (row.order_status !== 'paid') {
      return json(200, { ok: false, result: 'unpaid', message: `Order status is "${row.order_status}".` });
    }
    if (row.checked_in_at) {
      return json(200, {
        ok: false, result: 'already',
        message: 'This ticket has already been checked in.',
        ticket: {
          code: row.code, tier_name: row.tier_name,
          holder_name: row.holder_name, buyer_name: row.buyer_name, buyer_email: row.buyer_email,
          checked_in_at: row.checked_in_at,
        },
      });
    }

    await env.DB.prepare(
      `UPDATE tickets SET checked_in_at = datetime('now') WHERE id = ?`,
    ).bind(row.id).run();

    return json(200, {
      ok: true, result: 'ok',
      ticket: {
        code: row.code, tier_name: row.tier_name,
        holder_name: row.holder_name, buyer_name: row.buyer_name, buyer_email: row.buyer_email,
        checked_in_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('door checkin failed', err);
    return json(500, { ok: false, result: 'error', message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const ev = await loadDoorEvent(env, params.id, params.token);
  if (!ev) return json(404, { ok: false, message: 'Not found.' });
  const code = normalizeCode(params.code);
  if (!code) return json(400, { ok: false, message: 'Bad code.' });
  try {
    const row = await env.DB.prepare(
      `SELECT t.id FROM tickets t
       JOIN ticket_orders o ON o.id = t.order_id
       WHERE t.code = ? AND o.ticketed_event_id = ?`,
    ).bind(code, ev.id).first();
    if (!row) return json(404, { ok: false, message: 'Not found.' });
    await env.DB.prepare(`UPDATE tickets SET checked_in_at = NULL WHERE id = ?`).bind(row.id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('door undo failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
