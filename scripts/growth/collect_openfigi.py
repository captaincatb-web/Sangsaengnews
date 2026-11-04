"""엔터티 판정표의 티커를 OpenFIGI 매핑 API로 조회해 식별자(FIGI)·등록명·거래소 코드를 비공개 폴더에 기록한다(동일 법인 확인용 참고 자료).
- 입력: <GROWTH_PRIVATE_DIR>/entity_status.csv(티커가 있는 행). 키는 환경변수 OPENFIGI_API_KEY, 헤더로만 보낸다.
- 이름이 비슷하다는 이유로 법인을 합치지 않는다. 결과는 후보 기록일 뿐이며 판정은 사람이 확인한다. 403·429 는 기록 후 즉시 중단. 로그에는 건수만 출력."""
import csv, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path
KEY = os.environ.get("OPENFIGI_API_KEY", ""); OUT = Path(os.environ.get("GROWTH_PRIVATE_DIR", "")).resolve()
URL = "https://api.openfigi.com/v3/mapping"


def post(jobs):
    req = urllib.request.Request(URL, data=json.dumps(jobs).encode(), headers={"Content-Type": "application/json", "X-OPENFIGI-APIKEY": KEY, "User-Agent": "growth-openfigi"})
    time.sleep(1.0)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429): raise SystemExit(f"[ABORT] OpenFIGI {e.code}: 중단")
        return None


def main():
    if not KEY or not os.environ.get("GROWTH_PRIVATE_DIR"): sys.exit("OPENFIGI_API_KEY 와 GROWTH_PRIVATE_DIR 가 필요합니다")
    rows = [r for r in csv.DictReader(open(OUT / "entity_status.csv", encoding="utf-8-sig")) if (r.get("티커") or "").strip()]
    out = []; found = 0; calls = 0
    for i in range(0, len(rows), 50):
        ch = rows[i:i + 50]; res = post([{"idType": "TICKER", "idValue": r["티커"].strip(), "marketSecDes": "Equity"} for r in ch]); calls += 1
        for r, x in zip(ch, res or [{}] * len(ch)):
            d = x.get("data") or []; found += bool(d)
            out.append({"목록표기": r["목록표기"], "공식법인명": r["공식법인명"], "티커": r["티커"], "후보수": len(d),
                        "등록명(상위3)": " | ".join(sorted({c.get("name", "") for c in d})[:3]), "거래소코드(상위8)": " ".join(sorted({c.get("exchCode", "") for c in d})[:8]),
                        "compositeFIGI": next((c.get("compositeFIGI", "") for c in d if c.get("compositeFIGI")), "")})
    if out:
        with open(OUT / "figi_map.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    print(json.dumps({"tickers": len(rows), "with_candidates": found, "calls": calls}, ensure_ascii=False))


if __name__ == "__main__": main()
