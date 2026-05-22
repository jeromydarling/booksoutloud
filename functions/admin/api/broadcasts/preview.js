// POST /admin/api/broadcasts/preview
//
// Server-side sanitize + style + plain-text extraction. The browser editor
// is constrained, but this is the canonical pipeline — what the preview
// pane shows for the right side of the composer.

import { sanitizeHtml, styleHtmlForEmail, htmlToPlainText } from '../../../_lib/htmlsafe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }
  const raw = (data.body_html || data.body || '').toString();
  if (raw.length > 200_000) return json(400, { ok: false, message: 'Body too long.' });
  const safe = sanitizeHtml(raw);
  return json(200, {
    ok: true,
    html: styleHtmlForEmail(safe),
    raw_safe: safe,
    text: htmlToPlainText(safe),
  });
}
