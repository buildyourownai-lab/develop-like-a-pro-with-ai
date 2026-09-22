"""movie-report-2024.xlsx가 아래 조건을 만족하는지 반복 검사한다.

1. TOP 20이 빠짐없이 있어야 한다
2. 순위는 1위부터 20위까지 있어야 한다
3. 영화명이 빠지면 안 된다
4. 모든 영화에 관객수와 매출액이 있어야 한다
5. TOP 20의 영화명·관객수·매출액이 source/kobis-2024-source.xlsx(기준 자료)와 같아야 한다
6. 조회 기준 연도 2024와 KOBIS 출처가 남아 있어야 한다
7. 영화별 관객수 합계와 요약에 적힌 총 관객수가 같아야 한다
"""

import re

TOTAL_AUDIENCE_LABEL = "TOP 20 관객수 합계"


def _extract_number(text):
    """'78,454,312명'처럼 숫자와 단위가 섞인 문자열에서 숫자만 뽑아 정수로 돌려준다."""
    digits = re.sub(r"[^0-9]", "", str(text))
    return int(digits)


class TestTop20Completeness:
    """TOP 20 표가 빠짐없이, 올바른 순서로 채워져 있는지 확인한다."""

    def test_20개_영화가_모두_있다(self, report_top20):
        assert len(report_top20) == 20, (
            f"TOP20 시트에 20행이 있어야 하는데 {len(report_top20)}행만 있습니다."
        )

    def test_순위가_1위부터_20위까지_순서대로_있다(self, report_top20):
        ranks = [row["순위"] for row in report_top20]
        assert ranks == list(range(1, 21)), (
            f"순위가 1~20 순서와 일치하지 않습니다. 실제 순위: {ranks}"
        )

    def test_영화명이_비어있지_않다(self, report_top20):
        missing = [row["순위"] for row in report_top20 if not row["영화명"]]
        assert not missing, f"영화명이 비어 있는 순위: {missing}"

    def test_모든_영화에_관객수와_매출액이_있다(self, report_top20):
        broken = [
            row["순위"]
            for row in report_top20
            if not isinstance(row["관객수"], (int, float))
            or row["관객수"] <= 0
            or not isinstance(row["매출액"], (int, float))
            or row["매출액"] <= 0
        ]
        assert not broken, f"관객수 또는 매출액이 비어있거나 잘못된 순위: {broken}"


class TestMatchesSource:
    """보관해 둔 KOBIS 기준 자료(source/kobis-2024-source.xlsx)와 값이 같은지 확인한다."""

    def test_영화명_관객수_매출액이_기준자료와_일치한다(self, report_top20, source_top20):
        source_by_rank = {row["순위"]: row for row in source_top20}
        mismatches = []
        for row in report_top20:
            rank = row["순위"]
            src = source_by_rank.get(rank)
            if src is None:
                mismatches.append(f"{rank}위: 기준 자료에 해당 순위가 없음")
                continue
            for field in ("영화명", "관객수", "매출액"):
                if row[field] != src[field]:
                    mismatches.append(
                        f"{rank}위 {field}: 보고서={row[field]!r}, 기준자료={src[field]!r}"
                    )
        assert not mismatches, "보고서와 기준 자료 값이 다릅니다:\n" + "\n".join(mismatches)


class TestProvenance:
    """조회 기준 연도(2024)와 KOBIS 출처가 보고서에 남아 있는지 확인한다."""

    def test_조회_기준_연도가_2024로_남아있다(self, report_source_info):
        year_text = report_source_info.get("조회 기준 연도", "")
        assert "2024" in str(year_text), (
            f"'출처' 시트의 '조회 기준 연도' 값에 2024가 없습니다: {year_text!r}"
        )

    def test_KOBIS_출처가_남아있다(self, report_source_info):
        provider = str(report_source_info.get("데이터 제공", ""))
        url = str(report_source_info.get("출처 URL", ""))
        assert "KOBIS" in provider, f"'데이터 제공' 항목에 KOBIS 표기가 없습니다: {provider!r}"
        assert "kobis.or.kr" in url, f"'출처 URL' 항목에 kobis.or.kr 주소가 없습니다: {url!r}"


class TestSummaryTotals:
    """영화별 관객수 합계와 '요약' 시트에 적힌 총 관객수가 일치하는지 확인한다."""

    def test_관객수_합계가_요약값과_일치한다(self, report_top20, report_summary):
        computed_total = sum(row["관객수"] for row in report_top20)
        summary_text = report_summary.get(TOTAL_AUDIENCE_LABEL)
        assert summary_text is not None, (
            f"'요약' 시트에 '{TOTAL_AUDIENCE_LABEL}' 항목이 없습니다."
        )
        summary_total = _extract_number(summary_text)
        assert computed_total == summary_total, (
            f"영화별 관객수 합계({computed_total:,}명)와 "
            f"요약의 총 관객수({summary_total:,}명)가 다릅니다."
        )
