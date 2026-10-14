// Keep the public guide aligned with the in-app catalog. No dependencies or network.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),box={route(){}};
vm.runInNewContext(fs.readFileSync(path.join(root,'app/static/explore.js'),'utf8')+'\nglobalThis.catalog=FEATURE_GUIDE;',box);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=box.catalog.map(([group,title,description,href,how])=>`<article class="public-guide-card"><small>${esc(group)}</small><h2>${esc(title)}</h2><p>${esc(description)}</p><details><summary>How to use it</summary><p>${esc(how)}</p></details><a href="https://login.kinetta.app${esc(href)}">Open in Kinetta →</a></article>`).join('\n');
const file=path.join(root,'site/guide.html'),old=fs.readFileSync(file,'utf8');
const fresh=old.replace(/(<div id="feature-catalog">)[\s\S]*?(<\/div><!-- \/feature-catalog -->)/,(_,a,b)=>a+'\n'+html+'\n'+b);
if(fresh===old&&!old.includes('public-guide-card'))throw Error('Guide catalog markers missing');
if(process.argv.includes('--check')){if(fresh!==old)throw Error('Run node dev/design/build_guide.js to refresh public guide');}
else fs.writeFileSync(file,fresh);
console.log(`${box.catalog.length} features: app/public guide catalog matches`);
