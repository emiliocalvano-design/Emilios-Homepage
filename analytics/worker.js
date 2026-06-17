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

    // ---- dashboard stats ----
    if (url.pathname === '/stats' && request.method === 'GET') {
      const token =
        url.searchParams.get('token') ||
        (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!env.DASH_TOKEN || token !== env.DASH_TOKEN) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const now = Date.now();
      const DAY = 86400000;
      const since = now - 180 * DAY;

      const { results } = await env.DB.prepare(
        `SELECT ts, ip, country, region, city, org, path, referrer
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

      const recent = rows.slice(0, 100).map((r) => ({
        ts: r.ts,
        ip: r.ip,
        loc: [r.city, r.region, r.country].filter(Boolean).join(', '),
        org: r.org,
        path: r.path,
        referrer: r.referrer,
      }));

      return json({
        ok: true,
        generatedAt: now,
        totalLogged: rows.length,
        windows: { d30: windowStats(30), d60: windowStats(60), d90: windowStats(90) },
        series90: series,
        recent,
      });
    }

    if (url.pathname === '/') return json({ ok: true, service: 'emilio-analytics' });
    return json({ ok: false, error: 'not found' }, 404);
  },
};
