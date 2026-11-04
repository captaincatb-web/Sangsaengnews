"""법인 판정 CSV(상장 여부·본사/자회사 관계·소부장 적격·대표 업종, 공식 근거 포함)를 검증해 비공개 폴더의 entity_status.csv 로 바꾼다.
입력 열(한글 머리글, 순서 무관): 원본그룹(A/B/C/신규), 목록표기, 공식법인명, 국가, 법인상태, 상장폐지일, 거래소, 티커, 공시식별자(CIK 등), 모회사공식명, 모회사식별자,
  연결재무포함여부(포함/미포함/미확인/해당없음), 소부장판정(포함/제외/보류), 대표업종(소재/부품/장비), 근거URL, 근거위치, 확인일, 확신도, 추가조사필요
법인상태: 상장 본사 / 상장 자회사 / 비상장 독립법인 / 비상장 자회사 / 지점 / 상장폐지 / 미확인
규칙(어기면 행을 거부하고 사유를 집계): ①목록표기 필수 ②법인상태·소부장판정·연결재무포함여부는 허용 값만 ③'미확인'이 아닌 법인상태·'제외'·'포함' 판정은 http 근거URL 필수
  ④상장 본사·상장폐지는 거래소·티커·공시식별자 중 하나 필수, 상장폐지는 상장폐지일(YYYY-MM-DD) 필수 ⑤상장 자회사·비상장 자회사·지점은 모회사공식명 필수 ⑥소부장판정 '포함'은 대표업종 필수
  ⑦같은 목록표기에 서로 다른 공식법인명이 둘 이상이면 법인 식별 충돌로 그 목록표기 전체를 거부(이름이 비슷하다는 이유로 합치지 않음) ⑧조사 CSV에 없는 법인의 상태는 바꾸지 않는다(임의로 상장·비상장 확정 금지).
원본 목록표기는 그대로 보존하고(entity_key = 정규화 이름), 공식법인명은 별도 열에 둔다. '(SEC: …)' 같은 목록표기 뒤 주석은 떼고 연결한다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖> python scripts/growth/ingest_entity_status.py <입력1.csv> [입력2.csv ...]   출력: entity_status.csv, entity_status_issues.json(건수만)"""
import csv, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import name_key  # noqa: E402

STATES = ("상장 본사", "상장 자회사", "비상장 독립법인", "비상장 자회사", "지점", "상장폐지", "미확인")
JUDGE = ("포함", "제외", "보류", "")
CONSOL = ("포함", "미포함", "미확인", "해당없음", "")
CHARTS = ("소재", "부품", "장비", "")
OUT_COLS = ["entity_key", "원본그룹", "목록표기", "공식법인명", "국가", "법인상태", "상장폐지일", "거래소", "티커", "공시식별자", "모회사공식명", "모회사식별자", "연결재무포함여부", "소부장판정", "대표업종", "근거URL", "근거위치", "확인일", "확신도", "추가조사필요"]
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# GPT 조사 파일의 머리글·값 표기를 이 스키마로 옮기는 어댑터(값을 임의로 확정하지 않는 쪽으로만 매핑한다).
HEADER_ALIAS = {"이번검증판정": "법인상태", "공식근거URL": "근거URL", "모회사": "모회사공식명", "검증일": "확인일", "추가조사사항": "추가조사필요", "독립상장본사여부": "_독립상장본사여부", "직전판정": "_직전판정", "2023~2025 재무현황": "_재무현황"}
STATE_MAP = {"상장 본사": "상장 본사", "상장 본사(목록 표기 보완)": "상장 본사", "비상장 자회사": "비상장 자회사", "비상장 자회사/사업": "비상장 자회사", "비상장 그룹회사": "비상장 자회사", "비상장 계열회사": "비상장 자회사",
             "비상장 해외 그룹회사": "비상장 자회사", "비상장 그룹 사업/브랜드": "비상장 자회사", "상장폐지": "상장폐지", "상장폐지/비상장 자회사": "상장폐지", "상장폐지/인수법인": "상장폐지",
             "상장 본사(결산 변경 예외)": "상장 본사", "비상장 합작법인(독립 증권상장 없음)": "비상장 독립법인", "비상장 100% 자회사": "비상장 자회사", "비상장 사업회사(상장 지주사 별도)": "비상장 자회사",
             "비상장 해외 자회사(상장 본사 아님)": "비상장 자회사", "비상장 해외 그룹회사(상장 본사 아님)": "비상장 자회사", "상장폐지(2022 인수 완료)": "상장폐지"}  # 사업부 표기(법인 매핑 검토)·결정 보류 표기는 미확인  # 그 밖의 표기(명칭 보완 필요·정확한 법인 보류·브랜드/유통 채널 등)는 미확인으로 둔다


