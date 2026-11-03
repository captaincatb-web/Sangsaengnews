"""조사 결과 CSV(공식 공시 원문 기준)를 검증해 원화 환산한 해외 재무 파일(overseas_financials_ext.csv)로 바꾼다. 결과는 비공개 폴더에만 쓴다.
입력 열: 목록표기, 공식법인명, 상장여부, 거래소, 티커, 결산월, 회계연도, 기간시작, 기간종료, 통화, 매출, 영업이익, 연결/개별, 출처URL, 쪽/표위치, 확신도, 비고
규칙(어기면 그 행은 버리고 사유를 집계): 출처 URL 필수(http로 시작), 회계기간 350~380일, 숫자는 원 통화 단위의 순수 숫자, 단위 표기(백만 등)가 있으면 거부(사람이 단위를 맞춘 뒤 다시 입력),
영업이익이 비면 영업이익만 빈 값(추정 금지), 환율은 해당 회계기간의 ECB 일별 교차환율(통화/KRW) 평균 — ECB가 발표하지 않는 통화(예: TWD)는 원화 환산을 비워 두고 사유를 남긴다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/ingest_overseas_csv.py <입력.csv>"""
import csv, datetime as dt, io, json, os, re, sys, zipfile
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import name_key

OUT_COLS = ["entity_id", "year", "fiscal_year", "period_start", "period_end", "currency", "revenue_local", "op_income_local", "fx_krw_per_unit", "fx_days", "revenue_krw", "op_income_krw", "scope", "source_url", "source_ref", "confidence", "official_name"]
NUM = re.compile(r"^-?\d+(\.\d+)?$")


def parse_num(s):
    s = (s or "").strip().replace(",", "")
    if s == "": return None, None
    if NUM.match(s): return float(s), None
    return None, "숫자 형식 아님(단위 표기 포함)"


def fx_daily(raw=None):
    """{통화: [(날짜, 1통화당 원)]}. ECB 유로 기준 환율 교차: KRW/통화 = (EUR→KRW) ÷ (EUR→통화)."""
    if raw is None:
        import requests
        r = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", timeout=60); r.raise_for_status()
        raw = io.TextIOWrapper(zipfile.ZipFile(io.BytesIO(r.content)).open("eurofxref-hist.csv"), encoding="utf-8")
    out = {}
    for x in csv.DictReader(raw):
        try: d = dt.date.fromisoformat(x["Date"]); krw = float(x["KRW"])
        except (ValueError, KeyError): continue
        out.setdefault("EUR", []).append((d, krw))
        for cur, v in x.items():
            if cur in ("Date", "KRW", "") or v in ("N/A", "", None): continue
            try: out.setdefault(cur, []).append((d, krw / float(v)))
            except (ValueError, ZeroDivisionError): continue
    return out


def fx_avg(series, start, end):
    v = [x for d, x in series if start <= d <= end]
    return (sum(v) / len(v), len(v)) if v else (None, 0)


def convert(rows, fx):
    ok, rej = [], Counter()
    for r in rows:
        name = (r.get("목록표기") or "").strip()
        url = (r.get("출처URL") or "").strip()
        if not name: rej["목록표기 없음"] += 1; continue
        if not url.startswith("http"): rej["출처URL 없음"] += 1; continue
        try: s, e = dt.date.fromisoformat(r["기간시작"].strip()), dt.date.fromisoformat(r["기간종료"].strip())
        except (ValueError, KeyError, AttributeError): rej["회계기간 형식 오류"] += 1; continue
        if not 350 <= (e - s).days <= 380: rej["회계기간이 1년이 아님"] += 1; continue
        rev, err1 = parse_num(r.get("매출")); op, err2 = parse_num(r.get("영업이익"))
        if err1 or err2: rej[err1 or err2] += 1; continue
        if rev is None and op is None: rej["매출·영업이익 모두 없음"] += 1; continue
        cur = (r.get("통화") or "").strip().upper()
        avg, nd = fx_avg(fx.get(cur, []), s, e) if cur else (None, 0)
        if cur == "KRW": avg, nd = 1.0, 0
        ok.append({"entity_id": "O:" + name_key(name), "year": e.year, "fiscal_year": (r.get("회계연도") or "").strip(), "period_start": s.isoformat(), "period_end": e.isoformat(), "currency": cur,
                   "revenue_local": "" if rev is None else rev, "op_income_local": "" if op is None else op, "fx_krw_per_unit": round(avg, 4) if avg else "", "fx_days": nd,
                   "revenue_krw": rev * avg if (rev is not None and avg) else "", "op_income_krw": op * avg if (op is not None and avg) else "",
                   "scope": (r.get("연결/개별") or "").strip(), "source_url": url, "source_ref": (r.get("쪽/표위치") or "").strip(), "confidence": (r.get("확신도") or "").strip(), "official_name": (r.get("공식법인명") or "").strip()})
        if avg is None: rej["환율 없음(원화 환산 비움)"] += 1
    return ok, rej


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv or len(sys.argv) < 2: sys.exit("GROWTH_PRIVATE_DIR 와 입력 CSV 경로가 필요합니다")
    rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    ok, rej = convert(rows, fx_daily())
    with open(Path(priv) / "overseas_financials_ext.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS); w.writeheader(); w.writerows(ok)
    print(json.dumps({"input_rows": len(rows), "accepted": len(ok), "entities": len({x["entity_id"] for x in ok}), "rejected_reasons": dict(rej)}, ensure_ascii=False))


if __name__ == "__main__": main()
