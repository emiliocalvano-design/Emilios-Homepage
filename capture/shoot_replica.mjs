import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'replica_shots');
fs.mkdirSync(OUT, { recursive: true });
const pages = [['home','index.html'],['cv','cv.html'],['research','research.html'],['teaching','teaching.html'],['policy','policy.html']];
const round = process.argv[2] || 'r1';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const brokenLinks = {};
  for (const [key, file] of pages) {
    const url = 'http://localhost:8765/' + file;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${key}_1440_${round}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${key}_390_${round}.png`), fullPage: true });
    // check links resolve (HEAD on internal, just collect hrefs)
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    const internal = links.filter(h => h && !/^https?:/.test(h) && !h.startsWith('#') && !h.startsWith('mailto'));
    brokenLinks[key] = [];
    for (const h of [...new Set(internal)]) {
      const r = await page.request.get('http://localhost:8765/' + h).catch(() => null);
      if (!r || r.status() >= 400) brokenLinks[key].push(h + ' -> ' + (r ? r.status() : 'ERR'));
    }
  }
  fs.writeFileSync(path.join(OUT, `brokenlinks_${round}.json`), JSON.stringify(brokenLinks, null, 2));
  console.log('Replica screenshots done. Broken internal links:', JSON.stringify(brokenLinks));
  await browser.close();
})();
