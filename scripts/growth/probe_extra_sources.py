"""추가 공시 소스 접근 점검(소스당 1회 GET, 403·429는 기록 후 해당 소스 중단). 결과는 상태 코드와 응답 형태 요약만 출력한다(본문·키 출력 금지).
소스: 유럽 ESEF 공시 모음(filings.xbrl.org), EDINET 코드표(회사명↔증권코드), FinMind(대만 재무제표 API, 토큰 없이 한 건), TWSE OpenAPI 손익계산서."""
import json, os, sys, time, urllib.error, urllib.request
UA = {"User-Agent": os.environ.get("GROWTH_UA") or "growth-probe"}
SRC = [("EU ESEF filings.xbrl.org", "https://filings.xbrl.org/api/filings?page%5Bsize%5D=1"),
       ("JP EDINET 코드표", "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip"),
       ("TW FinMind(토큰 없음)", "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=2330&start_date=2024-01-01"),
       ("TW TWSE OpenAPI 손익(일반업)", "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci")]
out = []
for name, url in SRC:
    row = {"source": name, "host": url.split("/")[2]}
    try:
        req = urllib.request.Request(url, headers=UA); time.sleep(0.5)
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read(); row.update(http=r.status, bytes=len(b), kind=r.headers.get("Content-Type", "")[:40])
            if "json" in row["kind"]:
                try: j = json.loads(b.decode("utf-8")); row["json"] = (type(j).__name__ + ":" + str(len(j))) if isinstance(j, (list, dict)) else "scalar"
                except Exception: row["json"] = "해석 실패"
    except urllib.error.HTTPError as e: row.update(http=e.code, error="HTTP " + str(e.code))
    except Exception as e: row.update(http=None, error=type(e).__name__)
    out.append(row); print(row)
