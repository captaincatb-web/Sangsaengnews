"""원본 협력사 명단(엑셀)을 읽어 진단하고, 정제 열을 붙인 비공개 작업 파일을 만든다.
사용: GROWTH_PRIVATE_DIR=<저장소 밖 폴더> python scripts/growth/validate_master.py <원본.xlsx>
- 공개 저장소에는 아무것도 쓰지 않는다. 출력 폴더가 저장소 안이면 중단한다.
- 표준 출력에는 집계 숫자만 낸다(기업명·번호 없음). 개별 이상 행은 비공개 폴더의 anomalies.csv 에만 저장한다."""
import csv, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CHART_CAT, KEYS, diagnose, fix_no, load_rows, name_key
REPO = Path(__file__).resolve().parent.parent.parent
def main():
    src = Path(sys.argv[1]); out = os.environ.get("GROWTH_PRIVATE_DIR")
    if not out: sys.exit("GROWTH_PRIVATE_DIR(저장소 밖 비공개 폴더)를 지정하세요")
    out = Path(out).resolve()
    if REPO in out.parents or out == REPO: sys.exit("비공개 폴더가 저장소 안에 있습니다. 저장소 밖으로 지정하세요")
    out.mkdir(parents=True, exist_ok=True)
    head, rows, blank = load_rows(src)
    rep = diagnose(rows, blank); rep["header"] = head
    anomalies = []
    for r in rows:
        r["chart_category"] = CHART_CAT.get(r["d1"], "")
        for k in ("name_local", "name_eng", "d5"):
            fixed, n = fix_no(r[k]); r[k + "_norm"] = fixed
            if n: anomalies.append({"row_id": r["row_id"], "field": k, "kind": "국내→no 치환 오류 후보", "original": r[k], "candidate": fixed})
        r["name_key"] = name_key(r["name_eng"]) or name_key(r["name_local"])
        if r["d1"] not in CHART_CAT: anomalies.append({"row_id": r["row_id"], "field": "d1", "kind": "알 수 없는 상세구분1", "original": r["d1"], "candidate": ""})
    cols = ["row_id"] + KEYS + ["chart_category", "name_local_norm", "name_eng_norm", "d5_norm", "name_key"]
    with open(out / "master_rows.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows({k: r.get(k) for k in cols} for r in rows)
    with open(out / "anomalies.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["row_id", "field", "kind", "original", "candidate"]); w.writeheader(); w.writerows(anomalies)
    (out / "diagnosis.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False, indent=1)); print(f"이상 후보 {len(anomalies)}건 · 결과 폴더(비공개) {out}")
if __name__ == "__main__": main()
