"""국내 협력사의 DART 법인 연결과 2022~2025 개별(별도, OFS) 매출액·영업이익 수집. 결과는 비공개 폴더에만 쓴다.
사용: DART_API_KEY=... GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/collect_domestic.py
- 법인 연결: 법인등록번호(jurir_no)가 정확히 같을 때만 확정. 이름만 비슷하면 연결하지 않고 REVIEW 로 남긴다.
- 재무: 개별(별도) 재무제표만 쓴다. 별도가 없으면 연결로 대체하지 않고 NOT_AVAILABLE. 값이 없으면 0이 아니라 빈 값.
- 사업보고서 1건(당기·전기·전전기)으로 3개 연도를 얻으므로 2025년·2023년 보고서 두 건으로 2022~2025를 채운다."""
import csv, io, json, os, re, sys, time, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0, os.environ.get("BCP_DIR") or str(Path(__file__).resolve().parent.parent))
import build_company_profiles as bcp  # noqa: E402
REPO = Path(__file__).resolve().parent.parent.parent
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); KEY = os.environ.get("DART_API_KEY", "")
if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("DART_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
if REPO in OUT.parents and os.environ.get("GROWTH_PRIVATE_REPO") != "1": sys.exit("비공개 폴더가 저장소 안에 있습니다(비공개 저장소에서만 GROWTH_PRIVATE_REPO=1 허용)")
norm = lambda s: re.sub(r"[^0-9a-z가-힣]+", "", re.sub(r"\(주\)|주식회사|㈜|유한회사|\s", "", (s or "").lower()))
def corp_list():
    p = OUT / "corpCode.json"
    if p.exists(): return json.loads(p.read_text(encoding="utf-8"))
    r = bcp._get("https://opendart.fss.or.kr/api/corpCode.xml", {"crtfc_key": KEY}, timeout=(10, 60))
    z = zipfile.ZipFile(io.BytesIO(r.content)); root = ET.fromstring(z.read(z.namelist()[0]))
    L = [{"c": e.findtext("corp_code"), "n": (e.findtext("corp_name") or "").strip(), "s": (e.findtext("stock_code") or "").strip()} for e in root.iter("list")]
    p.write_text(json.dumps(L, ensure_ascii=False), encoding="utf-8"); return L
CACHE_P = OUT / "dart_cache.json"
CACHE = json.loads(CACHE_P.read_text(encoding="utf-8")) if CACHE_P.exists() else {}
def cached(key, fn):
    if key not in CACHE:
        CACHE[key] = fn(); CACHE_P.write_text(json.dumps(CACHE, ensure_ascii=False), encoding="utf-8")
    return CACHE[key]
def write_out(match, fin):
    for name, data in (("domestic_match.csv", match), ("domestic_financials.csv", fin)):
        if not data: continue
        with open(OUT / name, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
def main():
    rows = [r for r in csv.DictReader(open(OUT / "master_rows.csv", encoding="utf-8-sig")) if r["region"] == "국내"]
    byname = {}
    for c in corp_list(): byname.setdefault(norm(c["n"]), []).append(c)
    ents = {}  # 법인등록번호 → 행들(지점·사업부는 같은 법인)
    for r in rows: ents.setdefault(r["corp_no"] or f"NOID-{r['row_id']}", []).append(r)
    match, fin = [], []
    for k, rs in ents.items():
        names = {r["name_local"] for r in rs}; cand = []
        for n in names:
            n2 = re.sub(r"(천안|울산|안성|황상|여수|오송|공장|지점|사업부|세라믹스사업부).*$", "", n); cand += byname.get(norm(n), []) + byname.get(norm(n2), [])
        cand = list({c["c"]: c for c in cand}.values())[:8]; hit = None; basis = "NOT_FOUND"
        for c in cand:
            info = cached("co:" + c["c"], lambda: bcp.call(KEY, "company", corp_code=c["c"]) or {})
            if k.startswith("NOID"): continue
            if (info.get("jurir_no") or "").replace("-", "") == k: hit, basis = (c, info), "법인등록번호 일치"; break
        if not hit and cand: basis = "REVIEW(이름 후보만, 법인등록번호 불일치·미확인)"
        match.append({"corp_no": k, "rows": ";".join(r["row_id"] for r in rs), "dart_corp_code": hit[0]["c"] if hit else "", "stock_code": hit[0]["s"] if hit else "", "dart_name": hit[0]["n"] if hit else "", "basis": basis, "n_candidates": len(cand)})
        if len(match) % 10 == 0: write_out(match, fin)
        if not hit: continue
        cc = hit[0]["c"]; got = {}
        for rep_year in (2025, 2023):  # 당기·전기·전전기: 2025→2025·2024·2023, 2023→2023·2022·2021
            ab = cached(f"st:{cc}:{rep_year}", lambda: {str(y): v for y, v in bcp.annual_by_year(bcp.statement_rows(KEY, cc, rep_year, bcp.ANNUAL), rep_year).items()})
            for y, v in ab.items(): got.setdefault(int(y), v)
        for y in (2022, 2023, 2024, 2025):
            v = got.get(y, {}); fin.append({"corp_code": cc, "corp_no": k, "year": y, "revenue_krw": v.get("매출액", ""), "op_income_krw": v.get("영업이익", ""), "basis": "개별(OFS)" if v else "NOT_AVAILABLE", "currency": "KRW"})
    write_out(match, fin)
    ok = [m for m in match if m["dart_corp_code"]]
    print(json.dumps({"entities": len(match), "matched_exact_corp_no": len(ok), "review": sum(1 for m in match if m["basis"].startswith("REVIEW")), "not_found": sum(1 for m in match if m["basis"] == "NOT_FOUND"), "listed_by_dart": sum(1 for m in ok if m["stock_code"]),
                      "fin_ok_2025": len({f["corp_code"] for f in fin if f["year"] == 2025 and f["revenue_krw"] != ""}), "fin_all_3y_2023_2025": sum(1 for cc in {f["corp_code"] for f in fin} if all(any(f["corp_code"] == cc and f["year"] == y and f["revenue_krw"] != "" and f["op_income_krw"] != "" for f in fin) for y in (2023, 2024, 2025)))}, ensure_ascii=False))
main()
