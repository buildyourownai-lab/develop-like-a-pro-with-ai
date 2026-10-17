#!/usr/bin/env python3
"""Build a deterministic public learning bundle from frozen teaching inputs."""
from pathlib import Path
import argparse,copy,hashlib,json,re,subprocess,tempfile,os

def safe_path(root, relative):
 path=Path(relative)
 if path.is_absolute() or '..' in path.parts or not path.parts:raise ValueError('Unsafe relative path')
 candidate=root/path
 for part in [candidate,*candidate.parents]:
  if part == root:break
  if part.is_symlink():raise ValueError('Symlink input/output is not allowed')
 if not candidate.resolve().is_relative_to(root.resolve()):raise ValueError('Path escaped root')
 return candidate

def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
def strict(path):
 raw=path.read_bytes()
 if raw.startswith(b'\xef\xbb\xbf') or b'\r' in raw:raise ValueError(f'Noncanonical UTF8/LF input: {path.name}')
 return raw.decode('utf-8',errors='strict')
def read(path):return json.loads(strict(path))
def prompts(text):
 blocks=[]
 lines=text.splitlines(keepends=True);i=0
 while i<len(lines):
  m=re.fullmatch(r'(\s*)(~{3,}|`{3,})prompt[^\n]*\n?',lines[i])
  if not m:i+=1;continue
  fence=m.group(2);i+=1;body=[]
  while i<len(lines) and not re.fullmatch(r'\s*'+re.escape(fence[0])+r'{'+str(len(fence))+r',}\s*\n?',lines[i]):body.append(lines[i]);i+=1
  if i==len(lines):raise ValueError('Unclosed prompt fence')
  value=''.join(body)
  if value.endswith('\n'):value=value[:-1]
  blocks.append(value);i+=1
 return blocks

