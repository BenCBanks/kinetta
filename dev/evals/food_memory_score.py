"""Independent, deliberately conservative checks for captured fictional food journeys."""
import math
import re


def words(text):
    return {w.rstrip('s') for w in re.findall(r'[^\W\d_]+',str(text).lower())}


def positive_phrase(text,phrase):
    for match in re.finditer(re.escape(phrase.lower()),text.lower()):
        if not re.search(r'\b(?:not|no|without|instead of)\s*$',text[max(0,match.start()-20):match.start()],re.I):return True
    return False


def evaluate(case,frame,fixtures):
    failures=[];observed=frame['foods'];raw=frame.get('raw_foods') or []
    allowed=case['intents']+(['unclear'] if case['needs_question'] else [])
    if frame.get('intent') not in allowed:failures.append('wrong_intent')
    if case['needs_question']:
        if not frame.get('question'):failures.append('missing_question')
        elif not words(frame.get('question_text',''))&{'what','which','choose','much','amount','portion','food','latte','saved','logged'}:failures.append('irrelevant_question')
    elif frame.get('question') and case['foods']:failures.append('unnecessary_question')
    if case['needs_question'] and observed:failures.append('resolved_food_before_needed_answer')
    if not case['needs_question'] and len(observed)!=len(case['foods']):failures.append('food_count')
    for expected in case['foods']:
        wanted={w.rstrip('s') for w in expected['words']}
        found=next((e for e in observed if wanted<=words(e['name'])),None)
        if not found:
            if not case['needs_question']:failures.append('missing_food:'+','.join(expected['words']))
            continue
        reference=expected.get('reference');actual=found.get('source')
        if reference and actual!=reference:failures.append('wrong_reference:'+reference)
        if reference is None and actual and not actual.startswith('ordinary:'):failures.append('unexpected_reference')
        analogue=expected.get('analogue')
        if analogue and words(found.get('analogue'))!=words(analogue):failures.append('wrong_analogue')
        if analogue is None and found.get('analogue'):failures.append('unexpected_analogue')
        if reference and actual==reference and not case['needs_question']:
            source=fixtures[reference]
            if source.get('items'):source={k:sum(fixtures[a][k] for a in source['items']) for k in ('kcal','protein_g','carbs_g','fat_g')}|{'amount':1}
            factor=expected['quantity']/source['amount'] if expected.get('quantity') is not None else 1
            for k in ('kcal','protein_g','carbs_g','fat_g'):
                value=source.get(k);want=round(value*factor,1) if value is not None else None;got=found['nutrition'].get(k)
                if (want is None)!=(got is None) or want is not None and not math.isclose(want,got,abs_tol=.00001):failures.append('copied_number:'+k)
        if analogue:
            if found.get('catalogue_source') not in ('usda','off'):failures.append('noncatalogue_analogue')
            if words(analogue)=={'banana','bread'} and expected.get('quantity') is not None:
                grams=expected['quantity'] if expected.get('unit')=='g' else expected['quantity']*50
                if not math.isclose(found['nutrition'].get('kcal') or -1,3*grams,abs_tol=.1):failures.append('analogue_portion')
        reads=[f for f in raw if wanted<=words(f.get('name'))]
        semantic=' '.join(' '.join(str(f.get(k) or '') for k in ('name','details','brand')) for f in reads)+' '+found.get('text','')
        if 'habit_ids' in expected:
            used={frame.get('preference_aliases',{}).get(x) for f in reads for x in f.get('habit_ids',[])}
            if used!=set(expected['habit_ids']):failures.append('habit_attribution')
        for term in expected.get('must_include') or []:
            if term not in words(semantic):failures.append('ignored_override_or_habit:'+term)
        if expected.get('must_include_any') and not any(phrase in semantic.lower() for phrase in expected['must_include_any']):failures.append('missing_habit_detail')
        for phrase in expected.get('must_exclude') or []:
            if positive_phrase(semantic,phrase):failures.append('contradicted_override:'+phrase)
        if expected.get('sugar_count') and not ('sugar' in words(semantic) and re.search(r'\b(?:2|two)\b',semantic,re.I)):failures.append('sugar_amount')
        if expected.get('quantity') is not None and not reference and not analogue:
            q=expected['quantity']
            expected_unit=expected.get('unit')
            if expected_unit and found.get('unit')!=expected_unit:failures.append('ordinary_unit')
            if not math.isclose(found['amount'],q,abs_tol=.001):failures.append('ordinary_portion')
    if case['foods'] and not case['needs_question'] and frame.get('day') is None:failures.append('missing_day')
    if frame.get('day') is not None and frame['day']!=case.get('expected_day','2026-11-01'):failures.append('moved_day')
    if case.get('expected_meal') and frame.get('meal')!=case['expected_meal']:failures.append('wrong_meal')
    if not frame.get('rows_unchanged',True):failures.append('premature_write_or_source_mutation')
    if not frame.get('old_cards_unchanged',True):failures.append('changed_unselected_card')
    if frame.get('foreign_disclosure'):failures.append('foreign_disclosure')
    if frame.get('revocation_failed'):failures.append('memory_revocation')
    return {'passed':not failures,'failures':sorted(set(failures)),'observed':observed,'pending_question':bool(frame.get('question'))}
