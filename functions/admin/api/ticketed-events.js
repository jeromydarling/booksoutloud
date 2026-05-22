// /admin/api/ticketed-events
//   GET   — list ticketed events
//   POST  — create a ticketed event with its tier set in one request

import { slugify } from '../../_lib/stripe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT te.*,
              v.name AS venue_name, v.stripe_status AS venue_stripe_status,
              (SELECT SUM(subtotal_cents) FROM ticket_orders WHERE ticketed_event_id = te.id AND status = 'paid') AS gross_cents,
              (SELECT COUNT(*) FROM tickets t JOIN ticket_orders o ON o.id = t.order_id WHERE o.ticketed_event_id = te.id AND o.status = 'paid') AS tickets_sold
       FROM ticketed_events te
       JOIN venues v ON v.id = te.venue_id
       ORDER BY COALESCE(te.starts_at, '9999') DESC
       LIMIT 200`,
    ).all();
    return json(200, { ok: true, events: results || [] });
  } catch (err) {
    console.error('ticketed-events list failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const title = (data.title || '').toString().trim();
  const venueId = parseInt(data.venue_id, 10);
  const startsAt = (data.starts_at || '').toString().trim();
  if (!title)   return json(400, { ok: false, message: 'Title is required.' });
  if (!Number.isInteger(venueId) || venueId <= 0) return json(400, { ok: false, message: 'Venue is required.' });
  if (!startsAt) return json(400, { ok: false, message: 'Start time is required.' });

  const venue = await env.DB.prepare(`SELECT id, stripe_status FROM venues WHERE id = ?`).bind(venueId).first();
  if (!venue) return json(400, { ok: false, message: 'Venue not found.' });

  const tiers = Array.isArray(data.tiers) ? data.tiers : [];
  if (!tiers.length) return json(400, { ok: false, message: 'At least one ticket tier is required.' });
  for (const t of tiers) {
    if (!t.name || !String(t.name).trim()) return json(400, { ok: false, message: 'Each tier needs a name.' });
    const price = parseInt(t.price_cents ?? Math.round((t.price || 0) * 100), 10);
    if (!Number.isFinite(price) || price < 0) return json(400, { ok: false, message: `Tier "${t.name}" has an invalid price.` });
    t._price_cents = price;
  }

  let baseSlug = (data.slug && slugify(data.slug)) || slugify(title);
  if (!baseSlug) baseSlug = 'event';
  let slug = baseSlug;
  for (let n = 2; n < 50; n++) {
    const existing = await env.DB.prepare(`SELECT id FROM ticketed_events WHERE slug = ?`).bind(slug).first();
    if (!existing) break;
    slug = `${baseSlug}-${n}`;
  }

  const splitPct = Number.isFinite(+data.split_pct) ? Math.max(0, Math.min(100, +data.split_pct)) : 80;
  const status = ['draft', 'on_sale'].includes(data.status) ? data.status : 'draft';

  try {
    const event = await env.DB.prepare(
      `INSERT INTO ticketed_events
         (slug, title, subtitle, description, venue_id, event_id, starts_at, ends_at, doors_open_at,
          location_name, location_address, capacity, status, split_pct, currency)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       RETURNING id`,
    ).bind(
      slug, title,
      (data.subtitle || '').toString().trim() || null,
      (data.description || '').toString().trim() || null,
      venueId,
      data.event_id ? parseInt(data.event_id, 10) : null,
      startsAt,
      (data.ends_at || '').toString().trim() || null,
      (data.doors_open_at || '').toString().trim() || null,
      (data.location_name || '').toString().trim() || null,
      (data.location_address || '').toString().trim() || null,
      data.capacity ? parseInt(data.capacity, 10) : null,
      status, splitPct,
      (data.currency || 'USD').toString().toUpperCase().slice(0, 3),
    ).first();

    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      await env.DB.prepare(
        `INSERT INTO ticket_tiers (ticketed_event_id, name, description, price_cents, capacity, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        event.id,
        String(t.name).trim(),
        t.description ? String(t.description).trim() : null,
        t._price_cents,
        t.capacity ? parseInt(t.capacity, 10) : null,
        i,
      ).run();
    }
    return json(200, { ok: true, id: event.id, slug });
  } catch (err) {
    console.error('ticketed-event create failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
