"""Explicit body-weight statements in a food chat message."""
import datetime as dt
import re

STATEMENT = re.compile(
    r"(?P<sep>\s*(?:,|;|\b(?:and\s+)?))(?P<claim>"
    r"(?:i\s+)?(?:weighed|weight(?:\s+(?:is|of))?|scale\s+said)\s*"
    r"(?P<n>\d{2,3}(?:[.,]\d+)?)\s*(?P<u>kg|kgs?|kilograms?|lb|lbs?|pounds?)?"
    r"|\bi(?:'m|\s+am)\s+(?P<n2>\d{2,3}(?:[.,]\d+)?)\s*(?P<u2>kg|kgs?|kilograms?|lb|lbs?|pounds?)\b)"
    r"(?P<when>\s+(?:today|yesterday|this\s+morning|this\s+evening))?\s*$", re.I)

# A meal message may contain one body-weight statement, but two values cannot
# be saved safely as one weigh-in. Catch the common "165 lb and 160 lb" form
# before the food parser treats the second value as another food.
MULTIPLE = re.compile(
    r"\b(?:weighed|weight(?:\s+(?:is|of))?|scale\s+said|i(?:'m|\s+am))\s*"
    r"\d{2,3}(?:[.,]\d+)?\s*(?:kg|kgs?|kilograms?|lb|lbs?|pounds?)?"
    r"\s*(?:,|and|or|then|/)\s*(?:then\s+)?"
    r"(?:weighed\s+|weight(?:\s+(?:is|of))?\s+|scale\s+said\s+|i(?:'m|\s+am)\s+)?"
    r"\d{2,3}(?:[.,]\d+)?\s*(?:kg|kgs?|kilograms?|lb|lbs?|pounds?)?\b", re.I)


def parse(c, uid, body, anchor):
    """Return a normalized weigh-in and remaining food words, or None."""
    text=body.strip().rstrip(' .!?')
    if MULTIPLE.search(text):
        return {'ambiguous':True,'food':text}
    match=STATEMENT.search(text)
    if not match:return None
    number=(match.group('n') or match.group('n2') or '').replace(',','.')
    unit=(match.group('u') or match.group('u2') or '').lower()
    profile=c.execute('SELECT units,tz FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    pounds=unit in ('lb','lbs','pound','pounds') or (not unit and profile.get('units')=='imperial')
    value=float(number)
    kg=value/2.2046226218 if pounds else value
    plausible=(66<=value<=660) if pounds else (30<=value<=300)
    if not plausible:
        return {'invalid':True,'food':text[:match.start()].strip(' ,;'),'day':anchor.isoformat()}
    when=(match.group('when') or '').lower()
    day=anchor-dt.timedelta(days=1) if 'yesterday' in when else anchor
    food=(text[:match.start()]+' '+text[match.end():]).strip(' ,;')
    return {'kg':round(kg,4),'amount':value,'unit':'lb' if pounds else 'kg','day':day.isoformat(),'today':day==anchor,'food':food}
