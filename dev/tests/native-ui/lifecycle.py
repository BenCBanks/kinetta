"""Bounded recovery of a disposable Simulator before replacing fixture assets."""
import subprocess


def stop_for_fixture(sim, udid, theme, recovered=False):
    """A timed-out terminate must never be mistaken for a stopped process."""
    try:
        sim('terminate', udid, 'com.kinetta.app', timeout=20)
        return recovered
    except subprocess.TimeoutExpired:
        pass
    if recovered:
        raise RuntimeError('Simulator app termination timed out again; fixture was not updated')
    print('Simulator termination stalled; restarting this disposable device once before updating fixtures', flush=True)
    # Required commands: a failed shutdown/boot must abort before prepare.py runs.
    sim('shutdown', udid, timeout=90)
    sim('boot', udid)
    sim('bootstatus', udid, '-b', timeout=240)
    sim('ui', udid, 'appearance', theme)
    sim('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi',
        '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
    return True
