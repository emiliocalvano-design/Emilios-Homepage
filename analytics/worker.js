/**
 * Visitor-analytics Worker for emiliocalvano-design.github.io/Emilios-Homepage
 *
 * Routes:
 *   POST /collect          - logged by the beacon on each page view (public, CORS-open)
 *   GET  /stats?token=...   - JSON for the dashboard (requires DASH_TOKEN)
 *   GET  /                  - health check
 *
 * Geo/IP/org come from Cloudflare's `request.cf` + CF-Connecting-IP — no paid
 * geo-IP service needed. `org` (request.cf.asOrganization) is the best-available
 * guess of the connecting network (e.g. "GARR" for Italian universities,
 * "Google LLC", "Vodafone Italia") — it is the ISP/AS owner, not a reverse-DNS
 * hostname, which Workers cannot resolve.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ---- academic / university classification ----
// `org` (asOrganization) is the owning network. For universities the connecting
// network is usually a NATIONAL RESEARCH & EDUCATION NETWORK (NREN) shared by all
// campuses in a country, so we map the well-known NREN ASNs to a friendly label.
// Individual US/other campuses often appear under their own name, caught by regex.
const EDU_ASN = {
  137:   'GARR — Italian universities & research',
  786:   'Jisc / JANET — UK universities',
  680:   'DFN — German universities & research',
  2200:  'RENATER — French universities & research',
  1103:  'SURF — Dutch universities & research',
  1101:  'SURF — Dutch universities & research',
  766:   'RedIRIS — Spanish universities & research',
  559:   'SWITCH — Swiss universities & research',
  2603:  'NORDUnet — Nordic research',
  1653:  'SUNET — Swedish universities',
  224:   'Uninett / Sikt — Norwegian universities',
  1835:  'Forskningsnettet — Danish research',
  1741:  'Funet / CSC — Finnish universities',
  20965: 'GÉANT — European research backbone',
  11537: 'Internet2 — US research & education',
  11164: 'CENIC — California research & education',
  5511:  'CANARIE / research',
  2716:  'CERN',
};
const EDU_NAME = /universi|politecni|\bpolytech|\becole\b|école|hochschule|\buniv\b|scuola\s+(normale|superiore|imt)|college|\binstitut|\.edu\b|\bcnrs\b|\bcnr\b|max[-\s]?planck|academ|research and education|research & education|national laborator|\bnren\b|\bcern\b/i;

// returns a friendly institution/network label if the visit looks academic, else null
function academicLabel(r) {
  if (r.asn && EDU_ASN[r.asn]) return EDU_ASN[r.asn];
  const o = r.org || '';
  if (o && EDU_NAME.test(o)) return o;
  return null;
}

// group rows by a key function → [{key, hits, uniqueIps}] sorted by hits desc
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    let e = m.get(k);
    if (!e) { e = { key: k, hits: 0, ips: new Set() }; m.set(k, e); }
    e.hits++;
    if (r.ip) e.ips.add(r.ip);
  }
  return [...m.values()]
    .map((e) => ({ key: e.key, hits: e.hits, uniqueIps: e.ips.size }))
    .sort((a, b) => b.hits - a.hits);
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ---- collect a page view ----
    if (url.pathname === '/collect' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* sendBeacon may send text */ }
      if (!body.p) {
        try { body = JSON.parse(await request.text()); } catch { /* ignore */ }
      }
      const cf = request.cf || {};
      try {
        await env.DB.prepare(
          `INSERT INTO visits (ts, ip, country, region, city, asn, org, path, referrer, ua)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          Date.now(),
          request.headers.get('CF-Connecting-IP') || null,
          cf.country || null,
          cf.region || null,
          cf.city || null,
          cf.asn || null,
          cf.asOrganization || null,
          (body.p || '').slice(0, 300) || null,
          (body.r || '').slice(0, 500) || null,
          (request.headers.get('User-Agent') || '').slice(0, 400) || null
        ).run();
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
      // 204-style ack (beacon ignores the body)
      return new Response(null, { status: 204, headers: CORS });
    }

    // shared token check for the private endpoints
    const authOk = () => {
      const token = (
        url.searchParams.get('token') ||
        (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      ).trim();
      const expected = (env.DASH_TOKEN || '').trim();
      return expected && token === expected;
    };

    // ---- CSV export of the raw visit log (all columns) ----
    if (url.pathname === '/export' && request.method === 'GET') {
      if (!authOk()) return json({ ok: false, error: 'unauthorized' }, 401);

      const DAY = 86400000;
      const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '90', 10) || 90, 1), 3650);
      const since = Date.now() - days * DAY;

      const { results } = await env.DB.prepare(
        `SELECT ts, ip, country, region, city, asn, org, path, referrer, ua
           FROM visits WHERE ts >= ? ORDER BY ts DESC`
      ).bind(since).all();
      const rows = results || [];

      const header = ['datetime_utc', 'ts', 'ip', 'country', 'region', 'city', 'asn', 'org', 'academic', 'path', 'referrer', 'user_agent'];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([
          new Date(r.ts).toISOString(),
          r.ts, r.ip, r.country, r.region, r.city, r.asn, r.org,
          academicLabel(r) ? 'yes' : '',
          r.path, r.referrer, r.ua,
        ].map(csvCell).join(','));
      }
      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="visits-last-${days}d.csv"`,
          ...CORS,
        },
      });
    }

    // ---- dashboard stats ----
    if (url.pathname === '/stats' && request.method === 'GET') {
      if (!authOk()) return json({ ok: false, error: 'unauthorized' }, 401);

      const now = Date.now();
      const DAY = 86400000;
      const since = now - 180 * DAY;
      // how many detail rows to return (default: effectively all; capped for payload safety)
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '2000', 10) || 2000, 1), 10000);

      const { results } = await env.DB.prepare(
        `SELECT ts, ip, country, region, city, asn, org, path, referrer
           FROM visits WHERE ts >= ? ORDER BY ts DESC`
      ).bind(since).all();

      const rows = results || [];

      // window counts: hits + unique IPs, current vs previous equal window
      const windowStats = (days) => {
        const curStart = now - days * DAY;
        const prevStart = now - 2 * days * DAY;
        const cur = rows.filter((r) => r.ts >= curStart);
        const prev = rows.filter((r) => r.ts >= prevStart && r.ts < curStart);
        const uniq = (a) => new Set(a.map((r) => r.ip)).size;
        const hits = cur.length;
        const prevHits = prev.length;
        const pct = prevHits === 0 ? (hits > 0 ? 100 : 0) : Math.round(((hits - prevHits) / prevHits) * 100);
        return { days, hits, uniqueIps: uniq(cur), prevHits, changePct: pct };
      };

      // daily series for last 90 days (oldest -> newest) for the sparkline
      const series = [];
      for (let i = 89; i >= 0; i--) {
        const dayStart = now - (i + 1) * DAY;
        const dayEnd = now - i * DAY;
        series.push(rows.filter((r) => r.ts >= dayStart && r.ts < dayEnd).length);
      }

      // ---- groupings over the last 90 days ----
      const win90 = rows.filter((r) => r.ts >= now - 90 * DAY);
      const academic = win90.filter((r) => academicLabel(r));
      const groups = {
        window: 90,
        academicSplit: { academic: academic.length, other: win90.length - academic.length },
        universities: groupBy(academic, (r) => academicLabel(r)),
        // de-aggregate national networks (e.g. GARR) down to the campus city
        academicByCity: groupBy(academic, (r) => [r.city, r.country].filter(Boolean).join(', ')),
        byCountry: groupBy(win90, (r) => r.country),
        byCity: groupBy(win90, (r) => [r.city, r.country].filter(Boolean).join(', ')),
        byOrg: groupBy(win90, (r) => r.org),
        byPage: groupBy(win90, (r) => r.path),
        byReferrer: groupBy(win90.filter((r) => r.referrer), (r) => {
          try { return new URL(r.referrer).hostname || r.referrer; } catch { return r.referrer; }
        }),
      };

      const recent = rows.slice(0, limit).map((r) => ({
        ts: r.ts,
        ip: r.ip,
        loc: [r.city, r.region, r.country].filter(Boolean).join(', '),
        org: r.org,
        academic: academicLabel(r) || null,
        path: r.path,
        referrer: r.referrer,
      }));

      return json({
        ok: true,
        generatedAt: now,
        totalLogged: rows.length,
        returnedRows: recent.length,
        windows: { d30: windowStats(30), d60: windowStats(60), d90: windowStats(90) },
        series90: series,
        groups,
        recent,
      });
    }

    if (url.pathname === '/') return json({ ok: true, service: 'emilio-analytics' });
    return json({ ok: false, error: 'not found' }, 404);
  },
};
