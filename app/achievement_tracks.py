"""Pure rules and labels for the activity achievement tracks.

The worker stores distances in metres and lifting volume in kilograms. This
module deliberately has no database or web dependencies so the threshold and
tail rules can be tested without a history scan or a running server.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Tier:
    """One earned (or next) level in a track."""

    rank: int
    threshold: float
    label: str
    unit: str
    big: bool = False

    def as_dict(self) -> dict:
        return {
            'rank': self.rank,
            'threshold': self.threshold,
            'label': self.label,
            'unit': self.unit,
            'big': self.big,
        }


# The catalog in profile.achievement-levels.json is the presentation source;
# these rules mirror its canonical thresholds and tail behavior.
JOURNEY_LANDMARKS = (
    ('Marathon', 42_195.0),
    ('Ironman 70.3', 113_137.0),
    ('Ironman 140.6', 226_274.0),
    ('Length of Britain', 1_406_567.0),
    ('Across the US', 4_506_163.0),
    ('Length of Africa', 8_046_720.0),
    ('Around Australia', 14_484_096.0),
    ('Around Earth', 40_074_275.0),
    ('To the Moon', 384_399_861.0),
)
CLIMBING_LEVELS = (
    ('Ben Nevis', 1_345.1),
    ('Mount Fuji', 3_775.9),
    ('Mont Blanc', 4_807.9),
    ('Kilimanjaro', 5_895.1),
    ('Denali', 6_190.5),
    ('Aconcagua', 6_961.0),
    ('Everest', 8_849.0),
    ('Cruising altitude', 10_668.0),
    ('Edge of the sky', 18_897.6),
    ('Edge of space', 100_000.0),
)
LIFT_EQUIVALENTS = (
    ('A car', 1_497.0),
    ('An elephant', 5_897.0),
    ('A school bus', 11_340.0),
    ('A loaded semi truck', 36_287.0),
    ('A blue whale', 149_685.0),
    ('Statue of Liberty', 204_117.0),
    ('A jumbo jet', 396_893.0),
    ('A heavy-lift rocket', 2_041_166.0),
    ('Eiffel Tower', 9_979_032.0),
    ('Titanic', 52_163_123.0),
)

CONSISTENCY_LEVELS = (4, 10, 20, 52, 100, 150, 200, 250, 300, 350)
CONSISTENCY_LABELS = (
    'Spark', 'Kindling', 'Steady flame', 'Bonfire',
    'Campfire circle', 'Volcano', 'Solar flare', 'North Star', 'Constellation', 'Galaxy',
)
YEARS_ACTIVE_LEVELS = (1, 2, 3, 4, 5, 10, 25, 50, 100)
YEARS_ACTIVE_LABELS = (
    'First orbit', 'Comet', 'Three-peat', 'Olympiad', 'High five', 'Decade',
    'Silver jubilee', 'Golden jubilee', 'Century',
)
WORKOUT_LEVELS = (10, 50, 100, 250, 500, 1_000, 1_500, 2_000)
WORKOUT_LABELS = (
    'Seed', 'Sprout', 'Sapling', 'Young tree',
    'Evergreen', 'Grove', 'Forest', 'Old-growth forest',
)
ACTIVE_TIME_HOURS = (10, 24, 100, 250, 500, 1_000, 2_000, 10_000)
ACTIVE_TIME_LABELS = (
    'First ten hours', 'Round the clock', 'Four days moving', 'Six workweeks',
    'A season of effort', 'Half a working year', 'A working year', 'Mastery (10,000 hours)',
)
PERSONAL_BEST_LEVELS = (1, 5, 10, 25, 50, 75, 100, 150)
PERSONAL_BEST_LABELS = (
    'First record', 'On a roll', 'Record keeper', 'Hall of fame', 'Record shelf',
    'Record library', 'Record constellation', 'Legend',
)

# Phase 1 per-sport tracks (#921). Counts use completed activity rows; longest
# tracks use the maximum distance of one completed activity, never a lifetime
# sum. Distances remain canonical metres in worker state.
SPORT_WORKOUT_LEVELS = {
    'run': (("First stride", 1), ("Training block", 10), ("Local circuit", 50),
            ("Race season", 100), ("Starting line regular", 250), ("Club veteran", 500),
            ("Road legend", 1_000), ("Running institution", 2_000)),
    'ride': (("First spin", 1), ("Weekend rider", 10), ("Club loop", 50),
             ("Century season", 100), ("Gran fondo regular", 250), ("Club veteran", 500),
             ("Road captain", 1_000), ("Cycling institution", 2_000)),
    'walk-hike': (("First steps", 1), ("Trail regular", 10), ("Day hiker", 50),
                  ("Woodland walker", 100), ("Summit seeker", 250), ("Long-distance walker", 500),
                  ("Trail institution", 1_000), ("Appalachian veteran", 2_000)),
    'swim': (("First length", 1), ("Lane regular", 10), ("Pool season", 50),
             ("Open-water regular", 100), ("Long-course swimmer", 250), ("Channel hopeful", 500),
             ("Marathon swimmer", 1_000), ("Blue-water legend", 2_000)),
}
SPORT_LONGEST_LEVELS = {
    'run': (("5K outing", 5_000), ("10K day", 10_000), ("Half-marathon day", 21_097.5),
            ("Marathon day", 42_195), ("50K ultra", 50_000), ("50-mile ultra", 80_467.2),
            ("100K ultra", 100_000), ("100-mile ultra", 160_934.4)),
    'ride': (("25K ride", 25_000), ("50K ride", 50_000), ("Metric century", 100_000),
             ("Century ride", 160_934.4), ("200K ride", 200_000), ("Double century", 321_868.8),
             ("300-mile ride", 482_803.2), ("1,000K ride", 1_000_000)),
    'walk-hike': (("10K walk", 10_000), ("Half-marathon walk", 21_097.5), ("Marathon walk", 42_195),
                  ("50K trail day", 50_000), ("50-mile hike", 80_467.2), ("100K trail day", 100_000),
                  ("100-mile hike", 160_934.4), ("200-mile trek", 321_868.8)),
    'swim': (("First mile", 1_609.344), ("Ironman swim", 3_862.68), ("5K swim", 5_000),
             ("Marathon swim", 10_000), ("10-mile swim", 16_093.44), ("English Channel", 33_796.224),
             ("25-mile swim", 40_233.6), ("50K swim", 50_000)),
}

# Phase 2 fastest-effort track (#921). Each level is one exact, recorded
# standard effort. The worker credits it only from a matching best_efforts row;
# it never predicts or stretches a result to another distance.
RUN_FASTEST_LEVELS = (
    ('Park mile', 1_609.344, 10 * 60),
    ('Mile marker', 1_609.344, 8 * 60),
    ('Five-K foothold', 5_000.0, 30 * 60),
    ('Five-K club', 5_000.0, 25 * 60),
    ('Ten-K standard', 10_000.0, 60 * 60),
    ('Ten-K pace', 10_000.0, 50 * 60),
    ('Halfway banner', 21_097.5, 2 * 60 * 60 + 15 * 60),
    ('Half-marathon flight', 21_097.5, 1 * 60 * 60 + 45 * 60),
)
RIDE_FASTEST_LEVELS = (
    ('Ten-K tempo', 10_000.0, 36 * 60), ('Ten-K push', 10_000.0, 30 * 60),
    ('Ten-K flight', 10_000.0, 24 * 60), ('Twenty-K tempo', 20_000.0, 72 * 60),
    ('Twenty-K push', 20_000.0, 60 * 60), ('Twenty-K flight', 20_000.0, 48 * 60),
    ('Forty-K tempo', 40_000.0, 2 * 60 * 60 + 24 * 60),
    ('Forty-K push', 40_000.0, 2 * 60 * 60), ('Forty-K flight', 40_000.0, 1 * 60 * 60 + 36 * 60),
)
SWIM_FASTEST_LEVELS = (
    ('Pool hundred', 100.0, 2 * 60 + 30), ('Fast hundred', 100.0, 2 * 60),
    ('Flying hundred', 100.0, 1 * 60 + 30), ('Four-hundred rhythm', 400.0, 10 * 60),
    ('Four-hundred push', 400.0, 8 * 60), ('Four-hundred flight', 400.0, 6 * 60 + 30),
    ('Fifteen-hundred rhythm', 1_500.0, 40 * 60), ('Fifteen-hundred push', 1_500.0, 32 * 60),
    ('Fifteen-hundred flight', 1_500.0, 24 * 60),
)
FASTEST_EFFORT_LEVELS = {
    'run': RUN_FASTEST_LEVELS, 'ride': RIDE_FASTEST_LEVELS, 'swim': SWIM_FASTEST_LEVELS,
}
SPORT_TRACK_LABELS = {
    'run': 'Run', 'ride': 'Ride', 'walk-hike': 'Walk & hike', 'swim': 'Swim',
}


def sport_phase1_spec(code):
    """Return (sport, family, levels) for a #921 phase-1 track code."""
    if not isinstance(code, str) or not code.startswith('sport:'):
        return None
    parts = code.split(':')
    if len(parts) != 3 or parts[1] not in SPORT_TRACK_LABELS or parts[2] not in ('workouts', 'longest'):
        return None
    family = parts[2]
    levels = SPORT_WORKOUT_LEVELS[parts[1]] if family == 'workouts' else SPORT_LONGEST_LEVELS[parts[1]]
    return parts[1], family, levels


