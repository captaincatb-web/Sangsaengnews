"""EDINET API v2 실접속 점검: 지정한 일본 상장사의 유가증권보고서(docTypeCode 120)를 찾아 재무 CSV(type=5)를 내려받고 매출·영업이익의 연결/개별 행을 읽을 수 있는지 확인한다.
키는 헤더로만 보내고(URL·로그에 남기지 않음) 403·429는 기록 후 즉시 중단한다. 결과 수치는 비공개 폴더 edinet_live.csv 에만 쓰고 로그에는 건수·기준만 출력한다.
사용: EDINET_API_KEY=... GROWTH_PRIVATE_DIR=<비공개> python scripts/growth/edinet_live_check.py"""
import csv, datetime as dt, io, json, os, sys, time, urllib.request, urllib.error, zipfile
from pathlib import Path
KEY = os.environ.get("EDINET_API_KEY", ""); OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve()
if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("EDINET_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
BASE = "https://api.edinet-fsa.go.jp/api/v2"
TARGETS = {"80350": "TEL", "68570": "ADVANTEST", "61460": "DISCO", "65250": "KOKUSAI", "40620": "IBIDEN", "63150": "TOWA", "77290": "TOKYO SEIMITSU"}  # 3월 결산(6월 하순 제출)
DATES = [dt.date(2025, 6, 18) + dt.timedelta(days=i) for i in range(0, 14)]
REV = ("jppfs_cor:NetSales", "jppfs_cor:Revenue", "jpigp_cor:RevenueIFRS", "jppfs_cor:OperatingRevenue1")
OPI = ("jppfs_cor:OperatingIncome", "jpigp_cor:OperatingProfitLossIFRS")
log = {"calls": 0, "stopped": None}


def get(path, params=None, raw=False):
    q = "" if not params else "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(BASE + path + q, headers={"Ocp-Apim-Subscription-Key": KEY, "User-Agent": "growth-edinet-check"})
    time.sleep(0.4); log["calls"] += 1
    try:
        with urllib.request.urlopen(req, timeout=60) as r: b = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 429): log["stopped"] = e.code; raise SystemExit(f"[ABORT] EDINET {e.code}: 중단")
        return None, e.code
    return (b if raw else json.loads(b.decode("utf-8"))), 200


def parse(zbytes):
    z = zipfile.ZipFile(io.BytesIO(zbytes)); rows = []
    for n in z.namelist():
        if not n.lower().endswith(".csv") or "jpcrp" not in n: continue
        t = z.read(n).decode("utf-16", errors="replace")
        for r in csv.DictReader(io.StringIO(t), delimiter="\t"): rows.append(r)
    return rows


def pick(rows, ids):
    out = {}
    for r in rows:
        if r.get("要素ID") not in ids: continue
        ctx = r.get("コンテキストID", "")
        if not ctx.startswith(("CurrentYearDuration", "Prior1YearDuration")) or "_" in ctx.replace("NonConsolidatedMember", "").replace("CurrentYearDuration", "").replace("Prior1YearDuration", "").strip("_") and False: continue
        scope = "個別" if "NonConsolidatedMember" in ctx else ("連結" if ctx in ("CurrentYearDuration", "Prior1YearDuration") else None)
        if not scope: continue
        yr = "cur" if ctx.startswith("Current") else "prior"
        out[(scope, yr)] = (r.get("値"), r.get("単位"))
    return out


def main():
    found = {}
    for d in DATES:
        res, code = get("/documents.json", {"date": d.isoformat(), "type": 2})
        if not res: continue
        for x in res.get("results", []):
            sc = (x.get("secCode") or "")
            if sc in TARGETS and x.get("docTypeCode") == "120" and (sc, x.get("periodEnd")) not in found: found[(sc, x.get("periodEnd"))] = x
    rows_out = []; summary = []
    for (sc, pe), x in sorted(found.items()):
        z, code = get(f"/documents/{x['docID']}", {"type": 5}, raw=True)
        if not z: summary.append((TARGETS[sc], pe, "다운로드 실패", code)); continue
        try: rows = parse(z)
        except Exception as e: summary.append((TARGETS[sc], pe, "CSV 해석 실패", type(e).__name__)); continue
        rev, op = pick(rows, REV), pick(rows, OPI); scopes = sorted({k[0] for k in list(rev) + list(op)})
        summary.append((TARGETS[sc], pe, f"CSV행 {len(rows)}", "/".join(scopes) or "매출·영업이익 행 없음"))
        for (scope, yr), (v, u) in rev.items(): rows_out.append({"sec": sc, "period_end": pe, "doc": x["docID"], "item": "revenue", "scope": scope, "year": yr, "value": v, "unit": u})
        for (scope, yr), (v, u) in op.items(): rows_out.append({"sec": sc, "period_end": pe, "doc": x["docID"], "item": "op_income", "scope": scope, "year": yr, "value": v, "unit": u})
    with open(OUT / "edinet_live.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["sec", "period_end", "doc", "item", "scope", "year", "value", "unit"]); w.writeheader(); w.writerows(rows_out)
    print(json.dumps({"api_calls": log["calls"], "docs_found": len(found), "targets": len(TARGETS), "stopped": log["stopped"]}, ensure_ascii=False))
    for s in summary: print("  ", *s)
main()
