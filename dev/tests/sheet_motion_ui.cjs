// Shared bottom-sheet motion contract; fictional data and blocked product writes only.
'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
assert.equal(Number(cp.execFileSync('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],{encoding:'utf8'}).trim()),Number(new URL(base).port));
(async()=>{const b=await chromium.launch();try{
 const c=await b.newContext({viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'no-preference',isMobile:true,hasTouch:true});
 const login=await c.request.post(base+'/api/login',{headers:{Origin:base},data:{login:'alex',password:'blue kettle morning run'}});assert.equal(login.status(),200);
 const p=await c.newPage();await p.goto(base+'/food');await p.waitForTimeout(1200);assert.equal(await p.evaluate(()=>typeof App),'object');
 await p.evaluate(()=>sheet('Add food','<p>Fictional breakfast</p><button class="primary wide">Add a food</button>'));await p.waitForTimeout(300);
 assert.equal(await p.locator('.scrim').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0.35)','scrim uses the 35% backdrop');
 assert.equal(await p.locator('.sheet').evaluate(n=>getComputedStyle(n).animationName),'sheet-in','sheet enters with the smooth spring');
 const box=await p.locator('.sheet').boundingBox(),cdp=await c.newCDPSession(p),x=195,y=Math.round(box.y+10);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+120}]});await p.waitForTimeout(20);
 const drag=await p.locator('.sheet').evaluate(n=>({inline:n.style.transform,computed:getComputedStyle(n).transform}));assert.match(drag.inline,/120px/,'drag follows the finger 1:1');assert.match(drag.computed,/0, 120\)/,'drag transform is applied while moving');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(300);assert.equal(await p.locator('.scrim').count(),0,'a 120px pull dismisses this short sheet');await cdp.detach();await c.close();
 const reduced=await b.newContext({viewport:{width:390,height:844},colorScheme:'dark',reducedMotion:'reduce',isMobile:true,hasTouch:true}),rp=await reduced.newPage();await rp.goto(base+'/food');await rp.waitForTimeout(1200);await rp.evaluate(()=>sheet('Choose a fictional picker','<button class="ghost wide">One choice</button>'));await rp.waitForTimeout(100);assert.equal(await rp.locator('.sheet').evaluate(n=>getComputedStyle(n).animationName),'sheet-fade-in','reduced motion uses a fade');await rp.locator('.sheet [data-close]').click();await rp.waitForTimeout(300);assert.equal(await rp.locator('.scrim').count(),0);await reduced.close();
 }finally{await b.close();}console.log('Bottom sheets: spring entrance, 35% scrim, 1:1 drag dismissal and reduced-motion fade PASS');})().catch(e=>{console.error(e);process.exit(1)});
