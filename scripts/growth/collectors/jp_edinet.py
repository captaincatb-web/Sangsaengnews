"""일본 EDINET API v2 수집기. 구독키(EDINET_API_KEY)가 필요하다(requires_auth=True). 서류 목록(documents.json)과 재무 CSV(type=5) 내려받기는 호출자가
서류관리번호(docID)를 정해 주는 방식으로 쓴다(전 기간 목록 탐색은 호출 수가 커서 이 모듈의 범위 밖).
parse_csv(): 재무 CSV 텍스트(탭 구분, 要素ID·コンテキストID·相対年度·連結・個別·期間・単位·値)에서 매출액·영업이익을 읽는다.
개별(個別)과 연결(連結)은 コンテキストID 의 'NonConsolidatedMember' 여부와 연결・個別 열로 구분하고, 단위 열(百万円·円·千円)을 통화 단위로 환산한다."""
import csv
import datetime as dt
import io
from .base import Collector, make_row

REV_IDS = ("jppfs_cor:NetSales", "jppfs_cor:Revenue", "jppfs_cor:OperatingRevenue1", "jpcrp_cor:NetSalesSummaryOfBusinessResults", "jpigp_cor:RevenueIFRS", "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults")
OPI_IDS = ("jppfs_cor:OperatingIncome", "jpigp_cor:OperatingProfitLossIFRS", "jpcrp_cor:OperatingProfitLossIFRSSummaryOfBusinessResults")
UNIT = {"円": 1, "千円": 1e3, "百万円": 1e6, "億円": 1e8, "JPY": 1}


def _num(v):
    v = (v or "").replace(",", "").strip().replace("△", "-")
    try: return float(v)
    except ValueError: return None


def parse_csv(text, entity_id, official_name, doc_url, doc_ref=""):
    """당기(Current) 연간(Duration) 값만. 반환: [FinRow]. 매출·영업이익이 같은 기간·같은 기준일 때만 영업이익을 쓴다."""
    rd = csv.DictReader(io.StringIO(text), delimiter="\t"); got = {}
    for r in rd:
        ctx = r.get("コンテキストID", ""); eid = r.get("要素ID", "")
        if not ctx.startswith("CurrentYearDuration"): continue
        scope = "개별" if "NonConsolidatedMember" in ctx or (r.get("連結・個別") or "").strip() == "個別" else "연결"
        unit = UNIT.get((r.get("単位") or "").strip())
        v = _num(r.get("値"))
        if unit is None or v is None: continue
        try: s = dt.date.fromisoformat(r["period_start"].strip()) if r.get("period_start") else None
        except ValueError: s = None
        try: e = dt.date.fromisoformat(r["period_end"].strip()) if r.get("period_end") else None
        except ValueError: e = None
        if not (s and e) or not 350 <= (e - s).days <= 380: continue
        key = (scope, s, e)
        if eid in REV_IDS: got.setdefault(key, {}).setdefault("rev", v * unit)
        elif eid in OPI_IDS: got.setdefault(key, {}).setdefault("op", v * unit)
    rows = []
    for (scope, s, e), d in got.items():
        if "rev" not in d: continue
        rows.append(make_row(entity_id, str(e.year), s, e, "JPY", d["rev"], d.get("op", ""), scope, doc_url, doc_ref, official_name, "높음" if "op" in d else "중간"))
    return rows


def prefer_individual(rows):
    """한 회계기간에 개별·연결이 모두 있으면 개별 우선(3개년 기준 통일은 병합 단계에서 다시 검사)."""
    out = {}
    for r in rows:
        k = r["period_end"]
        if k not in out or (r["scope"] == "개별" and out[k]["scope"] != "개별"): out[k] = r
    return list(out.values())


class JpEdinet(Collector):
    country = "JP"
    source = "EDINET API v2"
    requires_auth = True
    probe_url = "https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2025-06-30&type=1"
    CAPABILITY = {"implemented": True, "live_verified": False, "fixture_tested": True,
                  "notes": "재무 CSV 파서만 구현(fixture 시험). 구독키 필요, docID 지정 방식. 실제 접근·수집 미확인."}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        import os
        key = os.environ.get("EDINET_API_KEY", "").strip()
        if not key: return []
        rows = []
        for doc in entity_ref.get("doc_ids", []):  # [{"docID": "...", "ref": "…"}]
            url = f"https://api.edinet-fsa.go.jp/api/v2/documents/{doc['docID']}?type=5&Subscription-Key={key}"
            status, body = self.http_get(url, headers=self.headers(), timeout=60)
            if status != 200 or not body: continue
            rows += parse_csv(body.decode("utf-8-sig", errors="replace"), entity_ref["entity_id"], entity_ref.get("official_name", ""),
                              f"https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?{doc['docID']}", doc.get("ref", ""))
        return [r for r in prefer_individual(rows) if int(r["fiscal_year"]) in years]
