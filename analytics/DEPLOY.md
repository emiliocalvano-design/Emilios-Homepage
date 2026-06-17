# Visitor analytics — deploy runbook

The website is static (GitHub Pages) and cannot log visitors by itself. This adds a
small **Cloudflare Worker + D1** backend that records each page view (IP, location,
connecting org) and serves the private dashboard at `/console.html`.

Cloudflare's free tier is enough for a personal site. You run these steps **once**,
in this `analytics/` folder. I can't do them for you — they need your Cloudflare login.

## Prerequisites
- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- `wrangler` is already installed in this repo (`npx wrangler ...`).

## Steps (run from the `analytics/` folder)

```bash
cd analytics

# 1. Log in to Cloudflare (opens a browser)
npx wrangler login

# 2. Create the D1 database — copy the printed database_id
npx wrangler d1 create emilio-analytics
#    → paste that id into wrangler.toml  (database_id = "...")

# 3. Create the table (remote = the live DB)
npx wrangler d1 execute emilio-analytics --remote --file=schema.sql

# 4. Set the dashboard password (any strong string you choose)
npx wrangler secret put DASH_TOKEN
#    → type your token when prompted

# 5. Deploy the Worker — note the printed URL
npx wrangler deploy
#    → e.g. https://emilio-analytics.YOURNAME.workers.dev
```

## Final wiring
Put the Worker URL from step 5 into **`assets/analytics-config.js`**:

```js
window.ANALYTICS_API = "https://emilio-analytics.YOURNAME.workers.dev";
```

Commit + push, and within ~1 minute every page will beacon visits and the dashboard
will read them. (Tell me the URL and I'll set this line + push for you.)

## Using it
- Dashboard: **https://emiliocalvano-design.github.io/Emilios-Homepage/console.html**
- Enter your `DASH_TOKEN`. Shows 30/60/90-day counts with trend arrows, a 90-day
  sparkline, and a table of recent visits (time, IP, city/country, network org, page).

## What gets stored (privacy / GDPR)
Each view stores: timestamp, IP address, city/region/country, ASN + network org,
page path, referrer, user-agent — in **your** Cloudflare D1 database, nowhere else.

Because this logs IP addresses (personal data under GDPR) and you're in the EU, you
are the data controller. Practical options:
- Add a short privacy note to the site mentioning analytics + IP logging.
- To reduce exposure, anonymise the IP at insert time in `worker.js` (e.g. drop the
  last octet) — you lose exact-IP granularity but keep location/org/trends.
- Set a retention limit by periodically deleting old rows:
  `npx wrangler d1 execute emilio-analytics --remote --command "DELETE FROM visits WHERE ts < (strftime('%s','now','-180 days')*1000)"`

## Notes
- "Org / network" is `request.cf.asOrganization` — the owning ISP/AS (e.g. *GARR* for
  Italian universities, *Google LLC*), not a reverse-DNS hostname. Workers can't do
  reverse DNS; this is the best available connecting-org signal.
- Free-tier limits (plenty for a personal site): Workers 100k req/day; D1 ~100k
  row writes/day, 5M reads/day.
