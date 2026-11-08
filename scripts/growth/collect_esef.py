"""유럽 상장사 3개년 연간 매출·영업이익을 ESEF 공시 모음(filings.xbrl.org, xbrl-json)에서 수집한다. 결과는 비공개 폴더에만 쓴다.
- 대상: <GROWTH_PRIVATE_DIR>/eu_targets.csv (목록표기, 공식법인명, 티커, 거래소, 대표업종). 키 불필요.
- 법인 연결: 공시 등록명의 정규화 이름(name_key)이 공식법인명과 정확히 같을 때만 확정. 아니면 REVIEW 로 기록하고 값은 쓰지 않는다(이름 유사 합치기 금지).
- 연간 값: 기간 350~380일, 차원 없는 사실만. 연도 = 기간 종료일의 연도. 최신 공시 우선. 매출·영업이익은 같은 기간·통화일 때만 쌍으로 쓴다.
- 연결 기준(ESEF 연결재무제표). 403·429 는 기록 후 즉시 중단. 출력 esef_rows.csv 는 조사 CSV 와 같은 열(금액단위 1)이라 ingest_overseas_csv.py 로 반입한다. 로그에는 건수만."""
import csv, datetime as dt, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve(); B = "https://filings.xbrl.org"
COLS = ["목록표기", "공식법인명", "상장여부", "거래소", "티커", "결산월", "회계연도", "기간시작", "기간종료", "통화", "금액단위", "매출", "영업이익", "연결/개별", "출처URL", "쪽/표위치", "확신도(높음/중간/낮음)", "비고", "대표업종(소재/부품/장비)", "대표업종근거(반도체 관련 매출 비중과 출처)"]
REV = ("ifrs-full:RevenueFromContractsWithCustomers", "ifrs-full:Revenue"); OPI = ("ifrs-full:ProfitLossFromOperatingActivities", "ifrs-full:OperatingIncomeLoss")
SUF = re.compile(r"\b(co|corp|corporation|inc|ltd|limited|llc|gmbh|ag|sa|nv|bv|plc|se|spa|company|holdings?|group)\b\.?", re.I)
log = {"calls": 0}


def name_key(s):
    """이름 열쇠: 악센트·움라우트를 떼고(SÜSS→suss) 법인격 표기·문장부호를 지운다. 같은 열쇠일 때만 같은 법인으로 본다."""
    import unicodedata
    t = "".join(ch for ch in unicodedata.normalize("NFKD", (s or "").lower()) if not unicodedata.combining(ch))
    return re.sub(r"[^0-9a-z가-힣]+", "", SUF.sub(" ", t.replace(".", "")))


# 회사가 자체 항목명(확장 개념)으로 공시한 경우의 이름 규칙: 차원 없는 연간 총액만 쓰고, 표준(ifrs-full) 항목이 있으면 그쪽을 우선한다
EXT_REV = re.compile(r"^(Revenue|Revenues|NetSales|Sales|TotalRevenue|TotalRevenues|NetRevenue|NetRevenues)$", re.I)
EXT_OPI = re.compile(r"^(OperatingIncome|OperatingProfit|OperatingResult|OperatingIncomeLoss|OperatingProfitLoss|ResultFromOperations|ResultFromOperatingActivities|ProfitFromOperations|IncomeFromOperations|ProfitLossFromOperations)$", re.I)


def get(path):
    time.sleep(0.5); log["calls"] += 1
    try:
        with urllib.request.urlopen(urllib.request.Request(B + path, headers={"User-Agent": "growth-esef"}), timeout=90) as r: return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 429): raise SystemExit(f"[ABORT] ESEF {e.code}: 중단")
        return None


def filings(name):
    # 검색어: 법인격 표기(N.V.·SE·SA·AG 등)를 뗀 전체 이름. 첫 단어만 쓰면 'BE' 같은 짧은 단어에 다른 회사 공시가 섞여 오래된 공시가 목록 밖으로 밀린다
    term = name.strip()
    for _ in range(2): term = re.sub(r"[\s,]+(N\.?\s?V\.?|S\.?E\.?|S\.?A\.?|AG|S\.?p\.?A\.?|plc|Ltd\.?|Inc\.?|Corp(oration)?\.?)$", "", term, flags=re.I).strip()
    f = urllib.parse.quote(json.dumps([{"name": "entity.name", "op": "ilike", "val": "%" + term + "%"}]))
    j = get(f"/api/filings?filter={f}&include=entity&sort=-period_end&page%5Bsize%5D=100")
    if not j: return []
    ents = {e["id"]: e["attributes"].get("name", "") for e in j.get("included", []) if e.get("type") == "entity"}
    out = []
    for d in j.get("data", []):
        eid = (d.get("relationships", {}).get("entity", {}).get("data") or {}).get("id")
        out.append((ents.get(eid, ""), d["attributes"]))
    return out


