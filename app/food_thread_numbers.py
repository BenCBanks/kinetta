"""Recognize supplied nutrition as numbers to review, never catalog food names."""
import math
import re
NUM=r'[+-]?(?:\d{1,3}(?:,\d{3})+|\d+|\.\d+)(?:\.\d+)?'
LABEL=r'saturated\s+fat|sat\.?\s+fat|total\s+fat|protein|carbohydrates?|carbs?|fat|fib(?:er|re)|sodium|sugars?|calories?|cals?|kcal|kilojoules?|kj'
UNIT=r'milligrams?|grams?|mg|g'
PATTERN=re.compile(rf'(?<![\w.])(?:(?P<n>{NUM})\s*(?P<u>{UNIT})?\s*(?:of\s+)?(?P<label>{LABEL})\b|\b(?P<label2>{LABEL})\s*[:=]?\s*(?P<n2>{NUM})\s*(?P<u2>{UNIT})?\b)',re.I)
KEYS={'protein':'protein_g','carb':'carbs_g','carbs':'carbs_g','carbohydrate':'carbs_g','carbohydrates':'carbs_g','fat':'fat_g','total fat':'fat_g','saturated fat':'saturated_fat_g','sat fat':'saturated_fat_g','fiber':'fiber_g','fibre':'fiber_g','sodium':'sodium_mg','sugar':'sugar_g','sugars':'sugar_g','calorie':'kcal','calories':'kcal','cal':'kcal','cals':'kcal','kcal':'kcal'}
FOOD_SUFFIX=re.compile(r'^\s*(?:[- ]free\b|bars?\b|powder\b|shakes?\b|isolate\b|supplements?\b)',re.I)


def parse(text,limits):
    matches=[]
    for match in PATTERN.finditer(text):
        label=' '.join((match['label'] or match['label2']).lower().replace('.','').split())
        if label in ('protein','fat','sugar','carbs') and FOOD_SUFFIX.match(text[match.end():]):continue
        matches.append((match,label))
    if not matches:
        malformed=re.search(rf'\b(?:{LABEL})\s*[:=]',text,re.I)
        suspicious=re.search(rf'\d[\d.,+-]*\s*(?:{UNIT})?\s*(?P<field>{LABEL})\b',text,re.I)
        if suspicious and FOOD_SUFFIX.match(text[suspicious.end():]):suspicious=None
        if malformed or suspicious:return {'name':'Meal with entered nutrition','values':{},'problem':'Check the nutrition numbers and units for the whole portion.'}
        return None
    values={};duplicates=set();problem=None
    for match,label in matches:
        key=KEYS.get(label)
        if key is None:problem='Check the energy unit and enter calories in kcal.';continue
        if key in values or key in duplicates:values.pop(key,None);duplicates.add(key);problem='More than one value was given for a nutrient. Check the whole portion.';continue
        value=float((match['n'] or match['n2']).replace(',',''));unit=(match['u'] or match['u2'] or '').lower()
        if key=='kcal' and unit:problem='Check the calorie unit.';continue
        if key!='kcal':
            if not unit:problem='Use grams or milligrams for nutrient amounts.';continue
            milligrams=unit.startswith('m')
            value*=1000 if key=='sodium_mg' and not milligrams else .001 if key!='sodium_mg' and milligrams else 1
        if not math.isfinite(value) or not 0<=value<=limits[key]:problem='Check the nutrition amount; a number is outside the allowed range.';continue
        values[key]=value
    prefix=text[:matches[0][0].start()]
    if re.search(r'\d[.,]\s*$',prefix):problem='Check the number separators before entering this portion.';values={}
    name=prefix.strip(' ,:;.-\n')
    name=re.sub(r'^(?:(?:i\s+)?(?:ate|had)|log|add)\s+','',name,flags=re.I).strip()
    name=(name or 'Meal with entered nutrition')[:200]
    tail=text[matches[0][0].start():]
    offset=matches[0][0].start();spans=[]
    for match,_ in matches:spans.append((match.start()-offset,match.end()-offset))
    for start,end in reversed(spans):tail=tail[:start]+' '+tail[end:]
    # A basis or another food after the numbers is not a whole-portion total.
    if re.search(r'\b(?:per|each|servings?)\b|/\s*\d',text,re.I):
        problem='These numbers may be per serving or per 100 g. Enter numbers for the amount you ate.';values={}
    elif re.sub(r'\b(?:and|with|total|in\s+total|about|approximately|roughly|estimated)\b|[\s,;:()./=-]','',tail,flags=re.I):
        problem='Check that these numbers describe one whole portion. Keep other foods in a separate message.'
    if 'kcal' not in values:problem=problem or 'Add the calories for this portion. Missing nutrients can stay unknown.'
    return {'name':name,'values':values,'problem':problem}


def preview(c,uid,message):
    import datetime as dt
    from . import meal_chat,nutrients as N,food_thread,food_thread_log as engine
    body=meal_chat.LEAD.sub('',message['body']).strip()
    text,when=meal_chat.when(meal_chat.norm(body),message['local_day'])
    parsed=parse(text if text is not None else body,N.ENTRY_MAX)
    if parsed is None:return None
    destination_required=not isinstance(when,dict) and when!='Use a positive amount.'
    problem=parsed['problem'] if isinstance(when,dict) else when
    when=when if isinstance(when,dict) else {}
    values={k:parsed['values'].get(k) for k in N.ALL}
    entry={'name':parsed['name'],'brand':None,'amount':1,'unit':'serving',**values,
           'source':'quick','ref':{'origin':'manual','unknown_nutrients':[k for k,v in values.items() if v is None]}}
    part={'index':0,'text':message['body'],'status':'quantity' if problem else 'ready','item':{},'logged':False,
          'manual':True,'requires_tap':True,'looked_up':True,'entered_numbers':{'name':parsed['name'],'values':parsed['values']},
          'question':problem,'entries':[] if problem else [entry]}
    result={'kind':'needs' if problem else 'preview','composed':True,'parts':[part],'day':str(when.get('day') or message['local_day']),
            'meal':when.get('meal') or engine.expected_meal(c,uid,message['captured_at']),
            'destination_required':destination_required,'text':problem or 'Your nutrition numbers are ready to review. Tap Log when the whole portion is correct.',
            'source':'your numbers','entry_ids':[],'pending_count':1 if problem else 0,'can_resolve':False,
            'as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    return food_thread.finish_reply(c,uid,message,result)
