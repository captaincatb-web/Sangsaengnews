"""유럽 ESEF 공시 모음(filings.xbrl.org) 구조 점검: 이름으로 법인·공시 조회 → 공시 속성 키와 xbrl-json 의 매출·영업이익 개념/기간/통화를 요약 출력(공개 자료, 소량)."""
import json, sys, time, urllib.parse, urllib.request, urllib.error
B = "https://filings.xbrl.org"
def get(path):
    time.sleep(0.5)
    try:
        with urllib.request.urlopen(urllib.request.Request(B + path, headers={"User-Agent": "growth-probe"}), timeout=90) as r: return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, path[:90]);
        if e.code in (403, 429): sys.exit("[ABORT]")
        return None
for nm in ("ASML", "BE Semiconductor"):
    f = urllib.parse.quote(json.dumps([{"name": "entity.name", "op": "ilike", "val": f"%{nm}%"}]))
    j = get(f"/api/filings?filter={f}&include=entity&sort=-period_end&page%5Bsize%5D=6")
    if not j: continue
    print(nm, "filings:", len(j.get("data", [])))
    for d in j.get("data", [])[:6]:
        a = d["attributes"]; print({k: a[k] for k in a if k in ("period_end", "country", "date_added", "fxo_id", "json_url", "report_url", "package_url")})
    if j.get("data"):
        a = j["data"][0]["attributes"]; u = a.get("json_url")
        if u:
            x = get(u if u.startswith("/") else urllib.parse.urlparse(u).path)
            facts = (x or {}).get("facts", {}); print("facts", len(facts))
            hit = 0
            for fid, v in facts.items():
                c = v["dimensions"]["concept"]
                if c.split(":")[-1] in ("Revenue", "RevenueFromContractsWithCustomers", "OperatingIncomeLoss", "ProfitLossFromOperatingActivities", "OperatingProfitLoss", "NetSales") and len(v["dimensions"]) <= 4 and hit < 10:
                    hit += 1; print(c, {k: v["dimensions"][k] for k in v["dimensions"] if k != "concept"}, v.get("value"))
