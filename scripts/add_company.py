"""GitHub 이슈 '추가 요청: 회사명' 으로 지정 기업 목록(site/data/companies.js)에 회사를 더한다.

사이트의 '추가 요청'이 이 이슈를 미리 채워 열어 주고(요청 저장), 담당자가 '추가승인' 라벨을 붙이면
.github/workflows/add-company.yml 이 이 스크립트를 실행한다.
입력(환경변수):
  ISSUE_TITLE  '추가 요청: 피에스케이' (회사명, 종목코드 6자리, DART 고유번호 8자리 중 하나)
  ISSUE_BODY   '그룹: 2그룹' 줄이 있으면 그 그룹에, 없으면 '추가 기업' 그룹에 넣는다
  DART_API_KEY
출력: GITHUB_OUTPUT 에 changed(true/false), exists(true/false), message(이슈에 남길 설명)
"""
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
COMPANIES_PATH = ROOT_DIR / "site" / "data" / "companies.js"
CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
EXTRA_GROUP = ("g-extra", "추가 기업")


def norm(name: str) -> str:
    return re.sub(r"\(주\)|㈜|주식회사|[\s.,·]", "", name or "").lower()


def load_corp_list(api_key: str) -> list:
    """DART 에 등록된 전체 회사의 고유번호·이름·종목코드."""
    resp = requests.get(CORP_CODE_URL, params={"crtfc_key": api_key}, timeout=(10, 90))
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        root = ET.fromstring(zf.read(zf.namelist()[0]))
    return [{"corp_code": (e.findtext("corp_code") or "").strip(), "name": (e.findtext("corp_name") or "").strip(),
             "stock_code": (e.findtext("stock_code") or "").strip()} for e in root.iter("list")]


def find_company(query: str, corps: list) -> tuple:
    """(찾은 회사 또는 None, 후보 목록). 이름이 같은 회사가 여럿이면 상장사 하나일 때만 고른다."""
    q = query.strip()
    if re.fullmatch(r"\d{8}", q):
        exact = [c for c in corps if c["corp_code"] == q]
    elif re.fullmatch(r"[0-9A-Za-z]{6}", q) and re.search(r"\d", q):
        exact = [c for c in corps if c["stock_code"] == q.upper()]
    else:
        nq = norm(q)
        exact = [c for c in corps if norm(c["name"]) == nq]
        listed = [c for c in exact if c["stock_code"]]
        if len(exact) > 1 and len(listed) == 1:
            exact = listed
        if not exact:
            partial = [c for c in corps if nq and nq in norm(c["name"])]
            partial.sort(key=lambda c: (not c["stock_code"], len(c["name"])))
            return None, partial[:10]
    return (exact[0], []) if len(exact) == 1 else (None, exact[:10])


def add_entry(text: str, label: str, entry: list) -> str:
    """그룹 블록의 companies 배열 끝에 한 줄을 넣는다. 그룹이 없으면 맨 뒤에 새 그룹을 만든다."""
    line = "      " + json.dumps(entry, ensure_ascii=False) + ","
    m = re.search(r'label:\s*"' + re.escape(label) + r'",\s*companies:\s*\[', text)
    if m:
        end = text.index("\n    ],", m.end())
        return text[:end] + "\n" + line + text[end:]
    gid, glabel = EXTRA_GROUP
    block = f'  {{\n    id: "{gid}",\n    label: "{glabel}",\n    companies: [\n{line}\n    ],\n  }},\n'
    end = text.rindex("];")
    return text[:end] + block + text[end:]


def write_output(**values):
    path = os.environ.get("GITHUB_OUTPUT")
    out = "".join(f"{k}<<__END__\n{v}\n__END__\n" for k, v in values.items())
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(out)
    else:
        print(out)


def main() -> int:
    title, body = os.environ.get("ISSUE_TITLE", ""), os.environ.get("ISSUE_BODY", "") or ""
    query = re.sub(r"^\s*(?:추가\s*요청|기업\s*추가)\s*[:：]?\s*", "", title).strip()
    if not query:
        write_output(changed="false", exists="false", message="이슈 제목에 회사 이름이 없습니다. `추가 요청: 회사명` 형식으로 다시 올려 주세요.")
        return 0
    api_key = os.environ.get("DART_API_KEY")
    if not api_key:
        write_output(changed="false", exists="false", message="DART_API_KEY 시크릿이 없어 회사를 찾을 수 없습니다.")
        return 1

    text = COMPANIES_PATH.read_text(encoding="utf-8")
    labels = re.findall(r'label:\s*"([^"]+)"', text)
    m = re.search(r"그룹\s*[:：]\s*([^\n\r]+)", body)
    label = m.group(1).strip() if m and m.group(1).strip() in labels + [EXTRA_GROUP[1]] else EXTRA_GROUP[1]

    company, candidates = find_company(query, load_corp_list(api_key))
    if not company:
        lines = [f"- {c['name']} (고유번호 {c['corp_code']}{', 종목코드 ' + c['stock_code'] if c['stock_code'] else ''})"
                 for c in candidates]
        msg = (f"'{query}' 와 정확히 맞는 회사를 DART 에서 찾지 못했습니다."
               + ("\n\n비슷한 회사입니다. 맞는 회사의 고유번호(8자리)나 종목코드로 다시 요청해 주세요.\n" + "\n".join(lines)
                  if lines else "\n\n이름을 DART 등록 이름(예: AP시스템 → 에이피시스템)이나 종목코드로 바꿔 다시 요청해 주세요."))
        write_output(changed="false", exists="false", message=msg)
        return 0

    if f'"{company["corp_code"]}"' in text:
        write_output(changed="false", exists="true", message=f"{company['name']}(고유번호 {company['corp_code']})는 이미 목록에 있습니다.")
        return 0

    is_name = not re.fullmatch(r"\d{8}|[0-9A-Za-z]{6}", query)
    display = query if is_name else re.sub(r"\(주\)|㈜|주식회사", "", company["name"]).strip()
    COMPANIES_PATH.write_text(add_entry(text, label, [display, company["corp_code"], company["stock_code"]]), encoding="utf-8")
    kind = f"상장, 종목코드 {company['stock_code']}" if company["stock_code"] else "비상장"
    write_output(changed="true", exists="false",
                 message=f"{display}({kind}, 고유번호 {company['corp_code']})를 '{label}'에 추가했습니다.\n"
                         "사이트를 다시 만들고 있으며 15분쯤 뒤 목록과 프로필에 나타납니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
