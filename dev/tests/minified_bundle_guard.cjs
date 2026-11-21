// Runtime contract used by every browser shard. The Docker image builds the
// served assets before these checks, so this proves the browser sees minified
// bundles rather than only testing the Python builder in isolation.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.KINETTA_URL||'http://localhost:8798';
const jsNames=()=>{const source=fs.readFileSync('app/asset_build.py','utf8'),block=source.match(/'app-shell\.js': \(([\s\S]*?)\n    \),/);return [...block[1].matchAll(/'([^']+\.js)'/g)].map(m=>m[1]);};
const cssNames=()=>{const source=fs.readFileSync('app/asset_build.py','utf8'),block=source.match(/'critical-shell\.css': \(([\s\S]*?)\n    \),/);return [...block[1].matchAll(/'([^']+\.css)'/g)].map(m=>m[1]);};
const get=async path=>{const response=await fetch(base+'/static/'+path);assert.equal(response.status,200,'Minified bundle response: '+path);return response.text();};
(async()=>{
 const [shell,critical]=await Promise.all([get('app-shell.js'),get('critical-shell.css')]);
 for(const name of jsNames())assert(shell.includes(`/*! ${name} */`),'app-shell.js is missing module marker: '+name);
 for(const name of cssNames())assert(critical.includes(`/*! ${name} */`),'critical-shell.css is missing module marker: '+name);
 assert(!/sourceMappingURL=/.test(shell+critical),'Production shell must not ship sourcemaps');
 const rawJs=jsNames().reduce((n,name)=>n+fs.statSync('app/static/'+name).size,0);
 const rawCss=cssNames().reduce((n,name)=>n+fs.statSync('app/static/'+name).size,0);
 assert(shell.length<rawJs,'Browser received an unminified app-shell.js');
 assert(critical.length<rawCss,'Browser received unminified critical-shell.css');
 console.log('Minified browser bundles PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
