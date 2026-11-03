"""비공개 작업 폴더의 법인·재무 자료로 공개용 집계 요약(site/data/growth-comparison-summary.json)을 만든다.
공개 파일에는 집계값·건수·필터 조합만 담는다: 기업명·등록번호·개별 재무·품목 매핑·원본 행은 넣지 않는다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/build_growth_comparison.py [--k 5]
입력(비공개 폴더): master_rows.csv, domestic_match.csv, domestic_financials.csv, [overseas_financials.csv], [eligibility_overrides.csv: entity_id, eligible, rep_chart, 판정 근거]
적격성: 국내는 사용자 목록 전체를 대상으로 하고, 검증된 모집단(scripts/data/semi_universe_final_*.csv)에서 별도 관리(제외·OSAT·유통)로 확정된 법인만 EXCLUDED.
확정되지 않은 기업(REVIEW)은 기본 집계에서 빠진다. 해외는 개별 법인 실적이 확인된 자료(overseas_financials.csv)가 있어야 들어온다."""
import csv, datetime as dt, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import aggregate as A
from common import name_key
REPO = Path(__file__).resolve().parent.parent.parent
YEARS = A.YEARS
EOK = 1e8


META = {}  # 빌드 중 모은 건수(공개 JSON 메타데이터용, 법인 정보 없음)
ALIAS_ID = {"O:veecoinstruments": "O:veeco", "O:besemiconductorindustries": "O:besemiconductor"}  # 같은 법인의 표기 차이(수집기 키 ↔ 조사 CSV 목록표기)를 한 법인으로 합친다


def rd(p):
    return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if Path(p).exists() else []


def num(x):
    try: return float(x) if x not in (None, "") else None
    except ValueError: return None


_PLANT = re.compile(r"(\s+\S*(공장|사업장|지점|제련소)|\s+\S*사업부.*)$")
NAME_ALIAS = {"두산전자사업김천공장": "두산"}  # 지점·사업부 이름 → 법인 대표 이름(수동 확정, 보고서에 명시)


def plant_key(name):
    """원본의 지점·공장·사업부 표기를 떼고 정규화한 이름 열쇠. 같은 법인의 다른 표기를 이름으로 잇는 데만 쓴다(DART 고유번호·법인등록번호로 못 이은 경우의 보조)."""
    full = name_key(name)
    if full in NAME_ALIAS: return NAME_ALIAS[full]
    return name_key(_PLANT.sub("", (name or "").strip()))


def load_roster(priv):
    """소부장 경영 정보(대시보드)와 같은 기업군: 재무 분석 명단(build_financials.py 결과)에서 대시보드 제외 업종(수요·IT·서비스)을 뺀 법인.
    값 단위는 억 원. 업종(소재·부품·장비·미분류)은 대시보드와 같은 classifyCompany 결과(roster_class.json)."""
    f, c = Path(priv) / "roster_financials.js", Path(priv) / "roster_class.json"
    if not (f.exists() and c.exists()): return None
    t = f.read_text(encoding="utf-8"); a = t.index("window.COMPANY_FINANCIALS = ") + len("window.COMPANY_FINANCIALS = ")
    recs = json.loads(t[a:t.index(";\nwindow.COMPANY_FINANCIALS_META")]); kind = {x["c"]: x for x in json.loads(c.read_text(encoding="utf-8"))}
    return [(r, kind[r["c"]]["kind"]) for r in recs if kind.get(r["c"], {}).get("kind") not in ("수요", "IT·서비스")]


