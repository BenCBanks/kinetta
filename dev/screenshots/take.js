// Homepage screenshots (site/assets/shots): every shot in light and dark, at an iPhone 16's screen size (393 x 852 at 2x =
// 786 x 1704), from a throwaway install with dev/demo/seed.py + dev/screenshots/stage.py loaded. Usage: node take.js <out dir> [base url]
// Writes PNGs; to_webp.py turns them into the site's .webp files. Maps need the internet (OpenStreetMap tiles).
// Like a real iPhone (2026-10-13): the app gets the status bar's 59 px at the top and the home bar's 34 px at the bottom
// (its stylesheet's safe-area values are filled in), and a status bar with the Dynamic Island and the home bar are drawn over it.
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
  ['serve', '/food', {logDish: 'Chicken and veg traybake', portion: '380'}],
  ['friends', '/me/friends'],
  ['dietcoach', '/food?view=overview', {to: "Coach's take"}],
  ['recipecoach', 'DISH', {to: "Coach's take"}],
  ['photos', 'LATEST', {sel: '.d-title'}],
  ['describe', '/food', {describe: ['I had a hot dog from Costco and a Diet Coke', 'make it two hot dogs']}],
  // lifting (2026-10-13): last; the logger starts a session from the latest one (a live session would change Today)
  ['liftex', 'SQUAT'],
  ['lift', '/today', {lift: true}],
];
// ONLY=lift,liftex takes just those (new shots, without retaking every other picture)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const W = 393, H = 852, TOP = 59, BOTTOM = 34;
// "Describe or snap" needs the AI: the shot shows a made-up answer instead (nothing is sent anywhere)
const SAMPLE = (note) => { const n = /two/.test(note || '') ? 2 : 1;   // the correction changes the answer, like the real thing
  return {items: [{name: 'Hot dog', amount: String(n), kcal: 550 * n, protein_g: 20 * n, carbs_g: 45 * n, fat_g: 32 * n, fiber_g: 2 * n},
    {name: 'Diet Coke', amount: '20 fl oz', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0}], notes: 'Costco food court hot dog' + (n > 1 ? 's.' : '.'), model: 'sample'}; };
