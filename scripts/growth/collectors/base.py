"""수집기 공통 기반. HTTP 호출은 주입 가능한 함수(http_get)로 분리해 시험에서 네트워크를 쓰지 않는다.
접근 제한(403·429)이 나오면 즉시 중단하고 기록만 한다(재시도·우회 금지)."""
import datetime as dt
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

FIN_KEYS = ("entity_id", "fiscal_year", "period_start", "period_end", "currency", "unit_multiplier", "revenue_local", "op_income_local",
            "scope", "source_url", "source_ref", "official_name", "confidence")


def default_http_get(url, headers=None, timeout=30):
    """(status, body_bytes). 403·429 등 HTTP 오류도 예외 없이 상태 코드로 돌려준다. 네트워크 오류는 (None, b'')."""
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:  # noqa: BLE001  접속 불가(프록시 거부·DNS 등)는 상태 없음으로 기록
        return None, b""


def make_row(entity_id, fiscal_year, start, end, currency, revenue, op_income, scope, url, ref, official_name, confidence):
    """FinRow(ingest_overseas_csv.py 출력과 같은 키). 금액은 통화 단위(배율 1)."""
    return {"entity_id": entity_id, "fiscal_year": fiscal_year, "period_start": start.isoformat() if hasattr(start, "isoformat") else start,
            "period_end": end.isoformat() if hasattr(end, "isoformat") else end, "currency": currency, "unit_multiplier": 1,
            "revenue_local": revenue, "op_income_local": op_income, "scope": scope, "source_url": url, "source_ref": ref,
            "official_name": official_name, "confidence": confidence}


class Collector:
    country = ""
    source = ""
    requires_auth = False
    probe_url = ""
    CAPABILITY = {"implemented": False, "live_verified": False, "fixture_tested": False, "notes": ""}

    def __init__(self, http_get=None):
        self.http_get = http_get or default_http_get

    def headers(self):
        return {"User-Agent": os.environ.get("GROWTH_UA", "growth-probe"), "Accept": "*/*"}

    def probe(self):
        """공식 소스에 정중한 GET 한 번. 403·429 는 즉시 기록하고 끝낸다(재시도·우회 없음)."""
        u = urlparse(self.probe_url); status, err = None, ""
        status, _ = self.http_get(self.probe_url, headers=self.headers(), timeout=20)
        if status is None: err = "접속 불가(네트워크·프록시)"
        elif status in (403, 429): err = f"접근 제한 {status} — 중단(우회하지 않음)"
        elif status in (401,): err = "인증 필요"
        elif status >= 400: err = f"HTTP 오류 {status}"
        auth = True if status == 401 else (None if status is None else (self.requires_auth or False))
        return {"country": self.country, "source": self.source, "endpoint": u.netloc + u.path, "http_status": status,
                "reachable": bool(status and status < 400), "auth_required": self.requires_auth if self.requires_auth else auth, "error": err,
                "checked_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "capability": dict(self.CAPABILITY)}

    def collect(self, entity_ref, years=(2023, 2024, 2025)):
        return []
