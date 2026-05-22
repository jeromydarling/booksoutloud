// POST   /admin/api/ticketed-events/:id/door-token  — mint or rotate the token
// DELETE /admin/api/ticketed-events/:id/door-token  — revoke

import { mintDoorToken } from '../../../../_lib/door.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function siteUrl(env) {
  return env.SITE_URL || 'https://booksoutloud.org';
}

export async function onRequestPost({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  const ev = await env.DB.prepare(`SELECT id FROM ticketed_events WHERE id = ?`).bind(id).first();
  if (!ev) return json(404, { ok: false, message: 'Event not found.' });

  const token = mintDoorToken();
  try {
    await env.DB.prepare(
      `UPDATE ticketed_events SET door_token = ?2, updated_at = datetime('now') WHERE id = ?1`,
    ).bind(id, token).run();
    return json(200, { ok: true, token, url: `${siteUrl(env)}/door/${id}/${token}` });
  } catch (err) {
    console.error('door-token mint failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  try {
    await env.DB.prepare(
      `UPDATE ticketed_events SET door_token = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('door-token revoke failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestGet({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });
  const row = await env.DB.prepare(
    `SELECT door_token FROM ticketed_events WHERE id = ?`,
  ).bind(id).first();
  if (!row) return json(404, { ok: false, message: 'Event not found.' });
  if (!row.door_token) return json(200, { ok: true, token: null });
  return json(200, { ok: true, token: row.door_token, url: `${siteUrl(env)}/door/${id}/${row.door_token}` });
}
