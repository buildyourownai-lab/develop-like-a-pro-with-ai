#!/usr/bin/env python3
"""Explicit local book-tutor connection. Dry-run by default; no downloads or shell calls."""
from __future__ import annotations
import argparse,json,hashlib,os,re,sys,tempfile
from pathlib import Path
BASE=Path(__file__).resolve().parent
BEGIN='<!-- BOOK-TUTOR-MANAGED:BEGIN -->';END='<!-- BOOK-TUTOR-MANAGED:END -->'
def sha(data:bytes)->str:return hashlib.sha256(data).hexdigest()
def read_keep_newline(path:Path):
 """Read UTF-8 text with LF inside; also return the file's own newline so writes keep it."""
 if not path.exists():return '','\n'
 raw=path.read_bytes().decode('utf-8')
 return raw.replace('\r\n','\n'),('\r\n' if '\r\n' in raw else '\n')
def installed_record(files:dict,rel:str):
 """Older records may use backslashes in file keys; accept both spellings."""
 return files.get(rel) or files.get(rel.replace('/','\\'))
def atomic_write(path:Path,data:bytes)->None:
 """Replace one file without leaving a truncated destination on write failure."""
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,name=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as stream:
   stream.write(data);stream.flush();os.fsync(stream.fileno())
  if path.exists():os.chmod(name,path.stat().st_mode & 0o777)
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)
def target(root:Path,rel:str)->Path:
 p=root/rel
 for x in [p,*p.parents]:
  if x==root:break
  if x.is_symlink():raise ValueError('기존 심볼릭 링크 대상에는 설치하지 않습니다.')
 if not p.resolve(strict=False).is_relative_to(root):raise ValueError('프로젝트 밖 대상')
 return p
def content(tool:str)->str:
 return f'''---
name: book-tutor
description: 이 책의 현재 장 시작·진도·힌트·완료 확인·다음 요청문 안내와 그 요청의 진행을 돕는 실습 튜터. 본문의 정상적인 구현 요청을 막지 않는다.
---

# 책 전용 튜터

자료 위치: `{BASE}`

먼저 `{BASE/'TUTOR.md'}`를 읽고, 사용자가 진행하는 장의 `chapters/chNN/chapter.json`과 `tutor.md`만 필요한 만큼 읽습니다. 자연어 요청은 현재 장의 규칙으로 해석합니다. 본문 문장은 표현 예시이며 동작·완료 판정의 정본은 TUTOR.md와 장별 명세입니다. “이번 장 다 했어?”는 “장 완료 확인해줘”와 같은 완료 확인 의도로 처리하며, 완료 진술만으로 통과시키지 않습니다. 전 장 완성 소스를 미리 실행하지 않습니다.

이 컴퓨터나 프로그램이 되는지 안 되는지는 판단하거나 말하지 않습니다. 막히면 화면에 나온 오류 메시지만 알려줍니다.

튜터 프로그램(`tutor_runtime.py`)의 `--project`에는 지금 열려 있는 작업 폴더의 전체 경로를 넣습니다. 장의 프로젝트 폴더(예: movie-report)는 아직 없어도 정상이며, 그 이름을 `--project`에 넣지 않습니다. 오류가 나면 독자에게 전하기 전에 `--project`가 작업 폴더인지 확인하고 다시 실행합니다.

진도를 물었는데 장 번호가 없으면 묻지 않고 스스로 정합니다. `.book-tutor-state/`에 가장 최근 기록이 있는 장을 쓰고, 기록이 없으면 작업 폴더의 프로젝트 폴더 이름으로 정합니다(movie-report는 1장, apartment-explorer는 6장, ai-stock-briefing은 9장, ai-shorts-maker는 16장, ai-media-works는 19장부터). 아무것도 없으면 1장으로 안내합니다. 기록이 없는 장은 "아직 시작 전입니다"라고 말하고 완료/전체(예: 0/6)로 알려줍니다. 독자에게 "미확인"이라는 말은 쓰지 않습니다.

튜터 프로그램은 항상 이 형식으로 실행합니다: `python "{BASE/'tutor_runtime.py'}" <명령> --chapter <장 번호> --project "<작업 폴더 전체 경로>"` (힌트는 `hint --chapter <장 번호>`만). `python3`이 안 되면 `python`을 씁니다. 실행이 실패하면 독자에게 "확인하지 못했다"고 말하지 말고 이 형식으로 다시 실행합니다.

진도 계산은 `tutor_runtime.py`의 start/progress/next/verify를 사용합니다. 실제 확인 근거를 기록할 때만 record --apply를 사용합니다. “다음 요청문 보여줘”와 기존 “다음 명령문 보여줘”를 같은 조회 의도로 처리합니다. 다음 요청문을 요청하면 현재 장의 prompt-guide.json과 실제 진도를 대조하고 prompt-list/prompt로 정본 한 개를 조회합니다. “진행해”(“실행해”도 같은 뜻)는 직전에 제시한 요청 한 개만 수행하며 결과를 확인합니다. 대기 요청이 없거나 장·프로젝트가 달라졌다면 “진행해”만으로 실행하지 말고 대상을 확인합니다. 요청문 보기만으로 실행하거나 완료 기록을 만들지 않습니다. 힌트는 hints.md의 한 단계만 제공합니다. 설명 요청으로 실습 파일을 수정하지 않습니다.

Skill 파일이 있다는 사실은 실제 {tool} 새 세션에서 발견·호출됐다는 증거가 아닙니다. 명시적 호출과 새 대화에서 연결을 확인합니다. 설치된 이름과 실제 참고 경로를 보여주고 없는 소스는 미연결로 알려줍니다.
'''
def merge(text:str,block:str)->str:
 n=text.count(BEGIN);m=text.count(END)
 if n!=m or n>1:raise ValueError('기존 관리 블록이 손상됐습니다. 수동 확인 후 진행하세요.')
 if n==1:return re.sub(re.escape(BEGIN)+r'.*?'+re.escape(END),lambda _:block,text,flags=re.S)
 return text.rstrip()+'\n\n'+block+'\n'
