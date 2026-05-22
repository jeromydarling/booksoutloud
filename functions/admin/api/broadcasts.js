// /admin/api/broadcasts
//   GET   — list past broadcasts
//   POST  — create a broadcast (or send a test) and dispatch in the background

import { sendEmail, emailShell } from '../../_lib/email.js';
import { sanitizeHtml, styleHtmlForEmail, htmlToPlainText } from '../../_lib/htmlsafe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const SEND_DELAY_MS = 110; // ~9 sends/sec — Resend default rate limit is 10/sec.

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, subject, status, total_recipients, sent_count, failed_count,
              created_at, started_at, completed_at, created_by,
              SUBSTR(body_text, 1, 240) AS preview
       FROM broadcasts ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json(200, { ok: true, broadcasts: results || [] });
  } catch (err) {
    console.error('broadcasts list failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const subject = (data.subject || '').toString().trim();
  const rawHtml = (data.body_html || data.body || '').toString();
  const mode    = data.mode === 'test' ? 'test' : 'broadcast';

  if (!subject || subject.length > 250) {
    return json(400, { ok: false, message: 'Subject is required (max 250 chars).' });
  }
  if (!rawHtml.trim() || rawHtml.length > 200_000) {
    return json(400, { ok: false, message: 'Body is required (max 200,000 chars of HTML).' });
  }

  const cleanHtml = sanitizeHtml(rawHtml);
  if (!cleanHtml.replace(/<[^>]+>/g, '').trim()) {
    return json(400, { ok: false, message: 'Body looks empty after sanitization.' });
  }
  const styledHtml = styleHtmlForEmail(cleanHtml);
  const plainText  = htmlToPlainText(cleanHtml);
  const createdBy  = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase() || null;

  if (mode === 'test') {
    const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';
    const toEmail   = env.BOOKING_TO_EMAIL   || 'jer@jeromydarling.com';
    const siteUrl   = env.SITE_URL           || 'https://booksoutloud.org';
    const unsubUrl  = `${siteUrl}/api/unsubscribe?id=0&token=preview`;
    try {
      await sendEmail(env, {
        from: fromEmail,
        to: toEmail,
        replyTo: toEmail,
        subject: `[TEST] ${subject}`,
        text: composeFinalText(plainText, unsubUrl, siteUrl, true),
        html: composeFinalHtml(subject, styledHtml, unsubUrl, siteUrl, true),
      });
      return json(200, { ok: true, message: 'Test sent.' });
    } catch (err) {
      console.error('test send failed', err);
      return json(502, { ok: false, message: err.message });
    }
  }

  let recipients = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, unsubscribe_token FROM subscribers WHERE status = 'active'`,
    ).all();
    recipients = results || [];
  } catch (err) {
    console.error('recipient query failed', err);
    return json(500, { ok: false, message: 'Could not load recipients.' });
  }
  if (!recipients.length) {
    return json(400, { ok: false, message: 'No active subscribers to send to yet.' });
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO broadcasts (subject, body_html, body_text, status, total_recipients, created_by)
     VALUES (?1, ?2, ?3, 'pending', ?4, ?5)
     RETURNING id`,
  ).bind(subject, cleanHtml, plainText, recipients.length, createdBy).first();

  const broadcastId = inserted.id;
  ctx.waitUntil(sendBroadcast(env, broadcastId, subject, styledHtml, plainText, recipients));

  return json(200, { ok: true, broadcastId, total: recipients.length });
}

function composeFinalHtml(subject, styledBodyHtml, unsubUrl, siteUrl, isTest) {
  return emailShell({
    preheader: isTest ? 'Preview send' : undefined,
    title: subject,
    bodyHtml: `<div style="font-size:16px; color:#1f1d1a;">${styledBodyHtml}</div>`,
    footerHtml: `You&rsquo;re receiving this because you joined the BooksOutLoud Salon dispatch at <a href="${siteUrl}" style="color:#8a6432;">booksoutloud.org</a>. <a href="${unsubUrl}" style="color:#8a6432;">Unsubscribe</a> any time.`,
  });
}

function composeFinalText(plainText, unsubUrl, siteUrl, isTest) {
  const head = isTest ? '[TEST — preview send]\n\n' : '';
  return `${head}${plainText}\n\n—\nBooksOutLoud · ${siteUrl}\nUnsubscribe: ${unsubUrl}\n`;
}

async function sendBroadcast(env, broadcastId, subject, styledHtml, plainText, recipients) {
  const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';
  const replyTo   = env.BOOKING_TO_EMAIL   || 'jer@jeromydarling.com';
  const siteUrl   = env.SITE_URL           || 'https://booksoutloud.org';

  await env.DB.prepare(
    `UPDATE broadcasts SET status = 'sending', started_at = datetime('now') WHERE id = ?1`,
  ).bind(broadcastId).run();

  const failures = [];
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const unsubUrl = `${siteUrl}/api/unsubscribe?id=${r.id}&token=${encodeURIComponent(r.unsubscribe_token)}`;
    try {
      await sendEmail(env, {
        from: fromEmail,
        to: r.email,
        replyTo,
        subject,
        text: composeFinalText(plainText, unsubUrl, siteUrl, false),
        html: composeFinalHtml(subject, styledHtml, unsubUrl, siteUrl, false),
      });
      sent++;
    } catch (err) {
      failures.push({ email: r.email, error: String(err.message || err).slice(0, 240) });
      console.error('broadcast send failed for', r.email, err);
    }

    if (sent % 5 === 0 || failures.length % 5 === 0) {
      try {
        await env.DB.prepare(
          `UPDATE broadcasts SET sent_count = ?2, failed_count = ?3 WHERE id = ?1`,
        ).bind(broadcastId, sent, failures.length).run();
      } catch (e) { console.error('progress update failed', e); }
    }
    if (i < recipients.length - 1) {
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
  }

  const finalStatus = failures.length === recipients.length ? 'failed' : 'sent';
  try {
    await env.DB.prepare(
      `UPDATE broadcasts
         SET status = ?2, sent_count = ?3, failed_count = ?4, failures = ?5, completed_at = datetime('now')
       WHERE id = ?1`,
    ).bind(
      broadcastId, finalStatus, sent, failures.length,
      failures.length ? JSON.stringify(failures.slice(0, 200)) : null,
    ).run();
  } catch (err) {
    console.error('final broadcast update failed', err);
  }
}
