// The review strip counts only finished foods; an unanswered question card never blocks the others,
// and question cards offer one-tap replies. Runs the production thread.js functions with stand-in DOM.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/thread.js','utf8');
const el=()=>({hidden:true,disabled:false,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},classList:{add(){},remove(){}}});
const nodes={'#thread-review':el(),'#thread-review-sum':el(),'#thread-send':el()};
const c={Set,Number,Math,JSON,App:{me:{food_photo_itemize:true}},$:id=>nodes[id],active:()=>true,homeCalories:n=>String(Math.round(n)),Q:{mine:()=>[]},FoodReview:{busy:()=>false},
  esc:s=>String(s).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[ch]),aiCan:()=>true};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('  const pendingReview='),source.indexOf('  async function review(')),c);
vm.runInContext(source.slice(source.indexOf('  function choices(result) {'),source.indexOf('  function changedNumbers(')),c);
const user=(id,draft='d1')=>({id,kind:'user',client_id:'c'+id,result:{review_only:true,draft_id:draft}});
const reply=(to,parts)=>({id:to+100,kind:'reply',reply_to:to,result:{kind:'preview',parts}});
const ready=(...kcal)=>({index:0,status:'ready',entries:kcal.map(k=>({kcal:k}))});
const question={index:0,status:'description',description:{food:'coffee',portion_only:true},question:'Coffee — about how much?',replies:['1','Large','Not sure']};
const ctx={draftId:'d1',jobs:[],visibleClients:new Set(['c1','c2','c3']),messages:[user(1),reply(1,[ready(200,100)]),user(2),reply(2,[question]),user(3),reply(3,[ready(105)])]};
const state=c.held(ctx);
assert.deepEqual([...state.ids],[1,3],'only finished cards are sent to review');
assert.equal(state.ready,3);assert.equal(state.open,1);assert.equal(state.kcal,405);
c.primary(ctx);
assert.equal(nodes['#thread-review'].hidden,false);assert.equal(nodes['#thread-review'].disabled,false,'an open question never blocks review');
assert.equal(nodes['#thread-review-sum'].textContent,'3 foods · ≈ 405 kcal');
assert.match(nodes['#thread-review'].attrs['aria-label'],/1 unanswered food is not included/);
ctx.jobs=[{id:'c4',draft_id:'d1'}];c.primary(ctx);
assert.equal(nodes['#thread-review'].disabled,true,'a message still sending waits');assert.match(nodes['#thread-review-sum'].textContent,/checking…$/);
ctx.jobs=[];ctx.messages=[user(2),reply(2,[question])];c.primary(ctx);
assert.equal(nodes['#thread-review'].hidden,true,'nothing finished, nothing to review');
const html=c.choices({kind:'needs',parts:[{...question,replies:['1','<b>']}]});
assert.match(html,/data-reply="1"/);assert.match(html,/data-reply="&lt;b&gt;"/,'reply labels are escaped');
console.log('food review strip: finished foods only, open questions never block, calorie total, sending waits, escaped quick replies PASS');
// New ingredient-analysis controls need current food capability/consent, while
// the saved explanatory answer remains readable when generation is unavailable.
Object.assign(c,{previewRows:()=>null,changedNumbers:()=>false,kitFoodWords:s=>s,kitHtml:()=>'',svg:()=>'',food:()=>{throw Error('An answer must not render another food')}});
vm.runInContext(source.slice(source.indexOf('  function replyHtml('),source.indexOf('  // A "typing" bubble')),c);
const photoAnswer={entries:[],body:'Saved photo answer',result:{kind:'answer',photo_itemize:3}};
c.aiCan=()=>false;assert(!c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize'));
c.aiCan=()=>true;assert(c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize="3"'));
c.App.me.food_photo_itemize=false;assert(!c.replyHtml({id:1,state:'answered',result:{review_only:true}},photoAnswer).includes('data-photo-itemize'),'unreviewed ingredient prompt has no action');
console.log('photo breakdown: saved answers remain readable; new analysis requires current food consent/access PASS');

Object.assign(c,{food:e=>`<div class="thread-food">${e.name}</div>`});
const root={id:1,state:'answered',result:{review_only:true}};
for(const values of [[210],[200,100],[0]]){
 const entries=values.map((kcal,i)=>({name:'Food '+i,kcal}));
 const html=c.replyHtml(root,{entries:[],result:{kind:'preview',parts:[{estimated:true,entries}]}});
 assert.match(html,/Estimate breakdown/);assert.match(html,/thread-total/);
 assert(html.includes('≈ '+values.reduce((a,b)=>a+b,0)+' kcal'));
}
const unknown=c.replyHtml(root,{entries:[],result:{kind:'preview',parts:[{estimated:true,entries:[{name:'Unknown food',kcal:null}]}]}});
assert.match(unknown,/Incomplete/);assert(!unknown.includes('≈ 0 kcal'));
console.log('all estimate cards: visible row breakdown and total even one/zero, unknown total stays incomplete PASS');

// Explicit removal names each ingredient and disappears with the final food.
Object.assign(c,{fmtAmount:()=>"0.25 serving",source:()=>"Kit’s estimate"});
vm.runInContext(source.slice(source.indexOf('  function previewRows('),source.indexOf('  const pendingReview=')),c);
const removable={index:0,status:'ready',entries:[{name:'Mayonnaise <test>',kcal:25}],drafts:[{portion:{count:.25}}],entry_drafts:[0],remove_entries:[0],remove_token:'a'.repeat(64)};
const rows=c.previewRows(root,{parts:[removable]});
const removedHtml=c.stepRow(rows[0]);assert.match(removedHtml,/aria-label="Remove Mayonnaise &lt;test&gt;"/);assert.match(removedHtml,/>Remove<\/button>/);
assert.match(removedHtml,/data-step="-1"/);assert.match(removedHtml,/data-remove-food=/);
ctx.messages=[user(1),reply(1,[])];c.primary(ctx);assert.equal(nodes['#thread-review'].hidden,true);
assert.equal(c.previewRows({result:{review_only:false}},{parts:[removable]}),null,'logged/legacy rows cannot expose removal');
console.log('estimate removal: named explicit action, portion controls retained, final-food review hidden PASS');
