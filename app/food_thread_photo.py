"""Photo calorie questions use the selected owner's card, never invented numbers."""
import math
import re
from . import food_thread, food_thread_compose as compose, food_thread_edit as edits
from . import food_thread_facts as facts
from . import ai_release


def requested(text):
    text=' '.join(text.casefold().replace('’',"'").split())
    return bool(re.search(r'\b(?:itemi[sz](?:e|ed|ation)|break\s*down|breakdown)\b',text) or
                re.search(r'\b(?:list|show|give)\b.*\bcalories\b.*\b(?:photo|picture|ingredients?|each)\b',text) or
                re.search(r'\b(?:calories?|kcal)\b.*\b(?:each|per) (?:ingredient|item|component)\b',text) or
                re.search(r'\b(?:each|every) ingredient\b.*\b(?:calories?|kcal)\b',text))


def answer(c,uid,message):
    if not requested(message['body']):return None
    previous=edits._context(c,uid,message)
    if not previous or (previous.get('result') or {}).get('input',{}).get('kind')!='photo':return None
    # An explicit selected card may be older, but never from another review draft.
    draft=(message.get('result') or {}).get('draft_id')
    if draft and (previous.get('result') or {}).get('draft_id')!=draft:return None
    card=compose.card(c,uid,previous)
    if not card or card.get('cancelled') or card.get('kind') in ('undone','continued','cancelled'):return None
    parts=card.get('parts',[])
    logged=edits.current_entries(c,uid,previous['id']) if any(p.get('logged') for p in parts) else []
    entries=logged or [e for p in parts if p.get('status')=='ready' and not p.get('logged') for e in p.get('entries',[])]
    rows=[]
    for entry in entries:
        value=entry.get('kcal');unknown=(entry.get('ref') or {}).get('unknown_nutrients',[])
        known=type(value) in (float,int) and math.isfinite(value) and value>=0 and 'kcal' not in unknown
        rows.append({'name':entry['name'],'amount':' '.join(str(entry.get(k) or '') for k in ('amount','unit')).strip(),
                     'kcal':facts.kcal(value) if known else None})
    itemized=any(p.get('photo_itemized') for p in parts)
    can_itemize=ai_release.food_photo_itemization_enabled()
    text='Here’s the calorie breakdown from this photo’s current estimate.' if rows else 'This photo does not have a finished estimate yet.'
    if not itemized:
        text+=' Ingredient portions were not estimated separately; I cannot recover hidden ingredients from a whole-food total.'
        text+=(' Add the photo again to estimate bread, filling, cheese and sauces.' if can_itemize else
               ' Separate ingredient estimates are not available yet. Tell me the ingredients and amounts you know to build a more detailed food estimate.')
    text+=' Photo portions and hidden ingredients are estimates. Check the amounts and assumptions before logging.'
    result={'kind':'answer','intent':'photo_breakdown','source':'code','text':text,'breakdown':rows,
            'breakdown_notes':list(dict.fromkeys(str((e.get('ref') or {}).get('origin_notes') or '')[:300] for e in entries if (e.get('ref') or {}).get('origin_notes')))[:3],
            'breakdown_total':sum(r['kcal'] for r in rows) if rows and all(r['kcal'] is not None for r in rows) else None}
    if can_itemize and not itemized and not logged and not any(p.get('logged') for p in parts) and card.get('kind') in ('preview','needs') and (previous.get('result') or {}).get('review_only'):
        result['photo_itemize']=previous['id']
    return food_thread.finish_reply(c,uid,message,result)
