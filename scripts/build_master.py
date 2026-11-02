"""공통 기업 마스터(site/data/master.js) 생성: 종목코드(6자리 문자열)를 기본 키로 핵심 모집단·별도 관리·DART 프로필 대상을 연결한다.
- 핵심(g=E/N)·별도 관리(g=H/O/D): site/data/semi_caps.js (scripts/apply_universe_csv.py 가 CSV에서 반영)
- DART 프로필·재무 화면 연결: site/data/companies.js 의 [이름, DART 고유번호, 종목코드] 중 종목코드가 정확히 같은 경우만 연결(이름 비슷하다고 합치지 않음)
- 모집단 정의: core(분류·시총 분석), fin134(재무 분석 명단 universe.js, 이름 기준·종목코드 없음), profile(DART 프로필 명단 companies.js)
서로 다른 모집단이므로 하나로 합치지 않고, 어떤 기업이 어디에 속하는지만 기록한다."""
import json, re
from pathlib import Path
D = Path(__file__).resolve().parent.parent / "site" / "data"
load = lambda p, v: json.loads(re.search(rf"window\.{v}\s*=\s*(\{{.*\}});", (D / p).read_text(encoding="utf-8"), re.S).group(1))
caps = load("semi_caps.js", "SEMI_CAPS")
comp = (D / "companies.js").read_text(encoding="utf-8")
prof = {code: (name, corp) for name, corp, code in re.findall(r'\[\s*"([^"]+)"\s*,\s*"(\d{8})"\s*,\s*"(\d{6})?"', comp) if code}
fin134 = len(re.findall(r'^\s*\[\s*"[^"]+"\s*,\s*"[^"]*"', (D / "universe.js").read_text(encoding="utf-8"), re.M))
rows = []
for r in caps["rows"]:
    p = prof.get(r["c"]); rows.append({"c": r["c"], "n": r["n"], "m": r["m"], "g": r.get("g", "E"), "k": r["k"], "corp": p[1] if p else ""})
for m in caps.get("managed", []):
    p = prof.get(m["c"]); rows.append({"c": m["c"], "n": m["n"], "m": "", "g": m["g"], "k": m["k"], "corp": p[1] if p else ""})
rows.sort(key=lambda r: (r["g"], r["c"]))  # 가격 순서에 따라 파일이 바뀌지 않게 고정 정렬
assert len({r["c"] for r in rows}) == len(rows), "종목코드 중복"
out = {"key": "종목코드(6자리 문자열)", "populations": {
    "core": {"label": "핵심 소부장 모집단(분류·시가총액 분석)", "n": sum(1 for r in rows if r["g"] in "EN")},
    "managed": {"label": "별도 관리(보류·OSAT·유통)", "n": sum(1 for r in rows if r["g"] in "HOD")},
    "fin134": {"label": "재무 분석 명단(universe.js, 이름 기준)", "n": fin134},
    "profile": {"label": "DART 프로필 명단(companies.js 중 종목코드가 있는 상장사)", "n": len(prof)}},
    "coreWithProfile": sum(1 for r in rows if r["g"] in "EN" and r["corp"]), "rows": rows}
(D / "master.js").write_text("// 자동 생성(scripts/build_master.py). 직접 수정하지 마세요. 모집단별 소속과 DART 연결 정보를 담은 기업 마스터입니다.\nwindow.SEMI_MASTER = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print({k: v["n"] for k, v in out["populations"].items()}, "핵심 중 프로필 연결", out["coreWithProfile"])
