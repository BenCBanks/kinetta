"""Fast, owner-scoped reuse for food logged in the last 30 minutes."""
import datetime as dt
import re

from fastapi import HTTPException

from . import db, food_thread, food_thread_log as engine, meal_chat

WINDOW = dt.timedelta(minutes=30)
REPEAT = re.compile(r'^(?:another|one more|again|same(?: as)?|a second)\b(.*)$')
HALF_MORE = re.compile(r'^half\s+(?:a\s+)?(?:piece|slice|portion|serving|cup|bite|spoonful)\s+more\b(.*)$')
COUNTS = {**meal_chat.COUNTS, **meal_chat.SHARES}
QUANTITY_WORDS = {'and', 'a', 'an', 'half'}
REPEAT_FILLER = meal_chat.FILLER | meal_chat.UNITS | meal_chat.SPLIT | {'more'}


def _name_words(text):
    return {word for word in meal_chat.name_words(text) if word not in REPEAT_FILLER}


def parse_repeat(text):
    """Return (scale, food words), or None when the phrase changes the food."""
    normalized = meal_chat.norm(text).strip()
    if not normalized or re.search(r'\bbut\b', normalized):
        return None
    normalized = re.sub(r'^(?:i|we)\s+(?:had|ate|drank)\s+', '', normalized)
    half = HALF_MORE.match(normalized)
    if half:
        return .5, _name_words(half.group(1))
    match = REPEAT.match(normalized)
    if not match:
        return None
    rest = match.group(1).strip()
    tokens = meal_chat.raw(rest)
    scale = 1.0
    if tokens:
        first = tokens[0]
        number = COUNTS[first] if first in COUNTS else meal_chat.number(first) if first[0].isdigit() else None
        if number is not None:
            scale = number
            tokens = tokens[1:]
            if tokens[:2] == ['and', 'a'] and len(tokens) > 2 and tokens[2] == 'half':
                scale += .5
                tokens = tokens[3:]
            elif tokens and tokens[0] == 'and' and len(tokens) > 1 and tokens[1] == 'a':
                tokens = tokens[2:]
        elif first in ('half', 'quarter', 'third'):
            scale = COUNTS[first]
            tokens = tokens[1:]
    words = _name_words(' '.join(tokens))
    if not (scale > 0 and scale <= 100):
        return None
    return scale, words


def _root_id(row):
    if row.get('origin_id') is not None:
        return ('message', int(row['origin_id']))
    client_id = str(row.get('client_id') or '')
    if re.search(r'-\d{2}$', client_id):
        return ('client', re.sub(r'-\d{2}$', '', client_id))
    return ('entry', int(row['id']))


def _all_linked_rows(c, uid, root_id, day, meal, lock=False):
    sql = '''SELECT e.* FROM food_chat_entries l JOIN food_entries e
             ON e.id=l.entry_id AND e.user_id=l.user_id
             WHERE l.user_id=%s AND l.message_id=%s AND e.day=%s AND e.meal=%s
             ORDER BY e.position,e.id'''
    if lock:
        sql += ' FOR UPDATE OF e'
    return c.execute(sql, (uid, root_id, day, meal)).fetchall()


def recent_groups(c, uid, day, meal, *, lock=False):
    """Recent rows become groups only when their full linked message was logged recently."""
    cutoff = dt.datetime.now(dt.timezone.utc) - WINDOW
    now = dt.datetime.now(dt.timezone.utc)
    sql = '''SELECT e.*,
                    (SELECT m.id FROM food_chat_entries l JOIN food_chat_messages m
                       ON m.id=l.message_id AND m.user_id=l.user_id
                     WHERE l.user_id=e.user_id AND l.entry_id=e.id AND m.kind='user'
                     ORDER BY m.id DESC LIMIT 1) AS origin_id
             FROM food_entries e
             WHERE e.user_id=%s AND e.day=%s AND e.meal=%s
               AND e.created>=now()-interval '30 minutes' AND e.created<=now()
             ORDER BY e.created DESC,e.position,e.id LIMIT 300'''
    if lock:
        sql += ' FOR UPDATE OF e'
    rows = c.execute(sql, (uid, day, meal)).fetchall()
    grouped = {}
    for row in rows:
        key = _root_id(row)
        group = grouped.setdefault(key, {'key': key, 'rows': [], 'created': row['created']})
        group['rows'].append(row)
        group['created'] = max(group['created'], row['created'])

    result = []
    for key, group in grouped.items():
        if key[0] == 'message':
            complete = _all_linked_rows(c, uid, key[1], day, meal, lock=lock)
            if not complete or any(r['created'] < cutoff or r['created'] > now for r in complete):
                continue
            group['rows'] = complete
            group['created'] = max(r['created'] for r in complete)
        else:
            group['rows'].sort(key=lambda row: (row['position'], row['id']))
        group['ids'] = [int(r['id']) for r in group['rows']]
        group['day'] = group['rows'][0]['day']
        group['meal'] = group['rows'][0]['meal']
        group['words'] = set().union(*(_name_words(r['name']) for r in group['rows']))
        group['label'] = _display(group['rows'])
        result.append(group)
    return sorted(result, key=lambda group: (group['created'], max(group['ids'])), reverse=True)


