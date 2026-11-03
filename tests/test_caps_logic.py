"""시세 갱신 로직 시나리오 시험(외부 접속·이슈 생성 없음): 임시 폴더에 스크립트와 데이터를 복사해 고정 시각·가짜 KRX 응답으로 실행한다.
정상·지연(휴장/게시 지연)·오래됨·접속 실패·모집단 오류·기존 값보다 오래된 응답·마지막 정상 값 복원을 확인한다."""
import json, os, re, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import update_semi_caps as U  # noqa: E402
load = lambda p: json.loads(re.search(r"=\s*(\{.*\});", Path(p).read_text(encoding="utf-8"), re.S).group(1))
EP = {"KOSPI": "stk_bydd_trd", "KOSDAQ": "ksq_bydd_trd", "KONEX": "knx_bydd_trd"}


class Pure(unittest.TestCase):
    def test_expected_day(self):
        at = lambda s: U.expected_trading_day(__import__("datetime").datetime.fromisoformat(s).replace(tzinfo=__import__("datetime").timezone.utc))
        self.assertEqual(at("2026-11-02T22:30:00"), "2026-11-02")  # 화 07:30 KST → 월
        self.assertEqual(at("2026-11-02T03:00:00"), "2026-10-30")  # 월 12:00 KST → 금
        self.assertEqual(at("2026-11-07T22:30:00"), "2026-11-06")  # 일 07:30 KST → 금
    def test_lag(self):
        self.assertEqual(U.weekday_lag("2026-10-30", "2026-11-02"), 1)  # 금 → 월: 평일 1일 차이(휴장일일 수 있음)
        self.assertEqual(U.weekday_lag("2026-10-30", "2026-11-03"), 2)
        self.assertEqual(U.weekday_lag("2026-11-02", "2026-11-02"), 0)
        self.assertEqual(U.weekday_lag("2026-11-03", "2026-11-02"), 0)


