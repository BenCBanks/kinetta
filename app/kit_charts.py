"""Evidence-bound presentation and validation for on-demand Kit charts."""
import copy
import math
import re
from pydantic import Field
from .coach_tools import Empty

CHART_TOOL = 'chart_series'
SUMMARY_FIELDS = ('overall', 'first', 'last', 'highest', 'lowest', 'change')
CHART_SYSTEM = """
For an on-demand workout chart use chart_series; choose only enums, never SQL or another account.
Use the conversational blocks/facts contract. Optional chart:{"evidence_id":"e2"} references one successful
chart_series result. The app draws the chart, never model-written points or markup. Cite only numeric
summary.overall/first/last/highest/lowest/change; points, dates, counts and metadata are not citable values.
Answer the question naturally and briefly; do not switch to verdict/reason or repeat the chart as a data list.
Keep total, average and fastest meanings distinct. Use rose/fell/unchanged, or faster/slower for pace, only
when supported by summary.direction. Fewer than three measured points cannot establish a trend.
For an unfinished period say 'so far'; for empty or sparse data say what can be shown without inventing
measurements or trends. Do not infer feelings, fitness, causes or recovery from the chart.
Use charts only on demand inside Kit answers; never request one for the weekly-review starter.
"""


class ChartReference(Empty):
    evidence_id: str = Field(pattern=r'^e[1-9]\d*$')


def request_arguments(arguments, question):
    # One calendar week starts on Monday; an explicit past-week workout chart
    # means the seven local dates ending today. Keep other requests untouched.
    if (isinstance(arguments,dict) and arguments.get('group_by')=='workout'
            and arguments.get('period_unit')=='weeks' and type(arguments.get('period_count')) is int and arguments['period_count']==1
            and re.search(r'\bpast week\b',question or '',re.I)
            and not re.search(r'\b(?:(?:this|calendar|previous|prior) week|compare|versus)\b',question or '',re.I)):
        return {**arguments,'period_unit':'days','period_count':7}
    return arguments


def counted_records(prose, evidence):
    # Bind spelled-out counts only to one complete current chart source. This
    # does not make previous conversation or an unconsented source evidence.
    words='zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
    pattern=r'\b('+'|'.join(words)+r') (?:recorded|logged) (workouts?|sessions?|runs?|rides?|walks?|hikes?|swims?)\b'
    records=[e for e in evidence if e.get('tool')==CHART_TOOL and 'error' not in e
             and isinstance(e.get('data'),dict) and 'error' not in e['data']]
    traces=[]
    def replace(match):
        if len(records)!=1:raise ValueError('Unverified recorded workout count')
        record=records[0];data=record['data'];count=data.get('workouts')
        sport={'run':'run','runs':'run','ride':'ride','rides':'ride','walk':'walk','walks':'walk',
               'hike':'hike','hikes':'hike','swim':'swim','swims':'swim'}.get(match[2].casefold())
        prefix=re.split(r'[.!?;]\s*',prose[:match.start()])[-1]
        if (type(count) is not int or count<0 or data.get('truncated') is not False
                or data.get('group_by')!='workout' or words.index(match[1].casefold())!=count
                or sport is not None and sport!=data.get('sport')
                or re.search(r'\b(?:no|not|never|fewer|more|less|previous|prior)\b',prefix,re.I)
                or re.search(r'\b(?:over|under|at least|at most)\s*$',prefix,re.I)
                or re.search(r'(?:\b(?:'+'|'.join(words)+r'|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?: and)?|[-–—‑])\s*$',prefix,re.I)):
            raise ValueError('Unverified recorded workout count')
        traces.append({'evidence_id':record['evidence_id'],'path':['workouts'],'relation':'equal'})
        return 'recorded activity evidence'
    return re.sub(pattern,replace,prose,flags=re.I),traces


def chart_fact(data, path, value, units):
    if len(path) != 2 or path[0] != 'summary' or path[1] not in SUMMARY_FIELDS:
        raise ValueError('Unsupported measurement path')
    display, _, _ = measurement(data['metric'], value, units)
    return path[1].title(), display


def measurement(metric, value, units):
    imperial = units == 'imperial'
    scale, unit = {'distance': ((1/1609.344, 'mi') if imperial else (.001, 'km')),
                   'ascent': ((3.280839895, 'ft') if imperial else (1, 'm')),
                   'time': (1/60, 'min'), 'pace': ((1.609344, '/mi') if imperial else (1, '/km')),
                   'avg_hr': (1, 'bpm'), 'calories': (1, 'kcal'), 'workouts': (1, 'workouts')}[metric]
    shown = value*scale
    if metric == 'pace':
        seconds = round(abs(shown)); display = f'{seconds//60}:{seconds%60:02d}{unit}'
        if shown < 0: display = '−'+display
    else:
        display = f'{shown:.1f}'.rstrip('0').rstrip('.')+' '+unit
    return display, shown, unit


