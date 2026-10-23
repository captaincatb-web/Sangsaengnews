"""쇼츠 장면 렌더러.

장면 설명(dict) 하나를 받아 1080x1920 프레임을 그린다. 외부 영상 소재 없이
Fluent 이모지 아이콘(MIT)과 도형 애니메이션만으로 주제에 맞는 화면을 만든다.

화면 배치: 제목 y≈300, 그래픽 y 480~1300, 자막(MoneyPrinterTurbo) y≈1440.
"""

from __future__ import annotations

import math
import random
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
CY = 880  # 그래픽 중심선

PALETTE = {
    "blue": "#38bdf8",
    "cyan": "#22d3ee",
    "green": "#34d399",
    "yellow": "#fbbf24",
    "orange": "#fb923c",
    "red": "#f87171",
    "pink": "#f472b6",
    "purple": "#a78bfa",
}

SCENE_TYPES = (
    "icon", "icons", "vs", "flow", "chart", "counter", "list",
    "network", "globe", "chip", "grid", "trend", "neon", "board",
)


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_out_back(x):
    x = clamp(x)
    c1 = 1.70158
    return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2


def to_rgb(color) -> tuple[int, int, int]:
    color = PALETTE.get(str(color).lower(), color)
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(color))
    if not m:
        return to_rgb(PALETTE["blue"])
    v = m.group(1)
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# 자주 쓰는 영어 단어 → Fluent 아이콘 이름 (Fluent에는 국기와 반도체 칩 아이콘이 없다)
ALIASES = {
    "car": "automobile", "ai": "robot", "coffee": "hot-beverage", "money": "money-bag",
    "phone": "mobile-phone", "smartphone": "mobile-phone", "computer": "desktop-computer",
    "pc": "desktop-computer", "earth": "globe-showing-asia-australia",
    "world": "globe-showing-asia-australia", "globe": "globe-showing-asia-australia",
    "chart": "chart-increasing", "graph": "chart-increasing", "growth": "chart-increasing",
    "decline": "chart-decreasing", "idea": "light-bulb", "electricity": "high-voltage",
    "energy": "high-voltage", "time": "alarm-clock", "clock": "alarm-clock", "heart": "red-heart",
    "doctor": "health-worker-default", "medicine": "pill", "book": "books", "study": "books",
    "home": "house", "city": "cityscape", "building": "office-building",
    "company": "office-building", "office": "office-building", "data": "bar-chart",
    "water": "droplet", "rain": "cloud-with-rain", "tree": "deciduous-tree", "plant": "seedling",
    "food": "fork-and-knife-with-plate", "check": "check-mark-button", "question": "red-question-mark",
    "lock": "locked", "security": "locked", "search": "magnifying-glass-tilted-left",
    "gift": "wrapped-gift", "dollar": "dollar-banknote", "stock": "chart-increasing",
    "plane": "airplane", "train": "high-speed-train", "virus": "microbe", "email": "e-mail",
    "chat": "speech-balloon", "tv": "television", "game": "video-game", "people": "busts-in-silhouette",
    "person": "bust-in-silhouette", "job": "briefcase", "work": "briefcase", "deal": "handshake",
    "graduate": "graduation-cap",
}


