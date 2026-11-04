import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "growth"))
import ingest_entity_status as S  # noqa: E402


def row(**kw):
    r = {"원본그룹": "B", "목록표기": "TOKYO ELECTRON", "공식법인명": "Tokyo Electron Ltd.", "국가": "JP", "법인상태": "상장 본사", "거래소": "TSE", "티커": "8035", "소부장판정": "포함", "대표업종": "장비", "근거URL": "https://example.org/x", "확신도(높음/중간/낮음)": "높음"}
    r.update(kw); return r


class EntityStatus(unittest.TestCase):
    def test_accepts_valid_listed_parent(self):
        ok, rej = S.convert([row()]); self.assertEqual(len(ok), 1); self.assertEqual(ok[0]["entity_key"], "tokyoelectron"); self.assertEqual(ok[0]["확신도"], "높음")
    def test_listing_annotation_removed_but_official_name_kept_separate(self):
        ok, rej = S.convert([row(목록표기="TOKYO ELECTRON (SEC: n/a)")]); self.assertEqual(ok[0]["목록표기"], "TOKYO ELECTRON"); self.assertEqual(ok[0]["공식법인명"], "Tokyo Electron Ltd.")
    def test_decisive_without_url_rejected(self):
        ok, rej = S.convert([row(근거URL="")]); self.assertEqual(ok, []); self.assertIn("근거URL 없음(확정 판정)", rej)
    def test_unknown_state_needs_no_url_and_is_not_forced(self):
        ok, rej = S.convert([row(법인상태="미확인", 소부장판정="", 근거URL="", 티커="", 거래소="")]); self.assertEqual(ok[0]["법인상태"], "미확인")
    def test_delisted_needs_date_and_identifier(self):
        ok, rej = S.convert([row(법인상태="상장폐지")]); self.assertEqual(ok, []); self.assertIn("상장폐지일 없음/형식 오류", rej)
        ok, rej = S.convert([row(법인상태="상장폐지", 상장폐지일="2024-06-26")]); self.assertEqual(len(ok), 1)
    def test_subsidiary_requires_parent_name(self):
        ok, rej = S.convert([row(법인상태="비상장 자회사", 소부장판정="")]); self.assertEqual(ok, []); self.assertIn("모회사공식명 없음", rej)
    def test_include_requires_representative_industry(self):
        ok, rej = S.convert([row(대표업종="")]); self.assertEqual(ok, [])
    def test_similar_names_not_merged_and_conflict_rejected(self):
        ok, rej = S.convert([row(), row(공식법인명="Tokyo Electron Korea Ltd.")]); self.assertEqual(ok, []); self.assertIn("법인 식별 충돌(같은 목록표기에 공식법인명 여럿)", rej)
    def test_bad_enum_rejected(self):
        ok, rej = S.convert([row(법인상태="상장")]); self.assertEqual(ok, [])


if __name__ == "__main__": unittest.main()


class GptAdapter(unittest.TestCase):
    def test_gpt_headers_and_values_mapped_without_inventing_facts(self):
        r = {"원본그룹": "B", "목록표기": "APCB", "직전판정": "미조사", "이번검증판정": "상장 본사", "공식법인명": "APCB Inc.", "거래소": "TWSE", "티커": "6108", "소부장판정": "보류(PCB 반도체 적용 매출 미확인)", "대표업종": "부품", "공식근거URL": "https://example.org/x", "확신도(높음/중간/낮음)": "높음", "검증일": "2026-11-04"}
        ok, rej = S.convert([r]); self.assertEqual(ok[0]["법인상태"], "상장 본사"); self.assertEqual(ok[0]["소부장판정"], "보류"); self.assertEqual(ok[0]["확인일"], "2026-11-04")
    def test_include_review_is_not_a_confirmed_inclusion(self):
        r = {"목록표기": "X Corp", "이번검증판정": "비상장 자회사", "모회사": "Y Inc.", "소부장판정": "포함 검토(장비)", "대표업종": "장비", "공식근거URL": "https://example.org/x"}
        ok, rej = S.convert([r]); self.assertEqual(ok[0]["소부장판정"], "보류")
    def test_unclear_state_becomes_unconfirmed(self):
        r = {"목록표기": "ASML US.", "이번검증판정": "그룹 자회사(정확한 법인 보류)", "소부장판정": "보류"}
        ok, rej = S.convert([r]); self.assertEqual(ok[0]["법인상태"], "미확인")
    def test_delisted_without_date_rejected(self):
        r = {"목록표기": "FEI COMPANY", "이번검증판정": "상장폐지", "거래소": "NASDAQ", "소부장판정": "보류", "공식근거URL": "https://example.org/x"}
        ok, rej = S.convert([r]); self.assertEqual(ok, []); self.assertIn("상장폐지일 없음/형식 오류", rej)
