"""Deterministic checks at publication boundaries, never on private notes or food logs."""
import json
import re
import unicodedata
from pathlib import Path
from fastapi import HTTPException
from . import community_terms

WORDS = json.loads(Path(__file__).with_suffix('.json').read_text())['words']
LETTERS = {'a': '[a4@]', 'e': '[e3]', 'i': '[i1!]', 'o': '[o0]', 's': '[s5$]', 't': '[t7]'}
# Match variants per letter, keeping punctuation as a boundary ("fuck@" must still match).
# At most three separators between letters; longer ordinary words are not matched.
PATTERNS = [re.compile(r'(?<![a-z0-9])' + r'[\W_]{0,3}'.join(LETTERS.get(c, re.escape(c)) for c in word)
                       + r'(?:s|es|er|ers|ing|ed)?(?![a-z0-9])') for word in WORDS]


def check(text, field='text'):
    value = ''.join(c for c in unicodedata.normalize('NFKD', str(text or '')).casefold()
                    if unicodedata.category(c) not in ('Mn', 'Cf'))
    if field == 'username': value = re.sub(r'[0-9]+$', '', value)
    if any(pattern.search(value) for pattern in PATTERNS):
        raise HTTPException(400, f"That {field} includes words that aren't allowed on Kinetta. Please change it.")


def public(c, uid, *fields):
    community_terms.require_accepted(c, uid)
    for label, text in fields:
        check(text, label)


def activity(c, uid, row, profile=None, publishing=False):
    if row.get('visibility', 'everyone') == 'me':
        return
    if profile is None:
        profile = c.execute('SELECT share_details FROM profile WHERE user_id=%s', (uid,)).fetchone() or {}
    from .api_social import details_of
    fields = [('activity title', row.get('name')), ('activity type', row.get('sport_label'))]
    if details_of(profile.get('share_details'), row.get('share_details'))['description']:
        fields.append(('activity description', row.get('description')))
    if publishing and row.get('id'):
        fields += [('comment', comment['text']) for comment in c.execute('SELECT cm.text FROM comments cm JOIN activities a ON a.id=cm.activity_id WHERE a.id=%s AND a.user_id=%s', (row['id'],uid)).fetchall()]
    public(c, uid, *fields)