class Icons:
    """Fluent 이모지 SVG를 이름으로 찾고 PNG로 렌더링해 캐시한다."""

    def __init__(self, svg_dir: Path, cache_dir: Path):
        self.svg_dir = Path(svg_dir)
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.names = sorted(p.stem for p in self.svg_dir.glob("*.svg"))
        self._set = set(self.names)

    def resolve(self, name: str | None) -> str | None:
        """정확한 이름 → 별칭 → 이모지 문자 → 단어 일치 → 부분 일치 순서로 찾는다."""
        if not name:
            return None
        key = re.sub(r"[\s_]+", "-", str(name).strip().lower())
        for cand in (key, f"{key}-default", ALIASES.get(key)):
            if cand in self._set:  # -default: 피부색 변형이 있는 사람 아이콘
                return cand
        try:  # 이모지 문자(🤖)를 CLDR 이름으로
            import emoji

            cldr = emoji.demojize(str(name).strip(), delimiters=("", ""))
            cldr = re.sub(r"[\s_:]+", "-", cldr.lower()).strip("-")
            for cand in (cldr, f"{cldr}-default"):
                if cand in self._set:
                    return cand
        except Exception:
            pass
        hits = [n for n in self.names if key in n.split("-")]
        if not hits and len(key) >= 5:  # 짧은 단어의 부분 일치는 엉뚱한 결과(chip→chipmunk)가 많다
            hits = [n for n in self.names if key in n]
        return min(hits, key=len) if hits else None

    def search(self, query: str, limit: int = 40) -> list[str]:
        words = re.split(r"[\s,]+", query.lower().strip())
        hits = [n for n in self.names if all(w in n for w in words if w)]
        return sorted(hits, key=len)[:limit]

    @lru_cache(maxsize=64)
    def get(self, name: str, size: int) -> Image.Image:
        size = max(32, int(size))
        png = self.cache_dir / f"{name}_{size}.png"
        if not png.exists():
            svg = self.svg_dir / f"{name}.svg"
            if shutil.which("rsvg-convert"):
                subprocess.run(
                    ["rsvg-convert", "-w", str(size), "-h", str(size), "-a",
                     str(svg), "-o", str(png)],
                    check=True,
                )
            else:
                import cairosvg

                cairosvg.svg2png(url=str(svg), write_to=str(png),
                                 output_width=size, output_height=size)
        im = Image.open(png).convert("RGBA")
        if im.size != (size, size):  # 비율 유지 렌더링 결과를 정사각형에 맞춘다
            canvas = Image.new("RGBA", (size, size))
            canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
            im = canvas
        return im


