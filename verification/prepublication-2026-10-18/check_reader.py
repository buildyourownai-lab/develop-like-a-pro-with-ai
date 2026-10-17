"""Summarize reader-test runs: python -I check_reader.py <folder holding reader-1 .. reader-N>

Each reader-N folder holds phase1.txt .. phase4.txt (the full AI answers) and work/ (the project folder).
Every phrase in WORDS must appear zero times in what a reader sees.
"""
import json
import re
import sys
from pathlib import Path

WORDS = [
    'Windows', 'macOS', '검증', '지원 환경', '지원', '미확인', 'MCP', '해시', 'SHA',
    '잘 모르', '확실하지 않', '확인하지 못', '확인할 수 없', '환경을 알려', '운영체제를 알려', 'OS를 알려',
    '어떤 AI', '어떤 운영체제',
]
QUESTION = re.compile(r'(알려\s*주세요|답해\s*주세요|맞나요|할까요|될까요|있나요)\??\s*$')
PHASES = ('1', '2', '2b', '3', '4')


def read(path):
    return path.read_text(encoding='utf-8', errors='replace')


def summarize(d, n):
    if not (d / 'phase3.txt').exists():
        return 'no result'
    text = ''.join(read(d / f'phase{i}.txt') for i in PHASES if (d / f'phase{i}.txt').exists())
    work = d / 'work'
    ref = work / 'book-reference'
    size = sum(f.stat().st_size for f in ref.rglob('*') if f.is_file()) if ref.exists() else -1
    ignore = work / '.gitignore'
    local = work / 'CLAUDE.local.md'
    phase4 = d / 'phase4.txt'
    progress = ''
    if phase4.exists():
        progress = next((l.strip()[:80] for l in read(phase4).splitlines() if '/6' in l), '')
    phase3 = read(d / 'phase3.txt').strip().splitlines()
    return {
        'banned_words': {w: len(re.findall(re.escape(w), text, re.I)) for w in WORDS if re.search(re.escape(w), text, re.I)},
        'ref_size_MB': round(size / 1e6, 1) if size >= 0 else None,
        'ref_has_tutor': (ref / 'tutor' / 'install_tutor.py').exists(),
        'ref_has_full_repo': (ref / 'chapters').exists(),
        'claude_skill': (work / '.claude/skills/book-tutor/SKILL.md').exists(),
        'CLAUDE.local.md': local.exists(),
        'codex_files': (work / 'AGENTS.md').exists() or (work / '.agents').exists(),
        'gitignore_crlf_kept': (b'\r\n' in ignore.read_bytes()) if ignore.exists() else None,
        'user_rule_kept': ('내 규칙' in read(local)) if local.exists() else None,
        'user_file_kept': (work / 'my-notes/a.txt').exists() if n == 4 else None,
        'questions_to_reader': sum(1 for l in text.splitlines() if QUESTION.search(l.strip())),
        'progress_line': progress,
        'phase3_first_line': phase3[0][:100] if phase3 else '',
    }


def main():
    root = Path(sys.argv[1])
    folders = sorted(root.glob('reader-*'), key=lambda p: p.name)
    out = {d.name: summarize(d, int(d.name.split('-')[1])) for d in folders}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
