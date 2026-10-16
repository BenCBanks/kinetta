// Homepage screenshots (site/assets/shots): every shot in light and dark, at an iPhone 16's screen size (393 x 852 at 2x =
// 786 x 1704), from a throwaway install with dev/demo/seed.py + dev/screenshots/stage.py loaded. Usage: node take.js <out dir> [base url]
// Writes PNGs; to_webp.py turns them into the site's .webp files. Maps need the internet (OpenStreetMap tiles).
// Like a real iPhone (2026-10-13): the app gets the status bar's 59 px at the top and the home bar's 34 px at the bottom
// (its stylesheet's safe-area values are filled in), and a status bar with the Dynamic Island and the home bar are drawn over it.
const {chromium} = require('playwright');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
// name, address, and optionally a card title to scroll to, or something to do first
const SHOTS = [
  ['today', '/me'],
  ['feed', '/activity'],
  ['track', '/track'],
  ['activity', 'RUN'],
  ['similar', 'RUN', {to: 'Similar efforts'}],
  ['coach', 'COACH', {to: 'Kit'}],
  ['route', 'ROUTE'],
  ['progress', '/progress'],
  ['fitness', '/progress?view=fitness'],
  ['plan', '/plan'],
  ['heatmap', '/progress/heatmap'],
  ['food', '/food'],
  ['explore', '/me/explore'],
  ['meals', '/food/meals', {logDish: 'Chicken and veg traybake', portion: '380', directLibrary: true}],
  ['cook', 'DISH'],
  ['serve', '/food', {logDish: 'Chicken and veg traybake', portion: '380'}],
  ['friends', '/me/friends'],
  ['dietcoach', '/food?view=overview', {to: "Kit’s take"}],
  ['recipecoach', 'DISH', {to: "Kit’s take"}],
  ['photos', 'LATEST', {photo: true}],
  ['describe', '/food', {describe: ['I had a hot dog from Costco and a Diet Coke', 'make it two hot dogs']}],
  // the website's Food story (2026-10-16): scan a barcode, snap a meal, then talk the estimate into shape. 'talk' also
  // writes 'snap' (the same conversation one message earlier).
  ['scan', '/food', {scan: '0000000000017'}],
  ['talk', '/food', {snap: ['chicken curry rice bowl for lunch', 'it was a small bowl, only about half the rice']}],
  // lifting (2026-10-13): last; the logger starts a session from the latest one (live sessions stay in Track)
  ['liftex', 'SQUAT'],
  ['lift', '/track', {lift: true}],
];
// ONLY=lift,liftex takes just those (new shots, without retaking every other picture)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const W = 393, H = 852, TOP = 59, BOTTOM = 34;
// Describe, Snap or Scan: explicit estimates use per-food stand-ins; no provider is called.
const SAMPLE = (note) => { const n = /two/.test(note || '') ? 2 : 1;   // the correction changes the answer, like the real thing
  const items = [{name: 'Hot dog', amount: String(n), kcal: 550 * n, protein_g: 20 * n, carbs_g: 45 * n, fat_g: 32 * n, fiber_g: 2 * n},
    {name: 'Diet Coke', amount: '20 fl oz', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0}];
  return {items: items.filter(x => x.name === 'Hot dog' ? /hot dog/i.test(note || '') : /diet coke/i.test(note || '')),
    notes: 'Made-up screenshot nutrition, not a live provider response.', model: 'sample'}; };
// A snapped meal (dev/demo/photos/curry-rice-bowl.jpg): made-up per-food estimates; "half"/"small" shrinks the rice,
// as the real estimator would when told.
const BOWL = (note) => { const small = /half|small/i.test(note || '');
  return {items: [
    {name: 'Spiced rice', amount: small ? '¾ cup' : '1½ cups', kcal: small ? 160 : 320, protein_g: small ? 3 : 6, carbs_g: small ? 35 : 70, fat_g: small ? 1 : 2, fiber_g: 1},
    {name: 'Butter chicken', amount: '1 cup', kcal: 380, protein_g: 28, carbs_g: 12, fat_g: 24, fiber_g: 2},
    {name: 'Chickpeas and potato', amount: '½ cup', kcal: 150, protein_g: 6, carbs_g: 24, fat_g: 3, fiber_g: 5},
    {name: 'Slaw, tomato and crispy topping', amount: '½ cup', kcal: 70, protein_g: 1, carbs_g: 8, fat_g: 4, fiber_g: 2}],
    notes: 'Made-up screenshot nutrition, not a live provider response.', model: 'sample'}; };
