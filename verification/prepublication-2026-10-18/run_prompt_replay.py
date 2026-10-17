"""Replay a chapter's book prompts with a real AI, the way a reader would, and check the program that comes out.

python -X utf8 -I run_prompt_replay.py <output folder> <chapter numbers, comma separated> [--model sonnet] [--only 2,3]

Per chapter:
1. A fresh work folder gets the tutor installed and the project the reader starts the chapter with
   (chapters/chNN/start if it exists, else the previous chapter's finished project when it is the same project,
   else an empty folder). Keys are copied into that throwaway folder's .env.local only.
2. The chapter's prompts (chapters/chNN/prompts.md) are typed one by one into one conversation. When the AI stops to
   ask for approval or a value, one fixed answer is sent (at most twice per prompt).
3. Prompts that would publish, upload, post, deploy or spend money are skipped and the reason is written down.
4. The finished project is checked with its own typecheck / test / build (or unittest) commands.
Everything is saved per prompt, so a run that hits a usage limit continues where it stopped.
Secret values never reach the saved files: every saved text goes through redact().
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1])
CHAPTERS = [int(x) for x in sys.argv[2].split(',')]
MODEL = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else 'sonnet'
ONLY = {int(x) for x in sys.argv[sys.argv.index('--only') + 1].split(',')} if '--only' in sys.argv else None
KEYS = Path.home() / '.study-ai-keys'
PROMPT_TIMEOUT = 2400
BLOCK = re.compile(r'^(~{3,}|`{3,})prompt[^\n]*\n(.*?)\n\1[ \t]*$', re.S | re.M)
ENV = dict(os.environ, DISABLE_AUTOUPDATER='1', PYTHONIOENCODING='utf-8', PYTHONUTF8='1', CI='1')
ALLOW = ['--permission-mode', 'acceptEdits', '--max-turns', '60', '--model', MODEL, '--allowedTools',
         'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python:*)', 'Bash(python3:*)', 'Bash(ls:*)', 'Bash(git status:*)',
         'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git init:*)',
         'PowerShell(npm:*)', 'PowerShell(npx:*)', 'PowerShell(node:*)', 'PowerShell(python:*)', 'PowerShell(Get-ChildItem:*)',
         'PowerShell(Test-Path:*)', 'WebFetch', 'WebSearch',
         '--disallowedTools', 'Bash(git push:*)', 'PowerShell(git push:*)', 'Bash(vercel:*)', 'Bash(gh:*)']

# Prompts that act on real accounts, cost money or need a human at a screen are not replayed.
SKIP_PATTERNS = [
    (r'공개로 올려|업로드해|업로드를 시작|업로드 실행', 'real upload to a channel'),
    (r'답글.{0,12}(보내|전송)줘|한 번만 보내줘|자동답글을 켜줘', 'posts a real reply on YouTube'),
    (r'Kling.{0,30}(생성|영상)|영상을 생성|영상 후보를 생성', 'paid video generation'),
    (r'Vercel에서.{0,10}배포|배포해줘|새로 배포|운영 주소에서', 'deploys to a live site'),
    (r'GitHub.{0,20}(올려|push|저장소를 만들)|push해줘', 'writes to GitHub'),
    (r'Supabase에서.{0,30}예약', 'creates a live scheduled job'),
]
SKIP_CHAPTER_PROMPTS = {}  # filled by hand after a pilot if a prompt must be skipped for another reason

ANSWER = ('진행해. 내 설정값은 이 폴더의 .env.local에 이미 들어 있어. 필요한 값은 거기서 읽고 값은 출력하지 마. '
          '내가 직접 해야 하는 화면 조작이 있으면 하지 말고 무엇을 하면 되는지만 알려줘. 나머지는 가장 안전한 기본값으로 계속해줘.')
ASK = re.compile(r'(진행해|승인|허락|계속할까요|괜찮으|할까요|알려\s*주세요|알려주세요|선택해\s*주세요|말씀해\s*주세요)')

SECRETS = set()


def load_secrets():
    for name in ('keys.env', 'keys-youtube.env'):
        path = KEYS / name
        if path.exists():
            for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    value = line.split('=', 1)[1].strip().strip('"\'')
                    if len(value) >= 12:
                        SECRETS.add(value)


def redact(text):
    for value in sorted(SECRETS, key=len, reverse=True):
        text = text.replace(value, '***')
    return text


def prompts_of(n):
    body = (R1 / 'chapters' / f'ch{n:02}' / 'prompts.md').read_bytes().decode('utf-8').replace('\r\n', '\n')
    return [m.group(2) for m in BLOCK.finditer(body)]


def start_state(n, contract, work):
    project = contract['project']
    target = work / project
    start = R1 / 'chapters' / f'ch{n:02}' / 'start' / project
    previous = R1 / 'chapters' / f'ch{n - 1:02}' / 'source' / project
    source = start if start.is_dir() else previous if (n > 1 and previous.is_dir()) else None
    if source:
        shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', '.next', '__pycache__', '.git'))
        return f'copied {source.relative_to(R1).as_posix()}'
    target.mkdir(parents=True)
    return 'empty folder'


def write_env(n, project_dir):
    files = []
    if 6 <= n <= 15 or n >= 16:
        files.append(KEYS / ('keys-youtube.env' if n >= 19 else 'keys.env'))
    if 16 <= n <= 18:
        files.append(KEYS / 'keys.env')
    lines = []
    for path in files:
        if path.exists():
            for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
                key = line.split('=', 1)[0].strip().upper()
                if not line.strip() or line.lstrip().startswith('#'):
                    continue
                if n == 20 and ('TOKEN' in key and 'YOUTUBE' in key or 'CLIENT_SECRET' in key):
                    continue  # chapter 20 would be able to post: no write-capable token in the copy
                lines.append(line)
    if lines:
        (project_dir / '.env.local').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def prepare(n, contract):
    work = OUT / 'work' / f'ch{n:02}'
    shutil.rmtree(work, ignore_errors=True)
    (work / 'book-reference').mkdir(parents=True)
    shutil.copytree(R1 / 'tutor', work / 'book-reference' / 'tutor', ignore=shutil.ignore_patterns('__pycache__', 'tests'))
    done = subprocess.run([sys.executable, '-B', str(work / 'book-reference/tutor/install_tutor.py'), '--project', str(work), '--apply'],
                          capture_output=True, text=True, encoding='utf-8', errors='replace', env=ENV)
    assert done.returncode == 0, done.stdout + done.stderr
    how = start_state(n, contract, work)
    write_env(n, work / contract['project'])
    return work, how


def ask(work, text, first):
    cmd = ['claude', '-p', text] + ([] if first else ['--continue']) + ALLOW
    try:
        done = subprocess.run(cmd, cwd=work, env=ENV, capture_output=True, text=True, encoding='utf-8', errors='replace',
                              timeout=PROMPT_TIMEOUT, stdin=subprocess.DEVNULL, shell=(os.name == 'nt'))
        return done.stdout + done.stderr
    except subprocess.TimeoutExpired:
        return 'TIMEOUT'


def limit_hit(text):
    low = text.lower()
    return 'session limit' in low or 'usage limit' in low


def run_checks(project_dir):
    results = {}
    package = project_dir / 'package.json'
    if package.exists():
        scripts = json.loads(package.read_text(encoding='utf-8')).get('scripts', {})
        if not (project_dir / 'node_modules').exists():
            install = subprocess.run('npm ci' if (project_dir / 'package-lock.json').exists() else 'npm install', cwd=project_dir, shell=True,
                                     capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1200, env=ENV)
            results['install'] = install.returncode
        for name in ('typecheck', 'lint', 'test', 'build'):
            if name in scripts:
                run = subprocess.run(f'npm run {name}', cwd=project_dir, shell=True, capture_output=True, text=True,
                                     encoding='utf-8', errors='replace', timeout=1800, env=ENV)
                results[name] = {'exit': run.returncode, 'tail': redact((run.stdout + run.stderr)[-400:])}
    tests = project_dir / 'tests'
    if tests.is_dir():
        run = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests'], cwd=project_dir, capture_output=True,
                             text=True, encoding='utf-8', errors='replace', timeout=1800, env=ENV)
        results['unittest'] = {'exit': run.returncode, 'tail': redact((run.stdout + run.stderr)[-400:])}
    return results


def replay(n):
    contract = json.loads((R1 / 'tutor/chapters' / f'ch{n:02}' / 'chapter.json').read_text(encoding='utf-8'))
    folder = OUT / f'ch{n:02}'
    folder.mkdir(parents=True, exist_ok=True)
    state_file = folder / 'state.json'
    state = json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {'done': {}, 'start': None}
    if state['start'] is None:
        work, how = prepare(n, contract)
        state['start'] = how
    else:
        work = OUT / 'work' / f'ch{n:02}'
    prompts = prompts_of(n)
    for index, text in enumerate(prompts, 1):
        if ONLY and index not in ONLY:
            continue
        key = str(index)
        if key in state['done']:
            continue
        skip = next((why for pattern, why in SKIP_PATTERNS if re.search(pattern, text)), None) or SKIP_CHAPTER_PROMPTS.get((n, index))
        if skip:
            state['done'][key] = {'status': 'skipped', 'reason': skip}
            state_file.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')
            continue
        began = time.time()
        project_dir = work / contract['project']
        # The reader works inside the project folder; a chapter that starts a new project types its first prompt in the umbrella folder.
        cwd = work if (state['start'] == 'empty folder' and index == 1) else project_dir
        first = state.get('last_cwd') != str(cwd)
        answer = ask(cwd, text, first)
        state['last_cwd'] = str(cwd)
        turns = 1
        while turns < 3 and not limit_hit(answer) and answer != 'TIMEOUT' and ASK.search(answer[-500:]):
            answer += '\n\n--- reader answer ---\n' + ANSWER + '\n--- AI ---\n' + ask(cwd, ANSWER, False)
            turns += 1
        if limit_hit(answer):
            state_file.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')
            print('LIMIT at ch', n, 'prompt', index, flush=True)
            sys.exit(3)
        (folder / f'prompt{index:02}.txt').write_text(redact(answer), encoding='utf-8')
        state['done'][key] = {'status': 'ran', 'seconds': int(time.time() - began), 'answers': turns, 'timeout': answer == 'TIMEOUT'}
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'ch{n:02} prompt {index}/{len(prompts)} ok {int(time.time() - began)}s', flush=True)
    if not ONLY and len(state['done']) == len(prompts) and 'checks' not in state:
        state['checks'] = run_checks(work / contract['project'])
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')
        print('checks', n, {k: (v if isinstance(v, int) else v['exit']) for k, v in state['checks'].items()}, flush=True)


load_secrets()
for number in CHAPTERS:
    replay(number)
