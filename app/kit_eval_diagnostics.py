"""Private, thread-local diagnostics used only by the opt-in fictional Kit evaluator."""
from threading import local


def select_cases(cases, requested):
    """Return requested case tuples in suite order, rejecting misspelled IDs."""
    requested = set(requested or ())
    known = {case[0] for case in cases}
    unknown = requested - known
    if unknown:
        raise ValueError('Unknown case ID(s): ' + ', '.join(sorted(unknown)))
    return [case for case in cases if not requested or case[0] in requested]


def parse_case_ids(groups):
    """Parse repeatable/comma-separated --cases groups without changing suite order."""
    return {part.strip() for group in (groups or []) for part in group.split(',') if part.strip()}


class RejectionDiagnostics:
    """Capture final provider text and the exact failing validation exception per worker."""

    def __init__(self, coach_chat):
        self._state = local()
        self._install(coach_chat)
        # Frozen baseline bytes need not know about diagnostics. Observe the existing
        # settlement boundary to recover finish metadata before an old adapter discards it.
        budget=getattr(coach_chat,'ai_budget',None)
        if budget is not None:
            original_settle=budget.settle
            def settle(attempt,result):
                if getattr(self._state,'capture',None) is not None:
                    self._state.provider_result=result
                return original_settle(attempt,result)
            budget.settle=settle

    def begin(self):
        capture = {}
        self._state.capture = capture
        self._state.raw = None
        self._state.usage = None
        self._state.provider_result = None
        return capture

    def end(self):
        self._state.capture = None

    def attach(self, module):
        """Capture a frozen baseline through the same worker-local context as its helpers."""
        self._install(module)

    def _record(self, error, raw=None, evidence=None):
        capture = getattr(self._state, 'capture', None)
        if capture is None:return
        raw = raw if raw is not None else getattr(self._state,'raw',None)
        record = {'raw_model_json':raw,'validation_error_type':type(error).__name__,
                  'validation_error':str(error)}
        detail=getattr(error,'diagnostic_detail',None)
        if isinstance(detail,dict):record['validation_detail']=detail
        if evidence is not None:record['evidence']=evidence
        usage=getattr(self._state,'usage',None)
        if usage is not None:record['usage']=usage
        attempts=capture.setdefault('attempts',[])
        if not attempts or attempts[-1]!=record:attempts.append(record)
        # The top-level error and text now refer to the same rejected response.
        for key in ('raw_model_json','validation_error_type','validation_error','validation_detail','evidence','usage'):
            capture.pop(key,None)
        capture.update(record)

    def _install(self, coach_chat):
        original_json = coach_chat._json
        original_checked = coach_chat.checked_answer
        original_gemini = coach_chat._gemini_turn
        original_claude = coach_chat._claude_turn

        def record_turn(original):
            def wrapped(*args, **kwargs):
                self._state.provider_result=None
                result = original(*args, **kwargs)
                calls, text, _ = result
                capture = getattr(self._state, 'capture', None)
                if capture is not None:
                    payload=getattr(self._state,'provider_result',None) or {}
                    candidate=(payload.get('candidates') or [{}])[0]
                    usage={**(payload.get('usageMetadata') or {}),**result[2]}
                    if usage.get('finishReason') is None:usage['finishReason']=candidate.get('finishReason')
                    capture.setdefault('provider_turns',[]).append({
                        'finish_reason':usage.get('finishReason'),
                        'thinking_level':usage.get('thinkingLevel'),
                        'max_output_tokens':usage.get('maxOutputTokens'),
                        'tool_calls':len(calls),
                        'raw_model_json':text if not calls else None,
                        'usage':{key:usage.get(key) for key in ('promptTokenCount','candidatesTokenCount',
                                                            'thoughtsTokenCount','totalTokenCount')}})
                    if not calls:
                        self._state.raw = text
                        self._state.usage = usage
                        if usage.get('finishReason')=='MAX_TOKENS':
                            from .kit_conversation import OutputTruncated
                            self._record(OutputTruncated(),text)
                return result
            return wrapped

        def parse(text):
            self._state.raw = text
            try:
                return original_json(text)
            except Exception as error:
                self._record(error, text)
                raise

        def check(raw, evidence, **kwargs):
            capture=getattr(self._state,'capture',None)
            if capture is not None:capture['answer_evidence']=evidence
            try:
                return original_checked(raw, evidence, **kwargs)
            except Exception as error:
                self._record(error,evidence=evidence)
                raise

        coach_chat._json = parse
        coach_chat.checked_answer = check
        coach_chat._gemini_turn = record_turn(original_gemini)
        coach_chat._claude_turn = record_turn(original_claude)
