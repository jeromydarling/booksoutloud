// /admin/api/subscribers
//   GET                 — list active subscribers (?q=&status=&format=csv)
//   POST                — manually add a subscriber (Jeromy entered offline)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ALLOWED_STATUS = new Set(['active', 'unsubscribed', 'bounced', 'all']);

function csvEscape(s) {
  if (s == null) return '';
  const v = String(s);
  return /[,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'active';
  const q = (url.searchParams.get('q') || '').trim();
  const format = url.searchParams.get('format') || 'json';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 5000);

  const where = [];
  const binds = [];
  if (status !== 'all') {
    if (!ALLOWED_STATUS.has(status)) return json(400, { ok: false, message: 'Bad status.' });
    where.push('status = ?');
    binds.push(status);
  }
  if (q) {
    where.push('(email LIKE ? OR name LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like);
  }

  const sql = `
    SELECT id, email, name, source, status, created_at, updated_at, unsubscribed_at
    FROM subscribers
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  try {
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const rows = results || [];

    if (format === 'csv') {
      const header = ['email','name','source','status','created_at','unsubscribed_at'];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([r.email, r.name, r.source, r.status, r.created_at, r.unsubscribed_at].map(csvEscape).join(','));
      }
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(lines.join('\n') + '\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="subscribers-${stamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return json(200, { ok: true, subscribers: rows });
  } catch (err) {
    console.error('subscribers list failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const email = (data.email || '').toString().trim().toLowerCase();
  const name = (data.name || '').toString().trim() || null;
  const source = (data.source || 'manual').toString().trim().slice(0, 40);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { ok: false, message: 'A valid email is required.' });
  }

  try {
    const token = crypto.randomUUID();
    const existing = await env.DB.prepare(
      `SELECT id FROM subscribers WHERE email = ?1`,
    ).bind(email).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE subscribers
           SET status = 'active',
               unsubscribed_at = NULL,
               name = COALESCE(NULLIF(?2, ''), name),
               updated_at = datetime('now')
         WHERE id = ?1`,
      ).bind(existing.id, name).run();
      return json(200, { ok: true, id: existing.id, reactivated: true });
    }

    const inserted = await env.DB.prepare(
      `INSERT INTO subscribers (email, name, source, unsubscribe_token)
       VALUES (?1, ?2, ?3, ?4)
       RETURNING id`,
    ).bind(email, name, source, token).first();

    return json(200, { ok: true, id: inserted.id });
  } catch (err) {
    console.error('subscriber create failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
