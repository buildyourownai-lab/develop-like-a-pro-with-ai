import copy, importlib.util, json, shutil, tempfile, unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('binder_part6',BASE/'bind_sources.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Part6Binding(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.out=tempfile.TemporaryDirectory();self.outside=Path(self.out.name)
  self.r=json.loads((BASE/'source-registry.json').read_text())
 def tearDown(self):self.tmp.cleanup();self.out.cleanup()
 def src(self,n):
  p=self.root/'chapters'/f'ch{n:02}'/'source';p.mkdir(parents=True);(p/'example.py').write_text('example = True\n');return p
 def mark(self,n,files=None,revision='part6-services-v1'):
  f=self.root/'chapters'/f'ch{n:02}'/'source';(f.parent/'source-revision.json').write_text(json.dumps({'revision':revision,'project':self.r['chapters'][f'ch{n:02}']['project'],'files':mod.snapshot(f) if files is None else files}))
 def test_old_unmarked_source_is_not_bound(self):
  self.src(19);r=mod.bind(self.root,self.r);self.assertEqual(r['chapters']['ch19']['availability'],'not_bound')
 def test_wrong_revision_is_not_bound(self):
  self.src(20);self.mark(20,revision='old-remote');r=mod.bind(self.root,self.r);self.assertEqual(r['chapters']['ch20']['availability'],'not_bound')
 def test_wrong_hash_is_not_bound(self):
  self.src(22);self.mark(22,files={'example.py':'wrong'});r=mod.bind(self.root,self.r);self.assertEqual(r['chapters']['ch22']['availability'],'not_bound')
 def test_marked_source_still_not_execution_verified(self):
  self.src(19);self.mark(19);r=mod.bind(self.root,self.r);self.assertEqual(r['chapters']['ch19']['availability'],'files_present_not_executed');self.assertFalse(r['chapters']['ch19']['execution_verified'])
 def start21(self,mark=True,**over):
  p=self.root/'chapters'/'ch21'/'start';p.mkdir(parents=True);(p/'example.py').write_text('example = True\n')
  if mark:self.markstart21(**over)
  return p
 def markstart21(self,**over):
  p=self.root/'chapters'/'ch21'/'start'
  m={'revision':'part6-services-v1','contract_revision':'plan-build-v2','project':self.r['chapters']['ch21']['project'],'snapshot_role':'START','files':mod.snapshot(p)}
  m.update(over);(p.parent/'start-revision.json').write_text(json.dumps(m))
 def test_ch21_start_is_declared_start_snapshot_not_previous_chapter(self):
  ch12=self.src(12);self.src(20);self.src(21);self.mark(21);start=self.start21()
  r=mod.bind(self.root,self.r);v=r['chapters']['ch21']
  self.assertEqual(v['start_local_path'],str(start));self.assertNotIn('start_binding_note',v)
  self.assertNotEqual(v['start_local_path'],str(ch12));self.assertNotEqual(v['start_local_path'],str(self.root/'chapters'/'ch20'/'source'))
 def test_ch12_entry_unchanged_by_ch21_start(self):
  self.src(11);ch12=self.src(12);self.src(21);self.mark(21);self.start21()
  r=mod.bind(self.root,self.r);v=r['chapters']['ch12']
  self.assertEqual(v['finish_local_path'],str(ch12));self.assertEqual(v['start_local_path'],str(self.root/'chapters'/'ch11'/'source'))
  self.assertNotIn('start_path',v);self.assertNotIn('start_binding_note',v);self.assertFalse(v['execution_verified'])
 def test_missing_declared_start_is_refused(self):
  self.src(21);self.mark(21);r=mod.bind(self.root,self.r);v=r['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('missing',v['start_binding_note'])
 def test_unsafe_declared_start_is_refused(self):
  self.src(21);self.mark(21);self.start21();outside=self.outside/'start'
  outside.mkdir();(outside/'example.py').write_text('example = True\n')
  for bad in ['../','..','../start',str(outside),'/etc','','   ','.',None,12,['chapters/ch21/start']]:
   r=copy.deepcopy(self.r);r['chapters']['ch21']['start_path']=bad
   q=mod.bind(self.root,r)['chapters']['ch21']
   self.assertIsNone(q['start_local_path'],bad);self.assertTrue(q['start_binding_note'],bad)
 def test_declared_start_symlink_out_of_root_is_refused(self):
  outside=self.outside/'linked-start';outside.mkdir()
  self.src(21);self.mark(21);(self.root/'chapters'/'ch21'/'start').symlink_to(outside,target_is_directory=True)
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('source-root',v['start_binding_note'])
 def test_declared_start_without_marker_is_refused(self):
  self.src(12);self.src(20);self.src(21);self.mark(21);self.start21(mark=False)
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('start-revision.json',v['start_binding_note'])
 def test_declared_start_marker_broken_json_is_refused(self):
  self.src(21);self.mark(21);p=self.start21();(p.parent/'start-revision.json').write_text('{not json')
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('valid JSON',v['start_binding_note'])
 def test_declared_start_marker_not_an_object_is_refused(self):
  self.src(21);self.mark(21);p=self.start21();(p.parent/'start-revision.json').write_text('[]')
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('JSON object',v['start_binding_note'])
 def test_empty_or_secret_only_declared_start_is_refused(self):
  self.src(21);self.mark(21);p=self.start21();(p/'example.py').unlink();(p/'.env').write_text('EXAMPLE=not-a-real-secret\n')
  self.markstart21(files={})
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('no snapshot files',v['start_binding_note'])
 def test_tampered_declared_start_is_refused(self):
  # Marker stays as published while a START file is edited: hashes must stop matching.
  self.src(21);self.mark(21);p=self.start21();(p/'example.py').write_text('example = False\n')
  v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertIsNone(v['start_local_path']);self.assertIn('file hashes',v['start_binding_note'])
 def test_declared_start_marker_field_mismatches_are_refused(self):
  cases={'project':({'project':'ai-media-works'},'project'),'revision':({'revision':'old-remote'},'Sourcepack'),
   'contract_revision':({'contract_revision':'plan-build-v1'},'contract_revision'),'role':({'snapshot_role':'FINISH'},'snapshot_role'),
   'extra_file':({'files':{'example.py':'x','ghost.py':'y'}},'file hashes'),'missing_files_key':({'files':None},'file hashes')}
  for name,(over,expect) in cases.items():
   with self.subTest(name):
    shutil.rmtree(self.root/'chapters',ignore_errors=True)
    self.src(12);self.src(20);self.src(21);self.mark(21);self.start21();self.markstart21(**over)
    v=mod.bind(self.root,self.r)['chapters']['ch21']
    self.assertIsNone(v['start_local_path']);self.assertIn(expect,v['start_binding_note'])
    self.assertNotEqual(v['start_local_path'],str(self.root/'chapters'/'ch12'/'source'))
 def test_valid_declared_start_binds_independently_of_finish(self):
  start=self.start21();v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertEqual(v['start_local_path'],str(start));self.assertNotIn('start_binding_note',v)
  self.assertEqual(v['availability'],'not_bound');self.assertIsNone(v['finish_local_path']);self.assertFalse(v['execution_verified'])
 def test_valid_declared_start_does_not_bind_unmarked_finish(self):
  self.src(21);self.start21();v=mod.bind(self.root,self.r)['chapters']['ch21']
  self.assertEqual(v['availability'],'not_bound');self.assertIsNone(v['finish_local_path']);self.assertIn('missing',v['binding_note'])
 def test_default_previous_chapter_start_preserved(self):
  ch10=self.src(10);self.src(11);ch21=self.src(21);self.mark(21);self.start21();self.src(22);self.mark(22)
  r=mod.bind(self.root,self.r)
  self.assertEqual(r['chapters']['ch11']['start_local_path'],str(ch10))
  self.assertEqual(r['chapters']['ch22']['start_local_path'],str(ch21))
 def test_first_chapters_of_a_project_still_have_no_start(self):
  self.src(8);self.src(9);self.mark(9);r=mod.bind(self.root,self.r);self.assertIsNone(r['chapters']['ch09']['start_local_path'])
 def test_empty_or_secret_only_source_is_not_bound(self):
  p=self.src(19);(p/'example.py').unlink();(p/'.env').write_text('EXAMPLE=not-a-real-secret\n');r=mod.bind(self.root,self.r);self.assertEqual(r['chapters']['ch19']['availability'],'not_bound')
 def test_contract_revision_is_separate_from_sourcepack_format(self):
  for cid in ['ch21','ch22']:
   v=self.r['chapters'][cid];self.assertEqual(v['required_revision'],'part6-services-v1');self.assertEqual(v['contract_revision'],'plan-build-v2')
 def test_plan_build_chapters_without_marker_stay_not_bound(self):
  self.src(21);self.src(22);r=mod.bind(self.root,self.r)
  for cid in ['ch21','ch22']:self.assertEqual(r['chapters'][cid]['availability'],'not_bound')
 def test_contract_revision_does_not_block_sourcepack_binding(self):
  self.src(22);self.mark(22);r=mod.bind(self.root,self.r)
  self.assertEqual(r['chapters']['ch22']['availability'],'files_present_not_executed');self.assertFalse(r['chapters']['ch22']['execution_verified'])
 def test_source_symlink_rejected(self):
  p=self.src(19);(p/'link').symlink_to(p/'example.py')
  with self.assertRaises(ValueError):mod.bind(self.root,self.r)
if __name__=='__main__':unittest.main()
