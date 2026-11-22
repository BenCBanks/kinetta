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

    def begin(self):
        capture = {}
        self._state.capture = capture
        return capture

    def end(self):
        self._state.capture = None

    def _record(self, error, raw=None):
        capture = getattr(self._state, 'capture', None)
        if capture is None:
            return
        if raw is not None and 'raw_model_json' not in capture:
            capture['raw_model_json'] = raw
        capture['validation_error_type'] = type(error).__name__
        capture['validation_error'] = str(error)
        detail=getattr(error,'diagnostic_detail',None)
        if isinstance(detail,dict):
            capture['validation_detail']=detail

    def _install(self, coach_chat):
        original_json = coach_chat._json
        original_checked = coach_chat.checked_answer
        original_gemini = coach_chat._gemini_turn
        original_claude = coach_chat._claude_turn

        def record_turn(original):
            def wrapped(*args, **kwargs):
                result = original(*args, **kwargs)
                calls, text, _ = result
                capture = getattr(self._state, 'capture', None)
                if capture is not None and not calls and 'raw_model_json' not in capture:
                    capture['raw_model_json'] = text
                return result
            return wrapped

        def parse(text):
            try:
                return original_json(text)
            except Exception as error:
                self._record(error, text)
                raise

        def check(raw, evidence, *, kit=False):
            try:
                return original_checked(raw, evidence, kit=kit)
            except Exception as error:
                self._record(error)
                raise

        coach_chat._json = parse
        coach_chat.checked_answer = check
        coach_chat._gemini_turn = record_turn(original_gemini)
        coach_chat._claude_turn = record_turn(original_claude)
