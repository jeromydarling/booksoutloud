// GET /api/unsubscribe?id=<n>&token=<uuid>
//
// Marks a subscriber as 'unsubscribed' and shows a small styled confirmation
// page. The token is the per-subscriber UUID issued at signup time, so
// forwarded emails can't be used to unsubscribe someone else en masse.

import { BRAND } from '../_lib/email.js';

function htmlPage(message, sub) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>BooksOutLoud — Unsubscribe</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="page-hero" style="padding:80px 0 100px;">
    <div class="wrap" style="max-width:560px;">
      <div class="eyebrow">Newsletter</div>
      <h1 style="margin:6px 0 14px; font-size:2.2rem; letter-spacing:-.02em;">${message}</h1>
      ${sub ? `<p class="muted">${sub}</p>` : ''}
      <p style="margin-top:28px;"><a class="btn ghost small" href="/">Return to BooksOutLoud</a></p>
    </div>
  </main>
</body>
</html>`, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '', 10);
  const token = (url.searchParams.get('token') || '').trim();

  if (!Number.isInteger(id) || id <= 0 || !token) {
    return htmlPage(
      'This unsubscribe link is incomplete.',
      'If you intended to unsubscribe, reply to any BooksOutLoud email and Jeromy will remove you by hand.',
    );
  }
  if (!env.DB) {
    return htmlPage('Subscriber database is not configured.', 'Please try again later.');
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, email, status, unsubscribe_token FROM subscribers WHERE id = ?1`,
    ).bind(id).first();

    if (!row || row.unsubscribe_token !== token) {
      return htmlPage(
        'This unsubscribe link is invalid or has expired.',
        'If you intended to unsubscribe, reply to any BooksOutLoud email and Jeromy will remove you by hand.',
      );
    }

    if (row.status === 'unsubscribed') {
      return htmlPage('You are already unsubscribed.', `${row.email} will not receive any more newsletters.`);
    }

    await env.DB.prepare(
      `UPDATE subscribers
         SET status = 'unsubscribed',
             unsubscribed_at = datetime('now'),
             updated_at = datetime('now')
       WHERE id = ?1`,
    ).bind(id).run();

    return htmlPage(
      'You have been unsubscribed.',
      `${row.email} will not receive any more newsletters. Sorry to see you go.`,
    );
  } catch (err) {
    console.error('unsubscribe failed', err);
    return htmlPage('Something went wrong.', 'Please reply to any BooksOutLoud email and Jeromy will remove you by hand.');
  }
}

export async function onRequest() {
  return new Response(null, { status: 405, headers: { 'Allow': 'GET' } });
}
