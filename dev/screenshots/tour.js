// Website feature crops (site/assets/tour) of complete app controls, from a throwaway demo install (dev/demo/seed.py).
// Usage: node tour.js <out dir> [base url]. Each crop is one whole element at 2x, light and dark, encoded as WebP.
// Fictional account only; browser captures, not native iPhone evidence. Install fonts-liberation to match CI's text.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OUT = process.argv[2], B = process.argv[3] || 'http://localhost:8798';
const OWNER_LOGIN = 'nia';
const PAD = 12;   // page background kept around a card so its edge and shadow stay visible
const ONLY = process.env.KINETTA_TOUR_ONLY ? new Set(process.env.KINETTA_TOUR_ONLY.split(',').filter(Boolean)) : null;
const RAW_OUT = process.env.KINETTA_TOUR_RAW_OUT;
const SAFE_TOP = Number(process.env.SCREENSHOT_SAFE_TOP || 59), SAFE_BOTTOM = Number(process.env.SCREENSHOT_SAFE_BOTTOM || 34);
const SAFE_AREA_AUDIT = [];

async function emulateSafeArea(route) {
  if (new URL(route.request().url()).origin !== B) return route.fallback();
  const response = await route.fetch(), css = (await response.text())
    .replace(/env\(safe-area-inset-top(?:,[^)]*)?\)/g, SAFE_TOP + 'px')
    .replace(/env\(safe-area-inset-bottom(?:,[^)]*)?\)/g, SAFE_BOTTOM + 'px');
  await route.fulfill({response, body: css});
}
async function assertTopSafeControls(page, scene) {
  const overlaps = await page.evaluate(top => [...document.querySelectorAll('a[href],button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.bottom>0&&r.top<top&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.05&&s.pointerEvents!=='none'; })
    .map(el => ({tag:el.tagName,label:(el.getAttribute('aria-label')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,48),top:Math.round(el.getBoundingClientRect().top),bottom:Math.round(el.getBoundingClientRect().bottom)})), SAFE_TOP);
  if(overlaps.length)throw Error(`${scene}: controls overlap the first ${SAFE_TOP}px status-bar safe area: ${JSON.stringify(overlaps)}`);
  SAFE_AREA_AUDIT.push({scene,topInsetPx:SAFE_TOP,controlsClear:true});
}

async function saveRawViewport(page, filename) {
  if (!RAW_OUT) return;
  fs.mkdirSync(RAW_OUT, {recursive: true});
  const prior = page.viewportSize();
  await page.setViewportSize({width: 393, height: 852});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({path: path.join(RAW_OUT, filename), animations: 'disabled'});
  await page.setViewportSize(prior);
}

// name, address, selector of the first and last element the crop must contain completely
const CROPS = [
  // Training: one complete control for each claim on the Training page.
  ['training-run', '/activity/{RUN}', '.detail-map-hero', '#d-soc', OWNER_LOGIN, 'hide-tabs'],
  ['training-sports', '/people/nia', '.me-card', '.me-card', OWNER_LOGIN],
  ['training-lifting', '/activity/{LIFT}', '.d-title', '#d-lifts', OWNER_LOGIN],
  ['training-plans', '/plan', '.compact-plan-summary', '.pweek.current', OWNER_LOGIN],
  ['training-progress', '/progress', '.progress-totals-header', '#m-chart', OWNER_LOGIN],
  ['training-routes', '/progress/routes', '#p-body > .card', '#p-body > .card', OWNER_LOGIN],
  // Food: the review card is staged by dev/screenshots/food_chat_fixture.py; the other
  // controls are deterministic demo data from stage.py.
  ['food-quick', '/food/describe?meal=breakfast', '.compact-thread-card', '.compact-thread-card', 'chat', 'hide-chat-user'],
  ['food-yesterday', '/food', '.meal-breakfast', '.meal-breakfast', 'food'],
  ['food-insights', '/food?view=overview&r=30', '.insights-summary', '.insights-summary', OWNER_LOGIN],
  ['food-recipes', '/food/meals', '#library-recipes > .library-section:first-child', '#library-recipes > .library-section:first-child', OWNER_LOGIN],
  // Friends: each picture is one complete feed, profile or search control.
  ['friends-feed', '/activity', '.activity-card', '.activity-card', OWNER_LOGIN],
  ['friends-photos', '/activity', '.activity-card', '.activity-card', OWNER_LOGIN, 'photo'],
  ['friends-profile', '/people/nia', '.me-card', '.me-card', OWNER_LOGIN],
  ['profile-achievements', '/people/nia', '.me-card', '.me-featured-achievements', OWNER_LOGIN, 'scroll-crop'],
  ['friends-find', '/me/friends?find=1&q=Ethan', '#fr-find', '#fr-found', OWNER_LOGIN, 'hide-friends-groups'],
  ['run-achievements', '/me/achievements', '.profile-achievement-group[aria-labelledby=\"profile-achievement-group-run\"]', '.profile-achievement-group[aria-labelledby=\"profile-achievement-group-run\"]', OWNER_LOGIN, 'scroll-crop'],
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
  await page.addInitScript(() => localStorage.setItem('kinetta.firstRunWelcomeSeen', 'true'));
  await page.goto(B + '/');
  await page.locator('input[name=login]').waitFor({state: 'visible'});
  await page.fill('input[name=login]', login);
  await page.fill('input[name=password]', login === OWNER_LOGIN ? 'blue kettle morning run' : 'green teapot on the hill');
  await page.press('input[name=password]', 'Enter');
  await page.waitForFunction(expected => App.me?.login === expected, login, {timeout: 30000});
  const who = await page.evaluate(() => ({login: App.me?.login}));
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

async function saveChallengePhone(page, name, scheme) {
  // Publish the complete app viewport as a phone screen. Cropping the sheet or
  // detail card makes the website image wider and shorter than the iPhone frame.
  await page.setViewportSize({width: 393, height: 852});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertTopSafeControls(page, `${scheme}-${name}`);
  const png = await page.screenshot({animations: 'disabled'});
  if (RAW_OUT) {
    fs.mkdirSync(RAW_OUT, {recursive: true});
    fs.writeFileSync(path.join(RAW_OUT, `${name}-${scheme}.png`), png);
  }
  const webp = await page.evaluate(async (data) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, png.toString('base64'));
  fs.writeFileSync(`${OUT}/${name}-${scheme}.webp`, Buffer.from(webp, 'base64'));
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
      await context.route('**/*.css*', emulateSafeArea);
      const page = await context.newPage();
      await signIn(page, OWNER_LOGIN);
      const run = await page.evaluate(async () => (await (await fetch('/api/activities?limit=20')).json()).find((a) => a.sport === 'run' && a.visibility === 'friends')?.id);
      if (!run) throw Error('No demo run shared with friends');
      const lift = await page.evaluate(async () => (await (await fetch('/api/activities?limit=20')).json()).find((a) => a.sport === 'workout')?.id);
      if (!lift) throw Error('No demo lifting activity');
      for (const [name, address, first, last, account, action] of CROPS) {
        if (ONLY && !ONLY.has(name)) continue;
        await signIn(page, account === OWNER_LOGIN ? OWNER_LOGIN : account === 'chat' ? 'zz_test_658_chat_' + scheme : 'zz_test_658_food_' + scheme);
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
        if (action === 'scroll-crop') await page.locator(first).scrollIntoViewIfNeeded();
        else await page.evaluate(() => window.scrollTo(0, 0));
        if (name.startsWith('friends-') || name === 'profile-achievements' || name === 'training-sports')
          await saveRawViewport(page, `${name}-${scheme}.png`);
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

      if (!ONLY || ONLY.has('challenges')) {
      // The Challenges home screenshots use the actual app sheet and detail renderer with
      // read-only fictional response fixtures. No challenge, friend request or write is sent.
      const challenge = {
        code: 'website-distance', title: 'November distance goal', kind: 'distance', sports: ['run', 'walk'],
        target: 40, unit: 'mi', start: '2026-11-02', end: '2026-11-30', creator: 'maya', participants: 3,
        member: true, owner: false, joining_closed: false, ended_early: false, manual: false, garmin_sources: [],
        self: {value: 18.6, complete: false, manual: false, garmin_sources: [], days_left: 10, finished: false, needs_target: false},
        people: [
          {username: 'maya', photo: 'portrait-fixture-v1', value: 26, complete: false},
          {username: 'nia', photo: 'portrait-fixture-v1', value: 18.6, complete: false},
          {username: 'ethan', photo: 'portrait-fixture-v1', value: 12, complete: false},
        ],
      };
      const avatarFiles = {
        nia: 'nia.webp',
        ethan: 'ethan.webp',
        maya: 'maya.webp',
      };
      await page.route('**/api/challenges**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/challenges') return route.fulfill({json: []});
        if (pathname === `/api/challenges/${challenge.code}`) return route.fulfill({json: challenge});
        const match = pathname.match(new RegExp(`^/api/challenges/${challenge.code}/photo/([^/]+)$`));
        if (match) {
          const username = decodeURIComponent(match[1]);
          const file = avatarFiles[username];
          if (!file) return route.fulfill({status: 404});
          const portrait = fs.readFileSync(path.join(__dirname, 'portraits', file));
          return route.fulfill({status: 200, contentType: 'image/webp', body: portrait});
        }
        return route.fallback();
      });
      await page.goto(B + '/me/challenges');
      await page.locator('#challenge-first').waitFor({state: 'visible'});
      await page.locator('#challenge-first').click();
      await page.locator('.sheet .challenge-templates').waitFor({state: 'visible'});
      const choices = await page.locator('.sheet [data-challenge-kind]').allInnerTexts();
      assert.deepEqual(choices.map(text => text.trim().split('\n')[0]), ['Distance', 'Active days', 'Activities', 'Food logging days', 'Protein goal days']);
      await page.evaluate(() => document.fonts.ready);
      await saveRawViewport(page, `challenge-start-${scheme}.png`);
      await saveChallengePhone(page, 'challenge-start', scheme);
      await page.goto(B + `/me/challenges/${challenge.code}`);
      await page.locator('#challenge-detail .challenge-hero').waitFor({state: 'visible'});
      await page.locator('#challenge-detail .challenge-person-row').nth(2).waitFor({state: 'visible'});
      await page.evaluate(() => document.fonts.ready);
      await saveRawViewport(page, `challenge-detail-${scheme}.png`);
      await saveChallengePhone(page, 'challenge-detail', scheme);
      }
      await context.close();
    }
    fs.writeFileSync(path.join(OUT,'safe-area-audit.json'),JSON.stringify({topInsetPx:SAFE_TOP,captures:SAFE_AREA_AUDIT},null,2)+'\n');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
