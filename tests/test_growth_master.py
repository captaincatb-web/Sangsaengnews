"""성장 비교 원본 처리 시험: 합성 엑셀(실제 데이터 없음)로 행 수·분류·빈칸 보존·이름 오류 정제·등록번호 처리를 확인한다."""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "growth"))
import common as G  # noqa: E402
import openpyxl  # noqa: E402

HEAD = G.COLS
ROWS = [  # 대구분, 상장, 사업자, 법인, Local, Eng, d1~d5  (모두 가짜)
    ["국내", "코스닥 등록", 1234567890, 1111110000001, "주식회사 가나다", "GANADA Co., Ltd.", "설비", "전공정", "FAB설비", "Main 설비", "CVD 설비"],
    ["국내", "코스피 등록", "0234567891", 1111110000002, "(주)라마바", "RAMABA Tech국내logy", "원자재", "전공정", "Chemical", None, "TEOS"],
    ["해외", None, None, None, "Example Corp", "Example Corp", "인프라", "공통", "클린룸", 0, "미기재"],
    ["해외", None, None, None, "EXAMPLE CORP.", "Example Corp", "부품", "후공정", "TEST", "SOCKET", "소켓"],
    ["해외", None, None, None, "In국내vation Inc.", "In국내vation Inc.", "원자재", "전공정", "Gas", "", "특수가스(국내)"],
]
def make(path, rows=ROWS, extra_blank=0):
    wb = openpyxl.Workbook(); ws = wb.active; ws.append(HEAD)
    for r in rows: ws.append(r)
    for _ in range(extra_blank): ws.append([None] * 11)
    wb.save(path)
class T(unittest.TestCase):
    def setUp(self): self.d = tempfile.mkdtemp(); self.p = os.path.join(self.d, "m.xlsx"); make(self.p)
    def test_rows_and_counts(self):
        head, rows, blank = G.load_rows(self.p); rep = G.diagnose(rows, blank)
        self.assertEqual(head, HEAD); self.assertEqual(rep["data_rows"], 5); self.assertEqual(rep["region"], {"국내": 2, "해외": 3})
        self.assertEqual(rep["d1"], {"설비": 1, "원자재": 2, "인프라": 1, "부품": 1})
    def test_blank_rows_not_counted_but_reported(self):
        make(self.p, extra_blank=3); _, rows, blank = G.load_rows(self.p); self.assertEqual((len(rows), blank), (5, 3))
    def test_blank_zero_and_not_recorded_are_distinct(self):
        _, rows, _ = G.load_rows(self.p); rep = G.diagnose(rows)
        self.assertEqual((rep["d4_blank"], rep["d4_zero"], rep["d5_not_recorded"]), (2, 1, 1))  # 빈 셀 2 / '0' 1 / 미기재 1
        self.assertIsNone(rows[1]["d4"]); self.assertEqual(rows[2]["d4"], "0"); self.assertIsNone(rows[4]["d4"])  # 엑셀은 빈 문자열을 빈 셀로 저장하므로 둘 다 None. 0·미기재와는 구분되어 보존
    def test_ids_are_strings_and_never_repaired(self):
        _, rows, _ = G.load_rows(self.p); self.assertEqual(rows[0]["biz_no"], "1234567890"); self.assertEqual(rows[1]["biz_no"], "0234567891")  # 문자열은 앞자리 0 보존
        self.assertTrue(all(isinstance(r["corp_no"], (str, type(None))) for r in rows))
    def test_chart_category_mapping_keeps_source(self):
        self.assertEqual([G.CHART_CAT[x] for x in ("원자재", "부품", "설비", "인프라")], ["소재", "부품", "장비", "장비"])
        _, rows, _ = G.load_rows(self.p); self.assertEqual(rows[2]["d1"], "인프라")  # 원본값은 그대로
    def test_name_fix_cases(self):
        for bad, good in [("Tech국내logy", "Technology"), ("TECH국내LOGY", "TECHNOLOGY"), ("In국내vation", "Innovation"), ("Ca국내n", "Canon"), ("국내va", "Nova"), ("LEE국내", "LEENO"), ("SOLE국내ID", "SOLENOID"), ("특수가스(국내)", "특수가스(NO)")]:
            self.assertEqual(G.fix_no(bad)[0], good, bad)
        self.assertEqual(G.fix_no("Samsung")[1], 0)
    def test_name_key_groups_same_name_but_does_not_merge_different(self):
        self.assertEqual(G.name_key("Example Corp"), G.name_key("EXAMPLE CORP."))
        self.assertNotEqual(G.name_key("Lam Research Corporation"), G.name_key("Lam Research Korea Co., Ltd."))
    def test_cli_refuses_repo_private_dir_and_writes_outside(self):
        env = {**os.environ, "GROWTH_PRIVATE_DIR": str(ROOT / "tmp_private")}
        r = subprocess.run([sys.executable, str(ROOT / "scripts/growth/validate_master.py"), self.p], env=env, capture_output=True, text=True); self.assertNotEqual(r.returncode, 0)
        out = os.path.join(self.d, "priv"); r = subprocess.run([sys.executable, str(ROOT / "scripts/growth/validate_master.py"), self.p], env={**os.environ, "GROWTH_PRIVATE_DIR": out}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertTrue(os.path.exists(os.path.join(out, "master_rows.csv")))
        self.assertNotIn("GANADA", r.stdout)  # 표준 출력에는 기업명이 없다
if __name__ == "__main__": unittest.main(verbosity=2)
