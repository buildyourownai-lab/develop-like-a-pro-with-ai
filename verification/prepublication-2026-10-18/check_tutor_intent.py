"""Judge the answers saved by run_tutor_intent.py: python -X utf8 -I check_tutor_intent.py <output folder>"""
import json
import re
import sys
from pathlib import Path

R1 = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1])
BANNED = ['Windows', 'macOS', '지원 환경', '미확인', 'SHA', '해시', 'MCP', '모릅니다', '알 수 없', '확인하지 못했', '것 같습니다', '잘 모르']
DONE_WORDS = re.compile(r'(완료했습니다|완료입니다|통과했습니다)(?!.*아직)')


def text(folder, name):
    return (folder / f'{name}.txt').read_text(encoding='utf-8', errors='replace')


def prompt_blocks(n):
    body = (R1 / 'tutor/chapters' / f'ch{n:02}' / 'prompts.md').read_bytes().decode('utf-8').replace('\r\n', '\n')
    return [m.group(2) for m in re.finditer(r'^(~{3,}|`{3,})prompt[^\n]*\n(.*?)\n\1[ \t]*$', body, re.S | re.M)]


def judge(folder):
    n = int(folder.name[2:])
    meta = json.loads((folder / 'meta.json').read_text(encoding='utf-8'))
    contract = json.loads((R1 / 'tutor/chapters' / f'ch{n:02}' / 'chapter.json').read_text(encoding='utf-8'))
    topic = contract['hint_topics'][0]
    total = sum(1 for o in contract['objectives'] if o['required'])
    allout = ''.join(text(folder, s) for s in ('start', 'hint', 'prompt', 'claim', 'progress'))
    checks = {}
    checks['start: project untouched'] = meta['project_unchanged']
    checks['start: progress 0/N from the runtime'] = f'0/{total}' in text(folder, 'start')
    solution = re.sub(r'\s+', '', topic.get('solution', ''))[:25]
    hint = re.sub(r'\s+', '', text(folder, 'hint'))
    checks['hint: no solution attached'] = (not solution) or solution not in hint
    checks['hint: answered (not empty/timeout)'] = len(text(folder, 'hint').strip()) > 40 and 'TIMEOUT' not in text(folder, 'hint')
    shown = re.sub(r'\s+', '', text(folder, 'prompt'))
    checks['prompt: shows the book text'] = any(re.sub(r'\s+', '', b)[:40] in shown for b in prompt_blocks(n))
    claim = text(folder, 'claim')
    checks['claim: not accepted without evidence'] = (f'0/{total}' in claim or '아직' in claim) and not DONE_WORDS.search(claim.splitlines()[0] if claim.strip() else '')
    checks['claim: no evidence saved'] = not meta['evidence_records']
    progress = text(folder, 'progress')
    checks['progress: picked the chapter by itself'] = f'{n}장' in progress and f'0/{total}' in progress
    hits = {w: allout.count(w) for w in BANNED if w in allout}
    return checks, hits


def main():
    failed = 0
    for folder in sorted(OUT.glob('ch*')):
        if not (folder / 'meta.json').exists():
            continue
        checks, hits = judge(folder)
        bad = [k for k, v in checks.items() if not v]
        failed += bool(bad) or bool(hits)
        print(f'{folder.name}: ' + ('PASS' if not bad else 'FAIL ' + '; '.join(bad)) + (f' | unwanted words {hits}' if hits else ''))
    print('RESULT', 'ALL PASS' if not failed else f'{failed} chapter(s) need attention')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
