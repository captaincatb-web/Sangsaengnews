"""유럽 국가별 공식 공시·회사 IR 자리표시 수집기: 접근 확인(probe)만. 국가마다 공시 체계가 달라 collect() 는 빈 목록(미구현)."""
from .base import Collector


class EuGeneric(Collector):
    country = "EU"
    source = "국가별 공식 공시·회사 IR(자리표시)"
    requires_auth = False
    probe_url = "https://www.esma.europa.eu/"
    CAPABILITY = {"implemented": False, "live_verified": False, "fixture_tested": True, "notes": "자리표시. 접근 확인만 하고 재무 수집은 미구현(국가별 별도 모듈 필요)."}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        return []