// the iPhone's status bar (9:41, signal, Wi-Fi, battery), the Dynamic Island and the home bar, over every shot
function chrome(dark) {
  const c = dark ? '#fff' : '#000', W = 393;
  for (const id of ['k-sb', 'k-hb']) document.getElementById(id)?.remove();
  // like the installed app, the page's colour sits behind the status bar, except over a map at the very top
  const bg = document.querySelector('.scrim') || (document.querySelector('.map-head') && scrollY < 40) ? 'transparent' : getComputedStyle(document.body).backgroundColor;   // a sheet's dimmed page shows through
  const NS = 'http://www.w3.org/2000/svg', sb = document.createElementNS(NS, 'svg');
  sb.id = 'k-sb'; sb.setAttribute('viewBox', `0 0 ${W} 54`); sb.setAttribute('width', W); sb.setAttribute('height', 54);
  // set through .style: the app's security policy ignores style="..." attributes
  sb.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:block';
  sb.innerHTML = `<rect width="${W}" height="54" fill="${bg}"/>
    <text x="66" y="35" text-anchor="middle" fill="${c}" font-family="-apple-system,'SF Pro Text',Inter,system-ui,sans-serif" font-size="17" font-weight="600" letter-spacing="-.2">9:41</text>
    <rect x="${W / 2 - 62}" y="11" width="124" height="36" rx="18" fill="#000"/>
    <g transform="translate(${W - 100} 21)" fill="${c}">
      <rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.7" y="6" width="3" height="6" rx="1"/><rect x="9.4" y="3.5" width="3" height="8.5" rx="1"/><rect x="14.1" y="1" width="3" height="11" rx="1"/>
      <path d="M29.5 3.2a9.6 9.6 0 0 1 13 0l-1.3 1.4a7.7 7.7 0 0 0-10.4 0zM32.1 6a5.9 5.9 0 0 1 7.8 0l-1.3 1.4a4 4 0 0 0-5.2 0zM34.7 8.7a2.2 2.2 0 0 1 2.6 0L36 10.2z"/>
      <rect x="49" y="1.2" width="24" height="10.6" rx="3.2" fill="none" stroke="${c}" stroke-opacity=".4"/><rect x="51" y="3.2" width="20" height="6.6" rx="1.8"/><path d="M74.6 4.8v3.4a1.8 1.8 0 0 0 0-3.4z" fill-opacity=".45"/></g>`;
  const hb = document.createElementNS(NS, 'svg');
  hb.id = 'k-hb'; hb.setAttribute('viewBox', `0 0 ${W} 13`); hb.setAttribute('width', W); hb.setAttribute('height', 13);
  hb.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;pointer-events:none;display:block';
  hb.innerHTML = `<rect x="${W / 2 - 67}" y="0" width="134" height="5" rx="2.5" fill="${c}"/>`;
  document.documentElement.append(sb, hb);
}
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const scheme of ['light', 'dark']) {
    // the browser keeps the server's time zone (the workflow sets TZ), or a run near midnight UTC shows an empty week
    const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, colorScheme: scheme,
      timezoneId: process.env.TZ || 'America/New_York'});
    const page = await ctx.newPage();
    // the iPhone's status bar and home bar spaces: what env(safe-area-inset-*) is on a phone (0 in a desktop browser)
    await page.route('**/style.css*', async (route) => {
      const r = await route.fetch(), css = (await r.text())
        .replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g, TOP + 'px').replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g, BOTTOM + 'px');
      await route.fulfill({response: r, body: css});
    });
    await page.route('**/api/food/photo', (route) => route.fulfill({json: SAMPLE(JSON.parse(route.request().postData() || '{}').note)}));
    page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
    await page.goto(B + '/');
    await page.fill('input[name=login]', 'alex'); await page.fill('input[name=password]', 'blue kettle morning run');
    await page.click('button[type=submit]'); await page.waitForSelector('nav.tabs');
    const ids = await page.evaluate(async () => {
      const get = async (p) => (await fetch(p)).json();
      const acts = await get('/api/activities?limit=40'), routes = await get('/api/routes'), dishes = await get('/api/dishes');
      const loop = acts.find((a) => a.sport === 'run' && a.distance_m > 4600 && a.distance_m < 4950) || acts[0];
      const coach = (await Promise.all(acts.slice(0, 40).map((a) => get('/api/activities/' + a.id)))).find((a) => a.ai_note) || loop;
      return {LATEST: '/activity/' + acts[0].id, RUN: '/activity/' + loop.id, COACH: '/activity/' + coach.id, ROUTE: routes.length ? '/route/' + routes.sort((x, y) => y.count - x.count)[0].id : '/progress',
        DISH: '/food/cook/' + ((dishes.find((d) => d.name === 'Chicken and veg traybake') || dishes[0] || {}).id || ''),
        SQUAT: '/lift/ex/' + (((await get('/api/lifts/exercises')).mine.find((x) => x.name === 'Squat') || {}).id || '')};
    });
    for (const [name, path, opt = {}] of SHOTS) {
      if (ONLY && !ONLY.includes(name)) continue;
      await page.evaluate((p) => { document.querySelectorAll('.scrim').forEach((x) => x.remove()); window.scrollTo(0, 0); go(p); }, ids[path] || path);   // no sheet left open from the shot before
      await page.waitForTimeout(1500);
      await page.waitForFunction(() => !document.querySelector('.leaflet-container') || document.querySelector('.leaflet-tile-loaded'), null, {timeout: 8000}).catch(() => {});
      if (opt.logDish) {      // Add food > Saved Dishes > the dish: the log sheet, with a portion typed in
        await page.evaluate(() => addSheet(isoDay(new Date()), 'dinner'));
        await page.click('[data-t=saved]'); await page.click(`.fe:has-text("${opt.logDish}")`);
        await page.fill('#dl input[name=g]', opt.portion);
      }
      if (opt.describe) {   // Add food > Describe or snap: a message, the estimate, a correction
        await page.evaluate(() => { App.me.ai_ok = true; addSheet(isoDay(new Date()), 'dinner'); });
        await page.click('#as-photo');
        for (const t of opt.describe) { await page.fill('#ql-t', t); await page.click('#ql-f .send'); await page.waitForTimeout(500); }
        await page.evaluate(() => { const s = document.querySelector('.sheet'); s.scrollTop = 0; });
      }
      if (opt.lift) {       // Start lifting > repeat the latest session; the first exercise's sets ticked, the second's first set
        const id = await page.evaluate(async () => {
          const last = (await (await fetch('/api/lifts/sessions?limit=1')).json())[0];
          const r = await (await fetch('/api/lifts/start', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({copy_from: last.id})})).json();
          go('/lift/' + r.id); return r.id;
        });
        await page.waitForSelector('.lift-ex');
        const first = page.locator('.lift-ex').first();
        await first.locator('[data-tick="0"]').click();
        for (const j of [1, 2, 3]) { await first.locator(`.lift-in[data-j="${j}"][data-k="kg"]`).fill('205'); await first.locator(`[data-tick="${j}"]`).click(); }
        await page.locator('.lift-ex').nth(1).locator('[data-tick="0"]').click();
        await page.waitForTimeout(1500);
        await page.evaluate((x) => { window.__liftId = x; }, id);
      }
      if (opt.sel) await page.evaluate((q) => { const e = document.querySelector(q); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }, opt.sel);
      if (opt.to) await page.evaluate((t) => {
        const h = [...document.querySelectorAll('.card > h2, h2.sec-head')].find((x) => x.textContent.trim().startsWith(t));
        if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70);   // below the status bar
      }, opt.to);
      await page.waitForTimeout(700);
      await page.evaluate(chrome, scheme === 'dark');
      await page.screenshot({path: `${OUT}/${scheme}-${name}.png`});
    }
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('shots taken');
})();
