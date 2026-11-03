"""국가별 공식 공시 수집기 모음. 각 모듈은 독립적으로 import 되며(네트워크·환경변수 없이), CAPABILITY 로 실제 구현·시험 수준을 정직하게 표시한다.
live_verified 는 실제 Actions 실행으로 접근을 확인하기 전까지 False 로 둔다(이 패키지에서는 절대 True 로 바꾸지 않는다)."""
from . import base, us_sec, jp_edinet, tw_twse, cn_cninfo, eu_generic  # noqa: F401

ALL = (us_sec.UsSec, jp_edinet.JpEdinet, tw_twse.TwTwse, cn_cninfo.CnCninfo, eu_generic.EuGeneric)
