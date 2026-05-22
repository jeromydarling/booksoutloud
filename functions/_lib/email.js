// Shared Resend helper. Other Functions import sendEmail() and brand styling.

export const BRAND = {
  ink:   '#1f1d1a',
  paper: '#f7f2e6',
  muted: '#655e55',
  brass: '#8a6432',
  panel: '#f4efe4',
  font:  'Georgia, "Iowan Old Style", serif',
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function emailShell({ preheader, title, bodyHtml, footerHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(title || 'BooksOutLoud')}</title></head>
<body style="margin:0; padding:0; background:${BRAND.paper}; font-family:${BRAND.font}; color:${BRAND.ink};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:#fff; border:1px solid rgba(138,100,50,.18); box-shadow:0 16px 38px rgba(31,29,26,.08);">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-family:'Helvetica Neue',Arial,sans-serif; font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:${BRAND.brass};">BooksOutLoud &middot; Live literary performance</div>
        </td></tr>
        <tr><td style="padding:6px 32px 28px; color:${BRAND.ink}; font-size:16px; line-height:1.55;">
          ${bodyHtml}
        </td></tr>
        ${footerHtml ? `<tr><td style="padding:14px 32px 26px; border-top:1px solid rgba(138,100,50,.12); color:${BRAND.muted}; font-size:12px; line-height:1.6;">${footerHtml}</td></tr>` : ''}
      </table>
      <div style="margin-top:14px; font-family:'Helvetica Neue',Arial,sans-serif; font-size:11px; letter-spacing:.14em; color:${BRAND.muted};">booksoutloud.org</div>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendEmail(env, { from, to, replyTo, subject, text, html }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${detail}`);
  }
  return resp.json().catch(() => ({}));
}
