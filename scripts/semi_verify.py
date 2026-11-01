"""후보 기업의 최신 사업보고서 '사업의 내용'을 읽어 반도체 소부장 관련성을 점검한다.
입력: scripts/semi_universe_candidates.csv (A·B등급 신규 + 기존 비소부장), scripts/partner_groups.tsv (협력사 90곳 이름)
출력: semi_verify.csv (회사·종목코드·등급·반도체 언급 수·키워드 점수·제안·사업 요약), 로그 [verify] 줄"""
import csv, io, json, os, re, sys, time, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

KEY = os.environ.get("DART_API_KEY", "")
ROOT = Path(__file__).resolve().parent.parent
if not KEY: sys.exit("DART_API_KEY 가 없습니다")
S = requests.Session()
CACHE = ROOT / "semi_verify_cache.json"
BUDGET = int(os.environ.get("VERIFY_BUDGET_SEC", "6000"))
T0 = time.time()


def dart(path, raw=False, **p):
    for i in range(5):
        try:
            r = S.get(f"https://opendart.fss.or.kr/api/{path}", params={"crtfc_key": KEY, **p}, timeout=40)
            if raw: return r.content
            d = r.json()
            if d.get("status") == "020": time.sleep(3 * (i + 1)); continue
            return d
        except Exception:
            time.sleep(2 * (i + 1))
    return b"" if raw else {}


def corp_list():
    z = zipfile.ZipFile(io.BytesIO(dart("corpCode.xml", raw=True)))
    root = ET.fromstring(z.read(z.namelist()[0]))
    return [{"c": e.findtext("corp_code"), "n": (e.findtext("corp_name") or "").strip(), "s": (e.findtext("stock_code") or "").strip()} for e in root.iter("list")]


def latest_report(corp):
    d = dart("list.json", corp_code=corp, bgn_de="20230101", pblntf_detail_ty="A001", page_count=10)
    rows = d.get("list") or []
    rows = [r for r in rows if "사업보고서" in r.get("report_nm", "")]
    return (rows[0]["rcept_no"], rows[0]["report_nm"]) if rows else (None, "")


def business_text(rcept):
    b = dart("document.xml", raw=True, rcept_no=rcept)
    try: z = zipfile.ZipFile(io.BytesIO(b))
    except Exception: return ""
    txt = ""
    for n in z.namelist():
        raw = z.read(n)
        for enc in ("utf-8", "euc-kr", "cp949"):
            try: s = raw.decode(enc); break
            except Exception: s = ""
        s = re.sub(r"<[^>]+>", " ", s); s = re.sub(r"&[a-z#0-9]+;", " ", s); s = re.sub(r"\s+", " ", s)
        txt += s + " "
    m = [x.start() for x in re.finditer(r"사업의 개요", txt)]
    i = m[1] if len(m) > 1 else (m[0] if m else txt.find("사업의 내용"))
    return txt[max(i, 0): max(i, 0) + 6000] if txt else ""


KW = {
    "장비": ["증착", "식각", "노광", "세정", "본더", "본딩", "테스터", "핸들러", "검사장비", "측정장비", "제조장비", "공정장비", "이송", "클린룸", "진공", "펌프", "스크러버"],
    "부품": ["소켓", "프로브", "리드프레임", "기판", "PCB", "쿼츠", "세라믹", "히터", "챔버", "MLCC", "커넥터", "패키지"],
    "소재": ["웨이퍼", "포토레지스트", "식각액", "슬러리", "특수가스", "케미칼", "타겟", "전구체", "프리커서", "CMP", "불화", "실리콘"],
    "팹리스·설계": ["팹리스", "설계", "시스템반도체", "파운드리", "IP", "SoC", "ASIC", "이미지센서", "드라이버IC"],
    "비반도체": ["화장품", "의약품", "철강", "의료기기", "건설", "식품", "2차전지", "배터리", "자동차", "조선", "섬유", "시멘트"],
}


