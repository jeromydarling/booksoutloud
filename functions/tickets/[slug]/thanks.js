// Public confirmation page at /tickets/<slug>/thanks?session_id=cs_...
//
// Looks up the order by Stripe session id and shows the ticket codes. The
// webhook may not have fired yet by the time the buyer lands here, so we
// show a "tickets are on the way" message if the order is still pending and
// the page auto-refreshes every couple of seconds until it's paid.

function html(s, status = 200) {
  return new Response(s, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') || s.includes(' ') ? s : `${s}T00:00:00`);
  if (isNaN(d)) return s;
  return d.toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function shell(inner, refresh = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tickets — BooksOutLoud</title>
  ${refresh ? '<meta http-equiv="refresh" content="3" />' : ''}
  <meta name="robots" content="noindex" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/tickets.css" />
</head>
<body>
  <header class="site-header">
    <div class="wrap"><div class="brand"><div class="brand-mark"><a href="/">BooksOutLoud</a></div></div></div>
  </header>
  <main><section class="page-hero"><div class="wrap" style="max-width:640px;">${inner}</div></section></main>
</body>
</html>`;
}

export async function onRequestGet({ params, request, env }) {
  const slug = String(params.slug || '').trim();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id') || '';
  if (!slug || !sessionId) {
    return html(shell(`<div class="eyebrow">Tickets</div><h1>We couldn&rsquo;t find that order.</h1><p class="muted"><a class="inline" href="/tickets/${esc(slug)}">Return to the event</a>.</p>`), 404);
  }

  const order = await env.DB.prepare(
    `SELECT o.*, te.title AS event_title, te.starts_at, te.location_name, te.location_address, te.slug AS event_slug
     FROM ticket_orders o
     JOIN ticketed_events te ON te.id = o.ticketed_event_id
     WHERE o.stripe_session_id = ? LIMIT 1`,
  ).bind(sessionId).first();

  if (!order) {
    return html(shell(`<div class="eyebrow">Tickets</div><h1>We couldn&rsquo;t find that order.</h1><p class="muted">If you just paid, give it a moment and refresh. Otherwise <a class="inline" href="/tickets/${esc(slug)}">return to the event</a>.</p>`), 404);
  }

  if (order.status !== 'paid') {
    return html(shell(`
      <div class="eyebrow">Tickets</div>
      <h1>Almost there&hellip;</h1>
      <p>Stripe is confirming your payment. This page will refresh in a moment.</p>
      <p class="muted">If nothing happens after 30 seconds, check your inbox — your tickets may already be there.</p>
    `, true));
  }

  const tixR = await env.DB.prepare(
    `SELECT t.code, tt.name AS tier_name FROM tickets t JOIN ticket_tiers tt ON tt.id = t.tier_id WHERE t.order_id = ?`,
  ).bind(order.id).all();
  const tickets = tixR.results || [];

  return html(shell(`
    <div class="eyebrow">You&rsquo;re in</div>
    <h1>Your tickets are confirmed</h1>
    <p style="margin-top:12px;"><strong>${esc(order.event_title)}</strong><br>
       ${esc(fmtDateTime(order.starts_at))}<br>
       ${esc(order.location_name || '')}${order.location_address ? '<br>' + esc(order.location_address) : ''}</p>

    <div class="ticket-list">
      ${tickets.map(t => `
        <div class="ticket-row">
          <div>
            <div class="muted small" style="text-transform:uppercase; letter-spacing:.14em; font-size:.72rem;">${esc(t.tier_name)}</div>
            <div class="ticket-code">${esc(t.code)}</div>
          </div>
          <div class="muted small">Show at door</div>
        </div>`).join('')}
    </div>

    <p class="muted">A confirmation email is on its way to ${esc(order.buyer_email || 'your inbox')}. No printout necessary.</p>
    <p style="margin-top:18px;"><a class="btn ghost small" href="/">Return home</a></p>
  `));
}
