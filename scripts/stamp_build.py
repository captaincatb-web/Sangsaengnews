"""배포 산출물(site/)에 빌드 정보를 찍는다. 소스 파일은 건드리지 않고 배포 직전 빌드 작업 안에서만 실행한다.
1) data/build.json: 커밋 SHA·빌드 시각 — 검증 작업이 '테스트한 아티팩트 = 이 커밋에서 만든 것'인지 확인한다.
2) 모든 HTML 의 로컬 .js/.css 주소에 같은 ?v=<빌드> 를 붙여, 데이터가 갱신될 때 브라우저가 이전 파일을 쓰지 않게 한다(버전 불일치 제거).
사용: python scripts/stamp_build.py <커밋 SHA>"""
import datetime as dt, json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent / "site"; sha = (sys.argv[1] if len(sys.argv) > 1 else "local")[:40]
now = dt.datetime.now(dt.timezone.utc); ver = sha[:7] + now.strftime("%m%d%H%M")
(ROOT / "data").mkdir(exist_ok=True)
(ROOT / "data" / "build.json").write_text(json.dumps({"sha": sha, "version": ver, "builtAt": now.strftime("%Y-%m-%dT%H:%M:%SZ")}, ensure_ascii=False), encoding="utf-8")
pat = re.compile(r'((?:src|href)=")((?!https?:|//|data:)[^"?#]+\.(?:js|css))(?:\?v=[^"#]*)?(")')
n = 0
for p in ROOT.glob("*.html"):
    s = p.read_text(encoding="utf-8"); t, k = pat.subn(lambda m: f"{m.group(1)}{m.group(2)}?v={ver}{m.group(3)}", s)
    if t != s: p.write_text(t, encoding="utf-8"); n += k
print(f"[stamp] version {ver} · 주소 {n}곳 갱신")