// A scanned package (made-up label numbers for a plain product; no Open Food Facts request)
const PRODUCT = {source: 'off', id: '0000000000017', name: 'Greek yogurt, plain nonfat', brand: null,
  per100: {kcal: 59, protein_g: 10.3, carbs_g: 3.6, fat_g: 0.4, fiber_g: 0}, serving: {label: '1 container (170 g)', g: 170}};
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
    await page.route('**/api/food/photo', (route) => { const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({json: body.images || body.image ? BOWL(body.note) : SAMPLE(body.note)}); });
    await page.route('**/api/food/barcode/*', (route) => route.fulfill({json: PRODUCT}));
    await page.route('**/api/food/meals-chat/products?**', route => route.fulfill({json: {query: '', foods: [], portion: null}}));
    // the combined lookup (one request for every new food): nothing in the databases, so the stand-in AI estimates them
    await page.route('**/api/food/meals-chat/lookup', route => route.fulfill({json: {results: JSON.parse(route.request().postData() || '{}').texts.map(text => ({text, query: '', kind: 'none', foods: [], portion: null}))}}));
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
      await page.evaluate((p) => { document.querySelectorAll('.scrim').forEach((x) => x.remove()); document.body.classList.remove('has-sheet'); window.scrollTo(0, 0); go(p); }, ids[path] || path);   // no sheet left open from the shot before
      await page.waitForTimeout(1500);
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => !document.querySelector('.leaflet-container') || document.querySelector('.leaflet-tile-loaded'), null, {timeout: 8000}).catch(() => {});
      if (opt.logDish) {      // Add food > My Recipes > the recipe: the log sheet, with a portion typed in
        if (opt.directLibrary) await page.click(`#meal-library .fe[data-dish]:has-text("${opt.logDish}")`);
        else {
          await page.evaluate(() => addSheet(isoDay(new Date()), 'dinner'));
          await page.click('[data-t=saved]'); await page.click(`.sheet .fe[data-dish]:has-text("${opt.logDish}")`);
        }
        await page.fill('#dl input[name=g]', opt.portion);
      }
      if (opt.photo) {
        // The real activity always opens on its map. This feature example shows the next slide after a swipe.
        await page.click('[data-media-step="1"]');
        await page.waitForTimeout(450);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (opt.describe) {   // Full-page conversation: the made-up estimates arrive on their own, then correct them.
        await page.evaluate(() => { App.me.ai_ok = true; addSheet(isoDay(new Date()), 'dinner'); });
        await page.click('#as-photo');
        await page.waitForURL('**/food/describe?**');
        for (const t of opt.describe) {
          await page.fill('#ql-t', t);
          await Promise.all([
            page.waitForResponse(r => r.url().endsWith('/api/food/meals-chat/resolve') && r.ok()),
            page.click('#ql-f .send'),
          ]);
          // Lookup and estimate finish independently of the resolve request. Wait for
          // rendered choices/results rather than racing them with a fixed sleep.
          // Locator waits also work on the CI-pinned Playwright under the app's
          // strict CSP; waitForFunction in that version requires unsafe-eval.
          await page.locator('#ql-t:not(:disabled)').waitFor();
          await page.locator('#ql-items').filter({hasText: /Looking up|Estimating/}).waitFor({state: 'hidden'});
          const estimates = page.getByRole('button', {name: 'Estimate with AI', exact: true});
          while (await estimates.count()) {
            await Promise.all([
              page.waitForResponse(r => r.url().endsWith('/api/food/photo') && r.ok()),
              estimates.first().click(),
            ]);
            await page.locator('#ql-items').filter({hasText: /Estimating/}).waitFor({state: 'hidden'});
          }
        }
        // Prove the correction and per-food stand-ins rendered once each before
        // capturing the actual page (there is deliberately no .sheet here).
        const rows = page.locator('#ql-items .ql-main');
        if (await rows.count() !== 2) throw new Error('Describe screenshot needs exactly two foods');
        await rows.filter({hasText: 'Hot dog'}).filter({hasText: '1,100'}).waitFor();
        await page.locator('#ql-add:not(:disabled)').waitFor();
        if (await page.locator('.sheet').count()) throw new Error('Describe must remain a full page');
        await page.evaluate(() => {
          document.activeElement.blur();
          // Keep confirmation above the sticky composer, just as scrolling the
          // full page normally would; don't try to scroll the retired sheet.
          const add = document.querySelector('#ql-add'), composer = document.querySelector('#ql-f');
          const overlap = add.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 12;
          if (overlap > 0) window.scrollBy(0, overlap);
        });
      }
      if (opt.scan) {       // what a scan finds: the product's sheet, one container, ready to add to breakfast. Scanning to log
        // starts on the "What did you eat?" page (+ › Scan a barcode), so that page sits behind the sheet, as in the app.
        await page.evaluate(() => { App.me.ai_ok = true; addSheet(isoDay(new Date()), 'breakfast'); });
        await page.click('#as-photo');
        await page.waitForURL('**/food/describe?**');
        await page.evaluate(async (code) => { const f = await api('/api/food/barcode/' + code); amountSheet(f, {day: $('#ql-day').value, meal: $('#ql-meal').value}, () => {}); }, opt.scan);
        await page.locator('#am-p b').first().waitFor();
        await page.evaluate(() => document.activeElement.blur());
      }
      if (opt.snap) {       // the conversation page: a meal photo plus a few words, then a correction in plain words
        const PHOTO = require('path').join(__dirname, '..', 'demo', 'photos', 'curry-rice-bowl.jpg');
        await page.evaluate(() => { App.me.ai_ok = true; addSheet(isoDay(new Date()), 'lunch'); });
        await page.click('#as-photo');
        await page.waitForURL('**/food/describe?**');
        await page.setInputFiles('#ql-file', PHOTO);
        await page.click('#photos-use');
        const shot = async (n) => { await page.evaluate(() => { document.activeElement.blur(); const add = document.querySelector('#ql-add'), composer = document.querySelector('#ql-f'), chat = document.querySelector('#ql-chat');
          document.querySelector('#page').style.paddingBottom = '240px';   // capture only: room to scroll the title away
          // start at the conversation (no half-cut title), and keep Add above the composer
          const overlap = add && composer ? add.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 12 : 0;
          window.scrollBy(0, Math.max(overlap, chat ? chat.getBoundingClientRect().top - 58 : 0)); });
          await page.waitForTimeout(500); await page.evaluate(chrome, scheme === 'dark'); await page.screenshot({path: `${OUT}/${scheme}-${n}.png`}); };
        for (const [k, t] of opt.snap.entries()) {
          await page.fill('#ql-t', t);
          await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/food/photo') && r.ok()), page.click('#ql-f .send')]);
          await page.locator('#ql-items').filter({hasText: /Estimating/}).waitFor({state: 'hidden'});
          await page.locator('#ql-items .ql-main').filter({hasText: 'Spiced rice'}).filter({hasText: k ? '160' : '320'}).waitFor();
          if (k === 0) await shot('snap');
        }
        if (await page.locator('.sheet').count()) throw new Error('The food story must remain a full page');
        await page.evaluate(() => { document.activeElement.blur(); const add = document.querySelector('#ql-add'), composer = document.querySelector('#ql-f'), chat = document.querySelector('#ql-chat');
          document.querySelector('#page').style.paddingBottom = '240px';   // capture only: room to scroll the title away
          // start at the conversation (no half-cut title), and keep Add above the composer
          const overlap = add && composer ? add.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 12 : 0;
          window.scrollBy(0, Math.max(overlap, chat ? chat.getBoundingClientRect().top - 58 : 0)); });
      }
      if (opt.lift) {       // Start lifting > repeat the latest session; the first exercise's sets ticked, the second's first set
        const id = await page.evaluate(async () => {
          const last = (await (await fetch('/api/lifts/sessions?limit=1')).json())[0];
          const r = await (await fetch('/api/lifts/start', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({copy_from: last.id})})).json();
          go('/track/lift/' + r.id); return r.id;
        });
        await page.waitForSelector('.lift-ex');
        const first = page.locator('.lift-ex').first();
        await first.locator('[data-tick="0"]').click();
        for (const j of [1, 2, 3]) { await first.locator(`.lift-in[data-j="${j}"][data-k="kg"]`).fill('205'); await first.locator(`[data-tick="${j}"]`).click(); }
        await page.locator('.lift-ex').nth(1).locator('[data-tick="0"]').click();
        await page.waitForTimeout(1500);
        await page.evaluate((x) => { document.activeElement.blur(); window.scrollTo(0, 0); window.__liftId = x; }, id);
      }
      if (name === 'coach') await page.locator('#d-kit').click();
      if (name === 'dietcoach') { await page.locator('#nt-coach button').waitFor({state:'visible'}); await page.locator('#nt-coach button').click(); }
      if (name === 'recipecoach') await page.locator('#dk-kit').click();
      if (opt.sel) await page.evaluate((q) => { const e = document.querySelector(q); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }, opt.sel);
      if (opt.to) await page.evaluate((t) => {
        const h = [...document.querySelectorAll('.card > h2, .coach-heading h2, h2.sec-head')].find((x) => x.textContent.trim().startsWith(t));
        if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70);   // below the status bar
      }, opt.to);
      await page.waitForTimeout(700);
      await page.evaluate(chrome, scheme === 'dark');
      await page.screenshot({path: `${OUT}/${scheme}-${name}.png`});
      if (opt.lift) await page.evaluate(() => fetch('/api/activities/' + window.__liftId, {method: 'DELETE', headers: {'Content-Type': 'application/json'}}));   // gone before the next pass's Today and feed
    }
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('shots taken');
})();
