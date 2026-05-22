// POST /admin/api/venues/:id/refresh
//
// Pulls the latest account state from Stripe (charges_enabled, payouts_enabled,
// details_submitted, requirements) and syncs it back to the venues row. Used
// after onboarding completion or to manually re-check status.

import { stripeRequest } from '../../../../_lib/stripe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function deriveStatus(acct) {
  if (!acct.details_submitted) return 'onboarding';
  if (acct.charges_enabled && acct.payouts_enabled) return 'enabled';
  if (acct.requirements?.disabled_reason) return 'disabled';
  return 'restricted';
}

export async function onRequestPost({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  const venue = await env.DB.prepare(`SELECT * FROM venues WHERE id = ?`).bind(id).first();
  if (!venue) return json(404, { ok: false, message: 'Venue not found.' });
  if (!venue.stripe_account_id) {
    return json(400, { ok: false, message: 'No Stripe account on file — start onboarding first.' });
  }

  try {
    const acct = await stripeRequest(env, `/v1/accounts/${venue.stripe_account_id}`);
    const status = deriveStatus(acct);
    await env.DB.prepare(
      `UPDATE venues
         SET stripe_status = ?2,
             charges_enabled = ?3,
             payouts_enabled = ?4,
             details_submitted = ?5,
             updated_at = datetime('now')
       WHERE id = ?1`,
    ).bind(
      id, status,
      acct.charges_enabled ? 1 : 0,
      acct.payouts_enabled ? 1 : 0,
      acct.details_submitted ? 1 : 0,
    ).run();
    return json(200, {
      ok: true,
      status,
      charges_enabled: !!acct.charges_enabled,
      payouts_enabled: !!acct.payouts_enabled,
      details_submitted: !!acct.details_submitted,
      requirements: acct.requirements,
    });
  } catch (err) {
    console.error('venue refresh failed', err);
    return json(502, { ok: false, message: `Stripe: ${err.message}` });
  }
}
