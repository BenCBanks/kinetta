"""Recover account-owned files after failed removal, interrupted responses or restart.

Canonical owner directories are the durable retry queue: they stay on disk until
removal succeeds. Never infer ownership from a filename supplied by a client.
"""
import fcntl
import logging
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import threading
import time
from contextlib import contextmanager

from . import db

DATA = os.environ.get('FIT_DATA', '/data')
log = logging.getLogger('uvicorn.error')


@contextmanager
def directory_lock(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def owner_id(name):
    return int(name) if re.fullmatch(r'[1-9][0-9]{0,17}', name) else None


def _root(data, kind):
    path = Path(data) / kind
    if path.is_symlink():
        raise OSError('Account storage root must not be a symlink')
    return path


def _absent(uid):
    with db.connect() as c:
        c.execute("SET LOCAL statement_timeout='2s'")
        return not c.execute('SELECT 1 FROM users WHERE id=%s', (uid,)).fetchone()


def _remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()  # Remove the link, never its target.
    elif path.exists():
        shutil.rmtree(path)


def sweep_exports(data=DATA):
    root = _root(data, 'exports')
    if not root.exists():
        return
    for owner in root.iterdir():
        if not owner_id(owner.name) or owner.is_symlink() or not owner.is_dir():
            continue
        try:
            with directory_lock(owner):
                for path in owner.glob('*.zip'):
                    try:
                        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                        try:
                            try:
                                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            except BlockingIOError:
                                continue  # A live builder/download owns this inode.
                            if stat.S_ISREG(os.fstat(fd).st_mode):
                                path.unlink(missing_ok=True)
                        finally:
                            os.close(fd)
                    except FileNotFoundError:
                        pass  # A completed response already removed it.
                    except OSError:
                        log.warning('Export removal deferred; recovery sweep will retry')
                if not any(owner.iterdir()) and _absent(int(owner.name)):
                    owner.rmdir()
        except OSError:
            log.warning('Export directory removal deferred; recovery sweep will retry')


class ExportFile:
    def __init__(self, uid, data=DATA):
        root = _root(data, 'exports')
        root.mkdir(mode=0o700, exist_ok=True)
        self.owner = root / str(int(uid))
        self.owner.mkdir(mode=0o700, exist_ok=True)
        # Allocation and sweeping share a directory lock, closing the gap between
        # mkstemp and flock. The file lock survives across build and ASGI send.
        with directory_lock(self.owner):
            self.fd, name = tempfile.mkstemp(suffix='.zip', dir=self.owner)
            self.path = Path(name)
            fcntl.flock(self.fd, fcntl.LOCK_EX)

    def close(self):
        if self.fd is None:
            return
        try:
            with directory_lock(self.owner):
                self.path.unlink(missing_ok=True)
        except OSError:
            log.warning('Export removal deferred; recovery sweep will retry')
        finally:
            os.close(self.fd)
            self.fd = None


def erase_user(uid, data=DATA):
    """Best effort after commit; absence checks fail closed and failures stay queued."""
    try:
        if not _absent(uid):
            return
        for kind in ('files', 'uploads'):
            _remove(_root(data, kind) / str(int(uid)))
    except Exception:
        log.warning('Account file removal deferred; recovery sweep will retry')


def sweep(data=DATA):
    from .api_mydata import expire_prepared_exports
    expire_prepared_exports()
    failures = 0
    for kind in ('files', 'uploads'):
        root = _root(data, kind)
        for owner in root.iterdir() if root.exists() else ():
            uid = owner_id(owner.name)
            if uid is None:
                continue
            try:
                if _absent(uid):
                    _remove(owner)
            except Exception:
                failures += 1  # Keep the directory as a durable retry receipt.
    sweep_exports(data)
    # Older releases used unowned /tmp exports. Retire only our same-UID regular
    # files after a 24h grace; new exports use locks, not age, to protect live sends.
    for path in Path(tempfile.gettempdir()).glob('kinetta-export-*.zip'):
        try:
            st = path.lstat()
            if stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and time.time() - st.st_mtime > 86400:
                path.unlink()
        except OSError:
            failures += 1
    if failures:
        log.warning('Account/export recovery left %d removals for retry', failures)


def start_cleanup():
    stop = threading.Event()

    def run():
        while not stop.is_set():
            try:
                sweep()
            except Exception:
                log.warning('Account/export recovery unavailable; will retry')
            stop.wait(60)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return stop, thread
