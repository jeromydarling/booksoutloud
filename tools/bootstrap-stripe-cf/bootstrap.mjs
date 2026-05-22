#!/usr/bin/env node
// bootstrap-stripe-cf — provision a Stripe webhook + write its signing secret
// (plus your Stripe secret key) into a Cloudflare Pages project, then trigger
// a redeploy. Idempotent on rerun. No npm deps; needs Node 18+ for fetch.
//
// One-time per machine: set these in your shell (e.g. ~/.zshenv or a 1Password
// shell-plugin file). The script reads them on every invocation.
//
//   export STRIPE_SECRET_KEY=sk_live_...         # the project's Stripe key
//   export CLOUDFLARE_API_TOKEN=...              # Cloudflare API token with
//                                                # "Cloudflare Pages: Edit"
//   export CLOUDFLARE_ACCOUNT_ID=...             # your Cloudflare account id
//
// Per project:
//
//   node bootstrap.mjs \
//     --project=booksoutloud \
//     --url=https://booksoutloud.org/api/webhooks/stripe
//
// Optional:
//
//   --events=checkout.session.completed,...      override the default event set
//   --description="..."                          shown in the Stripe dashboard
//   --replace                                    delete + recreate if a webhook
//                                                already exists for this URL
//   --no-redeploy                                skip the redeploy at the end
//   --dry-run                                    print the plan, change nothing
//   --no-confirm                                 skip the LIVE-mode confirmation

import { parseArgs } from 'node:util';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const DEFAULT_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'account.updated',
];

