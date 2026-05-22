# BooksOutLoud — operations runbook

This is the document for "I haven't touched this in a while, what do I do."
For day-to-day code conventions see `CLAUDE.md`.

---

## 1. What's deployed

A static site on **Cloudflare Pages** at `booksoutloud.org`, backed by
**Pages Functions** and a **D1** SQLite database (`booksoutloud-crm`,
id `b6ddd699-dabf-43d1-a1e2-c30ba94f0275`). Source on `main` only.

Surfaces:

| URL | What |
|---|---|
| `/` and the rest of the marketing site | Static |
| `/api/book` | Booking form handler (Resend + D1 CRM insert + auto-reply) |
| `/api/subscribe`, `/api/unsubscribe` | Newsletter signup + tokenized unsubscribe |
| `/api/checkout` | Stripe Checkout session for ticket purchase |
| `/api/webhooks/stripe` | Stripe webhook receiver (signed) |
| `/tickets/<slug>` and `/tickets/<slug>/thanks` | Public ticket buying flow |
| `/door/<id>/<token>` | Volunteer door check-in (token-gated, no Access) |
| `/admin/*` | Admin SPA (CRM, newsletter, broadcasts, venues, tickets) — Cloudflare Access gated |
| `/admin/checkin/<id>` | Door check-in for Jeromy himself |
| `/admin/setup/` | **Browser-only setup wizard** (this is the thing you're looking for) |

---

## 2. First-time Stripe wiring (browser, no terminal)

Use this when:
- You've deployed the project for the first time
- You've rotated your Stripe key
- You've moved to a new Cloudflare account

Steps:

1. Open **`https://booksoutloud.org/admin/setup/`** (Cloudflare Access prompts a sign-in).
2. In a new tab, open `https://dash.cloudflare.com/profile/api-tokens`. Create a **Custom Token** with one permission:
   **Account → Cloudflare Pages → Edit** scoped to the right account. Copy the token.
3. From the bottom-right of any Cloudflare dashboard page, copy the 32-char **Account ID**.
4. In a new tab, open `https://dashboard.stripe.com/apikeys`. Reveal the **Secret key** and copy it. Note the top-right toggle — Test vs Live.
5. Paste all three values into the wizard. Project name and webhook URL are pre-filled.
6. Click **Wire it up**. LIVE mode triggers one confirm. The Function:
   - creates the Stripe webhook listening for `checkout.session.{completed,expired,async_payment_failed}` + `account.updated`,
   - captures the signing secret from the response (Stripe never reveals it again),
   - writes both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the Pages project (Production + Preview),
   - triggers a redeploy.
7. ~30 s later, hit `https://booksoutloud.org/api/webhooks/stripe` — should return `405 Allow: POST`. (If 404, the deploy didn't pick up; if 5xx, the route is crashing on startup — probably a missing env var.)

That's it. The CF API token can be deleted from Cloudflare after the wizard completes if you want to be belt-and-suspenders.

There's also a CLI bootstrap at `tools/bootstrap-stripe-cf/` for terminal-lovers — same flow, different surface.

---

## 3. ⚠️ Pre-flight checklist before going live

The site supports test mode and live mode equally. Before you run `sk_live_…`
through the wizard or take a real $20 ticket, walk this list. Tick each box.

**Stripe**
- [ ] Stripe Connect → Platform profile is filled in (business name "BooksOutLoud", support email, branding, ToS acceptance). Without this, Express onboarding 400s.
- [ ] You can switch the dashboard to LIVE mode at the top right (means your account is fully verified).
- [ ] The secret key you'll use starts with `sk_live_`.
- [ ] (Optional) Restricted API key minted with only the scopes this app needs — see `tools/bootstrap-stripe-cf/README.md`.

**Cloudflare**
- [ ] `booksoutloud.org` is on the Pages project as a custom domain, certificate green.
- [ ] Cloudflare Access is in front of `/admin/*` and you can log in.
- [ ] `RESEND_API_KEY` is set (booking auto-replies and ticket emails won't deliver otherwise).
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are set (run the wizard above).

**Booksoutloud-side smoke test (use test mode first)**
- [ ] Set the Stripe key with `sk_test_…` first. Wire via wizard.
- [ ] Onboard a test venue. Stripe test KYC data:
  - Phone `000 000 0000`, SSN `000-00-0000`, DOB `01/01/1901`
  - Address `address_full_match`, routing `110000000`, account `000123456789`
  - On return, the venue should flip to `enabled` after Refresh.
- [ ] Create a $1 ticketed event, status `on_sale`.
- [ ] Buy it in a private window with card `4242 4242 4242 4242`, any future expiry, any CVC.
- [ ] Within ~15 s: order shows `paid` in admin, ticket email lands, ticket count is correct.
- [ ] Check in the ticket at `/admin/checkin/<id>` — green welcome.
- [ ] Generate a Volunteer Link from the Tickets tab, open in incognito, check in another ticket — works without login.
- [ ] Switch DevTools to Offline mode, submit a code on the door page — green "Tentative". Toggle online, watch the queue drain.

**Then flip to live**
- [ ] Rerun the wizard with your `sk_live_…` key (check **Replace** to rotate the webhook).
- [ ] Onboard the first real venue with REAL identity/bank data.
- [ ] Create a $1 "live wire test" event. Buy with a real card of yours.
- [ ] Stripe dashboard → refund the $1. Confirm refund posts to your card.
- [ ] Only after that round-trip succeeds, mark the real event live and share the URL.

---

## 4. Day-to-day

- **Admin SPA**: `/admin/`. Tabs for Inquiries, Upcoming, History, Subscribers, Broadcasts, Venues, Tickets.
- **Newsletter**: compose with the WYSIWYG editor on the Broadcasts tab. Always send a test to yourself first (the dialog has a button). Bulk send paces at ~9/sec to stay under Resend's rate limit.
- **CRM follow-ups**: drag inquiries through Upcoming → History (status dropdown on each row). Notes are private to the admin.
- **Tickets**: a row in the Tickets tab has three actions:
  - **Public page** — what buyers see
  - **Door** — your own check-in page (Access-gated)
  - **Volunteer link** — copy a shareable URL for at-the-door staff (revoke any time)

---

## 5. Troubleshooting

| Symptom | Most likely cause |
|---|---|
| Booking form silently fails | `RESEND_API_KEY` not set, or sender domain not verified in Resend |
| `/admin/` returns 401 | Cloudflare Access not configured for `/admin/*` |
| `/api/webhooks/stripe` returns 404 | Deploy didn't pick up — push a no-op commit or click "Retry deployment" |
| Webhook returns 400 with "signature invalid" | `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret in Stripe dashboard |
| Ticket purchase succeeds in Stripe but no ticket email | Webhook isn't firing — check Stripe → Developers → Webhooks → deliveries tab |
| Venue stuck at `onboarding` | Click Refresh in admin; if still stuck, open Stripe dashboard → Connected accounts → see Stripe's outstanding requirements |
| Door page won't work offline | First load needs to succeed online so the service worker can install — visit once with signal before the event |
| Broadcast sending exceeds 30s | List has grown past ~2700 subscribers; queue migration to Cloudflare Queues is the fix |

---

## 6. Where to look in code

| Thing | Path |
|---|---|
| D1 schema | `migrations/000{1..5}_*.sql` (apply via the Cloudflare bindings MCP) |
| Shared email shell | `functions/_lib/email.js` |
| Shared Stripe wrapper | `functions/_lib/stripe.js` |
| HTML sanitizer (newsletter) | `functions/_lib/htmlsafe.js` |
| Volunteer token validation | `functions/_lib/door.js` |
| Door check-in client (SW + offline queue) | `public/checkin/{checkin.js,sw.js}` |
| Setup wizard | `public/admin/setup/` + `functions/admin/api/setup/` |
| CLI bootstrap (terminal alternative) | `tools/bootstrap-stripe-cf/` |
