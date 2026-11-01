// Collector regressions use a local fictional document: no server, account, save or device calls.
'use strict';
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {collectSpacing}=require('./spacing_dom.cjs'),{audit}=require('./spacing_geometry.cjs');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<style>
   body{margin:8px;font:16px sans-serif}button,input,summary{min-height:44px;min-width:44px}
   button{font:16px sans-serif}#faded{opacity:0}.hidden{height:1px;overflow:hidden}
   .rail{width:100px;overflow:auto}.wide{width:300px}.clip{height:12px;overflow:hidden}
   .hero-number{font-size:36px}.hero-number i{font-size:14px}
  </style>
  <details id="outer"><summary id="outer-summary">Review</summary>
   <details id="inner"><summary id="inner-summary">Hidden nested choice</summary><button id="hidden-button">Hidden</button></details>
  </details>
  <div id="faded"><button id="faded-button">Not visible</button></div>
  <label id="check-label"><input id="check" type="checkbox">Reminders</label>
  <button id="number-action" data-type="body">30 days</button>
  <section class="card"><div class="hero-number" id="hero"><span id="hero-part1">1,</span><span id="hero-part2">234</span><i id="unit">kcal</i></div></section>
  <input id="blank" placeholder="A visible placeholder">
  <div class="clip"><span id="clipped">This text extends below a deliberately clipped box</span></div>
  <div class="hidden"><div class="rail" id="rail"><span class="wide" id="scroll-text" style="display:block">This text can be scrolled horizontally to read all of it.</span></div></div>
  <div style="height:20px;overflow:hidden"><button id="clipped-icon" aria-label="A clipped icon"><svg width="16" height="16"></svg></button></div>
  <div class="photo-case"><button class="photo" id="photo-one">Photo one</button><button class="corner" id="corner-one">Next</button></div>
  <div class="photo-case"><button class="photo" id="photo-two">Photo two</button><button class="corner" id="corner-two">Next</button></div>
  <div id="fake-scroll"><div class="me-chart-scroll has-before"><button class="me-week">Week</button></div></div>
  <span id="nested-title" style="display:block;width:40px"><b style="white-space:nowrap">Overflowing title</b></span>`);
  const snapshot=(rules=[])=>page.evaluate(collectSpacing,{screen:'collector fixture',rules});
  let s=await snapshot();
  assert(s.targets.some(t=>t.key==='#outer-summary'));
  for(const key of ['#inner-summary','#hidden-button','#faded-button'])assert(!s.targets.some(t=>t.key===key),'Invisible controls stay out of measurements: '+key);
  assert.equal(s.targets.filter(t=>t.key==='#check-label').length,1,'A checkbox uses its single associated label hit area');
  assert(!s.targets.some(t=>t.key==='#check'),'The input and label are not duplicate controls');
  assert.equal(s.texts.find(t=>t.key==='#number-action').role,'body','An explicit numeric action label is not a metric');
  assert.equal(s.texts.find(t=>t.key==='#unit').role,'secondary','Units keep secondary type beside a hero');
  assert.equal(s.texts.find(t=>t.key==='#unit').hero,false,'The hero wrapper does not enlarge its unit');
  assert.equal(new Set(s.texts.filter(t=>t.hero).map(t=>t.heroKey)).size,1,'Split spans identify a single hero');
  assert(s.texts.some(t=>t.key==='#blank'&&t.text==='A visible placeholder'),'An empty field still exposes its placeholder');
  assert(s.texts.find(t=>t.key==='#clipped').clipped,'Vertical ancestor clipping is detected');
  assert(s.texts.find(t=>t.key==='#scroll-text').clipped,'An inner scrollport cannot hide clipping by its outer ancestor');
  const icon=s.targets.find(t=>t.key==='#clipped-icon');assert.equal(icon.rect.height,44);assert.equal(icon.usableRect.height,20,'An icon target reports its clipped usable area');
  assert(audit({...s,targets:[{...icon,rect:icon.usableRect}],texts:[]}).violations.some(v=>v.metric==='target'),'A permanently clipped icon does not pass as a44px target');
  const overlay={id:'same-photo',selector:'.corner',withSelector:'.photo',within:'.photo-case',metric:'overlap',kind:'intentional-overlay',maximum:44,reason:'Navigation only overlays the photo in the same carousel'};
  const paired=await snapshot([overlay]);assert.deepEqual(paired.targets.find(t=>t.key==='#corner-one').pairedExceptions['same-photo'],['#photo-one'],'An image overlay cannot exempt controls from another carousel');
  const railKey=s.targets.find(t=>t.key.includes('#fake-scroll')).key;
  await page.locator('#fake-scroll > div').evaluate(n=>{n.classList.remove('has-before');n.classList.add('has-after');});
  assert.equal((await snapshot()).targets.find(t=>t.key.includes('#fake-scroll')).key,railKey,'A scrolled target keeps its identity when edge fades change');
  await page.locator('#outer-summary').click();s=await snapshot();
  assert(s.targets.some(t=>t.key==='#inner-summary'),'Opening the outer panel exposes the nested summary');
  assert(!s.targets.some(t=>t.key==='#hidden-button'),'Its own closed details still hides the button');
  await page.locator('#inner-summary').click();s=await snapshot();assert(s.targets.some(t=>t.key==='#hidden-button'));
  assert(audit(s).violations.some(v=>v.metric==='clipped'),'The complete audit reports deliberate clipping');
  assert(audit(s).violations.some(v=>v.metric==='clipped'&&v.element==='#nested-title'),'A nested inline title cannot escape its text-container width check');
  await page.setViewportSize({width:330,height:667});
  await page.setContent(`<style>button{border:0;padding:0}#photo-background{position:fixed;left:33px;top:529px;width:264px;height:210px}
   .arrow{position:fixed;top:537px;width:44px;height:44px}#left-arrow{left:41px}#right-arrow{left:245px}
   nav{position:fixed;left:0;right:0;top:607px;height:60px;background:white}</style>
   <div id="photo-hero"><button id="photo-background" aria-label="Fictional photo"></button><button class="arrow" id="left-arrow">Prev</button><button class="arrow" id="right-arrow">Next</button></div><nav></nav>`);
  const photoRule={id:'photo-tools',selector:'.arrow',withSelector:'#photo-background',within:'#photo-hero',metric:'overlap',kind:'intentional-overlay',maximum:44,reason:'Tools overlay their own exposed photo surface'};
  const photo=await snapshot([photoRule]);assert(photo.targets.find(t=>t.key==='#photo-background').hit,'The visible photo between arrows remains tappable above fixed navigation');
  assert.equal(audit(photo,[photoRule]).violations.filter(v=>v.metric==='overlap').length,0,'An exposed photo is not mistaken for one hidden by navigation');
  console.log('Spacing DOM: nested details, hidden controls, labels, metric roles, heroes, placeholders and vertical clipping PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
