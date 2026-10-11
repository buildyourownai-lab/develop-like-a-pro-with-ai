#!/usr/bin/env python3
"""Explicit local book-tutor connection. Dry-run by default; no downloads or shell calls."""
from __future__ import annotations
import argparse,json,hashlib,os,re,sys,tempfile
from pathlib import Path
BASE=Path(__file__).resolve().parent
BEGIN='<!-- BOOK-TUTOR-MANAGED:BEGIN -->';END='<!-- BOOK-TUTOR-MANAGED:END -->'
def sha(data:bytes)->str:return hashlib.sha256(data).hexdigest()
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

진도 계산은 `tutor_runtime.py`의 start/progress/next/verify를 사용합니다. 실제 확인 근거를 기록할 때만 record --apply를 사용합니다. “다음 요청문 보여줘”와 기존 “다음 명령문 보여줘”를 같은 조회 의도로 처리합니다. 다음 요청문을 요청하면 현재 장의 prompt-guide.json과 실제 진도를 대조하고 prompt-list/prompt로 정본 한 개를 조회합니다. “진행해”(“실행해”도 같은 뜻)는 직전에 제시한 요청 한 개만 수행하며 결과를 확인합니다. 대기 요청이 없거나 장·프로젝트가 달라졌다면 “진행해”만으로 실행하지 말고 대상을 확인합니다. 요청문 보기만으로 실행하거나 완료 기록을 만들지 않습니다. 힌트는 hints.md의 한 단계만 제공합니다. 설명 요청으로 실습 파일을 수정하지 않습니다.

Skill 파일이 있다는 사실은 실제 {tool} 새 세션에서 발견·호출됐다는 증거가 아닙니다. 명시적 호출과 새 대화에서 연결을 확인합니다. 설치된 이름과 실제 참고 경로를 보여주고 없는 소스는 미연결로 알려줍니다.
'''
def merge(text:str,block:str)->str:
 n=text.count(BEGIN);m=text.count(END)
 if n!=m or n>1:raise ValueError('기존 관리 블록이 손상됐습니다. 수동 확인 후 진행하세요.')
 if n==1:return re.sub(re.escape(BEGIN)+r'.*?'+re.escape(END),lambda _:block,text,flags=re.S)
 return text.rstrip()+'\n\n'+block+'\n'
def main(argv=None)->int:
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--project',required=True);ap.add_argument('--tool',choices=['claude','codex','both'],default='both');ap.add_argument('--apply',action='store_true');args=ap.parse_args(argv)
 try:
  root=Path(args.project).expanduser().resolve(strict=True)
  if not root.is_dir() or root==Path(root.anchor):raise ValueError('실습 프로젝트 폴더가 필요합니다.')
  if not (BASE/'TUTOR.md').is_file():raise ValueError('튜터 정본이 없습니다.')
  statep=target(root,'.book-tutor-state/install.json');old=json.loads(statep.read_text(encoding='utf-8')) if statep.exists() else {'files':{}}
  jobs=[];tools=['claude','codex'] if args.tool=='both' else [args.tool]
  for tool in tools:
   skillrel='.claude/skills/book-tutor/SKILL.md' if tool=='claude' else '.agents/skills/book-tutor/SKILL.md'
   sp=target(root,skillrel);new=content(tool).encode()
   if sp.exists() and sp.read_bytes()!=new:
    prev=old['files'].get(skillrel)
    if prev is None or sha(sp.read_bytes())!=prev['installed_sha256']:raise ValueError(f'사용자가 수정했거나 다른 Skill입니다. 덮어쓰지 않습니다: {skillrel}')
   jobs.append((sp,new))
   rel='CLAUDE.local.md' if tool=='claude' else 'AGENTS.md';p=target(root,rel);text=p.read_text(encoding='utf-8') if p.exists() else ''
   block=BEGIN+f'\n책 튜터 요청에서는 `{BASE/"TUTOR.md"}`와 현재 장의 명세를 읽습니다. 기존 사용자·조직 규칙은 유지합니다. 힌트 요청은 코드 수정 승인이 아닙니다. 제공된 book-tutor Skill의 발견 여부를 새 세션에서 확인합니다.\n'+END
   jobs.append((p,merge(text,block).encode()))
  gp=target(root,'.gitignore');gt=gp.read_text(encoding='utf-8') if gp.exists() else ''
  # Isolate private progress, without initializing Git or changing global settings.
  for entry in ['/.book-tutor-state/','/CLAUDE.local.md']:
   if entry not in gt.splitlines():gt=gt.rstrip()+'\n'+entry+'\n'
  jobs.append((gp,gt.encode()))
  plan=[{'file':str(p.relative_to(root)),'operation':'update' if p.exists() else 'create','changes':not p.exists() or p.read_bytes()!=b} for p,b in jobs]
  if args.apply:
   # Verify all targets before any write. Roll back exact originals on an error.
   backup={str(p):(p.read_bytes() if p.exists() else None) for p,b in jobs};info={'schema_version':1,'support_root':str(BASE),'files':dict(old.get('files',{}))}
   try:
    for p,b in jobs:
     p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
     info['files'][str(p.relative_to(root))]={'installed_sha256':sha(b)}
    statep.parent.mkdir(exist_ok=True);statep.write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
   except Exception:
    for path,b in backup.items():
     p=Path(path)
     if b is None:p.unlink(missing_ok=True)
     else:p.write_bytes(b)
    raise
  print(json.dumps({'applied':args.apply,'project':str(root),'plan':plan,'global_settings_changed':False,'exercise_code_created':False,'next':'새 Claude/Codex 세션에서 Skill과 실제 지침 경로를 확인합니다.'},ensure_ascii=False,indent=2));return 0
 except (ValueError,OSError,json.JSONDecodeError) as e:print(json.dumps({'error':str(e),'completed':False},ensure_ascii=False),file=sys.stderr);return 2
if __name__=='__main__':raise SystemExit(main())
