"""
KOBIS(영화진흥위원회 영화관입장권통합전산망) 연도별 박스오피스 TOP 20 리포트 생성 스크립트

- 출처 페이지: https://www.kobis.or.kr/kobis/business/stat/offc/findYearlyBoxOfficeList.do
- 조회 기준 연도: 2024
- 조회 조건: 영화구분 = 전체, 국적 = 전체 (사이트 기본 검색 조건)
- 데이터 수집 방법: 위 페이지의 검색 폼(searchForm)이 POST로 제출하는 것과 동일하게
  sSearchYearFrom=2024, sMultiMovieYn=(전체), sRepNationCd=(전체) 값으로 요청하여
  얻은 결과 표(관객수 내림차순, 사이트 기본 정렬)에서 상위 20개 행을 그대로 옮겨 적었다.
- 이 스크립트는 위 방식으로 수집·검증한 값을 상수로 담고 있으며, 흥행 원인/이유는
  KOBIS 데이터에 없는 내용이므로 추가하지 않았다.
"""

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
import sys

# English-locale Windows pipes stdout as cp1252; keep Korean output from crashing the build.
for _stream in (sys.stdout, sys.stderr):
    getattr(_stream, "reconfigure", lambda **_: None)(errors="replace")

SOURCE_URL = "https://www.kobis.or.kr/kobis/business/stat/offc/findYearlyBoxOfficeList.do"
QUERY_YEAR = 2024
RETRIEVED_ON = "2026-08-29"  # 이 리포트를 생성한 날짜(자료 재조회 시 최신값과 다를 수 있음)

# (순위, 영화명, 개봉일, 관객수, 매출액(원))
# KOBIS "연도별 박스오피스" 조회 결과(조회기간 2024, 영화구분/국적 전체) 상위 20건
TOP20 = [
    (1, "파묘", "2024-02-22", 11_913_725, 115_148_478_414),
    (2, "범죄도시4", "2024-04-24", 11_501_621, 110_038_420_734),
    (3, "인사이드 아웃 2", "2024-06-12", 8_799_013, 84_509_284_036),
    (4, "베테랑2", "2024-09-13", 7_525_339, 72_474_035_814),
    (5, "파일럿", "2024-07-31", 4_718_036, 43_204_079_201),
    (6, "웡카", "2024-01-31", 3_531_468, 33_956_553_189),
    (7, "모아나 2", "2024-11-27", 3_372_815, 31_118_051_070),
    (8, "소방관", "2024-12-04", 3_317_296, 31_161_375_290),
    (9, "하얼빈", "2024-12-24", 2_755_236, 26_249_028_320),
    (10, "탈주", "2024-07-03", 2_560_938, 24_230_164_596),
    (11, "위키드", "2024-11-20", 2_059_163, 20_277_702_850),
    (12, "듄: 파트2", "2024-02-28", 2_016_202, 23_639_319_949),
    (13, "에이리언: 로물루스", "2024-08-14", 2_002_033, 20_443_955_430),
    (14, "데드풀과 울버린", "2024-07-24", 1_977_010, 20_489_875_630),
    (15, "핸섬가이즈", "2024-06-26", 1_774_645, 16_581_767_601),
    (16, "하이재킹", "2024-06-21", 1_773_930, 16_842_739_086),
    (17, "쿵푸팬더4", "2024-04-10", 1_771_601, 16_534_473_152),
    (18, "베놈: 라스트 댄스", "2024-10-23", 1_763_723, 17_253_839_788),
    (19, "시민덕희", "2024-01-24", 1_715_064, 16_174_180_097),
    (20, "퓨리오사: 매드맥스 사가", "2024-05-22", 1_605_454, 16_489_584_088),
]

HEADER_FILL = PatternFill(start_color="305496", end_color="305496", fill_type="solid")
HEADER_FONT = Font(color="FFFFFF", bold=True)
TITLE_FONT = Font(bold=True, size=14)


def build_top20_sheet(wb):
    ws = wb.active
    ws.title = "TOP20"

    ws["A1"] = f"KOBIS 연도별 박스오피스 TOP 20 ({QUERY_YEAR}년, 조회 기준)"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:E1")

    headers = ["순위", "영화명", "개봉일", "관객수", "매출액(원)"]
    header_row = 3
    for col, text in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=col, value=text)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    for i, (rank, title, open_dt, audience, sales) in enumerate(TOP20):
        r = header_row + 1 + i
        ws.cell(row=r, column=1, value=rank).alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=2, value=title)
        ws.cell(row=r, column=3, value=open_dt).alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=4, value=audience).number_format = "#,##0"
        ws.cell(row=r, column=5, value=sales).number_format = "#,##0"

    widths = [6, 26, 12, 14, 20]
    for col, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col)].width = w

    ws.freeze_panes = "A4"
    return ws, header_row


