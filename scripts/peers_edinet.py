"""EDINET v2 일본 상장사 연간 손익 수집 파일럿 (공식 공시, 수동 실행).

수집: 날짜별 공시목록(type=2) -> 일본 기업/유가증권보고서(docType=120)
      -> XBRL-to-CSV ZIP(type=5) -> 연결 당기 매출/영업이익만 추출
주의: 2023~2025 FY를 한 번에 추정하지 않는다. 보고서 periodStart/End를 보존한다.
출력 CSV/JSON은 검증용 아티팩트이며 기존 site/data/peers.js는 수정하지 않는다.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path

import requests

BASE_URL = "https://api.edinet-fsa.go.jp/api/v2"
MASTER = Path(__file__).resolve().parent / "peers_master.csv"
FIELDS = [
    "id", "company", "ticker", "sec_code", "edinet_code", "doc_id",
    "submitted_at", "period_start", "period_end", "fiscal_start_year",
    "scope", "currency", "revenue_jpy", "operating_income_jpy",
    "revenue_element", "operating_element", "source_system", "status",
]
# 표준 텍소노미 요소만 자동 인정한다. 회사별 커스텀 태그는 추정하지 않고 누락 처리.
REVENUE = (
    "NetSales", "Revenue", "SalesRevenue", "RevenueFromContractsWithCustomers",
    "NetSalesSummaryOfBusinessResults", "RevenueSummaryOfBusinessResults",
    "RevenueIFRSSummaryOfBusinessResults", "OperatingRevenueSummaryOfBusinessResults",
)
OPERATING = (
    "OperatingIncome", "OperatingProfitLossIFRS", "OperatingProfitLoss",
    "OperatingIncomeLoss", "OperatingProfit",
    "OperatingIncomeSummaryOfBusinessResults",
    "OperatingProfitLossIFRSSummaryOfBusinessResults",
)


def master_japan(path: Path = MASTER) -> dict[str, dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {row["ticker"].split(".")[0]: row for row in csv.DictReader(f)
                if row["ctry"] == "JP" and row.get("ticker")}


def is_target_report(doc: dict, targets: dict) -> bool:
    code = re.sub(r"\D", "", str(doc.get("secCode") or ""))
    # EDINET 증권코드는 5자리(일반적인 4자리 시장 코드 + 후행 0).
    ticker = code[:4] if len(code) == 5 and code.endswith("0") else code
    return (
        ticker in targets
        and str(doc.get("docTypeCode")) == "120"
        and str(doc.get("csvFlag")) == "1"
        and str(doc.get("legalStatus", "1")) in ("1", "2")
        and str(doc.get("withdrawalStatus", "0")) in ("0", "", "None")
    )


def ticker_for_doc(doc: dict) -> str:
    code = re.sub(r"\D", "", str(doc.get("secCode") or ""))
    return code[:4] if len(code) == 5 and code.endswith("0") else code


class Edinet:
    def __init__(self, api_key: str, interval: float = 3.0):
        self.key = api_key
        self.interval = max(0.0, interval)
        self.session = requests.Session()
        self.last_call = 0.0

    def get(self, endpoint: str, params: dict) -> requests.Response:
        # 요청 URL에 키가 포함되므로 응답/예외 문자열을 그대로 기록하지 않는다.
        for attempt in range(3):
            delay = self.interval - (time.monotonic() - self.last_call)
            if delay > 0:
                time.sleep(delay)
            try:
                response = self.session.get(
                    f"{BASE_URL}/{endpoint}",
                    params={**params, "Subscription-Key": self.key},
                    timeout=(15, 90),
                )
            except requests.RequestException:
                if attempt == 2:
                    raise RuntimeError("EDINET 네트워크 오류(키·URL 비공개)") from None
                continue
            finally:
                self.last_call = time.monotonic()
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            if response.status_code != 200:
                raise RuntimeError(f"EDINET HTTP {response.status_code} (인증·권한·호출 제한 확인)")
            return response
        raise RuntimeError("EDINET 재시도 초과")

    def documents_on(self, day: date) -> list[dict]:
        r = self.get("documents.json", {"date": day.isoformat(), "type": 2})
        try:
            data = r.json()
        except ValueError:
            raise RuntimeError("EDINET 서류목록 JSON 해석 실패") from None
        metadata = data.get("metadata") or {}
        status = str(metadata.get("status", "200"))
        if status != "200":
            raise RuntimeError(f"EDINET 서류목록 상태 {status}")
        if not isinstance(data.get("results"), list):
            raise RuntimeError("EDINET 서류목록 results 누락")
        return data["results"]

    def csv_zip(self, doc_id: str) -> bytes:
        if not re.fullmatch(r"[A-Za-z0-9]+", doc_id):
            raise ValueError("docID 형식 오류")
        payload = self.get(f"documents/{doc_id}", {"type": 5}).content
        if not payload.startswith(b"PK"):
            raise RuntimeError("EDINET CSV 응답이 ZIP 아님(공시 상태·권한 확인)")
        return payload


def parse_yen(raw: str) -> int | None:
    s = (raw or "").strip().replace(",", "").replace(" ", "")
    if not s or s in ("-", "－", "―", "—", "–"):
        return None
    if s.startswith("△") or s.startswith("▲"):
        s = "-" + s[1:]
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    if not re.fullmatch(r"-?\d+(?:\.0+)?", s):
        return None
    return int(float(s))


def extract_metrics(blob: bytes) -> dict:
    """연결 CurrentYearDuration의 표준 태그만 허용. 우선순위 및 원본 요소 ID 보존."""
    chosen: dict[str, tuple[int, int, str]] = {}
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        filenames = [n for n in archive.namelist()
                     if n.lower().endswith(".csv") and "jpcrp" in n.lower()]
        for filename in sorted(filenames):
            info = archive.getinfo(filename)
            if info.file_size > 35_000_000:  # zip 폭탄·실수 방지
                continue
            with archive.open(filename) as body:
                text = body.read().decode("utf-16")
            rows = csv.DictReader(io.StringIO(text), delimiter="\t")
            if not {"要素ID", "コンテキストID", "値"}.issubset(rows.fieldnames or []):
                continue
            for row in rows:
                context = (row.get("コンテキストID") or "").strip()
                scope = (row.get("連結・個別") or "").strip()
                if context != "CurrentYearDuration" or "個別" in scope:
                    continue
                unit = (row.get("ユニットID") or "").strip()
                if unit and unit.upper() not in ("JPY", "ISO4217:JPY"):
                    continue
                element = (row.get("要素ID") or "").strip()
                suffix = element.split(":")[-1]
                value = parse_yen(row.get("値"))
                if value is None:
                    continue
                for name, tags in (("revenue", REVENUE), ("operating_income", OPERATING)):
                    if suffix in tags:
                        priority = tags.index(suffix)
                        if name not in chosen or priority < chosen[name][0]:
                            chosen[name] = (priority, value, element)
    return {
        "revenue_jpy": chosen.get("revenue", (None, None, None))[1],
        "operating_income_jpy": chosen.get("operating_income", (None, None, None))[1],
        "revenue_element": chosen.get("revenue", (None, None, ""))[2],
        "operating_element": chosen.get("operating_income", (None, None, ""))[2],
    }


def collect(api: Edinet, start: date, end: date, master: dict) -> list[dict]:
    if end < start or (end - start).days > 100 or end > date.today():
        raise ValueError("검색 범위는 과거 날짜 1~101일로 제한합니다")
    found: dict[str, dict] = {}
    day = start
    while day <= end:
        for doc in api.documents_on(day):
            if is_target_report(doc, master) and doc.get("docID"):
                found[doc["docID"]] = doc
        day += timedelta(days=1)
    print(f"[edinet] 서류목록 {start}~{end}: 해당 연차보고서 {len(found)}건")
    outputs = []
    for doc in sorted(found.values(), key=lambda x: (str(x.get("periodEnd")), str(x.get("submitDateTime")))):
        ticker = ticker_for_doc(doc)
        company = master[ticker]
        metrics, status = {}, "ok"
        try:
            metrics = extract_metrics(api.csv_zip(str(doc["docID"])))
            if metrics.get("revenue_jpy") is None or metrics.get("operating_income_jpy") is None:
                status = "partial_unverified"
        except (ValueError, zipfile.BadZipFile, UnicodeError, RuntimeError) as e:
            status = f"error:{e.__class__.__name__}"
        record = {
            "id": company["id"], "company": company["name"], "ticker": company["ticker"],
            "sec_code": doc.get("secCode"), "edinet_code": doc.get("edinetCode"),
            "doc_id": doc["docID"], "submitted_at": doc.get("submitDateTime"),
            "period_start": doc.get("periodStart"), "period_end": doc.get("periodEnd"),
            "fiscal_start_year": str(doc.get("periodStart") or "")[:4],
            "scope": "consolidated_current", "currency": "JPY",
            **metrics, "source_system": "EDINET API v2 XBRL-to-CSV",
            "status": status,
        }
        outputs.append(record)
        print(f"[edinet] {record['company']} {record['doc_id']}: {status}")
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, default=Path("edinet-results"))
    parser.add_argument("--interval", type=float, default=3)
    args = parser.parse_args()
    key = os.environ.get("EDINET_API_KEY")
    if not key:
        print("[edinet] EDINET_API_KEY가 없으므로 수집을 실행하지 않습니다")
        return 2
    targets = master_japan()
    results = collect(Edinet(key, args.interval), args.start, args.end, targets)
    args.out.mkdir(parents=True, exist_ok=True)
    tag = f"{args.start}_{args.end}"
    csv_path = args.out / f"jp_annual_{tag}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(results)
    (args.out / f"jp_annual_{tag}.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[edinet] JP 마스터 {len(targets)}개 / 후보 {len(results)}개 / 완료 {sum(r['status']=='ok' for r in results)}개")
    print("[edinet] 검증용 결과만 생성. 배포 데이터는 변경하지 않음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
