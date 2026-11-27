"""Bounded best-effort Garmin work, lost on process exit just like the old background threads."""
from collections import deque
import hashlib
import json
import threading


class NoticeQueue:
    def __init__(self, handle, max_items=256, max_bytes=64*1024**2):
        self.handle, self.max_items, self.max_bytes = handle, max_items, max_bytes
        self._condition = threading.Condition()
        self._jobs, self._pending, self._workers = deque(), {}, []
        self._bytes, self._closed = 0, False

    def submit(self, body, pushed):
        # Retain compact bytes, not decoded activity graphs. Count both queued and
        # running items; a slow worker cannot release memory admission prematurely.
        items, prepared_bytes = {}, 0
        for kind, rows in body.items():
            if kind not in ('activityDetails', 'deregistrations', 'userPermissionsChange') or not isinstance(rows, list): continue
            for item in rows:
                if not isinstance(item, dict): continue
                raw = json.dumps(item, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
                key = (pushed, kind, hashlib.sha256(raw).digest())
                if key not in items:
                    prepared_bytes += len(raw)
                    items[key] = raw
                    if len(items)>self.max_items or prepared_bytes>self.max_bytes: return False
        with self._condition:
            if self._closed: raise RuntimeError('Garmin queue is closed')
            items = {key:raw for key,raw in items.items() if key not in self._pending}
            size = sum(map(len, items.values()))
            if len(self._pending)+len(items)>self.max_items or self._bytes+size>self.max_bytes: return False
            if not items: return True
            while len(self._workers)<2:
                worker = threading.Thread(target=self._run, daemon=True)
                worker.start()
                self._workers.append(worker)
            self._pending.update({key:len(raw) for key,raw in items.items()})
            self._bytes += size
            # Preserve the original notice's import/coach batching, after dedup.
            self._jobs.append(items)
            self._condition.notify_all()
            return True

    def _run(self):
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._jobs or self._closed)
                if not self._jobs: return
                items = self._jobs.popleft()
            try:
                body = {}
                for (_, kind, _), raw in items.items(): body.setdefault(kind, []).append(json.loads(raw))
                self.handle(body, next(iter(items))[0])
            except Exception as error:
                # No retry or payload/error text logging. The next notice still runs.
                try: print('garmin queued notice failed', type(error).__name__, flush=True)
                except (OSError, ValueError): pass
            finally:
                with self._condition:
                    for key in items: self._bytes -= self._pending.pop(key)
                    del items, body, raw
                    self._condition.notify_all()

    def close(self):
        """Drain and stop owned workers (used by isolated tests); normal process exit remains best effort."""
        with self._condition:
            self._closed = True
            self._condition.notify_all()
        for worker in self._workers: worker.join(timeout=3)
