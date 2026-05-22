// POST /api/checkout
//
// Creates a Stripe Checkout Session for ticket purchase on a ticketed event.
// Money flows to the venue's Connected Account via transfer_data.destination;
// BooksOutLoud takes its cut via application_fee_amount.

import { stripeRequest } from '../_lib/stripe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const slug = (data.slug || '').toString().trim();
  const items = Array.isArray(data.items) ? data.items : [];
  if (!slug)           return json(400, { ok: false, message: 'Event slug missing.' });
  if (!items.length)   return json(400, { ok: false, message: 'No items selected.' });

  // Load event + venue.
  const ev = await env.DB.prepare(
    `SELECT te.*, v.stripe_account_id, v.stripe_status, v.charges_enabled, v.name AS venue_name
     FROM ticketed_events te JOIN venues v ON v.id = te.venue_id
     WHERE te.slug = ?`,
  ).bind(slug).first();
  if (!ev) return json(404, { ok: false, message: 'Event not found.' });
  if (ev.status !== 'on_sale') return json(400, { ok: false, message: 'Tickets are not currently on sale.' });
  if (!ev.stripe_account_id || !ev.charges_enabled) {
    return json(400, { ok: false, message: 'This venue is not yet configured to accept payments.' });
  }

  // Load tiers and build line items.
  const tiersR = await env.DB.prepare(
    `SELECT id, name, description, price_cents, capacity FROM ticket_tiers WHERE ticketed_event_id = ?`,
  ).bind(ev.id).all();
  const tiersById = Object.fromEntries((tiersR.results || []).map(t => [t.id, t]));

  const lineItems = [];
  let subtotalCents = 0;
  for (const it of items) {
    const tier = tiersById[it.tier_id];
    const qty = parseInt(it.qty, 10) || 0;
    if (!tier || qty <= 0) continue;
    if (qty > 20) return json(400, { ok: false, message: 'Quantity per tier capped at 20 for online purchase.' });
    lineItems.push({
      quantity: qty,
      price_data: {
        currency: (ev.currency || 'USD').toLowerCase(),
        unit_amount: tier.price_cents,
        product_data: {
          name: `${ev.title} — ${tier.name}`,
          description: tier.description || ev.location_name || ev.venue_name,
        },
      },
    });
    subtotalCents += tier.price_cents * qty;
  }
  if (!lineItems.length) return json(400, { ok: false, message: 'No valid ticket selections.' });

  // Optional capacity check.
  if (ev.capacity) {
    const sold = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tickets t JOIN ticket_orders o ON o.id = t.order_id
       WHERE o.ticketed_event_id = ? AND o.status = 'paid'`,
    ).bind(ev.id).first();
    const newQty = items.reduce((a, i) => a + (parseInt(i.qty, 10) || 0), 0);
    if (sold.n + newQty > ev.capacity) {
      return json(400, { ok: false, message: `Only ${ev.capacity - sold.n} ticket(s) remain.` });
    }
  }

  // Platform fee.
  const splitPct = Number.isFinite(ev.split_pct) ? ev.split_pct : 80;
  const platformFeeCents = Math.max(0, Math.round(subtotalCents * (100 - splitPct) / 100));

  // Pre-create a pending order so we can correlate the webhook back.
  const order = await env.DB.prepare(
    `INSERT INTO ticket_orders (ticketed_event_id, subtotal_cents, platform_fee_cents, status)
     VALUES (?1, ?2, ?3, 'pending') RETURNING id`,
  ).bind(ev.id, subtotalCents, platformFeeCents).first();

  const siteUrl = env.SITE_URL || 'https://booksoutloud.org';
  const successUrl = `${siteUrl}/tickets/${slug}/thanks?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = `${siteUrl}/tickets/${slug}?canceled=1`;

  try {
    const session = await stripeRequest(env, '/v1/checkout/sessions', {
      mode: 'payment',
      ui_mode: 'hosted',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: ev.stripe_account_id },
        statement_descriptor_suffix: (ev.venue_name || 'TICKETS').slice(0, 22),
        metadata: {
          ticket_order_id: String(order.id),
          ticketed_event_id: String(ev.id),
          ticketed_event_slug: slug,
        },
      },
      metadata: {
        ticket_order_id: String(order.id),
        ticketed_event_id: String(ev.id),
        ticketed_event_slug: slug,
      },
      // Pass the order id through items metadata redundantly in case PI metadata is dropped.
      client_reference_id: String(order.id),
      customer_creation: 'if_required',
      phone_number_collection: { enabled: false },
      allow_promotion_codes: false,
    });

    await env.DB.prepare(
      `UPDATE ticket_orders SET stripe_session_id = ?2, stripe_payment_intent_id = ?3 WHERE id = ?1`,
    ).bind(order.id, session.id, session.payment_intent || null).run();

    return json(200, { ok: true, url: session.url, order_id: order.id });
  } catch (err) {
    console.error('Checkout session failed', err);
    // Mark order failed for visibility.
    try {
      await env.DB.prepare(`UPDATE ticket_orders SET status = 'failed' WHERE id = ?`).bind(order.id).run();
    } catch {/* swallow */}
    return json(502, { ok: false, message: `Stripe: ${err.message}` });
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  }
  return json(405, { ok: false, message: 'Method not allowed.' });
}
