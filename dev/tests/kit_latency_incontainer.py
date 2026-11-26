"""Fictional latency guards: bounded Kit reads and prompt stream visibility."""
import asyncio
import time
from unittest.mock import patch
from app import coach, coach_chat


calls=[]
def fake_tool(self, name, arguments, *, connection=None):
    calls.append(name)
    if name=='profile':
        return {'today':'2026-11-26','tz':'UTC','units':'imperial'}
    time.sleep(.15)
    return {'features':[]} if name=='app_features' else {'activity_goals':[],'nutrition':{}}


def turn(messages, definitions):
    if len(messages)==1:
        return ([{'name':'goals','args':{}},{'name':'app_features','args':{}}], '', {})
    return ([], '{"blocks":[{"kind":"paragraph","text":"A checked fictional answer."}],"facts":[]}',
            {'promptTokenCount':10,'candidatesTokenCount':8,'totalTokenCount':18})


started=time.monotonic()
with patch('app.coach.allowed',return_value=True), patch('app.coach.provider',return_value='gemini'), \
     patch('app.coach.health_ok',return_value=True), patch('app.kit_tools.KitTools.call',new=fake_tool):
    answer=coach_chat.answer(987,'How do I use my saved goals?',kit=True,turn=turn)
elapsed=time.monotonic()-started
assert elapsed < .27, elapsed  # serial .30s; bounded parallel reads remain deterministic
assert calls[0]=='profile' and set(calls[1:])=={'goals','app_features'}, calls
assert answer['tools_used']==['profile','goals','app_features']
assert coach_chat.MAX_ROUNDS >= 2
print(f'Kit latency: two independent fictional reads overlap ({elapsed:.3f}s), evidence order and validation preserved PASS')


class Request:
    async def is_disconnected(self):
        return False


async def first_block_probe():
    import app.kit_stream as stream
    ready = asyncio.Event()

    def fake_generate(*_args):
        time.sleep(.15)
        ready.set()
        return {'state': 'answered'}

    def fake_current(*_args):
        return {'state': 'answered' if ready.is_set() else 'running',
                'answer': {'answer_blocks': [{'kind': 'paragraph', 'text': 'Checked fictional block.'}]}}

    started = time.monotonic()
    with patch.object(stream, 'generate', side_effect=fake_generate), patch.object(stream, 'current', side_effect=fake_current):
        async for chunk in stream.events(987, '00000000-0000-0000-0000-000000000001',
                                         type('Body', (), {'generation': 1, 'visit_id': None})(), Request()):
            if 'event: block' in chunk:
                return time.monotonic() - started
    raise AssertionError('stream ended without a first block')


first_block = asyncio.run(first_block_probe())
assert first_block < .5, first_block  # .15s worker + at most two .1s polls
print(f'Kit stream: first validated fictional block visible after {first_block:.3f}s with bounded polling PASS')
