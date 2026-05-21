#!/usr/bin/env bash
# Provisions the Cloudflare side of booksoutloud.org via the Wrangler CLI.
#
# Run from the repo root:    ./scripts/setup-cloudflare.sh
#
# What this does:
#   1. Verifies wrangler is installed and you're logged in.
#   2. Creates the Pages project (idempotent — skips if it already exists).
#   3. Creates the D1 database "booksoutloud-crm" and writes its id into
#      wrangler.toml so future deploys pick up the binding.
#   4. Runs the schema migration against that database.
#   5. Stores RESEND_API_KEY as a Pages secret.
#   6. Triggers a deploy of public/ so the new bindings take effect.
#
# What this does NOT do (still requires the Cloudflare dashboard):
#   - Attaching the custom domain booksoutloud.org to the Pages project.
#   - Setting up Cloudflare Access in front of /admin/*.
#   - Connecting the GitHub repo for auto-deploy on push.
# See scripts/cloudflare-dashboard-checklist.md for those.

set -euo pipefail

PROJECT_NAME="booksoutloud"
DB_NAME="booksoutloud-crm"
PRODUCTION_BRANCH="main"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER_TOML="$ROOT_DIR/wrangler.toml"
MIGRATION_FILE="$ROOT_DIR/migrations/0001_init.sql"

cd "$ROOT_DIR"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
bold "0. Preflight"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install from https://nodejs.org and re-run." >&2
  exit 1
fi
ok "node $(node --version)"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found — your Node install is broken." >&2
  exit 1
fi
ok "npx available"

# Use npx so the user doesn't need a global wrangler install.
WRANGLER="npx --yes wrangler@latest"
note "Using: $WRANGLER"

if ! $WRANGLER whoami >/dev/null 2>&1; then
  warn "Not logged in to Cloudflare. Running 'wrangler login' — a browser will open."
  $WRANGLER login
fi
ACCOUNT_LINE="$($WRANGLER whoami 2>&1 | grep -E 'Associated email|email' | head -n1 || true)"
ok "Logged in. $ACCOUNT_LINE"

# ── 1. Pages project ───────────────────────────────────────────────────────
bold "1. Pages project: $PROJECT_NAME"
if $WRANGLER pages project list 2>/dev/null | grep -q "^│ *$PROJECT_NAME "; then
  ok "Pages project already exists."
else
  $WRANGLER pages project create "$PROJECT_NAME" \
    --production-branch="$PRODUCTION_BRANCH" \
    --compatibility-date="2025-05-01"
  ok "Created Pages project."
fi

# ── 2. D1 database ─────────────────────────────────────────────────────────
bold "2. D1 database: $DB_NAME"
EXISTING_ID="$($WRANGLER d1 list --json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const a=JSON.parse(s);const m=a.find(d=>d.name==='$DB_NAME');process.stdout.write(m?m.uuid:'')}catch{process.stdout.write('')}}" \
  || true)"

if [[ -n "$EXISTING_ID" ]]; then
  DB_ID="$EXISTING_ID"
  ok "Database already exists. id=$DB_ID"
else
  CREATE_OUT="$($WRANGLER d1 create "$DB_NAME" 2>&1)"
  echo "$CREATE_OUT"
  DB_ID="$(echo "$CREATE_OUT" | grep -oE 'database_id = "[^"]+"' | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -z "$DB_ID" ]]; then
    echo "Could not parse database_id from wrangler output." >&2
    exit 1
  fi
  ok "Created database. id=$DB_ID"
fi

# Write the id into wrangler.toml (idempotent).
if grep -q 'REPLACE_WITH_DATABASE_ID_FROM_WRANGLER_OUTPUT' "$WRANGLER_TOML"; then
  sed -i.bak "s/REPLACE_WITH_DATABASE_ID_FROM_WRANGLER_OUTPUT/$DB_ID/" "$WRANGLER_TOML"
  rm -f "$WRANGLER_TOML.bak"
  ok "Wrote database_id into wrangler.toml."
else
  CURRENT_ID="$(grep -E 'database_id\s*=' "$WRANGLER_TOML" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ "$CURRENT_ID" != "$DB_ID" ]]; then
    warn "wrangler.toml has database_id=$CURRENT_ID but the live DB id is $DB_ID."
    warn "Update wrangler.toml manually if you want to switch."
  else
    ok "wrangler.toml already has the correct database_id."
  fi
fi

# ── 3. Migration ───────────────────────────────────────────────────────────
bold "3. Schema migration"
$WRANGLER d1 execute "$DB_NAME" --remote --file="$MIGRATION_FILE" --yes
ok "Applied migrations/0001_init.sql to $DB_NAME."

# ── 4. Resend secret ───────────────────────────────────────────────────────
bold "4. RESEND_API_KEY secret"
if [[ -n "${RESEND_API_KEY:-}" ]]; then
  printf '%s' "$RESEND_API_KEY" | $WRANGLER pages secret put RESEND_API_KEY --project-name="$PROJECT_NAME"
  ok "Set RESEND_API_KEY from environment."
else
  echo "  Paste your Resend API key (starts with 're_'). It won't be echoed."
  echo "  Get one at https://resend.com/api-keys if you don't have one yet."
  $WRANGLER pages secret put RESEND_API_KEY --project-name="$PROJECT_NAME"
  ok "Stored RESEND_API_KEY."
fi

# ── 5. Deploy ──────────────────────────────────────────────────────────────
bold "5. Deploying public/ to Cloudflare Pages"
$WRANGLER pages deploy public \
  --project-name="$PROJECT_NAME" \
  --branch="$PRODUCTION_BRANCH" \
  --commit-dirty=true
ok "Deployed. Live at https://$PROJECT_NAME.pages.dev (custom domain still pending)."

cat <<EOF

──────────────────────────────────────────────────────────────────
Done with everything Wrangler can do. Three things still need the
Cloudflare dashboard — see scripts/cloudflare-dashboard-checklist.md:

  • Custom domain    booksoutloud.org  →  Pages project
  • Cloudflare Access in front of /admin/*
  • GitHub auto-deploy hookup (optional but recommended)

──────────────────────────────────────────────────────────────────
EOF
