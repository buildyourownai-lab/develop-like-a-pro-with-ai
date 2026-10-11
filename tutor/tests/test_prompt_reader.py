"""Synthetic fixtures only; no model, account, or project execution."""
import hashlib
from symlink_support import requires_symlink
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prompt_reader as reader


class PromptReader(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / 'chapters' / 'ch11'
        self.folder.mkdir(parents=True)
        self.body = '첫 문장 그대로.  \n\n```python\nprint("한글")\n```\n끝.\n'
        self.contract = {'number': 11, 'project': 'example-project',
                         'manuscript_sha256': 'a' * 64, 'objectives': [{'id': 'g01'}]}
        self.entry = {'id': 'P11-01', 'source': 'prompts.md', 'block_index': 1,
                      'sha256': hashlib.sha256(self.body.encode()).hexdigest(),
                      'title': '시험 단계', 'target': 'coding-assistant',
                      'kind': 'conditional', 'when': '실패했을 때만',
                      'before': '현재 결과 확인', 'after': '변경 결과 확인',
                      'objective_ids': ['g01']}
        self.guide = {'schema_version': 1, 'chapter': 11,
                      'project': 'example-project', 'manuscript_sha256': 'a' * 64,
                      'entries': [self.entry]}
        (self.folder / 'prompts.md').write_text('## 예시\n\n~~~prompt\n' + self.body + '\n~~~\n',encoding='utf-8')
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        (self.folder / 'chapter.json').write_text(json.dumps(self.contract),encoding='utf-8')
        (self.folder / 'prompt-guide.json').write_text(json.dumps(self.guide),encoding='utf-8')

    def read(self):
        return reader.read_prompt(11, self.entry['id'], self.root)

    def test_exact_unicode_whitespace_and_safe_fence(self):
        result = self.read()
        self.assertEqual(result['text'], self.body)
        self.assertEqual(result['markdown'], '````text\n' + self.body + '\n````')

    def test_conditional_metadata_is_preserved_not_auto_selected(self):
        self.assertEqual(reader.list_entries(11, self.root), [self.entry])
        self.assertEqual(self.read()['when'], '실패했을 때만')

    def test_readonly(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        reader.list_entries(11, self.root)
        self.read()
        after = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_service_question_has_its_own_target(self):
        (self.folder / 'prompts.md').unlink()
        self.entry.update(id='C11-01', source='service-questions.md', target='service-chat')
        (self.folder / 'service-questions.md').write_text('~~~chat\n' + self.body + '\n~~~\n',encoding='utf-8')
        self.save()
        self.assertEqual(self.read()['target'], 'service-chat')

    def test_missing_service_question_fails_closed(self):
        self.entry.update(id='C11-01', source='service-questions.md', target='service-chat')
        self.save()
        with self.assertRaises(ValueError):
            self.read()

    def test_unlisted_prompt_block_is_rejected(self):
        with (self.folder / 'prompts.md').open('a', encoding='utf-8') as stream:
            stream.write('\n~~~prompt\n누락된 다음 요청\n~~~\n')
        with self.assertRaisesRegex(ValueError, '빠져'):
            self.read()

    def test_unlisted_service_file_and_empty_chat_file_are_rejected(self):
        for content in ('~~~chat\n현재 종목은?\n~~~\n', '질문 블록 없음'):
            (self.folder / 'service-questions.md').write_text(content,encoding='utf-8')
            with self.subTest(content=content), self.assertRaises(ValueError):
                self.read()

    def test_id_prefix_must_match_source(self):
        self.entry['id'] = 'C11-01'
        self.save()
        with self.assertRaises(ValueError):
            self.read()

    def test_tool_command_requires_user_input_target(self):
        self.body = '/permissions'
        self.entry.update(target='tool-command', sha256=hashlib.sha256(self.body.encode()).hexdigest())
        (self.folder / 'prompts.md').write_text('~~~prompt\n/permissions\n~~~\n',encoding='utf-8')
        self.save()
        self.assertEqual(self.read()['target'], 'tool-command')
        self.assertEqual(self.read()['text'], '/permissions')

    def test_changed_source_hash_rejected_by_list_and_read(self):
        (self.folder / 'prompts.md').write_text('~~~prompt\n다른 내용\n~~~\n',encoding='utf-8')
        for operation in (self.read, lambda: reader.list_entries(11, self.root)):
            with self.assertRaises(ValueError):
                operation()

    def test_missing_or_unclosed_block_rejected(self):
        for source in ('설명만 있음', '~~~prompt\n닫히지 않음'):
            (self.folder / 'prompts.md').write_text(source,encoding='utf-8')
            with self.assertRaises(ValueError):
                self.read()

    def test_project_chapter_and_revision_mismatch(self):
        for key, value in [('project', 'wrong-project'), ('chapter', 12),
                           ('manuscript_sha256', 'b' * 64)]:
            old = self.guide[key]
            self.guide[key] = value
            self.save()
            with self.assertRaises(ValueError):
                self.read()
            self.guide[key] = old

    def test_invalid_metadata_and_paths(self):
        for key, value in [('source', '../prompts.md'), ('source', '/tmp/prompts.md'),
                           ('block_index', True), ('block_index', 0), ('block_index', 2),
                           ('target', 'service-chat'), ('kind', 'automatic'), ('kind', []),
                           ('objective_ids', ['missing']), ('when', None), ('id', 'P12-01')]:
            old = self.entry[key]
            self.entry[key] = value
            self.save()
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.read()
            self.entry[key] = old

    @requires_symlink
    def test_symlink_source_rejected(self):
        source = self.folder / 'prompts.md'
        outside = self.root / 'outside.md'
        source.rename(outside)
        source.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.read()

    def test_duplicate_ids_and_locations_rejected(self):
        self.guide['entries'].append(dict(self.entry))
        self.save()
        with self.assertRaises(ValueError):
            self.read()

    def test_unknown_id_chapter_and_malformed_json(self):
        with self.assertRaises(ValueError):
            reader.read_prompt(11, 'P11-99', self.root)
        with self.assertRaises(ValueError):
            reader.list_entries(True, self.root)
        (self.folder / 'prompt-guide.json').write_text('{',encoding='utf-8')
        with self.assertRaises(ValueError):
            self.read()


if __name__ == '__main__':
    unittest.main()
