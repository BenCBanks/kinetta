// Fictional local evidence only. Prepare spacing_prepare.py first; no product/device writes are allowed.
'use strict';
const {chromium}=require('playwright'),{AxeBuilder}=require('@axe-core/playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {scenes}=require('./spacing_screens.cjs'),{settle,fixtureSessions,fixturePage}=require('./ui_fixture_browser.cjs');
const base=process.env.KINETTA_URL||'http://localhost:8798',project=process.env.KINETTA_PROJECT||'kinettatest';
const fixtures=JSON.parse(fs.readFileSync(process.env.KINETTA_SPACING_FIXTURES||'/tmp/'+project+'-spacing-fixtures.json','utf8'));
assert.equal(fixtures.base,base);assert.equal(fixtures.project,project);
const exceptions=JSON.parse(fs.readFileSync(path.join(__dirname,'accessibility_exceptions.json'),'utf8'));
const ids=new Set();for(const e of exceptions){assert(e.id&&!ids.has(e.id));ids.add(e.id);assert(e.rule&&/^[.#][\w-]+/.test(e.selector)&&!e.selector.includes('*'));assert(Number.isInteger(e.maximum)&&e.maximum>0&&e.maximum<=12);assert(e.reason?.length>=40,'Every narrow exception needs its written reason');}
const output=process.env.KINETTA_ACCESSIBILITY_OUTPUT||'/tmp/'+project+'-accessibility';fs.mkdirSync(output,{recursive:true});
const names=['Me','Activity','Activity detail','Track ready','Progress','Nutrition day','Add food','Settings'];
const selected=scenes(fixtures).filter(s=>names.includes(s.name));assert.equal(selected.length,names.length);
selected.push({name:'Sign-up',route:'/signup',ready:'input[name=age_ok]',signup:true});
(async()=>{
 const browser=await chromium.launch(),results=[],errors=[];
 try{
  const sessions=await fixtureSessions(browser,base,selected);
  for(const root of [16,32])for(const theme of ['light','dark'])for(const scene of selected){
   let opened;try{
    opened=await fixturePage(browser,base,fixtures,sessions,scene,{width:390,height:844,root},theme);const {p,auth,writes,pageErrors}=opened;
    await settle(p);if(!scene.signup)assert.equal(await p.evaluate(()=>App.me?.id),auth.id,'Intended fictional account');
    const axe=await new AxeBuilder({page:p}).analyze(),violations=[],used=[],counts=new Map();
    for(const v of axe.violations.filter(v=>['serious','critical'].includes(v.impact)))for(const node of v.nodes){
     assert.equal(node.target.length,1,'Unexpected frame/shadow target requires explicit audit support');let excepted=false;
     for(const e of exceptions.filter(e=>e.rule===v.id))if(await p.locator(node.target[0]).evaluate((el,selector)=>el.matches(selector),e.selector)){
      counts.set(e.id,(counts.get(e.id)||0)+1);assert(counts.get(e.id)<=e.maximum,'Exception exceeds its reviewed bound: '+e.id);used.push({id:e.id,target:node.target,reason:e.reason});excepted=true;break;
     }
     if(!excepted)violations.push({rule:v.id,impact:v.impact,target:node.target,html:node.html,summary:node.failureSummary});
    }
    const text=await p.evaluate(()=>({root:getComputedStyle(document.documentElement).fontSize,body:getComputedStyle(document.body).fontSize,heading:getComputedStyle(document.querySelector('h1')||document.body).fontSize,overflow:document.documentElement.scrollWidth>innerWidth+1}));
    results.push({screen:scene.name,root,theme,text,violations,exceptions:used,observations:axe.violations.filter(v=>!['serious','critical'].includes(v.impact)).map(v=>({rule:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),incomplete:axe.incomplete.map(v=>({rule:v.id,targets:v.nodes.map(n=>n.target)}))});
    assert.equal(writes.length,0,'Product writes blocked');assert.deepEqual(pageErrors,[],'No runtime errors');
    await p.screenshot({path:path.join(output,scene.name.replace(/[^a-z0-9]+/gi,'-')+'-'+root+'-'+theme+'.png'),fullPage:true});
    console.log(`${scene.name} ${root}px ${theme}: ${violations.length} serious/critical failures; ${used.length} documented exceptions`);
   }catch(e){errors.push({screen:scene.name,root,theme,error:e.message});console.error(scene.name,e.message);}finally{await opened?.c.close();}
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({axe:require('axe-core/package.json').version,results,errors},null,2));
 const failures=results.reduce((n,r)=>n+r.violations.length,0);assert.equal(results.length+errors.length,36,'All required screen/theme/text cases attempted');
 const summary=`Accessibility: ${results.length}/36 cases, ${failures} serious/critical violations, ${errors.length} guard/loading errors. Fictional screenshots, exceptions and incomplete/manual-review findings are in the accessibility artifact.\n`;
 console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n## Accessibility audit\n\n'+summary);
 if(failures||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
