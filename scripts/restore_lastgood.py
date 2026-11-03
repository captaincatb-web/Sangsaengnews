"""시세 갱신이 실패했을 때 '저장소에 커밋된 오래된 값' 대신 '직전에 성공한 값'으로 배포하도록, 캐시에 저장해 둔 마지막 정상 시세 파일을 복원한다.
복원 조건(모두 만족할 때만): 명단(종목코드·구분·시장·분류)이 현재 저장소와 같고, 캐시의 기준일이 저장소 값보다 같거나 최신이며, 두 파일이 모두 있다.
명단이 바뀌었으면(모집단 변경) 가격이 있더라도 복원하지 않는다 — 새 명단이 우선이다.
사용: python scripts/restore_lastgood.py <캐시 폴더> [site/data 폴더]"""
import json, re, shutil, sys
from pathlib import Path
cache = Path(sys.argv[1]); data = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "site" / "data"
load = lambda p: json.loads(re.search(r"=\s*(\{.*\});", p.read_text(encoding="utf-8"), re.S).group(1))
sig = lambda c: sorted((r["c"], r.get("g", "E"), r["m"], r["k"]) for r in c["rows"])
def main():
    if not (cache / "semi_caps.js").exists() or not (cache / "semi_share.js").exists(): print("[lastgood] 저장된 값 없음 — 저장소 값 사용"); return 0
    new, cur = load(cache / "semi_caps.js"), load(data / "semi_caps.js")
    if sig(new) != sig(cur): print("[lastgood] 명단이 달라 복원하지 않음(새 명단 우선)"); return 0
    if (new.get("asOf") or "") < (cur.get("asOf") or ""): print(f"[lastgood] 저장된 값({new.get('asOf')})이 저장소 값({cur.get('asOf')})보다 오래됨 — 복원하지 않음"); return 0
    for n in ("semi_caps.js", "semi_share.js"): shutil.copyfile(cache / n, data / n)
    print(f"[lastgood] 마지막 정상 시세 복원: 기준일 {new.get('asOf')} · 출처 {new.get('src')} · 수집 {new.get('updated')}"); return 0
if __name__ == "__main__": sys.exit(main())
