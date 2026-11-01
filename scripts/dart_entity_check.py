"""DART 기업 식별 점검(읽기 전용): OCI·OCI홀딩스 코드/법인 구분, 비상장·법인확인 10곳의 상장 여부 근거, OCI 사업보고서 '사업의 내용' 발췌.
출력은 로그의 [dart-entity] 줄(JSON). 대표자·연락처 등 개인정보 필드는 읽지도 출력하지도 않는다."""
import io, json, os, re, sys, time, zipfile
import xml.etree.ElementTree as ET
import requests

KEY = os.environ.get("DART_API_KEY", "")
if not KEY: sys.exit("DART_API_KEY 없음")
S = requests.Session()
def get(path, raw=False, **p):
    for i in range(4):
        try:
            r = S.get(f"https://opendart.fss.or.kr/api/{path}", params={"crtfc_key": KEY, **p}, timeout=60)
            if raw: return r.content
            d = r.json()
            if d.get("status") == "020": time.sleep(3 * (i + 1)); continue
            return d
        except Exception: time.sleep(2 * (i + 1))
    return b"" if raw else {}
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
z = zipfile.ZipFile(io.BytesIO(get("corpCode.xml", raw=True))); root = ET.fromstring(z.read(z.namelist()[0]))
corps = [{"corp_code": e.findtext("corp_code"), "name": (e.findtext("corp_name") or "").strip(), "stock": (e.findtext("stock_code") or "").strip(), "modify": e.findtext("modify_date")} for e in root.iter("list")]
nm = lambda s: re.sub(r"[\s()㈜]|주식회사", "", s or "").lower()
by_stock = {c["stock"]: c for c in corps if c["stock"]}
out = {"collected_at": NOW, "corp_total": len(corps), "listed_total": len(by_stock)}

def profile(c):
    j = get("company.json", corp_code=c["corp_code"])
    return {k: j.get(k) for k in ("status", "corp_name", "corp_name_eng", "stock_name", "stock_code", "corp_cls", "induty_code", "est_dt", "acc_mt")} | {"corp_code": c["corp_code"], "modify_date": c["modify"]}

# 1) OCI 계열 식별
oci = {"by_stock_code": {k: (by_stock.get(k) and profile(by_stock[k])) for k in ("010060", "456040")},
       "name_search": [dict(c) | {"profile": profile(c) if c["stock"] else None} for c in corps if nm(c["name"]) in ("oci", "oci홀딩스", "오씨아이", "오씨아이홀딩스", "oci company") or nm(c["name"]).startswith("oci")]}
out["oci"] = oci

# 2) 10곳
names = ["영진아이엔디", "피티씨", "금강쿼츠", "디에스테크노", "디에프텍", "밸류엔지니어링", "새솔다이아몬드", "이노레스", "삼영순화", "엔씨케이"]
chk = {}
for n in names:
    hits = [c for c in corps if nm(c["name"]) == nm(n)]
    part = [c for c in corps if nm(n) in nm(c["name"]) and nm(c["name"]) != nm(n)][:6]
    chk[n] = {"exact": [dict(c) | {"profile": profile(c) if c["stock"] else None} for c in hits], "partial": [{"name": c["name"], "stock": c["stock"], "corp_code": c["corp_code"]} for c in part]}
out["ten"] = chk

# 3) OCI(456040)·OCI홀딩스(010060) 최신 사업보고서 '사업의 내용' 발췌
def report_text(corp_code):
    d = get("list.json", corp_code=corp_code, bgn_de="20240101", pblntf_detail_ty="A001", page_count=10)
    rows = [r for r in (d.get("list") or []) if "사업보고서" in r.get("report_nm", "")]
    if not rows: return {"error": "사업보고서 조회 결과 없음", "raw_status": d.get("status")}
    b = get("document.xml", raw=True, rcept_no=rows[0]["rcept_no"])
    try: zf = zipfile.ZipFile(io.BytesIO(b))
    except Exception: return {"error": "document.xml 열기 실패", "rcept_no": rows[0]["rcept_no"]}
    txt = ""
    for n in zf.namelist():
        raw = zf.read(n)
        for enc in ("utf-8", "euc-kr", "cp949"):
            try: s = raw.decode(enc); break
            except Exception: s = ""
        txt += re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)) + " "
    m = [x.start() for x in re.finditer("사업의 개요", txt)]; i = m[1] if len(m) > 1 else (m[0] if m else 0)
    body = txt[i:i + 60000]
    kws = {k: body.count(k) for k in ("반도체", "폴리실리콘", "과산화수소", "웨이퍼", "식각", "카본", "에칭", "TSA", "포스포릭", "인산", "특수가스", "다결정")}
    return {"rcept_no": rows[0]["rcept_no"], "report_nm": rows[0]["report_nm"], "rcept_dt": rows[0].get("rcept_dt"), "keyword_counts": kws, "excerpt": txt[i:i + 2600]}
out["oci_reports"] = {code: (by_stock.get(code) and {"corp_name": by_stock[code]["name"], **report_text(by_stock[code]["corp_code"])}) for code in ("456040", "010060")}
print("[dart-entity]" + json.dumps(out, ensure_ascii=False, separators=(",", ":")), flush=True)
