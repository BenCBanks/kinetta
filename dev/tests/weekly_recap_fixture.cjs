'use strict';

function weeklyRecapDismissalKey(profile,server,now=new Date()){
 const zone=profile.tz||'UTC',dayParts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}).formatToParts(now),weekday=dayParts.find(x=>x.type==='weekday')?.value,dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>dateParts.find(x=>x.type===k)?.value,today=`${get('year')}-${get('month')}-${get('day')}`,offset=weekday==='Mon'?1:0,start=new Date(today+'T12:00:00Z');
 start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7-7*offset);
 return `fit.weekly-recap:${server}:${profile.id}:${start.toISOString().slice(0,10)}`;
}

function seedWeeklyRecapDismissal(context,profile,server,now=new Date()){
 const key=weeklyRecapDismissalKey(profile,server,now);
 return context.addInitScript(key=>localStorage.setItem(key,JSON.stringify('dismissed')),key);
}

module.exports={weeklyRecapDismissalKey,seedWeeklyRecapDismissal};
