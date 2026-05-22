// POST /api/subscribe
//
// Adds an email to the subscribers table, sends a welcome email with an
// unsubscribe link, and pings Jeromy that a new subscriber arrived.
// Idempotent on email: a second submission re-activates a previously
// unsubscribed address but does not re-send the welcome.

import { sendEmail, emailShell, escapeHtml } from '../_lib/email.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length < 255;
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid request body.' }); }

  if (data.company_url && String(data.company_url).trim() !== '') {
    return json(200, { ok: true, message: 'Thank you — you are on the list.' });
  }

  const email = (data.email || '').toString().trim().toLowerCase();
  const name = (data.name || '').toString().trim().slice(0, 200) || null;
  const source = (data.source || 'web').toString().trim().slice(0, 40) || 'web';

  if (!validEmail(email)) {
    return json(400, { ok: false, message: 'Please enter a valid email address.' });
  }
  if (!env.DB) {
    return json(500, { ok: false, message: 'Subscriber database is not configured.' });
  }

  const token = crypto.randomUUID();
  let isNew = true;
  let subscriberId = null;

  try {
    // Try to insert; if email already exists, reactivate and re-issue token.
    const existing = await env.DB.prepare(
      `SELECT id, status FROM subscribers WHERE email = ?1`,
    ).bind(email).first();

    if (existing) {
      isNew = false;
      subscriberId = existing.id;
      if (existing.status !== 'active') {
        await env.DB.prepare(
          `UPDATE subscribers
             SET status = 'active',
                 unsubscribed_at = NULL,
                 unsubscribe_token = ?2,
                 name = COALESCE(NULLIF(?3, ''), name),
                 updated_at = datetime('now')
           WHERE id = ?1`,
        ).bind(existing.id, token, name).run();
      } else if (name) {
        await env.DB.prepare(
          `UPDATE subscribers SET name = ?2, updated_at = datetime('now') WHERE id = ?1`,
        ).bind(existing.id, name).run();
      }
    } else {
      const inserted = await env.DB.prepare(
        `INSERT INTO subscribers (email, name, source, unsubscribe_token)
         VALUES (?1, ?2, ?3, ?4)
         RETURNING id`,
      ).bind(email, name, source, token).first();
      subscriberId = inserted.id;
    }
  } catch (err) {
    console.error('subscriber insert failed', err);
    return json(500, { ok: false, message: 'Could not save your subscription. Please try again shortly.' });
  }

  if (!env.RESEND_API_KEY) {
    // Subscription is saved, we just can't email a confirmation. Treat as success.
    return json(200, {
      ok: true,
      message: 'Thank you — you are on the list. (Confirmation email is temporarily unavailable.)',
    });
  }

  const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';
  const toEmail   = env.BOOKING_TO_EMAIL   || 'jer@jeromydarling.com';
  const siteUrl   = env.SITE_URL           || 'https://booksoutloud.org';
  const unsubUrl  = `${siteUrl}/api/unsubscribe?id=${subscriberId}&token=${encodeURIComponent(token)}`;

  // Welcome email — only on first signup or reactivation.
  const welcomeSubject = 'Welcome to the BooksOutLoud Salon';
  const welcomeText = [
    `Welcome${name ? ', ' + name.split(/\s+/)[0] : ''} —`,
    '',
    'Thanks for joining the BooksOutLoud list. A few times a year I will send a short dispatch: what I am reading aloud, where I will be performing next, and the occasional private recording.',
    '',
    'Nothing else. No promos, no rented lists.',
    '',
    `If you change your mind any time, you can unsubscribe with one click:`,
    unsubUrl,
    '',
    'Warmly,',
    'Jeromy Darling',
    'BooksOutLoud',
    siteUrl,
  ].join('\n');

  const welcomeHtml = emailShell({
    preheader: 'A few times a year — what I am reading aloud, where I will be performing, the occasional recording.',
    title: welcomeSubject,
    bodyHtml: `
      <h2 style="margin:0 0 14px; font-size:1.5rem;">Welcome to the Salon</h2>
      <p style="margin:0 0 14px;">Thanks for joining the BooksOutLoud list. A few times a year I&rsquo;ll send a short dispatch: what I&rsquo;m reading aloud, where I&rsquo;ll be performing next, and the occasional private recording.</p>
      <p style="margin:0 0 14px; color:#655e55;"><em>Nothing else. No promos, no rented lists.</em></p>
      <p style="margin:22px 0 4px;">Warmly,</p>
      <p style="margin:0; font-style:italic;">Jeromy Darling</p>
      <p style="margin:0; color:#655e55; font-size:13px;">BooksOutLoud &middot; <a href="${siteUrl}" style="color:#8a6432;">booksoutloud.org</a></p>
    `,
    footerHtml: `You&rsquo;re receiving this because you signed up at booksoutloud.org. <a href="${unsubUrl}" style="color:#8a6432;">Unsubscribe</a> any time.`,
  });

  // Internal ping so Jeromy sees signups in real time. Kept minimal.
  const notifySubject = `New subscriber — ${email}`;
  const notifyHtml = emailShell({
    preheader: `${email} just joined the list.`,
    title: notifySubject,
    bodyHtml: `
      <h2 style="margin:0 0 12px; font-size:1.3rem;">New subscriber</h2>
      <p style="margin:0; font-size:15px;"><strong>${escapeHtml(email)}</strong>${name ? ' &middot; ' + escapeHtml(name) : ''}</p>
      <p style="margin:8px 0 0; color:#655e55; font-size:13px;">Source: ${escapeHtml(source)} &middot; ${isNew ? 'first signup' : 'reactivated'}</p>
    `,
    footerHtml: `Manage the list at <a href="${siteUrl}/admin/" style="color:#8a6432;">${siteUrl}/admin/</a>.`,
  });

  const sends = [
    sendEmail(env, {
      from: fromEmail,
      to: toEmail,
      subject: notifySubject,
      text: `${email}${name ? ' (' + name + ')' : ''} just subscribed.`,
      html: notifyHtml,
    }),
  ];
  if (isNew || data.force_welcome) {
    sends.unshift(sendEmail(env, {
      from: fromEmail,
      to: email,
      replyTo: toEmail,
      subject: welcomeSubject,
      text: welcomeText,
      html: welcomeHtml,
    }));
  }

  const results = await Promise.allSettled(sends);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error('subscribe email failed', i, r.reason);
  });

  return json(200, {
    ok: true,
    message: isNew
      ? 'Thank you — you are on the list. Check your inbox for a welcome note.'
      : 'You are already on the list. Welcome back.',
  });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  }
  return json(405, { ok: false, message: 'Method not allowed.' });
}
