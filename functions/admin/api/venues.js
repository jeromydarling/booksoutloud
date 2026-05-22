// /admin/api/venues
//   GET   — list venues
//   POST  — create a venue (does NOT yet create a Stripe account — see /onboard)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ALLOWED_FIELDS = ['name', 'contact_name', 'email', 'phone', 'address', 'default_split_pct', 'notes'];

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const where = [];
  const binds = [];
  if (q) {
    where.push('(v.name LIKE ? OR v.email LIKE ? OR v.contact_name LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  const sql = `
    SELECT v.*,
      (SELECT COUNT(*) FROM ticketed_events WHERE venue_id = v.id) AS event_count
    FROM venues v
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.created_at DESC
    LIMIT 500
  `;
  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(200, { ok: true, venues: results || [] });
  } catch (err) {
    console.error('venues list failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const name  = (data.name  || '').toString().trim();
  const email = (data.email || '').toString().trim().toLowerCase();
  if (!name)  return json(400, { ok: false, message: 'Venue name is required.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { ok: false, message: 'A valid contact email is required.' });
  }

  const fields = ['name', 'email'];
  const values = [name, email];
  for (const f of ALLOWED_FIELDS) {
    if (f === 'name' || f === 'email') continue;
    if (f in data) {
      let v = data[f];
      if (f === 'default_split_pct') {
        v = parseInt(v, 10);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return json(400, { ok: false, message: 'default_split_pct must be 0-100.' });
        }
      } else if (typeof v === 'string') {
        v = v.trim() || null;
      }
      fields.push(f);
      values.push(v);
    }
  }

  try {
    const placeholders = fields.map((_, i) => `?${i + 1}`).join(', ');
    const row = await env.DB.prepare(
      `INSERT INTO venues (${fields.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    ).bind(...values).first();
    return json(200, { ok: true, id: row.id });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return json(400, { ok: false, message: 'A venue with that Stripe account already exists.' });
    }
    console.error('venue create failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
