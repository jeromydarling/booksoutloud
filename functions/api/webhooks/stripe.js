// POST /api/webhooks/stripe
//
// Verifies Stripe webhook signatures and handles two events:
//   checkout.session.completed → mark order paid, mint ticket codes, email buyer
//   account.updated            → sync venues.charges_enabled / payouts_enabled
//
// Configure in Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   URL: https://booksoutloud.org/api/webhooks/stripe
//   Events: checkout.session.completed, account.updated
// Then store the signing secret as STRIPE_WEBHOOK_SECRET in Cloudflare.

import { verifyStripeSignature, stripeRequest, generateTicketCode } from '../../_lib/stripe.js';
import { sendEmail, emailShell, escapeHtml } from '../../_lib/email.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const sig = request.headers.get('Stripe-Signature') || '';
  const payload = await request.text();

  try {
    await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('webhook signature invalid', err.message);
    return new Response('signature invalid', { status: 400 });
  }

  let event;
  try { event = JSON.parse(payload); }
  catch { return new Response('bad payload', { status: 400 }); }

  // Process in the background so we ack to Stripe quickly.
  ctx.waitUntil(handleEvent(env, event).catch(err => console.error('webhook handler failed', event.type, err)));
  return json(200, { received: true });
}

async function handleEvent(env, event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(env, event.data.object);
    case 'checkout.session.expired':
      return markOrderStatus(env, event.data.object, 'expired');
    case 'checkout.session.async_payment_failed':
      return markOrderStatus(env, event.data.object, 'failed');
    case 'account.updated':
      return handleAccountUpdated(env, event.data.object);
    default:
      return;
  }
}

async function markOrderStatus(env, session, status) {
  const orderId = parseInt(session.client_reference_id || session.metadata?.ticket_order_id, 10);
  if (!Number.isInteger(orderId)) return;
  await env.DB.prepare(`UPDATE ticket_orders SET status = ?2 WHERE id = ?1 AND status = 'pending'`)
    .bind(orderId, status).run();
}

