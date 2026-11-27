"""One nonwaiting image worker across uploads and share-card renders.

Hold the slot in the synchronous worker itself: cancelling an HTTP wait must
not admit more image work while Pillow is still using its pixel buffers.
"""
import threading
from contextlib import contextmanager
from contextvars import copy_context
from concurrent.futures import ThreadPoolExecutor
from fastapi import HTTPException

_slots = threading.BoundedSemaphore(1)
# Reuse one native allocator arena instead of retaining Pillow buffers in each
# request thread. Admission is nonwaiting, so this executor cannot build a queue.
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="image")


@contextmanager
def slot():
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'Photo processing is busy. Your photo is kept; try again shortly.',
                            headers={'Retry-After': '2'})
    try:
        yield
    finally:
        _slots.release()


def run(fn, *args, **kwargs):
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'Photo processing is busy. Your photo is kept; try again shortly.',
                            headers={'Retry-After': '2'})
    def work():
        try:
            return fn(*args, **kwargs)
        finally:
            _slots.release()  # Actual completion, even if the request goes away.
    try:
        future = _worker.submit(copy_context().run, work)
    except BaseException:
        _slots.release()
        raise
    return future.result()
