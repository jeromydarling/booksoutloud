// GET /admin/checkin/:id
//
// Mobile-first door check-in UI for one ticketed event. Gated by Cloudflare
// Access via the /admin/_middleware. Renders the page server-side so it works
// instantly when the door staff opens it on a phone with shaky coverage; the
// dynamic bits are vanilla JS hitting /admin/api/checkin/:id and /:code.

function html(s, status = 200) {
  return new Response(s, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
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
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return html(`<!DOCTYPE html><html><body><p>Bad event id.</p></body></html>`, 400);
  }

  const ev = await env.DB.prepare(
    `SELECT te.*, v.name AS venue_name FROM ticketed_events te
     JOIN venues v ON v.id = te.venue_id WHERE te.id = ?`,
  ).bind(id).first();
  if (!ev) {
    return html(`<!DOCTYPE html><html><body><p>Event not found.</p><p><a href="/admin/">Return to admin</a></p></body></html>`, 404);
  }

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#1f1d1a" />
  <title>Door — ${esc(ev.title)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/admin/checkin.css" />
</head>
<body class="door-body" data-event-id="${esc(id)}">
  <header class="door-bar">
    <div class="door-bar-inner">
      <div class="door-meta">
        <div class="eyebrow">Door</div>
        <h1>${esc(ev.title)}</h1>
        <div class="muted small">${esc(fmtDateTime(ev.starts_at))} &middot; ${esc(ev.location_name || ev.venue_name)}</div>
      </div>
      <a class="door-back muted small" href="/admin/">&larr; Admin</a>
    </div>
  </header>

  <main class="door-main">
    <div class="door-counts">
      <div class="count-tile"><span class="count-num" data-count="checked_in">—</span><span class="count-label">In</span></div>
      <div class="count-tile"><span class="count-num" data-count="remaining">—</span><span class="count-label">Remaining</span></div>
      <div class="count-tile"><span class="count-num" data-count="sold">—</span><span class="count-label">Sold</span></div>
    </div>

    <form id="checkin-form" class="door-form" autocomplete="off">
      <label for="code" class="visually-hidden">Ticket code</label>
      <input id="code" name="code" type="text"
             placeholder="ABCD-EFGHJK"
             autocapitalize="characters" autocorrect="off" spellcheck="false"
             inputmode="latin" required />
      <button type="submit" class="btn primary">Check in</button>
    </form>

    <div id="result" class="door-result" data-state="idle">
      <div class="result-icon" aria-hidden="true"></div>
      <div class="result-body">
        <div class="result-headline">Enter the ticket code above.</div>
        <div class="result-detail muted small">Recent check-ins appear below as you go.</div>
      </div>
      <button type="button" class="btn ghost small" data-action="undo" hidden>Undo</button>
    </div>

    <section class="door-recent">
      <div class="eyebrow">Recent check-ins</div>
      <div id="recent" class="recent-list">
        <div class="muted small">Loading&hellip;</div>
      </div>
    </section>
  </main>

  <script src="/admin/checkin.js"></script>
</body>
</html>`;
  return html(page);
}
