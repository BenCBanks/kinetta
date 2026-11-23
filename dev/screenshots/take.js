// Fictional browser screenshots from a disposable install. Defaults are the website's 393 x 852 @2x scenes;
// SCREENSHOT_WIDTH/HEIGHT/SCALE/THEMES can select a labeled App Store fallback viewport such as 440 x 956 @3x.
// Usage: node take.js <out dir> [base url]
// Writes PNGs; to_webp.py turns them into the site's .webp files. Maps use the operator-configured tile/archive source; never bulk-fetch the public OSM tile service.
// Like a real iPhone (2026-10-13): the app gets the status bar's 59 px at the top and the home bar's 34 px at the bottom
// (its stylesheet's safe-area values are filled in), and a status bar with the Dynamic Island and the home bar are drawn over it.
const {chromium} = require('playwright');
const fs = require('node:fs');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
const SCREENSHOT_CLOCK = require('./fixture-time.json');
const OWNER_LOGIN = process.env.KINETTA_SCREENSHOT_FIXTURE === '1' ? 'nia' : 'alex';
// name, address, and optionally a card title to scroll to, or something to do first
const SHOTS = require('./scenes.json');
// ONLY=lift,liftex takes just those (new shots, without retaking every other picture)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const MAP_SHOTS = new Set(['home-feed','activity-detail','feed','activity','activity-splits','route']);
const NEEDS_MAP = !ONLY || ONLY.some(name => MAP_SHOTS.has(name));
// The screenshot-only public PMTiles relay can see transient resets on large range reads.
async function fetchArchive(route, headers) {
  for (let attempt = 0; ; attempt++) {
    try { return await route.fetch({headers, timeout: 60_000}); }
    catch (error) {
      const transient = error?.name === 'TimeoutError' || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(error?.message || '');
      if (!transient || attempt >= 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
}
const W = Number(process.env.SCREENSHOT_WIDTH || 393);
const H = Number(process.env.SCREENSHOT_HEIGHT || 852);
const SCALE = Number(process.env.SCREENSHOT_SCALE || 2);
const TOP = Number(process.env.SCREENSHOT_SAFE_TOP || 59), BOTTOM = Number(process.env.SCREENSHOT_SAFE_BOTTOM || 34);
const SCHEMES = (process.env.SCREENSHOT_THEMES || 'light,dark').split(',').filter(value => ['light','dark'].includes(value));
const SAFE_AREA_AUDIT = [];
if (![W,H,SCALE,TOP,BOTTOM].every(Number.isFinite) || W < 320 || H < 600 || SCALE < 1 || SCALE > 4 || !SCHEMES.length) {
  throw Error('Invalid browser screenshot viewport/theme settings');
}
async function emulateSafeArea(route) {
  if (new URL(route.request().url()).origin !== B) return route.fallback();
  const response = await route.fetch(), css = (await response.text())
    .replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g, TOP + 'px')
    .replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g, BOTTOM + 'px');
  await route.fulfill({response, body: css});
}
// Feed media and activity-detail bar controls can cross the simulated status bar after scroll restoration.
async function hideIntersectingMediaControls(page) {
  return page.evaluate(top => [...document.querySelectorAll('.media-photo-open, .media-controls [data-media-step], .detail-bar a, .detail-bar button')]
    .filter(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < top &&
        s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05 && s.pointerEvents !== 'none';
    })
    .map(el => {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
      el.dataset.captureSafeHidden = 'true';
      el.style.setProperty('visibility', 'hidden', 'important');
      return label;
    }), TOP);
}
async function settleDetailContentBelowSafeArea(page) {
  await page.evaluate(async top => {
    // Chromium's browser safe-area env is zero even though this capture draws an iPhone status bar.
    // Keep the sticky Activity tabs below that simulated status bar before checking/capturing.
    const tabs = document.querySelector('.activity-detail .activity-tabs');
    if (tabs) tabs.style.setProperty('top', `${top + 8}px`, 'important');
    for (let attempt = 0; attempt < 4; attempt++) {
      const overlap = [...document.querySelectorAll('a[href],button,[role="button"],input,select,textarea')]
        .filter(el => !el.closest('.detail-bar'))
        .map(el => ({el, rect: el.getBoundingClientRect(), style: getComputedStyle(el)}))
        .filter(({rect, style}) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < top &&
          style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > .05 && style.pointerEvents !== 'none');
      if (!overlap.length) return;
      const firstTop = Math.min(...overlap.map(({rect}) => rect.top));
      const next = Math.max(0, scrollY - (top - firstTop + 8));
      if (next === scrollY) return;
      window.scrollTo({top: next, behavior: 'instant'});
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  }, TOP);
}
async function settleFeedHeaderBelowSafeArea(page) {
  await page.evaluate(top => {
    const header = document.querySelector('#page > #feed-top:has(.shell-topbar-root)');
    if (header) header.style.setProperty('top', `${top + 8}px`, 'important');
  }, TOP);
}
async function settleHomeFeedReactionBelowSafeArea(group) {
  const header=await group.evaluate(async (el, safeTop) => {
    const cardHeader=el.closest('.post')?.querySelector('.post-hd');
    if(!cardHeader)return{valid:false,missing:true};
    const nav=document.querySelector('.home-view-switch'),feedTop=document.querySelector('#feed-top');
    const navRect=nav?.getBoundingClientRect(),feedRect=feedTop?.getBoundingClientRect(),top=cardHeader.getBoundingClientRect().top;
    const gap=navRect&&top>navRect.bottom?top-navRect.bottom:0;
    const target=Math.max(safeTop+8,(feedRect?.bottom??safeTop)+8+(navRect?.height??0)+gap);
    const next=Math.max(0,scrollY+top-target);
    if(next!==scrollY)window.scrollTo({top:next,behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=cardHeader.getBoundingClientRect();
    return{valid:rect.top>=safeTop&&Math.abs(rect.top-target)<2,top:rect.top,target,scrollY};
  },TOP);
  if(!header.valid)throw Error('Home feed card header is not below the status-bar safe area: '+JSON.stringify(header));
}
async function assertTopSafeControls(page, scene, hiddenMediaControls = []) {
  const overlaps = await page.evaluate(top => [...document.querySelectorAll('a[href],button,[role="button"],input,select,textarea')]
    .filter(el => {
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&r.bottom>0&&r.top<top&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.05&&s.pointerEvents!=='none';
    })
    .map(el => ({tag:el.tagName,label:(el.getAttribute('aria-label')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,48),top:Math.round(el.getBoundingClientRect().top),bottom:Math.round(el.getBoundingClientRect().bottom)})), TOP);
  if(overlaps.length)throw Error(`${scene}: controls overlap the first ${TOP}px status-bar safe area: ${JSON.stringify(overlaps)}`);
  SAFE_AREA_AUDIT.push({scene,topInsetPx:TOP,controlsClear:true,hiddenMediaControls});
}
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
function chrome({dark, width}) {
  const c = dark ? '#fff' : '#000', W = width;
  for (const id of ['k-sb', 'k-hb']) document.getElementById(id)?.remove();
  // like the installed app, the page's colour sits behind the status bar, except over a map at the very top
  const bg = document.querySelector('.scrim') || (document.querySelector('.map-head') && scrollY < 40) ? 'transparent' : getComputedStyle(document.body).backgroundColor;   // a sheet's dimmed page shows through
  const NS = 'http://www.w3.org/2000/svg', sb = document.createElementNS(NS, 'svg');
  sb.id = 'k-sb'; sb.setAttribute('viewBox', `0 0 ${W} 54`); sb.setAttribute('width', W); sb.setAttribute('height', 54);
  // set through .style: the app's security policy ignores style="..." attributes
  sb.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:54px;z-index:2147483647;pointer-events:none;display:block`;
  sb.innerHTML = `<rect width="${W}" height="54" fill="${bg}"/>
    <text x="66" y="35" text-anchor="middle" fill="${c}" font-family="-apple-system,'SF Pro Text',Inter,system-ui,sans-serif" font-size="17" font-weight="600" letter-spacing="-.2">9:41</text>
    <rect x="${W / 2 - 62}" y="11" width="124" height="36" rx="18" fill="#000"/>
    <g transform="translate(${W - 100} 21)" fill="${c}">
      <rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.7" y="6" width="3" height="6" rx="1"/><rect x="9.4" y="3.5" width="3" height="8.5" rx="1"/><rect x="14.1" y="1" width="3" height="11" rx="1"/>
      <path d="M29.5 3.2a9.6 9.6 0 0 1 13 0l-1.3 1.4a7.7 7.7 0 0 0-10.4 0zM32.1 6a5.9 5.9 0 0 1 7.8 0l-1.3 1.4a4 4 0 0 0-5.2 0zM34.7 8.7a2.2 2.2 0 0 1 2.6 0L36 10.2z"/>
      <rect x="49" y="1.2" width="24" height="10.6" rx="3.2" fill="none" stroke="${c}" stroke-opacity=".4"/><rect x="51" y="3.2" width="20" height="6.6" rx="1.8"/><path d="M74.6 4.8v3.4a1.8 1.8 0 0 0 0-3.4z" fill-opacity=".45"/></g>`;
  const hb = document.createElementNS(NS, 'svg');
  hb.id = 'k-hb'; hb.setAttribute('viewBox', `0 0 ${W} 13`); hb.setAttribute('width', W); hb.setAttribute('height', 13);
  hb.style.cssText = `position:fixed;left:0;bottom:0;width:${W}px;height:13px;z-index:2147483647;pointer-events:none;display:block`;
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
async function waitForMaps(page, {advanceMapFade = false, requireMap = false} = {}){
  let visibleMaps=0;
  for(const preview of await page.locator('.fmap:visible').all()){
    if(!await preview.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    visibleMaps++;
    const deadline=Date.now()+15000;
    while(Date.now()<deadline&& !await preview.evaluate(el=>el.classList.contains('ready')))await page.waitForTimeout(100);
    if(!await preview.evaluate(el=>el.classList.contains('ready')))throw Error('Visible feed map did not initialize within 15 seconds');
  }
  let fadeClockAdvanced=false;
  for(const map of await page.locator('.leaflet-container:visible').all()){
    if(!await map.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&r.width>0&&r.height>0;}))continue;
    visibleMaps++;
    const snapshot=()=>map.evaluate(el=>{
      const box=el.getBoundingClientRect(),tiles=[...el.querySelectorAll('.leaflet-tile')].filter(tile=>{const r=tile.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<Math.min(box.right,innerWidth)&&r.right>Math.max(box.left,0)&&r.top<Math.min(box.bottom,innerHeight)&&r.bottom>Math.max(box.top,0);});
      return tiles.map(tile=>({url:tile.currentSrc||tile.src||'(tile URL unavailable)',loaded:tile.classList.contains('leaflet-tile-loaded'),opacity:Number(getComputedStyle(tile).opacity)}));
    });
    let stable=0,previous='',tiles=[];
    const tileDeadline=Date.now()+15000;
    while(Date.now()<tileDeadline&&stable<3){
      tiles=await snapshot();const signature=JSON.stringify(tiles.map(tile=>[tile.url,tile.loaded]));
      stable=tiles.length&&tiles.every(tile=>tile.loaded)&&signature===previous?stable+1:0;previous=signature;
      if(stable<3)await page.waitForTimeout(100);
    }
    const describeFailures=items=>items.filter(tile=>!tile.loaded||tile.opacity<0.999).map(tile=>`${tile.url} [${tile.loaded?'loaded':'not loaded'}, opacity ${tile.opacity}]`);
    if(stable<3){
      tiles=await snapshot();
      const failed=describeFailures(tiles);throw Error(`Visible basemap tiles did not become loaded and idle within 15 seconds; failed tiles: ${failed.length?failed.join('; '):'tile set kept changing or no visible tiles were found'}`);
    }
    if(advanceMapFade){
      // These screenshot scenes freeze Date.now(); advance only Leaflet's 200 ms tile fade after loading.
      if(!fadeClockAdvanced){
        await page.clock.setFixedTime(new Date(await page.evaluate(()=>Date.now())+250));
        fadeClockAdvanced=true;
      }
      let opaqueStable=0,fadeSignature='',fadeTiles=[];const fadeDeadline=Date.now()+5000;
      while(Date.now()<fadeDeadline&&opaqueStable<3){
        fadeTiles=await snapshot();const failed=describeFailures(fadeTiles),signature=JSON.stringify(fadeTiles.map(tile=>[tile.url,tile.opacity]));
        const opaque=fadeTiles.length>0&&failed.length===0&&fadeTiles.every(tile=>tile.opacity>=0.999);
        opaqueStable=opaque&&signature===fadeSignature?opaqueStable+1:0;fadeSignature=signature;
        if(opaqueStable<3)await page.waitForTimeout(100);
      }
      if(opaqueStable<3){
        fadeTiles=await snapshot();const failed=describeFailures(fadeTiles);
        throw Error(`Visible basemap tiles did not finish fading in within 5 seconds; failed tiles: ${failed.length?failed.join('; '):'tile opacity kept changing or stayed below 0.999'}`);
      }
    }
  }
  if(requireMap&&!visibleMaps)throw Error('Visible basemap map did not appear in the capture viewport');
  if(await page.locator('.map-unavailable:visible').count())throw Error('Visible basemap unavailable; the capture requires a loaded approved basemap');
}
async function loadedMaps(page, options={}){
  let firstError;
  for(let attempt=0;attempt<2;attempt++){
    try{return await waitForMaps(page,options);}
    catch(error){
      if(attempt||!/Visible (?:feed map|basemap (?:tiles|map|unavailable))/.test(error.message)){
        if(firstError)throw Error(`${error.message}; one page-load retry was already attempted after: ${firstError.message}`);
        throw error;
      }
      firstError=error;
      const y=await page.evaluate(()=>window.scrollY).catch(()=>0);
      console.warn(`${error.message}; retrying this page load once.`);
      await page.reload({waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForSelector('nav.tabs',{state:'attached',timeout:20000});
      await page.waitForSelector('#page',{state:'attached',timeout:20000});
      try{await page.locator('.fmap:visible, .leaflet-container:visible').first().waitFor({state:'visible',timeout:20000});}
      catch{throw Error(`Retried screenshot page did not render a basemap within 20 seconds; first attempt: ${firstError.message}`);}
      await page.evaluate(async scrollY=>{await document.fonts.ready;window.scrollTo(0,scrollY);},y);
      await page.waitForTimeout(700);
    }
  }
}
async function say(page, text) {
  const before = await page.locator('#thread-messages article').count();
  await page.fill('#thread-text', text); await page.click('#thread-send');
  await page.locator('#thread-messages article').nth(before).waitFor({timeout: 30000});   // locator waits work under the app's strict CSP
  await settle(page);
}
async function closeCaptureContext(context) {
  if (!context) return;
  for (const page of context.pages()) await page.unrouteAll({behavior: 'wait'});
  await context.unrouteAll({behavior: 'wait'});
  await context.close();
}
(async () => {
  const browser = await chromium.launch(), errors = [];
  const openFoodDemo = async (login, scheme, height = H) => {
    const context = await browser.newContext({viewport: {width: W, height}, deviceScaleFactor: SCALE, colorScheme: scheme,
      timezoneId: SCREENSHOT_CLOCK.timezone, serviceWorkers: 'block'});
    await context.route('**/*', route => new URL(route.request().url()).origin === B ? route.continue() : route.abort());
    await context.route('**/*.css*', emulateSafeArea);
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('kinetta.firstRunWelcomeSeen', 'true'));
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
  for (const scheme of SCHEMES) {
    // Keep the browser's calendar day aligned with the screenshot fixture used for staging.
    const ctx = await browser.newContext({viewport: {width: W, height: H}, deviceScaleFactor: SCALE, colorScheme: scheme,
      timezoneId: SCREENSHOT_CLOCK.timezone});
    let foodChatCtx = null, foodChatPage = null, foodRepeatCtx = null, foodRepeatPage = null;
    if(NEEDS_MAP){
      const basemap = await (await ctx.request.get(B+'/api/map-config')).json();
      if(!['pmtiles','vector'].includes(basemap.kind))throw Error('Capture needs an operator-controlled vector basemap');
      // The public archive admits the published app origin. Adapt only CORS for this local demo;
      // the range bytes and map renderer stay unchanged, and no production setting is edited.
      const archiveOrigin = new URL(basemap.url).origin;
      const publishedOrigin = process.env.KINETTA_SCREENSHOT_MAP_ORIGIN || 'https://login.kinetta.app';
      await ctx.route(archiveOrigin+'/**',async route=>{
        const request=route.request();
        if(!['GET','HEAD'].includes(request.method())||basemap.kind==='pmtiles'&&request.method()==='GET'&&!request.headers().range)return route.abort();
        const response=await fetchArchive(route,{...request.headers(),origin:publishedOrigin,referer:publishedOrigin+'/'});
        if(!response.ok())throw Error('Approved capture map source returned HTTP '+response.status());
        await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':new URL(B).origin,'access-control-expose-headers':'content-range,content-length,etag'}});
      });
    }
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__KINETTA_SCREENSHOT_MODE__ = true;
      // The fixture starts with an established demo account; skip first-run welcome before app.js chooses its screen.
      localStorage.setItem('kinetta.firstRunWelcomeSeen', 'true');
    });
    await page.clock.setFixedTime(new Date(SCREENSHOT_CLOCK.instant));
    await ctx.route('**/*', route => { const request=route.request(), url=new URL(request.url());
      if(url.hostname==='tile.openstreetmap.org'||url.origin!==B&&!['GET','HEAD'].includes(request.method()))return route.abort();
      return route.fallback();
    });
    // the iPhone's status bar and home bar spaces: what env(safe-area-inset-*) is on a phone (0 in a desktop browser)
    await page.route('**/*.css*', emulateSafeArea);
    await page.route('**/api/food/photo', (route) => { const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({json: body.images || body.image ? BOWL(body.note) : SAMPLE(body.note)}); });
    await page.route('**/api/food/barcode/*', (route) => route.fulfill({json: PRODUCT}));
    await page.route('**/api/food/meals-chat/products?**', route => route.fulfill({json: {query: '', foods: [], portion: null}}));
    // the combined lookup (one request for every new food): nothing in the databases, so the stand-in AI estimates them
    await page.route('**/api/food/meals-chat/lookup', route => route.fulfill({json: {results: JSON.parse(route.request().postData() || '{}').texts.map(text => ({text, query: '', kind: 'none', foods: [], portion: null}))}}));
    page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
    await page.goto(B + '/');
    await page.locator('.login form input[name="login"]').waitFor({state: 'visible'});
    await page.fill('.login form input[name=login]', OWNER_LOGIN); await page.fill('input[name=password]', 'blue kettle morning run');
    await page.click('button[type=submit]'); await page.waitForSelector('nav.tabs');
    await enableKitForDemo(page);
    const ids = await page.evaluate(async () => {
      const get = async (p) => (await fetch(p)).json();
      const acts = await get('/api/activities?limit=40'), routes = await get('/api/routes'), dishes = await get('/api/dishes');
      const loop = acts.find((a) => a.sport === 'run' && a.distance_m > 4600 && a.distance_m < 4950) || acts[0];
      const coach = (await Promise.all(acts.slice(0, 40).map((a) => get('/api/activities/' + a.id)))).find((a) => a.ai_note) || loop;
      const splitRun = acts.filter(a => a.sport === 'run' && a.distance_m > 6200 && a.distance_m < 7000).sort((a,b) => Math.abs(a.distance_m-6600) - Math.abs(b.distance_m-6600))[0] || loop;
      return {FEED_ACTIVITY: acts[0].id, LATEST: '/activity/' + (acts.find(a => a.photos?.length && a.line) || acts[0]).id, RUN: '/activity/' + loop.id, RUN_NAME: loop.name, RUN_SPLITS: '/activity/' + splitRun.id, COACH: '/activity/' + coach.id, ROUTE: routes.length ? '/route/' + routes.sort((x, y) => y.count - x.count)[0].id : '/progress',
        DISH: '/food/cook/' + ((dishes.find((d) => d.name === 'Chicken and veg traybake') || dishes[0] || {}).id || ''),
        SQUAT: '/lift/ex/' + (((await get('/api/lifts/exercises')).mine.find((x) => x.name === 'Squat') || {}).id || '')};
    });
    for (const [name, path, opt = {}] of SHOTS) {
      if (ONLY && !ONLY.includes(name)) continue;
      const kitInsightRoute = /\/api\/coach\/conversation(?:\/.*)?(?:\?.*)?$/;
      const kitInsightFixture = name === 'kit-insight-progress';
      if (kitInsightFixture) await page.route(kitInsightRoute, async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === '/api/coach/conversation/visits') {
          const visit_id = request.postDataJSON().visit_id;
          return route.fulfill({json: {generation: '00000000-0000-4000-8000-000000001049', visit_id, ready: true}});
        }
        if (request.method() === 'GET' && url.pathname === '/api/coach/conversation') {
          const visit_id = url.searchParams.get('visit_id');
          return route.fulfill({json: {generation: '00000000-0000-4000-8000-000000001049', visit_id, before: null, ready: true,
            messages: [{id: 1, client_id: '1049-progress-insight', generation: '00000000-0000-4000-8000-000000001049', visit_id,
              question: 'Am I improving?', context: {screen: 'progress'}, state: 'answered', error: null,
              answer: {interpretation: 'Your latest run total is below your recent average; this chart also shows stronger weeks. One week alone cannot establish a lasting trend.',
                facts: [{label: 'This week · Run', value: '10.8 mi'}, {label: 'Weekly average · Run', value: '20.6 mi'}, {label: 'Best week · Run', value: '27.9 mi'}],
                limitations: ['Only recorded workouts are included.'], actions: []}, created: '2026-11-13T14:00:00Z'}]}});
        }
        if (request.method() === 'POST' && url.pathname.endsWith('/end')) return route.fulfill({json: {ok: true}});
        return route.fulfill({status: 404, json: {detail: 'Unneeded screenshot fixture request.'}});
      });
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
          const draftId = message?.result?.draft_id;
          const key = Object.keys(localStorage).find(name => name.startsWith('fit.food.review.draft:'));
          if (!draftId || reply?.result?.kind !== 'preview' || !key) throw Error('Could not find the staged Food chat draft for this fictional account.');
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
        await foodChatPage.evaluate(chrome, {dark: scheme === 'dark', width: W});
        await foodChatPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await foodChatPage.screenshot({path: `${OUT}/${scheme}-${name}.png`});
        continue;
      }
      if (opt.foodChat === 'weight-ready') {
        const demo = await openFoodDemo(`zz_test_1049_food_${scheme}`, scheme);
        foodChatCtx = demo.context;
        foodChatPage = demo.page;
        await foodChatPage.goto(B + '/food/describe?meal=breakfast');
        await foodChatPage.locator('#thread-text').waitFor();
        await foodChatPage.evaluate(async () => {
          const data = await fetch('/api/food/thread?limit=100').then(r => r.json());
          const message = [...(data.messages || [])].reverse().find(m => m.kind === 'user' && m.body === '2 eggs and toast, weighed 165 this morning');
          const draftId = message?.result?.draft_id;
          const key = Object.keys(localStorage).find(name => name.startsWith('fit.food.review.draft:'));
          if (!draftId || !key) throw Error('Could not find the staged fictional food-and-weight review.');
          localStorage.setItem(key, JSON.stringify({id: draftId, meal: 'breakfast', day: message.local_day, explicitDay: true, active: true}));
        });
        await foodChatPage.goto(B + '/food/describe?meal=breakfast');
        const message = foodChatPage.locator('#thread-messages article').filter({hasText: '2 eggs and toast, weighed 165 this morning'});
        await message.waitFor({timeout: 15000});
        const add = foodChatPage.locator('#thread-review-add');
        await add.waitFor({state: 'visible'});
        await add.click();
        const weightRow = foodChatPage.locator('#review-body-weight .review-food-row');
        await weightRow.waitFor({state: 'visible'});
        const review = foodChatPage.locator('#food-final-review');
        for (const food of ['Eggs', 'Whole-wheat toast']) await review.getByText(food, {exact: true}).waitFor({state: 'visible'});
        if (!(await weightRow.innerText()).includes('165.0') || !(await weightRow.innerText()).includes('lb') ||
            (await foodChatPage.locator('#review-confirm').innerText()).trim() !== 'Add food and weight') {
          throw Error('Food-and-weight review must show its 165 lb entry and Add food and weight action.');
        }
        await foodChatPage.evaluate(chrome, {dark: scheme === 'dark', width: W});
        await foodChatPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await foodChatPage.screenshot({path: `${OUT}/${scheme}-${name}.png`});
        continue;
      }
      if (opt.foodChat === 'confirmed') {
        const demo = await openFoodDemo(`zz_test_1319_chat_${scheme}`, scheme);
        foodChatCtx = demo.context;
        foodChatPage = demo.page;
        await enableKitForDemo(foodChatPage);
        await foodChatPage.goto(B + '/food/describe?meal=lunch');
        await foodChatPage.locator('#thread-text').waitFor();
        const fixtureDay = await foodChatPage.evaluate(async () => {
          const payload = await fetch('/api/food/thread?limit=100').then(r => r.json());
          const message = [...(payload.messages || [])].reverse().find(m => m.kind === 'user' && m.body === 'Chicken sandwich and an apple for lunch');
          const reply = message && payload.messages.find(m => m.kind === 'reply' && m.reply_to === message.id);
          const me = await fetch('/api/me').then(r => r.json());
          const key = Object.keys(localStorage).find(name => name.startsWith('fit.food.review.draft:')) ||
            'fit.food.review.draft:' + JSON.stringify([location.origin, me.id]);
          if (!message?.result?.draft_id || reply?.result?.kind !== 'preview') {
            throw Error('Missing the fictional #1319 meal review fixture.');
          }
          localStorage.setItem(key, JSON.stringify({id: message.result.draft_id, meal: 'lunch', day: message.local_day, explicitDay: true, active: true}));
          return message.local_day;
        });
        await foodChatPage.goto(B + '/food/describe?meal=lunch');
        const message = foodChatPage.locator('#thread-messages article').filter({hasText: 'Chicken sandwich and an apple for lunch'});
        await message.waitFor({timeout: 15000});
        const reply = foodChatPage.locator('.thread-card').filter({hasText: 'Chicken sandwich'});
        await reply.waitFor({state: 'visible'});
        for (const text of ['Chicken sandwich', 'Apple']) {
          if (!await reply.getByText(text, {exact: true}).count()) throw Error('The Kit meal reply should contain the sandwich and apple.');
        }
        const add = foodChatPage.locator('#thread-review-add');
        await add.waitFor({state: 'visible'});
        if (await add.isDisabled()) throw Error('The Kit meal estimate must be complete before the Add to log confirmation.');
        await add.click();
        await foodChatPage.waitForFunction(async day => {
          const data = await fetch('/api/food/day?d=' + day).then(r => r.json());
          return data.entries.some(entry => entry.name === 'Chicken sandwich' && entry.meal === 'lunch') &&
            data.entries.some(entry => entry.name === 'Apple' && entry.meal === 'lunch');
        }, fixtureDay);
        const logged = foodChatPage.locator('.thread-logged-summary').first();
        await logged.waitFor({state: 'visible'});
        await logged.click();
        await foodChatPage.locator('.thread-logged-details').first().waitFor({state: 'visible'});
        const history = await foodChatPage.locator('#thread-messages').innerText();
        if (!history.includes('Chicken sandwich and an apple for lunch') || !history.includes('Chicken sandwich') || !history.includes('Apple')) {
          throw Error('Confirmed meal capture needs the typed meal, Kit reply, and logged foods in the conversation.');
        }
        await foodChatPage.evaluate(() => document.activeElement.blur());
        await foodChatPage.waitForFunction(() => {
          const toast = document.querySelector('#toast');
          return !toast || (!toast.classList.contains('on') && Number(getComputedStyle(toast).opacity) < 0.01);
        }, {timeout: 10000});
        await foodChatPage.locator('.shell.food-thread').evaluate(el => el.style.setProperty('--chat-height', '540px'));
        await foodChatPage.waitForTimeout(50);
        await foodChatPage.evaluate(chrome, {dark: scheme === 'dark', width: W});
        await foodChatPage.locator('#k-hb').evaluate((el, offset) => { el.style.bottom = `${offset}px`; }, H - 540);
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
        await foodRepeatPage.evaluate(chrome, {dark: scheme === 'dark', width: W});
        await foodRepeatPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await foodRepeatPage.screenshot({path: `${OUT}/${scheme}-${name}.png`});
        continue;
      }
      if (kitInsightFixture) await page.evaluate(() => {
        App.me.ai_ok = true; App.me.ai_paused = false; App.me.kit_chat = true; App.me.coach = true;
        App.me.ai_access ||= {}; App.me.ai_access.coach = {available: true, entitled: true};
      });
      await page.evaluate((p) => {
        document.querySelectorAll('.scrim').forEach((x) => x.remove());
        document.body.classList.remove('has-sheet');
        // A prior visit can leave a saved route position. Clear it before Kit's chat
        // locks document scrolling, or its header can be restored under the status bar.
        if (App.scroll) App.scroll[p] = 0;
        window.scrollTo({top: 0, behavior: 'instant'});
        go(p);
      }, ids[path] || path);   // no sheet left open from the shot before
      await page.waitForTimeout(1500);
      if(name==='profile'){
        const entry=page.locator('.me-featured-title a');await entry.waitFor({state:'visible'});
        if((await entry.innerText()).trim()!=='See all')throw Error('Profile example must show the entry to Achievements.');
      }
      if (name === 'nutrition-filled') {
        await page.locator('.calorie-ring[aria-valuetext="1,650 of 1,800 calories"]').waitFor({state: 'visible', timeout: 12000});
        await page.getByText('Oats and berries', {exact: true}).waitFor({state: 'visible'});
        await page.getByText('Chicken grain bowl', {exact: true}).waitFor({state: 'visible'});
        await page.getByText('Vegetables and rice', {exact: true}).waitFor({state: 'visible'});
      }
      if (kitInsightFixture) {
        await page.locator('#kit-messages .kit-answer').filter({hasText: 'Your latest run total'}).waitFor({state: 'visible'});
        if ((await page.locator('#kit-status').innerText()).trim()) throw Error('Kit insight screenshot should not show a stale-chat warning.');
      }
      if(name==='activity'||name==='activity-detail'){
        const title=page.locator('.d-title h1');await title.waitFor({state:'visible'});
        const actual=(await title.innerText()).trim();
        if(actual!==ids.RUN_NAME)throw Error(`Activity detail keeps its recorded name "${ids.RUN_NAME}" (default names such as "Morning Run" are preserved), got "${actual}"`);
      }
      if(opt.tab){
        const tab=page.locator(`[data-dt="${opt.tab}"]`);
        await tab.waitFor({state:'visible'});await tab.click();
        await page.locator(`#activity-pane-${opt.tab}:visible`).waitFor();
      }
      await page.evaluate((scene) => {
        if (scene === 'kit-insight-progress' && App.scroll) App.scroll[location.pathname + location.search] = 0;
        window.scrollTo({top: 0, behavior: 'instant'});
      }, name);
      await page.evaluate(() => document.fonts.ready);
      // Locator/evaluate polling works under the app’s strict script policy.
      for(let n=0;n<40;n++){if(await page.evaluate(()=>!document.querySelector('.leaflet-tile-container')||document.querySelector('.leaflet-tile-loaded')))break;await page.waitForTimeout(100);}
      if(name==='feed'||name==='home-feed'){
        await page.locator('#feed-tools[aria-busy=false]').waitFor({state:'attached'});
        if(await page.locator('#feed-discovery').count())throw Error('Mature feed must not show discovery cards');
        const group=page.locator(`#ff-list .post[data-href="/activity/${ids.FEED_ACTIVITY}"] .post-ft [data-reaction-group][data-aid="${ids.FEED_ACTIVITY}"]`);
        await group.waitFor({state:'visible'});
        for(const kind of ['clap','starstruck','mindblown'])if(await group.getAttribute(`data-count-${kind}`)!=='1')throw Error(`Demo feed must have one ${kind} reaction on the same card`);
        const react=group.locator('.reaction-more'),summaryButton=group.locator('.reaction-count'),summary=summaryButton.locator('.reaction-summary');
        const emojiNodes=summary.locator('.reaction-summary-emoji .reaction-emoji');
        await react.waitFor({state:'visible'});await emojiNodes.first().waitFor({state:'visible'});
        const kinds=(await group.getAttribute('data-reaction-order')||'').split(',').filter(Boolean);
        const shown=await emojiNodes.allTextContents(),summaryCounts=summary.locator('.reaction-summary-count');
        const reactLabel=await react.getAttribute('aria-label'),heartIcon=react.locator('.reaction-heart-icon');
        const renderedCounts=await summaryCounts.allTextContents(),legacyCount=await summaryButton.locator('.num').count(),summaryVisible=await summaryButton.isVisible();
        if(reactLabel!=='React with a heart'||!await heartIcon.isVisible()||!summaryVisible||kinds.length!==3||!['clap','starstruck','mindblown'].every(kind=>kinds.includes(kind))||shown.length!==3||!['👏','🤩','🤯'].every(value=>shown.includes(value))||renderedCounts.length!==3||renderedCounts.map(value=>value.trim()).join(',')!=='1,1,1'||legacyCount)throw Error('Demo feed reaction footer mismatch: '+JSON.stringify({reactLabel,heartIconVisible:await heartIcon.isVisible(),summaryVisible,kinds,shown,renderedCounts,legacyCount}));
        // The Home scene has a large Today card before the feed. Align the featured
        // post below the safe-area inset so the view-switch links never sit under
        // the simulated status bar while the complete post and its footer fit together.
        // The standalone feed scene keeps the prior footer clearance for taller layouts.
        await group.evaluate((el, {homeFeed,safeTop})=>{
          const tabs=document.querySelector('nav.tabs');
          if(!tabs)return;
          if(homeFeed)return;
          const footer=el.closest('.post-ft');
          const controls=[footer?.querySelector('.reaction-more'),footer?.querySelector('.activity-comments'),el.querySelector('.reaction-count')].filter(Boolean);
          if(!controls.length)return;
          const rowBottom=Math.max(...controls.map(node=>node.getBoundingClientRect().bottom));
          const safeBottom=tabs.getBoundingClientRect().top-8;
          if(rowBottom>safeBottom)window.scrollBy(0,rowBottom-safeBottom);
        },{homeFeed:name==='home-feed',safeTop:TOP});
        const geometry=await group.evaluate((el,{homeFeed,safeTop})=>{
          const footer=el.closest('.post-ft');
          const action=footer?.querySelector('.reaction-more'),comments=footer?.querySelector('.activity-comments'),button=el.querySelector('.reaction-count'),share=footer?.querySelector('[data-share-picture]');
          if(!footer||!action||!comments||!button)return{valid:false,missing:true};
          const style=getComputedStyle(footer),contentRight=footer.getBoundingClientRect().right-(parseFloat(style.paddingRight)||0);
          const actionRect=action.getBoundingClientRect(),commentRect=comments.getBoundingClientRect(),buttonRect=button.getBoundingClientRect(),shareRect=share?.getBoundingClientRect();
          const headerRect=el.closest('.post')?.querySelector('.post-hd')?.getBoundingClientRect();
          const limit=document.querySelector('nav.tabs').getBoundingClientRect().top;
          const visible=r=>r.width>0&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=59&&r.bottom<=limit;
          const hasSummary=!button.hidden;
          const rowVisible=visible(actionRect)&&visible(commentRect)&&(!hasSummary||visible(buttonRect))&&(!share||visible(shareRect));
          const gaps=commentRect.left-actionRect.right>=7.99
            &&(!hasSummary||Math.abs(buttonRect.left-actionRect.right-8)<1&&commentRect.left-buttonRect.right>=7.99)
            &&(share?Math.abs(shareRect.right-contentRight)<1&&Math.abs(shareRect.left-commentRect.right-8)<1:Math.abs(commentRect.right-contentRight)<1);
          const homeHeaderClear=!!headerRect&&headerRect.top>=safeTop;
          const homeFooterClear=[actionRect,commentRect,...(hasSummary?[buttonRect]:[]),...(share?[shareRect]:[])].every(r=>r.top>=safeTop||r.bottom<=0);
          const valid=homeFeed?homeHeaderClear&&homeFooterClear&&(!rowVisible||gaps):rowVisible&&gaps
          return{valid,homeFeed,header:headerRect&&{top:headerRect.top,bottom:headerRect.bottom},rowVisible,action:{x:actionRect.x,right:actionRect.right,top:actionRect.top,bottom:actionRect.bottom},comment:{x:commentRect.x,right:commentRect.right,top:commentRect.top,bottom:commentRect.bottom},summary:{x:buttonRect.x,right:buttonRect.right,top:buttonRect.top,bottom:buttonRect.bottom},share:shareRect&&{x:shareRect.x,right:shareRect.right,top:shareRect.top,bottom:shareRect.bottom},contentRight,limit,innerWidth,scrollY,scrollHeight:document.documentElement.scrollHeight};
        },{homeFeed:name==='home-feed',safeTop:TOP});
        if(!geometry.valid)throw Error('Demo feed heart/summary/comments/share targets do not match the shipped footer layout: '+JSON.stringify(geometry));
      }
      if(name==='insights'){await page.getByRole('heading',{name:'Insights',exact:true}).waitFor();await page.locator('#nt-overview-chart').waitFor();}
      if (opt.logDish) {      // Add food > My Recipes > the recipe: the log sheet, with a portion typed in
        await page.evaluate(() => describeSheet(isoDay(new Date()), 'dinner'));
        await page.locator('#thread-text').waitFor();
        await page.locator('#thread-plus').click();
        await page.locator('.sheet .thread-tools-sheet button').filter({hasText:'Recipes'}).click();
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
        await settleDetailContentBelowSafeArea(page);
      }
      if(opt.similar){
        await page.locator('[data-dt=efforts]').click();
        const heading=page.getByRole('heading',{name:'Similar efforts',exact:true});
        await heading.evaluate(h=>window.scrollTo({top:h.getBoundingClientRect().top+scrollY-130,behavior:'instant'}));
        await page.waitForTimeout(100);
        if(!await heading.evaluate(h=>h.getBoundingClientRect().top<400&&h.getBoundingClientRect().top>100))throw Error('Similar efforts heading must be visible above the tab bar.');
        await settleDetailContentBelowSafeArea(page);
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
          await loadedMaps(page); await page.evaluate(chrome, {dark: scheme === 'dark', width: W}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); await page.screenshot({path: `${OUT}/${scheme}-snap.png`});
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
        await page.getByRole('heading',{name:'Ask Kit',exact:true}).waitFor({state:'visible'});
        await page.locator('#kit-starters > button').first().waitFor({state:'visible'});
      }
      if (name === 'recipecoach') await page.locator('#dk-kit').click();
      if (opt.sel) await page.evaluate((q) => { const e = document.querySelector(q); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }, opt.sel);
      if (opt.to) await page.evaluate((t) => {
        const h = [...document.querySelectorAll('.card > h2, .coach-heading h2, h2.sec-head, #kit-intro h2')].find((x) => x.textContent.trim().startsWith(t));
        if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 70);   // below the status bar
      }, opt.to);
      await page.waitForTimeout(700);
      // Recheck map tiles after final positioning only for scenes whose capture includes the map.
      // Activity Charts scrolls the map offscreen, where Leaflet can unload its tiles intentionally.
      if (MAP_SHOTS.has(name)) await loadedMaps(page, {advanceMapFade: true, requireMap: true});
      if (name === 'feed' || name === 'home-feed') await settleFeedHeaderBelowSafeArea(page);
      if (name === 'home-feed') {
        const homeReaction = page.locator(`#ff-list .post[data-href="/activity/${ids.FEED_ACTIVITY}"] .post-ft [data-reaction-group][data-aid="${ids.FEED_ACTIVITY}"]`);
        // Keep a fictional selected-clap state in the Home capture so the safe-area guard
        // covers both the idle heart and the currently selected reaction without a server write.
        await homeReaction.evaluate(el=>el._sync({my_reaction:'clap',reactions:{clap:2,starstruck:1,mindblown:1}}));
        const selected=await homeReaction.evaluate(el=>({mine:el.dataset.mine,label:el.querySelector('.reaction-more')?.getAttribute('aria-label'),mark:el.querySelector('.reaction-more .reaction-emoji')?.textContent}));
        if(selected.mine!=='clap'||selected.label!=='Remove your 👏 reaction'||selected.mark!=='👏')throw Error('Home feed capture did not render the selected-clap state: '+JSON.stringify(selected));
        await settleHomeFeedReactionBelowSafeArea(homeReaction);
      }
      if(opt.tab){
        const pane=page.locator(`#activity-pane-${opt.tab}:visible`);
        await pane.waitFor();
        const content=pane.locator('.activity-splits-scroll tbody tr').first();
        await content.waitFor({state:'visible'});
        await content.evaluate((el,safeTop)=>{
          window.scrollTo({top:scrollY+el.getBoundingClientRect().top-390,behavior:'instant'});
          const maps=[...document.querySelectorAll('.activity-detail .map-head,.activity-detail .detail-map-hero,.activity-detail .compact-media')];
          const bottom=Math.max(0,...maps.map(map=>map.getBoundingClientRect().bottom));
          if(bottom>safeTop)window.scrollTo({top:scrollY+bottom-safeTop,behavior:'instant'});
        },TOP);
        // The route map is partly scrolled off in this crop; its zoom widget would
        // otherwise float into the status-bar zone while the split rows remain visible.
        await page.locator('.activity-detail .leaflet-control-zoom').evaluateAll(nodes=>nodes.forEach(node=>node.style.display='none'));
      }
      const hiddenMediaControls = await hideIntersectingMediaControls(page);
      await assertTopSafeControls(page, `${scheme}-${name}`, hiddenMediaControls);
      await page.evaluate(chrome, {dark: scheme === 'dark', width: W}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.screenshot({path: `${OUT}/${scheme}-${name}.png`});
      await page.evaluate(() => document.querySelectorAll('[data-capture-safe-hidden="true"]').forEach(el => {
        el.style.removeProperty('visibility'); delete el.dataset.captureSafeHidden;
      }));
      if (kitInsightFixture) await page.unroute(kitInsightRoute);
      if (opt.lift) await page.evaluate(() => fetch('/api/activities/' + window.__liftId, {method: 'DELETE', headers: {'Content-Type': 'application/json'}}));
      // Remove only what this fictional review story added (entries, saved foods, messages) so the next pass and
      // the other screenshots start from the same demo data.
      if (opt.cleanup) { await page.evaluate(cleanFood, opt.cleanup); delete opt.cleanup; }   // gone before the next pass's Today and feed
    }
    for (const context of [ctx, foodChatCtx, foodRepeatCtx]) await closeCaptureContext(context);
  }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw error;
  } finally {
    try {
      for (const context of browser.contexts()) await closeCaptureContext(context);
    } finally { await browser.close(); }
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  fs.writeFileSync(`${OUT}/safe-area-audit.json`, JSON.stringify({topInsetPx:TOP,captures:SAFE_AREA_AUDIT},null,2)+'\n');
  console.log('shots taken');
})();