def fastest_effort_spec(code):
    """Return exact recorded-effort criteria for a fastest ladder."""
    if not isinstance(code, str) or not code.startswith('sport:') or not code.endswith(':fastest'):
        return None
    return FASTEST_EFFORT_LEVELS.get(code.split(':')[1])


def fastest_effort_sport(code):
    """Return the source sport for an exact fastest-effort ladder."""
    if fastest_effort_spec(code) is None:
        return None
    return code.split(':')[1]

# Legacy first-activity milestones remain readable, but are not canonical track
# levels. The canonical sport ladders begin at their first named distance.
LEGACY_FIRST_ACTIVITY_LABELS = {
    'sport:run': 'First run',
    'sport:ride': 'First ride',
    'sport:walk-hike': 'First walk',
    'sport:swim': 'First swim',
}
SPORT_DISTANCE_LEVELS = {
    'run': (5_000.0, 10_000.0, 21_097.5, 42_195.0, 80_467.0,
            160_934.0, 402_336.0, 804_672.0, 1_609_344.0),
    'ride': (16_093.0, 40_234.0, 100_000.0, 160_934.0, 402_336.0,
             804_672.0, 1_609_344.0, 4_506_163.0),
    'walk-hike': (5_000.0, 10_000.0, 21_097.5, 42_195.0, 80_467.0,
                  160_934.0, 402_336.0, 804_672.0, 3_524_463.0),
    'swim': (1_609.0, 3_862.0, 10_000.0, 33_796.0, 80_467.0,
             160_934.0, 402_336.0, 804_672.0),
}
SPORT_DISTANCE_LABELS = {
    'run': ('5K', '10K', 'Half marathon', 'Marathon', '50-mile ultra',
            '100 miles', '250 miles', '500 miles', '1,000 miles'),
    'ride': ('First 10 miles', '25 miles', 'Metric century', 'Century',
             '250 miles', '500 miles', '1,000 miles', 'Coast to coast'),
    'walk-hike': ('5K', '10K', 'Half marathon', 'Marathon', '50 miles',
                  '100 miles', '250 miles', '500 miles', 'Appalachian Trail'),
    'swim': ('First mile', 'Ironman swim', 'Marathon swim (10K)',
             'English Channel', '50 miles', '100 miles', '250 miles', '500 miles'),
}

