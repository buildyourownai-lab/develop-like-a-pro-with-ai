"""Check that the tutor behaves as intended in all 22 chapters (no AI involved, temporary folders only).

python -X utf8 -I e2e_tutor_all_chapters.py
For each chapter: no evidence -> 0 done and not complete; registering the objectives in order raises the count by one each
time; after the last one the chapter is complete; changing the evidence file makes the objective need re-checking again.
"""
import shutil
import sys
import tempfile
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(R1 / 'tutor'))
import tutor_runtime as rt  # noqa: E402

LIVE_KINDS = {'live-api', 'live-ui', 'external-confirmation'}


def make_project(parent, chapter):
    root = parent / chapter['project']
    source = R1 / 'chapters' / chapter['id'] / 'source' / chapter['project']
    if source.is_dir():
        shutil.copytree(source, root, ignore=shutil.ignore_patterns('node_modules', '.next', '__pycache__', '.git'))
    else:
        root.mkdir(parents=True)
    note = root / 'evidence-note.txt'
    note.write_text('observed result\n', encoding='utf-8')
    return root, 'evidence-note.txt'


def run(number, parent):
    problems = []
    c = rt.contract(number)
    root, artifact = make_project(parent, c)
    root = rt.canonical(root)
    first = rt.status(root, c)
    if first['completed'] != 0 or first['chapter_complete']:
        problems.append('not empty at the start')
    total = first['required_total']
    done = 0
    for o in c['objectives']:
        kind = o['evidence_types'][0]
        env = 'live' if (o['environment'] == 'actual-account-or-service' or kind in LIVE_KINDS) else 'local'
        rt.add_evidence(root, c, o['id'], kind, o['expected_outcome'], artifact, env, 'automated-test', True)
        now = rt.status(root, c)
        if o['required']:
            done += 1
        if now['completed'] != done:
            problems.append(f"{o['id']}: expected {done} done, got {now['completed']}")
    final = rt.status(root, c)
    if not final['chapter_complete'] or final['completed'] != total:
        problems.append(f"not complete after all evidence: {final['progress_text']}")
    (root / artifact).write_text('changed afterwards\n', encoding='utf-8')
    after = rt.status(root, c)
    if after['chapter_complete'] or after['completed'] >= total:
        problems.append('changed evidence file was still accepted')
    return total, problems


def main():
    parent = Path(tempfile.mkdtemp(prefix='tutor-e2e-'))
    failed = 0
    try:
        for n in range(1, 23):
            sub = parent / f'ch{n:02}'
            sub.mkdir()
            try:
                total, problems = run(n, sub)
            except Exception as error:  # report the chapter and keep going
                total, problems = 0, [f'{type(error).__name__}: {error}']
            failed += bool(problems)
            print(f'ch{n:02} objectives={total} ' + ('OK' if not problems else 'FAIL ' + '; '.join(problems)))
    finally:
        shutil.rmtree(parent, ignore_errors=True)
    print('RESULT', 'ALL OK' if not failed else f'{failed} chapter(s) failed')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
