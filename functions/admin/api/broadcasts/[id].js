// /admin/api/broadcasts/:id
//   GET    — fetch a single broadcast (used for polling progress + reading body)
//   DELETE — remove a broadcast row from the history (no email recall)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  try {
    const row = await env.DB.prepare(
      `SELECT id, subject, body_md, body_html, body_text, status,
              total_recipients, sent_count, failed_count, failures,
              created_by, created_at, started_at, completed_at
       FROM broadcasts WHERE id = ?1`,
    ).bind(id).first();
    if (!row) return json(404, { ok: false, message: 'Not found.' });
    if (row.failures) {
      try { row.failures = JSON.parse(row.failures); } catch { /* keep raw */ }
    }
    return json(200, { ok: true, broadcast: row });
  } catch (err) {
    console.error('broadcast get failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    await env.DB.prepare(`DELETE FROM broadcasts WHERE id = ?1`).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('broadcast delete failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
