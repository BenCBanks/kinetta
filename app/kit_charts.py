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


def checked_chart(answer, evidence, result, *, weekly_review=False):
    ref=answer.chart
    if ref is None:return {}
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