# The removed entries are exact read aliases only. They never participate in
# rank, next-tier, worker, or backfill calculations.
LEGACY_STARTER_LEVELS = {
    'consistency': (('First week', 1.0), ('Pilot light', 2.0)),
    'workouts': (('First workout', 1.0), ('Sprig', 5.0)),
    'active_time': (('First hour', 3_600.0), ('Movie marathon', 18_000.0)),
    'journey': (('Round the town', 10_000.0), ('Across the city', 21_097.5)),
    'climbing': (('Rooftop', 100.0), ('Hilltop', 400.0)),
    'lifted': (('A grand piano', 500.0),),
    'sport:run': (('First mile', 1_609.344),),
    'sport:ride': (('Quick spin', 5_000.0),),
    'sport:walk-hike': (('First mile', 1_609.344),),
    'sport:swim': (('Splash', 500.0),),
}
SPORT_LIFT_LEVELS = (
    ('First set', 1.0), ('Warmed up', 5.0), ('Ten sessions', 10.0),
    ('Strong foundation', 25.0), ('Strength cycle', 50.0), ('Power block', 100.0),
    ('Iron habit', 200.0), ('Strength hall', 400.0),
)

# All levels up to these ranks are quiet in the friend feed and push path. This
# single helper keeps the rule shared across families and sports.
QUIET_LEVEL_COUNTS = {
    'consistency': 2,
    'workouts': 2,
    'active_time': 2,
    'journey': 2,
    'climbing': 2,
    'lifted': 1,
    'sport:run': 2,
    'sport:ride': 2,
    'sport:walk-hike': 2,
    'sport:swim': 2,
}


