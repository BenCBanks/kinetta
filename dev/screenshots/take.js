// Homepage screenshots (site/assets/shots): every shot in light and dark, 360 x 779 at 2x (720 x 1558), from a throwaway
// install with dev/demo/seed.py + dev/screenshots/stage.py loaded. Usage: node take.js <out dir> [base url]
// Writes PNGs; to_webp.py turns them into the site's .webp files. Maps need the internet (OpenStreetMap tiles).
const {chromium} = require('playwright');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
// name, address, and optionally a card title to scroll to, or something to do first
const SHOTS = [
  ['today', '/today'],
  ['feed', '/activity'],
  ['activity', 'RUN'],
  ['similar', 'RUN', {to: 'Similar efforts'}],
  ['coach', 'COACH', {to: 'Coach'}],
  ['route', 'ROUTE'],
  ['progress', '/progress'],
  ['fitness', '/progress?view=fitness'],
  ['plan', '/plan'],
  ['heatmap', '/progress/heatmap'],
  ['food', '/food'],
  ['cook', 'DISH'],
  ['serve', 'DISH', {to: 'Weigh and serve', portion: '380'}],
  ['friends', '/me/friends'],
];
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({viewport: {width: 360, height: 779}, deviceScaleFactor: 2, colorScheme: scheme});
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
    await page.goto(B + '/');
    await page.fill('input[name=login]', 'alex'); await page.fill('input[name=password]', 'blue kettle morning run');
    await page.click('button[type=submit]'); await page.waitForSelector('nav.tabs');
    const ids = await page.evaluate(async () => {
      const get = async (p) => (await fetch(p)).json();
      const acts = await get('/api/activities?limit=40'), routes = await get('/api/routes'), dishes = await get('/api/dishes');
      const loop = acts.find((a) => a.sport === 'run' && a.distance_m > 4600 && a.distance_m < 4950) || acts[0];
      const coach = (await Promise.all(acts.slice(0, 40).map((a) => get('/api/activities/' + a.id)))).find((a) => a.ai_note) || loop;
      return {RUN: '/activity/' + loop.id, COACH: '/activity/' + coach.id, ROUTE: routes.length ? '/route/' + routes.sort((x, y) => y.count - x.count)[0].id : '/progress',
        DISH: '/food/cook/' + ((dishes.find((d) => d.status === 'cooking') || dishes[0] || {}).id || '')};
    });
    for (const [name, path, opt = {}] of SHOTS) {
      await page.evaluate((p) => { window.scrollTo(0, 0); go(p); }, ids[path] || path);
      await page.waitForTimeout(1500);
      await page.waitForFunction(() => !document.querySelector('.leaflet-container') || document.querySelector('.leaflet-tile-loaded'), null, {timeout: 8000}).catch(() => {});
      if (opt.portion) { await page.fill('#dk-portion input[name=g]', opt.portion); }
      if (opt.to) await page.evaluate((t) => {
        const h = [...document.querySelectorAll('.card > h2, h2.sec-head')].find((x) => x.textContent.trim().startsWith(t));
        if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 16);
      }, opt.to);
      await page.waitForTimeout(700);
      await page.screenshot({path: `${OUT}/${scheme}-${name}.png`});
    }
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('shots taken');
})();
