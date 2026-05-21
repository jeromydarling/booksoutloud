// Cloudflare Pages Function — POST /api/book
// Receives the booking form and forwards it to Resend.
//
// Required secret (set in Cloudflare dashboard or `wrangler pages secret put`):
//   RESEND_API_KEY
//
// Config vars (set in wrangler.toml [vars] or the dashboard):
//   BOOKING_TO_EMAIL   — destination inbox (e.g. jer@jeromydarling.com)
//   BOOKING_FROM_EMAIL — verified sender (e.g. "BooksOutLoud <booking@booksoutloud.org>")

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length < 255;
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json(400, { ok: false, message: 'Invalid request body.' });
  }

  // Honeypot — if a bot filled this hidden field, silently succeed.
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

  if (!env.RESEND_API_KEY) {
    return json(500, { ok: false, message: 'Email service is not configured. Please try again later.' });
  }

  const toEmail = env.BOOKING_TO_EMAIL || 'jer@jeromydarling.com';
  const fromEmail = env.BOOKING_FROM_EMAIL || 'BooksOutLoud <onboarding@resend.dev>';

  const subject = `Booking inquiry — ${program} — ${name}`;

  const textBody = [
    `New booking inquiry from booksoutloud.org`,
    ``,
    `Name:          ${name}`,
    `Email:         ${email}`,
    `Organization:  ${organization || '—'}`,
    `Program:       ${program}`,
    `Date / window: ${eventDate || '—'}`,
    `Audience:      ${audience || '—'}`,
    ``,
    `Message:`,
    message,
    ``,
    `—`,
    `Submitted: ${new Date().toISOString()}`,
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Georgia,serif; color:#1f1d1a; max-width:600px;">
      <h2 style="margin:0 0 16px;">New booking inquiry</h2>
      <p style="margin:0 0 14px; color:#655e55;">From booksoutloud.org</p>
      <table style="width:100%; border-collapse:collapse; font-size:15px;">
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Name</td><td style="padding:6px 0;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Organization</td><td style="padding:6px 0;">${escapeHtml(organization) || '—'}</td></tr>
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Program</td><td style="padding:6px 0;">${escapeHtml(program)}</td></tr>
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Date</td><td style="padding:6px 0;">${escapeHtml(eventDate) || '—'}</td></tr>
        <tr><td style="padding:6px 0; color:#8a6432; text-transform:uppercase; font-size:12px; letter-spacing:.16em;">Audience</td><td style="padding:6px 0;">${escapeHtml(audience) || '—'}</td></tr>
      </table>
      <h3 style="margin:22px 0 8px;">Message</h3>
      <div style="white-space:pre-wrap; border-left:3px solid #8a6432; padding:12px 16px; background:#f4efe4;">${escapeHtml(message)}</div>
      <p style="margin-top:24px; color:#8a8278; font-size:12px;">Submitted ${new Date().toISOString()}</p>
    </div>
  `;

  const payload = {
    from: fromEmail,
    to: [toEmail],
    reply_to: email,
    subject,
    text: textBody,
    html: htmlBody,
  };

  let resp;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json(502, { ok: false, message: 'Could not reach the email service. Please try again shortly.' });
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('Resend error', resp.status, detail);
    return json(502, { ok: false, message: 'Email service rejected the request. Please try again shortly.' });
  }

  return json(200, { ok: true, message: 'Thank you — your inquiry has been sent. You will hear back from Jeromy shortly.' });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS' } });
  }
  return json(405, { ok: false, message: 'Method not allowed.' });
}