def claim_evidence(sentence, evidence):
    # An explicitly charted metric may use only the app's endpoint direction.
    # Other metrics/clauses still use the ordinary claim validator.
    records=[e for e in evidence if e.get('tool')==CHART_TOOL and 'error' not in e and 'error' not in e.get('data',{})]
    if len(records)!=1:return None
    ev=records[0];data=ev['data'];prose=re.sub(r'\{e[1-9][0-9]*:[0-7]\}', '',sentence).lower()
    aliases={'distance':r'distance','time':r'time|duration','pace':r'pace','ascent':r'climb|ascent|elevation',
             'avg_hr':r'heart rate','calories':r'calories','workouts':r'workouts|sessions'}
    if not re.search(r'\b(?:'+aliases[data['metric']]+r')\b',prose):return None
    directions={'up':r'rose|ris(?:e|ing)|increas\w*|higher|more',
                'down':r'fell|fall\w*|decreas\w*|lower|less',
                'flat':r'flat|same|unchanged', 'faster':r'faster|quicker','slower':r'slower'}
    found=[key for key,words in directions.items() if re.search(r'\b(?:'+words+r')\b',prose)]
    if not found:return None
    usable=[p for p in data['points'] if p['value'] is not None and p['n']>p['missing']]
    if len(usable)<3 or any(d!=data['summary']['direction'] for d in found):
        raise ValueError('Chart direction is not supported')
    if re.search(r'\b(better|worse|improv\w*|fitter|stronger|because|caus\w*|usual|typical|not)\b',prose):
        raise ValueError('Unsupported chart conclusion')
    # Never let a chart prove a different metric in the same clause.
    for metric,words in aliases.items():
        if metric!=data['metric'] and re.search(r'\b(?:'+words+r')\b',prose):return None
    return [{'evidence_id':ev['evidence_id'],'path':['summary','direction'],'relation':found[0]}]


def checked_chart(answer, evidence, result, *, weekly_review=False, question=None):
    ref=answer.chart
    if ref is None:
        if (not weekly_review and re.search(r'\b(?:chart|graph|plot)\b',question or '',re.I)
                and not re.search(r"\b(?:no|without|do not|don't) (?:a |the )?(?:chart|graph|plot)\b",question or '',re.I)
                and any(e.get('tool')==CHART_TOOL and 'error' not in e
                        and isinstance(e.get('data'),dict) and 'error' not in e['data'] for e in evidence)):
            raise ValueError('Requested chart reference is missing')
        return {}
    ev=next((e for e in evidence if e['evidence_id']==ref.evidence_id and 'error' not in e),None)
    if weekly_review or not ev or ev.get('tool')!=CHART_TOOL or 'error' in ev['data']:
        raise ValueError('Chart lacks permitted evidence')
    if any(f['tool']!=CHART_TOOL or f['evidence_id']!=ref.evidence_id for f in result['facts']):
        raise ValueError('Chart facts must cite its own summary')
    units=next((e['data'].get('units') for e in evidence if e.get('tool')=='profile' and 'error' not in e),None)
    if units not in ('metric','imperial'):raise ValueError('Account units unavailable')
    data=copy.deepcopy(ev['data'])
    if len(data['points'])>30:raise ValueError('Too many chart points')
    prose=' '.join(b.text if hasattr(b,'text') else ' '.join(b.items) for b in answer.blocks).lower()
    prose=re.sub(r'\{e[1-9][0-9]*:[0-7]\}','',prose)
    usable=[p for p in data['points'] if p['value'] is not None and p['n']>p['missing']]
    if len(usable)<3 and re.search(r'\b(trend|rose|fell|faster|slower|higher|lower|increas\w*|decreas\w*)\b',prose):
        raise ValueError('Too few chart points for a trend')
    if any(p['in_progress'] for p in data['points']) and 'so far' not in prose:
        raise ValueError('Unfinished chart needs so far')
    data['axis_unit']=measurement(data['metric'],0,units)[2]
    for point in data['points']:
        v=point['value']
        if v is not None and (type(v) not in (int,float) or not math.isfinite(v)):
            raise ValueError('Chart value must be finite')
        point['display_value'],point['plot_value']=measurement(data['metric'],v,units)[:2] if v is not None else ('Unknown',None)
    return {'chart':data,'garmin_included':bool(data.get('garmin_included'))}


def source_markers(evidence):
    return {'garmin_included':any(e.get('tool')==CHART_TOOL and 'error' not in e
            and e.get('data',{}).get('garmin_included') for e in evidence)}


def consent_still_valid(c,uid,answer):
    if not answer.get('garmin_included'):return True
    row=c.execute('SELECT garmin_ai_ok FROM profile WHERE user_id=%s',(uid,)).fetchone()
    return bool(row and row['garmin_ai_ok'])
