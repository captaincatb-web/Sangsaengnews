"""국가별 수집기의 공식 소스 접근 가능 여부를 한 번씩 확인해 $GROWTH_PRIVATE_DIR/collector_status.json 에 기록한다(정중한 GET 1회, 403·429 는 즉시 중단·기록, 우회 없음).
출력은 건수와 소스별 reachable/auth_required/http_status 뿐이며 키·토큰은 출력하지 않는다. 모든 소스가 막혀 있어도 종료 코드 0."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from collectors import ALL  # noqa: E402


def run(http_get=None):
    out = []
    for cls in ALL:
        c = cls(http_get=http_get); r = c.probe()
        if c.requires_auth and not os.environ.get("EDINET_API_KEY") and cls.__name__ == "JpEdinet": r["note"] = "인증키 없이 접근 확인만 수행"
        out.append(r)
    return out


def main():
    res = run(); d = os.environ.get("GROWTH_PRIVATE_DIR")
    if d:
        Path(d).mkdir(parents=True, exist_ok=True); (Path(d) / "collector_status.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"sources": len(res), "reachable": sum(1 for r in res if r["reachable"])}, ensure_ascii=False))
    for r in res: print(f"{r['country']} {r['source']}: reachable={r['reachable']} auth_required={r['auth_required']} http_status={r['http_status']}")
    return 0


if __name__ == "__main__": sys.exit(main())
