// POST /admin/api/venues/:id/onboard
//
// Creates a Stripe Express connected account for the venue (if one doesn't
// already exist) and an account-link the venue can click to fill out their
// banking + identity info on Stripe's hosted form. Returns the URL.

import { stripeRequest } from '../../../../_lib/stripe.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  const siteUrl = env.SITE_URL || 'https://booksoutloud.org';
  const venue = await env.DB.prepare(`SELECT * FROM venues WHERE id = ?`).bind(id).first();
  if (!venue) return json(404, { ok: false, message: 'Venue not found.' });

  let accountId = venue.stripe_account_id;

  // Create a Stripe Express account if we don't have one yet.
  if (!accountId) {
    try {
      const account = await stripeRequest(env, '/v1/accounts', {
        type: 'express',
        country: 'US',
        email: venue.email,
        business_type: 'company',
        business_profile: {
          name: venue.name,
          product_description: 'Ticket sales for live literary performances by BooksOutLoud.',
          mcc: '8398', // charitable / social-service organizations — adjust per venue if needed
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { venue_id: String(venue.id) },
      });
      accountId = account.id;
      await env.DB.prepare(
        `UPDATE venues
           SET stripe_account_id = ?2,
               stripe_status = 'onboarding',
               updated_at = datetime('now')
         WHERE id = ?1`,
      ).bind(id, accountId).run();
    } catch (err) {
      console.error('Stripe account create failed', err);
      return json(502, { ok: false, message: `Stripe: ${err.message}` });
    }
  }

  // Create a fresh Account Link.
  try {
    const link = await stripeRequest(env, '/v1/account_links', {
      account: accountId,
      refresh_url: `${siteUrl}/admin/?venue=${id}&onboard=refresh`,
      return_url:  `${siteUrl}/admin/?venue=${id}&onboard=return`,
      type: 'account_onboarding',
    });
    return json(200, { ok: true, url: link.url, account_id: accountId });
  } catch (err) {
    console.error('Stripe account link failed', err);
    return json(502, { ok: false, message: `Stripe: ${err.message}` });
  }
}
