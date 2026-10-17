"""Run each Node chapter's own tests in a throwaway copy and write the real counts.

python -X utf8 -I count_tests.py <scratch folder> <chapter numbers, comma separated>
Each chapter is copied, installed, tested with vitest (json report), and the copy is deleted before the next one.
Writes <scratch folder>/test-counts.json.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
SCRATCH = Path(sys.argv[1])
CHAPTERS = [int(x) for x in sys.argv[2].split(',')]
ENV = dict(os.environ, CI='1', PYTHONUTF8='1')
result_file = SCRATCH / 'test-counts.json'
results = json.loads(result_file.read_text(encoding='utf-8')) if result_file.exists() else {}

for n in CHAPTERS:
    key = f'ch{n:02}'
    if key in results:
        continue
    project = next(p for p in (R1 / 'chapters' / key / 'source').iterdir() if p.is_dir())
    work = SCRATCH / 'count' / key
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(project, work, ignore=shutil.ignore_patterns('node_modules', '.next', '.git'))
    entry = {'project': project.name}
    install = subprocess.run('npm ci --no-audit --no-fund', cwd=work, shell=True, capture_output=True, text=True,
                             encoding='utf-8', errors='replace', timeout=1500, env=ENV)
    entry['install'] = install.returncode
    if install.returncode == 0:
        report = work / 'vitest-report.json'
        # npm test is what the book tells readers to run, including its pretest build step.
        run = subprocess.run(f'npm test -- --reporter=json --outputFile="{report}"', cwd=work, shell=True, capture_output=True,
                             text=True, encoding='utf-8', errors='replace', timeout=2400, env=ENV)
        entry['exit'] = run.returncode
        if report.exists():
            data = json.loads(report.read_text(encoding='utf-8'))
            entry.update(total=data['numTotalTests'], passed=data['numPassedTests'], failed=data['numFailedTests'],
                         files=data['numTotalTestSuites'] and len(data['testResults']))
    results[key] = entry
    result_file.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    shutil.rmtree(work, ignore_errors=True)
    print(key, entry, flush=True)
