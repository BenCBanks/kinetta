// Native status refreshes must retain the audience selected in the review form.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/track.js','utf8'),start=source.indexOf('  function adoptNative(result)'),end=source.indexOf('  async function pullNative()',start);
const c={store:{del(){}},key:'own',persist(){},update(){},refreshMap(){}};vm.createContext(c);
vm.runInContext("let session={id:'own',name:'Fictional walk',visibility:'me',points:[]},message='';"+source.slice(start,end)+"\nglobalThis.getSession=()=>session;",c);
c.adoptNative({session:{id:'own',state:'review',pointOffset:0,points:[]}});assert.equal(c.getSession().visibility,'me');assert.equal(c.getSession().name,'Fictional walk');
c.adoptNative({session:{id:'another',state:'review',pointOffset:0,points:[]}});assert.equal(c.getSession().visibility,undefined,'another recording cannot inherit an old audience override');
console.log('Recording sharing: native status keeps the reviewed audience/name only for the same recording PASS');
// Render the production audience field with an older cached /me response.
const fieldStart=source.indexOf('<label>Who can see this activity<select'),fieldEnd=source.indexOf('</select></label>',fieldStart)+'</select></label>'.length,field=source.slice(fieldStart,fieldEnd);
const preview=(session,profile,saving=false)=>vm.runInNewContext('`'+field+'`',{session,App:{me:profile},saving,Object});
assert(preview({},{}).includes('<option value="">Use my saved sharing setting</option>'),'unknown cached preference is resolved on the server, never assumed public');
assert(preview({},{share_default:'me'}).includes('<option value="me" selected>'));
assert(preview({visibility:'friends'},{share_default:'everyone'}).includes('<option value="friends" selected>'));
assert(preview({visibility:'me'},{share_default:'everyone'},true).includes('<select name="visibility" disabled>'),'pending save cannot claim a newly changed audience');
console.log('Recording review: stale-cache fallback, known private default, explicit override and locked pending choice PASS');

const expected=source.match(/expected_sharing_default:([^,]+),client_id/)[1];
assert.equal(vm.runInNewContext(expected,{session:{},form:{elements:{namedItem:()=>({value:'me'})}},App:{me:{share_default:'everyone'}}}),'me','confirmation binds the visible private choice even if the profile refreshed in the background');
assert.equal(vm.runInNewContext(expected,{session:{visibility:'friends'},form:{elements:{namedItem:()=>({value:'friends'})}}}),undefined,'an explicit audience override is independent of the default');
