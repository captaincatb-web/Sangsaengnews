"""DART OpenAPI 로 국내 상장사 전체를 훑어 반도체 소부장(소재·부품·장비) 숫자를 센다.
1) corpCode.xml 에서 종목코드가 있는 회사 = 상장사 전체
2) company.json 으로 시장(유가·코스닥·코넥스)과 업종코드(KSIC)를 읽는다
3) 반도체 관련 업종코드별로 세고, 대시보드 명단(universe.js·segments.js)의 구분별 상장 수도 센다
DART 는 '소부장' 여부를 따로 주지 않는다. 업종코드와 직접 분류(segments.js)로 나눈 숫자다.
결과는 로그의 [semi-count-json] 줄에 한 줄 JSON 으로 남긴다."""
import io, json, os, re, sys, time, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

KEY = os.environ.get("DART_API_KEY", "")
ROOT = Path(__file__).resolve().parent.parent
if not KEY:
    sys.exit("DART_API_KEY 가 없습니다")
S = requests.Session()


def dart(path, **p):
    for i in range(5):
        try:
            r = S.get(f"https://opendart.fss.or.kr/api/{path}", params={"crtfc_key": KEY, **p}, timeout=30)
            d = r.json()
            if d.get("status") == "020":  # 요청 한도: 잠시 쉰다
                time.sleep(5 * (i + 1)); continue
            return d
        except Exception:
            time.sleep(2 * (i + 1))
    return {}


def corp_list():
    r = S.get("https://opendart.fss.or.kr/api/corpCode.xml", params={"crtfc_key": KEY}, timeout=120)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    root = ET.fromstring(z.read(z.namelist()[0]))
    return [{"c": e.findtext("corp_code"), "n": (e.findtext("corp_name") or "").strip(), "s": (e.findtext("stock_code") or "").strip()} for e in root.iter("list")]


def info(row):
    d = dart("company.json", corp_code=row["c"])
    return {**row, "cls": d.get("corp_cls", ""), "ind": d.get("induty_code", ""), "jur": (d.get("jurir_no") or "").replace("-", "").strip(), "biz": (d.get("bizr_no") or "").replace("-", "").strip(), "ok": d.get("status") == "000"}


# 반도체 소부장 후보 업종코드(KSIC 10차). 이 목록은 '후보'이며 직접 분류가 우선한다
CODE_KIND = {
    "29271": "장비", "29272": "장비",                        # 반도체·디스플레이 제조용 기계
    "26110": "부품", "26121": "부품", "26129": "부품",        # 전자집적회로·반도체소자
    "26299": "부품", "26310": "부품",                        # 기타 전자부품·인쇄회로기판
    "20121": "소재", "20119": "소재", "20129": "소재",        # 산업용 가스·기초 무기화학
}
KSIC_RULES = [("2927", "장비"), ("29", "장비"), ("27", "장비"), ("2611", "소재"), ("20", "소재"), ("21", "소재"), ("22", "소재"), ("24", "소재"), ("23", "부품"), ("25", "부품"), ("26", "부품"), ("28", "부품"), ("30", "부품")]
NAME_SHOW = ("2611", "2612", "2927", "2631")


NAVER = "https://finance.naver.com/sise/sise_market_sum.naver"
NH = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Referer": "https://finance.naver.com/"}
NS = "https://stock.naver.com"
NSH = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Accept": "application/json", "Referer": "https://stock.naver.com/"}


def find_items(j, key="itemcode"):
    """응답 어디에 있든 종목 코드 키를 가진 dict 목록을 찾는다(참고: dd3ok/naverstock-api-skill, 응답 형태가 경로마다 다름)."""
    if isinstance(j, list):
        if j and isinstance(j[0], dict) and any(k.lower() == key for k in j[0]): return j
        for x in j:
            r = find_items(x, key)
            if r: return r
    elif isinstance(j, dict):
        for v in j.values():
            r = find_items(v, key)
            if r: return r
    return []