def _display(rows):
    names = list(dict.fromkeys(str(row['name']).strip() for row in rows if str(row['name']).strip()))
    if not names:
        return 'food'
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f'{names[0]} with {names[1]}'
    return f"{', '.join(names[:-1])} and {names[-1]}"


def suggestion(group):
    return {'entry_id': group['ids'][0], 'day': str(group['day']), 'meal': group['meal'],
            'created': group['created'].isoformat(), 'label': group['label']}


def _choice(group, refs):
    return {'entry_id': group['ids'][0], 'ids': group['ids'], 'expected': refs.stamp(group['rows']),
            'created': group['created'].isoformat(), 'label': group['label'],
            'day': str(group['day']), 'meal': group['meal']}


def _question(c, uid, message, groups, day, meal, scale):
    from . import food_thread_refs as refs
    selected = [_choice(group, refs) for group in groups[:5]]
    choices = [{'name': item['label'], 'created': item['created']} for item in selected]
    result = {'kind': 'needs', 'text': 'Which one did you mean?', 'source': 'your food log',
              'correction': 'recent_reuse', 'recent_reuse': True,
              'reference': {'kind': 'recent_reuse', 'groups': selected, 'scale': scale,
                            'day': str(day), 'meal': meal},
              'choices': choices, 'day': str(day), 'meal': meal,
              'as_of': dt.datetime.now(dt.timezone.utc).isoformat()}
    return food_thread.finish_reply(c, uid, message, result)


def _copy(c, uid, message, group, day, meal, scale):
    from . import food_thread_refs as refs
    result = {'kind': 'needs', 'day': str(day), 'meal': meal,
              'reference': {'kind': 'copy', 'ids': group['ids'],
                            'expected': refs.stamp(group['rows']), 'scale': scale},
              'same_as': group['created'].isoformat(), 'reuse_label': f"Another {group['label']}",
              'source': 'your food log'}
    prefs = food_thread.preferences(c, uid) or {}
    if prefs.get('auto_log', True):
        # The explicit repeat request is confirmation, while the root keeps its original replay metadata.
        result['fast_reuse'] = True
    return refs.choose(c, uid, message, result)


def process(uid, mid):
    from . import food_thread_refs as refs
    with db.connect() as c:
        probe = c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE id=%s AND user_id=%s',
                          (mid, uid)).fetchone()
        if not probe:
            return None
        metadata = probe.get('result') or {}
        parsed = parse_repeat(probe['body'])
        repeat_entry_id = metadata.get('repeat_entry_id')
        if not parsed or probe['kind'] != 'user' or (metadata.get('input') or {}).get('kind', 'text') != 'text':
            return None
        if probe['state'] == 'answered':
            message = engine.locked_message(c, uid, mid)
            return food_thread.answer_with(c, uid, message)
        if probe['state'] != 'pending':
            return None
        scale, words = parsed
        message = engine.locked_message(c, uid, mid)
        if message['state'] != 'pending':
            return food_thread.answer_with(c, uid, message) if message['state'] == 'answered' else None
        destination = (message.get('result') or {}).get('destination') or {}
        day = dt.date.fromisoformat(destination['day']) if destination.get('day') else message['local_day']
        meal = destination.get('meal') or engine.expected_meal(c, uid, message['captured_at'])
        groups = recent_groups(c, uid, day, meal, lock=True)
        if repeat_entry_id is not None:
            groups = [group for group in groups if int(repeat_entry_id) in group['ids']]
        elif words:
            groups = [group for group in groups if words <= group['words']]
        if not groups:
            return None
        if len(groups) > 1:
            return _question(c, uid, message, groups, day, meal, scale)
        return _copy(c, uid, message, groups[0], day, meal, scale)


def choose(c, uid, message, result, select):
    from . import food_thread_refs as refs
    reference = result.get('reference') or {}
    choices = reference.get('groups') or []
    if select is None or not 0 <= select < len(choices):
        raise HTTPException(422, 'Choose one of the recent foods')
    chosen = choices[select]
    day = dt.date.fromisoformat(reference['day'])
    meal = reference['meal']
    fresh = recent_groups(c, uid, day, meal, lock=True)
    group = next((item for item in fresh if int(chosen['entry_id']) in item['ids']), None)
    if not group or group['ids'] != chosen['ids'] or refs.stamp(group['rows']) != chosen['expected']:
        raise HTTPException(409, 'That recent food changed. Send “another one” to choose again.')
    copied = {'kind': 'needs', 'day': str(day), 'meal': meal,
              'reference': {'kind': 'copy', 'ids': group['ids'],
                            'expected': refs.stamp(group['rows']), 'scale': reference.get('scale', 1)},
              'same_as': group['created'].isoformat(), 'reuse_label': f"Another {group['label']}",
              'source': 'your food log'}
    prefs = food_thread.preferences(c, uid) or {}
    if prefs.get('auto_log', True):
        copied['fast_reuse'] = True
    return refs.choose(c, uid, message, copied)