def merged_claude_settings(path:Path)->bytes:
 """Add PYTHONUTF8=1 to the project's local Claude settings so Python reads and writes UTF-8 on every OS."""
 data={};nl='\n'
 if path.exists():
  raw=path.read_bytes().decode('utf-8');nl='\r\n' if '\r\n' in raw else '\n'
  try:data=json.loads(raw) if raw.strip() else {}
  except json.JSONDecodeError:raise ValueError('기존 .claude/settings.local.json을 읽을 수 없어 건드리지 않습니다. 파일을 확인해 주세요.')
  if not isinstance(data,dict):raise ValueError('기존 .claude/settings.local.json의 형식이 달라 건드리지 않습니다.')
 env=data.get('env')
 if env is None:env={}
 if not isinstance(env,dict):raise ValueError('기존 .claude/settings.local.json의 env 형식이 달라 건드리지 않습니다.')
 env.setdefault('PYTHONUTF8','1');data['env']=env
 return (json.dumps(data,ensure_ascii=False,indent=2)+'\n').replace('\n',nl).encode('utf-8')
def detect_tool()->str:
 """Connect only the AI in use when --tool is omitted; the book's default is Claude Code."""
 if os.environ.get('CLAUDECODE') or os.environ.get('CLAUDE_CODE_ENTRYPOINT'):return 'claude'
 if any(k.startswith('CODEX_') for k in os.environ):return 'codex'
 return 'claude'
