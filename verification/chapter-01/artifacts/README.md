# 1장 검증에 사용한 파일

저자가 1장을 확인할 때 실제로 돌린 파일과 그 결과입니다. 실습에 필요한 파일은 아니고,
저자가 어떻게 확인했는지 그대로 보여주기 위한 자료입니다.

| 파일 | 무엇인가 |
|---|---|
| [movie-report-2024.xlsx](movie-report-2024.xlsx) | 실행이 실제로 만든 보고서. 확인 목록 7개를 통과한 그 파일입니다 |
| [checklist-result.json](checklist-result.json) | 확인 결과와 측정 조건 |
| [check7.py](check7.py) | 1장 확인 목록 7개를 검사하는 코드 |
| [fetch_kobis.py](fetch_kobis.py) | KOBIS 공식통계를 따로 조회해 보고서와 대조하기 위한 코드 |
| [kobis-2024-top20.json](kobis-2024-top20.json) | 대조에 사용한 조회 결과 |

## 돌려보기

```bash
# 만든 보고서가 확인 목록 7개를 통과하는지
python3 check7.py <경로>/movie-report-2024.xlsx

# KOBIS 공식통계를 직접 조회 (kobis-2024-top20.json 이 생깁니다)
python3 fetch_kobis.py
```

check7.py는 **시트 이름과 열 번호를 알지 못합니다.** 순위 1~20이 연속하는 열을 찾아
그 옆을 영화명으로 보고, 관객수와 매출액은 해당 머리글 아래에 숫자 20개가 이어지는지
확인해 찾습니다. 보고서 배치가 저자와 달라도 같은 기준으로 검사되도록 이렇게
만들었습니다.
