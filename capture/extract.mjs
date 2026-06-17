import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://emiliocalvano.wixsite.com/emiliocalvano';
const pages = [
  ['home', BASE],
  ['cv', BASE + '/about-me-contact'],
  ['research', BASE + '/research-1'],
  ['teaching', BASE + '/teaching'],
  ['policy', BASE + '/general-5'],
];
const gotoSafe = async (page, url) => {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.evaluate(async () => { await new Promise(r=>{let t=0;const i=setInterval(()=>{window.scrollBy(0,500);t+=500;if(t>=document.body.scrollHeight+1500){clearInterval(i);window.scrollTo(0,0);r();}},100);}); });
  await page.waitForTimeout(1000);
};
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const out = {};
  for (const [key, url] of pages) {
    await gotoSafe(page, url);
    const data = await page.evaluate(() => {
      const text = document.querySelector('#SITE_CONTAINER')?.innerText || document.body.innerText;
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const t = (a.innerText||'').trim();
        if (a.href && !a.href.startsWith('javascript')) links.push({ text: t, href: a.href });
      });
      const imgs = [];
      document.querySelectorAll('img').forEach(i => { if (i.src && i.naturalWidth > 20) imgs.push({ src: i.src, alt: i.alt||'', w: i.naturalWidth, h: i.naturalHeight }); });
      return { text, links, imgs };
    });
    out[key] = { url, ...data };
  }
  fs.writeFileSync(path.join(__dirname, 'content.json'), JSON.stringify(out, null, 2));
  console.log('Extracted content for', Object.keys(out).length, 'pages');
  await browser.close();
})();
