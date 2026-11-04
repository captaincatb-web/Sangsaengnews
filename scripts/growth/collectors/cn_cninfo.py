"""중국(CNINFO·SSE·SZSE) 수집기: 접근 확인(probe)과 공시 목록 파서만. 재무 수치 수집(collect)은 구현하지 않았다(미구현 → 빈 목록)."""
import json
from .base import Collector


def parse_announcements(payload):
    """CNINFO 공시 목록 JSON({'announcements': [...]})에서 연차보고서 후보(제목에 '年度报告' 포함, '摘要' 제외)만 [(제목, adjunctUrl)]로."""
    out = []
    for a in (payload or {}).get("announcements") or []:
        t = a.get("announcementTitle", "")
        if "年度报告" in t and "摘要" not in t: out.append((t, a.get("adjunctUrl", "")))
    return out


class CnCninfo(Collector):
    country = "CN"
    source = "CNINFO / SSE / SZSE"
    requires_auth = False
    probe_url = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
    CAPABILITY = {"implemented": False, "live_verified": False, "fixture_tested": True,
                  "notes": "공시 목록 파서만(fixture 시험). 재무 수집은 미구현: collect() 는 빈 목록을 돌려준다."}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        return []  # 미구현 — 재무표 파싱(PDF/XBRL)은 별도 작업 필요
