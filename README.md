# Emilio Calvano — homepage

A static (HTML/CSS) replica of the personal academic site originally built on Wix:
<https://emiliocalvano.wixsite.com/emiliocalvano>

## Pages
| File | Page |
|------|------|
| `index.html` | Home |
| `cv.html` | CV & Contact |
| `research.html` | Research |
| `teaching.html` | Teaching |
| `policy.html` | Policy & disclosures |

`styles.css` is shared across all pages. Images live in `assets/`.

## Run locally
```bash
python3 -m http.server 8765
# then open http://localhost:8765/index.html
```

## How it was built
The original is a client-side-rendered Wix site, so the raw HTML is an empty
shell. The `capture/` folder holds the tooling and captured material:

- `capture.mjs` — Playwright crawler: loads each page, scrolls to trigger
  lazy-loaded images, dumps the rendered DOM, screenshots at 1440px + 390px,
  and downloads + verifies every asset.
- `extract.mjs` — pulls structured text, links, and image metadata per page.
- `shoot_replica.mjs` — screenshots the replica and checks internal links.
- `inventory.json` / `content.json` — the capture inventory and extracted content.
- `screenshots/` — originals; `replica_shots/` — the replica.

## Fidelity notes (what does / doesn't match)
- **Fonts:** the original uses Wix's *DIN Next Light* (proprietary). The replica
  substitutes **Raleway** (Google Fonts, light weights) — a close geometric-sans
  match, not pixel-identical.
- **Wix promo banner:** the "This website was built on Wix" bar is hosting chrome,
  not part of the site's design, so it is intentionally omitted.
- **"(one page) CV" button:** the original's link target could not be captured;
  it currently points to the same Academic CV PDF as a fallback. **Replace with
  the correct one-page-CV URL when available.**
- All other text, links (paper PDFs, slides, external sites), images, logos,
  layout, and navigation reproduce the original. No broken internal links.

## Last review (screenshot-grounded, desktop + mobile)
| Criterion | Score |
|-----------|-------|
| Similarity | 9/10 |
| Aesthetics | 9/10 |
| Functionality | 9/10 |
