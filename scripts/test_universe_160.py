"""핵심 모집단 반영 검증: CSV 189 / 핵심 160(소재 37·부품 47·장비 76) / 별도 관리 / 사용자 지정 분류 / 기존 시세 보존."""
import csv, json, re, subprocess, sys
from collections import Counter
CSV = "scripts/data/semi_universe_final_20261102.csv"
src = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
load = lambda t: json.loads(re.search(r"=\s*(\{.*\});", t, re.S).group(1))
caps = load(open("site/data/semi_caps.js", encoding="utf-8").read()); share = load(open("site/data/semi_share.js", encoding="utf-8").read())
try: old = load(subprocess.check_output(["git", "show", "HEAD:site/data/semi_caps.js"], text=True, stderr=subprocess.DEVNULL))
except Exception: old = None
ok = True
def chk(name, cond, info=""):
    global ok; ok &= bool(cond); print(("PASS" if cond else "FAIL"), name, info)
chk("CSV 189 고유", len(src) == 189 == len({r["stock_code"] for r in src}))
chk("그룹 123/37/22/4/3", Counter(r["implementation_group"] for r in src) == {"CORE_EXISTING": 123, "CORE_NEW": 37, "HOLD_REVIEW": 22, "SEPARATE_OSAT": 4, "SEPARATE_DISTRIBUTION": 3})
rows = caps["rows"]; byc = {r["c"]: r for r in rows}; ex = {r["c"]: r for r in rows if r.get("g") == "E"}; nw = {r["c"]: r for r in rows if r.get("g") == "N"}
chk("핵심 160(기존 123 + 신규 37)", len(rows) == 160 == len(byc) and len(ex) == 123 and len(nw) == 37)
chk("소재37/부품47/장비76", Counter(r["k"] for r in rows) == {"소재": 37, "부품": 47, "장비": 76}, dict(Counter(r["k"] for r in rows)))
chk("핵심 코드 = CSV 핵심", set(byc) == {r["stock_code"] for r in src if r["implementation_group"].startswith("CORE")})
mg = Counter(m["g"] for m in caps["managed"]); chk("별도 관리 H22/O4/D3, rows와 겹침 없음", mg == {"H": 22, "O": 4, "D": 3} and not ({m["c"] for m in caps["managed"]} & set(byc)), dict(mg))
cls = {r["stock_code"]: r["primary_category"] for r in src}
chk("분류 = CSV 전수 일치", all(byc[c]["k"] == cls[c] for c in byc))
chk("사용자 지정 유지(이수페타시스 소재·뉴파워 장비·씨엠티엑스 소재·에프에스티 소재/보조 장비·케이씨텍 장비/보조 소재)", byc["007660"]["k"] == "소재" and byc["144960"]["k"] == "장비" and byc["388210"]["k"] == "소재" and byc["036810"]["k"] == "소재" and byc["036810"].get("k2") == "장비" and byc["281820"]["k"] == "장비" and byc["281820"].get("k2") == "소재")
chk("인프라 4곳 장비+보조속성", all(byc[c]["k"] == "장비" and "인프라" in byc[c].get("x", "") for c in ("045100", "011930", "053080", "037350")))
chk("더코디 핵심 미편입·위지트 기존 유지(재검토 표시)", "224060" not in byc and byc["036090"].get("rv") == 1 and byc["036090"]["g"] == "E")
if old: chk("기존 123 구성(종목코드·기업명·시장·분류) 불변 — 가격은 매일 바뀌므로 제외", all(all(byc[r["c"]].get(k) == r.get(k) for k in ("n", "m", "k")) for r in old["rows"] if r.get("g") == "E" and r["c"] in byc) and sum(1 for r in old["rows"] if r.get("g") == "E") in (0, 123))
G = share["groups"]; chk("집계 종목 수 160 / 소재37 부품47 장비76", (G["전체"]["n"], G["소재"]["n"], G["부품"]["n"], G["장비"]["n"]) == (160, 37, 47, 76))
chk("시총 확인 종목 수 별도(nCap ≤ n, 실제 값과 일치)", all(G[k]["nCap"] == sum(1 for r in rows if r["cap"] and (k == "전체" or r["k"] == k)) for k in G) and G["전체"]["nCap"] < G["전체"]["n"], f'nCap={G["전체"]["nCap"]}')
chk("신규 중 시총 없는 종목은 null(임의 수치 없음)", all(r["cap"] is None or r["p"] for r in nw.values()))
chk("기존 123 기준 집계 보존(legacy123)", share["legacy123"]["전체"]["n"] == 123)
# --- 시장·집계 정합성(가격은 매일 바뀌므로 값 자체가 아니라 관계만 확인) ---
byk = Counter(r["m"] for r in rows)
chk("시장별 종목 수 합 = 160, konexN은 명단에서 센 값", sum(byk.values()) == 160 and share.get("konexN") == byk.get("KONEX", 0), dict(byk))
cn = share.get("counts") or {}
chk("종목 수·시총 확보 수·미확보 수 일치", cn.get("population") == 160 and cn.get("withCap", 0) + cn.get("noCap", 0) == 160 and cn.get("withCap") == sum(1 for r in rows if r["cap"]), cn)
chk("결측은 0이 아니라 null", all(r["cap"] is None or r["cap"] > 0 for r in rows) and all(r["p"] is None or r["p"] > 0 for r in rows))
chk("업종별 시총 합 = 전체(±종목수 반올림)", abs(sum(G[k]["cap"] for k in ("소재", "부품", "장비")) - G["전체"]["cap"]) <= 3)
for m in ("KOSPI", "KOSDAQ"):
    X = share["markets"][m]; chk(f"{m} 상자: 종목 수·시총 합이 업종 합과 일치", X["n"] == byk[m] and X["n"] == sum(X["kinds"][k]["n"] for k in ("소재", "부품", "장비")) and X["cap"] == sum(X["kinds"][k]["cap"] for k in ("소재", "부품", "장비")))
D = share.get("denominator") or {}
chk("비중 분모가 안내와 일치(shareKK=코스피·코스닥)", D.get("shareKK") == "코스피·코스닥 전체" and all("shareKK" in g for g in G.values()))
tot = share["marketTotal"]; capKK = sum(r["cap"] for r in rows if r["cap"] and r["m"] in ("KOSPI", "KOSDAQ"))
chk("shareKK 산식 검산", abs(G["전체"]["shareKK"] - capKK / (tot["KOSPI"] + tot["KOSDAQ"])) < 2e-6)
mst = load(open("site/data/master.js", encoding="utf-8").read()); P = mst["populations"]
chk("마스터: 핵심 160·별도 29, 종목코드 고유", P["core"]["n"] == 160 and P["managed"]["n"] == 29 and len({r["c"] for r in mst["rows"]}) == 189)
chk("마스터: 재무 분석 명단(134)은 160과 합치지 않고 별도 기록", P["fin134"]["n"] == 134 != P["core"]["n"])
sys.exit(0 if ok else 1)
