import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://emiliocalvano.wixsite.com/emiliocalvano';
const OUT = __dirname;
const DOM_DIR = path.join(OUT, 'dom');
const SHOT_DIR = path.join(OUT, 'screenshots');
const ASSET_DIR = path.join(OUT, 'assets');
for (const d of [DOM_DIR, SHOT_DIR, ASSET_DIR]) fs.mkdirSync(d, { recursive: true });

const slug = (u) => {
  try {
    const p = new URL(u).pathname.replace(/^\/+|\/+$/g, '');
    return p ? p.replace(/[^a-z0-9]+/gi, '_') : 'home';
  } catch { return 'home'; }
};

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight + 2000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 120);
    });
  });
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const gotoSafe = async (url) => {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3500);
  };

  console.log('Loading homepage…');
  await gotoSafe(BASE);
  await autoScroll(page);

  // Discover nav links
  const links = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('a[href]').forEach(a => out.add(a.href));
    return [...out];
  });
  const origin = new URL(BASE).origin;
  const basePath = new URL(BASE).pathname;
  const internal = links.filter(h => {
    try { const u = new URL(h); return u.origin === origin && u.pathname.startsWith(basePath); }
    catch { return false; }
  });
  const external = links.filter(h => !internal.includes(h) && /^https?:/.test(h));
  const pages = [...new Set([BASE, ...internal])].filter(u => !u.includes('#') || u.split('#')[0] !== BASE)
    .map(u => u.split('#')[0]);
  const uniquePages = [...new Set([BASE, ...pages])];

  console.log('Internal pages:', uniquePages.length, 'External links:', external.length);

  const assetUrls = new Set();
  const inventory = { pages: [], externalLinks: [...new Set(external)], assets: [], fonts: [] };

  for (const url of uniquePages) {
    const s = slug(url);
    console.log('Capturing', url, '→', s);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoSafe(url);
      await autoScroll(page);
      // collect assets
      const pageAssets = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('img').forEach(i => { if (i.src) urls.add(i.src); if (i.srcset) i.srcset.split(',').forEach(s => urls.add(s.trim().split(' ')[0])); });
        document.querySelectorAll('[style*="background"]').forEach(e => {
          const m = (e.getAttribute('style')||'').match(/url\(["']?([^"')]+)["']?\)/g);
          if (m) m.forEach(x => urls.add(x.replace(/^url\(["']?|["']?\)$/g,'')));
        });
        const fonts = [];
        document.querySelectorAll('*').forEach(e => {
          const ff = getComputedStyle(e).fontFamily;
          if (ff) fonts.push(ff);
        });
        return { urls: [...urls], fonts: [...new Set(fonts)] };
      });
      pageAssets.urls.forEach(u => { if (/^https?:/.test(u)) assetUrls.add(u); });
      pageAssets.fonts.forEach(f => inventory.fonts.push(f));

      // dump DOM
      const html = await page.content();
      fs.writeFileSync(path.join(DOM_DIR, s + '.html'), html);
      // screenshots desktop
      await page.screenshot({ path: path.join(SHOT_DIR, s + '_1440.png'), fullPage: true });
      // mobile
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(800);
      await autoScroll(page);
      await page.screenshot({ path: path.join(SHOT_DIR, s + '_390.png'), fullPage: true });

      inventory.pages.push({ url, slug: s, status: 'ok' });
    } catch (e) {
      console.log('  ERROR', e.message);
      inventory.pages.push({ url, slug: s, status: 'error', error: e.message });
    }
  }

  inventory.fonts = [...new Set(inventory.fonts.flatMap(f => f.split(',').map(x => x.trim().replace(/^["']|["']$/g,''))))];

  // download assets
  console.log('Downloading', assetUrls.size, 'assets…');
  const download = (url) => new Promise((resolve) => {
    let name = slug(url) + '_' + Math.abs([...url].reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0));
    const ext = (url.split('?')[0].match(/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|otf|ico|mp4)$/i)||[])[0] || '';
    name += ext;
    const file = path.join(ASSET_DIR, name);
    https.get(url, { headers: { 'Referer': BASE, 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) { resolve({ url, status: res.statusCode, ok: false }); res.resume(); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(file, buf);
        resolve({ url, file: name, status: 200, bytes: buf.length, ok: buf.length > 500 });
      });
    }).on('error', (e) => resolve({ url, status: 'err', error: e.message, ok: false }));
  });

  const results = [];
  for (const u of assetUrls) results.push(await download(u));
  inventory.assets = results;

  fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 2));
  console.log('Done. Pages:', inventory.pages.length, 'Assets ok:', results.filter(r=>r.ok).length, '/', results.length);
  await browser.close();
})();
