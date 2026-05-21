// /admin/api/events
//   GET   — list events with optional ?status=&q=&limit=
//   POST  — create a new event (manual entry from the admin UI)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ALLOWED_STATUS = new Set(['inquiry','quoted','tentative','confirmed','performed','declined','canceled']);
const ALLOWED_SOURCE = new Set(['web','manual','email','phone','referral']);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const bucket = url.searchParams.get('bucket') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);

  const where = [];
  const binds = [];

  if (bucket === 'inquiries') {
    where.push(`e.status IN ('inquiry','quoted','tentative')`);
  } else if (bucket === 'upcoming') {
    where.push(`e.status = 'confirmed'`);
  } else if (bucket === 'history') {
    where.push(`e.status IN ('performed','declined','canceled')`);
  } else if (status && ALLOWED_STATUS.has(status)) {
    where.push(`e.status = ?`);
    binds.push(status);
  }

  if (q) {
    where.push(`(c.name LIKE ? OR c.email LIKE ? OR c.organization LIKE ? OR e.venue LIKE ?)`);
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }

  const orderBy = bucket === 'upcoming'
    ? `ORDER BY COALESCE(e.event_date, '9999') ASC, e.created_at DESC`
    : `ORDER BY e.created_at DESC`;

  const sql = `
    SELECT e.id, e.contact_id, e.program, e.event_date, e.venue, e.audience,
           e.message, e.notes, e.status, e.fee_cents, e.source,
           e.created_at, e.updated_at,
           c.name AS contact_name, c.email AS contact_email,
           c.organization AS contact_organization, c.phone AS contact_phone
    FROM events e
    JOIN contacts c ON c.id = e.contact_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ${orderBy}
    LIMIT ${limit}
  `;

  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(200, { ok: true, events: results || [] });
  } catch (err) {
    console.error('events list failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const name = (data.name || '').toString().trim();
  const email = (data.email || '').toString().trim().toLowerCase();
  if (!name) return json(400, { ok: false, message: 'Name is required.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { ok: false, message: 'A valid email is required.' });
  }

  const organization = (data.organization || '').toString().trim() || null;
  const phone = (data.phone || '').toString().trim() || null;
  const program = (data.program || '').toString().trim() || null;
  const event_date = (data.event_date || '').toString().trim() || null;
  const venue = (data.venue || '').toString().trim() || null;
  const audience = (data.audience || '').toString().trim() || null;
  const message = (data.message || '').toString().trim() || null;
  const notes = (data.notes || '').toString().trim() || null;

  const status = ALLOWED_STATUS.has(data.status) ? data.status : 'inquiry';
  const source = ALLOWED_SOURCE.has(data.source) ? data.source : 'manual';
  const fee_cents = Number.isFinite(+data.fee_cents) ? Math.max(0, Math.round(+data.fee_cents)) : null;

  try {
    const contact = await env.DB.prepare(
      `INSERT INTO contacts (name, email, organization, phone)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET
         name         = COALESCE(NULLIF(excluded.name, ''), contacts.name),
         organization = COALESCE(NULLIF(excluded.organization, ''), contacts.organization),
         phone        = COALESCE(NULLIF(excluded.phone, ''), contacts.phone),
         updated_at   = datetime('now')
       RETURNING id`
    ).bind(name, email, organization, phone).first();

    const result = await env.DB.prepare(
      `INSERT INTO events
         (contact_id, program, event_date, venue, audience, message, notes,
          status, fee_cents, source)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
       RETURNING id`
    ).bind(
      contact.id, program, event_date, venue, audience, message, notes,
      status, fee_cents, source,
    ).first();

    return json(200, { ok: true, id: result.id });
  } catch (err) {
    console.error('event create failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
