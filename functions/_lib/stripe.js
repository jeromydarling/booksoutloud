// Thin Stripe API client for Cloudflare Workers — no npm deps.
//
// Stripe wants form-encoded bodies with PHP-style bracket notation for nested
// objects (metadata[key]=value, payment_intent_data[transfer_data][destination]=acct_X).
// formEncode() handles that recursively.
//
// Webhook signature verification uses Web Crypto. Stripe signs
//   timestamp + "." + raw body
// with HMAC-SHA256 keyed on the endpoint secret, and sends the result in the
// Stripe-Signature header as t=...,v1=...

const STRIPE_API = 'https://api.stripe.com';

function formEncodeInto(params, value, key) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncodeInto(params, v, `${key}[${i}]`));
  } else if (typeof value === 'object') {
    for (const k of Object.keys(value)) formEncodeInto(params, value[k], `${key}[${k}]`);
  } else if (typeof value === 'boolean') {
    params.append(key, value ? 'true' : 'false');
  } else {
    params.append(key, String(value));
  }
}

export function formEncode(obj) {
  const params = new URLSearchParams();
  for (const k of Object.keys(obj || {})) formEncodeInto(params, obj[k], k);
  return params.toString();
}

export async function stripeRequest(env, path, params = null, opts = {}) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  const url = `${STRIPE_API}${path}`;
  const method = opts.method || (params ? 'POST' : 'GET');
  const headers = {
    'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Stripe-Version': '2024-06-20',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let body;
  if (params && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = formEncode(params);
  }
  const finalUrl = params && method === 'GET' ? `${url}?${formEncode(params)}` : url;
  const resp = await fetch(finalUrl, { method, headers, body });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok) {
    const msg = data?.error?.message || `Stripe ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.code = data?.error?.code;
    err.detail = data?.error;
    throw err;
  }
  return data;
}

// Webhook signature verification — returns true if valid, throws otherwise.
export async function verifyStripeSignature(payload, sigHeader, secret, toleranceSeconds = 300) {
  if (!sigHeader || !secret) throw new Error('Missing signature or secret.');
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => {
      const i = p.indexOf('=');
      return i < 0 ? [p, ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const timestamp = parts.t;
  const signatures = sigHeader
    .split(',')
    .filter(p => p.trim().startsWith('v1='))
    .map(p => p.trim().slice(3));
  if (!timestamp || !signatures.length) throw new Error('Malformed signature header.');

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) {
    throw new Error('Webhook timestamp outside tolerance.');
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(sigBytes)].map(b => b.toString(16).padStart(2, '0')).join('');

  // Constant-time-ish comparison; this is a hex string so length is the same.
  let ok = false;
  for (const sig of signatures) {
    if (sig.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  if (!ok) throw new Error('Signature mismatch.');
  return true;
}

// Generate a short, URL-safe ticket code.
export function generateTicketCode(len = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip I,O,0,1 for legibility
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.slice(0, 4) + '-' + out.slice(4);
}

// Slugify a title for the public URL.
export function slugify(s) {
  return String(s || '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
