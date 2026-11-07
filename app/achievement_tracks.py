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
    ('Round the town', 10_000.0),
    ('Across the city', 21_097.5),
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
    ('Rooftop', 100.0),
    ('Hilltop', 400.0),
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
    ('A grand piano', 500.0),
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

CONSISTENCY_LEVELS = (1, 2, 4, 10, 20, 52, 100, 150, 200, 250, 300, 350)
CONSISTENCY_LABELS = (
    'First week', 'Pilot light', 'Spark', 'Kindling', 'Steady flame', 'Bonfire',
    'Campfire circle', 'Volcano', 'Solar flare', 'North Star', 'Constellation', 'Galaxy',
)
YEARS_ACTIVE_LEVELS = (1, 2, 3, 4, 5, 10, 25, 50, 100)
YEARS_ACTIVE_LABELS = (
    'First orbit', 'Comet', 'Three-peat', 'Olympiad', 'High five', 'Decade',
    'Silver jubilee', 'Golden jubilee', 'Century',
)
WORKOUT_LEVELS = (1, 5, 10, 50, 100, 250, 500, 1_000, 1_500, 2_000)
WORKOUT_LABELS = (
    'First workout', 'Sprig', 'Seed', 'Sprout', 'Sapling', 'Young tree',
    'Evergreen', 'Grove', 'Forest', 'Old-growth forest',
)
ACTIVE_TIME_HOURS = (1, 5, 10, 24, 100, 250, 500, 1_000, 2_000, 10_000)
ACTIVE_TIME_LABELS = (
    'First hour', 'Movie marathon', 'First ten hours', 'Round the clock',
    'Four days moving', 'Six workweeks', 'A season of effort',
    'Half a working year', 'A working year', 'Mastery',
)
PERSONAL_BEST_LEVELS = (1, 5, 10, 25, 50, 75, 100, 150)
PERSONAL_BEST_LABELS = (
    'First record', 'On a roll', 'Record keeper', 'Hall of fame', 'Record shelf',
    'Record library', 'Record constellation', 'Legend',
)

# The first activity is already stored as a sport milestone. The distance tiers
# here begin with the next catalog level so zero-distance activities still earn
# the existing First row without relying on a zero-threshold crossing.
SPORT_FIRST_ACTIVITY_LABELS = {
    'run': 'First run',
    'ride': 'First ride',
    'walk-hike': 'First walk',
    'swim': 'First swim',
}
SPORT_DISTANCE_LEVELS = {
    'run': (1_609.344, 5_000.0, 10_000.0, 21_097.5, 42_195.0, 80_467.0,
            160_934.0, 402_336.0, 804_672.0, 1_609_344.0),
    'ride': (5_000.0, 16_093.0, 40_234.0, 100_000.0, 160_934.0, 402_336.0,
             804_672.0, 1_609_344.0, 4_506_163.0),
    'walk-hike': (1_609.344, 5_000.0, 10_000.0, 21_097.5, 42_195.0, 80_467.0,
                  160_934.0, 402_336.0, 804_672.0, 3_524_463.0),
    'swim': (500.0, 1_609.0, 3_862.0, 10_000.0, 33_796.0, 80_467.0,
             160_934.0, 402_336.0, 804_672.0),
}
SPORT_DISTANCE_LABELS = {
    'run': ('First mile', '5K', '10K', 'Half marathon', 'Marathon', '50-mile ultra',
            '100 miles', '250 miles', '500 miles', '1,000 miles'),
    'ride': ('Quick spin', 'First 10 miles', '25 miles', 'Metric century', 'Century',
             '250 miles', '500 miles', '1,000 miles', 'Coast to coast'),
    'walk-hike': ('First mile', '5K', '10K', 'Half marathon', 'Marathon', '50 miles',
                  '100 miles', '250 miles', '500 miles', 'Appalachian Trail'),
    'swim': ('Splash', 'First mile', 'Ironman swim', 'Marathon swim (10K)',
             'English Channel', '50 miles', '100 miles', '250 miles', '500 miles'),
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
    if int(rank or 0) == 1 and (code in ('consistency', 'workouts') or code in {
        'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim'
    }):
        return 'first_activity'
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
    code = f'sport:{sport}'
    out = []
    if value >= 1.0:
        out.append(Tier(1, 1.0, SPORT_FIRST_ACTIVITY_LABELS[sport], 'm', False))
    out.extend(_named_tiers(_sport_levels(sport), value, 'm', False, rank_offset=1))
    return out


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
    if code.startswith('sport:'):
        sport = code.split(':', 1)[1]
        if sport == 'lift':
            return _next_named(SPORT_LIFT_LEVELS, value, 'sessions', False)
        if sport in SPORT_DISTANCE_LEVELS:
            if value < 1.0:
                return Tier(1, 1.0, SPORT_FIRST_ACTIVITY_LABELS[sport], 'm', False)
            return _next_named(_sport_levels(sport), value, 'm', False, rank_offset=1)
    return None


def track_label(code: str) -> str:
    return TRACK_LABELS.get(code, code.replace(':', ' ').replace('-', ' ').title())


def display_value(code: str, value, units: str = 'metric') -> tuple[float, str]:
    """Convert a canonical worker value for API presentation."""
    value = _finite(value)
    if code in ('journey', 'sport:run', 'sport:ride', 'sport:walk-hike', 'sport:swim'):
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