def is_quiet_level(code: str, rank: int) -> bool:
    return 1 <= int(rank or 0) <= QUIET_LEVEL_COUNTS.get(code, 0)


def level_trigger(code: str, rank: int) -> str | None:
    return None


def legacy_starter_tier(code: str, threshold=None, *, trigger=None) -> Tier | None:
    """Return a display-only prior award; it has no current canonical rank."""
    if trigger == 'first_activity' and code in LEGACY_FIRST_ACTIVITY_LABELS:
        label = LEGACY_FIRST_ACTIVITY_LABELS[code]
        return Tier(0, 1.0, label, 'm', False)
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(threshold):
        return None
    for label, prior_threshold in LEGACY_STARTER_LEVELS.get(code, ()):
        if math.isclose(threshold, prior_threshold, rel_tol=1e-12, abs_tol=1e-6):
            return Tier(0, prior_threshold, label, TRACK_UNITS.get(code, 'count'), False)
    return None


TRACK_LABELS = {
    'consistency': 'Consistency',
    'years_active': 'Years active',
    'workouts': 'Workouts',
    'active_time': 'Active time',
    'journey': 'Journey',
    'climbing': 'Climbing',
    'lifted': 'Lifted',
    'personal_bests': 'Personal bests',
    'sport:run': 'Run',
    'sport:ride': 'Ride',
    'sport:walk-hike': 'Walk & hike',
    'sport:swim': 'Swim',
    'sport:lift': 'Lift',
}

for _sport, _label in SPORT_TRACK_LABELS.items():
    TRACK_LABELS[f'sport:{_sport}:workouts'] = f'{_label} workouts'
    TRACK_LABELS[f'sport:{_sport}:longest'] = {
        'run': 'Longest run', 'ride': 'Longest ride',
        'walk-hike': 'Longest walk or hike', 'swim': 'Longest swim',
    }[_sport]
TRACK_LABELS['sport:run:fastest'] = 'Fastest run efforts'
TRACK_LABELS['sport:ride:fastest'] = 'Fastest ride efforts'
TRACK_LABELS['sport:swim:fastest'] = 'Fastest swim efforts'

