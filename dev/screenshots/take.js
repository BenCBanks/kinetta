// Homepage screenshots (site/assets/shots): every shot in light and dark, at an iPhone 16's screen size (393 x 852 at 2x =
// 786 x 1704), from a throwaway install with dev/demo/seed.py + dev/screenshots/stage.py loaded. Usage: node take.js <out dir> [base url]
// Writes PNGs; to_webp.py turns them into the site's .webp files. Maps use the operator-configured tile/archive source; never bulk-fetch the public OSM tile service.
// Like a real iPhone (2026-10-13): the app gets the status bar's 59 px at the top and the home bar's 34 px at the bottom
// (its stylesheet's safe-area values are filled in), and a status bar with the Dynamic Island and the home bar are drawn over it.
const {chromium} = require('playwright');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
const SCREENSHOT_CLOCK = require('./fixture-time.json');
// name, address, and optionally a card title to scroll to, or something to do first
const SHOTS = require('./scenes.json');
// ONLY=lift,liftex takes just those (new shots, without retaking every other picture)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const W = 393, H = 852, TOP = 59, BOTTOM = 34;
async function enableKitForDemo(page) {
  // Kit requires the person's explicit opt-in; this is only the fictional screenshot account.
  const result = await page.evaluate(async () => {
    const saved = await api('/api/profile', json('PUT', {ai_ok: true, ai_adult: true}));
    App.me.ai_ok = true;
    return saved;
  });
  if (!result?.ok) throw Error('Could not opt the fictional screenshot account into Kit.');
}
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
  sb.style.cssText = 'position:fixed;left:0;top:0;width:393px;height:54px;z-index:2147483647;pointer-events:none;display:block';
  sb.innerHTML = `<rect width="${W}" height="54" fill="${bg}"/>
    <text x="66" y="35" text-anchor="middle" fill="${c}" font-family="-apple-system,'SF Pro Text',Inter,system-ui,sans-serif" font-size="17" font-weight="600" letter-spacing="-.2">9:41</text>
    <rect x="${W / 2 - 62}" y="11" width="124" height="36" rx="18" fill="#000"/>
    <g transform="translate(${W - 100} 21)" fill="${c}">
      <rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.7" y="6" width="3" height="6" rx="1"/><rect x="9.4" y="3.5" width="3" height="8.5" rx="1"/><rect x="14.1" y="1" width="3" height="11" rx="1"/>
      <path d="M29.5 3.2a9.6 9.6 0 0 1 13 0l-1.3 1.4a7.7 7.7 0 0 0-10.4 0zM32.1 6a5.9 5.9 0 0 1 7.8 0l-1.3 1.4a4 4 0 0 0-5.2 0zM34.7 8.7a2.2 2.2 0 0 1 2.6 0L36 10.2z"/>
      <rect x="49" y="1.2" width="24" height="10.6" rx="3.2" fill="none" stroke="${c}" stroke-opacity=".4"/><rect x="51" y="3.2" width="20" height="6.6" rx="1.8"/><path d="M74.6 4.8v3.4a1.8 1.8 0 0 0 0-3.4z" fill-opacity=".45"/></g>`;
  const hb = document.createElementNS(NS, 'svg');
  hb.id = 'k-hb'; hb.setAttribute('viewBox', `0 0 ${W} 13`); hb.setAttribute('width', W); hb.setAttribute('height', 13);
  hb.style.cssText = 'position:fixed;left:0;bottom:0;width:393px;height:13px;z-index:2147483647;pointer-events:none;display:block';
  hb.innerHTML = `<rect x="${W / 2 - 67}" y="0" width="134" height="5" rx="2.5" fill="${c}"/>`;
  document.body.append(sb, hb);
}
// Other capture scenes can send a made-up message and use the local estimator stand-in.
async function chat(page, meal) {
  await page.evaluate(async (m) => { await api('/api/profile', json('PUT', {ai_ok: true, ai_adult: true})); App.me.ai_ok = true; go('/food/describe?meal=' + m); }, meal);
  await page.locator('#thread-text').waitFor();
}
function snapshotFood() {
  const day = isoDay(new Date());
  return Promise.all([api('/api/food/day?d=' + day), api('/api/food/foods'), api('/api/food/thread?limit=100')])
    .then(([d, f, t]) => ({day, entries: d.entries.map(e => e.id), foods: f.map(x => x.id), messages: t.messages.map(m => m.id)}));
}
async function cleanFood(before) {
  const [d, f, t] = await Promise.all([api('/api/food/day?d=' + before.day), api('/api/food/foods'), api('/api/food/thread?limit=100')]);
  for (const e of d.entries) if (!before.entries.includes(e.id)) await api('/api/food/entries/' + e.id, {method: 'DELETE'}).catch(() => {});
  for (const x of f) if (!before.foods.includes(x.id)) await api('/api/food/foods/' + x.id, {method: 'DELETE'}).catch(() => {});
  for (const m of t.messages) if (m.kind === 'user' && !before.messages.includes(m.id)) await api('/api/food/thread/messages/' + m.id, {method: 'DELETE'}).catch(() => {});
  invalidate('/api/');
}
async function settle(page) {
  await page.locator('.thread-pending').first().waitFor({state: 'detached', timeout: 30000}).catch(() => {});
  await page.waitForTimeout(600);
}
async function loadedMaps(page){
  for(const preview of await page.locator('.fmap:visible').all()){
    if(!await preview.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    for(let n=0;n<150;n++){if(await preview.evaluate(el=>el.classList.contains('ready')))break;await page.waitForTimeout(100);}
    if(!await preview.evaluate(el=>el.classList.contains('ready')))throw Error('Visible feed map did not initialize');
  }
  for(const map of await page.locator('.leaflet-container:visible').all()){
    if(!await map.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    let stable=0;
    for(let n=0;n<200&&stable<3;n++){
      const ready=await map.evaluate(el=>{
        const box=el.getBoundingClientRect(),tiles=[...el.querySelectorAll('.leaflet-tile')].filter(tile=>{const r=tile.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<Math.min(box.right,innerWidth)&&r.right>Math.max(box.left,0)&&r.top<Math.min(box.bottom,innerHeight)&&r.bottom>Math.max(box.top,0);});
        return tiles.length>0&&tiles.every(tile=>tile.classList.contains('leaflet-tile-loaded'));
      });stable=ready?stable+1:0;if(stable<3)await page.waitForTimeout(100);
    }
    if(stable<3)throw Error('All visible basemap tiles must load before capture');
  }
  if(await page.locator('.map-unavailable:visible').count())throw Error('Capture requires the loaded approved basemap');
}
async function say(page, text) {
  const before = await page.locator('#thread-messages article').count();
  await page.fill('#thread-text', text); await page.click('#thread-send');
  await page.locator('#thread-messages article').nth(before).waitFor({timeout: 30000});   // locator waits work under the app's strict CSP
  await settle(page);
}
(async () => {
  const browser = await chromium.launch(), errors = [];
  const openFoodDemo = async (login, scheme) => {
    const context = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, colorScheme: scheme,
      timezoneId: SCREENSHOT_CLOCK.timezone, serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === B ? route.continue() : route.abort());
    await context.route('**/style.css*', async route => {
      const r = await route.fetch(), css = (await r.text())
        .replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g, TOP + 'px').replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g, BOTTOM + 'px');
      await route.fulfill({response: r, body: css});
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(SCREENSHOT_CLOCK.instant));
    page.on('pageerror', e => errors.push(`${scheme}: ${e.message}`));
    await page.goto(B + '/');
    await page.fill('input[name=login]', login);
    await page.fill('input[name=password]', 'green teapot on the hill');
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
    return {context, page};
  };
  try {
  for (const scheme of ['light', 'dark']) {
    // Keep the browser's calendar day aligned with the screenshot fixture used for staging.
    const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: 2, colorScheme: scheme,
      timezoneId: SCREENSHOT_CLOCK.timezone});
    let foodChatCtx = null, foodChatPage = null, foodRepeatCtx = null, foodRepeatPage = null;
    const basemap = await (await ctx.request.get(B+'/api/map-config')).json();
    if(!['pmtiles','vector'].includes(basemap.kind))throw Error('Capture needs an operator-controlled vector basemap');
    // The public archive admits the published app origin. Adapt only CORS for this local demo;
    // the range bytes and map renderer stay unchanged, and no production setting is edited.
    const archiveOrigin = new URL(basemap.url).origin;
    const publishedOrigin = process.env.KINETTA_SCREENSHOT_MAP_ORIGIN || 'https://login.kinetta.app';
    await ctx.route(archiveOrigin+'/**',async route=>{
      const request=route.request();
      if(!['GET','HEAD'].includes(request.method())||basemap.kind==='pmtiles'&&request.method()==='GET'&&!request.headers().range)return route.abort();
      const response=await route.fetch({headers:{...request.headers(),origin:publishedOrigin,referer:publishedOrigin+'/'}});
      if(!response.ok())throw Error('Approved capture map source returned HTTP '+response.status());
      await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':new URL(B).origin,'access-control-expose-headers':'content-range,content-length,etag'}});
    });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(SCREENSHOT_CLOCK.instant));
    await ctx.route('**/*', route => { const request=route.request(), url=new URL(request.url());
      if(url.hostname==='tile.openstreetmap.org'||url.origin!==B&&!['GET','HEAD'].includes(request.method()))return route.abort();
      return route.fallback();
    });
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
    await enableKitForDemo(page);
    const ids = await page.evaluate(async () => {
      const get = async (p) => (await fetch(p)).json();
      const acts = await get('/api/activities?limit=40'), routes = await get('/api/routes'), dishes = await get('/api/dishes'), segments = await get('/api/segments?mine=true');
      const loop = acts.find((a) => a.sport === 'run' && a.distance_m > 4600 && a.distance_m < 4950) || acts[0];
      const segment = segments.find((s) => s.name === 'Fictional Park Loop');
      if (!segment) throw Error('The fictional Park Loop segment must be staged before capture');
      const coach = (await Promise.all(acts.slice(0, 40).map((a) => get('/api/activities/' + a.id)))).find((a) => a.ai_note) || loop;
      return {FEED_ACTIVITY: acts[0].id, LATEST: '/activity/' + (acts.find(a => a.photos?.length && a.line) || acts[0]).id, RUN: '/activity/' + loop.id, RUN_NAME: loop.name, COACH: '/activity/' + coach.id, ROUTE: routes.length ? '/route/' + routes.sort((x, y) => y.count - x.count)[0].id : '/progress', SEGMENT: '/segments/' + segment.id,
        DISH: '/food/cook/' + ((dishes.find((d) => d.name === 'Chicken and veg traybake') || dishes[0] || {}).id || ''),
        SQUAT: '/lift/ex/' + (((await get('/api/lifts/exercises')).mine.find((x) => x.name === 'Squat') || {}).id || '')};
    });
    for (const [name, path, opt = {}] of SHOTS) {
      if (ONLY && !ONLY.includes(name)) continue;
      if (opt.foodChat === 'ready') {
        const demo = await openFoodDemo(`zz_test_658_chat_${scheme}`, scheme);
        foodChatCtx = demo.context;
        foodChatPage = demo.page;
        await enableKitForDemo(foodChatPage);
        await foodChatPage.goto(B + '/food/describe?meal=breakfast');
        await foodChatPage.locator('#thread-text').waitFor();
        const fixtureDraftId = await foodChatPage.evaluate(async () => {
          const payload = await fetch('/api/food/thread?limit=100').then(r => r.json());
          const message = [...(payload.messages || [])].reverse().find(m => m.kind === 'user' &&
            m.body === 'Greek yogurt with berries, oatmeal with banana, and a chicken salad bowl');
          const reply = message && payload.messages.find(m => m.kind === 'reply' && m.reply_to === message.id);
          const draftId = reply?.result?.draft_id;
          const key = Object.keys(localStorage).find(name => name.startsWith('fit.food.review.draft:'));
          if (!draftId || !key) throw Error('Could not find the staged Food chat draft for this fictional account.');
          const saved = JSON.parse(localStorage.getItem(key) || '{}');
          localStorage.setItem(key, JSON.stringify({...saved, id: draftId, meal: 'breakfast', active: true}));
          return draftId;
        });
        if (!fixtureDraftId) throw Error('Food screenshot fixture has no prepared review draft.');
        // FoodThread reads one active draft from device storage. Mount again after matching it to the seeded card.
        await foodChatPage.goto(B + '/food/describe?meal=breakfast');
        const ready = foodChatPage.locator('.thread-card').filter({hasText: 'Chicken salad bowl'});
        await ready.waitFor({timeout: 15000});
        await foodChatPage.locator('#thread-review-add').waitFor({state: 'visible'});
        const cardText = await ready.innerText();
        if (!['Greek yogurt with berries', 'Oatmeal with banana', 'Chicken salad bowl'].every(name => cardText.includes(name)) ||
            await ready.locator('.thread-food').count() !== 3) throw Error('Food chat capture must show three items in one review card.');
        if ((await foodChatPage.locator('#thread-review-add').innerText()).trim() !== 'Add to log') throw Error('Food chat capture must show Add to log.');
        await foodChatPage.evaluate(() => document.activeElement.blur());
        await foodChatPage.evaluate(chrome, scheme === 'dark');
        await foodChatPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await foodChatPage.screenshot({path: `${OUT}/${scheme}-${name}.png`});
        continue;
      }
      if (opt.foodChat === 'same-yesterday') {
        const demo = await openFoodDemo(`zz_test_658_food_${scheme}`, scheme);
        foodRepeatCtx = demo.context;
        foodRepeatPage = demo.page;
        await foodRepeatPage.evaluate(() => go('/food'));
        const shortcut = foodRepeatPage.locator('#fd-meals .meal-breakfast [data-repeat-yesterday="breakfast"]');
        await shortcut.waitFor({state: 'visible', timeout: 15000});
        const state = await shortcut.evaluate(button => ({
          text: button.textContent.trim(),
          empty: button.closest('.meal-breakfast')?.classList.contains('meal-empty'),
          entries: button.closest('.meal-breakfast')?.querySelectorAll('.fe').length
        }));
        if (state.text !== 'Same as yesterday · 225 kcal' || !state.empty || state.entries !== 0) throw Error('Repeat capture must show an empty Breakfast and its Same as yesterday shortcut.');
        await shortcut.scrollIntoViewIfNeeded();
        await foodRepeatPage.evaluate(() => document.activeElement.blur());
        await foodRepeatPage.evaluate(chrome, scheme === 'dark');
        await foodRepeatPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await foodRepeatPage.screenshot({path: `${OUT}/${scheme}-${name}.png`});
        continue;
      }
      await page.evaluate((p) => { document.querySelectorAll('.scrim').forEach((x) => x.remove()); document.body.classList.remove('has-sheet'); window.scrollTo(0, 0); go(p); }, ids[path] || path);   // no sheet left open from the shot before
      await page.waitForTimeout(1500);
      if(name==='activity'){
        const title=page.locator('.d-title h1');await title.waitFor({state:'visible'});
        const actual=(await title.innerText()).trim();
        if(actual!==ids.RUN_NAME)throw Error(`Activity detail keeps its recorded name "${ids.RUN_NAME}" (default names such as "Morning Run" are preserved), got "${actual}"`);
      }
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await page.evaluate(() => document.fonts.ready);
      // Locator/evaluate polling works under the app’s strict script policy.
      for(let n=0;n<40;n++){if(await page.evaluate(()=>!document.querySelector('.leaflet-tile-container')||document.querySelector('.leaflet-tile-loaded')))break;await page.waitForTimeout(100);}
      if(name==='feed'){
        await page.locator('#feed-tools[aria-busy=false]').waitFor({state:'attached'});
        if(await page.locator('#feed-discovery').count())throw Error('Mature feed must not show discovery cards');
        const group=page.locator(`#ff-list .post[data-href="/activity/${ids.FEED_ACTIVITY}"] .post-ft [data-reaction-group][data-aid="${ids.FEED_ACTIVITY}"]`);
        await group.waitFor({state:'visible'});
        for(const kind of ['clap','starstruck','mindblown'])if(await group.getAttribute(`data-count-${kind}`)!=='1')throw Error(`Demo feed must have one ${kind} reaction on the same card`);
        const react=group.locator('.reaction-more'),summaryButton=group.locator('.reaction-count'),summary=summaryButton.locator('.reaction-summary');
        const emojiNodes=summary.locator('.reaction-summary-emoji .reaction-emoji'),counts=summary.locator('.reaction-summary-count');
        await react.waitFor({state:'visible'});await emojiNodes.first().waitFor({state:'visible'});
        const kinds=(await group.getAttribute('data-reaction-order')||'').split(',').filter(Boolean);
        const shown=await emojiNodes.allTextContents(),values=await counts.allTextContents();
        const reactLabel=await react.getAttribute('aria-label'),reactText=(await react.innerText()).trim();
        if(reactLabel!=='React'||reactText!=='React'||!await summaryButton.isVisible()||kinds.length!==3||!['clap','starstruck','mindblown'].every(kind=>kinds.includes(kind))||shown.length!==3||!['👏','🤩','🤯'].every(value=>shown.includes(value))||values.length!==3||values.some(value=>value.trim()!=='1')||await summaryButton.locator('.num').count())throw Error('Demo feed must show React and each of three native emoji with its own count');
        // A map card can put its controls below the fixed tab bar at the top of the feed.
        // Scroll just enough to capture the action row clear of that bar.
        await group.evaluate(el=>{
          const footer=el.closest('.post-ft'),tabs=document.querySelector('nav.tabs');
          const controls=[footer?.querySelector('.reaction-more'),footer?.querySelector('.activity-comments'),el.querySelector('.reaction-count')].filter(Boolean);
          if(!tabs||!controls.length)return;
          const rowBottom=Math.max(...controls.map(node=>node.getBoundingClientRect().bottom));
          const safeBottom=tabs.getBoundingClientRect().top-8;
          if(rowBottom>safeBottom)window.scrollBy(0,rowBottom-safeBottom);
        });
        if(!await group.evaluate(el=>{
          const footer=el.closest('.post-ft');
          const action=footer?.querySelector('.reaction-more'),comments=footer?.querySelector('.activity-comments'),button=el.querySelector('.reaction-count');
          if(!footer||!action||!comments||!button)return false;
          const style=getComputedStyle(footer),contentRight=footer.getBoundingClientRect().right-(parseFloat(style.paddingRight)||0);
          const rects=[action,comments,button].map(node=>node.getBoundingClientRect()),actionRect=rects[0],commentRect=rects[1],buttonRect=rects[2];
          const limit=document.querySelector('nav.tabs').getBoundingClientRect().top;
          return rects.every(r=>r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=59&&r.bottom<=limit)
            &&Math.abs(commentRect.left-actionRect.right-8)<1&&Math.abs(buttonRect.right-contentRight)<1&&buttonRect.left>=commentRect.right;
        }))throw Error('Demo feed actions must stay left of the per-emoji counts in the captured viewport');
      }
      if(name==='insights'){await page.getByRole('heading',{name:'Insights',exact:true}).waitFor();await page.locator('#nt-overview-chart').waitFor();}
      if (opt.logDish) {      // Add food > My Recipes > the recipe: the log sheet, with a portion typed in
        await page.evaluate(() => describeSheet(isoDay(new Date()), 'dinner'));
        await page.locator('#thread-text').waitFor();
        await page.locator('[data-thread-quick="recipes"]').click();
        await page.locator('.sheet .fe[data-dish]').filter({hasText:opt.logDish}).click();
        await page.fill('#dl input[name=g]', opt.portion);
      }
      if(opt.summary){
        // Show real headline numbers alongside the remaining map, as after a short normal scroll.
        await page.locator('.d-title .hero').waitFor();
        await page.evaluate(()=>{const stats=document.querySelector('.d-title .hero'),tabs=document.querySelector('nav.tabs');window.scrollBy(0,Math.max(0,stats.getBoundingClientRect().bottom-tabs.getBoundingClientRect().top+16));});
      }
      if(opt.charts){
        await page.locator('[data-dt=charts][aria-selected=true]').waitFor();
        await page.locator('#d-charts .chartbox svg').first().waitFor();
        await page.locator('.dtabs').evaluate(el=>window.scrollTo(0,scrollY+el.getBoundingClientRect().top-129));
      }
      if(opt.similar){
        await page.locator('[data-dt=efforts]').click();
        const heading=page.getByRole('heading',{name:'Similar efforts',exact:true});
        await heading.evaluate(h=>window.scrollTo({top:h.getBoundingClientRect().top+scrollY-130,behavior:'instant'}));
        await page.waitForTimeout(100);
        if(!await heading.evaluate(h=>h.getBoundingClientRect().top<400&&h.getBoundingClientRect().top>100))throw Error('Similar efforts heading must be visible above the tab bar.');
      }
      if (opt.photo) {
        // The real activity always opens on its map. This feature example shows the next slide after a swipe.
        await page.click('[data-media-step="1"]');
        await page.waitForTimeout(450);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (opt.describe || opt.snap || opt.scan) {   // the food chat (2026-10-18): estimates come from dev/screenshots/standin.py
        const before = await page.evaluate(snapshotFood);
        await chat(page, opt.scan ? 'breakfast' : opt.snap ? 'lunch' : 'dinner');
        if (opt.describe) {      // type a meal, then correct its pending review in plain words
          await say(page, opt.describe[0]); await page.locator('.thread-card').filter({hasText: 'Hot dog'}).filter({hasText: '550'}).first().waitFor();
          await say(page, opt.describe[1]); await page.locator('.thread-card').filter({hasText: 'Hot dog'}).filter({hasText: '1100'}).first().waitFor();
        }
        if (opt.scan) {          // what a scan finds: the product's sheet, one container, ready to add to breakfast
          await page.evaluate(async (code) => { const f = await api('/api/food/barcode/' + code); amountSheet(f, {day: isoDay(new Date()), meal: 'breakfast'}, () => {}); }, opt.scan);
          await page.locator('#am-p b').first().waitFor();
        }
        if (opt.snap) {          // a meal photo plus a few words, then a correction in plain words
          const PHOTO = require('path').join(__dirname, '..', 'demo', 'photos', 'curry-rice-bowl.jpg');
          await page.fill('#thread-text', opt.snap[0]);
          await page.setInputFiles('#ql-file', PHOTO); await page.click('#photos-use');
          await settle(page); await page.locator('.thread-card').filter({hasText: 'Spiced rice'}).filter({hasText: '320'}).first().waitFor();
          await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(500);
          await loadedMaps(page); await page.evaluate(chrome, scheme === 'dark'); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); await page.screenshot({path: `${OUT}/${scheme}-snap.png`});
          await say(page, opt.snap[1]); await page.locator('.thread-card').filter({hasText: 'Spiced rice'}).filter({hasText: '160'}).first().waitFor();
        }
        await page.evaluate(() => document.activeElement.blur());
        await page.evaluate(() => api('/api/profile', json('PUT', {ai_ok: false})).then(() => { App.me.ai_ok = false; }));   // other shots stay as before
        opt.cleanup = before;   // removed after this shot is taken
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
      if (name === 'dietcoach') {
        const entry = page.locator('#nt-coach a[data-kit-entry][aria-label="Ask Kit"][href="/me/kit?from=nutrition"]');
        await entry.waitFor({state:'visible'});
        if (await entry.count() !== 1) throw Error('Nutrition screenshot needs exactly one visible Kit entry');
        await entry.click();
        await page.waitForFunction(() => location.pathname === '/me/kit' && new URLSearchParams(location.search).get('from') === 'nutrition');
        await page.locator('#kit-composer').waitFor({state:'visible'});
        await page.locator('#kit-intro h2').filter({hasText:'What can I help with?'}).waitFor({state:'visible'});
      }
      if (name === 'recipecoach') await page.locator('#dk-kit').click();
      if (opt.sel) await page.evaluate((q) => { const e = document.querySelector(q); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }, opt.sel);
      if (opt.to) await page.evaluate((t) => {
        const h = [...document.querySelectorAll('.card > h2, .coach-heading h2, h2.sec-head, #kit-intro h2')].find((x) => x.textContent.trim().startsWith(t));
        if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70);   // below the status bar
      }, opt.to);
      await page.waitForTimeout(700);
      await loadedMaps(page); await page.evaluate(chrome, scheme === 'dark'); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.screenshot({path: `${OUT}/${scheme}-${name}.png`});
      if (opt.lift) await page.evaluate(() => fetch('/api/activities/' + window.__liftId, {method: 'DELETE', headers: {'Content-Type': 'application/json'}}));
      // Remove only what this fictional review story added (entries, saved foods, messages) so the next pass and
      // the other screenshots start from the same demo data.
      if (opt.cleanup) { await page.evaluate(cleanFood, opt.cleanup); delete opt.cleanup; }   // gone before the next pass's Today and feed
    }
    await ctx.unrouteAll({behavior:'ignoreErrors'});
    await ctx.close();
    await foodChatCtx?.close();
    await foodRepeatCtx?.close();
  }
  } finally { await browser.close(); }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('shots taken');
})();
