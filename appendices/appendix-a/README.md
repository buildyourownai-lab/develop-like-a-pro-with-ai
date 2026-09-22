# 부록 A. 책의 모든 자료를 한곳에 모았습니다

## 이 부록으로 하는 일

이 책의 자료가 어디에 있는지 알고, 저자가 실제로 만든 결과물을 열어 내가 만든 것과
비교합니다. 새로 만드는 것은 없습니다. 찾을 수 있게 되는 것이 전부입니다.

자료가 있는 곳은 두 곳입니다. 모든 자료가 모인 한곳이 이 저장소이고, 완성된 프로젝트
자체는 프로젝트 저장소 다섯 곳에 있습니다. 검증 기록은 항상 이 저장소에 있습니다.

## 프롬프트

[prompts.md](prompts.md)에 이 부록에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 순서대로 합니다

**1. 첫 화면에서 폴더 세 개를 찾습니다** --- 이 저장소의 [첫 화면](../../)을 열면
README.md와 폴더가 보입니다. 열어볼 것은 셋입니다.

| 폴더 | 무엇이 있나 | 언제 여나 |
|---|---|---|
| [chapters/](../../chapters/) | 장별 요청문과 장별 Source | 그 장을 다시 해보거나 다시 출발할 때 |
| [appendices/](../) | 부록에서 붙여 넣는 요청문과 가져다 쓰는 골격 파일 | 부록을 따라 할 때 |
| [verification/](../../verification/) | 저자가 다시 실행한 검증 기록과 저자가 만든 결과물 | 내가 만든 것과 비교할 때 |

assets는 저장소 문서에 쓰는 이미지 폴더이므로 열어볼 일이 없습니다.

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
