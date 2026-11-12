// Website feature crops (site/assets/tour) of complete app controls, from a throwaway demo install (dev/demo/seed.py).
// Usage: node tour.js <out dir> [base url]. Each crop is one whole element at 2x, light and dark, encoded as WebP.
// Fictional account only; browser captures, not native iPhone evidence. Install fonts-liberation to match CI's text.
const {chromium} = require('playwright');
const fs = require('node:fs');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
const PAD = 12;   // page background kept around a card so its edge and shadow stay visible

// name, address, selector of the first and last element the crop must contain completely
const CROPS = [
  // Settings > Sharing & privacy: the default audience for new activities, including its scope note.
  ['sharing-default', '/me/sharing', '.card:has(.seg)', '.card:has(.seg)'],
  // One workout's Edit sheet: its title and its own audience choice.
  ['sharing-workout', '/activity/{RUN}?edit=1', '.sheet .sheet-head, .sheet header', '#e-share'],
  // Run achievements: earned, current and next levels with distance left, then the repeat rule.
  ['run-achievements', '/me/achievements/sport:run', '.profile-achievement-history-head', '.profile-achievement-levels'],
];

async function crop(page, first, last) {
  const box = await page.evaluate(([a, b]) => {
    const one = document.querySelector(a), two = document.querySelector(b);
    if (!one || !two) return null;
    const r1 = one.getBoundingClientRect(), r2 = two.getBoundingClientRect();
    return {top: Math.min(r1.top, r2.top), bottom: Math.max(r1.bottom, r2.bottom)};
  }, [first, last]);
  if (!box) throw Error(`Missing ${first} or ${last}`);
  return {x: 0, y: Math.max(0, box.top - PAD), width: 393, height: box.bottom - box.top + 2 * PAD};
}

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({viewport: {width: 393, height: 852}, deviceScaleFactor: 2,
        colorScheme: scheme, reducedMotion: 'reduce', timezoneId: 'America/New_York'});
      const page = await context.newPage();
      await page.goto(B + '/');
      await page.fill('input[name=login]', 'alex'); await page.fill('input[name=password]', 'blue kettle morning run');
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login') && u.pathname !== '/'), page.press('input[name=password]', 'Enter')]).catch(() => {});
      await page.waitForTimeout(1500);
      const run = await page.evaluate(async () => (await (await fetch('/api/activities?limit=20')).json()).find((a) => a.sport === 'run' && a.visibility === 'friends')?.id);
      if (!run) throw Error('No demo run shared with friends');
      for (const [name, address, first, last] of CROPS) {
        await page.goto(B + address.replace('{RUN}', run));
        await page.waitForSelector(last, {state: 'visible'});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);
        const clip = await crop(page, first, last);
        const png = await page.screenshot({clip});
        // WebP in the page's own encoder: no image library needed, same pixels as the PNG.
        const webp = await page.evaluate(async (data) => {
          const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return canvas.toDataURL('image/webp', 0.9).split(',')[1];
        }, png.toString('base64'));
        fs.writeFileSync(`${OUT}/${name}-${scheme}.webp`, Buffer.from(webp, 'base64'));
        console.log(`${name}-${scheme}.webp ${clip.width * 2}x${Math.round(clip.height * 2)}`);
      }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