TRACK_UNITS = {
    'consistency': 'weeks',
    'years_active': 'years',
    'workouts': 'workouts',
    'active_time': 'seconds',
    'journey': 'm',
    'climbing': 'm',
    'lifted': 'kg',
    'personal_bests': 'bests',
    'sport:run': 'm',
    'sport:ride': 'm',
    'sport:walk-hike': 'm',
    'sport:swim': 'm',
    'sport:lift': 'sessions',
}
for _sport in SPORT_TRACK_LABELS:
    TRACK_UNITS[f'sport:{_sport}:workouts'] = 'workouts'
    TRACK_UNITS[f'sport:{_sport}:longest'] = 'm'
TRACK_UNITS['sport:run:fastest'] = 'benchmarks'
TRACK_UNITS['sport:ride:fastest'] = 'benchmarks'
TRACK_UNITS['sport:swim:fastest'] = 'benchmarks'


def _finite(value) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return value if math.isfinite(value) and value >= 0 else 0.0


def _named_tiers(levels, value, unit, big=False, rank_offset=0) -> list[Tier]:
    """Return named levels and multiples of the last named threshold."""
    value = _finite(value)
    out = [Tier(rank_offset + rank, float(threshold), label, unit, big)
           for rank, (label, threshold) in enumerate(levels, 1) if threshold <= value]
    if not levels:
        return out
    base = float(levels[-1][1])
    if base <= 0:
        return out
    multiple = 2
    while base * multiple <= value and len(out) < 100_000:
        rank = rank_offset + len(levels) + multiple - 1
        out.append(Tier(rank, base * multiple, f'{levels[-1][0]} ×{multiple}', unit, big))
        multiple += 1
    return out


def _next_named(levels, value, unit, big=False, rank_offset=0) -> Tier | None:
    """Return the next fixed level, then the next multiple of the last level."""
    value = _finite(value)
    for rank, (label, threshold) in enumerate(levels, 1):
        if threshold > value:
            return Tier(rank_offset + rank, float(threshold), label, unit, big)
    if not levels:
        return None
    base = float(levels[-1][1])
    if base <= 0:
        return None
    ratio = value / base
    multiple = max(2, math.floor(ratio) + 1) if math.isfinite(ratio) else 2
    return Tier(rank_offset + len(levels) + multiple - 1, base * multiple,
                f'{levels[-1][0]} ×{multiple}', unit, big)


def _levels(values, labels):
    return tuple((label, float(value)) for label, value in zip(labels, values))


def _sport_levels(sport):
    return _levels(SPORT_DISTANCE_LEVELS[sport], SPORT_DISTANCE_LABELS[sport])


def _sport_tiers(sport, value) -> list[Tier]:
    value = _finite(value)
    return _named_tiers(_sport_levels(sport), value, 'm', False)


def tiers_for(code: str, value) -> list[Tier]:
    """Return every tier reached by ``value`` for a stable track code."""
    value = _finite(value)
    if code == 'consistency':
        return _named_tiers(_levels(CONSISTENCY_LEVELS, CONSISTENCY_LABELS), value, 'weeks', True)
    if code == 'years_active':
        return _named_tiers(_levels(YEARS_ACTIVE_LEVELS, YEARS_ACTIVE_LABELS), value, 'years', False)
    if code == 'workouts':
        return _named_tiers(_levels(WORKOUT_LEVELS, WORKOUT_LABELS), value, 'workouts', False)
    if code == 'active_time':
        levels = tuple((label, hours * 3_600) for label, hours in zip(ACTIVE_TIME_LABELS, ACTIVE_TIME_HOURS))
        return _named_tiers(levels, value, 'seconds', False)
    if code == 'journey':
        return _named_tiers(JOURNEY_LANDMARKS, value, 'm', True)
    if code == 'climbing':
        return _named_tiers(CLIMBING_LEVELS, value, 'm', True)
    if code == 'lifted':
        return _named_tiers(LIFT_EQUIVALENTS, value, 'kg', False)
    if code == 'personal_bests':
        return _named_tiers(_levels(PERSONAL_BEST_LEVELS, PERSONAL_BEST_LABELS), value, 'bests', False)
    spec = sport_phase1_spec(code)
    if spec:
        _sport, _family, levels = spec
        return _named_tiers(levels, value, 'workouts' if _family == 'workouts' else 'm', False)
    fastest = fastest_effort_spec(code)
    if fastest:
        levels = tuple((name, index) for index, (name, _distance, _seconds) in enumerate(fastest, 1))
        return _named_tiers(levels, value, 'benchmarks', False)
    if code.startswith('sport:'):
        sport = code.split(':', 1)[1]
        if sport == 'lift':
            return _named_tiers(SPORT_LIFT_LEVELS, value, 'sessions', False)
        if sport in SPORT_DISTANCE_LEVELS:
            return _sport_tiers(sport, value)
    return []


