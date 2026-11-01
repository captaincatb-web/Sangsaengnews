#!/usr/bin/env python3
"""Static regression checks for shared navigation, page markup and freshness UI."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
PAGES = ["index.html", "analysis2.html", "dashboard.html", "domestic.html", "compare.html", "guide.html", "profile.html", "analysis.html"]
EXPECTED_LABELS = ["프로필", "성장 분석", "소부장 경영 정보", "국내 소부장", "해외 비교", "이용 안내"]
REQUIRED_ASSETS = ["navigation.shared.css", "data-status.css", "data/status.js", "data-status.js"]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.body_open = 0
        self.body_close = 0
        self.in_gnb = False
        self.in_anchor = False
        self.anchor_text = []
        self.gnb_links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "body":
            self.body_open += 1
        if tag == "nav" and "gnb" in attrs.get("class", "").split():
            self.in_gnb = True
        if self.in_gnb and tag == "a":
            self.in_anchor = True
            self.anchor_text = []
            self.anchor_href = attrs.get("href", "")

    def handle_endtag(self, tag):
        if tag == "body":
            self.body_close += 1
        if self.in_gnb and tag == "a" and self.in_anchor:
            label = re.sub(r"\s+", " ", "".join(self.anchor_text)).strip()
            self.gnb_links.append((self.anchor_href, label))
            self.in_anchor = False
        if self.in_gnb and tag == "nav":
            self.in_gnb = False

    def handle_data(self, data):
        if self.in_gnb and self.in_anchor:
            self.anchor_text.append(data)


for page in PAGES:
    path = SITE / page
    assert path.exists(), f"Missing page: {page}"
    html = path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(html)
    assert parser.body_open == 1 and parser.body_close == 1, f"{page}: expected exactly one body pair"
    labels = [label for _, label in parser.gnb_links]
    assert labels == EXPECTED_LABELS, f"{page}: GNB labels/order mismatch: {labels}"
    for asset in REQUIRED_ASSETS:
        assert asset in html, f"{page}: missing {asset}"
    assert "sidebar.shared.css" in html, f"{page}: missing shared sidebar stylesheet"

utility_html = (SITE / "internal-tool.html").read_text(encoding="utf-8")
utility_parser = PageParser()
utility_parser.feed(utility_html)
assert utility_parser.body_open == 1 and utility_parser.body_close == 1, "internal-tool.html: expected exactly one body pair"
assert [label for _, label in utility_parser.gnb_links] == EXPECTED_LABELS, "internal-tool.html: GNB labels/order mismatch"
assert "navigation.shared.css" in utility_html, "internal-tool.html: shared GNB stylesheet missing"

compare = (SITE / "compare.html").read_text(encoding="utf-8")
assert compare.count("<body") == 1, "compare.html: duplicate body tag remains"
analysis_html = (SITE / "analysis2.html").read_text(encoding="utf-8")
analysis_js = (SITE / "analysis.js").read_text(encoding="utf-8")
tab_ids = re.findall(r'data-tab="([^"]+)"', analysis_html)
assert len(tab_ids) == 4 and all(f'id="{tab_id}"' in analysis_html for tab_id in tab_ids), "Growth analysis tab/panel mapping is incomplete"
for feature in ["ArrowRight", "ArrowLeft", "hashchange", "aria-controls"]:
    assert feature in analysis_js, f"analysis.js: missing accessible tab behavior {feature}"
nav_css = (SITE / "navigation.shared.css").read_text(encoding="utf-8")
side_css = (SITE / "sidebar.shared.css").read_text(encoding="utf-8")
assert "font-size: 15px" in nav_css and "scroll-snap-type" in nav_css, "GNB common styles are incomplete"
assert "overflow-x: auto" in side_css and "scroll-snap-type: x proximity" in side_css, "Mobile sidebar horizontal scrolling is missing"
status_script = (SITE / "data-status.js").read_text(encoding="utf-8")
assert "SITE_DATA_STATUS" in status_script and "insertAdjacentElement" in status_script, "Shared data-status renderer is incomplete"
status_manifest = (SITE / "data" / "status.js").read_text(encoding="utf-8")
assert "SITE_DATA_STATUS" in status_manifest, "Data-status manifest is missing"
print("PASS: six pages, GNB, HTML body structure, growth tabs, mobile scrolling and data status")
