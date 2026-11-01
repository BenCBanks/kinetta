"""Forward-only action labels for optional aggregate metrics, separate from nutrition provenance."""

METHODS=('describe','search','barcode','photo','recipe','copy_yesterday','copy_other','manual','mixed','other','unknown')


def stamp(c,uid,ids,method):
    from .admin_features import enabled
    if not ids or not enabled():return
    if method not in METHODS:method='unknown'
    c.execute('UPDATE food_entries SET entry_method=%s WHERE user_id=%s AND id=ANY(%s) AND entry_method IS NULL',
              (method,uid,ids))


def from_message(message,part=None,entry=None):
    part=part or {};entry=entry or {};r=message.get('result') or {};request=r.get('review_request') or {}
    if entry.get('entry_method') in METHODS:return entry['entry_method']
    if part.get('recipe_pick') or request.get('did'):return 'recipe'
    if r.get('receipt'):return 'unknown'
    media=(r.get('input') or {}).get('kind')
    if media in ('photo','barcode'):return media
    if request:return 'unknown'  # A staged picker without an action label is an older client.
    return 'describe'


def compose(c,uid,ids,message,part,entries):
    for eid,entry in zip(ids,entries):stamp(c,uid,[eid],from_message(message,part,entry))


def review(c,uid,ids,sources,recipe=False,combined=False):
    labels=[from_message(m,p,e) for m,r in sources for p in r.get('parts',[]) for e in p.get('entries',[])]
    if combined:
        stamp(c,uid,ids,'recipe' if recipe else labels[0] if labels and len(set(labels))==1 else 'mixed')
    else:
        for eid,method in zip(ids,labels):stamp(c,uid,[eid],method)


def copied(c,uid,ids,source_day,destination_day):
    import datetime as dt
    stamp(c,uid,ids,'copy_yesterday' if source_day==destination_day-dt.timedelta(days=1) else 'copy_other')


def recipe(c,uid,ids):stamp(c,uid,ids,'recipe')
def described(c,uid,ids):stamp(c,uid,ids,'describe')


def copy_rows(c,uid,ids,rows,destination_day):
    import datetime as dt
    dates={r.get('day') for r in rows if isinstance(r.get('day'),dt.date)}
    if len(dates)==1:copied(c,uid,ids,next(iter(dates)),destination_day)
    else:stamp(c,uid,ids,'copy_other')


def staged_copy(c,uid,message,rows,destination_day):
    import datetime as dt
    from .admin_features import enabled
    if not enabled():return [{k:v for k,v in r.items() if k!='entry_method'} for r in rows]
    dates={r.get('day') for r in rows if isinstance(r.get('day'),dt.date)}
    method='copy_yesterday' if len(dates)==1 and next(iter(dates))==destination_day-dt.timedelta(days=1) else 'copy_other'
    return [{**r,'entry_method':method} for r in rows]
