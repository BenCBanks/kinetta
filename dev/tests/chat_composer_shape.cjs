// Fictional input only: grow, shrink, target geometry and unchanged client draft text.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(p,state,width,theme,out)=>{
 const recipe=state==='recipe',kit=state.startsWith('kit'),field=p.locator(recipe?'#dk-t':kit?'#kit-text':'#thread-text');
 const row=recipe?'.recipe-compose-row':kit?'.kit-compose-row':'.thread-compose-row';
 if(!recipe&&!kit)assert.equal(await field.getAttribute('placeholder'),'What did you eat?');
 for(const [label,text] of [['empty',''],['one','Oatmeal and berries'],['three','Oatmeal with berries\nCoffee with milk\nA slice of toast']]){
  await field.fill(text);await field.blur();
  await p.waitForFunction(({row,height})=>Math.abs(document.querySelector(row).getBoundingClientRect().height-height)<1,{row,height:label==='three'?92:44});
  await p.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  const metrics=await p.locator(row).evaluate(n=>{
   const rect=n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const field=n.querySelector('textarea'),plus=document.querySelector('#thread-plus,#dk-plus'),send=n.querySelector('.thread-send'),page=document.querySelector('#page');
   return{row:rect(n),field:rect(field),font:parseFloat(getComputedStyle(field).fontSize),textInset:parseFloat(getComputedStyle(field).paddingLeft),send:rect(send),plus:plus?{...rect(plus),inside:n.contains(plus)}:null,page:rect(page),padding:parseFloat(getComputedStyle(page).paddingLeft),overflow:document.documentElement.scrollWidth>innerWidth+1,text:field.value};
  });
  assert.equal(metrics.textInset,14,'text and placeholder have 14px left padding');assert.equal(metrics.font,17,'composer text uses the approved 17px size');assert.equal(metrics.text,text,'draft text remains exact');
  assert.equal(metrics.send.width,44);assert.equal(metrics.send.height,44);
  assert(metrics.send.left>=metrics.row.left&&metrics.send.right<=metrics.row.right&&metrics.send.bottom<=metrics.row.bottom,'Send stays inside the growing field');
  assert.equal(metrics.overflow,false);
  assert(Math.abs(metrics.row.right-(metrics.page.right-metrics.padding))<1,'composer uses the page right margin');
  if(metrics.plus){assert.equal(metrics.plus.width,44);assert.equal(metrics.plus.height,44);assert.equal(metrics.plus.inside,false,'plus is outside the field');assert(Math.abs(metrics.plus.left-metrics.padding)<1,'plus uses the page left margin');assert(metrics.row.left-metrics.plus.right>=8,'plus and field have an 8px gap');assert(Math.abs(metrics.plus.bottom-metrics.row.bottom)<1,'plus stays aligned with Send as text grows');}
  if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,`shape-${state}-${width}-${theme}-${label}.png`)});}
 }
 await field.fill('');await field.blur();
 await p.waitForFunction(row=>document.querySelector(row).getBoundingClientRect().height===44,row);
 if(recipe){
  await field.fill('Fictional oats');await field.press('Shift+Enter');assert.equal(await field.inputValue(),'Fictional oats\n','Shift+Enter keeps a line break');
  const sent=p.waitForRequest(r=>r.url().endsWith('/api/dishes/1/say')&&r.method()==='POST');await field.press('Enter');
  assert.equal((await sent).postDataJSON().text,'Fictional oats','Enter still sends the ingredient once');
  await p.waitForFunction(()=>document.querySelector('#dk-t').value===''&&document.querySelector('.recipe-compose-row').getBoundingClientRect().height===44);
 }
};
