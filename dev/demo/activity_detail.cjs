// Display-only native fixture built from the published fictional park route.
'use strict';
const route=require('./routes.json')['park loop'];
module.exports=function activityDetail(empty=false){
 let last=[0,0],line='';
 const encode=n=>{n=n<0?~(n<<1):n<<1;let s='';while(n>=32){s+=String.fromCharCode((32|(n&31))+63);n>>=5;}return s+String.fromCharCode(n+63);};
 for(const pair of route){const point=pair.map(v=>Math.round(v*1e5));line+=encode(point[0]-last[0])+encode(point[1]-last[1]);last=point;}
 return {id:1,name:empty?'Fictional indoor walk':'Fictional park run',sport:empty?'walk':'run',source:'manual',start_time:'2026-10-28T08:30:00Z',visibility:'me',elapsed_s:1800,moving_s:1800,distance_m:empty?null:5000,ascent_m:empty?0:38,avg_hr:empty?null:145,calories:empty?null:330,avg_cad:empty?null:165,line:empty?null:line,photos:[],chart:empty?null:{t:[0,600,1200,1800],d:[0,1667,3333,5000],speed:[2.8,2.7,2.9,2.8],hr:[135,145,150,145]},splits_km:[],splits_mi:[],laps:[],efforts:[],similar:[],summary_overrides:{},ai_note:empty?null:'A fictional workout note.',description:'',social:{mine:true,cheers:[],comments:[],visibility:'me',details:{}}};
};
