// POST /admin/api/broadcasts/preview
//
// Server-side Markdown rendering. The browser also renders Markdown live for
// the composer, but the canonical render comes from here so what Jeromy sees
// in preview is what subscribers will receive.

import { renderMarkdownToHtml, renderMarkdownToText } from '../../../_lib/markdown.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }
  const body = (data.body || '').toString();
  if (body.length > 50_000) return json(400, { ok: false, message: 'Body too long.' });
  return json(200, {
    ok: true,
    html: renderMarkdownToHtml(body),
    text: renderMarkdownToText(body),
  });
}