def facts(url):
    """{(종류 'rev'|'op', 종료일): (값, 시작일, 종료일, 통화, 개념, 표준여부)} — 차원 없는 연간(350~380일) 값. 표준 개념 > 확장 개념, 같은 등급은 REV·OPI 순서 우선."""
    j = get(url) or {}; best = {}
    for v in (j.get("facts") or {}).values():
        d = v.get("dimensions", {}); c = d.get("concept") or ""
        if set(d) - {"concept", "entity", "period", "unit"} or "/" not in d.get("period", ""): continue
        local = c.split(":")[-1]
        if c in REV: kind, rank = "rev", REV.index(c)
        elif c in OPI: kind, rank = "op", OPI.index(c)
        elif not c.startswith("ifrs-full:") and EXT_REV.match(local): kind, rank = "rev", 10
        elif not c.startswith("ifrs-full:") and EXT_OPI.match(local): kind, rank = "op", 10
        else: continue
        s, e = [dt.date.fromisoformat(x[:10]) for x in d["period"].split("/")]; e -= dt.timedelta(days=1)
        if not 350 <= (e - s).days + 1 <= 380: continue
        try: val = float(v.get("value"))
        except (TypeError, ValueError): continue
        k = (kind, e); cand = (rank, val, s, e, d.get("unit", "").replace("iso4217:", ""), c)
        if k not in best or cand[0] < best[k][0]: best[k] = cand
    return {k: (x[1], x[2], x[3], x[4], x[5], x[0] < 10) for k, x in best.items()}


def main():
    tg = list(csv.DictReader(open(OUT / "eu_targets.csv", encoding="utf-8-sig"))); rows = []; res = {"targets": len(tg), "matched": 0, "review": 0, "complete_3y": 0}
    for t in tg:
        names = [t["공식법인명"]] + [x.strip() for x in (t.get("등록명후보") or "").split("|") if x.strip()]  # 공시 등록명이 다를 때 확인된 정식 명칭(예: 옛 법인명)만 추가
        keys = {name_key(x) for x in names}; seen = set(); fl = []
        for nm in names:
            for n, a in filings(nm):
                if name_key(n) in keys and a.get("fxo_id") not in seen: seen.add(a.get("fxo_id")); fl.append((n, a))
        if not fl: res["review"] += 1; continue
        res["matched"] += 1; got = {}
        for n, a in sorted(fl, key=lambda x: x[1]["period_end"], reverse=True)[:8]:  # 최신 공시 우선(재작성 값 반영), 비교 연도도 함께 읽는다
            fx = facts(a["json_url"])
            for (kind, e), (val, s, _, cur, concept, std) in fx.items():
                k = (kind == "rev", e.year)
                if k not in got or (std and not got[k][6]): got[k] = (val, s, e, cur, a, concept, std)
        yrs = 0
        for y in (2023, 2024, 2025):
            r = got.get((True, y)); o = got.get((False, y))
            if not (r and o) or r[1:4] != o[1:4]: continue
            yrs += 1; a = r[4]; ext = not (r[6] and o[6]); res["extension_used"] = res.get("extension_used", 0) + ext
            rows.append({"목록표기": t["목록표기"], "공식법인명": t["공식법인명"], "상장여부": "상장", "거래소": t["거래소"], "티커": t["티커"], "결산월": str(r[2].month).zfill(2), "회계연도": y,
                         "기간시작": r[1].isoformat(), "기간종료": r[2].isoformat(), "통화": r[3], "금액단위": "1", "매출": int(r[0]), "영업이익": int(o[0]), "연결/개별": "연결",
                         "출처URL": B + a.get("report_url", a["json_url"]), "쪽/표위치": f"ESEF xbrl-json 매출 {r[5]} / 영업이익 {o[5]}", "확신도(높음/중간/낮음)": "중간" if ext else "높음", "비고": "ESEF 공시 모음 자동 수집" + (" · 회사 자체 항목명(확장 개념) 사용" if ext else ""),
                         "대표업종(소재/부품/장비)": t.get("대표업종", ""), "대표업종근거(반도체 관련 매출 비중과 출처)": ""})
        res["complete_3y"] += yrs == 3
    if rows:
        with open(OUT / "esef_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(json.dumps({**res, "rows": len(rows), **log}, ensure_ascii=False))


if __name__ == "__main__": main()
