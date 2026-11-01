'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/feature-usage.js','utf8');
async function setup(on=true){
 const calls=[],context={App:{me:{id:1}},location:{pathname:'/me',search:''},URLSearchParams,session:'one',api:async(path,body)=>{calls.push({path,body});return{enabled:on};},json:(method,body)=>({method,body})};
 context.readOwner=()=>context.session;vm.createContext(context);vm.runInContext(source+';globalThis.feature=FeatureUsage;',context);return{context,calls};
}
const settle=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const {context:c,calls}=await setup();
 const routes=[['/progress?view=fitness','fitness'],['/progress/heatmap','heatmap'],['/me/explore','explore'],['/me/kit?from=activity','kit'],['/me/settings','settings'],['/me/sharing','settings_privacy'],['/me/notifications','settings_notifications'],['/food?view=overview','insights'],['/progress?section=food','insights']];
 for(const [url,feature] of routes){const[p,s]=url.split('?');c.location.pathname=p;c.location.search=s?'?'+s:'';c.feature.open(p);await settle();assert.equal(calls.at(-1).body.body.feature,feature);const n=calls.length;c.feature.open(p);await settle();assert.equal(calls.length,n,'data refresh is not another open');}
 for(const url of ['/progress/trends','/food','/activity/123?secret=private-title']){const[p,s]=url.split('?');c.location.pathname=p;c.location.search=s?'?'+s:'';const n=calls.length;c.feature.open(p);await settle();assert.equal(calls.length,n);}
 assert.equal(calls.filter(x=>x.path==='/api/features/state').length,1);assert(!JSON.stringify(calls).includes('private-title'));
 const n=calls.length;c.session='two';c.App.me.id=2;await c.feature.event('share_picture','one');assert.equal(calls.length,n,'late old-owner picture is discarded');
 const same=await setup(false);await same.context.feature.event('kit');same.context.session='new-server-same-user';same.context.api=async(path,body)=>{same.calls.push({path,body});return{enabled:true};};await same.context.feature.event('kit');assert.equal(same.calls.filter(x=>x.path==='/api/features/state').length,2,'same ID on another server/session rechecks its operator setting');assert.equal(same.calls.at(-1).body.body.feature,'kit');
 const off=await setup(false);await off.context.feature.event('settings_data');assert.equal(off.calls.length,1);assert.equal(off.calls[0].path,'/api/features/state');
 const late=await setup();let finish;late.context.api=path=>new Promise(r=>{finish=r;});const pending=late.context.feature.event('kit');late.context.App.me.id=9;late.context.session='nine';finish({enabled:true});await pending;assert.equal(late.calls.length,0);
 console.log('Feature metrics: actual route/query mapping, no refresh events, off switch, no URLs and old-owner async guards PASS');
})().catch(e=>{console.error(e);process.exit(1);});
