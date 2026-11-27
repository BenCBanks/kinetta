"""Legacy multipart intake: authenticate first, bound staging and hold admission through cleanup.

Admission is process-local and covers web uploads; CLI imports still execute directly.
Disk reservations include spool + staged copy, on the same filesystem.
"""
import asyncio
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from fastapi import HTTPException
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from . import parsers

JOBS = 2                         # includes receiving, queued and running; one per account
OVERHEAD = 4 * 1024**2
PIECE = 256 * 1024
IDLE_SECONDS, RECEIVE_SECONDS = 60, 30 * 60
_lock = threading.Lock()
_active = set()
TOO_LARGE = 'This upload is too large. Ask the person who runs Kinetta to import a large export.'


async def offload(function, *args, cancelled=None, **kwargs):
    # A disconnected request must not free its place/close files while a disk
    # worker is still using them. Drain actual thread completion before cleanup.
    task = asyncio.create_task(run_in_threadpool(function, *args, **kwargs))
    try: return await asyncio.shield(task)
    except asyncio.CancelledError:
        while not task.done():
            try: await asyncio.shield(task)
            except asyncio.CancelledError: pass
            except Exception: break
        if not task.cancelled() and task.exception() is None and cancelled:
            await offload(cancelled, task.result())
        raise


def busy():
    raise HTTPException(503, 'Imports are busy. Please try again after the current import finishes.',
                        headers={'Retry-After': '5'})


def _disk(directory, extra=0):
    usage = shutil.disk_usage(directory)
    remaining = sum(lease.remaining for lease in _active)
    if usage.free - remaining - extra < max(1024**3, int(usage.total * .25)):
        raise HTTPException(507, 'Not enough storage for this import. Please try again later.')


class Capacity:
    def __init__(self, uid, directory, size):
        self.uid, self.directory, self.remaining = uid, directory, size * 2

    def check(self, extra=0):
        with _lock: _disk(self.directory, extra)

    def written(self, size):
        with _lock: self.remaining = max(0, self.remaining - size)

    def release(self):
        with _lock: _active.discard(self)


def reserve(uid, directory, size):
    # Called off the event loop; no DB borrow/transaction is held here or during receipt.
    Path(directory).mkdir(parents=True, exist_ok=True)
    with _lock:
        if len(_active) >= JOBS or any(lease.uid == uid for lease in _active): busy()
        _disk(directory, size * 2)
        lease = Capacity(uid, directory, size)
        _active.add(lease)
        return lease


class Spool(UploadFile):
    async def write(self, data):
        await offload(self.file.write, data)
        if self.size is not None: self.size += len(data)

    async def seek(self, offset):
        await offload(self.file.seek, offset)


class Multipart(MultiPartParser):
    spool_max_size = 64 * 1024

    def __init__(self, request, stream, directory, limit):
        super().__init__(request.headers, stream, max_files=1000, max_fields=16, max_part_size=64*1024)
        self.directory, self.limit, self.total, self.ended = directory, limit, 0, False

    def on_part_begin(self):
        super().on_part_begin()
        self.part_bytes = self.header_bytes = 0

    def header_size(self, start, end):
        self.header_bytes += end - start
        if self.header_bytes > 16 * 1024: raise HTTPException(413, 'Upload file headers are too large')

    def on_header_field(self, data, start, end):
        self.header_size(start, end)
        super().on_header_field(data, start, end)

    def on_header_value(self, data, start, end):
        self.header_size(start, end)
        super().on_header_value(data, start, end)

    def on_headers_finished(self):
        super().on_headers_finished()
        if self._current_part.file:
            # Starlette exposes no directory option. Replace only the new, empty
            # spool so reservations and actual writes use the same filesystem.
            old = self._current_part.file.file
            new = tempfile.SpooledTemporaryFile(max_size=self.spool_max_size, dir=self.directory)
            self._current_part.file = Spool(new, size=0, filename=self._current_part.file.filename,
                                            headers=self._current_part.file.headers)
            self._files_to_close_on_error[-1] = new
            old.close()

    def on_part_data(self, data, start, end):
        if self._current_part.file:
            size = end - start
            self.total += size
            self.part_bytes += size
            if self.total > self.limit: raise HTTPException(413, TOO_LARGE)
            name = (self._current_part.file.filename or '').lower()
            if not name.endswith('.zip') and self.part_bytes > parsers.MAX_FILE:
                raise HTTPException(413, 'A workout file must be at most 256 MiB. Use ZIP for a full export.')
        super().on_part_data(data, start, end)

    def on_end(self):
        self.ended = True

    def close(self):
        # Starlette itself closes only MultiPartException failures. Also cover
        # byte/deadline/storage errors, malformed input and cancellation.
        for file in self._files_to_close_on_error: file.close()


def body_limit(request, maximum):
    length = request.headers.get('content-length')
    if length is None: return maximum + OVERHEAD
    if not length.isascii() or not length.isdigit() or len(length) > 12:
        raise HTTPException(400, 'Invalid upload length')
    length = int(length)
    if length > maximum + OVERHEAD: raise HTTPException(413, TOO_LARGE)
    return length


async def receive(request, lease, maximum, length):
    total = 0
    stream = request.stream().__aiter__()
    async def chunks():
        nonlocal total
        while True:
            try: chunk = await asyncio.wait_for(anext(stream), IDLE_SECONDS)
            except StopAsyncIteration: return
            total += len(chunk)
            if total > length: raise HTTPException(413, TOO_LARGE)
            for offset in range(0, len(chunk), PIECE):
                piece = chunk[offset:offset+PIECE]
                await offload(lease.check)
                yield piece
                lease.written(len(piece))
    parser = Multipart(request, chunks(), lease.directory, maximum)
    try:
        async with asyncio.timeout(RECEIVE_SECONDS):
            form = await parser.parse()
        if not parser.ended: raise HTTPException(400, 'Upload was incomplete. Please try again.')
        files = [value for key, value in form.multi_items() if key == 'files' and isinstance(value, UploadFile)]
        if not files: raise HTTPException(400, 'No files')
        return parser, files
    except TimeoutError:
        parser.close()
        raise HTTPException(408, 'Upload took too long. Please try again.') from None
    except (MultiPartException, MultipartParseError):
        parser.close()
        raise HTTPException(400, 'Invalid multipart upload') from None
    except BaseException:
        parser.close()
        raise


def save(files, directory, lease, extensions):
    # All disk copying runs in a bounded upload's worker, not on the event loop.
    Path(directory).mkdir(parents=True, exist_ok=True)
    paths = []
    for index, file in enumerate(files):
        name = re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(file.filename or 'file'))[:120] or 'file'
        if not name.lower().endswith(extensions + ('.zip',)): continue
        path = str(Path(directory) / f'{index}-{name}')
        with open(path, 'wb') as out:
            while chunk := file.file.read(PIECE):
                lease.check()
                out.write(chunk)
                lease.written(len(chunk))
        paths.append(path)
        file.file.close()
    if not paths: raise HTTPException(400, 'No FIT, GPX, TCX or ZIP files in the upload')
    return paths
