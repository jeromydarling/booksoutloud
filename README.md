# BooksOutLoud

Live, immersive performances of great Christian literature — performed by Jeromy Darling. This repo holds the marketing site, ready to deploy on Cloudflare Pages.

## Repo layout

```
public/                 # Static site (Cloudflare Pages build output)
  index.html            # Home
  performances.html     # Repertoire overview
  about.html            # About Jeromy
  authors.html          # Featured authors
  booking.html          # Booking form (posts to /api/book)
  screwtape.html        # Program detail pages
  father-brown.html
  seven-last-words.html
  chesterton.html
  flannery.html
  conversion.html
  404.html
  styles.css
  site.js               # Mobile nav toggle
  booking.js            # Booking form submit
  favicon.svg
  robots.txt
  sitemap.xml
  _headers              # Cache + security headers
  _redirects            # /book, /contact, /programs aliases
  images/               # Author portraits + Jeromy
functions/
  api/
    book.js             # POST /api/book — Cloudflare Pages Function (Resend)
source/                 # Reference materials, not deployed
  booksoutloud_v2_preview.html
  booksoutloud_site_package.zip
  booksoutloud_performance_sourcebook-1.docx
wrangler.toml           # Cloudflare Pages project config
package.json            # Dev scripts (wrangler dev / deploy)
```

## Local development

```bash
# Quick static preview (no Pages Functions)
python3 -m http.server -d public 8000

# Full Pages preview with /api/book working (needs Wrangler + a Resend key)
npm install
echo 'RESEND_API_KEY=re_xxxxx' > .dev.vars
npm run dev    # → http://127.0.0.1:8788
```

## Deploy to Cloudflare Pages

The site is structured so Cloudflare Pages can build with **zero build command** — `public/` is already the build output, and `functions/` is picked up automatically.

### One-time setup in the Cloudflare dashboard

1. **Pages → Create project → Connect to Git → `jeromydarling/booksoutloud`**
2. Production branch: `main` (or whichever branch you ship from)
3. Build settings:
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. **Settings → Environment variables**:
   - `RESEND_API_KEY` — set as a **secret** (production + preview)
   - `BOOKING_TO_EMAIL` — `jer@jeromydarling.com` (already in `wrangler.toml`, but you can override per environment)
   - `BOOKING_FROM_EMAIL` — `BooksOutLoud <booking@booksoutloud.org>` once the domain is verified in Resend; until then keep the default `onboarding@resend.dev`.
5. **Custom domains**: add `booksoutloud.org` (and `www.booksoutloud.org` as a redirect).

After this, every push to the production branch ships automatically. Preview deployments run on every other branch and PR.

### Resend setup

1. Create a Resend account → get an API key.
2. Verify the `booksoutloud.org` domain in Resend (add the DNS records — usually three).
3. Once verified, update `BOOKING_FROM_EMAIL` to use the verified domain. Before that, sends will arrive from `onboarding@resend.dev` (works for testing only).

### CLI alternative

```bash
npx wrangler login
npx wrangler pages secret put RESEND_API_KEY   # paste value when prompted
npx wrangler pages deploy public --project-name booksoutloud
```

## Notes

- The performance sourcebook in `source/` is private prep material. Its specific cue lists (letter numbers, chapter selections, exact text boundaries) are not exposed on the public site — only the audience-facing synopsis, why-it-works, and Q&A-angle copy.
- All pages use only system serif fonts (Georgia / Times New Roman) — no web font fetches, no external requests.
- CSP is strict: same-origin only, with the booking form posting same-origin to `/api/book`.
