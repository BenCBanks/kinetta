// The same saved-recipe data supports two deliberate purposes: management and adding a portion.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),source=fs.readFileSync('app/static/food.js','utf8');
(async()=>{
 const row={dataset:{dish:'0'}},secondary={dataset:{editMeal:'7'}},nodes={},actions=[],dish={id:7,name:'Fictional oats',mine:true,items:[],serving:'one',per_serving:{kcal:200},totals:{kcal:200}};
 const c={readOwner:()=> 'fictional-owner',skel:()=>'',esc:String,r0:String,listOf:()=>'',svg:()=>'',api:async path=>path==='/api/dishes'?[dish]:[],$:s=>nodes[s]||(nodes[s]={}),$$:s=>s==='[data-dish]'?[row]:s==='[data-edit-meal]'?[secondary]:[],go:path=>actions.push(['open',path]),dishLogSheet:d=>actions.push(['log',d.id])};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function tSaved('),source.indexOf("route(/^\\/food\\/meals")),c);
 const body={innerHTML:'',isConnected:true},where=()=>({day:'2026-10-28',meal:'lunch'});
 await c.tSaved(body,where,()=>{},{manage:true});assert(body.innerHTML.includes('Log portion'));row.onclick();secondary.onclick();assert.deepEqual(actions,[['open','/food/cook/7'],['log',7]],'My Recipes opens the recipe first; logging is a separate explicit action');
 actions.length=0;await c.tSaved(body,where,()=>{});row.onclick();secondary.onclick();assert.deepEqual(actions,[['log',7],['open','/food/cook/7']],'Add food keeps portion selection primary and Edit separate');
 await c.tSaved(body,where,()=>{},{manage:true});c.foodEditor=async(_,after)=>after();await nodes['#tm-food'].onclick();assert(body.innerHTML.includes('Open a recipe to edit it'),'Returning from New food keeps the library purpose');
 const normalApi=c.api;c.api=async()=>{throw Error('Temporary failure')};await c.tSaved(body,where,()=>{},{manage:true});assert(body.innerHTML.includes('Try again'));c.api=normalApi;await nodes['#tm-retry'].onclick();assert(body.innerHTML.includes('Open a recipe to edit it'));
 c.api=async()=>{body.isConnected=false;return []};body.innerHTML='';await c.tSaved(body,where,()=>{});assert.equal(body.innerHTML,'');
 // The source also fences each completed parallel read to the current mounted owner.
 console.log('Recipe library purpose: manage opens the recipe; Add food opens portion review; neither implicitly writes food PASS');
})().catch(error=>{console.error(error);process.exit(1)});
