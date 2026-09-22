# AI Shorts 제작 명령

## 대본 검수와 제작

음성을 만들기 전에 현재 장면 구성표와 내레이션을 기준으로 검수 기록을 만듭니다.

```bash
python3 scripts/make_roman_concrete_short.py review
```

생성된 `script-review.json`에서 다음 다섯 항목과 출처·검수자를 확인한 뒤
`status`를 `PASS`로 승인합니다.

- 맞춤법·띄어쓰기·누락
- 숫자·단위·용어
- 내레이션·자막 일치
- 사실
- 출처

승인 후에는 음성만 먼저 만듭니다.

```bash
python3 scripts/make_roman_concrete_short.py voice
```

생성된 일곱 장면의 음성을 직접 듣고 발음·속도·길이를 확인합니다. 문제가 있으면
대본을 고친 뒤 `review`부터 다시 실행합니다. 이상이 없으면 최종 영상을 조립합니다.

```bash
python3 scripts/make_roman_concrete_short.py all
```

대본이 한 글자라도 바뀌면 기존 승인은 무효이며, 검수를 다시 통과하기 전에는
음성 API 호출과 기존 음성 재사용이 차단됩니다.

## 기능 검증

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q scripts tests
```
