// Public ticketing page at /tickets/<slug>
//
// Server-rendered HTML. Shows event details and a small tier selector that
// POSTs to /api/checkout (defined separately) to start a Stripe Checkout
// Session.

function html(s, status = 200) {
  return new Response(s, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
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

function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function notFound() {
  return html(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title><link rel="stylesheet" href="/styles.css"></head><body><main class="page-hero"><div class="wrap"><div class="eyebrow">Tickets</div><h1>This event isn&rsquo;t listed.</h1><p class="muted">It may have been removed or the link may be wrong. <a class="inline" href="/">Return home</a>.</p></div></main></body></html>`, 404);
}

export async function onRequestGet({ params, env }) {
  const slug = String(params.slug || '').trim();
  if (!slug) return notFound();

  const ev = await env.DB.prepare(
    `SELECT te.*, v.name AS venue_name, v.stripe_status AS venue_stripe_status
     FROM ticketed_events te JOIN venues v ON v.id = te.venue_id
     WHERE te.slug = ? LIMIT 1`,
  ).bind(slug).first();
  if (!ev) return notFound();

  const tiersR = await env.DB.prepare(
    `SELECT id, name, description, price_cents, capacity FROM ticket_tiers
     WHERE ticketed_event_id = ? ORDER BY sort_order, id`,
  ).bind(ev.id).all();
  const tiers = tiersR.results || [];

  const onSale = ev.status === 'on_sale' && ev.venue_stripe_status === 'enabled';
  const cancelled = ev.status === 'canceled';
  const past = ev.status === 'past' || (ev.starts_at && new Date(ev.starts_at) < new Date(Date.now() - 86400000));

  const description = ev.description
    ? `<div class="ticket-desc">${esc(ev.description).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>')}</div>`
    : '';

  const tierMarkup = tiers.length
    ? tiers.map(t => `
        <label class="ticket-tier" data-tier-id="${t.id}" data-price-cents="${t.price_cents}">
          <div class="ticket-tier-main">
            <div class="ticket-tier-name">${esc(t.name)}</div>
            ${t.description ? `<div class="ticket-tier-desc muted">${esc(t.description)}</div>` : ''}
          </div>
          <div class="ticket-tier-price">${money(t.price_cents, ev.currency)}</div>
          <div class="ticket-tier-qty">
            <button type="button" data-action="dec" aria-label="Decrease">&minus;</button>
            <input type="number" name="qty_${t.id}" value="0" min="0" max="20" step="1" inputmode="numeric" />
            <button type="button" data-action="inc" aria-label="Increase">+</button>
          </div>
        </label>
      `).join('')
    : '<p class="muted">No ticket options have been published yet.</p>';

  const banner = cancelled ? '<div class="ticket-banner error">This event has been canceled.</div>'
                : past     ? '<div class="ticket-banner muted">This event has passed.</div>'
                : !onSale  ? '<div class="ticket-banner muted">Tickets are not on sale yet for this event.</div>'
                :            '';

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(ev.title)} — Tickets — BooksOutLoud</title>
  <meta name="description" content="Tickets for ${esc(ev.title)} on ${esc(fmtDateTime(ev.starts_at))} at ${esc(ev.location_name || ev.venue_name)}." />
  <link rel="canonical" href="https://booksoutloud.org/tickets/${esc(slug)}" />
  <meta property="og:title" content="${esc(ev.title)} — Tickets" />
  <meta property="og:description" content="${esc(ev.subtitle || ev.title)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/tickets.css" />
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <div class="brand">
        <div class="brand-mark"><a href="/">BooksOutLoud</a></div>
        <div class="brand-sub">Performed by Jeromy Darling</div>
      </div>
      <nav class="nav" id="site-nav">
        <a href="/performances.html">Performances</a>
        <a href="/about.html">About Jeromy</a>
        <a href="/booking.html" class="btn secondary">Book an Event</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="page-hero">
      <div class="wrap">
        <div class="eyebrow">Live performance</div>
        <h1>${esc(ev.title)}</h1>
        ${ev.subtitle ? `<p class="lead">${esc(ev.subtitle)}</p>` : ''}
        <div class="ticket-meta">
          <div><strong>${esc(fmtDateTime(ev.starts_at))}</strong></div>
          <div>${esc(ev.location_name || ev.venue_name)}${ev.location_address ? ` &middot; ${esc(ev.location_address)}` : ''}</div>
          ${ev.doors_open_at ? `<div class="muted">Doors ${esc(fmtDateTime(ev.doors_open_at))}</div>` : ''}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap grid-2">
        <div class="card">
          <h2 style="margin-bottom:12px;">About this evening</h2>
          ${description ? `<p>${description}</p>` : '<p class="muted">A literary evening with Jeromy Darling.</p>'}
        </div>

        <div class="card" id="ticket-card">
          <h2 style="margin-bottom:12px;">Tickets</h2>
          ${banner}
          <form id="checkout-form" class="ticket-form" data-slug="${esc(slug)}" ${onSale ? '' : 'aria-disabled="true"'}>
            <div class="ticket-tiers" ${onSale ? '' : 'data-disabled'}>
              ${tierMarkup}
            </div>
            <div class="ticket-summary">
              <div class="ticket-summary-line"><span>Subtotal</span><strong data-subtotal>${money(0, ev.currency)}</strong></div>
              <button type="submit" class="btn primary" ${onSale ? '' : 'disabled'}>Continue to checkout</button>
            </div>
            <p class="form-status" data-status></p>
            <p class="muted small">Secure checkout powered by Stripe. Tickets emailed on payment.</p>
          </form>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="wrap">
      <div class="col"><strong>BooksOutLoud</strong><span>Live literary performance</span></div>
      <div class="col"><strong>Performed by</strong><span>Jeromy Darling</span></div>
      <div class="col"><strong>Bookings</strong><a class="inline" href="/booking.html">Book an event</a></div>
      <div class="col"><strong>Newsletter</strong><a class="inline" href="/newsletter.html">Join the dispatch</a></div>
    </div>
  </footer>
  <script src="/tickets.js"></script>
</body>
</html>`;
  return html(body);
}
