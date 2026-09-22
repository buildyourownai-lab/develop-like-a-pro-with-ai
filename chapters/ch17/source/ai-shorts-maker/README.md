<p align="left"><img src="assets/brand/book-symbol.png" alt="책 심벌" width="13%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/book-title.svg" alt="프로처럼 AI로 코딩 없이 개발하기" width="49.6%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/repository-title.svg" alt="AI 쇼츠 제작" width="24.2%"></p>

![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.233-D1495B)
![Python](https://img.shields.io/badge/Language-Python-7357D8)
![Coverage](https://img.shields.io/badge/Coverage-53.9%25-3A86FF)
[![Production](https://img.shields.io/website?url=https%3A%2F%2Fwww.youtube.com%2F%40everyoneisadeveloper&up_message=Online&down_message=Offline&up_color=FFD166&down_color=lightgrey&label=Production)](https://www.youtube.com/@everyoneisadeveloper)
[![Unit Tests](https://img.shields.io/badge/Unit_Tests-21%2F21_PASS-2A9D8F)](tests/)

`ai-shorts-maker`는 PART 5의 16–18장에서 사용하는 AI Shorts 제작·검수·비공개 업로드 공식 프로젝트 저장소입니다.

## 서비스

[youtube.com/@everyoneisadeveloper](https://www.youtube.com/@everyoneisadeveloper)

## 장별 범위

- 16장: 로마 콘크리트를 조사해 시나리오와 장면을 만들고, 생성형 화면·Gemini 목소리·음악·효과음·자막을 합쳐 세로 MP4와 재사용 제작 Skill을 만듭니다.
- 17장: 자동 미디어 검사와 독립 시각 검토로 `UPLOAD READY` 여부를 판정합니다.
- 18장: 승인 Preview와 Checksum을 다시 확인한 뒤 한 편만 YouTube에 비공개로 업로드합니다.

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
python3 -m compileall -q scripts tests
```

## 파일과 승인 규칙

- 실행 코드와 재현 가능한 설정만 Git에 보관합니다.
- 다운로드한 영상·음악, 완성 MP4, 대표 화면 모음, OAuth 인증정보·Token, 업로드 기록은 `artifacts/` 또는 `.secrets/`에 두고 Git에 올리지 않습니다.
- 18장 업로드는 같은 Preview에서 발급된 승인 코드와 `--execute`가 모두 있을 때만 실행합니다.

## 최종 프로젝트

책에서 만드는 프로젝트의 최신 구현은 다음 개별 저장소에서 관리합니다.

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
      <td align="center" width="90">19–22</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-media-works"><code>ai-media-works</code></a></td>
      <td align="left" width="326">AI 미디어 운영</td>
    </tr>
  </tbody>
</table>

## 문의 [![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-0969DA?logo=github&logoColor=white)](https://github.com/buildyourownai-lab/ai-shorts-maker/issues)

자료 오류와 실습 문제는 [GitHub Issues](https://github.com/buildyourownai-lab/ai-shorts-maker/issues)에 남겨주세요.
