"""Permanent guards: reader wording, encoding safety and legacy installer boundaries.

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
BANNED = re.compile(r'Windows|macOS|검증 완료|지원 환경|지원하는 환경|지원 목록|SHA|해시')
TECH = re.compile(r'--tool|--apply|--depth|--sparse|filter=blob|python3|sparse-checkout')


def prep_prompts():
    text = (ROOT / 'chapters/getting-started/prompts.md').read_text(encoding='utf-8').replace('\r\n', '\n')
    return re.findall(r'~~~prompt\n(.*?)\n~~~', text, re.S)


class ReaderWording(unittest.TestCase):
    def test_setup_requests_have_no_technical_options_or_status_wording(self):
        prompts = prep_prompts()
        self.assertGreaterEqual(len(prompts), 8)
        for index in (4, 7):  # P-PREP-05 (single MCP), P-PREP-08 (local support)
            self.assertIsNone(TECH.search(prompts[index]), f'technical option in prompt {index + 1}')
            self.assertIsNone(BANNED.search(prompts[index]), f'status wording in prompt {index + 1}')

    def test_single_mcp_connection_preserves_scope_and_secrets(self):
        prompt = prep_prompts()[4]
        self.assertIn('Study AI Lab MCP', prompt)
        self.assertIn('https://mcp.studyailab.com', prompt)
        for safeguard in ('같은 공식 주소가 있으면 재사용', '이 작업 폴더에만',
                          '내가 승인한 뒤에만', '덮어쓰지 말고',
                          '별도 튜터나 Skill을 설치하거나 예제 프로그램을 실행하지 마', '원격으로 보내지 마'):
            self.assertIn(safeguard, prompt)

    def test_local_support_checks_integrity_and_requires_approval(self):
        prompt = prep_prompts()[7]
        for safeguard in ('/develop/mcp#support-files', '파일 검증에 실패하면 실행하지 말고',
                          '내가 승인한 뒤에만', '덮어쓰지 말고',
                          '별도 튜터나 Skill을 설치하지 마', '실제 파일 상태를 다시 점검', '완료로 기록하거나'):
            self.assertIn(safeguard, prompt)

    def test_missing_python_does_not_reinstall_or_block_public_lookup(self):
        connect, support = prep_prompts()[4], prep_prompts()[7]
        self.assertIn('Python이 없어도 자료 연결은 확인', connect)
        self.assertIn('없다면 설치를 시작하지 말고', support)
        self.assertIn('공개 자료 조회는 계속', support)

    def test_setup_guide_uses_one_product_and_preserves_unverified_boundaries(self):
        text = (TUTOR / 'SETUP.md').read_text(encoding='utf-8')
        for boundary in ('https://mcp.studyailab.com', '/develop/mcp#connect',
                         '/develop/mcp#support-files', '개인·조직 전체 설정으로 임의 변경하지',
                         '파일 검증에 실패한 코드를 실행하지', '조회나 미리보기만으로 진도를 저장하지',
                         '이전 진도를 추측하지', '별도 튜터나 필수 Skill을 설치하거나 두 번째 MCP를 등록하지'):
            self.assertIn(boundary, text)
        self.assertNotIn('install_tutor.py', text)
        self.assertNotIn('claude --permission-mode', text)
        self.assertIn('Claude Desktop Code 탭의 실제 지원·Windows 동작', text)
        self.assertIn('완료를 뜻하지 않습니다', text)

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
