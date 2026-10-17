'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),{webcrypto}=require('crypto');
const source=fs.readFileSync('app/static/app.js','utf8'),code=source.slice(source.indexOf('const newId ='),source.indexOf('// change a day of the food log'))+'\nthis.makeId=newId;';
const shape=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
for(const crypto of [webcrypto,{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)}]){const context=vm.createContext({crypto,Uint8Array});vm.runInContext(code,context);const ids=Array.from({length:100},()=>context.makeId());assert(ids.every(id=>shape.test(id)));assert.equal(new Set(ids).size,100);}
console.log('Client IDs: native and no-randomUUID fallback produce unique valid v4 UUIDs for typed recipe APIs PASS');
