// Internal links must name a real Progress view; external unknown-view fallback remains unchanged.
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const pages=fs.readFileSync('app/static/pages.js','utf8'),allowed=new Set();
for(const name of ['PVIEWS','PMORE']){const block=pages.match(new RegExp('const '+name+' = ([\\s\\S]*?);'))?.[1];assert(block,name);for(const match of block.matchAll(/\[\s*'([^']+)'\s*,/g))allowed.add(match[1]);}
let count=0;for(const file of fs.readdirSync('app/static').filter(n=>n.endsWith('.js'))){const s=fs.readFileSync('app/static/'+file,'utf8');for(const m of s.matchAll(/\/progress\?view=([a-z_]+)/g)){assert(allowed.has(m[1]),file+' links to unregistered Progress view '+m[1]);count++;}}
const meInsight=pages.match(/function meInsightRow[\s\S]*?\n\}/)?.[0];assert(meInsight?.includes('<a class="me-insight me-insight-row')&&meInsight.includes('href="${esc(href)}"'),'Me insight rows keep their escaped Progress destinations');
const meInsights=pages.match(/function meInsights\([\s\S]*?\n\}/)?.[0];assert(meInsights?.includes("meInsightRow('This week'"),'Me keeps its compact weekly summary');assert(!/New bests|Consistency|Run pace|Walk pace|Ride speed|\/api\/records|\/api\/progress\/trends/.test(meInsights),'Me leaves duplicate records and detailed pace insights to Progress');assert(pages.includes("'/progress?sport=all'"),'This week opens all Progress activity');
assert(count>=6,'literal Progress view links remain represented across the distributed route owners: '+count);console.log('All '+count+' literal internal Progress-view links match registered views; Me insight destinations PASS');