def main(argv=None)->int:
 for stream in (sys.stdout,sys.stderr):
  if hasattr(stream,'reconfigure'):stream.reconfigure(errors='backslashreplace')
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--project',required=True);ap.add_argument('--tool',choices=['claude','codex','both'],default=None,help='Omit to use the AI that is running this command (Claude Code unless Codex is detected).');ap.add_argument('--apply',action='store_true');args=ap.parse_args(argv)
 try:
  root=Path(args.project).expanduser().resolve(strict=True)
  if not root.is_dir() or root==Path(root.anchor):raise ValueError('실습 프로젝트 폴더가 필요합니다.')
  if not (BASE/'TUTOR.md').is_file():raise ValueError('튜터 정본이 없습니다.')
  statep=target(root,'.book-tutor-state/install.json');old=json.loads(statep.read_text(encoding='utf-8')) if statep.exists() else {'files':{}}
  tool=args.tool or detect_tool();jobs=[];tools=['claude','codex'] if tool=='both' else [tool]
  for tool in tools:
   skillrel='.claude/skills/book-tutor/SKILL.md' if tool=='claude' else '.agents/skills/book-tutor/SKILL.md'
   sp=target(root,skillrel);new=content(tool).encode()
   if sp.exists() and sp.read_bytes()!=new:
    prev=installed_record(old['files'],skillrel)
    if prev is None or sha(sp.read_bytes())!=prev['installed_sha256']:raise ValueError(f'사용자가 수정했거나 다른 Skill입니다. 덮어쓰지 않습니다: {skillrel}')
   jobs.append((sp,new))
   rel='CLAUDE.local.md' if tool=='claude' else 'AGENTS.md';p=target(root,rel);text,nl=read_keep_newline(p)
   block=BEGIN+f'\n책 튜터 요청에서는 `{BASE/"TUTOR.md"}`와 현재 장의 명세를 읽습니다. 기존 사용자·조직 규칙은 유지합니다. 힌트 요청은 코드 수정 승인이 아닙니다. 이 컴퓨터나 프로그램이 되는지는 판단하거나 말하지 않고, 막히면 오류 메시지만 알려줍니다. 제공된 book-tutor Skill의 발견 여부를 새 세션에서 확인합니다.\n'+END
   jobs.append((p,merge(text,block).replace('\n',nl).encode()))
   if tool=='claude':jobs.append((target(root,'.claude/settings.local.json'),merged_claude_settings(target(root,'.claude/settings.local.json'))))
  gp=target(root,'.gitignore');gt,gnl=read_keep_newline(gp)
  # Isolate private progress, without initializing Git or changing global settings.
  for entry in ['/.book-tutor-state/','/CLAUDE.local.md']+(['/.claude/settings.local.json'] if 'claude' in tools else []):
   if entry not in gt.splitlines():gt=gt.rstrip()+'\n'+entry+'\n'
  jobs.append((gp,gt.replace('\n',gnl).encode()))
  plan=[{'file':str(p.relative_to(root)),'operation':'update' if p.exists() else 'create','changes':not p.exists() or p.read_bytes()!=b} for p,b in jobs]
  if args.apply:
   # Verify all targets before any write. Roll back exact originals on an error.
   backup={str(p):(p.read_bytes() if p.exists() else None) for p,b in [*jobs,(statep,b'')]};info={'schema_version':1,'support_root':str(BASE),'files':{k.replace('\\','/'):v for k,v in old.get('files',{}).items()}}
   made_dirs=sorted({d for p,_ in [*jobs,(statep,b'')] for d in p.parents if d!=root and root in d.parents and not d.exists()},key=lambda d:len(d.parts),reverse=True)
   try:
    for p,b in jobs:
     atomic_write(p,b)
     info['files'][p.relative_to(root).as_posix()]={'installed_sha256':sha(b)}
    atomic_write(statep,json.dumps(info,ensure_ascii=False,indent=2).encode('utf-8'))
   except BaseException:
    for path,b in backup.items():
     p=Path(path)
     try:
      if b is None:p.unlink(missing_ok=True)
      else:atomic_write(p,b)
     except OSError:pass
    for d in made_dirs:
     try:d.rmdir()
     except OSError:pass
    raise
  print(json.dumps({'applied':args.apply,'project':str(root),'plan':plan,'global_settings_changed':False,'exercise_code_created':False,'next':'새 Claude/Codex 세션에서 Skill과 실제 지침 경로를 확인합니다.'},ensure_ascii=False,indent=2));return 0
 except (ValueError,OSError,json.JSONDecodeError) as e:print(json.dumps({'error':str(e),'completed':False},ensure_ascii=False),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
