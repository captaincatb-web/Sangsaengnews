"""일본 상장사 3개년 연간 매출·영업이익을 EDINET API v2(유가증권보고서 재무 CSV)에서 수집한다. 결과는 비공개 폴더에만 쓴다.
- 대상: <GROWTH_PRIVATE_DIR>/jp_targets.csv (entity_key, 목록표기, 공식법인명, 티커, 결산월, 대표업종). EDINET 증권코드 = 티커 + '0'.
- 공시 시기에 맞춰 3·6·9·12월 말 제출 창(약 25일)을 2023~2026년에 걸쳐 훑어 docTypeCode 120(유가증권보고서)을 찾고, 문서마다 type=5(CSV)를 내려받는다.
- 개별(個別) 행을 우선하고 개별이 없으면 연결(連結)을 쓰되 scope 열에 표시한다. 법인별 3개년은 같은 기준으로 통일한다(개별로 3개년이 완전하면 개별, 아니면 연결로 완전할 때 연결). 매출·영업이익은 같은 회계기간의 값만 쓴다.
- 키는 헤더로만 보내고 403·429는 기록 후 즉시 중단한다. 출력 edinet_rows.csv 는 조사 CSV 와 같은 열(금액단위 1, 통화 JPY, 값은 원 단위)이라 ingest_overseas_csv.py 로 반입한다. 로그에는 건수만 출력한다."""
import csv, datetime as dt, io, json, os, sys, time, urllib.error, urllib.request, zipfile
from pathlib import Path
KEY = os.environ.get("EDINET_API_KEY", ""); OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve()
BASE = "https://api.edinet-fsa.go.jp/api/v2"
REV = ("jppfs_cor:NetSales", "jppfs_cor:Revenue", "jppfs_cor:OperatingRevenue1", "jpigp_cor:RevenueIFRS")
OPI = ("jppfs_cor:OperatingIncome", "jpigp_cor:OperatingProfitLossIFRS")
COLS = ["목록표기", "공식법인명", "상장여부", "거래소", "티커", "결산월", "회계연도", "기간시작", "기간종료", "통화", "금액단위", "매출", "영업이익", "연결/개별", "출처URL", "쪽/표위치", "확신도(높음/중간/낮음)", "비고", "대표업종(소재/부품/장비)", "대표업종근거(반도체 관련 매출 비중과 출처)"]
log = {"calls": 0, "stopped": None}


def windows(months=(3, 6, 9, 12)):
    """유가증권보고서 제출 창: 결산월 + 3개월째 달의 8일부터 27일간(대부분 결산 후 3개월 안에 제출). months 는 제출 달 목록."""
    out = []
    for y in range(2023, 2027):
        for m in sorted(set(months)):
            s = dt.date(y, m, 8); out += [s + dt.timedelta(days=i) for i in range(0, 27) if (s + dt.timedelta(days=i)) <= dt.date.today()]
    return sorted(set(out))


def get(path, params=None, raw=False):
    q = "" if not params else "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(BASE + path + q, headers={"Ocp-Apim-Subscription-Key": KEY, "User-Agent": "growth-edinet"})
    time.sleep(0.35); log["calls"] += 1
    try:
        with urllib.request.urlopen(req, timeout=90) as r: b = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 429): log["stopped"] = e.code; raise SystemExit(f"[ABORT] EDINET {e.code}: 중단")
        return None
    return b if raw else json.loads(b.decode("utf-8"))


def parse_doc(zbytes):
    z = zipfile.ZipFile(io.BytesIO(zbytes)); out = {}
    for n in z.namelist():
        if not n.lower().endswith(".csv") or "jpcrp" not in n: continue
        for r in csv.DictReader(io.StringIO(z.read(n).decode("utf-16", errors="replace")), delimiter="\t"):
            ctx = r.get("コンテキストID", ""); eid = r.get("要素ID")
            if eid in REV: item = "rev"
            elif eid in OPI: item = "op"
            else: continue
            if ctx not in ("CurrentYearDuration", "CurrentYearDuration_NonConsolidatedMember"): continue  # 당기 값만(전기는 그 해 문서에서 읽음)
            scope = "개별" if "NonConsolidated" in ctx else "연결"
            try: v = float((r.get("値") or "").replace(",", ""))
            except ValueError: continue
            out.setdefault(scope, {}).setdefault(item, v)
    return out


