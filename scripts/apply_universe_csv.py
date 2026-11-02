"""최종 판정 CSV(scripts/data/semi_universe_final_*.csv)를 site/data/semi_caps.js 의 명단에 반영한다(시세·시가총액은 건드리지 않음).
- CORE_EXISTING(기존 123)·CORE_NEW(신규 37)만 핵심 모집단 rows 에 둔다. g: E=기존, N=신규. 신규의 시세는 비워 두고 update_semi_caps.py 가 채운다.
- HOLD_REVIEW·SEPARATE_OSAT·SEPARATE_DISTRIBUTION 은 managed 에만 두고 핵심 통계·표에서 제외한다.
- 신규 종목의 시장·분기 말 종가는 KRX_CACHE_DIR(listing_krx_YYYY-MM-DD.csv, 내부 보관본)에서 읽는다. 없으면 시장을 알 수 없어 중단한다.
사용: python scripts/apply_universe_csv.py <CSV> [KRX_CACHE_DIR]"""
import csv, json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; CAPS = ROOT / "site" / "data" / "semi_caps.js"
csv_path = Path(sys.argv[1]); kc = Path(sys.argv[2]) if len(sys.argv) > 2 else None
text = CAPS.read_text(encoding="utf-8"); m = re.search(r"window\.SEMI_CAPS\s*=\s*(\{.*\});", text, re.S); D = json.loads(m.group(1))
src = list(csv.DictReader(open(csv_path, encoding="utf-8-sig"))); assert len({r["stock_code"] for r in src}) == len(src)
rows = {r["c"]: r for r in D["rows"]}
MK = {"KOSPI": "KOSPI", "KOSDAQ": "KOSDAQ", "KOSDAQ GLOBAL": "KOSDAQ", "KONEX": "KONEX"}
def krx(day):
    f = kc / f"listing_krx_{day}.csv" if kc else None
    return {r["Code"]: r for r in csv.DictReader(open(f, encoding="utf-8-sig"))} if f and f.exists() else {}
cur = krx(D["prev"][0]); half = krx(D["prev"][1]); last = krx(D["asOf"]); managed = []; core = {}
for r in src:
    c, g = r["stock_code"], r["implementation_group"]
    extra = {"k2": r["secondary_attribute"].replace("보조분류 ", "") if r["secondary_attribute"].startswith("보조분류") else "", "x": r["secondary_attribute"] if r["secondary_attribute"] and not r["secondary_attribute"].startswith("보조분류") else "", "pa": r["process_area"]}
    if g == "CORE_EXISTING":
        row = rows[c]; assert row["k"] == r["primary_category"], (c, row["k"], r["primary_category"]); row["g"] = "E"
    elif g == "CORE_NEW":
        mk = MK.get((last.get(c) or cur.get(c) or {}).get("Market", "")); assert mk, f"시장 확인 불가 {c} {r['company_name']}"
        px = lambda d: (int(float(d[c]["Close"])) if c in d and d[c].get("Close") and float(d[c]["Close"]) else None)
        row = rows.get(c) or {"c": c, "n": r["company_name"], "m": mk, "k": r["primary_category"], "p": None, "s": None, "cap": None, "q1": px(cur), "q2": px(half)}; row["g"] = "N"; row["k"] = r["primary_category"]
    else:
        managed.append({"c": c, "n": r["company_name"], "g": {"HOLD_REVIEW": "H", "SEPARATE_OSAT": "O", "SEPARATE_DISTRIBUTION": "D"}[g], "k": r["primary_category"], "act": r["implementation_action"]}); continue
    for k, v in extra.items():
        if v: row[k] = v
    if r["implementation_action"] == "KEEP_BASELINE_REVIEW": row["rv"] = 1
    core[c] = row
assert set(rows) <= set(core), "기존 명단에 있으나 CSV 핵심에 없는 종목"
D["rows"] = sorted(core.values(), key=lambda x: -(x.get("cap") or 0)); D["managed"] = managed
D["universe"] = {"file": csv_path.name, "core": len(core), "existing": sum(1 for x in core.values() if x["g"] == "E"), "new": sum(1 for x in core.values() if x["g"] == "N"), "hold": sum(1 for x in managed if x["g"] == "H"), "osat": sum(1 for x in managed if x["g"] == "O"), "distribution": sum(1 for x in managed if x["g"] == "D")}
CAPS.write_text(text[:m.start(1)] + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + text[m.end(1):], encoding="utf-8")
print(D["universe"])
