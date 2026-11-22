"""Bounded recovery of a disposable Simulator before replacing fixture assets."""
import subprocess, uuid


def create_fresh_sim(sim, device, runtime):
    """Each attempt gets a new Simulator UDID; never reuse a pre-existing device."""
    return sim('create', 'KinettaLayout-' + uuid.uuid4().hex[:8], device['identifier'], runtime['identifier'])


def stop_for_fixture(sim, udid, theme, recovered=False):
    """Stop the fixture app, recovering a stalled disposable Simulator once."""
    try:
        sim('terminate', udid, 'com.kinetta.app', timeout=10)
        return recovered
    except subprocess.CalledProcessError as error:
        message = '\n'.join(str(part) for part in (error.stdout, error.stderr, error)).lower()
        if any(marker in message for marker in ('not running', 'no such process', 'is not running')):
            return recovered
        raise
    except subprocess.TimeoutExpired:
        pass
    if recovered:
        raise RuntimeError('Simulator app termination timed out again; fixture was not updated')
    print('Simulator termination stalled; shutting down and erasing the disposable device before updating fixtures', flush=True)
    # Recovery is deliberately bounded (<5 minutes); a hung simulator fails this attempt and the CI retry
    # creates a distinct UDID rather than reusing this damaged device.
    sim('shutdown', 'all', timeout=20)
    sim('erase', udid, timeout=45)
    sim('boot', udid, timeout=20)
    sim('bootstatus', udid, '-b', timeout=160)
    sim('ui', udid, 'appearance', theme, timeout=10)
    sim('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi',
        '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100', timeout=10)
    return True
