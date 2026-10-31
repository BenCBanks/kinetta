'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const values=new Map(),ctx={Native:{base:''},location:{origin:'https://fictional.example'},App:{me:{id:1}},store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('app/static/discovery.js','utf8')+'\nglobalThis.discovery=Discovery;',ctx);
const d=ctx.discovery;assert.equal(d.hasVisited('guide','weight'),false);d.visit('guide','weight');assert.equal(d.hasVisited('guide','weight'),true);assert.equal(d.hasVisited('nutrition','weight'),false);d.visit('guide','weight');assert.equal([...values.values()][0].length,1);
ctx.App.me.id=2;assert.equal(d.hasVisited('guide','weight'),false);ctx.App.me.id=1;ctx.Native.base='https://other-fictional.example';assert.equal(d.hasVisited('guide','weight'),false);ctx.Native.base='';assert.equal(d.hasVisited('guide','weight'),true);ctx.App.me=null;assert.equal(d.hasVisited('guide','weight'),false);d.visit('guide','unowned');assert.equal(values.size,1);
console.log('Guide read/visit account/server/space isolation, duplicate and signed-out guards PASS');