def choose_scope(per_year):
    """per_year: {period_end: {scope: {rev, op}}} → 법인별 한 기준(개별 우선, 3개년 완전 여부로 판단)."""
    full = lambda sc: sum(1 for pe, d in per_year.items() if d.get(sc, {}).get("rev") is not None and d.get(sc, {}).get("op") is not None)
    return "개별" if full("개별") >= full("연결") and full("개별") > 0 else ("연결" if full("연결") > 0 else None)


def main():
    if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("EDINET_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
    targets = {(r["티커"].strip() + "0"): r for r in csv.DictReader(open(OUT / "jp_targets.csv", encoding="utf-8-sig")) if r.get("티커", "").strip()}
    only = {x.strip() for x in os.environ.get("EDINET_ONLY", "").split(",") if x.strip()}  # 일부 티커만 다시 수집(쉼표 구분)
    if only: targets = {k: v for k, v in targets.items() if v["티커"].strip() in only}
    found = {}
    fm = {(int(r.get("결산월") or 3) + 2) % 12 + 1 for r in targets.values()}  # 결산월 → 제출 달(결산월+3). 1·2월 결산(4·5월 제출)도 포함
    for d in windows(fm):
        res = get("/documents.json", {"date": d.isoformat(), "type": 2})
        for x in (res or {}).get("results", []):
            sc = x.get("secCode") or ""
            if sc in targets and x.get("docTypeCode") == "120" and x.get("periodEnd"): found.setdefault((sc, x["periodEnd"]), x)
    data = {}; docs = {}
    for (sc, pe), x in sorted(found.items()):
        if not ("2023" <= pe[:4] <= "2025"): continue
        z = get(f"/documents/{x['docID']}", {"type": 5}, raw=True)
        if not z: continue
        try: data.setdefault(sc, {})[pe] = parse_doc(z); docs[(sc, pe)] = x
        except Exception: continue
    rows = []; n_ent = n_full = 0
    for sc, per in sorted(data.items()):
        t = targets[sc]; n_ent += 1
        # 대상 목록의 '기준' 열(연결/개별)이 있으면 그 기준만 쓴다. 지주회사는 개별 재무가 지주 수익(배당 등) 위주라 사업 실적이 아니므로 연결로 지정한다
        forced = (t.get("기준") or "").strip(); scope = forced if forced in ("연결", "개별") else choose_scope(per)
        if not scope: continue
        got = 0
        for pe, d in sorted(per.items()):
            v = d.get(scope, {}); x = docs[(sc, pe)]
            if v.get("rev") is None and v.get("op") is None: continue
            got += v.get("rev") is not None and v.get("op") is not None
            rows.append({"목록표기": t["목록표기"], "공식법인명": t["공식법인명"], "상장여부": "상장 본사", "거래소": "TSE", "티커": t["티커"], "결산월": t.get("결산월", ""), "회계연도": pe[:4], "기간시작": x.get("periodStart", ""), "기간종료": pe, "통화": "JPY", "금액단위": "1",
                         "매출": "" if v.get("rev") is None else int(v["rev"]), "영업이익": "" if v.get("op") is None else int(v["op"]), "연결/개별": scope, "출처URL": f"{BASE}/documents/{x['docID']}?type=5", "쪽/표위치": f"EDINET API type=5 재무 CSV / {'NetSales·OperatingIncome(NonConsolidated)' if scope == '개별' else 'NetSales·OperatingIncome(연결)'}", "확신도(높음/중간/낮음)": "높음",
                         "비고": "EDINET 자동 수집(유가증권보고서 120). 반도체 소부장 적격성·매출 비중은 별도 판정" + (" · 지주회사라 연결 기준 지정" if (t.get("기준") or "").strip() == "연결" else ""), "대표업종(소재/부품/장비)": t.get("대표업종", ""), "대표업종근거(반도체 관련 매출 비중과 출처)": ""})
        n_full += got >= 3
    with open(OUT / "edinet_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(json.dumps({"api_calls": log["calls"], "targets": len(targets), "docs_found": len(found), "entities_with_data": n_ent, "entities_3y_complete": n_full, "rows": len(rows), "stopped": log["stopped"]}, ensure_ascii=False))


if __name__ == "__main__": main()
