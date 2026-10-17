"""Permanent guards: reader wording, encoding safety and tutor/MCP separation.

These fail when a change reintroduces the kinds of problems that reached readers:
technical options or environment-status wording in the setup requests, text file
operations without an explicit encoding, the Windows-incompatible main-module
check, and an installer that touches MCP configuration.
"""
import ast, io, json, re, sys, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import install_tutor as ins

TUTOR = Path(__file__).resolve().parents[1]
ROOT = TUTOR.parent
BANNED = re.compile(r'Windows|macOS|검증|지원 환경|지원하는 환경|지원 목록|미확인|SHA|해시')
TECH = re.compile(r'--tool|--apply|--depth|--sparse|filter=blob|python3|sparse-checkout')


def prep_prompts():
    text = (ROOT / 'chapters/getting-started/prompts.md').read_text(encoding='utf-8').replace('\r\n', '\n')
    return re.findall(r'~~~prompt\n(.*?)\n~~~', text, re.S)


class ReaderWording(unittest.TestCase):
    def test_setup_requests_have_no_technical_options_or_status_wording(self):
        prompts = prep_prompts()
        self.assertGreaterEqual(len(prompts), 8)
        for index in (4, 7):  # P-PREP-05 (tutor), P-PREP-08 (MCP)
            self.assertIsNone(TECH.search(prompts[index]), f'technical option in prompt {index + 1}')
            self.assertIsNone(BANNED.search(prompts[index]), f'status wording in prompt {index + 1}')

    def test_tutor_request_never_mentions_mcp(self):
        self.assertNotIn('MCP', prep_prompts()[4])

    def test_setup_guide_the_ai_reads_has_no_status_wording(self):
        text = (TUTOR / 'SETUP.md').read_text(encoding='utf-8')
        self.assertIsNone(re.search(r'Windows 검증|macOS|지원 환경|미확인|SHA|MCP', text))

    def test_installed_skill_never_tells_readers_unconfirmed(self):
        skill = ins.content('claude')
        self.assertIn('"미확인", "모릅니다", "검증되지 않았습니다" 같은 말은 쓰지 않습니다', skill)


class McpSeparation(unittest.TestCase):
    def test_installer_only_writes_inside_the_work_folder_and_never_mcp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / 'work'
            project.mkdir()
            with redirect_stdout(io.StringIO()):
                self.assertEqual(ins.main(['--project', str(project), '--tool', 'claude', '--apply']), 0)
            created = {p.relative_to(project).as_posix() for p in project.rglob('*') if p.is_file()}
            self.assertNotIn('.mcp.json', created)
            self.assertFalse(any(name.endswith('.claude.json') for name in created))
            allowed = {'.claude/skills/book-tutor/SKILL.md', '.claude/settings.local.json', 'CLAUDE.local.md', '.gitignore', '.book-tutor-state/install.json'}
            self.assertLessEqual(created, allowed)


class EncodingSafety(unittest.TestCase):
    def _python_sources(self):
        for f in (ROOT / 'chapters').rglob('*.py'):
            if any(part in ('node_modules', '__pycache__', '.venv') for part in f.parts):
                continue
            yield f

    def test_text_file_operations_name_their_encoding(self):
        missing = []
        for f in self._python_sources():
            try:
                tree = ast.parse(f.read_text(encoding='utf-8'))
            except (SyntaxError, UnicodeDecodeError):
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', None)
                if name not in ('read_text', 'write_text', 'open'):
                    continue
                if name == 'open' and isinstance(func, ast.Attribute) and ast.unparse(func.value) in ('os', 'webbrowser', 'io', 'zipfile', 'tarfile', 'gzip', 'opener', 'urllib.request', 'Image', 'img'):
                    continue
                mode = None
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    mode = node.args[1].value
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str) and name == 'open' and isinstance(func, ast.Attribute):
                    mode = node.args[0].value
                for kw in node.keywords:
                    if kw.arg == 'mode' and isinstance(kw.value, ast.Constant):
                        mode = kw.value.value
                if isinstance(mode, str) and 'b' in mode:
                    continue
                if name == 'open' and not isinstance(func, ast.Attribute) and not node.args:
                    continue
                if not any(kw.arg == 'encoding' for kw in node.keywords):
                    missing.append(f'{f.relative_to(ROOT).as_posix()}:{node.lineno}')
        self.assertEqual(missing, [], 'text file operation without encoding="utf-8"')

    def test_no_windows_incompatible_main_module_check(self):
        bad = re.compile(r'import\.meta\.url\s*===?\s*[`"\']file://')
        found = [f.relative_to(ROOT).as_posix() for f in (ROOT / 'chapters').rglob('*.mjs') if 'node_modules' not in f.parts and bad.search(f.read_text(encoding='utf-8'))]
        self.assertEqual(found, [], 'use pathToFileURL(process.argv[1]).href instead of file://${argv[1]}')


if __name__ == '__main__':
    unittest.main()
