from __future__ import annotations
import unittest,tempfile,json,sys,io,contextlib,datetime as dt
from symlink_support import requires_symlink
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tutor_runtime as r
import install_tutor as ins
class Contracts(unittest.TestCase):pass
for n in range(1,23):
 def check(self,n=n):
  c=r.contract(n);self.assertEqual(c['number'],n);self.assertTrue(c['outcome']);self.assertTrue(c['start_state']);self.assertTrue(c['out_of_scope']);self.assertGreaterEqual(len(c['objectives']),5)
  folder=r.BASE/'chapters'/f'ch{n:02}'
  for name in ['tutor.md','hints.md','verification.md','prompts.md']:
   self.assertTrue((folder/name).is_file());self.assertGreater((folder/name).stat().st_size,200)
  for h in c['hint_topics']:self.assertEqual(len(h['levels']),3);self.assertTrue(h['solution'])
 setattr(Contracts,f'test_chapter_{n:02}_contract_and_companion',check)
class Runtime(unittest.TestCase):
 def setUp(self):
  # canonical() is what the CLI does with --project, so the test root must be
  # resolved too: on macOS a temp dir is /var/folders/... where /var itself is a
  # symlink, and an unresolved root makes every safe_path() check fail.
  self.t=tempfile.TemporaryDirectory();self.p=r.canonical(self.t.name);(self.p/'proof.md').write_text('Synthetic unit-test fixture. Not an actual account, app, or API execution.',encoding='utf-8');self.c=r.contract(1)
 def tearDown(self):self.t.cleanup()
 def add(self,c=None,index=0,**kw):
  c=c or self.c;o=c['objectives'][index]
  data=dict(root=self.p,c=c,oid=o['id'],kind=o['evidence_types'][0],outcome=o['expected_outcome'],artifact='proof.md',environment='live' if o['environment']=='actual-account-or-service' else 'manual',observer='reader',apply=True);data.update(kw)
  return r.add_evidence(**data)
 def all(self,c=None):
  c=c or self.c
  for i in range(len(c['objectives'])):self.add(c,i)
 def test_new_progress_zero(self):self.assertEqual(r.status(self.p,self.c)['completed'],0)
 def test_start_does_not_create_files(self):
  before=r.fingerprint(self.p);r.show_start(self.p,self.c);self.assertEqual(r.fingerprint(self.p),before);self.assertFalse((self.p/r.STATE).exists())
 def test_progress_does_not_create_records(self):r.status(self.p,self.c);self.assertFalse((self.p/r.STATE).exists())
 def test_next_first_unmet(self):self.assertEqual(r.status(self.p,self.c)['next_action']['id'],'ch01-g01')
 def test_one_record_counts_one(self):self.add();self.assertEqual(r.status(self.p,self.c)['completed'],1)
 def test_three_records_counts_three_not_four(self):
  for i in range(3):self.add(index=i)
  q=r.status(self.p,self.c);self.assertEqual(q['completed'],3);self.assertEqual(q['progress_text'],'3/6 확인 완료')
 def test_duplicate_records_not_double_counted(self):self.add();self.add();self.assertEqual(r.status(self.p,self.c)['completed'],1)
 def test_dryrun_record_is_readonly(self):self.add(apply=False);self.assertFalse((self.p/r.STATE).exists())
 def test_all_verified_complete(self):self.all();self.assertTrue(r.status(self.p,self.c)['chapter_complete'])
 def test_invalid_evidence_kind_rejected(self):
  with self.assertRaises(ValueError):self.add(kind='live-api')
 def test_outside_artifact_rejected(self):
  with self.assertRaises(ValueError):self.add(artifact='../outside.md')
 def test_absolute_artifact_rejected(self):
  with self.assertRaises(ValueError):self.add(artifact=str(self.p/'proof.md'))
 def test_secret_file_rejected(self):
  (self.p/'.env').write_text('NEVER_PRINT_ME=placeholder',encoding='utf-8')
  with self.assertRaises(ValueError):self.add(artifact='.env')
 def test_missing_artifact_rejected(self):
  with self.assertRaises(ValueError):self.add(artifact='missing.md')
 def test_artifact_change_is_stale(self):
  self.add();(self.p/'proof.md').write_text('changed',encoding='utf-8');self.assertEqual(r.status(self.p,self.c)['objectives'][0]['status'],'stale')
 def test_project_change_invalidates_run_evidence(self):
  for i in range(3):self.add(index=i)
  (self.p/'app.py').write_text('changed',encoding='utf-8')
  q=r.status(self.p,self.c);self.assertEqual(q['objectives'][2]['status'],'stale')
 def test_private_state_not_project_fingerprint(self):
  before=r.fingerprint(self.p);self.add();self.assertEqual(r.fingerprint(self.p),before)
 def test_failed_is_not_complete(self):self.add(outcome='fail');self.assertEqual(r.status(self.p,self.c)['objectives'][0]['status'],'failed')
 def test_environment_block_not_complete(self):self.add(outcome='blocked');self.assertEqual(r.status(self.p,self.c)['objectives'][0]['status'],'blocked')
 def test_future_goal_requires_predecessor(self):self.add(index=2);self.assertEqual(r.status(self.p,self.c)['completed'],0)
 def test_live_goal_rejects_simulation(self):
  c=r.contract(6)
  with self.assertRaises(ValueError):self.add(c,4,environment='simulation')
 def test_mock_cannot_replace_live_type(self):
  c=r.contract(6)
  with self.assertRaises(ValueError):self.add(c,4,kind='test-run',environment='local')
 def test_ch13_planning_can_complete_without_app(self):
  c=r.contract(13);self.all(c);self.assertTrue(r.status(self.p,c)['chapter_complete']);self.assertFalse((self.p/'app').exists())
 def test_intentional_failure_record_survives_intended_fix(self):
  c=r.contract(3)
  for i in range(5):self.add(c,i)
  (self.p/'report.py').write_text('corrected calculation',encoding='utf-8')
  self.add(c,5)
  q=r.status(self.p,c)
  self.assertEqual(q['objectives'][1]['status'],'verified')
  self.assertTrue(q['chapter_complete'])
 def test_ch17_expected_damage_is_success_goal(self):
  c=r.contract(17);self.all(c);q=r.status(self.p,c);self.assertTrue(q['chapter_complete']);self.assertEqual(q['completed'],6)
 def test_ch17_plain_pass_does_not_replace_damage_detection(self):
  c=r.contract(17)
  for i in range(4):self.add(c,i)
  self.add(c,4,outcome='pass');self.assertEqual(r.status(self.p,c)['objectives'][4]['status'],'failed')
 def test_hint_returns_only_first_level(self):
  c=r.contract(11);h=c['hint_topics'][0];q=r.hint(c,h['id'],1);self.assertEqual(q['text'],h['levels'][0]);self.assertNotIn(h['solution'],q['text'])
 def test_hint_level4_is_explicit_solution_only(self):
  c=r.contract(11);h=c['hint_topics'][0];self.assertEqual(r.hint(c,h['id'],4)['text'],h['solution'])
 def test_bad_hint_id_rejected(self):
  with self.assertRaises(ValueError):r.hint(self.c,'H99-99',1)
 def test_bad_hint_level_rejected(self):
  with self.assertRaises(ValueError):r.hint(self.c,self.c['hint_topics'][0]['id'],5)
 def test_ch07_out_of_scope_ui(self):self.assertIn('웹 UI',r.contract(7)['out_of_scope'])
 def test_ch18_verify_not_upload_authorization(self):self.assertTrue(all(not x['external_side_effects_authorized_by_verify'] for x in r.contract(18)['objectives']))
 def test_changed_contract_hash_invalidates_record(self):
  self.add();p=self.p/r.STATE/'ch01.json';v=json.loads(p.read_text(encoding='utf-8'));v['evidence'][0]['contract_sha256']='0'*64;p.write_text(json.dumps(v),encoding='utf-8');self.assertEqual(r.status(self.p,self.c)['objectives'][0]['status'],'stale')
 def test_future_timestamp_invalidates(self):
  self.add();p=self.p/r.STATE/'ch01.json';v=json.loads(p.read_text(encoding='utf-8'));v['evidence'][0]['observed_at']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)).isoformat();p.write_text(json.dumps(v),encoding='utf-8');self.assertEqual(r.status(self.p,self.c)['completed'],0)
 @requires_symlink
 def test_symlink_artifact_rejected(self):
  (self.p/'link.md').symlink_to(self.p/'proof.md')
  with self.assertRaises(ValueError):self.add(artifact='link.md')
 @requires_symlink
 def test_symlinked_project_root_still_reads_project_paths(self):
  real=self.p/'real';real.mkdir();link=self.p/'link';link.symlink_to(real,target_is_directory=True)
  (real/'proof.md').write_text('Synthetic unit-test fixture. Not an actual account, app, or API execution.',encoding='utf-8')
  q=self.add(root=link,apply=False);self.assertEqual(q['evidence']['artifact'],'proof.md');self.assertEqual(r.status(link,self.c)['completed'],0)