class Renderer:
    def __init__(self, font_path: str, icons: Icons, accent="blue", fallback_icon="sparkles"):
        self.font_path = font_path
        self.icons = icons
        self.accent = to_rgb(accent)
        self.fallback_icon = icons.resolve(fallback_icon) or (icons.names[0] if icons.names else None)
        self.warnings: list[str] = []
        self.progress = True  # 화면 맨 위 진행 막대

    # ---- 공통 도구 ----
    @lru_cache(maxsize=32)
    def font(self, size: int) -> ImageFont.FreeTypeFont:
        return ImageFont.truetype(self.font_path, int(size))

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)

    def icon_name(self, name) -> str | None:
        if not name:
            return self.fallback_icon
        resolved = self.icons.resolve(name)
        key = re.sub(r"[\s_]+", "-", str(name).strip().lower())
        if not resolved:
            self.warn(f"아이콘 '{name}' 없음 → '{self.fallback_icon}' 사용 (shorts/run.sh icons 로 검색)")
        elif str(name).isascii() and resolved not in (key, f"{key}-default", ALIASES.get(key)):
            self.warn(f"아이콘 '{name}' → '{resolved}'(으)로 대체됨: 맞는지 확인")
        return resolved or self.fallback_icon

    @lru_cache(maxsize=16)
    def background(self, accent: tuple) -> Image.Image:
        top = mix((6, 9, 22), accent, 0.10)
        bottom = (4, 6, 14)
        grad = Image.linear_gradient("L").resize((W, H))
        bg = Image.composite(Image.new("RGB", (W, H), bottom), Image.new("RGB", (W, H), top), grad)
        d = ImageDraw.Draw(bg)
        dot = mix(top, accent, 0.18)
        for y in range(40, H, 72):
            for x in range(36, W, 72):
                d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=dot)
        return bg

    @lru_cache(maxsize=16)
    def glow(self, size: int, accent: tuple, strength: float = 0.55) -> Image.Image:
        g = Image.new("L", (size, size), 0)
        ImageDraw.Draw(g).ellipse([size * 0.22, size * 0.22, size * 0.78, size * 0.78],
                                  fill=int(255 * strength))
        g = g.filter(ImageFilter.GaussianBlur(size * 0.12))
        im = Image.new("RGBA", (size, size), accent + (0,))
        im.putalpha(g)
        return im

    def paste_center(self, base: Image.Image, im: Image.Image, cx, cy):
        base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

    def draw_icon(self, base, name, cx, cy, size, scale=1.0, glow=True, accent=None):
        if size * scale < 8:
            return
        if glow:
            self.paste_center(base, self.glow(int(size * 1.9), accent or self.accent), cx, cy)
        src = self.icons.get(name, int(size * 1.08))
        s = max(8, int(size * scale))
        im = src.resize((s, s), Image.BILINEAR) if s != src.width else src
        self.paste_center(base, im, cx, cy)

    def fit_font(self, text, max_w, size, min_size=36):
        while size > min_size and self.font(size).getlength(text) > max_w:
            size -= 4
        return self.font(size)

    def text(self, d, xy, text, size, fill=(255, 255, 255), anchor="mm", max_w=960, stroke=6):
        f = self.fit_font(text, max_w, size)
        d.text(xy, text, font=f, fill=fill, anchor=anchor, stroke_width=stroke,
               stroke_fill=(0, 0, 0))
        return f

    def particles(self, d, seed, t, accent):
        rnd = random.Random(seed)
        for _ in range(26):
            x = rnd.uniform(0, W)
            y0 = rnd.uniform(0, H)
            v = rnd.uniform(20, 70)
            r = rnd.uniform(2, 6)
            y = (y0 - v * t) % H
            tw = 0.35 + 0.35 * math.sin(t * 2 + x)
            c = mix((10, 14, 30), accent, tw)
            d.ellipse([x - r, y - r, x + r, y + r], fill=c)

    def title(self, base, d, scene, t):
        text = scene.get("title")
        if not text:
            return
        a = ease_out(t / 0.35)
        y = 300 + (1 - a) * 40
        accent = scene["_accent"]
        f = self.text(d, (W / 2, y), text, 88, max_w=940, stroke=7)
        bar = min(940, f.getlength(text)) * a
        d.rounded_rectangle([W / 2 - bar / 2, y + 62, W / 2 + bar / 2, y + 74], 6, fill=accent)

    # ---- 프레임 ----
    def frame(self, scene: dict, t: float, u: float, global_u: float) -> Image.Image:
        accent = scene["_accent"]
        base = self.background(accent).convert("RGBA")
        d = ImageDraw.Draw(base)
        self.particles(d, scene["_seed"], t, accent)
        kind = scene.get("scene", "icon")
        getattr(self, f"s_{kind}", self.s_icon)(base, d, scene, t, u)
        self.title(base, d, scene, t)
        if self.progress:
            d.rectangle([0, 0, W * global_u, 9], fill=accent)
        return base.convert("RGB")

    # ---- 장면 종류 ----
    def s_icon(self, base, d, sc, t, u):
        name = sc["_icons"][0]
        pop = ease_out_back(t / 0.45)
        bob = math.sin(t * 2.2) * 14
        self.draw_icon(base, name, W / 2, CY + bob, 560, pop * (1 + 0.05 * u), accent=sc["_accent"])

    def _labels(self, sc):
        return list(sc.get("labels") or [])

    def s_icons(self, base, d, sc, t, u):
        names = sc["_icons"][:4]
        labels = self._labels(sc)
        n = len(names)
        layouts = {
            1: ([(540, CY)], 520),
            2: ([(290, CY), (790, CY)], 380),
            3: ([(190, CY), (540, CY), (890, CY)], 280),
            4: ([(300, 700), (780, 700), (300, 1080), (780, 1080)], 280),
        }
        pos, size = layouts[n]
        for i, (name, (x, y)) in enumerate(zip(names, pos)):
            k = t - i * 0.22
            if k <= 0:
                continue
            bob = math.sin(t * 2 + i) * 8
            self.draw_icon(base, name, x, y + bob, size, ease_out_back(k / 0.4), accent=sc["_accent"])
            if i < len(labels) and k > 0.2:
                self.text(d, (x, y + size * 0.62 + 34), labels[i], 64 if n < 4 else 56,
                          max_w=W / min(n, 3) - 30 if n < 4 else 460)

    def s_vs(self, base, d, sc, t, u):
        names = (sc["_icons"] + sc["_icons"])[:2]
        labels = self._labels(sc)
        for i, x in enumerate((290, 790)):
            k = t - i * 0.35
            if k <= 0:
                continue
            self.draw_icon(base, names[i], x, CY + math.sin(t * 2 + i) * 8, 360,
                           ease_out_back(k / 0.4), accent=sc["_accent"])
            if i < len(labels) and k > 0.2:
                self.text(d, (x, CY + 260), labels[i], 66, max_w=480)
        a = ease_out_back((t - 0.2) / 0.4)
        if a <= 0:
            return
        if sc.get("arrow"):
            L = 70 * a
            d.polygon([(540 - L, CY - 22), (540 + L * 0.3, CY - 22), (540 + L * 0.3, CY - 50),
                       (540 + L, CY), (540 + L * 0.3, CY + 50), (540 + L * 0.3, CY + 22),
                       (540 - L, CY + 22)], fill=sc["_accent"])
        else:
            r = 70 * a
            d.ellipse([540 - r, CY - r, 540 + r, CY + r], fill=sc["_accent"], outline=(255, 255, 255), width=5)
            if a > 0.6:
                d.text((540, CY), "VS", font=self.font(64), fill=(255, 255, 255), anchor="mm",
                       stroke_width=4, stroke_fill=(0, 0, 0))

    def s_flow(self, base, d, sc, t, u):
        names = (sc["_icons"] + sc["_icons"])[:2]
        labels = self._labels(sc)
        x0, x1, size = 210, 870, 280
        for i, x in enumerate((x0, x1)):
            self.draw_icon(base, names[i], x, CY, size, ease_out_back((t - i * 0.25) / 0.4),
                           accent=sc["_accent"])
            if i < len(labels) and t > 0.3:
                self.text(d, (x, CY + 220), labels[i], 62, max_w=380)
        a, b = x0 + size * 0.55, x1 - size * 0.55
        for x in range(int(a), int(b), 26):
            d.ellipse([x - 4, CY - 4, x + 4, CY + 4], fill=mix((20, 28, 60), sc["_accent"], 0.45))
        if t < 0.4:
            return
        packet = sc.get("_packet")
        L = b - a
        for k in range(3):
            p = ((t - 0.4) * 0.9 + k / 3) % 1.0
            x = a + L * p
            if packet:
                self.draw_icon(base, packet, x, CY, 96, 1.0, glow=False)
            else:
                d.ellipse([x - 16, CY - 16, x + 16, CY + 16], fill=sc["_accent"], outline=(255, 255, 255), width=3)

    def _fmt(self, v, unit="", prefix=""):
        if isinstance(v, float) and not v.is_integer():
            s = f"{v:,.1f}"
        else:
            s = f"{int(round(v)):,}"
        return f"{prefix}{s}{unit}"

    def s_chart(self, base, d, sc, t, u):
        vals = [float(v) for v in (sc.get("values") or [1, 2, 3, 4])][:6]
        labels = self._labels(sc)
        unit = sc.get("unit", "")
        n = len(vals)
        vmax = max(vals) or 1
        left, right, base_y, top_y = 110, 970, 1240, 640
        slot = (right - left) / n
        bw = slot * 0.62
        hi = sc.get("highlight", n - 1)
        d.line([left - 10, base_y, right + 10, base_y], fill=(200, 215, 240), width=5)
        for i, v in enumerate(vals):
            g = ease_out((t - 0.1 - i * 0.12) / 0.8)
            if g <= 0:
                continue
            h = (base_y - top_y) * (v / vmax) * g
            x = left + slot * i + (slot - bw) / 2
            col = sc["_accent"] if i == hi else mix((60, 70, 100), sc["_accent"], 0.45)
            d.rounded_rectangle([x, base_y - h, x + bw, base_y], 12, fill=col)
            if g > 0.6:
                self.text(d, (x + bw / 2, base_y - h - 40), self._fmt(v * g, unit), 50,
                          max_w=slot + 20, stroke=5)
            if i < len(labels):
                self.text(d, (x + bw / 2, base_y + 44), labels[i], 44, max_w=slot + 10, stroke=5)
        if sc["_icons"] and sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], 880, 540, 150, ease_out_back(t / 0.4), glow=False)

    def s_counter(self, base, d, sc, t, u):
        num = sc.get("number", 100)
        num = float(str(num).replace(",", "")) if not isinstance(num, (int, float)) else num
        is_float = isinstance(num, float) and not float(num).is_integer()
        v = num * ease_out(t / 1.3)
        if not is_float:
            v = int(round(v))
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], W / 2, 640, 300,
                           ease_out_back(t / 0.4) * (1 + 0.04 * math.sin(t * 3)), accent=sc["_accent"])
            ny = 1010
        else:
            ny = CY
        s = self._fmt(float(v) if is_float else v, sc.get("unit", ""), sc.get("prefix", ""))
        self.text(d, (W / 2, ny), s, 210, fill=sc["_accent"], max_w=1000, stroke=8)
        if sc.get("caption"):
            self.text(d, (W / 2, ny + 150), sc["caption"], 60, max_w=960)

    def s_list(self, base, d, sc, t, u):
        items = [str(x) for x in (sc.get("items") or [])][:4]
        bullet = sc.get("_bullet")
        y0 = 620 if len(items) > 2 else 720
        for i, item in enumerate(items):
            k = t - 0.15 - i * 0.4
            if k <= 0:
                continue
            a = ease_out(k / 0.35)
            y = y0 + i * 175
            off = (1 - a) * 300
            d.rounded_rectangle([90 + off, y - 70, 990 + off, y + 70], 28,
                                fill=mix((14, 20, 44), sc["_accent"], 0.18),
                                outline=mix((14, 20, 44), sc["_accent"], 0.7), width=3)
            self.draw_icon(base, bullet, 170 + off, y, 96, 1.0, glow=False)
            if len(item) > 14:
                self.warn(f"목록 항목이 김(14자 이하 권장): '{item}'")
            f = self.fit_font(item, 720, 64)
            d.text((250 + off, y), item, font=f, fill=(255, 255, 255), anchor="lm",
                   stroke_width=5, stroke_fill=(0, 0, 0))

    def s_network(self, base, d, sc, t, u):
        acc = sc["_accent"]
        rnd = random.Random(sc["_seed"])
        rings = [(250, 6), (410, 10)]
        nodes = []
        for r, n in rings:
            off = rnd.uniform(0, math.pi)
            ring = [(W / 2 + r * math.cos(off + 2 * math.pi * k / n),
                     CY + r * 0.95 * math.sin(off + 2 * math.pi * k / n)) for k in range(n)]
            nodes.append(ring)
        grow = ease_out(t / 0.8)
        edges = [((W / 2, CY), p) for p in nodes[0]]
        for p in nodes[1]:
            q = min(nodes[0], key=lambda c: (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2)
            edges.append((q, p))
        for (x0, y0), (x1, y1) in edges:
            xe, ye = x0 + (x1 - x0) * grow, y0 + (y1 - y0) * grow
            d.line([x0, y0, xe, ye], fill=mix((20, 30, 60), acc, 0.5), width=4)
        for j, ((x0, y0), (x1, y1)) in enumerate(edges):
            p = (t * 0.8 + j * 0.13) % 1.0
            if grow > 0.95:
                x, y = x0 + (x1 - x0) * p, y0 + (y1 - y0) * p
                d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=(255, 255, 255))
        for li, ring in enumerate(nodes):
            for k, (x, y) in enumerate(ring):
                pulse = 0.5 + 0.5 * math.sin(t * 4 + k + li)
                r = (26 - li * 6 + 6 * pulse) * grow
                d.ellipse([x - r, y - r, x + r, y + r], fill=mix(acc, (255, 255, 255), 0.25 * pulse),
                          outline=(230, 240, 255), width=3)
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], W / 2, CY, 240, ease_out_back(t / 0.45), accent=acc)
        else:
            r = 46 * grow
            d.ellipse([W / 2 - r, CY - r, W / 2 + r, CY + r], fill=(255, 255, 255))

    def s_globe(self, base, d, sc, t, u):
        acc = sc["_accent"]
        R = 340 * ease_out_back(t / 0.5)
        if R < 5:
            return
        cx, cy = W / 2, CY
        self.paste_center(base, self.glow(880, acc, 0.45), cx, cy)
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=mix((8, 14, 34), acc, 0.15), outline=acc, width=5)
        line = mix((20, 30, 60), acc, 0.6)
        for lat in (-60, -30, 0, 30, 60):
            y = cy + R * math.sin(math.radians(lat))
            rx = R * math.cos(math.radians(lat))
            ry = rx * 0.18
            d.arc([cx - rx, y - ry, cx + rx, y + ry], 0, 180, fill=line, width=3)
        rot = t * 0.9
        for k in range(6):
            ph = rot + k * math.pi / 6
            rx = abs(math.cos(ph)) * R
            d.ellipse([cx - rx, cy - R, cx + rx, cy + R], outline=line, width=3)
        rnd = random.Random(sc["_seed"])
        for _ in range(18):
            lat, lon = math.radians(rnd.uniform(-65, 65)), rnd.uniform(0, 2 * math.pi)
            z = math.cos(lat) * math.cos(lon + rot)
            if z < 0.05:
                continue
            x = cx + R * math.cos(lat) * math.sin(lon + rot)
            y = cy - R * math.sin(lat)
            pr = 9 + 7 * math.sin(t * 5 + lon)
            d.ellipse([x - pr, y - pr, x + pr, y + pr], fill=(255, 255, 255))
            ring = 18 + ((t * 30 + lon * 20) % 30)
            d.ellipse([x - ring, y - ring, x + ring, y + ring], outline=acc, width=2)

    def s_chip(self, base, d, sc, t, u):
        acc = sc["_accent"]
        sz = (380 + 120 * u) * ease_out_back(t / 0.45)
        if sz < 10:
            return
        cx, cy, h = W / 2, CY, sz / 2
        self.paste_center(base, self.glow(1000, acc), cx, cy)
        pin = (130, 140, 165)
        for k in range(-4, 5):
            o = k * sz / 10
            d.rectangle([cx + o - 6, cy - h - 42, cx + o + 6, cy - h], fill=pin)
            d.rectangle([cx + o - 6, cy + h, cx + o + 6, cy + h + 42], fill=pin)
            d.rectangle([cx - h - 42, cy + o - 6, cx - h, cy + o + 6], fill=pin)
            d.rectangle([cx + h, cy + o - 6, cx + h + 42, cy + o + 6], fill=pin)
        d.rounded_rectangle([cx - h, cy - h, cx + h, cy + h], 22, fill=(24, 30, 58), outline=acc, width=7)
        g = 0.5 + 0.5 * math.sin(t * 4)
        core = mix(mix(acc, (0, 0, 0), 0.35), acc, g)
        d.rounded_rectangle([cx - h / 2, cy - h / 2, cx + h / 2, cy + h / 2], 12, fill=core)
        for k in range(-3, 4):
            y = cy + k * h / 4
            d.line([cx - h + 22, y, cx - h / 2, y], fill=acc, width=3)
            d.line([cx + h / 2, y, cx + h - 22, y], fill=acc, width=3)
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], cx, cy, h * 0.8, 1.0, glow=False)

    def s_grid(self, base, d, sc, t, u):
        acc = sc["_accent"]
        cols, rows = 12, 13
        left, top, right, bottom = 110, 560, 970, 1240
        cw, ch = (right - left) / cols, (bottom - top) / rows
        show = ease_out(t / 0.6)
        for i in range(cols):
            for j in range(rows):
                v = clamp((math.sin(t * 6 - i * 0.6 - j * 0.9) + 1) / 2 * (0.4 + 0.8 * u)) * show
                col = mix((22, 30, 60), acc, v)
                x, y = left + i * cw, top + j * ch
                d.rounded_rectangle([x + 3, y + 3, x + cw - 3, y + ch - 3], 5, fill=col)
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], W / 2, CY, 320, ease_out_back((t - 0.2) / 0.45),
                           accent=acc)

    def s_trend(self, base, d, sc, t, u):
        acc = sc["_accent"]
        up = str(sc.get("direction", "up")).lower() != "down"
        left, right, top, bottom = 110, 970, 600, 1230
        rnd = random.Random(sc["_seed"])
        n = 14
        ys, y = [], 0.15
        for k in range(n):
            y += (0.06 if up else -0.06) + rnd.uniform(-0.05, 0.05)
            ys.append(y)
        lo, hi = min(ys), max(ys)
        pts = [(left + (right - left) * k / (n - 1),
                bottom - (bottom - top) * (v - lo) / ((hi - lo) or 1)) for k, v in enumerate(ys)]
        p = ease_out(t / 1.4) * (n - 1)
        k = int(p)
        cur = pts[: k + 1]
        if k < n - 1:
            f = p - k
            cur.append((pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f,
                        pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f))
        d.line([left, bottom, right, bottom], fill=(200, 215, 240), width=4)
        if len(cur) >= 2:
            layer = Image.new("RGBA", (W, H))
            ImageDraw.Draw(layer).polygon(cur + [(cur[-1][0], bottom), (cur[0][0], bottom)],
                                          fill=acc + (70,))
            base.alpha_composite(layer)
            col = acc if up else to_rgb("red")
            d.line(cur, fill=col, width=12, joint="curve")
            x, y = cur[-1]
            d.ellipse([x - 20, y - 20, x + 20, y + 20], fill=(255, 255, 255), outline=col, width=6)
        if sc.get("label") and t > 0.6:
            self.text(d, (W / 2, 560), sc["label"], 96, fill=acc if up else to_rgb("red"), stroke=7)
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], 230 if up else 850, 700, 170,
                           ease_out_back(t / 0.4), glow=False)


    def s_neon(self, base, d, sc, t, u):
        """네온 터널: 소실점으로 빨려 들어가는 화면(시네마틱 영상이 없을 때의 대체 장면)."""
        acc = sc["_accent"]
        vx, vy = W / 2, 820
        for k in range(9):
            z = (t * 0.32 + k / 9) % 1.0
            s = 0.04 + z ** 2.2 * 1.5
            w2, h2 = W * 0.62 * s, H * 0.42 * s
            c = mix((8, 10, 20), (90, 96, 120), min(1, z * 1.4))
            d.rounded_rectangle([vx - w2, vy - h2, vx + w2, vy + h2 * 1.25], int(40 * s) + 2,
                                outline=c, width=max(1, int(6 * z)))
            if z > 0.15:
                for side in (-1, 1):
                    lx = vx + side * w2 * 0.92
                    d.rectangle([lx - 3 - 6 * z, vy - h2 * 0.95, lx + 3 + 6 * z, vy - h2 * 0.95 + 10 * z],
                                fill=mix((20, 20, 30), (255, 255, 240), z))
        for x0 in (W / 2 - 260, W / 2 + 260):
            for wdt, col in ((34, mix((0, 0, 0), acc, 0.35)), (18, mix((0, 0, 0), acc, 0.75)),
                             (7, mix(acc, (255, 255, 255), 0.6))):
                d.line([x0, H, vx + (x0 - vx) * 0.04, vy + 40], fill=col, width=wdt)
        for k in range(6):
            z = (t * 0.9 + k / 6) % 1.0
            for x0 in (W / 2 - 260, W / 2 + 260):
                f = z ** 2.4
                x = vx + (x0 - vx) * (0.04 + 0.96 * f)
                y = vy + 40 + (H - vy - 40) * f
                r = 3 + 14 * f
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255))
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], vx, vy - 40, 300, ease_out_back(t / 0.5), accent=acc)


    def s_board(self, base, d, sc, t, u):
        """전광판: 장면 속 숫자(items)를 보여 주는 대체 장면. 상승은 빨강, 하락은 파랑."""
        lines = [str(x) for x in (sc.get("items") or [])][:4] or ["…"]
        x0, x1, y0 = 80, 1000, 500
        y1 = y0 + 90 + 160 * len(lines)
        d.rectangle([W / 2 - 26, y1, W / 2 + 26, 1340], fill=(46, 50, 64))
        d.rounded_rectangle([x0 - 16, y0 - 16, x1 + 16, y1 + 16], 26, fill=(58, 62, 78))
        d.rounded_rectangle([x0, y0, x1, y1], 16, fill=(6, 8, 14))
        for yy in range(y0 + 10, y1 - 6, 12):
            d.line([x0 + 10, yy, x1 - 10, yy], fill=(13, 15, 22), width=2)
        for i, line in enumerate(lines):
            if t < 0.15 + i * 0.25:
                continue
            if re.search(r"\+|▲|상승|올라|급등", line):
                col = (255, 88, 76)
            elif re.search(r"−|-\d|▼|하락|내려|급락", line):
                col = (84, 156, 255)
            else:
                col = (255, 232, 160)
            f = self.fit_font(line, x1 - x0 - 70, 124 if re.search(r"\d", line) else 84)
            d.text((W / 2, y0 + 125 + i * 160), line, font=f, fill=col, anchor="mm")
        if sc.get("icon"):
            self.draw_icon(base, sc["_icons"][0], 850, 1190, 250, ease_out_back((t - 0.3) / 0.45), glow=False)


def prepare_scene(sc: dict, idx: int, renderer: Renderer, accent) -> dict:
    """장면 dict를 정규화한다(종류, 아이콘 이름, 색, 시드)."""
    sc = dict(sc)
    kind = str(sc.get("scene", "icon")).lower()
    if kind not in SCENE_TYPES:
        renderer.warnings.append(f"장면 {idx + 1}: 알 수 없는 종류 '{kind}' → icon")
        kind = "icon"
    sc["scene"] = kind
    raw = sc.get("icons") or sc.get("icon") or []
    if isinstance(raw, str):
        raw = [raw]
    sc["_icons"] = [renderer.icon_name(x) for x in raw] or [renderer.fallback_icon]
    sc["_packet"] = renderer.icon_name(sc["packet"]) if sc.get("packet") else None
    sc["_bullet"] = renderer.icon_name(sc.get("bullet") or "check-mark-button")
    sc["_accent"] = to_rgb(sc.get("color") or accent)
    sc["_seed"] = 1000 + idx * 17
    return sc
