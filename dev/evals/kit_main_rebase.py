"""Closed proof for the reviewed main rebase; no general cache equivalence."""
import ast
import subprocess

PREVIOUS = '821e0b2a98c7a3339e7edc731795dc26b7e2705a'
MAIN = 'd9db53a4'
SOURCE = '301042116bf581b1c1257bc1a31b81cdd3e2e5f0'


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True)


def migrations(source):
    return ast.literal_eval(next(n.value for n in ast.parse(source).body
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MIGRATIONS' for t in n.targets)))


def verify(root):
    # Every byte is pinned, including approved client designs and non-Kit APIs.
    if git(root, 'diff', '--name-only', SOURCE, '--', 'app').strip():
        raise ValueError('App changed after the reviewed main rebase')
    paths = set(git(root, 'diff', '--name-only', PREVIOUS, SOURCE, '--', 'app').splitlines())
    if {p for p in paths if p.endswith('.py')} != {'app/db.py', 'app/admin_review.py', 'app/api_mydata.py'}:
        raise ValueError('Unexpected Python provider input changed on rebase')
    for path in paths - {'app/db.py', 'app/static/kit.js', 'app/static/style.css'}:
        if git(root, 'show', SOURCE + ':' + path) != git(root, 'show', MAIN + ':' + path):
            raise ValueError('Main-only source was changed: ' + path)
    # Database helpers are identical; only additive, byte-preserved migrations move.
    before = git(root, 'show', PREVIOUS + ':app/db.py')
    after = git(root, 'show', SOURCE + ':app/db.py')
    def helpers(source):
        tree = ast.parse(source)
        tree.body = [n for n in tree.body if not (isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == 'MIGRATIONS' for t in n.targets))]
        return ast.dump(tree, include_attributes=False)
    if helpers(before) != helpers(after):
        raise ValueError('Database request helpers changed')
    old, current = migrations(before), migrations(after)
    shipped = migrations(git(root, 'show', MAIN + ':app/db.py'))
    if len(current) != 123 or current[:121] != shipped or current[121] != old[120] or current[122].replace('-- 123:', '-- 122:') != old[121]:
        raise ValueError('Shipped migrations or Kit upgrade order changed')
    return paths
