#!/usr/bin/env python3
"""Generate the public tutor text-file integrity record; never read learner state."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent
RELEASE='2026-10-13-viewer-metadata-2'

def build():
 files={}
 for p in sorted(ROOT.rglob('*')):
  rel=p.relative_to(ROOT).as_posix()
  if not p.is_file() or p.is_symlink() or p.suffix not in {'.py','.md','.json'}:continue
  if rel=='release-manifest.json' or any(x in p.relative_to(ROOT).parts for x in ['tests','__pycache__','.book-tutor-state']):continue
  if '.local.' in p.name:continue
  data=p.read_text(encoding='utf-8').replace('\r\n','\n').encode('utf-8')
  files[rel]=hashlib.sha256(data).hexdigest()
 return {'schema_version':1,'release':RELEASE,'hash_input':'UTF-8 text with LF line endings','files':files}

if __name__=='__main__':
 (ROOT/'release-manifest.json').write_text(json.dumps(build(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'Public tutor integrity record: {len(build()["files"])} files')