def ns_pages(path, params, page_size=None, max_pages=80):
    """stock.naver.com 목록을 쪽 단위로 읽는다. startIdx 가 쪽 번호인지 건너뛴 개수인지 둘째 쪽 겹침으로 판별. 403·429는 즉시 중단.
    쪽 크기가 크면 400이 나므로 100→50→30→20 순으로 줄여 첫 쪽이 열리는 크기를 쓴다."""
    if page_size is None:
        for page_size in (100, 50, 30, 20):
            r0 = S.get(NS + path, params={**params, "startIdx": 0, "pageSize": page_size}, headers=NSH, timeout=25, allow_redirects=False)
            if r0.status_code in (403, 429) or 300 <= r0.status_code < 400:
                raise RuntimeError(f"HTTP {r0.status_code}")
            if r0.status_code == 200: break
        else:
            raise RuntimeError("쪽 크기 400")
        print(f"[naver] {path} 쪽 크기 {page_size}", flush=True)
    seen, out, mode = set(), [], "page"
    for i in range(max_pages):
        start = i if mode == "page" else i * page_size
        r = S.get(NS + path, params={**params, "startIdx": start, "pageSize": page_size}, headers=NSH, timeout=25, allow_redirects=False)
        if r.status_code in (403, 429) or 300 <= r.status_code < 400:
            raise RuntimeError(f"HTTP {r.status_code}")
        r.raise_for_status()
        rows = find_items(r.json())
        codes = [x.get("itemcode") or x.get("itemCode") for x in rows]
        if i == 1 and codes and len(set(codes) & seen) > len(codes) // 2 and mode == "page":
            mode = "offset"; rows = []  # 둘째 쪽이 첫 쪽과 겹침 → startIdx 는 건너뛴 개수
            r = S.get(NS + path, params={**params, "startIdx": page_size, "pageSize": page_size}, headers=NSH, timeout=25, allow_redirects=False)
            rows = find_items(r.json()); codes = [x.get("itemcode") or x.get("itemCode") for x in rows]
        new = [x for x, c in zip(rows, codes) if c and c not in seen]
        seen.update(c for c in codes if c)
        out += new
        time.sleep(0.2)
        if len(rows) < page_size or not new:
            break
    return out


def naver_caps():
    """네이버증권 시장 목록(코스피·코스닥, 시가총액순)에서 종목코드별 시가총액(억 원)을 읽는다. 실패하면 PC 웹 표로 대체."""
    out = {"0": {}, "1": {}}
    extra = {}
    ok = True
    for sosok, mt in (("0", "KOSPI"), ("1", "KOSDAQ")):
        try:
            rows = ns_pages("/api/domestic/market/stock/default", {"tradeType": "KRX", "marketType": mt, "orderType": "marketSum"})
            for x in rows:
                if x.get("type") not in (None, "ST"): continue  # 주식만(ETF·ETN 제외)
                ms = x.get("marketSum")
                if ms and str(ms).isdigit():
                    out[sosok][x["itemcode"]] = round(int(ms) / 1e8)
                    extra[x["itemcode"]] = x.get("itemname")
            print(f"[naver-api] {mt} {len(out[sosok])}종목 · 시총 합계 {sum(out[sosok].values()) / 10000:,.1f}조 원", flush=True)
        except Exception as e:
            print(f"[naver-api] {mt} 실패: {e}", flush=True); ok = False
    if ok and out["0"] and out["1"]:
        return out, "stock.naver.com API"
    return naver_caps_html(), "finance.naver.com 표(대체)"


def naver_upjong(industry_no="278"):
    """네이버 업종 '반도체와반도체장비'(no 278) 구성 종목을 읽는다. 응답 구조를 로그에 남긴다."""
    try:
        rows = []
        for mt in ("KOSPI", "KOSDAQ"):  # 서버는 marketType 으로 KOSPI·KOSDAQ 만 받는다(ALL 은 400)
            rows += ns_pages(f"/api/domestic/market/upjong/{industry_no}/stocklist", {"marketType": mt, "orderType": "marketSum"})
        print(f"[naver-upjong] {industry_no} 구성 {len(rows)}종목 · 예시 {json.dumps(rows[:1], ensure_ascii=False)[:400]}", flush=True)
        return [(x.get("itemcode") or x.get("itemCode")) for x in rows]
    except Exception as e:
        print(f"[naver-upjong] 실패: {e}", flush=True)
        return []