def next_tier(code: str, value) -> Tier | None:
    """Return the first unearned tier; endless tracks always have one."""
    value = _finite(value)
    if code == 'consistency':
        return _next_named(_levels(CONSISTENCY_LEVELS, CONSISTENCY_LABELS), value, 'weeks', True)
    if code == 'years_active':
        return _next_named(_levels(YEARS_ACTIVE_LEVELS, YEARS_ACTIVE_LABELS), value, 'years', False)
    if code == 'workouts':
        return _next_named(_levels(WORKOUT_LEVELS, WORKOUT_LABELS), value, 'workouts', False)
    if code == 'active_time':
        levels = tuple((label, hours * 3_600) for label, hours in zip(ACTIVE_TIME_LABELS, ACTIVE_TIME_HOURS))
        return _next_named(levels, value, 'seconds', False)
    if code == 'journey':
        return _next_named(JOURNEY_LANDMARKS, value, 'm', True)
    if code == 'climbing':
        return _next_named(CLIMBING_LEVELS, value, 'm', True)
    if code == 'lifted':
        return _next_named(LIFT_EQUIVALENTS, value, 'kg', False)
    if code == 'personal_bests':
        return _next_named(_levels(PERSONAL_BEST_LEVELS, PERSONAL_BEST_LABELS), value, 'bests', False)
    spec = sport_phase1_spec(code)
    if spec:
        _sport, _family, levels = spec
        return _next_named(levels, value, 'workouts' if _family == 'workouts' else 'm', False)
    fastest = fastest_effort_spec(code)
    if fastest:
        levels = tuple((name, index) for index, (name, _distance, _seconds) in enumerate(fastest, 1))
        return _next_named(levels, value, 'benchmarks', False)
    if code.startswith('sport:'):
        sport = code.split(':', 1)[1]
        if sport == 'lift':
            return _next_named(SPORT_LIFT_LEVELS, value, 'sessions', False)
        if sport in SPORT_DISTANCE_LEVELS:
            return _next_named(_sport_levels(sport), value, 'm', False)
    return None


def track_label(code: str) -> str:
    return TRACK_LABELS.get(code, code.replace(':', ' ').replace('-', ' ').title())


def display_value(code: str, value, units: str = 'metric') -> tuple[float, str]:
    """Convert a canonical worker value for API presentation."""
    value = _finite(value)
    if code in ('journey', 'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim') or sport_phase1_spec(code) and sport_phase1_spec(code)[1] == 'longest':
        if units == 'imperial':
            return value / 1609.344, 'mi'
        return value / 1000, 'km'
    if code == 'climbing':
        if units == 'imperial':
            return value * 3.28084, 'ft'
        return value, 'm'
    if code == 'lifted':
        if units == 'imperial':
            return value * 2.2046226218, 'lb'
        return value, 'kg'
    if code == 'active_time':
        return value / 3600, 'h'
    return value, TRACK_UNITS.get(code, 'count')


def display_tier(code: str, tier: Tier, units: str = 'metric') -> dict:
    out = tier.as_dict()
    shown, shown_unit = display_value(code, tier.threshold, units)
    out.update({'display_threshold': shown, 'display_unit': shown_unit})
    return out
