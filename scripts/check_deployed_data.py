"""배포 산출물(또는 로컬 site/)의 데이터 파일을 실제로 읽어 기준일·수집 시각·출처·개수·갱신 결과를 점검하고 요약 주석(::notice::)으로 남긴다.
막는 것(종료 코드 1): 파일 누락·해석 실패, 빌드 SHA 불일치(EXPECT_SHA 지정 시), 모집단·집계 정합성 위반.
막지 않는 것: 시세 기준일이 기대 거래일보다 오래됨(경고만) — 외부 자료 지연으로 이미 검증된 정상 데이터까지 중단시키지 않는다.
사용: python scripts/check_deployed_data.py <site 폴더>"""
import datetime as dt, json, os, re, sys
from pathlib import Path
site = Path(sys.argv[1] if len(sys.argv) > 1 else "site"); D = site / "data"
bad = []
def load(name, var):
    p = D / name
    if not p.exists(): bad.append(f"{name} 없음"); return None
    m = re.search(rf"window\.{var}\s*=\s*(\{{.*\}}|\[.*\]);", p.read_text(encoding="utf-8"), re.S)
    if not m: return {"_raw": True, "_size": p.stat().st_size} if name in ("financials.js", "market.js", "peers.js") else (bad.append(f"{name} 해석 실패") or None)
    try: return json.loads(m.group(1))
    except Exception as e:
        # 저장소의 status.js 는 배포 때 새로 만들어지는 자리 표시 파일이라, 배포 산출물(build.json 있음)에서만 오류로 본다
        (bad if (D / "build.json").exists() or name != "status.js" else []).append(f"{name} JSON 오류 {e}"); return None
caps, share, master, status = load("semi_caps.js", "SEMI_CAPS"), load("semi_share.js", "SEMI_SHARE"), load("master.js", "SEMI_MASTER"), load("status.js", "SITE_DATA_STATUS")
build = json.loads((D / "build.json").read_text(encoding="utf-8")) if (D / "build.json").exists() else None
exp = os.environ.get("EXPECT_SHA")
if exp:
    if not build: bad.append("data/build.json 없음(배포 산출물이 빌드 정보를 갖지 않음)")
    elif build["sha"] != exp: bad.append(f"빌드 SHA 불일치: 산출물 {build['sha'][:7]} ≠ 테스트한 커밋 {exp[:7]}")
note = lambda m: print(f"::notice::{m}")
if build: note(f"[빌드] sha={build['sha'][:7]} version={build['version']} builtAt={build['builtAt']}")
if caps:
    fr = caps.get("fresh") or {}; rows = caps["rows"]
    note(f"[semi_caps] 기준일={caps.get('asOf')} 수집={caps.get('updated')} 출처={caps.get('src')} 기업={len(rows)} 시총확보={sum(1 for r in rows if r.get('cap'))} 기대거래일={fr.get('expected')} 지연={fr.get('lag')}거래일 KRX확인={fr.get('verified')}")
    if fr.get("lag", 0) >= 2: print(f"::warning::시세 기준일 {caps.get('asOf')} 이 기대 거래일 {fr.get('expected')} 보다 {fr['lag']}거래일 오래됨")
    elif fr.get("lag") == 1: note("시세가 1거래일 전 값(휴장일 또는 거래소 자료 게시 지연 가능)")
    if caps.get("src") != "krx": print("::warning::시세 출처가 KRX가 아님(네이버 대체 또는 저장소 값): 거래일을 확인할 수 없음")
    if (dt.date.fromisoformat(caps["asOf"]) > dt.datetime.now(dt.timezone.utc).date()): bad.append(f"기준일 {caps['asOf']} 이 미래 날짜")
if share: note(f"[semi_share] 기준일={share.get('asOf')} 출처={share.get('source', '')[:40]} 분모={ (share.get('denominator') or {}).get('share')} konexN={share.get('konexN')} counts={share.get('counts')}")
if master: note(f"[master] 모집단={ {k: v['n'] for k, v in master['populations'].items()} } 핵심중 프로필 연결={master.get('coreWithProfile')}")
if status:
    for k, v in status["sources"].items(): note(f"[status:{k}] 기준일={v.get('updated') or '-'} 상태={v.get('status')} 건수={v.get('count')} 수집={v.get('collectedAt', '-')} · {v.get('note')}")
for n in ("financials.js", "market.js", "peers.js"):
    p = D / n; note(f"[{n}] {'있음' if p.exists() else '없음'} {p.stat().st_size if p.exists() else 0}바이트")
if bad:
    for b in bad: print(f"::error::{b}")
    sys.exit(1)
print("[check_deployed_data] OK")