def naver_caps_html():
    """(대체) 네이버 금융 시가총액 순위 표 파싱."""
    out = {"0": {}, "1": {}}
    for sosok in out:
        page, empty = 1, 0
        while page <= 80 and empty < 2:
            try:
                r = S.get(NAVER, params={"sosok": sosok, "page": page}, headers=NH, timeout=20)
                r.encoding = "euc-kr"
                html = r.text
            except Exception:
                time.sleep(2); empty += 1; page += 1; continue
            new = 0
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
                m = re.search(r"/item/main\.naver\?code=(\d{6})", tr)
                nums = [re.sub(r"<[^>]+>|[\s,]", "", x) for x in re.findall(r'<td class="number">(.*?)</td>', tr, re.S)]
                if not m or len(nums) < 5 or not nums[4].isdigit() or m.group(1) in out[sosok]:
                    continue
                out[sosok][m.group(1)] = int(nums[4]); new += 1  # 5번째 숫자 칸 = 시가총액(억 원)
            empty = empty + 1 if not new else 0
            page += 1
            time.sleep(0.15)
        print(f"[naver-html] {'코스피' if sosok == '0' else '코스닥'} {len(out[sosok])}종목 · 합계 {sum(out[sosok].values()):,}억 원", flush=True)
    return out


def curated():
    uni = (ROOT / "site/data/universe.js").read_text(encoding="utf-8")
    seg = (ROOT / "site/data/segments.js").read_text(encoding="utf-8")
    alias = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', uni.split("window.COMPANY_UNIVERSE =")[0]))
    names = re.findall(r'^\s*\["([^"]+)",\s*"([^"]+)"', uni.split("window.COMPANY_UNIVERSE =")[1], re.M)
    segs = {c: k for c, k, _ in re.findall(r'"(\d{8})":\s*\["([^"]+)",\s*"([^"]*)"\]', seg)}
    return names, alias, segs


