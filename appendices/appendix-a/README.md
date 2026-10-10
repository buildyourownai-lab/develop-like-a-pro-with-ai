# 부록 A. 책의 모든 자료를 한곳에 모았습니다

## 이 부록으로 하는 일

이 책의 자료가 어디에 있는지 알고, 저자가 실제로 만든 결과물을 열어 내가 만든 것과
비교합니다. 새로 만드는 것은 없습니다. 찾을 수 있게 되는 것이 전부입니다.

자료 안내는 [Development Lab](https://www.studyailab.com/develop)에서 시작합니다. PART와 장을 선택하면 요청문과 Source·검증 자료로 이동할 수 있습니다. 이 저장소는 사이트에서 연결하는 파일 자료를 보관합니다. 완성 프로젝트와 장별 기준 Source는 구분합니다.

## 프롬프트

[prompts.md](prompts.md)에 이 부록에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 순서대로 합니다

**1. 사이트에서 필요한 메뉴를 찾습니다** — Development Lab에서 PART와 장을 고른 뒤 커맨드와 소스/검증을 엽니다. 튜터는 튜터 메뉴, 부록은 자료실, 변경 안내는 업데이트에서 확인합니다.

이 저장소까지 이동했다면 chapters는 장별 요청문·Source, appendices는 부록 자료, verification은 확인 기록입니다. 이 폴더 이름을 사이트 메뉴 이름으로 혼동하지 않습니다.

**2. 저자가 만든 결과물을 열어봅니다** --- 각 장의 검증 폴더에는 저자가 실제로 만든
파일이 그대로 올라가 있습니다. 1장 결과물은
[verification/chapter-01/artifacts/](../../verification/chapter-01/artifacts/)에
있습니다. Excel처럼 화면에서 바로 볼 수 없는 파일은 내려받은 뒤 열어야 합니다.
번거로우면 대화창에 맡겨도 됩니다. 요청문은 [prompts.md](prompts.md)의 「저자가 만든
결과물을 직접 열어봅니다」에 있습니다.

내 결과물이 저자의 파일과 똑같이 생기지 않아도 괜찮습니다. 확인하는 것은 모양이 아니라
그 장의 확인 목록입니다.

장 번호를 골라 바로 가는 기본 경로는 다음과 같습니다. `NN`을 두 자리 장 번호로 바꿉니다.

| 찾을 것 | 경로 |
|---|---|
| 요청문 | `chapters/chNN/prompts.md` |
| 장별 Source | `chapters/chNN/source/` |
| 검증 기록 | `verification/chapter-NN/README.md` |
| 결과물 | `verification/chapter-NN/artifacts/` |

완성 프로젝트는 [movie-report](https://github.com/buildyourownai-lab/movie-report),
[apartment-explorer](https://github.com/buildyourownai-lab/apartment-explorer),
[ai-stock-briefing](https://github.com/buildyourownai-lab/ai-stock-briefing),
[ai-shorts-maker](https://github.com/buildyourownai-lab/ai-shorts-maker),
[ai-media-works](https://github.com/buildyourownai-lab/ai-media-works)에서 확인합니다.

**3. 내 프로젝트에도 같은 흔적을 남깁니다** --- 이 저장소가 특별한 방식으로 정리된 것은
아닙니다. README.md → 결과물 → Source → Test → 검증 기록 → Commit 기록 순서로 둔
것뿐입니다. 내 프로젝트에도 같은 순서를 만들어둘 수 있습니다. 요청문은
[prompts.md](prompts.md)의 「내 프로젝트에도 같은 흔적을 남길 수 있습니다」에 있습니다.

## 함께 보는 곳

- 실습이 막혔을 때 되돌리는 순서는 [appendix-b/](../appendix-b/)에 있습니다.
- 만든 것을 다른 사람에게 보여주는 정리는 [appendix-g/](../appendix-g/)에 있습니다.
- 장별 요청문과 Source는 [chapters/](../../chapters/)에 장 번호대로 있습니다.
