"""Pure rules and labels for the activity achievement tracks.

The worker stores distances in metres and lifting volume in kilograms.  This
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


# The fixed Journey landmarks are intentionally a short, monotonic list.  The
# values are approximate route lengths, useful for a playful progress track,
# not geographic measurements or navigation promises.
JOURNEY_LANDMARKS = (
    ('Marathon', 42_195.0),
    ('Lake Tahoe loop', 114_000.0),
    ('Length of the UK', 1_407_000.0),
    ('Across the US', 4_000_000.0),
    ('Length of Africa', 7_400_000.0),
    ('Across Australia', 14_000_000.0),
)
WORLD_M = 40_075_000.0
MOON_M = 384_400_000.0
EVEREST_M = 8_849.0

# These are simple display equivalents, while the stored value remains kg.
LIFT_EQUIVALENTS = (
    ('A car', 1_500.0),
    ('An elephant', 6_000.0),
    ('A blue whale', 150_000.0),
)

CONSISTENCY_LEVELS = (4, 10, 20, 52, 100)
WORKOUT_LEVELS = (10, 50, 100, 250, 500, 1_000)
ACTIVE_TIME_HOURS = (10, 50, 100, 250, 500, 1_000)
PERSONAL_BEST_LEVELS = (1, 5, 10, 25)

# Existing Firsts use these run/walk distances.  The other sport tracks keep a
# similarly recognizable opening and then double forever.
SPORT_DISTANCE_LEVELS = {
    'run': (5_000.0, 10_000.0, 21_097.5, 42_195.0),
    'ride': (10_000.0, 50_000.0, 100_000.0, 200_000.0),
    'walk-hike': (5_000.0, 10_000.0, 21_097.5, 42_195.0),
    'swim': (1_000.0, 5_000.0, 10_000.0, 20_000.0),
}

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


def _fixed_then_step(fixed, step, value):
    """Return fixed thresholds followed by an every-N tail."""
    value = _finite(value)
    out = [float(n) for n in fixed if n <= value]
    if not fixed:
        return out
    n = float(fixed[-1]) + float(step)
    # A corrupt value should not make a worker loop forever.
    while n <= value and len(out) < 100_000:
        out.append(n)
        n += float(step)
    return out


def _next_fixed_then_step(fixed, step, value):
    """Return the first fixed threshold ahead, then the next every-N tier."""
    value = _finite(value)
    for n in fixed:
        if n > value:
            return float(n)
    if not fixed:
        return None
    steps = math.floor((value - float(fixed[-1])) / float(step)) + 1
    return float(fixed[-1]) + steps * float(step)


def _fixed_then_double(fixed, value):
    """Return fixed thresholds followed by a doubling tail."""
    value = _finite(value)
    out = [float(n) for n in fixed if n <= value]
    if not fixed or not fixed[-1]:
        return out
    n = float(fixed[-1]) * 2
    while n <= value and len(out) < 100_000:
        out.append(n)
        n *= 2
    return out


def _journey_tiers(value) -> list[Tier]:
    value = _finite(value)
    out = [Tier(i, threshold, label, 'm', True)
           for i, (label, threshold) in enumerate(JOURNEY_LANDMARKS, 1)
           if threshold <= value]
    rank = len(JOURNEY_LANDMARKS) + 1
    world = WORLD_M
    # Moon comes before world x10 (and is the named long-tail landmark).
    world_count = 1
    while world < MOON_M and world <= value and len(out) < 100_000:
        out.append(Tier(rank, world, f'Around the world ×{world_count}', 'm', True))
        rank += 1
        world_count += 1
        world += WORLD_M
    if MOON_M <= value:
        out.append(Tier(rank, MOON_M, 'To the Moon', 'm', True))
        rank += 1
        moon_count = 2
        moon = MOON_M * 2
        while moon <= value and len(out) < 100_000:
            out.append(Tier(rank, moon, f'To the Moon ×{moon_count}', 'm', True))
            rank += 1
            moon_count += 1
            moon += MOON_M
    return out


def _journey_next(value) -> Tier:
    value = _finite(value)
    for i, (label, threshold) in enumerate(JOURNEY_LANDMARKS, 1):
        if threshold > value:
            return Tier(i, threshold, label, 'm', True)
    world_count = 1
    world = WORLD_M
    rank = len(JOURNEY_LANDMARKS) + 1
    while world < MOON_M:
        if world > value:
            return Tier(rank, world, f'Around the world ×{world_count}', 'm', True)
        world_count += 1
        rank += 1
        world += WORLD_M
    if MOON_M > value:
        return Tier(rank, MOON_M, 'To the Moon', 'm', True)
    moon_count = math.floor(value / MOON_M) + 1
    # ``rank`` is the first Moon tier (To the Moon).  The next tier after it
    # is ×2, so each additional Moon adds one rank.
    return Tier(rank + moon_count - 1, moon_count * MOON_M,
                f'To the Moon ×{moon_count}', 'm', True)


def _lift_tiers(value) -> list[Tier]:
    value = _finite(value)
    out = [Tier(i, threshold, label, 'kg', False)
           for i, (label, threshold) in enumerate(LIFT_EQUIVALENTS, 1)
           if threshold <= value]
    if value >= LIFT_EQUIVALENTS[-1][1]:
        n = math.floor(value / LIFT_EQUIVALENTS[-1][1])
        for count in range(2, n + 1):
            out.append(Tier(len(out) + 1, count * LIFT_EQUIVALENTS[-1][1],
                            f'{count} blue whales', 'kg', False))
    return out


def _lift_next(value) -> Tier:
    value = _finite(value)
    for i, (label, threshold) in enumerate(LIFT_EQUIVALENTS, 1):
        if threshold > value:
            return Tier(i, threshold, label, 'kg', False)
    count = math.floor(value / LIFT_EQUIVALENTS[-1][1]) + 1
    return Tier(3 + max(0, count - 1), count * LIFT_EQUIVALENTS[-1][1],
                f'{count} blue whales', 'kg', False)


def tiers_for(code: str, value) -> list[Tier]:
    """Return every tier reached by ``value`` for a stable track code."""
    value = _finite(value)
    if code == 'consistency':
        return [Tier(i, n, f'{int(n)} active weeks', 'weeks', True)
                for i, n in enumerate(_fixed_then_step(CONSISTENCY_LEVELS, 50, value), 1)]
    if code == 'years_active':
        return [Tier(i, n, f'{int(n)} year{"" if n == 1 else "s"} active', 'years', False)
                for i, n in enumerate(range(1, int(math.floor(value)) + 1), 1)]
    if code == 'workouts':
        return [Tier(i, n, f'{int(n):,} workout{"" if n == 1 else "s"}', 'workouts', False)
                for i, n in enumerate(_fixed_then_step(WORKOUT_LEVELS, 500, value), 1)]
    if code == 'active_time':
        return [Tier(i, n * 3600, f'{int(n):,} active hour{"" if n == 1 else "s"}', 'seconds', False)
                for i, n in enumerate(_fixed_then_step(ACTIVE_TIME_HOURS, 500, value / 3600), 1)]
    if code == 'journey':
        return _journey_tiers(value)
    if code == 'climbing':
        thresholds = (EVEREST_M / 4, EVEREST_M / 2, EVEREST_M)
        out = [Tier(i, n, label, 'm', True)
               for i, (n, label) in enumerate(zip(thresholds, ('¼ Everest', '½ Everest', '1 Everest')), 1)
               if n <= value]
        if value >= EVEREST_M:
            for count in range(2, math.floor(value / EVEREST_M) + 1):
                out.append(Tier(len(out) + 1, count * EVEREST_M, f'{count} Everests', 'm', True))
        return out
    if code == 'lifted':
        return _lift_tiers(value)
    if code == 'personal_bests':
        return [Tier(i, n, f'{int(n):,} personal best{"" if n == 1 else "s"}', 'bests', False)
                for i, n in enumerate(_fixed_then_step(PERSONAL_BEST_LEVELS, 25, value), 1)]
    if code.startswith('sport:'):
        sport = code.split(':', 1)[1]
        if sport == 'lift':
            return [Tier(i, n, f'{int(n):,} lift session{"" if n == 1 else "s"}', 'sessions', False)
                    for i, n in enumerate(_fixed_then_double((1, 5, 10, 25), value), 1)]
        fixed = SPORT_DISTANCE_LEVELS.get(sport)
        if fixed:
            labels = ('5K', '10K', 'half marathon', 'marathon') if sport in ('run', 'walk-hike') else None
            out = []
            for i, n in enumerate(_fixed_then_double(fixed, value), 1):
                if labels and i <= len(labels):
                    label = labels[i - 1]
                else:
                    label = f'{n / 1000:g} km'
                out.append(Tier(i, n, label, 'm', False))
            return out
    return []


def next_tier(code: str, value) -> Tier | None:
    """Return the first unearned tier; endless tracks always have one."""
    value = _finite(value)
    earned = tiers_for(code, value)
    if code == 'journey':
        return _journey_next(value)
    if code == 'lifted':
        return _lift_next(value)
    if code == 'climbing':
        if value < EVEREST_M / 4:
            return Tier(1, EVEREST_M / 4, '¼ Everest', 'm', True)
        if value < EVEREST_M / 2:
            return Tier(2, EVEREST_M / 2, '½ Everest', 'm', True)
        if value < EVEREST_M:
            return Tier(3, EVEREST_M, '1 Everest', 'm', True)
        count = math.floor(value / EVEREST_M) + 1
        return Tier(2 + count, count * EVEREST_M, f'{count} Everests', 'm', True)
    if code == 'years_active':
        n = int(math.floor(value)) + 1
        return Tier(n, n, f'{n} year{"" if n == 1 else "s"} active', 'years', False)
    if code == 'active_time':
        hours = value / 3600
        next_hours = _next_fixed_then_step(ACTIVE_TIME_HOURS, 500, hours)
        rank = len(tiers_for(code, next_hours))
        return Tier(rank, next_hours * 3600, f'{int(next_hours):,} active hours', 'seconds', False)
    if code == 'consistency':
        n = _next_fixed_then_step(CONSISTENCY_LEVELS, 50, value)
        return Tier(len(tiers_for(code, n)), n, f'{int(n)} active weeks', 'weeks', True)
    if code == 'workouts':
        n = _next_fixed_then_step(WORKOUT_LEVELS, 500, value)
        return Tier(len(tiers_for(code, n)), n, f'{int(n):,} workouts', 'workouts', False)
    if code == 'personal_bests':
        n = _next_fixed_then_step(PERSONAL_BEST_LEVELS, 25, value)
        return Tier(len(tiers_for(code, n)), n, f'{int(n):,} personal bests', 'bests', False)
    if code.startswith('sport:'):
        sport = code.split(':', 1)[1]
        if sport == 'lift':
            n = 1
            while n <= value:
                n *= 2 if n >= 25 else 5 if n == 1 else 2
            # Keep the opening 1, 5, 10, 25 sequence in sync with tiers_for.
            candidates = [1, 5, 10, 25]
            while candidates[-1] <= value:
                candidates.append(candidates[-1] * 2)
            n = next(x for x in candidates if x > value)
            return Tier(len(tiers_for(code, n)), n, f'{int(n):,} lift sessions', 'sessions', False)
        fixed = SPORT_DISTANCE_LEVELS.get(sport)
        if fixed:
            candidates = list(fixed)
            while candidates[-1] <= value:
                candidates.append(candidates[-1] * 2)
            n = next(x for x in candidates if x > value)
            label = f'{n / 1000:g} km'
            return Tier(len(tiers_for(code, n)), n, label, 'm', False)
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

