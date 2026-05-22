// /admin/api/subscribers/:id
//   PATCH  — change status (unsubscribe / reactivate) or edit name
//   DELETE — hard delete the row

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ALLOWED_STATUS = new Set(['active','unsubscribed','bounced']);

export async function onRequestPatch({ request, params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const sets = [];
  const binds = [];

  if ('status' in data) {
    if (!ALLOWED_STATUS.has(data.status)) return json(400, { ok: false, message: 'Invalid status.' });
    sets.push('status = ?');
    binds.push(data.status);
    if (data.status === 'unsubscribed') sets.push(`unsubscribed_at = datetime('now')`);
    if (data.status === 'active')       sets.push(`unsubscribed_at = NULL`);
  }
  if ('name' in data) {
    sets.push('name = ?');
    binds.push((data.name || '').toString().trim() || null);
  }

  if (!sets.length) return json(400, { ok: false, message: 'Nothing to update.' });

  sets.push(`updated_at = datetime('now')`);
  binds.push(id);

  try {
    await env.DB.prepare(`UPDATE subscribers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('subscriber patch failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    await env.DB.prepare(`DELETE FROM subscribers WHERE id = ?`).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('subscriber delete failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
