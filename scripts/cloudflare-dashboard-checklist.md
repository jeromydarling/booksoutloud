# Cloudflare dashboard — final 3 steps

The `scripts/setup-cloudflare.sh` script handles everything the Wrangler CLI
can do (Pages project, D1 database, migration, Resend secret, first deploy).
These three things still need the dashboard.

Run the script first. When it finishes, your site is live at
`https://booksoutloud.pages.dev`. The CRM at `/admin/` returns 401 by design
until step 2 below puts Cloudflare Access in front of it.

---

## 1. Custom domain  →  booksoutloud.org

1. Cloudflare dashboard → **Workers & Pages** → `booksoutloud` → **Custom domains**
2. **Set up a custom domain** → enter `booksoutloud.org`
3. If the domain is already on Cloudflare DNS, click **Activate** — the record
   is added for you in a few seconds.
4. Repeat with `www.booksoutloud.org`.
5. Optional: under the zone (not the Pages project) → **Rules → Redirect Rules**,
   add a permanent redirect from `www.booksoutloud.org/*` to
   `https://booksoutloud.org/$1`.

If the domain is registered elsewhere, Cloudflare will show you the exact
records to add at your registrar (one CNAME for the apex, one for www).

---

## 2. Cloudflare Access  →  protect `/admin/*`

The CRM is gated by a middleware that checks the
`Cf-Access-Authenticated-User-Email` header against the `ADMIN_EMAIL` env var
in `wrangler.toml` (`jeromy.darling@gmail.com`). Without Access in front of
that path, every admin request returns 401.

1. **Zero Trust** dashboard (left sidebar from the main dashboard, or
   `one.dash.cloudflare.com`). If this is your first time, you'll be prompted
   to pick a team subdomain (e.g. `jeromy-darling.cloudflareaccess.com`) and
   confirm the **Free** plan (50 seats included).
2. **Access → Applications → Add an application → Self-hosted**.
3. Configure:
   - **Application name**: BooksOutLoud Admin
   - **Session duration**: 24 hours
   - **Application domain**: `booksoutloud.org`
   - **Path**: `/admin*`   (include the asterisk)
   - Leave the rest at defaults. Save.
4. **Add a policy**:
   - Name: Allow Jeromy
   - Action: Allow
   - Selector: **Emails**, value: `jeromy.darling@gmail.com`
   - Save.
5. **Identity provider**: if none is set up yet, go
   **Settings → Authentication → Login methods → Add → One-time PIN**.
   That's the simplest — Cloudflare emails a 6-digit PIN on each login.

**Smoke test**:
   - Open `https://booksoutloud.org/admin/` in a private window.
   - You should land on a Cloudflare Access login page.
   - Enter `jeromy.darling@gmail.com`, check email for the PIN, sign in.
   - The CRM with three empty tabs should load.

---

## 3. (Optional) GitHub auto-deploy

`setup-cloudflare.sh` does a one-shot deploy via Wrangler. To get every push
to `main` auto-deployed, connect GitHub:

1. Pages project → **Settings → Builds & deployments → Configure Production
   deployments → Connect to Git**.
2. Authorize the Cloudflare GitHub App for the `jeromydarling/booksoutloud`
   repo only.
3. Production branch: `main`. Build command: (empty). Output: `public`.
4. Save. Future pushes auto-build.

---

## Smoke test the whole stack

In one browser (signed in):
- `https://booksoutloud.org/admin/` → CRM loads
- Click **+ New event**, save → row appears under Upcoming

In a private window:
- `https://booksoutloud.org/booking.html` → form submits
- Email arrives at `BOOKING_TO_EMAIL`
- In the admin, the submission appears under **Inquiries**

Three green tabs = the whole CRM is live.
