"""Run the tutor with a real AI, chapter by chapter, the way a reader would.

python -I run_tutor_ai.py <output folder> <chapter numbers, comma separated>

For each chapter a fresh work folder gets the tutor installed by the installer and the project the
previous chapter ended with (a reader opens that folder). Five requests are typed in one conversation.
A chapter whose five answers are already saved is skipped, so the run can be resumed after a usage limit.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1])
CHAPTERS = [int(x) for x in sys.argv[2].split(',')]
STEPS = [
    ('start', '{n}장 시작해.'),
    ('hint', '힌트 줘.'),
    ('next', '다음 요청문 보여줘.'),
    ('progress', '지금 진도 알려줘.'),
    ('complete', '{n}장 완료 확인해줘.'),
]
ALLOW = ['--permission-mode', 'acceptEdits', '--max-turns', '14', '--allowedTools', 'Bash(python:*)', 'Bash(python3:*)',
         'Bash(ls:*)', 'PowerShell(python:*)', 'PowerShell(Get-ChildItem:*)', 'PowerShell(Test-Path:*)', 'PowerShell(Get-Location)']
ENV = dict(os.environ, DISABLE_AUTOUPDATER='1', PYTHONIOENCODING='utf-8', PYTHONUTF8='1')


def prepare(n):
    work = OUT / 'work' / f'ch{n:02}'
    shutil.rmtree(work, ignore_errors=True)
    (work / 'book-reference').mkdir(parents=True)
    shutil.copytree(R1 / 'tutor', work / 'book-reference' / 'tutor', ignore=shutil.ignore_patterns('__pycache__', 'tests'))
    done = subprocess.run([sys.executable, '-B', str(work / 'book-reference/tutor/install_tutor.py'), '--project', str(work), '--apply'],
                          capture_output=True, text=True, encoding='utf-8', errors='replace', env=ENV)
    assert done.returncode == 0, done.stdout + done.stderr
    if n > 1:
        previous = R1 / 'chapters' / f'ch{n - 1:02}' / 'source'
        for project in previous.iterdir():
            if project.is_dir():
                shutil.copytree(project, work / project.name, ignore=shutil.ignore_patterns('node_modules', '.next', '__pycache__'))
    return work


def ask(work, text, first):
    cmd = ['claude', '-p', text] + ([] if first else ['--continue']) + ALLOW
    try:
        done = subprocess.run(cmd, cwd=work, env=ENV, capture_output=True, text=True, encoding='utf-8', errors='replace',
                              timeout=420, stdin=subprocess.DEVNULL, shell=(os.name == 'nt'))
        return done.stdout + done.stderr
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'


for n in CHAPTERS:
    folder = OUT / f'ch{n:02}'
    if all((folder / f'{name}.txt').exists() for name, _ in STEPS):
        continue
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    work = prepare(n)
    for i, (name, text) in enumerate(STEPS):
        answer = ask(work, text.format(n=n), first=(i == 0))
        if 'session limit' in answer.lower() or 'usage limit' in answer.lower():
            shutil.rmtree(folder, ignore_errors=True)
            print('LIMIT at ch', n, name, flush=True)
            sys.exit(3)
        (folder / f'{name}.txt').write_text(answer, encoding='utf-8')
    print('done ch', n, time.strftime('%H:%M:%S'), flush=True)
