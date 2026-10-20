// Native status refreshes must retain the audience selected in the review form.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/static/track.js','utf8'),start=source.indexOf('  function adoptNative(result)'),end=source.indexOf('  async function pullNative()',start);
const c={store:{del(){}},key:'own',persist(){},update(){},refreshMap(){}};vm.createContext(c);
vm.runInContext("let session={id:'own',name:'Fictional walk',visibility:'me',points:[]},message='';"+source.slice(start,end)+"\nglobalThis.getSession=()=>session;",c);
c.adoptNative({session:{id:'own',state:'review',pointOffset:0,points:[]}});assert.equal(c.getSession().visibility,'me');assert.equal(c.getSession().name,'Fictional walk');
c.adoptNative({session:{id:'another',state:'review',pointOffset:0,points:[]}});assert.equal(c.getSession().visibility,undefined,'another recording cannot inherit an old audience override');
console.log('Recording sharing: native status keeps the reviewed audience/name only for the same recording PASS');
