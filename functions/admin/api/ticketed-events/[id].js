// /admin/api/ticketed-events/:id  — GET / PATCH / DELETE

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const EDITABLE = [
  'title','subtitle','description','starts_at','ends_at','doors_open_at',
  'location_name','location_address','capacity','status','split_pct',
];

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  try {
    const ev = await env.DB.prepare(
      `SELECT te.*, v.name AS venue_name, v.stripe_status AS venue_stripe_status, v.stripe_account_id
       FROM ticketed_events te JOIN venues v ON v.id = te.venue_id
       WHERE te.id = ?`,
    ).bind(id).first();
    if (!ev) return json(404, { ok: false, message: 'Not found.' });

    const tiersR = await env.DB.prepare(
      `SELECT id, name, description, price_cents, capacity, sort_order FROM ticket_tiers WHERE ticketed_event_id = ? ORDER BY sort_order, id`,
    ).bind(id).all();

    const ordersR = await env.DB.prepare(
      `SELECT id, stripe_session_id, buyer_name, buyer_email, subtotal_cents, platform_fee_cents,
              status, created_at, paid_at,
              (SELECT COUNT(*) FROM tickets WHERE order_id = ticket_orders.id) AS ticket_count
       FROM ticket_orders WHERE ticketed_event_id = ?
       ORDER BY created_at DESC LIMIT 200`,
    ).bind(id).all();

    return json(200, { ok: true, event: ev, tiers: tiersR.results || [], orders: ordersR.results || [] });
  } catch (err) {
    console.error('ticketed-event get failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPatch({ request, params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const sets = [];
  const binds = [];
  for (const f of EDITABLE) {
    if (f in data) {
      let v = data[f];
      if (f === 'capacity' || f === 'split_pct') {
        v = (v === '' || v === null) ? null : parseInt(v, 10);
        if (v !== null && !Number.isFinite(v)) return json(400, { ok: false, message: `${f} must be a number.` });
      } else if (typeof v === 'string') {
        v = v.trim() || null;
      }
      sets.push(`${f} = ?`);
      binds.push(v);
    }
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    binds.push(id);
    try {
      await env.DB.prepare(`UPDATE ticketed_events SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    } catch (err) {
      console.error('ticketed-event patch failed', err);
      return json(500, { ok: false, message: 'Database error.' });
    }
  }

  // Replace tier set if provided.
  if (Array.isArray(data.tiers)) {
    try {
      await env.DB.prepare(`DELETE FROM ticket_tiers WHERE ticketed_event_id = ?`).bind(id).run();
      for (let i = 0; i < data.tiers.length; i++) {
        const t = data.tiers[i];
        const price = parseInt(t.price_cents ?? Math.round((t.price || 0) * 100), 10);
        await env.DB.prepare(
          `INSERT INTO ticket_tiers (ticketed_event_id, name, description, price_cents, capacity, sort_order)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(
          id,
          String(t.name || '').trim() || 'Ticket',
          t.description ? String(t.description).trim() : null,
          Number.isFinite(price) ? price : 0,
          t.capacity ? parseInt(t.capacity, 10) : null,
          i,
        ).run();
      }
    } catch (err) {
      console.error('tier replace failed', err);
      return json(500, { ok: false, message: 'Tier update failed.' });
    }
  }
  return json(200, { ok: true });
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    const orders = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ticket_orders WHERE ticketed_event_id = ? AND status IN ('paid','partial_refund')`,
    ).bind(id).first();
    if (orders.n > 0) {
      return json(400, { ok: false, message: 'Event has paid orders — set status to "canceled" instead of deleting.' });
    }
    await env.DB.prepare(`DELETE FROM ticketed_events WHERE id = ?`).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('ticketed-event delete failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
