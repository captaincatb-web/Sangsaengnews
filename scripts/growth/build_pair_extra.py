"""업체 비교 페이지의 공개 보강 데이터(site/data/pair-extra.json)를 만든다.
사용: GROWTH_PRIVATE_DIR=<비공개 data/pair> python scripts/growth/build_pair_extra.py
- (1) 국내업체 중 성장 분석 집계에 없는 업체: pair_audit_rows.csv(DART 사업·감사보고서 개별 실적)
- (2) 글로벌 업체의 본사 실적 중 공개 회사별 상세에 없는 본사: parents/overseas_financials_ext.csv(SEC·EDINET 공시, 원화 환산 완료). 명단의 본사 지정(p.x)과 연결
- 출력은 표시명·재무 기준·출처·2023~2025 매출·영업이익(억 원)만 담는다(법인 식별번호·DART 고유번호 없음).
- 2023·2024·2025년 매출과 영업이익이 모두 있는 곳만 싣는다(3개년 미확인은 제외, 추정 안 함)."""
import csv, datetime as dt, json, os, sys
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent.parent
YEARS = (2023, 2024, 2025); EOK = 1e8


def full(d):
    return all(y in d and d[y].get("revenue_krw") not in ("", None) and d[y].get("op_income_krw") not in ("", None) for y in YEARS)


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv: sys.exit("GROWTH_PRIVATE_DIR 가 필요합니다")
    priv = Path(priv); roster = json.loads((REPO / "site" / "data" / "pair-roster.json").read_text(encoding="utf-8"))
    ents = [(side, e) for gr in roster["groups"] for it in gr["items"] for side in ("dom", "glo") for e in it[side]]
    dom = {e["n"] for side, e in ents if side == "dom" and e.get("k") != "sub"} | {e["kx"] for side, e in ents if side == "glo" and e.get("kx")}  # 국내업체 + 글로벌 업체의 한국 법인(DART 개별 실적)
    par = {e["p"]["n"]: e["p"]["x"] for side, e in ents if side == "glo" and e.get("p", {}).get("x")}
    par.update({e["n"]: e["ex"] for side, e in ents if side == "glo" and e.get("ex")})  # 본사 자체(ex): 공개 회사별 상세에 없는 기준(예: 도쿄일렉트론 연결)을 따로 수집
    rows, skipped = [], 0
    by = {}
    for r in csv.DictReader(open(priv / "pair_audit_rows.csv", encoding="utf-8-sig")):
        if r["상태"] == "OK" and r["year"]: by.setdefault(r["표시명"], {})[int(r["year"])] = r
    for n in sorted(by):
        d = by[n]
        if n not in dom or not full(d): skipped += 1; continue
        src = {d[y]["source"] for y in YEARS}
        rows.append({"n": n, "s": "별도", "src": "·".join(sorted(src)) if len(src) > 1 else next(iter(src)),
                     "r": [round(float(d[y]["revenue_krw"]) / EOK, 1) for y in YEARS], "o": [round(float(d[y]["op_income_krw"]) / EOK, 1) for y in YEARS]})
    pby = {}
    for fn in ("overseas_financials_ext.csv", "jp_manual_financials.csv"):  # 두 번째는 사람이 입력한 본사 실적(2차 출처 포함, 확신도로 구분)
        pf = priv / "parents" / fn
        if pf.exists():
            for r in csv.DictReader(open(pf, encoding="utf-8-sig")):
                if r.get("year"): pby.setdefault(r["entity_id"], {}).setdefault(r.get("scope") or "연결", {})[int(r["year"])] = r
    for pn, x in sorted(par.items()):  # 한 업체에 완전한 기준(개별·연결)을 모두 싣는다: 화면에서 재무 기준을 고를 수 있게
        sc = pby.get("O:" + x, {})
        for pick in ("개별", "연결"):
            if not full(sc.get(pick, {})): continue
            d = sc[pick]; u = (d[YEARS[0]].get("source_url") or "").lower(); host = "SEC" if "sec.gov" in u else "EDINET" if "edinet" in u else "공시"
            second = (d[YEARS[0]].get("confidence") or "높음") != "높음"  # 확신도가 높음이 아니면 2차 출처로 표시(원문 대조 전)
            rows.append({"n": pn, "s": pick, "src": "2차 출처 · 원문 대조 전" if second else host + " 공시", "r": [round(float(d[y]["revenue_krw"]) / EOK, 1) for y in YEARS], "o": [round(float(d[y]["op_income_krw"]) / EOK, 1) for y in YEARS]})
        if not any(full(sc.get(k, {})) for k in ("개별", "연결")): skipped += 1
    # (3) 국내 상장 본사의 DART 개별(OFS)·연결(CFS) 3개년(종료연도): 명단의 본사 지정(p.d)에 연결. 접수번호 등 식별 정보는 싣지 않는다
    sf = priv / "dart_scopes.csv"; dn = {e["p"]["n"] for side, e in ents if e.get("p", {}).get("d")}
    if sf.exists() and dn:
        sby = {}
        for r in csv.DictReader(open(sf, encoding="utf-8-sig")):
            if r["company"] in dn and r["collection_status"] == "COLLECTED" and r["fiscal_year"]: sby.setdefault((r["company"], r["financial_basis"]), {})[int(r["fiscal_year"])] = r
        for (nm, basis), d in sorted(sby.items()):
            if full(d): rows.append({"n": nm, "s": "별도" if basis == "STANDALONE" else "연결", "src": "DART 사업보고서",
                                     "r": [round(float(d[y]["revenue_krw"]) / EOK, 1) for y in YEARS], "o": [round(float(d[y]["op_income_krw"]) / EOK, 1) for y in YEARS]})
    # (4) 덮어쓰기 행(scripts/growth/pair_overrides.json): 성장 분석 공개값이 외화(EUR) 보고서를 원으로 잘못 읽은 상태일 때, 재집계 전까지 이 화면에서만 올바른 값을 우선한다
    ovf = REPO / "scripts" / "growth" / "pair_overrides.json"
    if ovf.exists():
        for r in json.loads(ovf.read_text(encoding="utf-8")):
            rows = [x for x in rows if (x["n"], x["s"]) != (r["n"], r["s"])] + [r]
    out = {"version": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "unit": "억 원",
           "note": "성장 분석 집계에 없는 업체의 공시 수치: 국내업체는 DART 개별(별도) 재무, 글로벌 업체는 본사의 SEC·EDINET 공시(원화 환산).", "rows": rows}
    (REPO / "site" / "data" / "pair-extra.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"rows_in_file": len(rows), "skipped_incomplete_or_not_in_roster": skipped}, ensure_ascii=False))


if __name__ == "__main__": main()
