#!/usr/bin/env python3
"""Explicit screen-to-browser-test contracts used by the Draft changed-screen gate."""
import argparse
import fnmatch
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / 'dev/tests/ui_contracts.json'


def load_contracts(manifest=DEFAULT_MANIFEST):
    try:
        document = json.loads(Path(manifest).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f'cannot read UI contract manifest {manifest}: {exc}') from exc
    contracts = document.get('contracts') if isinstance(document, dict) else None
    if not isinstance(contracts, list) or not contracts:
        raise ValueError('UI contract manifest must contain a non-empty contracts array')
    names = set()
    for contract in contracts:
        if not isinstance(contract, dict):
            raise ValueError('each UI contract must be an object')
        screen = contract.get('screen')
        sources = contract.get('sources')
        tests = contract.get('tests')
        assertions = contract.get('assertions')
        if not isinstance(screen, str) or not screen.strip() or screen in names:
            raise ValueError(f'UI contract screen must be non-empty and unique: {screen!r}')
        names.add(screen)
        if not isinstance(sources, list) or not sources or not all(isinstance(item, str) and item.startswith('app/static/') for item in sources):
            raise ValueError(f'{screen}: sources must be app/static paths or patterns')
        if not isinstance(tests, list) or not tests or not all(isinstance(item, str) and item.endswith('_ui.cjs') for item in tests):
            raise ValueError(f'{screen}: tests must name one or more *_ui.cjs files')
        if len(set(tests)) != len(tests):
            raise ValueError(f'{screen}: test names must be unique')
        if not isinstance(assertions, list) or not assertions or not all(isinstance(item, str) and item.strip() for item in assertions):
            raise ValueError(f'{screen}: list the exact-copy/selector contracts being protected')
        for source in sources:
            if not any(path.is_file() for path in ROOT.glob(source)):
                raise ValueError(f'{screen}: source pattern matches no file: {source}')
        for test in tests:
            if not (ROOT / 'dev/tests' / test).is_file():
                raise ValueError(f'{screen}: mapped contract test is missing: {test}')
    return contracts


def tests_for(paths, contracts):
    selected = []
    for contract in contracts:
        if any(fnmatch.fnmatchcase(path, pattern) for path in paths for pattern in contract['sources']):
            for test in contract['tests']:
                if test not in selected:
                    selected.append(test)
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--validate', action='store_true')
    mode.add_argument('--tests-for', nargs='+', metavar='PATH')
    args = parser.parse_args()
    try:
        contracts = load_contracts(args.manifest)
        if args.validate:
            print(f'Validated {len(contracts)} screen copy/selector contracts.')
        else:
            print('\n'.join(tests_for(args.tests_for, contracts)))
    except ValueError as exc:
        print(f'UI contract map error: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