def build_chart_sheet(wb, data_ws, header_row):
    ws = wb.create_sheet("차트")
    ws["A1"] = f"{QUERY_YEAR}년 박스오피스 TOP 20 - 관객수 / 매출액"
    ws["A1"].font = TITLE_FONT

    last_row = header_row + len(TOP20)

    audience_chart = BarChart()
    audience_chart.type = "col"
    audience_chart.title = "TOP 20 관객수 (명)"
    audience_chart.y_axis.title = "관객수"
    audience_chart.x_axis.title = "영화명"
    audience_chart.height = 10
    audience_chart.width = 26

    cats = Reference(data_ws, min_col=2, min_row=header_row + 1, max_row=last_row)
    audience_data = Reference(data_ws, min_col=4, min_row=header_row, max_row=last_row)
    audience_chart.add_data(audience_data, titles_from_data=True)
    audience_chart.set_categories(cats)
    ws.add_chart(audience_chart, "A3")

    sales_chart = BarChart()
    sales_chart.type = "col"
    sales_chart.title = "TOP 20 매출액 (원)"
    sales_chart.y_axis.title = "매출액(원)"
    sales_chart.x_axis.title = "영화명"
    sales_chart.height = 10
    sales_chart.width = 26

    sales_data = Reference(data_ws, min_col=5, min_row=header_row, max_row=last_row)
    sales_chart.add_data(sales_data, titles_from_data=True)
    sales_chart.set_categories(cats)
    ws.add_chart(sales_chart, "A24")

    ws.column_dimensions["A"].width = 4
    return ws


def build_summary_sheet(wb):
    ws = wb.create_sheet("요약")
    ws["A1"] = f"{QUERY_YEAR}년 박스오피스 TOP 20 핵심 요약"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:B1")

    total_audience = sum(row[3] for row in TOP20)
    total_sales = sum(row[4] for row in TOP20)
    avg_audience = total_audience / len(TOP20)
    avg_sales = total_sales / len(TOP20)
    top1 = TOP20[0]
    last = TOP20[-1]

    rows = [
        ("항목", "값"),
        ("조회 기준 연도", f"{QUERY_YEAR}년"),
        ("집계 대상", "TOP 20 (연도별 박스오피스 상위 20개 영화)"),
        ("1위 영화", f"{top1[1]} (관객수 {top1[3]:,}명, 매출액 {top1[4]:,}원)"),
        ("20위 영화", f"{last[1]} (관객수 {last[3]:,}명, 매출액 {last[4]:,}원)"),
        ("TOP 20 관객수 합계", f"{total_audience:,}명"),
        ("TOP 20 매출액 합계", f"{total_sales:,}원"),
        ("TOP 20 평균 관객수", f"{avg_audience:,.0f}명"),
        ("TOP 20 평균 매출액", f"{avg_sales:,.0f}원"),
    ]

    for i, (label, value) in enumerate(rows, start=3):
        c1 = ws.cell(row=i, column=1, value=label)
        c2 = ws.cell(row=i, column=2, value=value)
        if i == 3:
            c1.font = HEADER_FONT
            c2.font = HEADER_FONT
            c1.fill = HEADER_FILL
            c2.fill = HEADER_FILL
        else:
            c1.font = Font(bold=True)

    note_row = len(rows) + 5
    ws.cell(
        row=note_row,
        column=1,
        value=(
            "※ 위 값은 KOBIS 공식 데이터(관객수·매출액)를 그대로 합산/평균한 결과이며, "
            "흥행 원인이나 이유에 대한 해석·추측은 포함하지 않았습니다."
        ),
    )
    ws.cell(row=note_row, column=1).font = Font(italic=True, color="555555")
    ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=2)

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 60
    return ws


def build_source_sheet(wb):
    ws = wb.create_sheet("출처")
    ws["A1"] = "출처 및 조회 정보"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:B1")

    rows = [
        ("항목", "내용"),
        ("데이터 제공", "영화진흥위원회(KOFIC) 영화관입장권통합전산망(KOBIS)"),
        ("통계 페이지", "연도별 박스오피스"),
        ("출처 URL", SOURCE_URL),
        ("조회 기준 연도", f"{QUERY_YEAR}년"),
        ("조회 조건 - 영화구분", "전체 (일반영화 + 독립·예술영화)"),
        ("조회 조건 - 국적", "전체 (한국 + 외국)"),
        ("정렬 기준", "사이트 기본 표시 순서(관객수 내림차순)"),
        ("본 리포트 자료 조회일", RETRIEVED_ON),
        (
            "재조회 방법",
            "위 URL 접속 → 조회기간(연도) 2024 선택 → 영화구분/국적 전체 선택 → '조회' 클릭",
        ),
        (
            "비고",
            "KOBIS 통계는 2011년 이후 통합전산망 집계 기준이며, 최신 수치는 사이트에서 "
            "재조회 시 갱신될 수 있습니다. 본 리포트는 흥행 원인에 대한 추측을 포함하지 않고, "
            "KOBIS가 제공하는 순위·관객수·매출액 데이터만 사용했습니다.",
        ),
    ]

    for i, (label, value) in enumerate(rows, start=3):
        c1 = ws.cell(row=i, column=1, value=label)
        c2 = ws.cell(row=i, column=2, value=value)
        c2.alignment = Alignment(wrap_text=True, vertical="top")
        if i == 3:
            c1.font = HEADER_FONT
            c2.font = HEADER_FONT
            c1.fill = HEADER_FILL
            c2.fill = HEADER_FILL
        else:
            c1.font = Font(bold=True)

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 70
    return ws


def main():
    wb = Workbook()
    data_ws, header_row = build_top20_sheet(wb)
    build_chart_sheet(wb, data_ws, header_row)
    build_summary_sheet(wb)
    build_source_sheet(wb)

    out_path = "movie-report-2024.xlsx"
    wb.save(out_path)
    print(f"저장 완료: {out_path}")


if __name__ == "__main__":
    main()
