const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const html = path.join(__dirname, 'me-insights-631.html');
const out = process.env.SHOT_DIR || path.join(__dirname, 'evidence-631');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  try {
    for (const screen of ['me-before', 'me-after', 'progress-pace', 'progress-fitness']) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({
          viewport: { width: 390, height: 1000 },
          colorScheme: theme,
          isMobile: true,
          hasTouch: true,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto(`${pathToFileURL(html).href}?screen=${screen}`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: path.join(out, `${screen}-390-${theme}.png`), fullPage: true, animations: 'disabled' });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Captured 8 fictional 390px light/dark screens in ${out}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
