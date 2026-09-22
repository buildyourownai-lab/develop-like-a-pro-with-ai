#!/usr/bin/env python3
"""Bind existing snapshots, refusing unmarked old PART 6 sources. No execution."""
from pathlib import Path, PurePosixPath
import argparse, json, hashlib, os
BASE=Path(__file__).resolve().parent
NEW={1,6,9,16,19}

def declared_start(root,rel):
    """Resolve a registry-declared START folder, refusing anything outside source-root. Path only, no binding claim."""
    if not isinstance(rel,str) or not rel.strip():return None,'start_path must be a non-empty relative path.'
    parts=PurePosixPath(rel).parts
    if PurePosixPath(rel).is_absolute() or '\\' in rel or not parts or any(q in ('.','..','') for q in parts):
        return None,'start_path must be a safe relative path without ".." inside source-root.'
    st=root.joinpath(*parts);base=Path(os.path.realpath(root));real=Path(os.path.realpath(st))
    if real==base or not real.is_relative_to(base):return None,'start_path must stay inside source-root.'
    if not st.is_dir():return None,'Declared START folder is missing.'
    return st,None

def marker_note(folder,rows,v,role):
    """Check the sibling <folder>-revision.json marker against the real folder. Returns a refusal reason or None."""
    if not v.get('required_revision'):return None
    marker=folder.parent/(folder.name+'-revision.json')
    if not marker.is_file():return f'New PART 6 {marker.name} is missing; old chapter {role} snapshot is not accepted.'
    try:m=json.loads(marker.read_text(encoding='utf-8'))
    except ValueError:return f'{marker.name} is not valid JSON.'
    if not isinstance(m,dict):return f'{marker.name} is not a JSON object.'
    if m.get('revision')!=v['required_revision']:return f'{marker.name} revision is not the required Sourcepack format {v["required_revision"]}.'
    if m.get('project')!=v['project']:return f'{marker.name} project is not {v["project"]}.'
    if role=='START':
        # The START marker schema is final, so its own role and chapter contract revision are required too.
        if m.get('snapshot_role')!='START':return f'{marker.name} snapshot_role is not START.'
        if v.get('contract_revision') and m.get('contract_revision')!=v['contract_revision']:return f'{marker.name} contract_revision is not {v["contract_revision"]}.'
    if m.get('files')!=rows:return f'{marker.name} file hashes do not match the actual {role} folder.'
    return None

def snapshot(folder):
    rows={}
    for x in sorted(folder.rglob('*')):
        if x.is_symlink():raise ValueError('Symlink source requires author review')
        if not x.is_file():continue
        if x.name.startswith('.env') or any(q in x.parts for q in ['.secrets','.git','node_modules','__pycache__','.next']):continue
        rows[x.relative_to(folder).as_posix()]=hashlib.sha256(x.read_bytes()).hexdigest()
    return rows

def bind(root,registry):
    for n in range(1,23):
        cid=f'ch{n:02}';v=registry['chapters'][cid];f=root/'chapters'/cid/'source'
        v.update(availability='not_bound',finish_local_path=None,start_local_path=None,execution_verified=False,source_hash=None);v.pop('start_binding_note',None)
        if 'start_path' in v:
            # 21 resumes its own stock START snapshot, proven by its own marker, never the previous chapter's FINISH.
            st,why=declared_start(root,v['start_path'])
            if st is not None:
                rows=snapshot(st)
                why='Declared START folder has no snapshot files.' if not rows else marker_note(st,rows,v,'START')
            if why:v['start_binding_note']=why
            else:v['start_local_path']=str(st)
        elif n not in NEW:
            # Default rule: the previous chapter's FINISH only counts once it has passed its own marker check.
            prev=registry['chapters'].get(f'ch{n-1:02}',{});st=root/'chapters'/f'ch{n-1:02}'/'source'
            if st.is_dir() and prev.get('availability')=='files_present_not_executed':v['start_local_path']=str(st)
        if not f.is_dir():continue
        rows=snapshot(f)
        if not rows:continue
        why=marker_note(f,rows,v,'FINISH')
        if why:v['binding_note']=why;continue
        h=hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        v.update(finish_local_path=str(f),availability='files_present_not_executed',execution_verified=False,source_hash=h,file_count=len(rows))
    return registry

def main():
    p=argparse.ArgumentParser();p.add_argument('--source-root',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    try:
        root=Path(a.source_root).expanduser().resolve(strict=True)
        if not root.is_dir():raise ValueError('source-root must be a directory')
        r=bind(root,json.loads((BASE/'source-registry.json').read_text(encoding='utf-8')))
        if a.apply:(BASE/'source-registry.local.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'applied':a.apply,'bound':sum(v['availability']=='files_present_not_executed' for v in r['chapters'].values()),'execution_verified':False,'registry':r},ensure_ascii=False,indent=2))
    except (OSError,ValueError,KeyError) as e:p.exit(2,str(e)+'\n')
if __name__=='__main__':main()
