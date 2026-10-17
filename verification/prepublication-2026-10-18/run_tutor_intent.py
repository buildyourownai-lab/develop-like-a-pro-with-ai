"""Check with a real AI that the tutor behaves the way TUTOR.md intends.

python -X utf8 -I run_tutor_intent.py <output folder> <chapter numbers, comma separated>

Five requests are typed per chapter, inside the project folder the way a reader works. The answers are saved, then judged by check_tutor_intent.py.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1])
CHAPTERS = [int(x) for x in sys.argv[2].split(',')]
ALLOW = ['--permission-mode', 'acceptEdits', '--max-turns', '14', '--allowedTools', 'Bash(python:*)', 'Bash(python3:*)',
         'Bash(ls:*)', 'PowerShell(python:*)', 'PowerShell(Get-ChildItem:*)', 'PowerShell(Test-Path:*)', 'PowerShell(Get-Location)']
ADD_DIR = None
ENV = dict(os.environ, DISABLE_AUTOUPDATER='1', PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
SKIP = {'.book-tutor-state', '.claude', '.agents', 'book-reference', 'AGENTS.md', 'CLAUDE.local.md', '.gitignore'}


def fingerprint(work):
    h = hashlib.sha256()
    for path in sorted(work.rglob('*')):
        if path.is_file() and not (set(path.relative_to(work).parts) & SKIP):
            h.update(path.relative_to(work).as_posix().encode())
            h.update(path.read_bytes())
    return h.hexdigest()


def prepare(n, project):
    work = OUT / 'work' / f'ch{n:02}'
    shutil.rmtree(work, ignore_errors=True)
    (work / 'book-reference').mkdir(parents=True)
    shutil.copytree(R1 / 'tutor', work / 'book-reference' / 'tutor', ignore=shutil.ignore_patterns('__pycache__', 'tests'))
    done = subprocess.run([sys.executable, '-B', str(work / 'book-reference/tutor/install_tutor.py'), '--project', str(work), '--apply'],
                          capture_output=True, text=True, encoding='utf-8', errors='replace', env=ENV)
    assert done.returncode == 0, done.stdout + done.stderr
    existing = False
    if n > 1:
        source = R1 / 'chapters' / f'ch{n - 1:02}' / 'source' / project
        if source.is_dir():
            shutil.copytree(source, work / project, ignore=shutil.ignore_patterns('node_modules', '.next', '__pycache__'))
            existing = True
    return work, existing


def ask(work, text, first):
    # A reader who is asked to allow reading the tutor folder next to the project says yes; a headless run cannot be asked.
    cmd = ['claude', '-p', text] + ([] if first else ['--continue']) + ALLOW + (['--add-dir', str(ADD_DIR)] if ADD_DIR else [])
    try:
        done = subprocess.run(cmd, cwd=work, env=ENV, capture_output=True, text=True, encoding='utf-8', errors='replace',
                              timeout=420, stdin=subprocess.DEVNULL, shell=(os.name == 'nt'))
        return done.stdout + done.stderr
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'


for n in CHAPTERS:
    folder = OUT / f'ch{n:02}'
    if (folder / 'meta.json').exists():
        continue
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    contract = json.loads((R1 / 'tutor/chapters' / f'ch{n:02}' / 'chapter.json').read_text(encoding='utf-8'))
    project = contract['project']
    work, existing = prepare(n, project)
    ADD_DIR = work
    before = fingerprint(work)
    steps = [
        ('start', f'{n}장 시작해.'),
        ('prompt', '다음 요청문 보여줘.'),
        ('hint', '힌트 줘.'),
        ('claim', f'다 했어. {n}장 완료 확인해줘.'),
        ('progress', '지금 진도 알려줘.'),
    ]
    session_cwd = None
    for i, (name, text) in enumerate(steps):
        # The reader works inside the project folder. A chapter that starts a new project begins in the umbrella folder.
        if existing or i > 0:
            (work / project).mkdir(exist_ok=True)
            cwd = work / project
        else:
            cwd = work
        answer = ask(cwd, text, first=(cwd != session_cwd))
        session_cwd = cwd
        if 'session limit' in answer.lower() or 'usage limit' in answer.lower():
            shutil.rmtree(folder, ignore_errors=True)
            print('LIMIT at ch', n, name, flush=True)
            sys.exit(3)
        (folder / f'{name}.txt').write_text(answer, encoding='utf-8')
    state = [p.name for d in (work, work / project) for p in (d / '.book-tutor-state').glob('ch*.json')] if True else []
    meta = {'chapter': n, 'project_unchanged': fingerprint(work) == before, 'evidence_records': sorted(state)}
    (folder / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
    print('done ch', n, time.strftime('%H:%M:%S'), meta, flush=True)
