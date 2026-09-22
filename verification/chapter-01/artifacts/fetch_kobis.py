"""KOBIS 공식통계 연도별 박스오피스에서 조회 기준 연도 2024의 TOP 20을 가져온다."""

import json
import re
import urllib.parse
import urllib.request
import http.cookiejar

LIST_URL = "https://www.kobis.or.kr/kobis/business/stat/offc/findYearlyBoxOfficeList.do"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", UA)]

first = opener.open(LIST_URL, timeout=60).read().decode("utf-8", "replace")
token = re.search(r'name="CSRFToken"\s+value="([^"]+)"', first).group(1)

body = urllib.parse.urlencode(
    {
        "CSRFToken": token,
        "loadEnd": "0",
        "searchType": "search",
        "sSearchYearFrom": "2024",
        "sMultiMovieYn": "",
        "sRepNationCd": "",
    }
).encode()

req = urllib.request.Request(LIST_URL, data=body)
req.add_header("Referer", LIST_URL)
req.add_header("Content-Type", "application/x-www-form-urlencoded")
html = opener.open(req, timeout=60).read().decode("utf-8", "replace")

tbody = re.search(r"<tbody>(.*?)</tbody>", html, re.S).group(1)


def clean(cell):
    text = re.sub(r"<[^>]+>", "", cell)
    return text.replace("&nbsp;", " ").replace("&amp;", "&").strip()


def to_int(text):
    digits = re.sub(r"[^0-9]", "", text)
    return int(digits) if digits else 0


rows = []
for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tbody, re.S):
    cells = [clean(td) for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
    if len(cells) < 7 or not cells[0].isdigit():
        continue
    rows.append(
        {
            "rank": int(cells[0]),
            "title": cells[1],
            "release": cells[2],
            "revenue": to_int(cells[3]),
            "share": cells[4],
            "audience": to_int(cells[5]),
            "screens": to_int(cells[6]),
        }
    )

top20 = sorted(rows, key=lambda r: r["rank"])[:20]

with open("kobis-2024-top20.json", "w", encoding="utf-8") as f:
    json.dump({"year": 2024, "source": LIST_URL, "rows": top20}, f, ensure_ascii=False, indent=2)

print(f"rows_parsed={len(rows)} top20={len(top20)}")
for r in top20[:5]:
    print(f"  {r['rank']:>2} {r['title']} 관객 {r['audience']:,} 매출 {r['revenue']:,}")