def main():
    rows = corp_list()
    listed = [r for r in rows if r["s"]]
    print(f"[corpCode] 전체 {len(rows)} · 상장(종목코드 있음) {len(listed)}", flush=True)
    t0 = time.time()
    det = []
    with ThreadPoolExecutor(6) as ex:
        for i, d in enumerate(ex.map(info, listed), 1):
            det.append(d)
            if i % 500 == 0:
                print(f"[company] {i}/{len(listed)} · {time.time() - t0:.0f}초", flush=True)
    bad = [d for d in det if not d["ok"]]
    print(f"[company] 조회 {len(det)} · 실패 {len(bad)} · {time.time() - t0:.0f}초", flush=True)
    det = [d for d in det if d["ok"]]
    mk = {}
    for d in det: mk[d["cls"]] = mk.get(d["cls"], 0) + 1
    by_code = {}
    for d in det: by_code.setdefault(d["ind"], []).append(d["n"])
    cand = {k: {"count": 0, "codes": {}} for k in ("장비", "부품", "소재")}
    for code, kind in CODE_KIND.items():
        ns = by_code.get(code, [])
        cand[kind]["count"] += len(ns); cand[kind]["codes"][code] = len(ns)
    show = {c: sorted(ns) for c, ns in by_code.items() if c.startswith(NAME_SHOW)}
    # 대시보드 명단(직접 분류 우선)
    names, alias, segs = curated()
    by_name = {}
    for d in det: by_name.setdefault(d["n"], d)
    all_by_name = {}
    for r in rows: all_by_name.setdefault(r["n"], r)
    cur = {"명단": len(names), "상장": 0, "비상장": 0, "구분별": {}, "미매칭": []}
    members = []  # (종목코드, 구분, 시장)
    for disp, key in names:
        nm = alias.get(disp, disp)
        d = by_name.get(nm) or by_name.get(key)
        row = d or all_by_name.get(nm) or all_by_name.get(key)
        if not row:
            cur["미매칭"].append(disp); continue
        lst = bool(d)
        cur["상장" if lst else "비상장"] += 1
        kind = segs.get(row["c"], "(직접분류 없음)")
        if lst: members.append((d["s"], kind, d["cls"]))
        b = cur["구분별"].setdefault(kind, {"상장": 0, "비상장": 0})
        b["상장" if lst else "비상장"] += 1
    # ---- 시장 비중(네이버 시가총액) ----
    caps, caps_src = naver_caps()
    up278 = naver_upjong("278")
    MK = {"Y": ("코스피", "0"), "K": ("코스닥", "1")}
    def pack(items):  # items: [(종목코드, 구분, 시장)]
        res = {}
        for cls, (mname, sosok) in MK.items():
            tot = caps[sosok]; tot_cap = sum(tot.values()); n_mkt = mk.get(cls, 0)
            kinds = {}
            for code, kind, c in items:
                if c != cls: continue
                b = kinds.setdefault(kind, {"종목수": 0, "시가총액(억)": 0, "시총 없음": 0})
                b["종목수"] += 1
                if code in tot: b["시가총액(억)"] += tot[code]
                else: b["시총 없음"] += 1
            for kind, b in kinds.items():
                b["종목수 비중(%)"] = round(b["종목수"] / n_mkt * 100, 2) if n_mkt else None
                b["시총 비중(%)"] = round(b["시가총액(억)"] / tot_cap * 100, 2) if tot_cap else None
            allb = {"종목수": sum(b["종목수"] for b in kinds.values()), "시가총액(억)": sum(b["시가총액(억)"] for b in kinds.values())}
            allb["종목수 비중(%)"] = round(allb["종목수"] / n_mkt * 100, 2) if n_mkt else None
            allb["시총 비중(%)"] = round(allb["시가총액(억)"] / tot_cap * 100, 2) if tot_cap else None
            res[mname] = {"시장 전체": {"DART 상장사 수": n_mkt, "네이버 종목수": len(tot), "시가총액 합계(억)": tot_cap}, "구분별": kinds, "합계": allb}
        return res
    share_cur = pack([m for m in members if m[1] in ("소재", "부품", "장비")])
    share_up = pack([(c, "네이버 업종 반도체와반도체장비", "Y" if c in caps["0"] else "K") for c in up278 if c in caps["0"] or c in caps["1"]])
    share_code = pack([(d["s"], CODE_KIND[d["ind"]], d["cls"]) for d in det if d["ind"] in CODE_KIND])

    # ---- 협력사 상장 명단(사용자 제공, scripts/partner_listed.tsv) ----
    import csv
    segs_all = curated()[2]
    seg_sub = dict(re.findall(r'"(\d{8})":\s*\["[^"]+",\s*"([^"]*)"\]', (ROOT / "site/data/segments.js").read_text(encoding="utf-8")))
    plist = {}
    for r in list(csv.reader(open(ROOT / "scripts/partner_listed.tsv", encoding="utf-8"), delimiter="\t"))[1:]:
        plist.setdefault(r[1].strip(), r)
    jur = {d["jur"]: d for d in det if d["jur"]}
    norm = lambda t: re.sub(r"\(주\)|주식회사|㈜|\s", "", t)
    nm = {norm(d["n"]): d for d in det}
    part, unmatched = [], []
    for j, r in plist.items():
        d = jur.get(j) or nm.get(norm(re.sub(r"\s*\S*(지점|공장|사업장|영업소|사업부)$", "", r[2])))
        if not d: unmatched.append(r[2]); continue
        seg = segs_all.get(d["c"]); est = False
        if seg is None:
            kind = next((k for p, k in KSIC_RULES if d["ind"].startswith(p)), "미분류"); est = True
        else: kind = seg
        part.append({"회사": d["n"], "입력명": r[2], "시장": {"Y": "코스피", "K": "코스닥", "N": "코넥스"}.get(d["cls"], d["cls"]), "종목코드": d["s"], "업종코드": d["ind"], "구분": kind, "추정": est, "세부": seg_sub.get(d["c"], "")})
    pk = {}
    for x in part:
        b = pk.setdefault(x["구분"], {"코스피": 0, "코스닥": 0, "코넥스": 0}); b[x["시장"]] += 1
    print(f"[partner] 입력 {len(plist)}곳 · DART 매칭 {len(part)} · 미매칭 {len(unmatched)} {unmatched}", flush=True)
    sobu = [x for x in part if x["구분"] in ("소재", "부품", "장비")]
    share_partner = pack([(x["종목코드"], x["구분"], {"코스피": "Y", "코스닥": "K"}.get(x["시장"], "N")) for x in sobu])
    partner_out = {"입력(고유 법인)": len(plist), "DART 매칭": len(part), "미매칭": unmatched, "구분별(시장)": pk, "소부장 합계": len(sobu), "시장비중": share_partner,
                   "명단": [f"{x['회사']}|{x['시장']}|{x['업종코드']}|{x['구분']}{'(추정)' if x['추정'] else ''}|{x['세부']}" for x in part]}
    out = {"전체상장": len(listed), "조회실패": len(bad), "시장별": mk, "업종후보": cand,
           "업종코드별(26·29·20·24·27 시작)": {c: len(n) for c, n in sorted(by_code.items()) if c[:2] in ("26", "29", "20", "24", "27")},
           "업종코드별 회사명": show, "대시보드명단": cur, "시장비중_대시보드명단(직접분류)": share_cur, "시장비중_업종코드후보": share_code, "시장비중_네이버업종278": share_up, "시총출처": caps_src, "협력사명단": partner_out}
    print("[semi-count-json]" + json.dumps(out, ensure_ascii=False), flush=True)
    Path("semi_count.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


main()
