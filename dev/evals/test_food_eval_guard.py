"""Unpaid SQL checks for the disposable comparison allowance; run inside a test image."""
import datetime as dt
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
sys.path.insert(0,'/tmp');sys.path.insert(0,'/srv')
from app import db
from app.main import app
from food_eval_guard import setup,reserve,spending,output


class Guard(unittest.TestCase):
    def setUp(self):
        self.meta={'run_id':str(uuid.uuid4()),'dataset_digest':'fictional-test','mode':'baseline','dry_run':True}
        self.attempts=[];setup(self.meta)

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM zz_test_food_eval_attempts WHERE run_id=%s',(self.meta['run_id'],))
            c.execute('DELETE FROM zz_test_food_eval_provenance WHERE run_id=%s',(self.meta['run_id'],))
            c.execute('DELETE FROM zz_test_food_eval_runs WHERE id=%s',(self.meta['run_id'],))
            if self.attempts:c.execute('DELETE FROM ai_food_attempts WHERE id=ANY(%s)',(self.attempts,))

    def attempt(self,state,charge):
        aid=uuid.uuid4();self.attempts.append(aid)
        with db.connect() as c:
            c.execute('INSERT INTO ai_service_budget(day) VALUES(%s) ON CONFLICT DO NOTHING',(dt.date.today(),))
            c.execute('''INSERT INTO ai_food_attempts(id,day,model,kind,state,reserved_micros,charged_micros)
                VALUES(%s,%s,'gemini-3.1-flash-lite','fictional guard check',%s,%s,%s)''',
                (aid,dt.date.today(),state,charge,charge))
        return aid

    def test_zero_measured_reserved_and_failed_spending_serializes(self):
        self.assertEqual(spending(self.meta),{'attempts':0,'charged_micros':0,'unknown_cost_attempts':0})
        for state,charge in [('measured',100),('reserved',1000),('failed',0),('failed',1000)]:
            reserve(self.meta,self.attempt(state,charge))
        self.assertEqual(spending(self.meta),{'attempts':4,'charged_micros':2100,'unknown_cost_attempts':2})
        json.dumps(spending(self.meta))

    def test_cumulative_cap_survives_setup_again_and_rejects_changed_identity(self):
        reserve(self.meta,self.attempt('reserved',1900000));setup(self.meta)
        with self.assertRaises(RuntimeError):reserve(self.meta,self.attempt('reserved',200000))
        self.assertEqual(spending(self.meta)['charged_micros'],2100000)
        with self.assertRaises(RuntimeError):setup({**self.meta,'dataset_digest':'changed'})

    def test_output_resumes_and_never_overwrites_or_mixes_captures(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'cases.jsonl';self.assertEqual(output(path,self.meta,'fictional')[1],[])
            path.write_text('{"id":"one","passed":false}\n')
            self.assertEqual(output(path,self.meta,'fictional')[1],[{'id':'one','passed':False}])
            with self.assertRaises(RuntimeError):output(path,{**self.meta,'mode':'candidate'},'fictional')
            self.assertEqual(path.read_text(),'{"id":"one","passed":false}\n')


if __name__=='__main__':unittest.main(verbosity=2)
