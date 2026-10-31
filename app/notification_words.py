"""Short, deterministic notification copy from fixed, owner-scoped workout facts. No model calls."""
import math


def clean(value, limit=80):
    text=' '.join(''.join(ch if ch.isprintable() else ' ' for ch in str(value or '')).split())
    if len(text)<=limit:return text
    cut=text[:limit-1];word=cut.rsplit(' ',1)[0]
    return (word if len(word)>=limit*.6 else cut).rstrip()+'…'


def number(value):
    try:value=float(value)
    except (TypeError,ValueError,OverflowError):return None
    return value if math.isfinite(value) and value>=0 else None


def duration(seconds, precise=False):
    seconds=number(seconds)
    if seconds is None or seconds<=0:return ''
    if precise:
        total=round(seconds);hours,rest=divmod(total,3600);minutes,secs=divmod(rest,60)
        return f'{hours}:{minutes:02}:{secs:02}' if hours else f'{minutes}:{secs:02}'
    minutes=max(1,round(seconds/60));hours,mins=divmod(minutes,60)
    return f'{hours} h {mins} min' if hours and mins else f'{hours} h' if hours else f'{mins} min'


def distance(metres, units):
    metres=number(metres)
    return f"{metres/(1000 if units=='metric' else 1609.344):.2f} {'km' if units=='metric' else 'mi'}" if metres else ''


def sport_word(row):
    sport=row.get('sport') or 'workout'
    if sport=='workout' and (row.get('has_lifts') or row.get('sub_sport')=='strength_training' or row.get('sport_label') in ('Strength Training','Traditional Strength Training','Functional Strength Training')):return 'lift'
    return {'run':'run','ride':'ride','walk':'walk','hike':'hike','swim':'swim','row':'rowing workout','ski':'ski workout'}.get(sport,'workout')


def title(row):
    sport={'rowing workout':'row','ski workout':'ski session'}.get(sport_word(row),sport_word(row))
    choices={
        'run':('Nice run','Run logged. Well done','Good run'),
        'ride':('Nice ride','Ride logged. Well done','Good ride'),
        'walk':('Good walk','Walk logged. Well done','Nice walk'),
        'lift':('Strong lift','Session logged. Well done','Good lifting session'),
    }.get(sport,(f'Nice {sport}',f'{sport.capitalize()} logged. Well done',f'Good {sport}'))
    try:index=int(row.get('activity_id') or row.get('id') or 0)%len(choices)
    except (TypeError,ValueError):index=0
    head=choices[index]
    first=clean(row.get('recipient_name'),80).split(' ',1)[0]
    first=clean(first,max(1,38-len(head)-2))
    return head+(f', {first}' if first else '')


def ordinal(value):
    return str(value)+('th' if 10<=value%100<=20 else {1:'st',2:'nd',3:'rd'}.get(value%10,'th'))


def highlight(row,facts):
    if not row.get('user_id') or not row.get('activity_id') or not facts or facts.get('user_id')!=row.get('user_id') or facts.get('activity_id')!=row.get('activity_id'):return ''
    # The reader supplies canonical effort labels and prior records; ties are never new bests.
    best=[]
    for item in facts.get('bests',[]):
        seconds,prior,metres=number(item.get('seconds')),number(item.get('previous')),number(item.get('distance_m'))
        if seconds and prior and metres and seconds<prior and item.get('label'):best.append((metres,clean(item['label'],24),seconds))
    if best:
        _,label,seconds=max(best)
        return f'New {label} best: {duration(seconds,True)}'
    metres=number(row.get('distance_m'));sport=sport_word(row)
    if row.get('sport') in ('run','ride') and metres:
        for period in ('year','month'):
            item=facts.get('longest',{}).get(period,{})
            previous=number(item.get('previous_m'))
            if item.get('count',0)>0 and previous is not None and metres>previous:
                label='this '+period if item.get('current') else 'in '+clean(item.get('label'),16)
                if label!='in ':return f'Longest {sport} {label}'
    for item in facts.get('milestones',[]):
        amount=item.get('amount')
        if item.get('kind')=='sport_count' and amount in (100,250,500,1000):return f'{ordinal(amount)} {sport}'
        if item.get('kind')=='year_distance' and amount in (100,250,500,1000,2000) and item.get('unit') in ('mi','km') and isinstance(item.get('year'),int):return f"{amount:,} {item['unit']} in {item['year']}"
    weekly=facts.get('weekly',{});count=weekly.get('count',0)
    if isinstance(count,int) and count>=3:
        sofar=distance(weekly.get('distance_m'),row.get('units'))
        return f'{ordinal(count)} {sport} this week'+(f' · {sofar} so far' if sofar else '')
    days=facts.get('break_days')
    if isinstance(days,int) and days>=14 and facts.get('first_today'):
        return f'First {sport} in {days//7} weeks. Welcome back'
    return ''


def activity(row,facts=None):
    name=clean(row.get('activity') or 'Your workout',90)
    metres=distance(row.get('distance_m'),row.get('units'))
    seconds=duration(row.get('moving_s')) or duration(row.get('elapsed_s'))
    summary=(metres+' in '+seconds) if metres and seconds else metres or seconds
    body=name+(' · '+summary if summary else '')
    extra=highlight(row,facts)
    return title(row),body+('\n'+extra if extra else '')