def score(text):
    sem = len(re.findall(r"반도체", text))
    sc = {k: sum(text.count(w) for w in ws) for k, ws in KW.items()}
    if sem < 3: sug = "반도체 언급 적음(제외 후보)"
    else:
        main = max(("장비", "부품", "소재", "팹리스·설계"), key=lambda k: sc[k])
        sug = {"팹리스·설계": "팹리스·설계(소부장 아닐 수 있음)"}.get(main, f"{main} 가능성")
        if sc["비반도체"] > sem: sug += " · 비반도체 비중 큼"
    return sem, sc, sug


def main():
    corps = corp_list(); by_s = {c["s"]: c for c in corps if c["s"]}; by_n = {}
    for c in corps: by_n.setdefault(re.sub(r"[\s()주식회사㈜]", "", c["n"]), c)
    targets = []
    for r in csv.DictReader(open(ROOT / "scripts/semi_universe_candidates.csv", encoding="utf-8-sig")):
        if (r["후보등급"] in ("A", "B") and r["상태"] == "신규") or r["상태"] == "기존 비소부장":
            targets.append({"n": r["회사"], "s": r["종목코드"], "g": r["후보등급"], "st": r["상태"], "src": "후보"})
    for r in csv.DictReader(open(ROOT / "scripts/partner_groups.tsv", encoding="utf-8"), delimiter="\t"):
        targets.append({"n": r["회사명"], "s": "", "g": "협력사", "st": r["분과"], "src": "협력사90"})
    seen, T = set(), []
    for t in targets:
        k = t["s"] or t["n"]
        if k in seen: continue
        seen.add(k); T.append(t)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    print(f"[verify] 대상 {len(T)}곳 · 저장된 {len(cache)}곳", flush=True)

    def work(t):
        k = t["s"] or t["n"]
        if k in cache and cache[k].get("ok"): return
        if time.time() - T0 > BUDGET: return
        c = by_s.get(t["s"]) if t["s"] else by_n.get(re.sub(r"[\s()주식회사㈜]", "", t["n"]))
        if not c: cache[k] = {**t, "ok": True, "sug": "DART 미매칭(비상장·외국계 추정)", "sem": 0, "sum": ""}; return
        rc, nm = latest_report(c["c"])
        if not rc: cache[k] = {**t, "ok": True, "corp": c["n"], "sug": "사업보고서 없음", "sem": 0, "sum": ""}; return
        txt = business_text(rc)
        sem, sc, sug = score(txt)
        cache[k] = {**t, "ok": bool(txt), "corp": c["n"], "code": c["s"], "rpt": nm, "sem": sem, "sc": sc, "sug": sug, "sum": txt[:350]}

    done = 0
    with ThreadPoolExecutor(4) as ex:
        for _ in ex.map(work, T):
            done += 1
            if done % 50 == 0:
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8"); print(f"[verify] 진행 {done}/{len(T)}", flush=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    with open(ROOT / "semi_verify.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["회사", "종목코드", "등급/출처", "상태/분과", "반도체 언급", "장비", "부품", "소재", "팹리스·설계", "비반도체", "제안", "사업 요약"])
        for t in T:
            v = cache.get(t["s"] or t["n"])
            if not v: continue
            sc = v.get("sc", {})
            w.writerow([t["n"], t["s"], t["g"], t["st"], v.get("sem", 0), sc.get("장비", ""), sc.get("부품", ""), sc.get("소재", ""), sc.get("팹리스·설계", ""), sc.get("비반도체", ""), v.get("sug", ""), v.get("sum", "")])
    for t in T:
        v = cache.get(t["s"] or t["n"])
        if v: print(f"[verify-row]\t{t['n']}\t{t['s']}\t{t['g']}\t{v.get('sem',0)}\t{v.get('sug','')}", flush=True)
    print(f"[verify] 완료 {sum(1 for t in T if (t['s'] or t['n']) in cache)}/{len(T)}", flush=True)


main()
