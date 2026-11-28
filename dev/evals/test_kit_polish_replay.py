"""Offline copy gates: unsafe claims remain the app's job; robotic/repeated copy fails replay."""
import contextlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import kit_polish_replay
from kit_polish_replay import wording_issues


def rendered(*texts,kind='paragraph'):
    blocks=([dict(kind='list',items=list(texts))] if kind=='list' else
            [dict(kind='paragraph',text=t) for t in texts])
    return dict(status='pass',blocks=blocks,text='\n\n'.join(texts))


class CopyRubric(unittest.TestCase):
    def test_robotic_weekly_copy(self):
        for count in ('1 workout','3 workouts','N workouts'):
            for kind in ('paragraph','list'):
                with self.subTest(count=count,kind=kind):
                    self.assertIn('robotic_review_wording',wording_issues(rendered(
                        f'You logged {count} during this review period.',kind=kind)))
        self.assertEqual(wording_issues(rendered('You logged 3 workouts over the past week.')),[])

    def test_old_inventory_phrases(self):
        for text in ('Training volume was 3 workouts.','Recorded distance reached 9.3 mi.'):
            self.assertIn('robotic_review_wording',wording_issues(rendered(text)))

    def test_original_duplicate_meal_suggestions(self):
        for kind in ('paragraph','list'):
            self.assertIn('repeated_next_step',wording_issues(rendered(
                'For your next step, pick a convenient time to log your next full meal.',
                'Log your next meal as you eat it, including drinks and snacks.',kind=kind)))

    def test_repeated_other_instruction(self):
        for kind in ('paragraph','list'):
            self.assertIn('repeated_next_step',wording_issues(rendered(
                'You could open Progress and look at your weight entries together.',
                'YOU COULD open Progress and look at your weight entries together!',kind=kind)))

    def test_past_description_is_not_second_suggestion(self):
        self.assertEqual(wording_issues(rendered('You were logging your next meal in the app.',
            'You could log your next meal as you eat it.')),[])

    def test_single_invitation_and_distinct_actions(self):
        self.assertEqual(wording_issues(rendered('You logged 2 workouts over the past week.',
            'You could log your next full meal.')),[])
        self.assertEqual(wording_issues(rendered('Open Progress and look at your weight entries.',
            'Add a note about how your routine has changed.')),[])

    def test_model_rejections_are_not_copy_successes(self):
        self.assertEqual(wording_issues(dict(status='reject',text='Training volume was 3 workouts.')),[])


class ReplayExit(unittest.TestCase):
    def run_replay(self,before,after,path):
        rows=iter(([before],[after]))
        def output(command,**kwargs):
            if command[0]=='docker':return json.dumps(next(rows)).encode()
            if 'archive' in command:return b''
            return 'a'*40+'\n'
        args=['replay','--captures',str(path.parent),'--baseline-commit','baseline','--output',str(path)]
        payload=dict(cases=[dict(id='fictional-case')],source_files=[])
        with patch('sys.argv',args),patch.object(kit_polish_replay,'collect',return_value=payload), \
             patch.object(kit_polish_replay.subprocess,'check_output',side_effect=output), \
             patch.object(kit_polish_replay.subprocess,'run'),contextlib.redirect_stdout(io.StringIO()):
            kit_polish_replay.main()

    def test_bad_candidate_fails_command_and_records_reason(self):
        for texts,reason in [(['You logged 3 workouts during this review period.'],'robotic_review_wording'),
                             (['Log your next full meal.','Log your next meal as you eat it.'],'repeated_next_step')]:
            row=dict(rendered(*texts),id='fictional-case',cases=['fixture'],mode='answer',facts=[])
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as directory:
                out=Path(directory)/'replay.json'
                with self.assertRaisesRegex(SystemExit,'wording rubric failed'):self.run_replay(row,row,out)
                report=json.loads(out.read_text())
                self.assertEqual(report['regressions'],[])
                self.assertIn(reason,report['quality_failures'][0]['issues'])
                self.assertEqual(out.stat().st_mode&0o777,0o600)

    def test_bad_baseline_does_not_block_clean_candidate(self):
        before=dict(rendered('You logged 3 workouts during this review period.'),
                    id='fictional-case',cases=['fixture'],mode='answer',facts=[])
        after=dict(before,**rendered('You logged 3 workouts over the past week.'))
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory)/'replay.json';self.run_replay(before,after,out)
            self.assertEqual(json.loads(out.read_text())['quality_failures'],[])


if __name__=='__main__':unittest.main()
