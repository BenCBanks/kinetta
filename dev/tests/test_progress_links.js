// Internal links must name a real Progress view; external unknown-view fallback remains unchanged.
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const pages=fs.readFileSync('app/static/pages.js','utf8'),allowed=new Set();
for(const name of ['PVIEWS','PMORE']){const block=pages.match(new RegExp('const '+name+' = ([\\s\\S]*?);'))?.[1];assert(block,name);for(const match of block.matchAll(/\[\s*'([^']+)'\s*,/g))allowed.add(match[1]);}
let count=0;for(const file of fs.readdirSync('app/static').filter(n=>n.endsWith('.js'))){const s=fs.readFileSync('app/static/'+file,'utf8');for(const m of s.matchAll(/\/progress\?view=([a-z_]+)/g)){assert(allowed.has(m[1]),file+' links to unregistered Progress view '+m[1]);count++;}}
assert(count>10);assert.match(pages,/class="mileage-progress" href="\/progress">View progress/);console.log('All'+count+' literal internal Progress-view links match registered views; Me targets home PASS');
