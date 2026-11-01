// Pure checks over measured DOM boxes. The browser collector supplies complete hit areas, not icon sizes.
'use strict';
const typeScale={title:[28,32],section:[17,20],card:[16,17],body:[15,16],secondary:[13,14],chart:[12,16],stat:[20,24],hero:[20,40],glyph:[12,32],text:[12,32]};
const overlap=(a,b,axis)=>Math.min(a[axis]+a[axis==='x'?'width':'height'],b[axis]+b[axis==='x'?'width':'height'])-Math.max(a[axis],b[axis]);
const related=(a,b)=>a.key===b.key||a.activationKey&&a.activationKey===b.activationKey;
function validateExceptions(rules){
 const ids=new Set(),metrics=new Set(['target','blocked','input-height','input-font','gap','overlap','font-min','font-max','unmarked-large','hero-count','clipped','overflow']);
 for(const r of rules){
  if(!r.id||ids.has(r.id)||!r.selector||/^(?:\*|svg|nav|a|button|input|\.small)$/.test(r.selector.trim())||!metrics.has(r.metric)||!r.reason||r.reason.length<20)throw Error('Spacing exception needs a unique ID, specific selector, one metric and a concrete reason');
  if(r.kind==='accessible-decoration'&&r.metric!=='font-min')throw Error('A decorative text exception only applies to its hidden label');
  if(r.metric==='font-min'&&![r.minimum,r.exact].some(Number.isFinite))throw Error('A small-text exception needs a measured lower bound or exact hidden value');
  if(r.kind==='intentional-overlay'&&(r.metric!=='overlap'||!r.withSelector||!Number.isFinite(r.maximum)))throw Error('An overlay exception needs one specific partner and a measured maximum');
  if(!['attribution','chart-tick','inline-link','accessible-decoration','intentional-overlay'].includes(r.kind)&&!/^https:\/\/github\.com\/BenCBanks\/kinetta\/issues\/\d+$/.test(r.followup||''))throw Error('Existing spacing violations need a linked follow-up issue: '+r.id);
  ids.add(r.id);
 }
}
function neighbours(targets){
 const pairs=new Map();
 for(const a of targets){
  const nearest={};
  for(const b of targets){
   if(related(a,b)||(a.layer||'page')!==(b.layer||'page'))continue;
   const x=overlap(a.rect,b.rect,'x'),y=overlap(a.rect,b.rect,'y');
   if(x>.02&&y>.02){const key=[a.key,b.key].sort().join('|');pairs.set(key,{a,b,metric:'overlap',actual:Math.min(x,y)});continue;}
   let direction,distance;
   if(x>.02){direction=b.rect.y>=a.rect.y+a.rect.height?'down':'up';distance=direction==='down'?b.rect.y-a.rect.y-a.rect.height:a.rect.y-b.rect.y-b.rect.height;}
   else if(y>.02){direction=b.rect.x>=a.rect.x+a.rect.width?'right':'left';distance=direction==='right'?b.rect.x-a.rect.x-a.rect.width:a.rect.x-b.rect.x-b.rect.width;}
   if(direction&&distance>=-.02&&(!nearest[direction]||distance<nearest[direction].actual))nearest[direction]={a,b,metric:'gap',actual:Math.max(0,distance),direction};
  }
  for(const p of Object.values(nearest))pairs.set([p.a.key,p.b.key].sort().join('|'),p);
 }
 return [...pairs.values()];
}
function audit(snapshot,rules=[]){
 validateExceptions(rules);
 const violations=[],exceptionsUsed=[],scale=Math.max(1,(snapshot.rootFont||16)/16);
 const issue=(record,metric,actual,expected,other)=>{
  const exception=rules.find(r=>r.metric===metric&&(r.withSelector?other&&((record.pairedExceptions?.[r.id]?.includes(other.key))||(other.pairedExceptions?.[r.id]?.includes(record.key)))&&record.hit&&other.hit:record.exceptions?.includes(r.id)&&(!other||other.exceptions?.includes(r.id)))&&(r.minimum===undefined||typeof actual==='number'&&actual>=r.minimum-.02)&&(r.maximum===undefined||typeof actual==='number'&&actual<=r.maximum+.02)&&(r.exact===undefined||actual===r.exact));
  const row={screen:snapshot.screen,element:record.selector||record.key,metric,actual,expected,...(record.rect?{box:record.rect}:{}),...(record.hit===undefined?{}:{hit:record.hit,hitOwner:record.hitOwner}),...(other?{neighbour:other.selector||other.key,neighbourBox:other.rect}:{})};
  if(exception)exceptionsUsed.push({...row,exception:exception.id,reason:exception.reason,followup:exception.followup});else violations.push(row);
 };
 if(snapshot.overflow)issue({key:'document',selector:'html',exceptions:snapshot.exceptions},'overflow',snapshot.documentWidth,snapshot.viewportWidth);
 for(const c of snapshot.containers||[])if(c.clipped)issue(c,'clipped',c.clipped,'Text fits its container');
 for(const t of snapshot.targets||[]){
  if(t.unreachable&&!t.disabled&&!t.inlineLink)issue(t,'blocked',t.hitOwner,'An exposed hit area in at least one scroll position');
  if(!t.inlineLink&&(t.rect.width<43.98||t.rect.height<43.98))issue(t,'target',{width:t.rect.width,height:t.rect.height},'44 × 44px');
  if(t.input){if(t.rect.height<43.98)issue(t,'input-height',t.rect.height,44);if(t.font<15.98)issue(t,'input-font',t.font,16);if(t.font>(t.hero?40:16)*scale+.02)issue(t,'font-max',t.font,(t.hero?40:16)*scale);}
 }
 for(const p of neighbours((snapshot.targets||[]).filter(t=>!t.inlineLink)))if(p.metric==='overlap'||p.actual<7.98)issue(p.a,p.metric,p.actual,p.metric==='gap'?8:0,p.b);
 const heroes=new Map();
 for(const t of snapshot.texts||[]){
  const role=t.hero?'hero':t.role||'text',[minimum,maximum]=typeScale[role]||typeScale.text;
  if(t.font<minimum-.02)issue(t,'font-min',t.font,minimum);
  if(t.font>maximum*scale+.02)issue(t,'font-max',t.font,maximum*scale);
  if(!t.hero&&t.font>32*scale+.02)issue(t,'unmarked-large',t.font,'Mark one hero number or use the page type scale');
  if(t.clipped)issue(t,'clipped',t.clipped,'Text fits its container');
  if(t.numeric&&t.group&&(t.hero||t.font>24*scale+.02)){if(!heroes.has(t.group))heroes.set(t.group,new Map());heroes.get(t.group).set(t.heroKey||t.key,t);}
 }
 for(const [group,items] of heroes)if(items.size>1)issue({key:group,selector:group,exceptions:[...items.values()][0].groupExceptions},'hero-count',items.size,1);
 return {violations,exceptionsUsed};
}
module.exports={audit,neighbours,validateExceptions,typeScale};