async function handleCheckoutCompleted(env, session) {
  if (session.payment_status !== 'paid') {
    return markOrderStatus(env, session, session.payment_status === 'unpaid' ? 'pending' : 'failed');
  }

  const orderId = parseInt(session.client_reference_id || session.metadata?.ticket_order_id, 10);
  if (!Number.isInteger(orderId)) {
    console.error('webhook: missing ticket_order_id', session.id);
    return;
  }

  const order = await env.DB.prepare(
    `SELECT o.*, te.title AS event_title, te.starts_at, te.location_name, te.location_address,
            te.slug AS event_slug, te.currency
     FROM ticket_orders o
     JOIN ticketed_events te ON te.id = o.ticketed_event_id
     WHERE o.id = ?`,
  ).bind(orderId).first();
  if (!order) return;
  if (order.status === 'paid') return; // idempotent — already processed

  const buyerEmail = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  const buyerName  = session.customer_details?.name || '';

  await env.DB.prepare(
    `UPDATE ticket_orders
       SET status = 'paid',
           buyer_email = COALESCE(NULLIF(?2, ''), buyer_email),
           buyer_name  = COALESCE(NULLIF(?3, ''), buyer_name),
           stripe_payment_intent_id = COALESCE(?4, stripe_payment_intent_id),
           paid_at = datetime('now')
     WHERE id = ?1`,
  ).bind(orderId, buyerEmail || null, buyerName || null, session.payment_intent || null).run();

  // Mint tickets — quantity is derived from session line items.
  // Fetch line items via Stripe API since they're not always included in the webhook payload.
  let lineItems = [];
  try {
    const li = await stripeRequest(env, `/v1/checkout/sessions/${session.id}/line_items`, { limit: 100 });
    lineItems = li.data || [];
  } catch (err) {
    console.error('line_items fetch failed', err);
  }

  // Match line item descriptions back to tiers by name pattern.
  const tiersR = await env.DB.prepare(
    `SELECT id, name, price_cents FROM ticket_tiers WHERE ticketed_event_id = ?`,
  ).bind(order.ticketed_event_id).all();
  const tiers = tiersR.results || [];

  const ticketsCreated = [];
  for (const li of lineItems) {
    const desc = (li.description || '').toLowerCase();
    const tier = tiers.find(t => desc.includes(t.name.toLowerCase())) || tiers[0];
    if (!tier) continue;
    for (let n = 0; n < (li.quantity || 0); n++) {
      const code = generateTicketCode();
      await env.DB.prepare(
        `INSERT INTO tickets (order_id, tier_id, code, holder_name) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(orderId, tier.id, code, buyerName || null).run();
      ticketsCreated.push({ code, tier_name: tier.name });
    }
  }

  // Email the buyer their tickets.
  if (buyerEmail && env.RESEND_API_KEY && ticketsCreated.length) {
    const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';
    const replyTo   = env.BOOKING_TO_EMAIL   || 'jer@jeromydarling.com';
    const siteUrl   = env.SITE_URL           || 'https://booksoutloud.org';

    const dt = new Date(order.starts_at);
    const when = isNaN(dt) ? order.starts_at : dt.toLocaleString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });

    const ticketsHtml = ticketsCreated.map(t => `
      <tr><td style="padding:10px 14px; border:1px solid rgba(138,100,50,.2); background:#f9f5e8;">
        <div style="font-size:11px; letter-spacing:.16em; color:#8a6432; text-transform:uppercase;">${escapeHtml(t.tier_name)}</div>
        <div style="font-family:monospace; font-size:1.2rem; letter-spacing:.04em; color:#8a6432; margin-top:4px;">${escapeHtml(t.code)}</div>
      </td></tr>`).join('');

    const ticketsText = ticketsCreated.map(t => `  ${t.tier_name}: ${t.code}`).join('\n');

    const html = emailShell({
      preheader: `Your ${ticketsCreated.length} ticket${ticketsCreated.length === 1 ? '' : 's'} for ${order.event_title}`,
      title: `Your tickets — ${order.event_title}`,
      bodyHtml: `
        <h2 style="margin:0 0 8px; font-size:1.45rem;">Your tickets are confirmed</h2>
        <p style="margin:0 0 14px; color:#655e55;"><strong>${escapeHtml(order.event_title)}</strong></p>
        <p style="margin:0 0 18px;">${escapeHtml(when)}<br>${escapeHtml(order.location_name || '')}${order.location_address ? '<br>' + escapeHtml(order.location_address) : ''}</p>
        <p style="margin:0 0 8px; color:#8a6432; font-size:11px; letter-spacing:.18em; text-transform:uppercase;">Tickets</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:separate; border-spacing:0 8px;">
          ${ticketsHtml}
        </table>
        <p style="margin:20px 0 0; color:#655e55;">Show this email at the door. No printout necessary.</p>
      `,
      footerHtml: `Questions? Reply to this email — it lands directly with Jeromy.`,
    });

    const text = [
      'Your tickets are confirmed.',
      '',
      `${order.event_title}`,
      when,
      order.location_name || '',
      order.location_address || '',
      '',
      'Tickets:',
      ticketsText,
      '',
      'Show this email at the door.',
      '',
      `${siteUrl}/tickets/${order.event_slug}`,
    ].filter(Boolean).join('\n');

    try {
      await sendEmail(env, {
        from: fromEmail,
        to: buyerEmail,
        replyTo,
        subject: `Your tickets — ${order.event_title}`,
        text, html,
      });
    } catch (err) {
      console.error('ticket email send failed', err);
    }
  }
}

async function handleAccountUpdated(env, account) {
  if (!account?.id) return;
  const venue = await env.DB.prepare(
    `SELECT id FROM venues WHERE stripe_account_id = ?`,
  ).bind(account.id).first();
  if (!venue) return;
  const detailsSubmitted = account.details_submitted ? 1 : 0;
  const charges = account.charges_enabled ? 1 : 0;
  const payouts = account.payouts_enabled ? 1 : 0;
  let status = 'onboarding';
  if (detailsSubmitted) {
    status = charges && payouts ? 'enabled' : (account.requirements?.disabled_reason ? 'disabled' : 'restricted');
  }
  await env.DB.prepare(
    `UPDATE venues
       SET stripe_status = ?2, charges_enabled = ?3, payouts_enabled = ?4, details_submitted = ?5,
           updated_at = datetime('now')
     WHERE id = ?1`,
  ).bind(venue.id, status, charges, payouts, detailsSubmitted).run();
}

export async function onRequest({ request }) {
  return new Response(null, { status: 405, headers: { 'Allow': 'POST' } });
}
