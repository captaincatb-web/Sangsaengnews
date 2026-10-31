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
    return {**row, "cls": d.get("corp_cls", ""), "ind": d.get("induty_code", ""), "ok": d.get("status") == "000"}


# 반도체 소부장 후보 업종코드(KSIC 10차). 이 목록은 '후보'이며 직접 분류가 우선한다
CODE_KIND = {
    "29271": "장비", "29272": "장비",                        # 반도체·디스플레이 제조용 기계
    "26110": "부품", "26121": "부품", "26129": "부품",        # 전자집적회로·반도체소자
    "26299": "부품", "26310": "부품",                        # 기타 전자부품·인쇄회로기판
    "20121": "소재", "20119": "소재", "20129": "소재",        # 산업용 가스·기초 무기화학
}
NAME_SHOW = ("2611", "2612", "2927", "2631")


NAVER = "https://finance.naver.com/sise/sise_market_sum.naver"
NH = {"User-Agent": "Mozilla/5.0 (compatible; Sangsaengnews research)", "Referer": "https://finance.naver.com/"}


def naver_caps():
    """네이버 증권 시가총액 순위 표(코스피 sosok=0, 코스닥 sosok=1)에서 종목코드별 시가총액(억 원)을 읽는다."""
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
        print(f"[naver] {'코스피' if sosok == '0' else '코스닥'} {len(out[sosok])}종목 · 합계 {sum(out[sosok].values()):,}억 원 · {page - 1}쪽", flush=True)
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
    with ThreadPoolExecutor(6) as ex:
        det = list(ex.map(info, listed))
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
    caps = naver_caps()
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
    share_code = pack([(d["s"], CODE_KIND[d["ind"]], d["cls"]) for d in det if d["ind"] in CODE_KIND])
    out = {"전체상장": len(listed), "조회실패": len(bad), "시장별": mk, "업종후보": cand,
           "업종코드별(26·29·20·24·27 시작)": {c: len(n) for c, n in sorted(by_code.items()) if c[:2] in ("26", "29", "20", "24", "27")},
           "업종코드별 회사명": show, "대시보드명단": cur, "시장비중_대시보드명단(직접분류)": share_cur, "시장비중_업종코드후보": share_code}
    print("[semi-count-json]" + json.dumps(out, ensure_ascii=False), flush=True)
    Path("semi_count.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


main()
