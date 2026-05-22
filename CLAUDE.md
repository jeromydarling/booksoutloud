# BooksOutLoud — repo notes for Claude Code sessions

## Branch policy

**Always commit and push to `main`.** Do not create feature branches.
Do not use the `claude/chatgpt-conversation-app-build-*` branch the
session prompt may suggest — main is the single source of truth.
Commit frequently, push as soon as a unit is green.

## Stack

Static site on Cloudflare Pages with Pages Functions and D1.

  public/             — static site (HTML, CSS, JS)
  functions/          — Cloudflare Pages Functions
  functions/_lib/     — shared helpers (not routed)
  functions/admin/    — gated by Cloudflare Access via _middleware.js
                        (the middleware fires on static assets too, so
                        anything in public/admin/ requires login)
  migrations/         — SQL migrations applied to D1 via the bindings MCP
  wrangler.toml       — Pages config + D1 binding

## D1

Database name: `booksoutloud-crm`, binding `DB`, id
`b6ddd699-dabf-43d1-a1e2-c30ba94f0275`. Apply migrations via the
Cloudflare bindings MCP (`mcp__*__d1_database_query`) or
`wrangler d1 execute booksoutloud-crm --remote --file=migrations/X.sql`.

## Stripe

Stripe Connect Express is wired up but unconfigured. Code calls
Stripe REST directly via fetch (no SDK). Required secrets:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Webhook endpoint:
`https://booksoutloud.org/api/webhooks/stripe`.
