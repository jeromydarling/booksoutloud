// POST /admin/api/setup/stripe
//
// In-browser Stripe setup. Takes a Stripe secret key + a Cloudflare API token
// from the wizard form, creates the webhook on Stripe, writes both secrets
// to the Pages project's env (Production + Preview), and triggers a redeploy.
//
// The CF API token is used in this single request and discarded. The Stripe
// key is persisted as an encrypted Pages env var by design.

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const DEFAULT_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'account.updated',
];

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const stripeKey = String(data.stripe_secret_key || '').trim();
  const cfToken   = String(data.cloudflare_api_token || '').trim();
  const cfAccount = String(data.cloudflare_account_id || '').trim();
  const project   = String(data.project || '').trim();
  const webhookUrl = String(data.webhook_url || '').trim();
  const replace   = !!data.replace;
  const events    = Array.isArray(data.events) && data.events.length ? data.events : DEFAULT_EVENTS;

  if (!stripeKey.startsWith('sk_')) return json(400, { ok: false, message: 'Stripe key must start with sk_test_ or sk_live_.' });
  if (!cfToken)                     return json(400, { ok: false, message: 'Cloudflare API token is required.' });
  if (!cfAccount)                   return json(400, { ok: false, message: 'Cloudflare account id is required.' });
  if (!project)                     return json(400, { ok: false, message: 'Pages project name is required.' });
  if (!/^https?:\/\//.test(webhookUrl)) return json(400, { ok: false, message: 'Webhook URL must be http(s).' });

  const log = [];
  const note = (m) => { log.push(m); };

  // 1. Stripe webhook handling.
  let webhookSecret = null;
  let stripeWebhookId = null;
  try {
    note(`Looking for an existing Stripe webhook at ${webhookUrl}…`);
    const existing = await findStripeWebhookByUrl(stripeKey, webhookUrl);

    if (existing && !replace) {
      return json(409, {
        ok: false, code: 'webhook_exists',
        message: `A Stripe webhook for ${webhookUrl} already exists (${existing.id}). Stripe never re-exposes the signing secret after creation, so either reuse the existing whsec_… from Stripe's dashboard, or pass "replace": true to delete and recreate it.`,
        existing_id: existing.id, log,
      });
    }
    if (existing && replace) {
      note(`Deleting existing webhook ${existing.id}…`);
      await stripeFetch(stripeKey, `/v1/webhook_endpoints/${existing.id}`, { method: 'DELETE' });
    }
    note(`Creating Stripe webhook…`);
    const createdParams = new URLSearchParams();
    createdParams.set('url', webhookUrl);
    createdParams.set('description', `Auto-provisioned by BooksOutLoud setup wizard for ${project}`);
    events.forEach((e, i) => createdParams.append(`enabled_events[${i}]`, e));
    const created = await stripeFetch(stripeKey, `/v1/webhook_endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createdParams.toString(),
    });
    webhookSecret = created.secret;
    stripeWebhookId = created.id;
    note(`Webhook created: ${created.id}.`);
  } catch (err) {
    return json(502, { ok: false, message: `Stripe: ${err.message}`, log });
  }

  // 2. Cloudflare: read existing env, merge new, PATCH, redeploy.
  try {
    note(`Reading Pages project…`);
    const proj = await cfFetch(cfToken, cfAccount, `/pages/projects/${project}`);
    const existingProd    = proj.deployment_configs?.production?.env_vars || {};
    const existingPreview = proj.deployment_configs?.preview?.env_vars || {};

    const newVars = {
      STRIPE_SECRET_KEY:     { type: 'secret_text', value: stripeKey },
      STRIPE_WEBHOOK_SECRET: { type: 'secret_text', value: webhookSecret },
    };

    note(`Writing STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to Production and Preview…`);
    await cfFetch(cfToken, cfAccount, `/pages/projects/${project}`, {
      method: 'PATCH',
      body: JSON.stringify({
        deployment_configs: {
          production: { env_vars: { ...existingProd,    ...newVars } },
          preview:    { env_vars: { ...existingPreview, ...newVars } },
        },
      }),
    });

    note(`Triggering redeploy…`);
    const deploy = await cfFetch(cfToken, cfAccount, `/pages/projects/${project}/deployments`, { method: 'POST' });
    note(`Deployment queued: ${deploy?.id || deploy?.url || 'ok'}.`);
  } catch (err) {
    return json(502, { ok: false, message: `Cloudflare: ${err.message}`, log });
  }

  return json(200, {
    ok: true,
    message: 'Stripe is wired. The redeploy is in flight — wait ~30 s for it to finish, then test a $1 ticket.',
    stripe_webhook_id: stripeWebhookId,
    log,
  });
}

async function stripeFetch(key, path, init = {}) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function findStripeWebhookByUrl(key, url) {
  let startingAfter = null;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ limit: '100', ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const page = await stripeFetch(key, `/v1/webhook_endpoints?${qs}`);
    const found = (page.data || []).find(w => w.url === url);
    if (found) return found;
    if (!page.has_more) return null;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return null;
}

async function cfFetch(token, accountId, path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok || data?.success === false) {
    const errs = (data?.errors || []).map(e => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(errs);
  }
  return data?.result ?? data;
}