class Run(unittest.TestCase):
    def setUp(self):
        self.t = Path(tempfile.mkdtemp()); (self.t / "scripts").mkdir(); (self.t / "site" / "data").mkdir(parents=True)
        shutil.copy(ROOT / "scripts" / "update_semi_caps.py", self.t / "scripts"); shutil.copy(ROOT / "scripts" / "restore_lastgood.py", self.t / "scripts")
        for n in ("semi_caps.js", "semi_share.js"): shutil.copy(ROOT / "site" / "data" / n, self.t / "site" / "data" / n)
        self.fx = self.t / "krx"; self.fx.mkdir(); self.caps = load(self.t / "site/data/semi_caps.js"); self.share = load(self.t / "site/data/semi_share.js")
        # 저장소·배포 중인 실제 값의 기준일과 무관하게 시험하도록 임시 사본의 기준일을 아주 오래전으로 되돌린다
        self.caps["asOf"] = "2000-01-01"; self.caps.pop("fresh", None); self.write_caps()
    def write_caps(self):
        (self.t / "site/data/semi_caps.js").write_text("// x\nwindow.SEMI_CAPS = " + json.dumps(self.caps, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    def tearDown(self): shutil.rmtree(self.t, ignore_errors=True)
    def day(self, ymd, drop=0):
        """가짜 KRX 일별매매정보: 명단 종목 + 시장 전체 시가총액을 맞추는 합성 행."""
        rows = {m: [] for m in EP}; tot = self.share["marketTotal"]
        for i, r in enumerate(self.caps["rows"]):
            if i < drop: continue
            rows[r["m"]].append({"ISU_CD": r["c"], "TDD_CLSPRC": "1000", "LIST_SHRS": "1000000", "MKTCAP": "1000000000"})
        for m in ("KOSPI", "KOSDAQ"): rows[m].append({"ISU_CD": "999999", "TDD_CLSPRC": "1", "LIST_SHRS": "1", "MKTCAP": str(int(tot[m] * 1e8))})
        for m, ep in EP.items(): (self.fx / f"{ep}_{ymd}.json").write_text(json.dumps({"OutBlock_1": rows[m]}), encoding="utf-8")
    def run_(self, now, naver=False, asof=None, **env):
        e = {**os.environ, "SEMI_CAPS_NOW": now, "KRX_FIXTURE": str(self.fx), "GITHUB_OUTPUT": str(self.t / "out.txt")}; e.pop("KRX_API_KEY", None)
        if asof: e["SEMI_CAPS_ASOF"] = asof
        e.update(env); r = subprocess.run([sys.executable, str(self.t / "scripts" / "update_semi_caps.py")], env=e, capture_output=True, text=True, cwd=self.t)
        out = dict(l.split("=", 1) for l in (self.t / "out.txt").read_text().splitlines()) if (self.t / "out.txt").exists() else {}
        return r.returncode, r.stdout + r.stderr, out
    def prep(self, d, quarter=True):
        self.day(d)
        if quarter: self.day("20260930"); self.day("20260630")
    def test_fresh(self):
        self.prep("20261102"); rc, log, out = self.run_("2026-11-02T22:30:00")
        self.assertEqual(rc, 0, log); self.assertEqual(out["lag"], "0"); self.assertEqual(load(self.t / "site/data/semi_caps.js")["asOf"], "2026-11-02")
    def test_publish_delay_is_lagging_not_failure(self):
        self.prep("20261030"); rc, log, out = self.run_("2026-11-02T22:30:00")  # 화 아침인데 KRX는 금요일 자료까지만(휴장일이거나 게시 지연)
        self.assertEqual(rc, 4, log); self.assertEqual(out["lag"], "1"); self.assertIn("::notice::", log)
    def test_stale(self):
        self.prep("20261030"); rc, log, out = self.run_("2026-11-03T22:30:00")
        self.assertEqual(rc, 5, log); self.assertEqual(out["lag"], "2"); self.assertIn("::warning::", log)
    def test_weekend_not_failure(self):
        self.prep("20261106"); rc, log, out = self.run_("2026-11-07T22:30:00")  # 일요일 아침, 금요일 종가
        self.assertEqual(rc, 0, log)
    def test_population_error_blocks_write(self):
        self.prep("20261102"); self.day("20261102", drop=40); before = (self.t / "site/data/semi_caps.js").read_text(encoding="utf-8")
        rc, log, out = self.run_("2026-11-02T22:30:00"); self.assertEqual(rc, 1, log); self.assertIn("[ABORT]", log)
        self.assertEqual((self.t / "site/data/semi_caps.js").read_text(encoding="utf-8"), before)  # 파일 불변(이전 값 유지)
    def test_older_than_existing_keeps_existing(self):
        c = self.caps; c["asOf"] = "2026-11-02"; p = self.t / "site/data/semi_caps.js"
        p.write_text("// x\nwindow.SEMI_CAPS = " + json.dumps(c, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8"); before = p.read_text(encoding="utf-8")
        self.prep("20261030"); rc, log, out = self.run_("2026-11-02T22:30:00"); self.assertEqual(rc, 6, log); self.assertIn("[KEEP]", log); self.assertEqual(p.read_text(encoding="utf-8"), before)
        self.assertEqual(out["lag"], "0")  # 기존(11-02)이 기대일과 같으므로 최신
    def test_api_failure_falls_back_without_claiming_freshness(self):
        for f in self.fx.glob("*"): f.unlink()  # KRX 응답 없음
        nv = self.t / "naver"; nv.mkdir()
        for m in ("KOSPI", "KOSDAQ"):
            rows = [{"code": r["c"], "nowPrice": "1000", "listedStockCnt": "1000000", "marketStatus": "CLOSE"} for r in self.caps["rows"] if r["m"] == m]
            rows.append({"code": "999999", "nowPrice": "1", "listedStockCnt": str(int(self.share["marketTotal"][m] * 1e8)), "marketStatus": "CLOSE"})
            (nv / f"listed_{m}.json").write_text(json.dumps({"rows": rows}), encoding="utf-8")
        rc, log, out = self.run_("2026-11-02T22:30:00", SEMI_CAPS_FIXTURE=str(nv)); self.assertEqual(rc, 0, log)
        self.assertEqual(load(self.t / "site/data/semi_caps.js")["fresh"]["verified"], False)  # 네이버 대체는 거래일을 확인하지 못함
    def test_restore_lastgood(self):
        cache = self.t / "cache"; cache.mkdir(); c = json.loads(json.dumps(self.caps)); c["asOf"] = "2026-11-02"; c["src"] = "krx"
        (cache / "semi_caps.js").write_text("window.SEMI_CAPS = " + json.dumps(c, ensure_ascii=False) + ";", encoding="utf-8"); shutil.copy(self.t / "site/data/semi_share.js", cache / "semi_share.js")
        r = subprocess.run([sys.executable, str(self.t / "scripts/restore_lastgood.py"), str(cache), str(self.t / "site/data")], capture_output=True, text=True)
        self.assertIn("복원", r.stdout); self.assertEqual(load(self.t / "site/data/semi_caps.js")["asOf"], "2026-11-02")
        c["rows"] = c["rows"][:-1]; (cache / "semi_caps.js").write_text("window.SEMI_CAPS = " + json.dumps(c, ensure_ascii=False) + ";", encoding="utf-8")  # 명단이 달라지면 복원하지 않음
        before = (self.t / "site/data/semi_caps.js").read_text(encoding="utf-8")
        r = subprocess.run([sys.executable, str(self.t / "scripts/restore_lastgood.py"), str(cache), str(self.t / "site/data")], capture_output=True, text=True)
        self.assertIn("명단이 달라", r.stdout); self.assertEqual((self.t / "site/data/semi_caps.js").read_text(encoding="utf-8"), before)


if __name__ == "__main__": unittest.main(verbosity=2)
