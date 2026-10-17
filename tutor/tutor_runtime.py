#!/usr/bin/env python3
"""Book tutor: contract-driven local progress. No network, project edits or shell execution.
Evidence is a recorded observation, not independent certification of its truth.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, os, re, sys, tempfile
from pathlib import Path
from typing import Any
_HERE=str(Path(__file__).resolve().parent)
if _HERE not in sys.path:sys.path.insert(0,_HERE)  # works under python -I, runpy and -c as well
from prompt_reader import list_entries, read_prompt
BASE=Path(__file__).resolve().parent
STATE='.book-tutor-state'
EXCLUDED={'.git','node_modules','.next','.venv','venv','__pycache__',STATE,'.secrets','.claude','.agents','.codex'}
SECRET=re.compile(r'(?:\.env(?:\..*)?|.*(?:credential|secret|token|private[-_]?key).*)$',re.I)
TYPES={'file-inspection','human-observation','official-source','test-run','live-api','live-ui','external-confirmation'}
OUTCOMES={'pass','fail','blocked','expected-failure-observed'}
def now()->str:return dt.datetime.now(dt.timezone.utc).isoformat()
def load(p:Path)->Any:return json.loads(p.read_text(encoding='utf-8'))
def digest(p:Path)->str:
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def canonical(root:str|Path)->Path:
 p=Path(root).expanduser().resolve(strict=True)
 if not p.is_dir() or p==Path(p.anchor):raise ValueError('프로젝트 폴더를 명시하세요. 시스템 루트는 사용하지 않습니다.')
 return p
def safe_path(root:Path,relative:str,exists:bool=False)->Path:
 r=Path(relative)
 if r.is_absolute() or '..' in r.parts or not r.parts:raise ValueError('프로젝트 안의 상대 경로만 허용합니다.')
 p=root/r
 for x in [p,*p.parents]:
  if x==root:break
  if x.is_symlink():raise ValueError('심볼릭 링크는 증거/기록 경로로 사용하지 않습니다.')
 if not p.resolve(strict=False).is_relative_to(root.resolve(strict=False)):raise ValueError('프로젝트 밖 경로입니다.')
 if exists and not p.is_file():raise ValueError('증거 파일이 실제로 없습니다.')
 return p
def public_artifact(root:Path,relative:str)->Path:
 p=safe_path(root,relative,True)
 if any(v in EXCLUDED or SECRET.fullmatch(v) for v in Path(relative).parts):raise ValueError('인증값·설정·내부 기록 파일을 증거로 공개하지 않습니다.')
 return p
def fingerprint(root:Path)->str:
 h=hashlib.sha256();count=0
 for base,dirs,files in os.walk(root):
  dirs[:]=sorted(d for d in dirs if d not in EXCLUDED and not SECRET.fullmatch(d) and not (Path(base)/d).is_symlink())
  for name in sorted(files):
   p=Path(base)/name
   if p.is_symlink() or SECRET.fullmatch(name) or name in {'CLAUDE.local.md','AGENTS.md','.DS_Store'}:continue
   rel=p.relative_to(root).as_posix();h.update(rel.encode());h.update(b'\0');h.update(digest(p).encode());count+=1
   if count>20000:raise ValueError('프로젝트 파일이 너무 많습니다. 생성물/의존성을 별도 폴더로 분리해 확인하세요.')
 return h.hexdigest()
def contract(n:int)->dict:
 if not 1<=n<=22:raise ValueError('장 번호는1~22입니다.')
 c=load(BASE/'chapters'/f'ch{n:02}'/'chapter.json')
 validate_contract(c);return c
def validate_contract(c:dict)->None:
 ids=[o['id'] for o in c['objectives']]
 if len(ids)!=len(set(ids)):raise ValueError('중복 목표 ID')
 seen=set()
 for o in c['objectives']:
  if not set(o['depends_on'])<=seen:raise ValueError('앞에서 정의되지 않은 의존관계')
  if not set(o['evidence_types'])<=TYPES:raise ValueError('지원하지 않는 근거 종류')
  if o['expected_outcome'] not in OUTCOMES:raise ValueError('지원하지 않는 결과')
  seen.add(o['id'])
def records(root:Path,n:int)->list[dict]:
 p=safe_path(root,f'{STATE}/ch{n:02}.json')
 if not p.exists():return []
 data=load(p)
 if data.get('project')!=str(root) or data.get('chapter')!=n:raise ValueError('다른 프로젝트·장의 기록입니다.')
 return data.get('evidence',[])
def write_records(root:Path,n:int,items:list[dict])->None:
 p=safe_path(root,f'{STATE}/ch{n:02}.json');p.parent.mkdir(exist_ok=True)
 data={'schema_version':1,'project':str(root),'chapter':n,'updated_at':now(),'evidence':items}
 fd,temp=tempfile.mkstemp(prefix='.book-tutor-',suffix='.tmp',dir=p.parent)
 try:
  with os.fdopen(fd,'w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
  os.replace(temp,p)
 finally:
  if Path(temp).exists():Path(temp).unlink()
def add_evidence(root:Path,c:dict,oid:str,kind:str,outcome:str,artifact:str,environment:str,observer:str,apply:bool)->dict:
 o=next((x for x in c['objectives'] if x['id']==oid),None)
 if o is None:raise ValueError('이 장에 없는 목표입니다.')
 if kind not in o['evidence_types']:raise ValueError('이 목표에 적합하지 않은 증거 종류입니다. 예: 시험 응답은 실제 API 근거가 아닙니다.')
 if outcome not in OUTCOMES:raise ValueError('지원하지 않는 결과')
 if environment not in {'local','manual','live','simulation'}:raise ValueError('환경 종류를 명시하세요.')
 if o['environment']=='actual-account-or-service' and environment!='live':raise ValueError('실계정/실서비스 목표에는 live 관찰 근거가 필요합니다.')
 if kind in {'live-api','live-ui','external-confirmation'} and environment!='live':raise ValueError('모의 실행을 실제 실행으로 기록할 수 없습니다.')
 if observer not in {'reader','assistant','automated-test'}:raise ValueError('관찰 주체를 구분하세요.')
 p=public_artifact(root,artifact)
 evidence={'id':hashlib.sha256((now()+oid+str(p)).encode()).hexdigest()[:20],'objective':oid,'kind':kind,'outcome':outcome,'environment':environment,'observer':observer,'observed_at':now(),'artifact':p.relative_to(root).as_posix(),'artifact_sha256':digest(p),'contract_sha256':digest(BASE/'chapters'/c['id']/'chapter.json'),'project_fingerprint':fingerprint(root) if o['scope']=='project-and-artifact' else None,'verification':'recorded-observation-not-independent-attestation'}
 if apply:
  items=records(root,c['number']);items.append(evidence);write_records(root,c['number'],items)
 return {'applied':apply,'evidence':evidence,'note':'값 입력이나 관찰 보고만으로 진실성을 암호학적으로 보증하지 않습니다. 실제 수행한 근거만 등록하세요.'}
def status(root:Path,c:dict)->dict:
 items=records(root,c['number']);fp=None;res=[];states={};chash=digest(BASE/'chapters'/c['id']/'chapter.json')
 for o in c['objectives']:
  e=next((e for e in reversed(items) if e.get('objective')==o['id']),None)
  st='unconfirmed';reason='확인 기록 없음';origin=None
  if e:
   origin=e.get('observer');st='verified';reason='기록한 근거와 현재 파일 일치'
   try:
    if e.get('kind') not in o['evidence_types'] or e.get('contract_sha256')!=chash:raise ValueError('명세 또는 증거 종류가 달라짐')
    if o['environment']=='actual-account-or-service' and e.get('environment')!='live':raise ValueError('실제 환경 확인 근거가 아님')
    p=public_artifact(root,e['artifact'])
    if digest(p)!=e.get('artifact_sha256'):raise ValueError('증거 파일이 변경됨')
    if o['scope']=='project-and-artifact':
     if fp is None:fp=fingerprint(root)
     if fp!=e.get('project_fingerprint'):raise ValueError('프로젝트 파일이 변경됨')
    when=dt.datetime.fromisoformat(e['observed_at'])
    if when.tzinfo is None or when>dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=2):raise ValueError('관찰 시각이 유효하지 않음')
    age=(dt.datetime.now(dt.timezone.utc)-when).total_seconds()/3600
    if o.get('expiry_hours') is not None and age>o['expiry_hours']:raise ValueError('외부 상태 재확인 시점 도달')
    if e.get('outcome')=='blocked':st='blocked';reason='환경·접근 조건으로 확인 보류'
    elif e.get('outcome')!=o['expected_outcome']:st='failed';reason='기대 결과와 기록한 결과가 다름'
   except (ValueError,KeyError,TypeError,OSError):st='stale';reason='명세·프로젝트·근거·환경을 다시 확인해야 함'
  if st=='verified' and any(states.get(x)!='verified' for x in o['depends_on']):st='blocked';reason='선행 목표의 현재 근거가 없음'
  states[o['id']]=st
  res.append({'id':o['id'],'title':o['title'],'criterion':o['criterion'],'status':st,'reason':reason,'observer':origin,'evidence_semantics':o.get('evidence_semantics','current-condition'),'evidence_id':e.get('id') if e else None})
 required=[x for x in res if next(o for o in c['objectives'] if o['id']==x['id'])['required']]
 count=sum(x['status']=='verified' for x in required)
 nxt=next((x for x in res if x['status']!='verified' and all(states.get(v)=='verified' for v in next(o for o in c['objectives'] if o['id']==x['id'])['depends_on'])),None)
 return {'chapter':c['number'],'title':c['title'],'project':str(root),'completed':count,'required_total':len(required),'progress_text':f'{count}/{len(required)} 확인 완료','chapter_complete':count==len(required),'objectives':res,'next_action':nxt,'scope_note':'기록한 관찰 근거의 형식·현재 파일 일치를 확인한 결과입니다. 실제로 수행하지 않은 보고를 진짜로 만드는 인증기가 아닙니다. 환경변수와 외부 계정의 변경은 별도 재확인이 필요합니다.'}
def show_start(root:Path,c:dict)->dict:
 r=status(root,c)
 return {'chapter':c['number'],'expected_project':c['project'],'observed_folder':root.name,'folder_name_matches':root.name==c['project'],'goal':c['outcome'],'required_start_state':c['start_state'],'previous_features':c['previously_completed_features'],'new_features':c['new_features'],'services':c['required_services'],'tools':c['tools_and_packages'],'out_of_scope':c['out_of_scope'],'progress':r,'did_execute_or_replace':False}
def hint(c:dict,topic:str|None,level:int)->dict:
 topics=c['hint_topics']
 if topic is None:return {'topics':[{'id':t['id'],'symptom':t['symptom']} for t in topics],'instruction':'현재 증상에 맞는 주제를 확인한 뒤 한 단계만 제공합니다.'}
 h=next((h for h in topics if h['id']==topic),None)
 if h is None:raise ValueError('이 장에 없는 힌트 ID')
 if level not in {1,2,3,4}:raise ValueError('단계는1~3, 명시한 정답은4입니다.')
 return {'id':h['id'],'level':level,'text':h['levels'][level-1] if level<4 else h['solution'],'modifies_project':False}
def main(argv:list[str]|None=None)->int:
 a=argparse.ArgumentParser(description=__doc__);sub=a.add_subparsers(dest='command',required=True)
 for cmd in ['start','progress','next','verify','prompt-list','prompt']:
  p=sub.add_parser(cmd);p.add_argument('--chapter',type=int,required=True);p.add_argument('--project',required=True)
  if cmd=='prompt':p.add_argument('--id',required=True)
 p=sub.add_parser('hint');p.add_argument('--chapter',type=int,required=True);p.add_argument('--topic');p.add_argument('--level',type=int,default=1)
 p=sub.add_parser('record');p.add_argument('--chapter',type=int,required=True);p.add_argument('--project',required=True);p.add_argument('--objective',required=True);p.add_argument('--kind',required=True);p.add_argument('--outcome',required=True);p.add_argument('--artifact',required=True);p.add_argument('--environment',choices=['local','manual','live','simulation'],required=True);p.add_argument('--observer',choices=['reader','assistant','automated-test'],required=True);p.add_argument('--apply',action='store_true')
 p=sub.add_parser('audit-contracts')
 args=a.parse_args(argv)
 try:
  if args.command=='audit-contracts':
   cs=[contract(n) for n in range(1,23)];out={'contracts':len(cs),'objectives':sum(len(c['objectives']) for c in cs),'result':'PASS'}
  else:
   c=contract(args.chapter)
   if args.command=='hint':out=hint(c,args.topic,args.level)
   else:
    root=canonical(args.project)
    if args.command in {'prompt-list','prompt'}:
     known_projects={'movie-report','apartment-explorer','ai-stock-briefing','ai-shorts-maker','ai-media-works'}
     if root.name in known_projects and root.name!=c['project']:raise ValueError('현재 장과 다른 실습 프로젝트입니다.')
     context={'chapter':c['number'],'project':c['project'],'project_path':str(root),'folder_name_matches':root.name==c['project'],'did_execute':False,'note':'현재 대화와 실제 프로젝트를 대조한 뒤 단계와 선행 조건에 맞는 요청을 고릅니다. 폴더 이름이나 미완료 목표만으로 다음 요청을 확정하지 않습니다.'}
     if args.command=='prompt-list':out={**context,'entries':list_entries(args.chapter,base=BASE)}
     else:out={**read_prompt(args.chapter,args.id,base=BASE),**context}
    elif args.command=='start':out=show_start(root,c)
    elif args.command in {'progress','verify'}:out=status(root,c)
    elif args.command=='next':out=status(root,c)['next_action']
    else:out=add_evidence(root,c,args.objective,args.kind,args.outcome,args.artifact,args.environment,args.observer,args.apply)
  print(json.dumps(out,ensure_ascii=False,indent=2));return 0
 except (OSError,ValueError,KeyError,json.JSONDecodeError) as e:
  print(json.dumps({'error':str(e),'changed_project':False},ensure_ascii=False),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
