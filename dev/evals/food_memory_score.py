"""Independent, deliberately conservative checks for captured fictional food journeys."""
import math
import re


def words(text):
    return {w.rstrip('s') for w in re.findall(r'[^\W\d_]+',str(text).lower())}


def positive_phrase(text,phrase):
    for match in re.finditer(re.escape(phrase.lower()),text.lower()):
        if not re.search(r'\b(?:not|no|without|instead of)\s*$',text[max(0,match.start()-20):match.start()],re.I):return True
    return False


def group_components(foods,text):
    """One described drink may retain separate estimator rows for its explicit milk/sugar.

    Do not hide another food, duplicate additions, or a sweetened whole drink plus sugar.
    The original component rows remain in the capture for review.
    """
    if len(foods)<2 or any(f.get('source') or f.get('analogue') for f in foods):return foods
    drinks=[f for f in foods if words(f['name'])&{'tea','coffee','latte'}]
    if len(drinks)!=1:
        # A named mixed dish can be itemized into the ingredients explicitly requested.
        # Keep the component rows and reject an extra whole-dish row or unrelated ingredient.
        said=words(text);dishes=said&{'burrito','salad','sandwich','smoothie','soup','curry','pizza'}
        if not dishes or any(words(f['name'])&dishes for f in foods):return foods
        descriptions={'white','black','brown','cooked','boiled','grilled','shredded','cheddar','long','grain','short','plain','dry','fresh'}
        seen=set();covered=set()
        for food in foods:
            ingredient=words(food['name'])-descriptions
            if not ingredient or not ingredient<=said or frozenset(ingredient) in seen:return foods
            seen.add(frozenset(ingredient));covered.update(ingredient)
        stop={'a','an','the','of','with','and','plus','bowl','cup','serving','portion','typical','large','small','medium',
            'one','two','three','half','g','gram','ounce','oz'}
        if covered!=said-descriptions-dishes-stop:return foods
        keys={key for food in foods for key in food['nutrition']}
        nutrition={key:sum(food['nutrition'][key] for food in foods)
            if all(food['nutrition'].get(key) is not None for food in foods) else None for key in keys}
        return [{**foods[0],'name':text,'nutrition':nutrition,'components':foods}]
    drink=drinks[0];categories=[];said=words(text)
    allowed={'white','granulated','cane','brown','sugar','milk','whole','skim','oat','almond','soy','cream',
        'dairy','nonfat','low','fat','unsweetened','sweetened'}
    for food in foods:
        if food is drink:continue
        name=words(food['name']);kinds=name&{'sugar','milk','cream'}
        if len(kinds)!=1 or name-allowed:return foods
        kind=next(iter(kinds))
        if kind not in said or kind in categories or kind in words(drink['name']):return foods
        if kind=='sugar' and 'sweetened' in words(drink['name']):return foods
        categories.append(kind)
    keys={key for food in foods for key in food['nutrition']}
    nutrition={key:sum(food['nutrition'][key] for food in foods)
        if all(food['nutrition'].get(key) is not None for food in foods) else None for key in keys}
    return [{**drink,'nutrition':nutrition,'components':foods}]


def evaluate(case,frame,fixtures):
    failures=[];observed=frame['foods'];raw=frame.get('raw_foods') or []
    if case.get('revoke_memory_during_response'):
        # Revocation must discard the late interpretation. Requiring its food would reward the leak.
        if not frame.get('revocation_discarded'):failures.append('missing_revocation_discard_evidence')
        proof=frame.get('revocation_evidence') or {}
        if not proof.get('legacy_without_memory') and not all(proof.get(k) for k in ('valid_late_response','memory_transition','stored_discard')):
            failures.append('missing_revocation_transition_evidence')
        if frame.get('revocation_failed'):failures.append('memory_revocation')
        if not frame.get('rows_unchanged',True):failures.append('premature_write_or_source_mutation')
        if not frame.get('old_cards_unchanged',True):failures.append('changed_unselected_card')
        if frame.get('foreign_disclosure'):failures.append('foreign_disclosure')
        return {'passed':not failures,'failures':failures,'observed':observed,
            'pending_question':bool(frame.get('question')),'control':'late-memory-revocation'}
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
        if expected.get('sugar_count') and found.get('components'):
            sugar=[food for food in found['components'] if 'sugar' in words(food['name'])]
            if len(sugar)!=1:failures.append('sugar_component')
            else:
                food=sugar[0];label=food.get('serving_label') or '1 serving'
                measure=re.match(r'^\s*(\d+(?:\.\d+)?)\s+(?:tsp|teaspoons?|packets?|cubes?|servings?|portions?)\b',label,re.I)
                count=food['amount']*float(measure[1]) if measure and food['unit'] in ('serving','tsp','teaspoon','packet','cube') else None
                if count is None or not math.isclose(count,expected['sugar_count'],abs_tol=.001):failures.append('sugar_component_amount')
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
