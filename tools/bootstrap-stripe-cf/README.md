# bootstrap-stripe-cf

Wire up a Stripe webhook + Cloudflare Pages secrets in one command.
Replaces 10 minutes of dashboard clicking with ~5 seconds of `node`.

## What it does

1. Creates a Stripe webhook endpoint pointing at your URL, listening for
   the standard set of payment + Connect events (configurable).
2. Captures the signing secret from the response (this is the *only*
   chance — Stripe never reveals it again).
3. Writes both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as
   encrypted env vars on the named Cloudflare Pages project, in both
   Production and Preview environments, preserving any existing vars.
4. Triggers a redeploy so the Functions bind to the new env.
5. Pings the webhook URL and asserts it returns `405 Allow: POST`.

## One-time machine setup

You need three pieces, set as env vars (in `~/.zshenv`, a 1Password
shell plugin, direnv, whatever):

```sh
export STRIPE_SECRET_KEY=sk_live_xxx
export CLOUDFLARE_API_TOKEN=cf_xxx
export CLOUDFLARE_ACCOUNT_ID=cf_account_xxx
```

Generate the Cloudflare token at
<https://dash.cloudflare.com/profile/api-tokens> with the
**"Cloudflare Pages: Edit"** permission for the account. You can
restrict by zone / project if you want — only the Pages permission
matters for this script.

Find your account id at the bottom-right of any page in the Cloudflare
dashboard.

Yes, the Stripe key needs to be per project (one Stripe account = one
key). The Cloudflare token + account id are once-per-machine.

## Per project

```sh
node bootstrap.mjs \
  --project=booksoutloud \
  --url=https://booksoutloud.org/api/webhooks/stripe
```

`--dry-run` shows the plan without changing anything. `--replace` deletes
and recreates an existing webhook (necessary if you've lost the signing
secret). `--no-redeploy` skips the final deploy if you'd rather batch it
with other changes.

## Putting it in your dotfiles

```sh
# Once, somewhere outside any single project's repo:
mkdir -p ~/.local/share/bootstrap-stripe-cf
cp tools/bootstrap-stripe-cf/bootstrap.mjs ~/.local/share/bootstrap-stripe-cf/

# Drop into PATH:
ln -s ~/.local/share/bootstrap-stripe-cf/bootstrap.mjs ~/.local/bin/bootstrap-stripe-cf
chmod +x ~/.local/share/bootstrap-stripe-cf/bootstrap.mjs

# Then anywhere, any project, ever:
bootstrap-stripe-cf --project=foo --url=https://foo.dev/api/webhooks/stripe
```

## Why not just use `wrangler` and `stripe` CLI?

You could. Each of those involves a login (browser handshake), and
combining them is a multi-step shell ritual. This script is one
process, one prompt, idempotent, and exposes secrets through env vars
only — never via shell history.

## Security notes

- Secrets never touch your shell history (env vars + stdin only).
- The signing secret is captured directly from the Stripe API response
  and written straight to Cloudflare's API. It's not echoed to the
  terminal except as a masked preview (`whsec_xxx…xxx`).
- In LIVE mode the script prompts for a `yes` confirmation before
  doing anything irreversible. Pass `--no-confirm` to skip.
- Webhook deletion is irreversible: any prior signing secret you held
  becomes invalid the moment `--replace` runs.

## What it doesn't do

- Stripe Connect platform setup. That's a one-time dashboard task
  per Stripe account (KYC, branding, ToS) and can't be done via API.
- Stripe account creation. One-time, per business identity.
- Cloudflare Pages project creation. Use `wrangler pages project
  create` or the existing `setup-cloudflare.sh`.
- Resend, Access, custom domain. Different REST APIs, same pattern.
  Easy to extend if you want.