def normalize_row(r):
    """머리글 별칭·값 표기 정규화. '포함 검토'·'제외 검토'는 확정이 아니므로 판정을 비우거나 보류로 둔다(확정은 '포함'·'제외'로 시작하는 표기만, 포함 검토는 상장 본사에 한해 포함 의견으로 취급하지 않고 보류)."""
    out = {}
    for k, v in r.items():
        k = (k or "").strip(); out[HEADER_ALIAS.get(k, k)] = v
    st = (out.get("법인상태") or "").strip(); gpt = any((k or "").strip() == "이번검증판정" for k in r)
    if st and st not in STATES: out["법인상태"] = STATE_MAP.get(st, "미확인" if gpt else st)  # 표준 스키마의 잘못된 값은 거부(아래 검증), GPT 조사 파일의 자유 표기만 보수적으로 변환
    jd = (out.get("소부장판정") or "").strip()
    if jd and jd not in JUDGE:
        head = jd.split("(")[0].strip(); out["소부장판정"] = head if head in ("제외", "포함") else ("보류" if head in ("보류", "포함 검토", "제외 검토") else "")
    if not out.get("법인상태"): out["법인상태"] = "미확인"
    return out


def clean_listing(s):
    return re.sub(r"\s*\((SEC|참고|note)[^)]*\)\s*$", "", (s or "").strip(), flags=re.I)


def convert(rows):
    rows = [normalize_row(r) for r in rows]
    ok, rej = [], Counter()
    by_name = defaultdict(set)
    for r in rows:
        nm = clean_listing(r.get("목록표기")); off = (r.get("공식법인명") or "").strip()
        if nm and off: by_name[name_key(nm)].add(name_key(off))
    conflict = {k for k, v in by_name.items() if len(v) > 1}
    for r in rows:
        g = lambda k: (r.get(k) or "").strip()
        nm = clean_listing(g("목록표기"))
        if not nm: rej["목록표기 없음"] += 1; continue
        key = name_key(nm)
        if key in conflict: rej["법인 식별 충돌(같은 목록표기에 공식법인명 여럿)"] += 1; continue
        st, jd, cs, ch, url = g("법인상태") or "미확인", g("소부장판정"), g("연결재무포함여부"), g("대표업종"), g("근거URL")
        if st not in STATES: rej["법인상태 값 오류"] += 1; continue
        if jd not in JUDGE: rej["소부장판정 값 오류"] += 1; continue
        if cs not in CONSOL: rej["연결재무포함여부 값 오류"] += 1; continue
        if ch not in CHARTS: rej["대표업종 값 오류"] += 1; continue
        decisive = st != "미확인" or jd in ("포함", "제외")
        if decisive and not url.startswith("http"): rej["근거URL 없음(확정 판정)"] += 1; continue
        if st in ("상장 본사", "상장폐지") and not (g("거래소") or g("티커") or g("공시식별자")): rej["상장 식별자 없음(거래소·티커·식별자)"] += 1; continue
        if st == "상장폐지" and not DATE.match(g("상장폐지일")): rej["상장폐지일 없음/형식 오류"] += 1; continue
        if st in ("상장 자회사", "비상장 자회사", "지점") and not g("모회사공식명"): rej["모회사공식명 없음"] += 1; continue
        if jd == "포함" and not ch: rej["포함 판정에 대표업종 없음"] += 1; continue
        ok.append({"entity_key": key, "원본그룹": g("원본그룹"), "목록표기": nm, "공식법인명": g("공식법인명"), "국가": g("국가"), "법인상태": st, "상장폐지일": g("상장폐지일"), "거래소": g("거래소"), "티커": g("티커"), "공시식별자": g("공시식별자"),
                   "모회사공식명": g("모회사공식명"), "모회사식별자": g("모회사식별자"), "연결재무포함여부": cs, "소부장판정": jd, "대표업종": ch, "근거URL": url, "근거위치": g("근거위치"), "확인일": g("확인일"), "확신도": next((v for k, v in r.items() if k and k.startswith("확신도")), "").strip(), "추가조사필요": g("추가조사필요")})
    # 같은 entity_key 가 여러 행이면 마지막(가장 늦은 확인일) 행을 쓴다
    latest = {}
    for x in ok:
        if x["entity_key"] not in latest or x["확인일"] >= latest[x["entity_key"]]["확인일"]: latest[x["entity_key"]] = x
    return list(latest.values()), rej


def main():
    priv = os.environ.get("GROWTH_PRIVATE_DIR")
    if not priv or len(sys.argv) < 2: sys.exit("GROWTH_PRIVATE_DIR 와 입력 CSV 경로(여러 개 가능, 뒤 파일이 같은 확인일에서 우선)가 필요합니다")
    rows = [r for path in sys.argv[1:] for r in csv.DictReader(open(path, encoding="utf-8-sig"))]
    ok, rej = convert(rows)
    with open(Path(priv) / "entity_status.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS); w.writeheader(); w.writerows(ok)
    rep = {"input_rows": len(rows), "accepted_entities": len(ok), "by_state": dict(Counter(x["법인상태"] for x in ok)), "by_judgement": dict(Counter(x["소부장판정"] or "미판정" for x in ok)), "rejected_reasons": dict(rej)}
    (Path(priv) / "entity_status_issues.json").write_text(json.dumps(rep, ensure_ascii=False), encoding="utf-8"); print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__": main()
