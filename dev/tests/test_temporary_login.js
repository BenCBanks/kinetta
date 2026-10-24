// Actual native sign-in must never save a restricted recovery challenge as a login token.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function device(info){
 const saved=new Map([['token','old-token'],['server','https://example.test']]),events=[],c={route(){},console,Date,Map,JSON,Promise,Error,setTimeout,clearTimeout,App:{me:{id:1},cache:new Map([['private','old']])},forgetKept:()=>events.push('forget'),MutationObserver:class{observe(){}},
  document:{documentElement:{},addEventListener(){}},window:{addEventListener(){},Capacitor:{isNativePlatform:()=>true,Plugins:{Preferences:{get:async({key})=>({value:saved.get(key)}),set:async({key,value})=>saved.set(key,value),remove:async({key})=>saved.delete(key)},...(info?{App:{getInfo:info}}:{})}}},json:(method,body)=>({method,body}),api:async()=>({password_change_required:true,change_token:'restricted-challenge'})};
 vm.createContext(c);vm.runInContext(fs.readFileSync('app/static/native.js','utf8')+'\nglobalThis.n=Native;',c);await c.n.ready;
 c.n.disconnectPush=async()=>events.push('push-stop');c.n.disconnectHealth=async()=>{events.push('health-stop');return []};c.n.stopActivityShare=async()=>events.push('share-stop');return {c,saved,events};
}
(async()=>{
 const {c,saved,events}=await device(async()=>({version:'1.2.3',build:'42'}));assert.equal(c.n.headers()['X-Kinetta-Version'],'1.2.3 (42)');
 const restricted=await c.n.login('https://example.test','zz_test_member','an expiring phrase');assert.equal(restricted.change_token,'restricted-challenge');assert.equal(c.n.token,null);assert.equal(saved.has('token'),false);assert(![...saved.values()].includes('restricted-challenge'));assert.equal(c.App.me,null);assert.equal(c.App.cache.size,0);assert(events.indexOf('health-stop')<events.indexOf('forget'));
 c.api=async()=>({token:'normal-app-token'});await c.n.login('https://example.test','zz_test_member','a new private phrase');assert.equal(saved.get('token'),'normal-app-token');assert.equal(c.n.healthPaused,false);
 for(const info of [null,async()=>{throw Error('Unavailable')}]){const d=await device(info);assert.equal(d.c.n.headers()['X-Kinetta-Version'],undefined);assert.equal((await d.c.n.login('https://example.test','zz_test_member','phrase')).password_change_required,true);}
 console.log('PASS restricted native login: no challenge/session confusion, prior account cleared, normal login retained, optional version fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
