<p align="left"><img src="assets/brand/book-symbol.png" alt="책 심벌" width="13%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/book-title.svg" alt="프로처럼 AI로 코딩 없이 개발하기" width="49.6%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/repository-title.svg" alt="AI 쇼츠 제작" width="24.2%"></p>

![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.233-D1495B)
![Python](https://img.shields.io/badge/Language-Python-7357D8)
[![YouTube Channel](https://img.shields.io/badge/YouTube-Channel-FFD166)](https://www.youtube.com/@everyoneisadeveloper)
[![Unit Tests](https://img.shields.io/badge/Unit_Tests-93_pass_%2F_3_skip-2A9D8F)](tests/)

`ai-shorts-maker`는 PART 5의 16–18장에서 사용하는 AI Shorts 제작·검수·비공개 업로드 공식 프로젝트 저장소입니다.

## 서비스

[youtube.com/@everyoneisadeveloper](https://www.youtube.com/@everyoneisadeveloper)

## 장별 범위

- 16장: 로마 콘크리트를 조사해 시나리오와 장면을 만들고, 생성형 화면·Gemini 목소리·음악·효과음·자막을 합쳐 세로 MP4와 재사용 제작 Skill을 만듭니다.
- 17장: 자동 미디어 검사와 독립 시각 검토로 `UPLOAD READY` 여부를 판정합니다.
- 18장: 승인 Preview와 Checksum을 다시 확인한 뒤, 다음 세 단계로 한 편을 YouTube에 올립니다.
  1. 항상 비공개(private)로 먼저 업로드합니다.
  2. 사람이 명시적으로 요청할 때만, 같은 video ID의 상태를 공개(public)나 일부공개(unlisted)로 바꿉니다.
  3. 완료 상태이면서 실제로 확인된 공개 범위가 public 또는 unlisted일 때만 PART 6으로 인계(`--handoff`)합니다.

  업로드나 상태 변경 결과가 불명확하면 곧바로 다시 업로드하지 않고, [`COMMANDS.md`](COMMANDS.md)의 예외 처리
  절차를 따릅니다. 이 발행 검증은 현재 Mock/Local 테스트로만 확인했으며, 실제 계정으로의 재검증은 아직
  남아 있습니다.

## 주요 스크립트

| 파일 | 역할 |
| --- | --- |
| `scripts/make_roman_concrete_short.py` | 로마 콘크리트 Shorts 제작 |
| `scripts/script_review.py` | 음성 생성 전에 맞춤법·자막·사실·출처와 현재 대본 일치를 확인 |
| `scripts/review_video.py` | 미디어 검사 |
| `scripts/make_chapter17_failure.py` | 실패 사례 재현 |
| `scripts/upload_private_video.py` | 검수를 통과한 영상 업로드 |

## 테스트

대본을 음성으로 만들기 전에는 검수 양식을 만들고, 맞춤법·띄어쓰기·누락,
용어·숫자, 내레이션·자막 일치, 사실, 출처를 확인해 `PASS`로 승인합니다.
대본이 바뀌면 승인이 무효가 되고 이전 음성 Cache도 폐기됩니다.

```bash
python3 scripts/make_roman_concrete_short.py review
python3 scripts/make_roman_concrete_short.py voice
python3 scripts/make_roman_concrete_short.py all
```

순서는 대본 검사 → 사람 승인 → 음성 생성 → 발음·속도 확인 → 최종 조립입니다.
음성 확인 뒤 대본을 바꾸면 `review`부터 다시 실행합니다.

```bash
python3 -m unittest discover -s tests -v
python3 -m pytest tests -q
python3 -m compileall -q scripts tests
```

`tests/test_chapter18_upload.py`는 Mock만 사용하며 `.secrets/`나 실제 YouTube API를
읽지 않습니다. 이 공개 Source에서 2026-09-22 실행한 결과는 93 통과·3 건너뜀입니다.
건너뛴 검사는 배포하지 않는 완성 영상 파일에 의존합니다. 제품 저장소의 94 통과·2 건너뜀과는
제공하는 파일 범위가 다르며, 실제 YouTube 업로드를 다시 실행한 결과가 아닙니다.

## 파일과 승인 규칙

- 실행 코드와 재현에 필요한 설정은 Git에 보관합니다.
- `artifacts/`의 다운로드한 영상·음악, 완성 MP4, 원본 영상, 내레이션 WAV, 검사 결과는
  같은 검사를 다시 실행할 수 있도록 Git에 남기며, `artifacts/**/work/`의 중간 산출물만
  제외합니다.
- OAuth 인증정보·Token, 업로드 Receipt는 `.secrets/`에만 두고 Git에 올리지 않습니다.
- 18장 업로드는 같은 Preview에서 발급된 승인 코드와 `--execute`가 모두 있을 때만 실행합니다.
- 핵심 안전 원칙: 이미 생성된 video ID에는 절대 다시 Insert하지 않습니다. 같은 video ID의 상태는
  Receipt와 Plan의 정체성(해시·채널·제목·아동용 설정)이 일치할 때만 바꿉니다. PART 6으로는 완료
  상태이면서 실제 공개 범위가 public/unlisted로 확인된 Receipt의 video URL/ID와 기대 채널
  정체성만 `--handoff`로 넘깁니다. 결과가 불명확한 예외 상황의 복구 절차는
  [`COMMANDS.md`](COMMANDS.md)에 정리했습니다.

## 최종 프로젝트

책에서 만드는 프로젝트는 다음 개별 저장소에서 관리합니다. 장별 실습 판본은
[공개 독자 자료](https://github.com/buildyourownai-lab/develop-like-a-pro-with-ai)의
각 장 Source에서 확인합니다. 최종 프로젝트와 장별 Source의 범위는 다를 수 있습니다.

- 19–20장: `ai-media-works`의 댓글 읽기·검수와 승인한 자동답글을 사용합니다.
- 21–22장: `ai-stock-briefing`의 근거 기반 챗봇과 읽기 전용 Tool 호출을 사용합니다.

<table width="100%">
  <thead>
    <tr>
      <th align="center" width="90">PART</th>
      <th align="center" width="90">장</th>
      <th align="center" width="223">저장소</th>
      <th align="center" width="326">내용</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="90">1</td>
      <td align="center" width="90">1–5</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/movie-report"><code>movie-report</code></a></td>
      <td align="left" width="326">영화 흥행 보고서</td>
    </tr>
    <tr>
      <td align="center" width="90">2</td>
      <td align="center" width="90">6–8</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/apartment-explorer"><code>apartment-explorer</code></a></td>
      <td align="left" width="326">아파트 탐색 서비스</td>
    </tr>
    <tr>
      <td align="center" width="90">3</td>
      <td align="center" width="90">9–12</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">국내주식 AI 브리핑 웹서비스</td>
    </tr>
    <tr>
      <td align="center" width="90">4</td>
      <td align="center" width="90">13–15</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">Android·iPhone 앱</td>
    </tr>
    <tr>
      <td align="center" width="90">5</td>
      <td align="center" width="90">16–18</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-shorts-maker"><code>ai-shorts-maker</code></a></td>
      <td align="left" width="326">AI 쇼츠 제작</td>
    </tr>
    <tr>
      <td align="center" width="90">6</td>
      <td align="center" width="90">19–20</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-media-works"><code>ai-media-works</code></a></td>
      <td align="left" width="326">YouTube 댓글 읽기·검수와 승인한 자동답글</td>
    </tr>
    <tr>
      <td align="center" width="90">6</td>
      <td align="center" width="90">21–22</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">근거 기반 주식 서비스 챗봇과 읽기 전용 Tool 호출</td>
    </tr>
  </tbody>
</table>

## 문의 [![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-0969DA?logo=github&logoColor=white)](https://github.com/buildyourownai-lab/ai-shorts-maker/issues)

자료 오류와 실습 문제는 [GitHub Issues](https://github.com/buildyourownai-lab/ai-shorts-maker/issues)에 남겨주세요.

## Kling 제작 입력 준비

공개 Source에는 생성 영상·음성·음악 원본이 포함되지 않습니다. 먼저 init으로 작업 폴더를 만들고 승인 대본 검사, 실제 선택 자산의 상대 경로·해시·권리 기록을 준비합니다. 공식 AI Studio Charon WAV를 가져오면 import-voice로 등록합니다. API 호출은 별도의 인증·비용 승인 경로이며 가져온 음성이 없다고 자동으로 대신 호출하지 않습니다. Pulsar는 공식 오디오 보관함에서 직접 내려받습니다. 이미지·영상 비용과 현재 모델 조건은 공식 화면에서 확인합니다.
