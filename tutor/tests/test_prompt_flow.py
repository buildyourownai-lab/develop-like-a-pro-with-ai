"""Local guide/CLI integration; these are not live reader or API trials."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prompt_reader as prompts
import tutor_runtime as runtime
import install_tutor


class PublishedGuides(unittest.TestCase):
    def test_every_chapter_has_exact_public_copies(self):
        for chapter in range(1, 23):
            with self.subTest(chapter=chapter):
                entries = prompts.list_entries(chapter)
                sources = {entry['source'] for entry in entries}
                for source in sources:
                    tutor_copy = runtime.BASE / 'chapters' / f'ch{chapter:02}' / source
                    public_copy = runtime.BASE.parent / 'chapters' / f'ch{chapter:02}' / source
                    self.assertEqual(tutor_copy.read_bytes(), public_copy.read_bytes())
                for entry in entries:
                    result = prompts.read_prompt(chapter, entry['id'])
                    self.assertIn(result['text'], result['markdown'])

    def test_upload_implementation_precedes_alternative_execution_paths(self):
        entries = {e['id']: e for e in prompts.list_entries(18)}
        bridge = prompts.read_prompt(18, 'P18-08')
        private = prompts.read_prompt(18, 'P18-11')
        public = prompts.read_prompt(18, 'P18-07')
        self.assertLess(bridge['block_index'], private['block_index'])
        self.assertLess(bridge['block_index'], public['block_index'])
        self.assertIn('시험 응답', bridge['text'])
        self.assertIn('공개로 전환하지 마', private['text'])
        self.assertEqual(public['kind'], 'conditional')
        self.assertIn('택일', public['before'])
        self.assertIn('택일', private['before'])
        self.assertEqual(len(entries), 11)

    def test_model_recovery_is_conditional(self):
        result = prompts.read_prompt(11, 'P11-15')
        self.assertEqual(result['kind'], 'conditional')
        self.assertIn('모델', result['when'])

    def test_service_questions_are_separate_from_development(self):
        entries = prompts.list_entries(22)
        questions = [entry for entry in entries if entry['source'] == 'service-questions.md']
        self.assertEqual(len(questions), 5)
        self.assertTrue(all(entry['target'] == 'service-chat' for entry in questions))

    def test_tool_commands_require_their_own_input_location(self):
        results = [prompts.read_prompt(2, entry['id']) for entry in prompts.list_entries(2)]
        permission = next(result for result in results if result['text'].strip() == '/permissions')
        self.assertEqual(permission['target'], 'tool-command')


class PromptCLI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / 'ai-stock-briefing'
        self.project.mkdir()
        (self.project / 'reader.txt').write_text('Synthetic reader project; no actual API execution.',encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = runtime.main(list(args))
        return code, json.loads(out.getvalue() or err.getvalue())

    def test_preview_is_readonly_and_not_completion(self):
        before = runtime.fingerprint(self.project)
        code, result = self.call('prompt', '--chapter', '11', '--project', str(self.project), '--id', 'P11-04')
        self.assertEqual(code, 0)
        self.assertFalse(result['did_execute'])
        self.assertEqual(result['project_path'], str(self.project))
        self.assertEqual(result['text'], prompts.read_prompt(11, 'P11-04')['text'])
        self.assertEqual(before, runtime.fingerprint(self.project))
        self.assertFalse((self.project / runtime.STATE).exists())
        self.assertEqual(runtime.status(self.project, runtime.contract(11))['completed'], 0)

    def test_list_does_not_invent_a_next_prompt_from_missing_evidence(self):
        code, result = self.call('prompt-list', '--chapter', '11', '--project', str(self.project))
        self.assertEqual(code, 0)
        self.assertNotIn('next_prompt', result)
        self.assertFalse(result['did_execute'])
        self.assertTrue(any(entry['kind'] == 'conditional' for entry in result['entries']))

    def test_wrong_known_project_rejected(self):
        wrong = self.root / 'movie-report'
        wrong.mkdir()
        code, result = self.call('prompt', '--chapter', '11', '--project', str(wrong), '--id', 'P11-04')
        self.assertEqual(code, 2)
        self.assertNotIn('text', result)
        self.assertEqual(list(wrong.iterdir()), [])

    def test_renamed_folder_is_flagged_for_context_confirmation(self):
        renamed = self.root / 'my-stocks'
        renamed.mkdir()
        code, result = self.call('prompt-list', '--chapter', '11', '--project', str(renamed))
        self.assertEqual(code, 0)
        self.assertFalse(result['folder_name_matches'])
        self.assertFalse(result['did_execute'])

    def test_wrong_chapter_id_returns_no_fabricated_prompt(self):
        code, result = self.call('prompt', '--chapter', '11', '--project', str(self.project), '--id', 'P12-04')
        self.assertEqual(code, 2)
        self.assertNotIn('text', result)

    def test_installer_connects_the_new_read_and_proceed_flow(self):
        with contextlib.redirect_stdout(io.StringIO()):
            code = install_tutor.main(['--project', str(self.project), '--apply'])
        self.assertEqual(code, 0)
        for relative in ('.claude/skills/book-tutor/SKILL.md', '.agents/skills/book-tutor/SKILL.md'):
            content = (self.project / relative).read_text(encoding='utf-8')
            self.assertIn('prompt-list/prompt', content)
            self.assertIn('진행해', content)
            self.assertIn('실행해', content)


if __name__ == '__main__':
    unittest.main()
