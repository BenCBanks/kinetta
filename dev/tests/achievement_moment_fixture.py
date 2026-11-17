"""Seed one fictional weekly big-tier moment for the guarded Activity screenshot test."""
import datetime as dt
import os
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from app import db, api_achievements


def canonical_level(track_code, title):
    definition = api_achievements._level_catalog().get('tracks', {}).get(track_code) or {}
    matches = [(rank, level) for rank, level in enumerate(definition.get('levels') or (), 1)
               if level.get('name') == title]
    assert len(matches) == 1, f'{track_code} fixture level {title!r} must appear exactly once in the canonical catalog'
    rank, level = matches[0]
    threshold = api_achievements._canonical_threshold(level)
    assert threshold > 0, f'{track_code}/{title} fixture threshold must be positive'
    return {'track': track_code, 'rank': rank, 'threshold': threshold,
            'label': title, 'unit': level.get('canonical_unit')}


journey_level = canonical_level('journey', 'Across the US')
climbing_level = canonical_level('climbing', 'Cruising altitude')
journey_value_m = round(journey_level['threshold'] * 1.5)
journey_catalog_levels = api_achievements._level_catalog()['tracks']['journey']['levels']
journey_next = (api_achievements._canonical_threshold(journey_catalog_levels[journey_level['rank']])
                if journey_level['rank'] < len(journey_catalog_levels) else None)
assert journey_value_m >= journey_level['threshold'], 'Journey state reaches the showcased canonical level'
assert journey_next is None or journey_value_m < journey_next, 'Journey state stays below the next canonical level'


with db.connect() as c:
    person = c.execute('''SELECT u.id,p.tz FROM users u JOIN profile p ON p.user_id=u.id
                          WHERE u.login='zz_test_feed_friend1' ''').fetchone()
    if not person:
        raise RuntimeError('Run the guarded activity fixture first.')
    owner_id = person['id']
    zone = ZoneInfo(person['tz'] or 'UTC')
    # This fixture is piped into the app container with ``python -``; its
    # __file__ is therefore not the checked-out repository path. The browser
    # harness passes the same fixed instant explicitly, with a deterministic
    # fallback for direct fixture runs.
    fixture_instant=os.environ.get('KINETTA_FIXTURE_INSTANT','2026-11-09T17:00:00Z')
    occurred = dt.datetime.fromisoformat(fixture_instant.replace('Z','+00:00')) - dt.timedelta(minutes=8)
    day = occurred.astimezone(zone).date()
    since = occurred - dt.timedelta(minutes=5)
    c.execute("DELETE FROM milestones WHERE user_id=%s AND code LIKE 'test-sharing:%%'", (owner_id,))
    c.execute('UPDATE profile SET share_achievements=true,share_achievements_since=%s WHERE user_id=%s',
              (since, owner_id))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-state','track_state','Journey',0,%s,%s,%s)''',
              (owner_id, day, occurred, Jsonb({'track':'journey','value_m':journey_value_m,'label':'Journey','unit':journey_level['unit']})))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-big','track',%s,%s,%s,%s,%s),
                 (%s,'test-sharing:climbing-big','track',%s,%s,%s,%s,%s)''',
              (owner_id, journey_level['label'], journey_level['rank'], day, occurred,
               Jsonb({**journey_level, 'big':True}),
               owner_id, climbing_level['label'], climbing_level['rank'], day, occurred,
               Jsonb({**climbing_level, 'big':True})))
    c.execute("UPDATE users SET name='River Friend 1 With a Long Fictional Name' WHERE id=%s", (owner_id,))
    seeded = c.execute("""SELECT code,title,rank,details FROM milestones WHERE user_id=%s
                            AND code IN ('test-sharing:journey-state','test-sharing:journey-big','test-sharing:climbing-big')""",
                       (owner_id,)).fetchall()
    by_code = {row['code']: row for row in seeded}
    assert set(by_code) == {'test-sharing:journey-state','test-sharing:journey-big','test-sharing:climbing-big'}, 'fixture seeds all three expected fictional milestone states'
    assert by_code['test-sharing:journey-big']['title'] == journey_level['label'] and by_code['test-sharing:journey-big']['rank'] == journey_level['rank'] and by_code['test-sharing:journey-big']['details']['threshold'] == journey_level['threshold'], 'Journey milestone persists its canonical level, rank and threshold'
    assert by_code['test-sharing:climbing-big']['title'] == climbing_level['label'] and by_code['test-sharing:climbing-big']['rank'] == climbing_level['rank'] and by_code['test-sharing:climbing-big']['details']['threshold'] == climbing_level['threshold'], 'Climbing milestone persists its canonical level, rank and threshold'
    assert by_code['test-sharing:journey-state']['details']['value_m'] == journey_value_m, 'Journey state fixture persists a canonical-level-qualified value'
print('Fictional big-tier moment ready for the 390px Activity capture.')
