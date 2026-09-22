"""Read published exercise prompts verbatim. Never select, execute or record progress."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
SOURCES = {'prompts.md': ('prompt', {'coding-assistant', 'tool-command'}),
           'service-questions.md': ('chat', {'service-chat'})}


def _file(base: Path, chapter: int, name: str) -> Path:
    path = base / 'chapters' / f'ch{chapter:02}' / name
    for part in (base / 'chapters', path.parent, path):
        if part.is_symlink():
            raise ValueError('요청문 자료에 심볼릭 링크를 사용할 수 없습니다.')
    if not path.is_file():
        raise ValueError(f'공식 요청문 자료를 찾지 못했습니다: {name}')
    return path


def _json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ValueError('요청문 자료를 읽을 수 없습니다.') from exc
    if not isinstance(value, dict):
        raise ValueError('요청문 자료 형식이 올바르지 않습니다.')
    return value


def _blocks(path: Path, language: str) -> list[str]:
    # Preserve all body bytes, including whitespace and embedded shorter fences.
    content = path.read_bytes().decode('utf-8')
    lines = content.splitlines(keepends=True)
    result = []
    opening = None
    body = []
    relevant = False
    for line in lines:
        if opening is None:
            match = re.fullmatch(r' {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?', line)
            if match:
                opening = match.group(1)
                relevant = match.group(2).strip() == language
                body = []
        elif re.fullmatch(r' {0,3}' + re.escape(opening[0]) +
                          '{' + str(len(opening)) + r',}[ \t]*\r?\n?', line):
            if relevant:
                text = ''.join(body)
                if text.endswith('\r\n'):
                    text = text[:-2]
                elif text.endswith('\n'):
                    text = text[:-1]
                result.append(text)
            opening = None
        else:
            body.append(line)
    if opening is not None:
        raise ValueError('닫히지 않은 요청문 코드 블록입니다.')
    return result


def _load(chapter: int, base: str | Path | None) -> tuple[dict, list[dict]]:
    if type(chapter) is not int or not 1 <= chapter <= 22:
        raise ValueError('장 번호는 1~22입니다.')
    root = Path(base) if base is not None else BASE
    contract = _json(_file(root, chapter, 'chapter.json'))
    guide = _json(_file(root, chapter, 'prompt-guide.json'))
    if (type(guide.get('schema_version')) is not int or guide['schema_version'] != 1
            or type(guide.get('chapter')) is not int or guide['chapter'] != chapter
            or type(contract.get('number')) is not int or contract['number'] != chapter
            or not isinstance(guide.get('project'), str)
            or not guide['project']
            or guide['project'] != contract.get('project')
            or not isinstance(guide.get('manuscript_sha256'), str)
            or not re.fullmatch(r'[0-9a-f]{64}', guide['manuscript_sha256'])
            or guide['manuscript_sha256'] != contract.get('manuscript_sha256')):
        raise ValueError('장·프로젝트·판본이 정본 명세와 일치하지 않습니다.')
    entries = guide.get('entries')
    if not isinstance(entries, list) or not entries:
        raise ValueError('요청문 목록이 없습니다.')
    objective_list = contract.get('objectives')
    if (not isinstance(objective_list, list)
            or any(not isinstance(o, dict) or not isinstance(o.get('id'), str)
                   for o in objective_list)):
        raise ValueError('장의 목표 명세가 올바르지 않습니다.')
    objectives = {o['id'] for o in objective_list}
    ids, locations, sources, checked = set(), set(), {}, []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('요청문 항목 형식이 올바르지 않습니다.')
        eid, source, index = entry.get('id'), entry.get('source'), entry.get('block_index')
        if (not isinstance(eid, str) or not re.fullmatch(rf'[PC]{chapter:02}-\d+', eid)
                or eid in ids or not isinstance(source, str) or source not in SOURCES
                or eid[0] != ('P' if source == 'prompts.md' else 'C')
                or type(index) is not int or index < 1
                or (source, index) in locations
                or not isinstance(entry.get('target'), str)
                or entry['target'] not in SOURCES[source][1]
                or not isinstance(entry.get('kind'), str)
                or entry['kind'] not in {'main', 'conditional', 'tutor'}
                or any(not isinstance(entry.get(k), str) for k in ('title', 'when', 'before', 'after'))
                or not entry['title'].strip() or not entry['when'].strip()
                or not isinstance(entry.get('objective_ids'), list)
                or any(not isinstance(o, str) or o not in objectives for o in entry['objective_ids'])):
            raise ValueError('요청문 연결 정보가 올바르지 않습니다.')
        ids.add(eid)
        locations.add((source, index))
        if source not in sources:
            sources[source] = _blocks(_file(root, chapter, source), SOURCES[source][0])
        if index > len(sources[source]):
            raise ValueError('해당 단계의 정본 요청문을 찾지 못했습니다.')
        text = sources[source][index - 1]
        if not text.strip() or hashlib.sha256(text.encode('utf-8')).hexdigest() != entry.get('sha256'):
            raise ValueError('요청문 원문이 안내 판본과 일치하지 않습니다.')
        checked.append({**entry, 'text': text})
    expected_locations = set()
    for source, (language, _) in SOURCES.items():
        path = root / 'chapters' / f'ch{chapter:02}' / source
        if path.exists() or path.is_symlink():
            if source not in sources:
                sources[source] = _blocks(_file(root, chapter, source), language)
            if not sources[source]:
                raise ValueError('공식 요청문 자료에 해당 입력 코드 블록이 없습니다.')
            expected_locations.update((source, i + 1) for i in range(len(sources[source])))
    if expected_locations != locations:
        raise ValueError('공식 요청문 일부가 안내 목록에서 빠져 있습니다.')
    return guide, checked


def list_entries(chapter: int, base: str | Path | None = None) -> list[dict]:
    """Return validated metadata; order alone does not determine the next step."""
    _, entries = _load(chapter, base)
    return [{k: v for k, v in entry.items() if k != 'text'} for entry in entries]


def read_prompt(chapter: int, prompt_id: str, base: str | Path | None = None) -> dict:
    """Return one exact body and a safe copyable Markdown code block."""
    guide, entries = _load(chapter, base)
    for entry in entries:
        if entry['id'] == prompt_id:
            text = entry['text']
            longest = max((len(run) for run in re.findall(r'`+', text)), default=0)
            fence = '`' * max(3, longest + 1)
            return {'chapter': chapter, 'project': guide['project'], **entry,
                    'markdown': f'{fence}text\n{text}\n{fence}'}
    raise ValueError('이 장에서 요청한 정본 요청문을 찾지 못했습니다.')
