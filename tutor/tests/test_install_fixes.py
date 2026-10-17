import io, json, sys, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install_tutor as ins


def run(project, *extra):
    out = io.StringIO()
    with redirect_stdout(out):
        code = ins.main(['--project', str(project), '--tool', 'claude', *extra])
    return code, out.getvalue()


class InstallFixes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / '작업 폴더'
        self.project.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_reapply_after_template_change_with_windows_keys(self):
        self.assertEqual(run(self.project, '--apply')[0], 0)
        statep = self.project / '.book-tutor-state/install.json'
        info = json.loads(statep.read_text(encoding='utf-8'))
        # records written on Windows by the old installer used backslashes
        info['files'] = {k.replace('/', '\\'): v for k, v in info['files'].items()}
        statep.write_text(json.dumps(info, ensure_ascii=False), encoding='utf-8')
        original = ins.content
        with mock.patch.object(ins, 'content', lambda tool: original(tool) + '\n새 줄\n'):
            self.assertEqual(run(self.project, '--apply')[0], 0)
        info = json.loads(statep.read_text(encoding='utf-8'))
        self.assertTrue(all('\\' not in k for k in info['files']))

    def test_user_newlines_are_kept(self):
        (self.project / 'CLAUDE.local.md').write_bytes('내 규칙\r\n'.encode('utf-8'))
        (self.project / '.gitignore').write_bytes(b'node_modules\r\n')
        self.assertEqual(run(self.project, '--apply')[0], 0)
        for name in ('CLAUDE.local.md', '.gitignore'):
            raw = (self.project / name).read_bytes()
            self.assertNotIn(b'\n', raw.replace(b'\r\n', b''), name)

    def test_failure_restores_files_and_removes_new_dirs(self):
        (self.project / '.gitignore').write_bytes(b'keep\n')
        real = ins.atomic_write

        def fail_on_state(path, data):
            if Path(path).name == 'install.json':
                raise OSError('locked')
            return real(path, data)
        with mock.patch.object(ins, 'atomic_write', fail_on_state):
            code, _ = run(self.project, '--apply')
        self.assertEqual(code, 2)
        self.assertEqual((self.project / '.gitignore').read_bytes(), b'keep\n')
        self.assertFalse((self.project / '.claude').exists())
        self.assertFalse((self.project / '.book-tutor-state').exists())

    def test_no_environment_judgement_sentence(self):
        self.assertIn('판단하거나 말하지 않습니다', ins.content('claude'))
        self.assertEqual(run(self.project, '--apply')[0], 0)
        self.assertIn('판단하거나 말하지 않고', (self.project / 'CLAUDE.local.md').read_text(encoding='utf-8'))

    def test_omitted_tool_connects_only_the_ai_in_use(self):
        out = io.StringIO()
        with mock.patch.dict('os.environ', {}, clear=True), redirect_stdout(out):
            self.assertEqual(ins.main(['--project', str(self.project), '--apply']), 0)
        self.assertTrue((self.project / '.claude/skills/book-tutor/SKILL.md').exists())
        self.assertFalse((self.project / 'AGENTS.md').exists())
        self.assertFalse((self.project / '.agents').exists())

    def test_omitted_tool_uses_codex_when_codex_is_detected(self):
        out = io.StringIO()
        with mock.patch.dict('os.environ', {'CODEX_HOME': 'x'}, clear=True), redirect_stdout(out):
            self.assertEqual(ins.main(['--project', str(self.project), '--apply']), 0)
        self.assertTrue((self.project / '.agents/skills/book-tutor/SKILL.md').exists())
        self.assertFalse((self.project / '.claude').exists())

    def test_skill_says_project_is_the_work_folder(self):
        text = ins.content('claude')
        self.assertIn('--project', text)
        self.assertIn('작업 폴더의 전체 경로', text)
        self.assertIn('아직 없어도 정상', text)

    def test_skill_never_tells_reader_unconfirmed_progress(self):
        text = ins.content('claude')
        self.assertIn('묻지 않고 스스로 정합니다', text)
        self.assertIn('아직 시작 전입니다', text)

    def test_claude_settings_force_utf8_and_keep_user_settings(self):
        d = self.project / '.claude'
        d.mkdir()
        (d / 'settings.local.json').write_text(json.dumps({'permissions': {'allow': ['Bash(ls:*)']}, 'env': {'MY_VAR': 'x'}}), encoding='utf-8')
        self.assertEqual(run(self.project, '--apply')[0], 0)
        self.assertEqual(run(self.project, '--apply')[0], 0)
        data = json.loads((d / 'settings.local.json').read_text(encoding='utf-8'))
        self.assertEqual(data['env'], {'MY_VAR': 'x', 'PYTHONUTF8': '1'})
        self.assertEqual(data['permissions'], {'allow': ['Bash(ls:*)']})
        self.assertIn('/.claude/settings.local.json', (self.project / '.gitignore').read_text(encoding='utf-8'))

    def test_claude_settings_created_when_missing(self):
        self.assertEqual(run(self.project, '--apply')[0], 0)
        data = json.loads((self.project / '.claude/settings.local.json').read_text(encoding='utf-8'))
        self.assertEqual(data, {'env': {'PYTHONUTF8': '1'}})

    def test_unreadable_settings_are_left_alone_and_nothing_is_changed(self):
        d = self.project / '.claude'
        d.mkdir()
        (d / 'settings.local.json').write_text('{not json', encoding='utf-8')
        code, _ = run(self.project, '--apply')
        self.assertEqual(code, 2)
        self.assertEqual((d / 'settings.local.json').read_text(encoding='utf-8'), '{not json')
        self.assertFalse((d / 'skills').exists())
        self.assertFalse((self.project / 'CLAUDE.local.md').exists())


if __name__ == '__main__':
    unittest.main()
