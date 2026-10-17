"""Compare every request text across the book, this repository and the web data (byte for byte).

python -I compare_prompts.py <book repo> <this repo> <web repo>
Exit code 0 only when the book and this repository are identical, every web text appears in the book and every web sha256 matches its text.
"""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

BOOK, R1, WEB = (Path(p) for p in sys.argv[1:4])
BLOCK = re.compile(r'^(~{3,}|`{3,})prompt[^\n]*\n(.*?)\n\1[ \t]*$', re.S | re.M)


def blocks(path):
    text = path.read_bytes().decode('utf-8').replace('\r\n', '\n')
    return [m.group(2) for m in BLOCK.finditer(text)]


def collect(files):
    found = Counter()
    for f in files:
        for b in blocks(f):
            found[b] += 1
    return found


book = collect(sorted((BOOK / 'book').glob('*.md')))
r1 = collect(sorted((R1 / 'chapters').glob('*/prompts.md')))
data = json.loads((WEB / 'src/data/prompt-identifiers.json').read_bytes().decode('utf-8'))
web = Counter(item['text'] for item in data)
wrong_hash = [item['id'] for item in data if hashlib.sha256(item['text'].encode('utf-8')).hexdigest() != item['sha256']]

print(f'book {sum(book.values())} blocks / {len(book)} distinct')
print(f'R1   {sum(r1.values())} blocks / {len(r1)} distinct')
print(f'web  {sum(web.values())} entries / {len(web)} distinct, wrong sha256: {len(wrong_hash)} {wrong_hash[:5]}')
ok = not wrong_hash
# The book and this repository must be identical. The web only publishes some of them, so its set must be inside the book's.
book_only, r1_only = set(book) - set(r1), set(r1) - set(book)
print(f'book vs R1: only in book {len(book_only)}, only in R1 {len(r1_only)}')
web_extra = set(web) - set(book)
print(f'web texts missing from the book: {len(web_extra)}')
for t in list(web_extra)[:3]:
    print('  web only:', t[:90].replace('\n', ' / '))
ok = ok and not book_only and not r1_only and not web_extra and book == r1
print('RESULT', 'MATCH' if ok else 'MISMATCH')
sys.exit(0 if ok else 1)
