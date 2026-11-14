"""Turn bounded Simulator fixture marks into phase durations and CI Markdown."""
import math


PHASE_LABELS = (
    ('launch_to_webview_ready_ms', 'Process launch → WebView JS ready'),
    ('webview_ready_to_index_loaded_ms', 'WebView ready → index loaded'),
    ('index_loaded_to_api_me_done_ms', 'Index loaded → /api/me done'),
    ('api_me_done_to_first_useful_ms', '/api/me done → first useful Me render'),
)


def phase_durations(timing, process_launch_epoch_ms):
    """Validate one monotonic JS timeline and return launch-to-screen phase ms."""
    origin = float(timing['performanceTimeOriginEpochMs'])
    launch = float(process_launch_epoch_ms)
    marks = [
        float(timing['webViewReadyPerfMs']),
        float(timing['indexLoadedPerfMs']),
        float(timing['apiMeDonePerfMs']),
        float(timing['firstUsefulRenderPerfMs']),
    ]
    values = [origin, launch, *marks]
    if not all(math.isfinite(value) for value in values):
        raise ValueError('Startup timing contains a non-finite timestamp')
    if any(right < left for left, right in zip(marks, marks[1:])):
        raise ValueError('Startup phase marks are not monotonic')
    epochs = [origin + mark for mark in marks]
    launch_to_webview = epochs[0] - launch
    if launch_to_webview < 0 or launch_to_webview > 120_000:
        raise ValueError('Simulator and runner clocks disagree on process launch time')
    phases = {
        PHASE_LABELS[0][0]: launch_to_webview,
        PHASE_LABELS[1][0]: marks[1] - marks[0],
        PHASE_LABELS[2][0]: marks[2] - marks[1],
        PHASE_LABELS[3][0]: marks[3] - marks[2],
    }
    phases['total_launch_to_first_useful_ms'] = epochs[3] - launch
    if any(value < 0 for value in phases.values()):
        raise ValueError('Startup phase duration is negative')
    return {key: round(value, 1) for key, value in phases.items()}


def summary_markdown(rows):
    """Render per-device timings for the GitHub Actions job summary."""
    lines = [
        '### Native iOS cold start (fictional Me fixture)',
        '',
        'App process launch to the first useful Me render; `/api/me` and other API data are on-device fictional stand-ins. These are diagnostic timings, not production network measurements.',
        '',
        '| Simulator | Launch → WebView JS | WebView → index | Index → `/api/me` | `/api/me` → useful Me | Total |',
        '|---|---:|---:|---:|---:|---:|',
    ]
    for row in rows:
        p = row['phases']
        lines.append(
            f"| {row['device']} | {p['launch_to_webview_ready_ms']:.1f} ms "
            f"| {p['webview_ready_to_index_loaded_ms']:.1f} ms "
            f"| {p['index_loaded_to_api_me_done_ms']:.1f} ms "
            f"| {p['api_me_done_to_first_useful_ms']:.1f} ms "
            f"| {p['total_launch_to_first_useful_ms']:.1f} ms |"
        )
    return '\n'.join(lines) + '\n'
