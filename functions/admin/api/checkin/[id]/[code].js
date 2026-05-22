// POST /admin/api/checkin/:id/:code
//
// Look up a ticket by its 8-char code and mark it checked in. Returns the
// status of the action so the door UI can show one of:
//   ok              — first check-in, welcome shown
//   already         — ticket was already used; include first-use time
//   wrong_event     — code is valid but belongs to a different event
//   not_found       — no such code in the database
//
// Codes are stored as XXXX-XXXX. The caller can pass with or without dash,
// upper or lower case.

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function normalizeCode(s) {
  const cleaned = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 10) return null;
  return cleaned.slice(0, 4) + '-' + cleaned.slice(4);
}

export async function onRequestPost({ params, env }) {
  const eventId = parseInt(params.id, 10);
  const code = normalizeCode(params.code);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return json(400, { ok: false, result: 'bad_request', message: 'Bad event id.' });
  }
  if (!code) {
    return json(200, { ok: false, result: 'not_found', message: 'Code format is invalid (expected 10 letters/digits).' });
  }

  try {
    const row = await env.DB.prepare(
      `SELECT t.id, t.code, t.checked_in_at, t.holder_name,
              tt.name AS tier_name,
              o.buyer_name, o.buyer_email,
              o.ticketed_event_id, o.status AS order_status
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.order_id
       JOIN ticket_tiers tt ON tt.id = t.tier_id
       WHERE t.code = ? LIMIT 1`,
    ).bind(code).first();

    if (!row) return json(200, { ok: false, result: 'not_found', message: 'No ticket with that code.' });
    if (row.ticketed_event_id !== eventId) {
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
    console.error('checkin failed', err);
    return json(500, { ok: false, result: 'error', message: 'Database error.' });
  }
}

// DELETE /admin/api/checkin/:id/:code — undo a check-in (mistakes happen).
export async function onRequestDelete({ params, env }) {
  const eventId = parseInt(params.id, 10);
  const code = normalizeCode(params.code);
  if (!Number.isInteger(eventId) || !code) {
    return json(400, { ok: false, message: 'Bad request.' });
  }
  try {
    const row = await env.DB.prepare(
      `SELECT t.id FROM tickets t
       JOIN ticket_orders o ON o.id = t.order_id
       WHERE t.code = ? AND o.ticketed_event_id = ?`,
    ).bind(code, eventId).first();
    if (!row) return json(404, { ok: false, message: 'Not found.' });
    await env.DB.prepare(`UPDATE tickets SET checked_in_at = NULL WHERE id = ?`).bind(row.id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('checkin undo failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
