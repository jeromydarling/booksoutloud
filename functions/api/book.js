// Cloudflare Pages Function — POST /api/book
//
// Validates the booking form, writes the inquiry to D1 (CRM), and fires two
// emails in parallel via Resend:
//   1. A notification to Jeromy (BOOKING_TO_EMAIL) with the full inquiry.
//   2. An auto-reply to the inquirer confirming receipt.
//
// Required env:
//   RESEND_API_KEY     (secret)
//   BOOKING_TO_EMAIL   (default: jer@jeromydarling.com)
//   BOOKING_FROM_EMAIL (default: BooksOutLoud <onboarding@resend.dev>)
//   SITE_URL           (default: https://booksoutloud.org)
//   DB                 (D1 binding, optional — insert is best-effort)

import { sendEmail, emailShell, escapeHtml } from '../_lib/email.js';

const PROGRAM_LABELS = {
  'screwtape': 'The Screwtape Letters',
  'father-brown': 'Father Brown: Mystery and Faith',
  'seven-last-words': 'The Seven Last Words',
  'chesterton': 'Chesterton: Paradox and Wonder',
  'flannery': "Flannery O'Connor: Grace and Judgment",
  'conversion': 'Conversion: Augustine',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length < 255;
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'friend';
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json(400, { ok: false, message: 'Invalid request body.' });
  }

  // Honeypot — silently succeed if a bot filled the hidden field.
  if (data.company_url && String(data.company_url).trim() !== '') {
    return json(200, { ok: true, message: 'Thank you — your inquiry has been received.' });
  }

  const name = (data.name || '').toString().trim();
  const email = (data.email || '').toString().trim();
  const message = (data.message || '').toString().trim();

  if (!name || name.length > 200) {
    return json(400, { ok: false, message: 'Please include your name.' });
  }
  if (!validEmail(email)) {
    return json(400, { ok: false, message: 'Please include a valid email address.' });
  }
  if (!message || message.length > 5000) {
    return json(400, { ok: false, message: 'Please include a brief message.' });
  }

  const organization = (data.organization || '').toString().trim().slice(0, 200);
  const programKey = (data.program || '').toString().trim();
  const program = PROGRAM_LABELS[programKey] || (programKey ? programKey : 'No preference yet');
  const eventDate = (data.event_date || '').toString().trim().slice(0, 200);
  const audience = (data.audience || '').toString().trim().slice(0, 300);

  // D1 CRM insert — best-effort; never block the user-facing path.
  if (env.DB) {
    try {
      const contact = await env.DB.prepare(
        `INSERT INTO contacts (name, email, organization)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(email) DO UPDATE SET
           name         = COALESCE(NULLIF(excluded.name, ''), contacts.name),
           organization = COALESCE(NULLIF(excluded.organization, ''), contacts.organization),
           updated_at   = datetime('now')
         RETURNING id`,
      ).bind(name, email.toLowerCase(), organization || null).first();

      if (contact?.id) {
        await env.DB.prepare(
          `INSERT INTO events (contact_id, program, event_date, audience, message, source, status)
           VALUES (?1, ?2, ?3, ?4, ?5, 'web', 'inquiry')`,
        ).bind(contact.id, programKey || null, eventDate || null, audience || null, message).run();
      }
    } catch (err) {
      console.error('CRM insert failed', err);
    }
  }

  if (!env.RESEND_API_KEY) {
    return json(500, { ok: false, message: 'Email service is not configured. Please try again later.' });
  }

  const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';
  const toEmail   = env.BOOKING_TO_EMAIL   || 'jer@jeromydarling.com';
  const siteUrl   = env.SITE_URL           || 'https://booksoutloud.org';

  // ── 1. Notification to Jeromy ────────────────────────────────────────────
  const notifySubject = `Booking inquiry — ${program} — ${name}`;
  const notifyText = [
    'New booking inquiry from booksoutloud.org',
    '',
    `Name:          ${name}`,
    `Email:         ${email}`,
    `Organization:  ${organization || '—'}`,
    `Program:       ${program}`,
    `Date / window: ${eventDate || '—'}`,
    `Audience:      ${audience || '—'}`,
    '',
    'Message:',
    message,
    '',
    '—',
    `Submitted: ${new Date().toISOString()}`,
  ].join('\n');

  const row = (label, value) => `
    <tr>
      <td style="padding:6px 12px 6px 0; color:#8a6432; text-transform:uppercase; font-size:11px; letter-spacing:.18em; vertical-align:top; white-space:nowrap;">${label}</td>
      <td style="padding:6px 0; font-size:15px;">${value || '&mdash;'}</td>
    </tr>`;
  const notifyHtml = emailShell({
    preheader: `New inquiry from ${name} — ${program}`,
    title: notifySubject,
    bodyHtml: `
      <h2 style="margin:0 0 6px; font-size:1.5rem;">New booking inquiry</h2>
      <p style="margin:0 0 18px; color:#655e55;">From booksoutloud.org</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
        ${row('Name', escapeHtml(name))}
        ${row('Email', `<a href="mailto:${escapeHtml(email)}" style="color:#8a6432;">${escapeHtml(email)}</a>`)}
        ${row('Organization', escapeHtml(organization))}
        ${row('Program', escapeHtml(program))}
        ${row('Date', escapeHtml(eventDate))}
        ${row('Audience', escapeHtml(audience))}
      </table>
      <h3 style="margin:22px 0 8px; font-size:1rem; letter-spacing:.04em;">Message</h3>
      <div style="white-space:pre-wrap; border-left:3px solid #8a6432; padding:12px 16px; background:#f4efe4; font-size:15px;">${escapeHtml(message)}</div>
    `,
    footerHtml: `Submitted ${new Date().toISOString()}. Open the CRM at <a href="${siteUrl}/admin/" style="color:#8a6432;">${siteUrl}/admin/</a>.`,
  });

  // ── 2. Auto-reply to the inquirer ────────────────────────────────────────
  const replySubject = `Thanks for your note — Jeromy`;
  const greeting = `Dear ${firstName(name)},`;
  const replyText = [
    greeting,
    '',
    `Thanks for reaching out about BooksOutLoud. Your inquiry${programKey ? ` regarding ${program}` : ''} is in front of me, and I'll write back personally within 48 hours — sooner if I'm not on the road.`,
    '',
    'A few quick notes while you wait:',
    '',
    ` • You can browse the full repertoire at ${siteUrl}/performances.html`,
    ' • For Lent or Holy Week, lead time is typically 2–3 months; for most other seasons a few weeks is enough.',
    ' • If your budget feels unusual (a small parish, a large diocesan event, an unusual venue), just say so when you reply — we will find a fit.',
    '',
    'Warmly,',
    'Jeromy Darling',
    'BooksOutLoud',
  ].join('\n');

  const replyHtml = emailShell({
    preheader: 'Your inquiry is in front of me — I will write personally within 48 hours.',
    title: replySubject,
    bodyHtml: `
      <p style="margin:0 0 16px;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 14px;">Thanks for reaching out about BooksOutLoud. Your inquiry${programKey ? ` regarding <em>${escapeHtml(program)}</em>` : ''} is in front of me, and I&rsquo;ll write back personally within 48 hours &mdash; sooner if I&rsquo;m not on the road.</p>
      <p style="margin:18px 0 8px; color:#8a6432; font-size:11px; letter-spacing:.18em; text-transform:uppercase;">A few quick notes while you wait</p>
      <ul style="margin:0 0 14px; padding-left:20px; color:#1f1d1a;">
        <li style="margin-bottom:8px;">You can browse the full repertoire at <a href="${siteUrl}/performances.html" style="color:#8a6432;">${siteUrl}/performances.html</a>.</li>
        <li style="margin-bottom:8px;">For Lent or Holy Week dates, lead time is typically 2&ndash;3 months; for most other seasons a few weeks is enough.</li>
        <li style="margin-bottom:8px;">If your budget feels unusual (a small parish, a large diocesan event, an unusual venue), just say so when you reply &mdash; we&rsquo;ll find a fit.</li>
      </ul>
      <p style="margin:22px 0 4px;">Warmly,</p>
      <p style="margin:0; font-style:italic;">Jeromy Darling</p>
      <p style="margin:0; color:#655e55; font-size:13px;">BooksOutLoud &middot; <a href="${siteUrl}" style="color:#8a6432;">booksoutloud.org</a></p>
    `,
    footerHtml: `You&rsquo;re receiving this because you submitted the booking form at <a href="${siteUrl}" style="color:#8a6432;">booksoutloud.org</a>. If this wasn&rsquo;t you, simply ignore the message.`,
  });

  // Fire both in parallel. If the auto-reply fails (e.g. Resend rejects an
  // unverified domain), log it but still return success — Jeromy got the notice.
  const [notifyResult, replyResult] = await Promise.allSettled([
    sendEmail(env, {
      from: fromEmail,
      to: toEmail,
      replyTo: email,
      subject: notifySubject,
      text: notifyText,
      html: notifyHtml,
    }),
    sendEmail(env, {
      from: fromEmail,
      to: email,
      replyTo: toEmail,
      subject: replySubject,
      text: replyText,
      html: replyHtml,
    }),
  ]);

  if (notifyResult.status === 'rejected') {
    console.error('Booking notification failed', notifyResult.reason);
    return json(502, { ok: false, message: 'Email service rejected the request. Please try again shortly.' });
  }
  if (replyResult.status === 'rejected') {
    console.error('Auto-reply failed', replyResult.reason);
  }

  return json(200, {
    ok: true,
    message: 'Thank you — your inquiry has been sent. Check your inbox for a confirmation; Jeromy will follow up personally within 48 hours.',
  });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  }
  return json(405, { ok: false, message: 'Method not allowed.' });
}
