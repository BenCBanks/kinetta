"""Private activity-only streak and near-target helpers shared by stats and reminders."""
from datetime import date, timedelta
from math import ceil


def week_streak(active_weeks, today: date) -> int:
    """Count consecutive Monday-starting activity weeks, ending this or last week."""
    monday = today - timedelta(days=today.weekday())
    weeks = {week - timedelta(days=week.weekday()) for week in active_weeks}
    current = monday if monday in weeks else monday - timedelta(days=7)
    count = 0
    while current in weeks:
        count += 1
        current -= timedelta(days=7)
    return count


def close_to_target(year_distance_m: float, all_counts_by_sport: dict, units: str) -> str | None:
    """Return the closest remaining activity target when at most ten percent away."""
    unit = 'mi' if units == 'imperial' else 'km'
    metres_per_unit = 1609.344 if unit == 'mi' else 1000.0
    distances = (100, 250, 500, 1000, 2000, 5000)
    counts = (25, 50, 100, 250, 500, 1000)
    candidates = []

    def add(current, target, text):
        remaining = target - current
        if 0 < remaining <= target * .10 + 1e-9:
            candidates.append((remaining / target, len(candidates), text(remaining, target)))

    current_distance = max(0.0, float(year_distance_m or 0)) / metres_per_unit
    for target in distances:
        add(current_distance, target, lambda left, goal: f"{ceil(left - 1e-9):,} {unit} to {goal:,} {unit} this year")

    counts_by_sport = {key: max(0, int(value or 0)) for key, value in all_counts_by_sport.items()}
    workouts = sum(counts_by_sport.values())

    def ordinal(n):
        return f"{n:,}th" if n % 100 in (11, 12, 13) else f"{n:,}{ {1:'st', 2:'nd', 3:'rd'}.get(n % 10, 'th')}"

    for target in counts:
        add(workouts, target, lambda left, goal: f"{int(left)} {'workout' if left == 1 else 'workouts'} to your {ordinal(goal)}")
    for sport in ('run', 'ride'):
        noun = 'run' if sport == 'run' else 'ride'
        for target in (10, 25, 50, 100, 250):
            add(counts_by_sport.get(sport, 0), target,
                lambda left, goal, noun=noun: f"{int(left)} {noun if left == 1 else noun + 's'} to your {ordinal(goal)} {noun}")
    return min(candidates, key=lambda candidate: (candidate[0], candidate[1]))[2] if candidates else None