def build_entities(priv, csv_universe):
    rows = rd(priv / "master_rows.csv"); match = {m["corp_no"]: m for m in rd(priv / "domestic_match.csv")}
    fin = defaultdict(dict)
    for f in rd(priv / "domestic_financials.csv"):
        fin[f["corp_no"]][int(f["year"])] = {"rev": num(f["revenue_krw"]), "op": num(f["op_income_krw"])}
    # 해외 법인 재무: 법인별로 기준(개별/연결)마다 따로 모은 뒤 한 기준만 고른다(3개년 기준 통일).
    # 개별 우선: 개별로 2023~2025 매출·영업이익이 모두 있으면 개별, 아니면 연결로 3개년이 모두 있을 때 연결, 둘 다 불완전하면 연도가 더 많은 쪽.
    by_scope = defaultdict(lambda: defaultdict(dict)); scopes = {}
    for fname in ("overseas_financials.csv", "overseas_financials_ext.csv"):  # SEC 수집분 + 조사 CSV(ingest_overseas_csv.py)분. 법인 본인 실적이 공식 자료로 확인된 법인만(원화 환산 완료)
        for f in rd(priv / fname):
            eid_ = ALIAS_ID.get(f["entity_id"], f["entity_id"]); v_ = {"rev": num(f["revenue_krw"]), "op": num(f["op_income_krw"])}
            if v_["rev"] is None and v_["op"] is None: continue
            sc_ = "연결" if "연결" in (f.get("scope") or f.get("basis") or "") else "개별"
            by_scope[eid_][sc_][int(f["year"])] = v_
    for eid_, d in by_scope.items():
        full = lambda sc: all(d.get(sc, {}).get(y, {}).get("rev") is not None and d.get(sc, {}).get(y, {}).get("op") is not None for y in YEARS)
        pick = "개별" if full("개별") else "연결" if full("연결") else max(d, key=lambda sc: len(d[sc]))
        fin[eid_] = dict(d[pick]); scopes[eid_] = {pick}
    ovm = {m["corp_no"]: m for m in rd(priv / "ovkr_match.csv")}; ovf = defaultdict(dict)
    for fname in ("ovkr_financials.csv", "ovkr_audit_financials.csv"):  # 사업보고서 XBRL(collect_domestic.py) + 감사·사업보고서(collect_audit.py)
        for f_ in rd(priv / fname):
            v = {"rev": num(f_["revenue_krw"]), "op": num(f_["op_income_krw"])}; y_ = int(f_["year"])
            if v["rev"] is not None or v["op"] is not None: ovf[f_["corp_no"]].setdefault(y_, v)
    univ = {r["stock_code"]: r for r in csv_universe}; ov_rows = {r["entity_id"]: r for r in rd(priv / "eligibility_overrides.csv")}; over = {k: v["eligible"] for k, v in ov_rows.items()}
    groups = defaultdict(list)
    for r in rows:
        if r["region"] == "국내": key = "D:" + (r["corp_no"] or "NOID-" + r["row_id"])
        elif re.fullmatch(r"\d{13}", r["corp_no"] or ""): key = "F:" + r["corp_no"]  # 한국에 설립된 외국계 법인(원본 '해외' 표기) — 법인등록번호로 같은 법인(지점·공장 행)을 묶는다
        else: key = "O:" + (r["name_key"] or "NOKEY-" + r["row_id"])
        groups[key].append(r)
    ents = []
    roster = load_roster(priv); det_over = {x["name"]: x for x in rd(priv / "roster_detail_overrides.csv")}
    if roster is not None:  # 국내 = 대시보드와 같은 기업군(DART 고유번호 기준). 상세구분1~5는 사용자 목록과 법인등록번호로 연결된 경우에만 붙인다.
        cc2no = {m["dart_corp_code"]: k for k, m in match.items() if m.get("dart_corp_code")}
        # 보조 연결: 법인등록번호·DART 고유번호로 못 이은 원본 법인은 이름(지점·사업부 표기 제거)이 같은 대시보드 법인에 잇는다. 동명이 둘 이상이면 잇지 않는다.
        used = set(cc2no.values()); pool = {}
        for k, m in match.items():
            if not m.get("dart_corp_code") and ("D:" + k) in groups:
                for x in groups["D:" + k]: pool.setdefault(plant_key(x["name_local"]), set()).add(k)
        link_by_name = 0
        for r, kind in roster:
            if r["c"] in cc2no: continue
            ks = pool.get(plant_key(r["n"]), set()) - used
            if len(ks) == 1: k = next(iter(ks)); cc2no[r["c"]] = k; used.add(k); link_by_name += 1
        print(f"상세 연결: 번호 일치 {len(roster) - link_by_name - sum(1 for r, _ in roster if r['c'] not in cc2no)}곳 + 이름 보조 {link_by_name}곳, 미연결 {sum(1 for r, _ in roster if r['c'] not in cc2no)}곳", file=sys.stderr)
        for r, kind in roster:
            f = {int(y): {"rev": (None if r["s"][i] is None else r["s"][i] * EOK), "op": (None if r["o"][i] is None else r["o"][i] * EOK)} for i, y in enumerate(r["y"])}
            rs = groups.get("D:" + cc2no.get(r["c"], ""), [])
            ov_d = det_over.get(r["n"])  # 원본 목록에 행이 없는 법인: 승인된 상세구분 보충(비공개 파일)
            mem = [{"chart": kind, **{k: (x[k] or None) for k in A.DEPTH_KEYS}} for x in rs] or [{"chart": kind, **{k: ((ov_d or {}).get(k) or None) for k in A.DEPTH_KEYS}}]
            mem = [dict(m_, chart=kind) for m_ in mem]
            ents.append({"id": "D:" + r["c"], "region": "국내", "eligible": "ELIGIBLE", "fin": f, "memberships": mem})
        groups = {k: v for k, v in groups.items() if not k.startswith("D:")}
    dom_codes = {r["c"] for r, _ in roster} if roster is not None else {m["dart_corp_code"] for m in match.values() if m.get("dart_corp_code")}
    for key, rs in groups.items():
        region = rs[0]["region"]; eid = key
        if key.startswith("F:"):  # 국내 소재 외국계: 해외 집계와 합산하지 않고 따로 집계. 이미 국내 기업군에 있는 법인(상장사 등)은 중복이므로 뺀다.
            m = ovm.get(key[2:], {})
            if m.get("dart_corp_code") in dom_codes: continue
            f = {y: v for y, v in ovf.get(key[2:], {}).items() if v.get("rev") is not None or v.get("op") is not None}
            mem = [{"chart": r["chart_category"], **{k: (r[k] or None) for k in A.DEPTH_KEYS}} for r in rs]
            ents.append({"id": eid, "region": "외국계", "eligible": over.get(eid, "ELIGIBLE"), "fin": f, "memberships": mem, "_nk": rs[0]["name_key"]}); continue
        if region == "국내":
            m = match.get(key[2:], {}); u = univ.get(m.get("stock_code", ""))
            st = "ELIGIBLE"  # 사용자 목록의 국내 법인은 모두 대상. 검증된 160 모집단에서 '별도 관리(제외·OSAT·유통)'로 확정된 법인만 뺀다.
            if u and u["implementation_group"].startswith("SEPARATE"): st = "EXCLUDED"
            f = {y: v for y, v in fin.get(key[2:], {}).items() if v.get("rev") is not None or v.get("op") is not None}
        else:  # 해외: SEC 등록 법인 본인(이름 정확 일치)의 연결 실적이 확인된 법인만 대상. 나머지는 실적 미확인(REVIEW)
            f = {y: v for y, v in fin.get(key, {}).items() if v.get("rev") is not None or v.get("op") is not None}; st = "ELIGIBLE" if f else "REVIEW"  # 사용자 결정: 제공 목록의 기업은 적격(비반도체로 제외하기로 한 법인은 eligibility_overrides.csv 의 EXCLUDED). 재무가 확인된 법인만 집계에 들어온다
        st = over.get(eid, st)
        mem = [{"chart": r["chart_category"], **{k: (r[k] or None) for k in A.DEPTH_KEYS}} for r in rs]
        rep = (ov_rows.get(eid) or {}).get("rep_chart")
        if rep: mem = [{"chart": rep, **{k: None for k in A.DEPTH_KEYS}}]  # 기업 전체 매출은 대표 업종 한 곳에만 반영(원본 품목 분류로 중복 배분하지 않음)
        ents.append({"id": eid, "region": region, "eligible": st, "fin": f, "memberships": mem})
    # 사용자가 추가한 소부장 후보(원본 목록에 없던 해외 기업): 적격으로 보고 대표 업종 지정. 실적이 확인된 경우에만 집계에 들어온다.
    have = {e["id"] for e in ents}
    for x in rd(priv / "extra_candidates.csv"):
        eid = ALIAS_ID.get("O:" + x["entity_key"], "O:" + x["entity_key"])
        if eid in have: continue
        f = {y: v for y, v in fin.get(eid, {}).items() if v.get("rev") is not None or v.get("op") is not None}
        ents.append({"id": eid, "region": "해외", "eligible": over.get(eid, "ELIGIBLE"), "fin": f, "memberships": [{"chart": x["rep_chart"], **{k: None for k in A.DEPTH_KEYS}}]})
    # 해외계 통합(사용자 결정): 한국에 설립된 외국계 법인을 해외 상장 본사와 한 집단으로 합친다.
    # 이중 집계 방지: 본사 실적이 연결 기준이고(자회사 포함) 본사가 3개년 균형 패널에 들어 있으며 본사-자회사 관계가 확인된 경우에만 한국 자회사를 뺀다.
    # 본사가 개별 기준이면 자회사는 본사 실적에 들어 있지 않으므로 빼지 않는다. 관계는 이름 접두 일치를 후보로만 쓰고 dedupe_overrides.csv(검토 결과)로 확정·부정한다.
    def usable_e(e): return A.usable(e)
    parents = {e["id"][2:]: e for e in ents if e["region"] == "해외" and e["eligible"] == "ELIGIBLE" and e["id"].startswith("O:")}
    dov = {(x["sub_key"], x["parent_key"]): x["decision"] for x in rd(priv / "dedupe_overrides.csv")}
    keep, log, dropped = [], [], 0
    for e in ents:
        if e["region"] == "외국계":
            nk = e.pop("_nk", ""); cands = [pk for pk in parents if len(pk) >= 4 and nk != pk and nk.startswith(pk)]
            drop = False
            for pk in cands:
                par = parents[pk]; sc = scopes.get("O:" + pk, set()); why = []
                rel = dov.get((nk, pk), "candidate")
                if rel == "unrelated": why.append("검토 결과 본사-자회사 관계 아님")
                if not usable_e(par): why.append("본사가 3개년 균형 패널에 없음")
                if sc != {"연결"}: why.append("본사 재무가 연결 기준이 아님(" + ("/".join(sorted(sc)) or "없음") + ")")
                dec = "drop" if not why else "keep"
                log.append({"sub_key": nk, "parent_key": pk, "relation": rel, "parent_scope": "/".join(sorted(sc)), "parent_balanced": usable_e(par), "decision": dec, "reason": "; ".join(why) or "연결 본사에 이미 포함(이중 집계 방지)"})
                if dec == "drop": drop = True; break
            if drop: dropped += 1; continue
            e["region"] = "해외"; e["_kr"] = True
        keep.append(e)
    if log:
        with open(priv / "dedupe_log.csv", "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(log[0])); w.writeheader(); w.writerows(log)
    META.update({"excluded_kr_subs": dropped, "kept_with_parent_candidate": sum(1 for x in log if x["decision"] == "keep")})
    print(f"해외계 통합: 이중 집계 방지로 제외한 한국 자회사 {dropped}곳(로그 dedupe_log.csv)", file=sys.stderr)
    return keep


def fmt(side):
    if not side.get("n"): return {"n": 0}
    r = lambda v, d: None if v is None else round(v, d)
    return {"n": side["n"], "rev": [r(side["rev"][y] / EOK, 1) for y in YEARS], "op": [r(side["op"][y] / EOK, 1) for y in YEARS], "margin": [r(side["margin"][y], 2) for y in YEARS],
            "growth": {str(y): r(side["growth"].get(y), 2) for y in (2023, 2024, 2025)}, "avg_rev": [r(side["avg_rev"][y] / EOK, 1) for y in YEARS]}


def concentration(es):
    """한 법인이 합계를 좌우하는 연도(법인 이름·금액 없이 연도만). 매출 또는 영업이익 절댓값 합의 50% 이상을 한 법인이 차지하면 표시."""
    out = {"rev_single_driver_years": [], "op_single_driver_years": []}
    for y in YEARS:
        for key, fld in (("rev_single_driver_years", "rev"), ("op_single_driver_years", "op")):
            vals = [abs(e["fin"][y][fld]) for e in es]; tot = sum(vals)
            if tot and max(vals) / tot >= 0.5: out[key].append(y)
    return out


def build(ents, k=5, generated=None):
    by = {e["id"]: e for e in ents}; ok = A.publishable(ents, k); out = {}
    for (chart, path), sides in ok.items():
        sub = [by[i] for reg in sides for i in sides[reg]]
        res = A.compare(sub); cell = {}
        for reg, name in (("국내", "dom"), ("해외", "ov")):
            if reg in sides:
                cell[name] = fmt(res[name]); cell[name]["flags"] = concentration([by[i] for i in sides[reg]])
        if "dom" in cell and "ov" in cell: cell["gap_pp"] = [None if res["margin_gap_pp"][y] is None else round(res["margin_gap_pp"][y], 2) for y in YEARS]
        out[json.dumps([chart, list(path)], ensure_ascii=False, separators=(",", ":"))] = cell
    mix = {}
    for name in ("dom", "ov"):
        tot = out.get(json.dumps([None, []], separators=(",", ":")), {}).get(name)
        for chart in ("소재", "부품", "장비"):
            cc = out.get(json.dumps([chart, []], ensure_ascii=False, separators=(",", ":")), {}).get(name)
            if tot and cc: mix.setdefault(name, {})[chart] = {"rev_share_2025": round(cc["rev"][2] / tot["rev"][2] * 100, 1), "op_share_2025": round(cc["op"][2] / tot["op"][2] * 100, 1) if tot["op"][2] else None}
    miss = {}
    for chart in (None, "소재", "부품", "장비"):
        for reg, name in (("국내", "dom"), ("해외", "ov")):
            es = [e for e in ents if e["region"] == reg and A.usable(e) and (chart is None or any(m["chart"] == chart for m in e["memberships"]))]
            n = sum(1 for e in es if not any(m["d1"] for m in e["memberships"] if chart is None or m["chart"] == chart))
            miss.setdefault(chart or "전체", {})[name] = {"panel": len(es), "no_detail": n}
    kr = [e for e in ents if e.get("_kr")]
    comp = {"listed_or_direct": sum(1 for e in ents if e["region"] == "해외" and not e.get("_kr") and A.usable(e)), "kr_incorporated_affiliates": sum(1 for e in kr if A.usable(e)),
            "kr_affiliates_in_scope": len(kr), "kr_affiliates_excluded_double_count": META.get("excluded_kr_subs", 0), "kr_affiliates_kept_despite_parent_candidate": META.get("kept_with_parent_candidate", 0)}
    c = Counter((e["region"], e["eligible"]) for e in ents)
    usable = lambda reg: sum(1 for e in ents if e["region"] == reg and A.usable(e))
    cov = {"entities": {r: sum(1 for e in ents if e["region"] == r) for r in ("국내", "해외", "외국계")},
           "eligibility": {r: {s: c.get((r, s), 0) for s in ("ELIGIBLE", "REVIEW", "EXCLUDED")} for r in ("국내", "해외", "외국계")},
           "with_3y_financials": {r: sum(1 for e in ents if e["region"] == r and all(e["fin"].get(y, {}).get("rev") is not None and e["fin"].get(y, {}).get("op") is not None for y in YEARS)) for r in ("국내", "해외", "외국계")},
           "balanced_panel": {r: usable(r) for r in ("국내", "해외", "외국계")}}
    return {"version": 1, "generatedAt": generated or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "years": list(YEARS), "unit": "억 원", "k_min_per_side": k,
            "basis": {"population": "국내는 소부장 경영 정보와 같은 기업군(수요기업·IT·서비스 제외, 업종도 그 화면과 같은 기준). 해외계는 사용자 목록·추가 후보 중 법인 본인의 공식 공시로 실적이 확인된 상장 본사(비반도체 제외)와 한국에 설립된 외국계 법인을 합친 집단. 본사가 연결 기준으로 집계에 있고 관계가 확인된 한국 자회사만 이중 집계 방지로 제외", "revenue": "기업 전체 매출액(반도체 사업 매출이 아님)", "scope": "국내와 한국에 설립된 외국계는 개별(별도) 재무, 해외 상장 본사는 개별 우선·미공시 시 연결(법인별 3개년 기준 통일). 자회사 실적을 모회사 실적으로 대체하지 않음", "panel": "2023·2024·2025년 매출·영업이익이 모두 확인된 적격 법인(동일 기업군)",
                      "margin": "영업이익 합계 ÷ 매출 합계", "growth": "전년 대비, 2023년은 2022년 매출이 전원 확인될 때만", "fx": "해외 원화 환산: 보고 통화별 ECB 일별 교차환율의 해당 회계기간 평균. 회계연도는 회계기간 종료일의 연도(3월 결산 법인은 해당 3월 종료 기간)", "nonexclusive": "한 기업이 여러 분류에 속할 수 있어 분류별 합계가 전체와 다를 수 있음"},
            "coverage": {**cov, "composition": comp, "detail_missing": miss}, "mix": mix, "cells": out,
            "groups": [{"key": "dom", "label": "국내"}, {"key": "ov", "label": "해외계"}],
            "notes_list": ["국내 기업: 별도(개별)재무 기준(DART 사업보고서, 감사보고서)", "한국에 설립된 외국계 법인: 별도(개별)재무 기준(사업보고서·감사보고서, 억 원 단위 반올림)",
                           "해외 상장 본사: 개별재무 우선, 개별이 공시되지 않으면 연결재무(미국 SEC 등록 법인 등). 법인별 3개년은 같은 기준으로 통일",
                           "매출·영업이익은 기업 전체 실적이며 반도체 사업만의 실적이 아님", "해외계는 공식 공시로 확인된 표본이며 해외 반도체 소부장 산업 전체를 대표하지 않음",
                           "회계연도(회계기간 종료일 기준)·환율·재무 범위 차이로 직접 비교에 한계가 있음. 산출 방법은 방법론 문서 참고"]}


def consolidated_variant(ents, priv):
    """국내 기업군의 재무를 연결(CFS) 기준으로 바꾼 사본(해외는 그대로). 연결이 없는 회사는 개별을 그대로 쓴다(수집 단계에서 표시). 연결 파일이 없으면 None."""
    rows = rd(Path(priv) / "roster_cfs.csv")
    if not rows: return None
    cfs = defaultdict(dict)
    for r in rows: cfs[r["corp_code"]][int(r["year"])] = {"rev": num(r["revenue_krw"]), "op": num(r["op_income_krw"])}
    out = []
    for e in ents:
        if e["region"] == "국내" and e["id"].startswith("D:") and e["id"][2:] in cfs:
            f = {y: v for y, v in cfs[e["id"][2:]].items() if v.get("rev") is not None or v.get("op") is not None}
            e = dict(e, fin=f)
        out.append(e)
    return out


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR"); k = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 5
    if not priv: sys.exit("GROWTH_PRIVATE_DIR 가 필요합니다")
    univ = rd(next(iter(sorted((REPO / "scripts" / "data").glob("semi_universe_final_*.csv")))))
    ents = build_entities(Path(priv), univ); summary = build(ents, k)
    cons = consolidated_variant(ents, priv)
    if cons is not None:  # 국내 연결 기준 병행(국내 기준 선택: 개별/연결). 해외 값은 같다.
        c = build(cons, k); summary["cells_cons"] = c["cells"]; summary["coverage_cons"] = c["coverage"]
        summary["basis"]["scope_cons"] = "국내 연결 기준: DART 사업보고서 연결재무제표(CFS). 연결재무제표가 없는 회사(종속회사 없음·감사보고서만 제출)는 개별 재무를 그대로 사용"
    p = REPO / "site" / "data" / "growth-comparison-summary.json"; p.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"entities": summary["coverage"]["entities"], "eligibility": summary["coverage"]["eligibility"], "with_3y": summary["coverage"]["with_3y_financials"], "balanced_panel": summary["coverage"]["balanced_panel"], "published_cells": len(summary["cells"])}, ensure_ascii=False))
if __name__ == "__main__": main()
