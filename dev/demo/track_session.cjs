// A fictional recording along the existing public demo park route. Never use real workout/location data.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function trackSession(state='paused') {
  const source=fs.readFileSync(path.join(__dirname,'../../app/static/track.js'),'utf8');
  const math=vm.runInNewContext(source.slice(source.indexOf('const TrackMath'),source.indexOf('const Track ='))+'\nTrackMath;');
  const route=JSON.parse(fs.readFileSync(path.join(__dirname,'routes.json'),'utf8'))['park loop'];
  const s={id:'00000000-0000-4000-8000-000000000358',start:0,activeAt:0,activeMs:0,checkpoint:0,state:'recording',sport:'run',label:'Run',name:'Fictional park run',gps:true,points:[],segment:0,distance:0,autoPause:false,voice:false,splitMetres:1609.344,splits:[]};
  let seconds=0,previous=null;
  for(const [lat,lon] of [...route,...route]) {
    const point={lat,lon};
    if(!previous){math.accept(s,{coords:{latitude:lat,longitude:lon,accuracy:5},timestamp:0},0);previous=point;continue;}
    const metres=math.metres(previous,point),n=Math.max(1,Math.ceil(metres/8));
    for(let i=1;i<=n;i++) {
      seconds+=metres/n/(2.8+.45*Math.sin(s.points.length/18));
      math.accept(s,{coords:{latitude:previous.lat+(lat-previous.lat)*i/n,longitude:previous.lon+(lon-previous.lon)*i/n,accuracy:5},timestamp:seconds*1000},seconds*1000);
      const fix=s.points.at(-1);fix.alt=100+10*Math.sin(s.points.length/35);fix.valt=5;
    }
    previous=point;
  }
  const now=Date.now();return {...s,state,start:now-(seconds+120)*1000,activeAt:now,activeMs:seconds*1000,checkpoint:now,finishedAt:now,visibility:'me'};
};
