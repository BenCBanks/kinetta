'use strict';

const PERSONA_CLOCKS={
 'sunday-02':{year:2026,month:11,day:15,hour:2,weekday:'Sun'},
 'sunday-19':{year:2026,month:11,day:15,hour:19,weekday:'Sun'},
 'wednesday-12':{year:2026,month:11,day:18,hour:12,weekday:'Wed'},
};

function personaClockInstant(name,zone='UTC'){
 const target=PERSONA_CLOCKS[name];if(!target)throw new Error(`Unknown persona clock scenario: ${name}`);
 const wanted=Date.UTC(target.year,target.month-1,target.day,target.hour),format=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'});
 let instant=wanted;
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(format.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
  const seen=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
  instant+=wanted-seen;
 }
 const date=new Date(instant),parts=Object.fromEntries(format.formatToParts(date).map(part=>[part.type,part.value]));
 const weekday=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}).format(date);
 if(Number(parts.year)!==target.year||Number(parts.month)!==target.month||Number(parts.day)!==target.day||Number(parts.hour)!==target.hour||weekday!==target.weekday)throw new Error(`Could not resolve ${name} in ${zone}`);
 return date;
}

function weeklyRecapDismissalKey(profile,server,now=new Date()){
 const zone=profile.tz||'UTC',dayParts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}).formatToParts(now),weekday=dayParts.find(x=>x.type==='weekday')?.value,dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>dateParts.find(x=>x.type===k)?.value,today=`${get('year')}-${get('month')}-${get('day')}`,offset=weekday==='Mon'?1:0,start=new Date(today+'T12:00:00Z');
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7-7*offset);
 return `fit.weekly-recap:${server}:${profile.id}:${start.toISOString().slice(0,10)}`;
}

function seedWeeklyRecapDismissal(context,profile,server,now=new Date()){
 const key=weeklyRecapDismissalKey(profile,server,now);
 return context.addInitScript(key=>localStorage.setItem(key,JSON.stringify('dismissed')),key);
}

module.exports={weeklyRecapDismissalKey,seedWeeklyRecapDismissal,personaClockInstant};