class PlanBuildContracts(unittest.TestCase):
 ALIASES={'outcome':'will_complete_this_chapter','start_state':'carry_forward_state','previously_completed_features':'carry_forward_features'}
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.p=Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def test_legacy_aliases_point_at_the_same_values(self):
  for n in (21,22):
   c=r.contract(n)
   for old,new in self.ALIASES.items():
    self.assertTrue(c[new]);self.assertEqual(c[old],c[new]);self.assertEqual(c['legacy_field_aliases'][old],new)
 def test_start_view_reports_current_contract_text(self):
  for n in (21,22):
   c=r.contract(n);q=r.show_start(self.p,c)
   self.assertEqual(q['goal'],c['will_complete_this_chapter']);self.assertEqual(q['required_start_state'],c['carry_forward_state'])
   self.assertFalse(q['did_execute_or_replace']);self.assertEqual(q['progress']['completed'],0)
 def test_contract_revision_claims_no_execution_or_source(self):
  for n in (21,22):
   c=r.contract(n)
   self.assertEqual(c['module_revision'],'plan-build-v2')
   self.assertIn('unverified',c['new_part6_execution_status']);self.assertIn('unbound',c['source_reference_status'])
class Installer(unittest.TestCase):
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.p=Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def run_install(self,*args):
  with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):return ins.main(['--project',str(self.p),*args])
 def test_dryrun_writes_nothing(self):self.assertEqual(self.run_install(),0);self.assertEqual(list(self.p.iterdir()),[])
 def test_apply_two_tools(self):
  self.assertEqual(self.run_install('--apply'),0)
  for f in ['.claude/skills/book-tutor/SKILL.md','.agents/skills/book-tutor/SKILL.md','CLAUDE.local.md','AGENTS.md']:self.assertTrue((self.p/f).exists())
 def test_existing_user_rules_preserved(self):
  (self.p/'AGENTS.md').write_text('KEEP_USER_RULES\n',encoding='utf-8');self.run_install('--apply');self.assertIn('KEEP_USER_RULES',(self.p/'AGENTS.md').read_text(encoding='utf-8'))
 def test_idempotent_block(self):
  self.run_install('--apply');self.run_install('--apply');self.assertEqual((self.p/'AGENTS.md').read_text(encoding='utf-8').count(ins.BEGIN),1)
 def test_modified_skill_not_overwritten(self):
  self.run_install('--apply');q=self.p/'.agents/skills/book-tutor/SKILL.md';q.write_text('KEEP CUSTOM',encoding='utf-8');self.assertEqual(self.run_install('--apply'),2);self.assertEqual(q.read_text(encoding='utf-8'),'KEEP CUSTOM')
 def test_existing_other_skill_not_overwritten(self):
  q=self.p/'.agents/skills/book-tutor/SKILL.md';q.parent.mkdir(parents=True);q.write_text('OTHER',encoding='utf-8');self.assertEqual(self.run_install('--apply'),2)
 def test_broken_block_rejected(self):
  (self.p/'AGENTS.md').write_text(ins.BEGIN,encoding='utf-8');self.assertEqual(self.run_install('--apply'),2);self.assertFalse((self.p/'.claude').exists())
 def test_no_exercise_programs_created(self):
  self.run_install('--apply');self.assertFalse((self.p/'movie-report').exists());self.assertFalse((self.p/'package.json').exists())
if __name__=='__main__':unittest.main()
