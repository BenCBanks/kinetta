// Capture mockup-only Kinetta Achievements directions at a 390 CSS px phone viewport.
// Install the existing browser dependency first: npm --prefix dev/tests/browser ci
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../tests/browser/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const html = path.join(__dirname, 'achievements-628.html');
const out = path.resolve(process.argv[2] || path.join(__dirname, '.achievements-628-captures'));
const views = [
  ['direction-a-light', 'direction', 'A', 'light'],
  ['direction-a-dark', 'direction', 'A', 'dark'],
  ['direction-a1-light', 'direction', 'A1', 'light'],
  ['direction-a1-dark', 'direction', 'A1', 'dark'],
  ['direction-a2-light', 'direction', 'A2', 'light'],
  ['direction-a2-dark', 'direction', 'A2', 'dark'],
  ['direction-a3-light', 'direction', 'A3', 'light'],
  ['direction-a3-dark', 'direction', 'A3', 'dark'],
  ['icons-i1-light', 'icons', 'I1', 'light'],
  ['icons-i1-dark', 'icons', 'I1', 'dark'],
  ['icons-i2-light', 'icons', 'I2', 'light'],
  ['icons-i2-dark', 'icons', 'I2', 'dark'],
  ['icons-i3-light', 'icons', 'I3', 'light'],
  ['icons-i3-dark', 'icons', 'I3', 'dark'],
  ['icons-i4-light', 'icons', 'I4', 'light'],
  ['icons-i4-dark', 'icons', 'I4', 'dark'],
  ['direction-b-light', 'direction', 'B', 'light'],
  ['direction-b-dark', 'direction', 'B', 'dark'],
  ['direction-c-light', 'direction', 'C', 'light'],
  ['direction-c-dark', 'direction', 'C', 'dark'],
  ['placement-profile-light', 'placement-profile', '', 'light'],
  ['placement-profile-dark', 'placement-profile', '', 'dark'],
  ['placement-progress-light', 'placement-progress', '', 'light'],
  ['placement-progress-dark', 'placement-progress', '', 'dark'],
  ['placement-me-light', 'placement-me', '', 'light'],
  ['placement-me-dark', 'placement-me', '', 'dark'],
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(x => x.trim()).filter(Boolean)) : null;

(async () => {
  await fs.mkdir(out, {recursive: true});
  const browser = await chromium.launch({headless: true});
  const errors = [];
  try {
    for (const [name, mode, direction, theme] of views) {
      if (only && !only.has(name)) continue;
      const context = await browser.newContext({
        viewport: {width: 390, height: 844},
        deviceScaleFactor: 2,
        colorScheme: theme,
        timezoneId: 'America/New_York',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      const query = new URLSearchParams({mode, theme});
      if (direction) query.set('direction', direction);
      await page.goto(`${pathToFileURL(html).href}?${query}`, {waitUntil: 'load'});
      await page.locator('.tabbar').waitFor({state: 'visible'});
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        screenWidth: document.querySelector('.screen').getBoundingClientRect().width,
        tabsVisible: getComputedStyle(document.querySelector('.tabbar')).display !== 'none',
      }));
      if (geometry.viewport !== 390 || geometry.scrollWidth > 390 || !geometry.tabsVisible) {
        throw new Error(`${name}: unexpected viewport geometry ${JSON.stringify(geometry)}`);
      }
      await page.screenshot({path: path.join(out, `${name}.png`), animations: 'disabled'});
      await context.close();
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Captured ${views.filter(v => !only || only.has(v[0])).length} 390 px screenshots in ${out}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
