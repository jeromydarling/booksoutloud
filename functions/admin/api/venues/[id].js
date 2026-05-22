// /admin/api/venues/:id  — GET / PATCH / DELETE

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const EDITABLE = ['name', 'contact_name', 'email', 'phone', 'address', 'default_split_pct', 'notes'];

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    const row = await env.DB.prepare(`SELECT * FROM venues WHERE id = ?`).bind(id).first();
    if (!row) return json(404, { ok: false, message: 'Not found.' });
    return json(200, { ok: true, venue: row });
  } catch (err) {
    console.error('venue get failed', err);
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
      if (f === 'default_split_pct') {
        v = parseInt(v, 10);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return json(400, { ok: false, message: 'default_split_pct must be 0-100.' });
        }
      } else if (typeof v === 'string') {
        v = v.trim() || null;
        if (f === 'email' && v) v = v.toLowerCase();
      }
      sets.push(`${f} = ?`);
      binds.push(v);
    }
  }
  if (!sets.length) return json(400, { ok: false, message: 'Nothing to update.' });
  sets.push(`updated_at = datetime('now')`);
  binds.push(id);
  try {
    await env.DB.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('venue patch failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    const used = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ticketed_events WHERE venue_id = ?`,
    ).bind(id).first();
    if (used.n > 0) {
      return json(400, { ok: false, message: 'Venue has ticketed events; cancel or delete those first.' });
    }
    await env.DB.prepare(`DELETE FROM venues WHERE id = ?`).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('venue delete failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
