"""Fixed fictional clock, installed only in an isolated disposable evaluator process."""
import datetime as dt
import importlib.abc
import importlib.machinery
import os
import sys
import types

FIXTURE_DATE = '2026-11-26'
INSTANT = dt.datetime.fromisoformat(FIXTURE_DATE+'T12:00:00+00:00')


class DateMeta(type):
    def __instancecheck__(cls, value): return isinstance(value,dt.date)


class DateTimeMeta(type):
    def __instancecheck__(cls, value): return isinstance(value,dt.datetime)


class Date(dt.date, metaclass=DateMeta):
    @classmethod
    def today(cls): return INSTANT.date()


class DateTime(dt.datetime, metaclass=DateTimeMeta):
    @classmethod
    def now(cls, tz=None):
        return INSTANT.astimezone(tz) if tz else INSTANT.replace(tzinfo=None)

    @classmethod
    def utcnow(cls): return INSTANT.replace(tzinfo=None)


CLOCK = types.SimpleNamespace(**{k:getattr(dt,k) for k in dir(dt) if not k.startswith('__')})
CLOCK.date, CLOCK.datetime = Date, DateTime


def patch_module(module):
    # Pricing expiry is a real safety deadline, not a fictional record date.
    if not module.__name__.startswith('app.') or module.__name__.endswith('.ai_budget'): return
    for name, value in list(vars(module).items()):
        if value is dt: setattr(module,name,CLOCK)
        elif value is dt.datetime: setattr(module,name,DateTime)
        elif value is dt.date: setattr(module,name,Date)


class FrozenImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if not fullname.startswith('app.'): return None
        spec=importlib.machinery.PathFinder.find_spec(fullname,path)
        if spec and hasattr(spec.loader,'exec_module'):
            original=spec.loader.exec_module
            def execute(module):
                original(module); patch_module(module)
            spec.loader.exec_module=execute
        return spec


def install(db):
    if (os.environ.get('KINETTA_JOURNEY_FIXTURE'),os.environ.get('KINETTA_KIT_EVAL_ISOLATED'))!=('1','1'):
        raise ValueError('Fixture clock requires both disposable-evaluator guards')
    from psycopg import sql
    # Shadow unqualified now() in this process's connections, including coach-role
    # reads. Existing defaults bind pg_catalog.now at creation, so rebind those in
    # the disposable copy too. Never rewrite baseline files or SQL query strings.
    with db.connect() as c:
        c.execute('CREATE SCHEMA kit_eval_clock')
        c.execute(sql.SQL("CREATE FUNCTION kit_eval_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS {}")
                  .format(sql.Literal("SELECT '"+INSTANT.isoformat()+"'::timestamptz")))
        c.execute('GRANT USAGE ON SCHEMA kit_eval_clock TO PUBLIC')
        defaults=c.execute("""SELECT table_name,column_name,column_default FROM information_schema.columns
          WHERE table_schema='public' AND column_default LIKE '%%now()%%'""").fetchall()
        for row in defaults:
            expression=row['column_default'].replace('now()','kit_eval_clock.now()')
            c.execute(sql.SQL('ALTER TABLE {} ALTER COLUMN {} SET DEFAULT '+expression).format(
                sql.Identifier(row['table_name']),sql.Identifier(row['column_name'])))
    db.pool().close(); db._pool=None
    db.CONNINFO += " options='-csearch_path=kit_eval_clock,pg_catalog,public'"
    sys.meta_path.insert(0,FrozenImports())
    for module in list(sys.modules.values()):
        if module is not None: patch_module(module)
