// Run the actual launch-time invitation selection. A stale link cannot silently add a friendship.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('app/static/app.js','utf8'),start=app.indexOf('  const cardCode=location.pathname.match'),end=app.indexOf('  // emailed links work',start);assert(start>0&&end>start);
function run(path,query='',values={}){const saved=new Map(Object.entries(values)),ctx={URLSearchParams,location:{pathname:path,search:query},store:{get:k=>saved.get(k),set:(k,v)=>saved.set(k,v),del:k=>saved.delete(k)}};vm.runInNewContext(app.slice(start,end),ctx);return saved;}
let saved=run('/signup','?challenge=new_challenge',{'kinetta.cardLink':'old_card','kinetta.friendLink':'old_friend'});assert.equal(saved.get('kinetta.challengeLink'),'new_challenge');assert(!saved.has('kinetta.cardLink'));assert(!saved.has('kinetta.friendLink'));
saved=run('/card/new_card','',{'kinetta.challengeLink':'old_challenge','kinetta.friendLink':'old_friend'});assert.equal(saved.get('kinetta.cardLink'),'new_card');assert(!saved.has('kinetta.challengeLink'));assert(!saved.has('kinetta.friendLink'));
saved=run('/','',{'kinetta.challengeLink':'remembered_challenge'});assert.equal(saved.get('kinetta.challengeLink'),'remembered_challenge','A normal login retains the invitation');
saved=run('/signup','?challenge=not%20a%20code',{'kinetta.friendLink':'remembered_friend'});assert.equal(saved.get('kinetta.friendLink'),'remembered_friend');assert(!saved.has('kinetta.challengeLink'));
console.log('Actual invitation routing: new challenge/card clears stale auto-friend intents; normal login retains the selected context PASS');
