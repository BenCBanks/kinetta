// Website feature crops (site/assets/tour) of complete app controls, from a throwaway demo install (dev/demo/seed.py).
// Usage: node tour.js <out dir> [base url]. Each crop is one whole element at 2x, light and dark, encoded as WebP.
// Fictional account only; browser captures, not native iPhone evidence. Install fonts-liberation to match CI's text.
const {chromium} = require('playwright');
const fs = require('node:fs');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
const PAD = 12;   // page background kept around a card so its edge and shadow stay visible

// name, address, selector of the first and last element the crop must contain completely
const CROPS = [
  // Training: one complete control for each claim on the Training page.
  ['training-run', '/activity/{RUN}', '.detail-map-hero', '#d-soc', 'alex', 'hide-tabs'],
  ['training-sports', '/people/alex', '.me-card', '.me-card', 'alex'],
  ['training-lifting', '/activity/{LIFT}', '.d-title', '#d-lifts', 'alex'],
  ['training-plans', '/plan', '.compact-plan-summary', '.pweek.current', 'alex'],
  ['training-progress', '/progress', '.progress-totals-header', '#m-chart', 'alex'],
  ['training-routes', '/progress/routes', '#p-body > .card', '#p-body > .card', 'alex'],
  // Food: the review card is staged by dev/screenshots/food_chat_fixture.py; the other
  // controls are deterministic demo data from stage.py.
  ['food-quick', '/food/describe?meal=breakfast', '.compact-thread-card', '.compact-thread-card', 'chat', 'hide-chat-user'],
  ['food-yesterday', '/food', '.meal-breakfast', '.meal-breakfast', 'food'],
  ['food-insights', '/food?view=overview&r=30', '.insights-summary', '.insights-summary', 'alex'],
  ['food-recipes', '/food/meals', '#library-recipes > .library-section:first-child', '#library-recipes > .library-section:first-child', 'alex'],
  // Friends: each picture is one complete feed, profile or search control.
  ['friends-feed', '/activity', '.activity-card', '.activity-card', 'alex'],
  ['friends-photos', '/activity', '.activity-card', '.activity-card', 'alex', 'photo'],
  ['friends-profile', '/people/alex', '.me-card', '.me-card', 'alex'],
  ['friends-find', '/me/friends?find=1&q=Morgan', '#fr-find', '#fr-found', 'alex', 'hide-friends-groups'],
];

async function crop(page, first, last) {
  const box = await page.evaluate(([a, b]) => {
    const one = document.querySelector(a), two = document.querySelector(b);
    if (!one || !two) return null;
    const r1 = one.getBoundingClientRect(), r2 = two.getBoundingClientRect();
    return {left: Math.min(r1.left, r2.left), right: Math.max(r1.right, r2.right),
      top: Math.min(r1.top, r2.top), bottom: Math.max(r1.bottom, r2.bottom)};
  }, [first, last]);
  if (!box) throw Error(`Missing ${first} or ${last}`);
  const left = Math.max(0, Math.floor(box.left - PAD));
  const right = Math.min(await page.evaluate(() => innerWidth), Math.ceil(box.right + PAD));
  return {x: left, y: Math.max(0, Math.floor(box.top - PAD)), width: right - left,
    height: Math.ceil(box.bottom - box.top + 2 * PAD)};
}

async function signIn(page, login) {
  await page.evaluate(() => fetch('/api/logout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}).catch(() => {}));
  await page.goto(B + '/');
  await page.locator('input[name=login]').waitFor({state: 'visible'});
  await page.fill('input[name=login]', login);
  await page.fill('input[name=password]', login === 'alex' ? 'blue kettle morning run' : 'green teapot on the hill');
  await page.press('input[name=password]', 'Enter');
  await page.locator('nav.tabs').waitFor({state: 'visible'});
  await page.waitForTimeout(700);
  const who = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  if (who.login !== login) throw Error(`Could not switch demo account to ${login} (got ${who.login})`);
  await constrain(page);
}

async function constrain(page) {
  await page.evaluate(() => {
    document.documentElement.style.background = getComputedStyle(document.body).backgroundColor;
    document.body.style.width = '393px';
    document.body.style.margin = '0 auto';
    window.dispatchEvent(new Event('resize'));
  });
}

async function stageChat(page) {
  await page.goto(B + '/food/describe?meal=breakfast');
  await constrain(page);
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const payload = await fetch('/api/food/thread?limit=100').then((r) => r.json());
    const message = [...(payload.messages || [])].reverse().find((m) => m.kind === 'user' && m.body.includes('Greek yogurt'));
    const draftId = message?.result?.draft_id;
    const me = await fetch('/api/me').then((r) => r.json());
    const key = Object.keys(localStorage).find((name) => name.startsWith('fit.food.review.draft:')) ||
      'fit.food.review.draft:' + JSON.stringify([location.origin, me.id]);
    if (!draftId) throw Error('Missing staged Food review fixture');
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({...saved, id: draftId, meal: 'breakfast', active: true}));
  });
  await page.goto(B + '/food/describe?meal=breakfast');
  await constrain(page);
}

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      // Keep the app at 393 CSS px inside a 417 px viewport. This gives full-bleed
      // map heroes the same 12 px page background as cards and sheets.
      const context = await browser.newContext({viewport: {width: 417, height: 852}, deviceScaleFactor: 2,
        colorScheme: scheme, reducedMotion: 'reduce', timezoneId: 'America/New_York'});
      const page = await context.newPage();
      await signIn(page, 'alex');
      const run = await page.evaluate(async () => (await (await fetch('/api/activities?limit=20')).json()).find((a) => a.sport === 'run' && a.visibility === 'friends')?.id);
      if (!run) throw Error('No demo run shared with friends');
      const lift = await page.evaluate(async () => (await (await fetch('/api/activities?limit=20')).json()).find((a) => a.sport === 'workout')?.id);
      if (!lift) throw Error('No demo lifting activity');
      for (const [name, address, first, last, account, action] of CROPS) {
        await signIn(page, account === 'alex' ? 'alex' : account === 'chat' ? 'zz_test_658_chat_' + scheme : 'zz_test_658_food_' + scheme);
        await page.goto(B + address.replace('{RUN}', run).replace('{LIFT}', lift));
        await constrain(page);
        await page.waitForTimeout(1200);
        if (account === 'chat') await stageChat(page);
        // Wait for the app's async route render before hiding nearby controls. Otherwise
        // its final data refresh can replace the hidden message bubble before capture.
        await page.waitForSelector(last, {state: 'visible'});
        if (action === 'photo') {
          await page.locator('.activity-card [data-media-step="1"]').first().click();
          await page.waitForFunction(() => document.querySelector('.activity-card [data-media-position]')?.textContent.startsWith('Photo 1'));
        }
        if (action === 'hide-tabs') await page.evaluate(() => { const el = document.querySelector('.dtabs'); if (el) el.style.visibility = 'hidden'; });
        if (action === 'hide-chat-user') await page.evaluate(() => document.querySelectorAll('.thread-user').forEach((el) => { el.style.display = 'none'; }));
        if (action === 'hide-friends-groups') await page.evaluate(() => { const el = document.querySelector('#fr-groups-shortcut'); if (el) el.style.display = 'none'; });
        await page.waitForSelector(last, {state: 'visible'});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);
        await page.evaluate(() => window.scrollTo(0, 0));
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
