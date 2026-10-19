"""Static reader-edition checks; do not claim product/API execution."""
import hashlib,importlib.util,json,unittest
from pathlib import Path
EDITION=Path(__file__).resolve().parents[1]
PUBLIC=EDITION.parents[1]
spec=importlib.util.spec_from_file_location('edition_builder',Path(__file__).with_name('build_learning_bundle.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class EditionTests(unittest.TestCase):
 def test_mapping_is_bijective_and_excludes_old_comment_lessons(self):
  m=json.loads((EDITION/'migration-manifest.json').read_text());rows=m['chapter_rows']
  self.assertEqual([(r['legacy_chapter'],r['display_chapter']) for r in rows],[(21,13),(22,14),(13,15),(14,16),(15,17),(16,18),(17,19),(18,20)])
  self.assertEqual(m['excluded_legacy_chapters'],[19,20])
  self.assertFalse(m['unchanged_chapters_01_12']['worktree_dirty_changes_included'])
 def test_exact_prompt_and_service_copies_match_guide_hashes(self):
  for n in range(13,21):
   d=EDITION/f'tutor/chapters/ch{n}';g=json.loads((d/'prompt-guide.json').read_text())
   self.assertEqual((d/'prompts.md').read_bytes(),(EDITION/f'chapters/ch{n}/prompts.md').read_bytes())
   for e in g['entries']:
    kind='chat' if e['source']=='service-questions.md' else 'prompt'
    body=builder.prompts((d/e['source']).read_text(),kind)[e['block_index']-1]
    self.assertEqual(hashlib.sha256(body.encode()).hexdigest(),e['sha256'])
 def test_objectives_and_dependencies_are_namespaced(self):
  for n in range(13,21):
   d=EDITION/f'tutor/chapters/ch{n}';c=json.loads((d/'chapter.json').read_text());g=json.loads((d/'prompt-guide.json').read_text());ids={x['id'] for x in c['objectives']}
   self.assertTrue(all(i.startswith('development-2026-5part20-') for i in ids))
   self.assertTrue(all(set(o['depends_on'])<=ids for o in c['objectives']))
   self.assertTrue(all(set(e['objective_ids'])<=ids for e in g['entries']))
 def test_stable_prompt_ids_do_not_follow_display_numbers(self):
  for n,pid in [(13,'P21-01'),(14,'C22-01'),(15,'P13-01'),(19,'C17-01'),(20,'P18-01')]:
   g=json.loads((EDITION/f'tutor/chapters/ch{n}/prompt-guide.json').read_text());self.assertIn(pid,[e['id'] for e in g['entries']])
  settings=json.loads((EDITION/'tutor/chapters/ch19/prompt-guide.json').read_text())
  env=next(e for e in settings['entries'] if e['id']=='C17-01')
  self.assertEqual((env['source'],env['target']),('prompts.md','coding-assistant'))
 def test_production_scope_has_no_registration_or_comment_automation(self):
  d=EDITION/'tutor/chapters/ch20';c=json.loads((d/'chapter.json').read_text());g=json.loads((d/'prompt-guide.json').read_text())
  self.assertNotIn('P-FINISH-COMMENT-01',[e['id'] for e in g['entries']])
  self.assertFalse(any('first-comment' in o['id'] for o in c['objectives']))
  self.assertFalse((EDITION/'tools/first_comment.py').exists())
  self.assertNotIn('19장의 댓글 도구',c['handoff'])
 def test_explicit_part_sources_and_selection_prompt_are_preserved(self):
  parts=json.loads((EDITION/'part-sources.json').read_text())
  self.assertEqual([p['manuscript'] for p in parts['parts']],[f'book/part-{n:02d}.md' for n in range(1,6)])
  self.assertEqual([n for p in parts['parts'] for n in p['chapters']],list(range(1,21)))
  self.assertEqual(parts['parts'][0]['chapters'],[1,2,3,4,5])
  self.assertEqual(parts['parts'][1]['chapters'],[6,7,8])
  g=json.loads((EDITION/'tutor/chapters/ch18/prompt-guide.json').read_text())
  self.assertEqual([e['id'] for e in g['entries']],['P16-01','P16-02','P16-03','P16-SELECT-01','P16-04','P16-05','P16-ADOPT-01','P16-06'])
 def test_sources_are_not_copied_or_execution_inherited(self):
  registry=json.loads((EDITION/'tutor/source-registry.json').read_text());self.assertEqual(len(registry['chapters']),20)
  for n in range(13,21):
   self.assertFalse((EDITION/f'chapters/ch{n}/source').exists());self.assertFalse(registry['chapters'][f'ch{n}']['execution_verified'])
 def test_web_only_chatbot_and_design_path_are_current(self):
  for n in range(13,21):
   d=EDITION/f'tutor/chapters/ch{n}'
   for f in d.iterdir():
    if f.is_file():self.assertNotIn('docs/ch21-chat-design.md',f.read_text())
  for n in [15,16,17]:
   c=json.loads((EDITION/f'tutor/chapters/ch{n}/chapter.json').read_text());self.assertIn('web only',c['native_chatbot_scope'])
 def test_finale_has_one_prompt_and_no_old_comment_handoff(self):
  d=EDITION/'chapters/part-05-finale';self.assertEqual(len(builder.prompts((d/'prompts.md').read_text())),1)
  self.assertNotIn('댓글 조회와 답글 초안',(d/'guidance.md').read_text())
if __name__=='__main__':unittest.main()
