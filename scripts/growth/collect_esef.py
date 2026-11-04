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


def name_key(s): return re.sub(r"[^0-9a-z가-힣]+", "", SUF.sub(" ", (s or "").lower().replace(".", "")))


def get(path):
    time.sleep(0.5); log["calls"] += 1
    try:
        with urllib.request.urlopen(urllib.request.Request(B + path, headers={"User-Agent": "growth-esef"}), timeout=90) as r: return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (403, 429): raise SystemExit(f"[ABORT] ESEF {e.code}: 중단")
        return None


def filings(name):
    f = urllib.parse.quote(json.dumps([{"name": "entity.name", "op": "ilike", "val": "%" + name.split()[0] + "%"}]))
    j = get(f"/api/filings?filter={f}&include=entity&sort=-period_end&page%5Bsize%5D=40")
    if not j: return []
    ents = {e["id"]: e["attributes"].get("name", "") for e in j.get("included", []) if e.get("type") == "entity"}
    out = []
    for d in j.get("data", []):
        eid = (d.get("relationships", {}).get("entity", {}).get("data") or {}).get("id")
        out.append((ents.get(eid, ""), d["attributes"]))
    return out


def facts(url):
    j = get(url) or {}; best = {}
    for v in (j.get("facts") or {}).values():
        d = v.get("dimensions", {}); c = d.get("concept")
        if c not in REV + OPI or set(d) - {"concept", "entity", "period", "unit"} or "/" not in d.get("period", ""): continue
        s, e = [dt.date.fromisoformat(x[:10]) for x in d["period"].split("/")]; e -= dt.timedelta(days=1)
        if not 350 <= (e - s).days + 1 <= 380: continue
        try: val = float(v.get("value"))
        except (TypeError, ValueError): continue
        best.setdefault((c, e), (val, s, e, d.get("unit", "").replace("iso4217:", "")))
    return best


def main():
    tg = list(csv.DictReader(open(OUT / "eu_targets.csv", encoding="utf-8-sig"))); rows = []; res = {"targets": len(tg), "matched": 0, "review": 0, "complete_3y": 0}
    for t in tg:
        fl = [(n, a) for n, a in filings(t["공식법인명"]) if name_key(n) == name_key(t["공식법인명"])]
        if not fl: res["review"] += 1; continue
        res["matched"] += 1; got = {}
        for n, a in sorted(fl, key=lambda x: x[1]["period_end"], reverse=True)[:4]:
            fx = facts(a["json_url"])
            for (c, e), (val, s, _, cur) in fx.items():
                got.setdefault((c in REV, e.year), (val, s, e, cur, a))
        yrs = 0
        for y in (2023, 2024, 2025):
            r = next((got[(True, y)] for _ in [0] if (True, y) in got), None); o = got.get((False, y))
            if not (r and o) or r[1:4] != o[1:4]: continue
            yrs += 1; a = r[4]
            rows.append({"목록표기": t["목록표기"], "공식법인명": t["공식법인명"], "상장여부": "상장", "거래소": t["거래소"], "티커": t["티커"], "결산월": str(r[2].month).zfill(2), "회계연도": y,
                         "기간시작": r[1].isoformat(), "기간종료": r[2].isoformat(), "통화": r[3], "금액단위": "1", "매출": int(r[0]), "영업이익": int(o[0]), "연결/개별": "연결",
                         "출처URL": B + a.get("report_url", a["json_url"]), "쪽/표위치": "ESEF xbrl-json ifrs-full 매출·영업이익", "확신도(높음/중간/낮음)": "높음", "비고": "ESEF 공시 모음 자동 수집",
                         "대표업종(소재/부품/장비)": t.get("대표업종", ""), "대표업종근거(반도체 관련 매출 비중과 출처)": ""})
        res["complete_3y"] += yrs == 3
    if rows:
        with open(OUT / "esef_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(json.dumps({**res, "rows": len(rows), **log}, ensure_ascii=False))


if __name__ == "__main__": main()