let parsed;
try {
  parsed = parseArgs({
    options: {
      project:       { type: 'string' },
      url:           { type: 'string' },
      events:        { type: 'string' },
      description:   { type: 'string' },
      replace:       { type: 'boolean', default: false },
      'no-redeploy': { type: 'boolean', default: false },
      'dry-run':     { type: 'boolean', default: false },
      'no-confirm':  { type: 'boolean', default: false },
      help:          { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
} catch (err) {
  die(err.message);
}
const args = parsed.values;

if (args.help || !args.project || !args.url) {
  console.log(usage());
  process.exit(args.help ? 0 : 1);
}

const STRIPE_SECRET_KEY    = required('STRIPE_SECRET_KEY');
const CLOUDFLARE_API_TOKEN = required('CLOUDFLARE_API_TOKEN');
const CLOUDFLARE_ACCOUNT_ID = required('CLOUDFLARE_ACCOUNT_ID');

const events = (args.events ? args.events.split(',') : DEFAULT_EVENTS).map(s => s.trim()).filter(Boolean);
const description = args.description || `Auto-provisioned by bootstrap-stripe-cf for ${args.project}`;
const mode = STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST';

note(`Project   : ${args.project}`);
note(`Webhook   : ${args.url}`);
note(`Events    : ${events.join(', ')}`);
note(`Stripe key: ${mask(STRIPE_SECRET_KEY)} (${mode} mode)`);
note(`Redeploy  : ${args['no-redeploy'] ? 'no' : 'yes'}`);
if (args['dry-run']) note(`Mode      : DRY RUN — no changes`);

if (mode === 'LIVE' && !args['no-confirm'] && !args['dry-run']) {
  const rl = createInterface({ input: stdin, output: stdout });
  const confirm = await rl.question(`\nLIVE mode. Type "yes" to proceed: `);
  rl.close();
  if (confirm.trim() !== 'yes') die('Aborted.');
}

// ─── Stripe: webhook endpoint ────────────────────────────────────────────
section('1. Stripe webhook endpoint');

const existing = await findStripeWebhookByUrl(args.url);
let whSecret = null;

if (existing && !args.replace) {
  warn(`A webhook for ${args.url} already exists (${existing.id}).`);
  warn(`Stripe never re-exposes the signing secret after creation. Pass`);
  warn(`--replace to delete and recreate it, OR retrieve the secret from`);
  warn(`the dashboard and skip this script.`);
  if (!args['dry-run']) die('Refusing to continue without --replace.');
} else {
  if (existing && args.replace) {
    note(`Deleting existing webhook ${existing.id}`);
    if (!args['dry-run']) await stripeDelete(`/v1/webhook_endpoints/${existing.id}`);
  }
  note(`Creating webhook…`);
  if (!args['dry-run']) {
    const created = await stripePost('/v1/webhook_endpoints', {
      url: args.url,
      description,
      ...Object.fromEntries(events.map((e, i) => [`enabled_events[${i}]`, e])),
    });
    whSecret = created.secret;
    ok(`Created ${created.id}`);
    ok(`Signing secret: ${mask(whSecret)} (captured — never visible again)`);
  } else {
    whSecret = 'whsec_DRYRUN';
    ok(`(dry run) would create webhook`);
  }
}

// ─── Cloudflare: write env vars ──────────────────────────────────────────
section('2. Cloudflare Pages env vars');

note(`Reading existing project config…`);
const project = args['dry-run']
  ? { deployment_configs: { production: { env_vars: {} }, preview: { env_vars: {} } } }
  : await cfGet(`/pages/projects/${args.project}`);
const existingProd = project.deployment_configs?.production?.env_vars || {};
const existingPreview = project.deployment_configs?.preview?.env_vars || {};

const newVars = {
  STRIPE_SECRET_KEY:     { type: 'secret_text', value: STRIPE_SECRET_KEY },
  STRIPE_WEBHOOK_SECRET: { type: 'secret_text', value: whSecret },
};

const mergedProd    = { ...existingProd,    ...newVars };
const mergedPreview = { ...existingPreview, ...newVars };

note(`Writing STRIPE_SECRET_KEY (encrypted) → Production + Preview`);
note(`Writing STRIPE_WEBHOOK_SECRET (encrypted) → Production + Preview`);
if (!args['dry-run']) {
  await cfPatch(`/pages/projects/${args.project}`, {
    deployment_configs: {
      production: { env_vars: mergedProd },
      preview:    { env_vars: mergedPreview },
    },
  });
  ok(`Both secrets written to both environments.`);
} else {
  ok(`(dry run) would patch env vars`);
}

// ─── Cloudflare: redeploy ────────────────────────────────────────────────
if (!args['no-redeploy']) {
  section('3. Trigger redeploy');
  note(`Creating a new production deployment…`);
  if (!args['dry-run']) {
    const dep = await cfPost(`/pages/projects/${args.project}/deployments`, null);
    ok(`Deployment queued: ${dep.id || dep.url || '(id unknown)'}`);
    ok(`Watch progress: https://dash.cloudflare.com/?to=/:account/pages/view/${args.project}`);
  } else {
    ok(`(dry run) would trigger redeploy`);
  }
}

// ─── Liveness check ──────────────────────────────────────────────────────
section('4. Liveness check');
note(`Waiting 10 s for the deployment to take effect…`);
if (!args['dry-run']) await new Promise(r => setTimeout(r, 10_000));
note(`GET ${args.url}`);
try {
  const res = args['dry-run']
    ? { status: 405, headers: new Headers({ allow: 'POST' }) }
    : await fetch(args.url, { method: 'GET' });
  const allow = res.headers.get('allow') || res.headers.get('Allow') || '';
  if (res.status === 405 && /POST/i.test(allow)) {
    ok(`405 Allow: ${allow} — route is live.`);
  } else if (res.status === 404) {
    warn(`404 — the route isn't deployed yet. Try again in a minute, or check Functions output.`);
  } else {
    warn(`Unexpected ${res.status}. Body:`);
    try { console.error(await res.text()); } catch {}
  }
} catch (err) {
  warn(`Liveness check failed: ${err.message}`);
}

console.log(`\n${color('green', '✓ Done.')} ${args.project} is wired to Stripe.\n`);

// ─── Helpers ─────────────────────────────────────────────────────────────
function usage() {
  return `bootstrap-stripe-cf — provision Stripe + Cloudflare Pages secrets

Usage:
  node bootstrap.mjs --project=<cf-pages-project> --url=<webhook-url> [options]

Options:
  --events=a,b,c    Stripe event types (default: ${DEFAULT_EVENTS.join(',')})
  --description=…   Stripe webhook description
  --replace         Delete + recreate the webhook if one already exists
  --no-redeploy     Skip the redeploy at the end
  --no-confirm      Skip the LIVE-mode confirmation prompt
  --dry-run         Print the plan; change nothing

Required env vars:
  STRIPE_SECRET_KEY        sk_live_… or sk_test_…
  CLOUDFLARE_API_TOKEN     token with Cloudflare Pages:Edit on the account
  CLOUDFLARE_ACCOUNT_ID    your Cloudflare account id
`;
}

function required(name) {
  const v = process.env[name];
  if (!v) die(`Missing env var: ${name}`);
  return v;
}
function die(msg) { console.error(`${color('red', 'error')} ${msg}`); process.exit(1); }
function note(msg) { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ${color('green', '✓')} ${msg}`); }
function warn(msg) { console.warn(`  ${color('yellow', '!')} ${msg}`); }
function section(s) { console.log(`\n${color('bold', s)}`); }
function mask(s) { if (!s) return ''; return s.length > 10 ? s.slice(0, 7) + '…' + s.slice(-4) : '***'; }
function color(c, s) {
  if (!stdout.isTTY) return s;
  const codes = { red: 31, green: 32, yellow: 33, bold: 1 };
  return `\x1b[${codes[c] || 0}m${s}\x1b[0m`;
}

async function stripePost(path, body) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, String(v));
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) die(`Stripe ${res.status}: ${data.error?.message || 'request failed'}`);
  return data;
}
async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) die(`Stripe ${res.status}: ${data.error?.message || 'request failed'}`);
  return data;
}
async function stripeDelete(path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    die(`Stripe ${res.status}: ${data.error?.message || 'delete failed'}`);
  }
}
async function findStripeWebhookByUrl(url) {
  // Stripe's webhook_endpoints list doesn't filter by url. Walk it.
  let starting_after = null;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ limit: '100', ...(starting_after ? { starting_after } : {}) });
    const page = await stripeGet(`/v1/webhook_endpoints?${qs}`);
    const found = page.data.find(w => w.url === url);
    if (found) return found;
    if (!page.has_more) return null;
    starting_after = page.data[page.data.length - 1].id;
  }
  return null;
}

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}`;
async function cfFetch(method, path, body) {
  const res = await fetch(`${CF_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const errs = (data.errors || []).map(e => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    die(`Cloudflare ${method} ${path}: ${errs}`);
  }
  return data.result;
}
const cfGet   = (p)    => cfFetch('GET',   p);
const cfPost  = (p, b) => cfFetch('POST',  p, b);
const cfPatch = (p, b) => cfFetch('PATCH', p, b);