def build(public,manuscript,output,include_support=False):
 # Never replace a previous release or follow a symlink at the output boundary.
 if output.is_symlink():raise ValueError('Symlink output is not allowed')
 # Resolve the caller-selected parent (macOS /var and /tmp are OS aliases).
 output=output.parent.resolve()/output.name
 if output.exists() and (not output.is_dir() or any(output.iterdir())):raise ValueError('Output must be new or empty')
 payload={};chapters=[];inputs=[];count=0;goals=0;service_ids=set()
 def add(path,raw,role,media='application/json'):
  if path in payload:raise ValueError('Duplicate path')
  payload[path]=(raw,role,media)
 def source(path,base,label):
  path=safe_path(base,path.relative_to(base))
  raw=path.read_bytes();inputs.append({'repository':label,'path':path.relative_to(base).as_posix(),'byte_sha256':sha(raw),'byte_length':len(raw)})
 for n in range(1,16):
  cid=f'{n:02}';folder=safe_path(public,f'tutor/chapters/ch{cid}')
  original=read(safe_path(folder,'chapter.json'));guide=read(safe_path(folder,'prompt-guide.json'))
  ms=safe_path(manuscript,original['manuscript']);blocks=prompts(strict(ms));public_blocks=prompts(strict(safe_path(folder,'prompts.md')))
  if sha(ms.read_bytes())!=original['manuscript_sha256'] or guide['manuscript_sha256']!=original['manuscript_sha256']:raise ValueError(f'{cid}: manuscript revision mismatch')
  if blocks!=public_blocks or len(blocks)!=len(guide['entries']):raise ValueError(f'{cid}: prompt coverage mismatch')
  prefix=f'chapters/{cid}';contract=copy.deepcopy(original);contract['book_id']='develop';contract['edition_id']='development-2026';contract['chapter_id']=cid;contract['prompt_guide']=copy.deepcopy(guide)
  for filename in ('chapter.json','prompt-guide.json','prompts.md','hints.md','verification.md','tutor.md'):
   source(folder/filename,public,'reader-materials')
  contract['learning_guidance']=[]
  for filename in ('tutor.md','hints.md','verification.md'):
   raw=strict(safe_path(folder,filename)).encode('utf-8');path=f'{prefix}/guidance/{filename}'
   add(path,raw,'learning-guidance','text/markdown; charset=utf-8')
   contract['learning_guidance'].append({'path':path,'byte_sha256':sha(raw),'byte_length':len(raw)})
  service_ids.update(original['required_services'])
  contract['service_cards']=[{'service_id':sid,'path':f'services/{sid}.json'} for sid in original['required_services']]
  contract['reference_registry']='source-registry.json'
  source(ms,manuscript,'manuscript')
  # Retain source contract in full. Host-facing contract references each hint step.
  add(f'{prefix}/source-contract.json',canonical(original)+b'\n','source-contract')
  for topic in contract['hint_topics']:
   tid=topic['id']
   if not re.fullmatch(r'[A-Za-z0-9_-]+',tid):raise ValueError('Unsafe hint ID')
   refs=[]
   for level,text in enumerate([*topic['levels'],topic['solution']],1):
    raw=text.encode('utf-8');path=f'{prefix}/hints/{tid}/{level}.txt'
    add(path,raw,'hint','text/plain; charset=utf-8');refs.append({'level':level,'path':path,'byte_sha256':sha(raw),'byte_length':len(raw)})
   topic.pop('levels');topic.pop('solution');topic['steps']=refs
  ids=set();objids={o['id'] for o in original['objectives']}
  if not objids or len(objids)!=len(original['objectives']):raise ValueError('Empty or duplicate objectives')
  visiting=set();visited=set()
  objectives={o['id']:o for o in original['objectives']}
  def visit(oid):
   if oid in visiting:raise ValueError('Cyclic objective dependency')
   if oid in visited:return
   if oid not in objectives:raise ValueError('Unknown dependency')
   visiting.add(oid)
   for dep in objectives[oid]['depends_on']:visit(dep)
   visiting.remove(oid);visited.add(oid)
  for oid in objids:visit(oid)
  for entry,body in zip(contract['prompt_guide']['entries'],blocks):
   pid=entry['id'];raw=body.encode('utf-8')
   if not re.fullmatch(r'[A-Za-z0-9_-]+',pid) or pid in ids:raise ValueError('Unsafe/duplicate prompt ID')
   ids.add(pid)
   if sha(raw)!=entry['sha256']:raise ValueError(f'{pid}: prompt hash mismatch')
   if any(oid not in objids for oid in entry['objective_ids']):raise ValueError('Unknown prompt objective')
   path=f'{prefix}/prompts/{pid}.txt';add(path,raw,'prompt','text/plain; charset=utf-8')
   entry['path']=path;entry['byte_sha256']=sha(raw);entry['byte_length']=len(raw)
   count+=1
  add(f'{prefix}/contract.json',canonical(contract)+b'\n','chapter-contract')
  chapters.append(cid);goals+=len(original['objectives'])
 for sid in sorted(service_ids):
  if not re.fullmatch(r'[A-Za-z0-9_-]+',sid):raise ValueError('Unsafe service ID')
  for suffix in ('.json','.md'):
   path=safe_path(public,f'tutor/services/{sid}{suffix}')
   if not path.exists():
    if suffix=='.json':raise ValueError('Required service card missing')
    continue
   raw=strict(path).encode('utf-8');source(path,public,'reader-materials')
   add(f'services/{sid}{suffix}',raw,'service-card','application/json' if suffix=='.json' else 'text/markdown; charset=utf-8')
 registry_path=safe_path(public,'tutor/source-registry.json');source(registry_path,public,'reader-materials')
 add('source-registry.json',strict(registry_path).encode('utf-8'),'reference-registry')
 if include_support:
  support=safe_path(public,'support')
  required={'studyailab.py','host-instructions.md','studyailab_core/__init__.py','studyailab_core/core.py'}
  for name in sorted(required):
   path=safe_path(support,name);raw=strict(path).encode('utf-8');source(path,public,'reader-materials')
   add('support/'+name,raw,'support-code','text/x-python; charset=utf-8' if name.endswith('.py') else 'text/markdown; charset=utf-8')
 # Revision derives from bytes, independent of timestamps and output path.
 files=[{'path':p,'byte_length':len(v[0]),'byte_sha256':sha(v[0]),'role':v[1],'media_type':v[2]} for p,v in sorted(payload.items())]
 revision='develop-'+sha(canonical({'files':files,'inputs':sorted(inputs,key=lambda x:(x['repository'],x['path']))}))[:16]
 manifest={'schema_version':1,'book_id':'develop','edition_id':'development-2026','content_revision':revision,'supported_engine_schema':[1],'required_support_version':'1.0.0','chapter_ids':chapters,'capabilities':['materials','chapter-contract','hints','local-evidence-support'],'source_git_revisions':{},'fingerprint_policy':{'id':'explicit-file-list-v1','method':'explicit-inspected-inputs','excluded_directories':['.studyailab','.git','node_modules','.venv','venv','__pycache__'],'forbidden_names':['.env','.env.local','.env.production','.env.production.local'],'require_nonempty':True},'provenance':sorted(inputs,key=lambda x:(x['repository'],x['path'])),'files':files,'counts':{'chapters':len(chapters),'prompts':count,'objectives':goals}}
 for label,root in [('reader-materials',public),('manuscript',manuscript)]:
  manifest['source_git_revisions'][label]=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
 manifest['source_worktree_dirty']={label:bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True).strip()) for label,root in [('reader-materials',public),('manuscript',manuscript)]}
 manifest['support_files_included']=include_support
 revision_input=dict(manifest);revision_input.pop('content_revision')
 revision='develop-'+sha(canonical(revision_input))[:16]
 manifest['content_revision']=revision
 manifest['bundle_sha256']=sha(canonical(manifest))
 output.parent.mkdir(parents=True,exist_ok=True)
 staging=Path(tempfile.mkdtemp(prefix='.learning-bundle-',dir=output.parent))
 destination=staging/'books'/'develop'/'editions'/'development-2026'/revision
 destination.mkdir(parents=True)
 for path,(raw,_,__) in payload.items():
  target=destination/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 (destination/'manifest.json').write_bytes(canonical(manifest)+b'\n')
 registry={'schema_version':1,'books':[{'book_id':'develop','title':'프로처럼 AI로 코딩 없이 개발하기','editions':[{'edition_id':'development-2026','content_revision':revision,'bundle_sha256':manifest['bundle_sha256'],'manifest':f'develop/editions/development-2026/{revision}/manifest.json','capabilities':manifest['capabilities'],'verified_chapters':[],'status':'candidate-not-host-verified'}]}]}
 (staging/'books'/'registry.json').write_bytes(canonical(registry)+b'\n')
 if output.exists():output.rmdir()
 os.replace(staging,output)
 return manifest
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--public-root',type=Path,required=True);parser.add_argument('--manuscript-root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--include-support',action='store_true');args=parser.parse_args()
 manifest=build(args.public_root.resolve(),args.manuscript_root.resolve(),args.output.absolute(),args.include_support)
 print(json.dumps({'status':'candidate-built-not-runtime-verified','content_revision':manifest['content_revision'],'bundle_sha256':manifest['bundle_sha256'],'counts':manifest['counts']},ensure_ascii=False))
