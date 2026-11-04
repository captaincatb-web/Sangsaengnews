"""대만 상장사 3개년 연간 매출·영업이익을 FinMind API(TaiwanStockFinancialStatements, 분기 손익)에서 수집한다. 결과는 비공개 폴더에만 쓴다.
- 대상: <GROWTH_PRIVATE_DIR>/tw_targets.csv (목록표기, 공식법인명, 티커, 대표업종). 토큰은 환경변수 FINMIND_API_TOKEN, Authorization 헤더로만 보낸다.
- 연간 = 해당 연도 1~4분기(3·6·9·12월 말) 값 4개가 모두 있을 때의 합계(하나라도 없으면 그 연도는 비움, 추정하지 않음). 통화 TWD, 연결 기준(FinMind 제공 범위).
- 402·403·429 는 기록 후 즉시 중단. 출력 finmind_rows.csv 는 조사 CSV 와 같은 열(금액단위 1)이라 ingest_overseas_csv.py 로 반입한다. 로그에는 건수만 출력한다."""
import csv, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path
TOKEN = os.environ.get("FINMIND_API_TOKEN", ""); OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve()
URL = "https://api.finmindtrade.com/api/v4/data"
COLS = ["목록표기", "공식법인명", "상장여부", "거래소", "티커", "결산월", "회계연도", "기간시작", "기간종료", "통화", "금액단위", "매출", "영업이익", "연결/개별", "출처URL", "쪽/표위치", "확신도(높음/중간/낮음)", "비고", "대표업종(소재/부품/장비)", "대표업종근거(반도체 관련 매출 비중과 출처)"]
QEND = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}; QSTART = {1: "01-01", 2: "04-01", 3: "07-01", 4: "10-01"}
log = {"calls": 0, "stopped": None}


def fetch(ticker):
    q = f"?dataset=TaiwanStockFinancialStatements&data_id={ticker}&start_date=2022-01-01"
    req = urllib.request.Request(URL + q, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "growth-finmind"})
    time.sleep(0.5); log["calls"] += 1
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (402, 403, 429): log["stopped"] = e.code; raise SystemExit(f"[ABORT] FinMind {e.code}: 중단")
        return None


def annual(data):
    """{연도: (매출, 영업이익)} — 4개 분기 모두 있을 때만 합산."""
    q = {}
    for r in data or []:
        if r.get("type") in ("Revenue", "OperatingIncome"):
            try: y, m = int(r["date"][:4]), int(r["date"][5:7]); q.setdefault((y, m // 3), {})[r["type"]] = float(r["value"])
            except (ValueError, KeyError, TypeError): continue
    out = {}
    for y in {k[0] for k in q}:
        qs = [q.get((y, i), {}) for i in (1, 2, 3, 4)]
        if all("Revenue" in x and "OperatingIncome" in x for x in qs): out[y] = (sum(x["Revenue"] for x in qs), sum(x["OperatingIncome"] for x in qs))
    return out


def main():
    if not TOKEN or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("FINMIND_API_TOKEN 과 GROWTH_PRIVATE_DIR 가 필요합니다")
    tg = list(csv.DictReader(open(OUT / "tw_targets.csv", encoding="utf-8-sig"))); rows = []; res = {"targets": len(tg), "with_data": 0, "complete_3y": 0}
    for t in tg:
        j = fetch(t["티커"]); ann = annual((j or {}).get("data")) if j and j.get("status") == 200 else {}
        got = [y for y in (2023, 2024, 2025) if y in ann]
        res["with_data"] += bool(got); res["complete_3y"] += len(got) == 3
        for y in got:
            rv, op = ann[y]
            rows.append({"목록표기": t["목록표기"], "공식법인명": t["공식법인명"], "상장여부": "상장", "거래소": "TWSE", "티커": t["티커"], "결산월": "12", "회계연도": y,
                         "기간시작": f"{y}-01-01", "기간종료": f"{y}-12-31", "통화": "TWD", "금액단위": "1", "매출": int(rv), "영업이익": int(op), "연결/개별": "연결",
                         "출처URL": f"https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id={t['티커']}", "쪽/표위치": "분기 Revenue·OperatingIncome 4개 합계",
                         "확신도(높음/중간/낮음)": "중간", "비고": "FinMind 분기 합산(원 출처 TWSE 공시)", "대표업종(소재/부품/장비)": t.get("대표업종", ""), "대표업종근거(반도체 관련 매출 비중과 출처)": ""})
    if rows:
        with open(OUT / "finmind_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(json.dumps({**res, "rows": len(rows), **log}, ensure_ascii=False))


if __name__ == "__main__": main()
