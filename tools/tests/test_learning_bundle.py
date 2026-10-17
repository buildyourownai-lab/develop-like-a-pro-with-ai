import hashlib,importlib.util,json,tempfile,unittest,os,subprocess,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',Path(__file__).resolve().parents[1]/'build_learning_bundle.py')
bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)
ROOT=Path(__file__).resolve().parents[2]
MANUSCRIPT=Path(os.environ['BOOK_MANUSCRIPT_ROOT']) if os.environ.get('BOOK_MANUSCRIPT_ROOT') else None
class ExtractionTests(unittest.TestCase):
 def test_spaces_unicode_and_internal_fence(self):
  body='  한글 e\u0301 😀\n```python\npass\n```\n  '
  self.assertEqual(bundle.prompts('~~~prompt\n'+body+'\n~~~\n'),[body])
 def test_unclosed_is_error(self):
  with self.assertRaises(ValueError):bundle.prompts('~~~prompt\nunfinished')
 def test_bom_and_cr_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'input.txt'
   for raw in [b'\xef\xbb\xbftext\n',b'text\r\n',b'\xff']:
    p.write_bytes(raw)
    with self.assertRaises((ValueError,UnicodeDecodeError)):bundle.strict(p)
 def test_input_path_traversal_and_symlinks(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();(root/'inside').mkdir();(root/'outside.txt').write_text('not a bundle input')
   for name in ['../outside.txt','/etc/passwd']:
    with self.assertRaises(ValueError):bundle.safe_path(root/'inside',name)
   (root/'inside/link').symlink_to(root/'outside.txt')
   with self.assertRaises(ValueError):bundle.safe_path(root/'inside','link')
   (root/'inside/folder').symlink_to(root,target_is_directory=True)
   with self.assertRaises(ValueError):bundle.safe_path(root/'inside','folder/outside.txt')
 def test_nonempty_and_symlink_output_preserves_data(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();out=root/'output';out.mkdir();marker=out/'keep.txt';marker.write_text('preserve')
   with self.assertRaises(ValueError):bundle.build(ROOT,ROOT,out)
   self.assertEqual(marker.read_text(),'preserve')
   link=root/'link';link.symlink_to(out,target_is_directory=True)
   with self.assertRaises(ValueError):bundle.build(ROOT,ROOT,link)
@unittest.skipUnless(MANUSCRIPT and MANUSCRIPT.is_dir(),'Set BOOK_MANUSCRIPT_ROOT for author-only parity test')
class SourceParityTests(unittest.TestCase):
 def test_bundled_support_runs_without_source_checkout(self):
  with tempfile.TemporaryDirectory() as tmp:
   output=Path(tmp).resolve()/'release';m=bundle.build(ROOT,MANUSCRIPT,output,include_support=True)
   base=output/'books/develop/editions/development-2026'/m['content_revision']
   self.assertTrue(m['support_files_included'])
   self.assertEqual(sum(f['role']=='support-code' for f in m['files']),4)
   command=[sys.executable,str(base/'support/studyailab.py'),'verify-bundle','--bundle',str(base/'manifest.json'),'--book','develop','--edition','development-2026']
   result=subprocess.run(command,cwd=base,check=True,capture_output=True,text=True)
   self.assertEqual(json.loads(result.stdout)['bundle_sha256'],m['bundle_sha256'])
   self.assertFalse(list(base.rglob('__pycache__')))
 def test_deterministic_and_complete(self):
  with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
   m=bundle.build(ROOT,MANUSCRIPT,Path(a));other=bundle.build(ROOT,MANUSCRIPT,Path(b))
   self.assertEqual(m,other);self.assertEqual(m['counts'],{'chapters':15,'prompts':155,'objectives':91})
   base=Path(a)/'books/develop/editions/development-2026'/m['content_revision']
   for entry in m['files']:
    raw=(base/entry['path']).read_bytes()
    self.assertEqual(len(raw),entry['byte_length']);self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['byte_sha256'])
    self.assertEqual(raw,(Path(b)/'books/develop/editions/development-2026'/m['content_revision']/entry['path']).read_bytes())
   for chapter in m['chapter_ids']:
    original=json.loads((ROOT/f'tutor/chapters/ch{chapter}/chapter.json').read_text())
    frozen=json.loads((base/f'chapters/{chapter}/source-contract.json').read_text())
    self.assertEqual(original,frozen)
    contract=json.loads((base/f'chapters/{chapter}/contract.json').read_text())
    self.assertEqual(original['objectives'],contract['objectives'])
    for original_hint,hint in zip(original['hint_topics'],contract['hint_topics']):
     self.assertEqual([*(original_hint['levels']),original_hint['solution']],[(base/step['path']).read_text() for step in hint['steps']])
   expected=dict(m);digest=expected.pop('bundle_sha256');self.assertEqual(digest,bundle.sha(bundle.canonical(expected)))
   with self.assertRaises(ValueError):bundle.build(ROOT,MANUSCRIPT,Path(a))
if __name__=='__main__':unittest.main()
