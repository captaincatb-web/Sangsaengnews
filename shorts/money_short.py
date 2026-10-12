#!/usr/bin/env python3
"""경제 해부형 쇼츠 조립기.

스타일: 실사 배경 속 귀여운 3D 캐릭터(AI 이미지/영상), 장면 속 전광판·화면에 핵심 숫자,
굵은 흰 글씨 + 두꺼운 검정 외곽선의 2줄 자막, 내레이션. 장면당 3~6초.

  shorts/money.sh render <spec.json>         장면 이미지/클립(S01.png …)으로 조립. 없으면 전광판 장면으로 대체
  shorts/money.sh add <spec.json> <파일...>  올린 이미지/클립을 S01, S02 …에 배정

render는 이미지 생성용 프롬프트 모음(prompts.md)과 게시용 캡션(caption.txt)도 만든다.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_short as ms  # noqa: E402
import scenes as scn  # noqa: E402
import why_short as ws  # noqa: E402

ROOT = ms.REPO / "output" / "money"
W, H, FPS = scn.W, scn.H, ms.FPS
XF = 0.25  # 장면 사이 크로스페이드(초)
KB_MODES = ("in", "left", "out", "right")


def load_style() -> dict:
    return json.loads((HERE / "money_style.json").read_text(encoding="utf-8"))


def load_spec(path: str) -> dict:
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    scenes = spec.get("scenes") or []
    if not scenes:
        raise SystemExit("spec에 scenes가 없습니다.")
    for i, sc in enumerate(scenes, 1):
        if not [x for x in sc.get("lines", []) if str(x).strip()]:
            raise SystemExit(f"장면 {i}: lines(내레이션 문장)가 없습니다.")
    spec.setdefault("topic", scenes[0]["lines"][0])
    return spec


def find_media(d: Path, n: int) -> Path | None:
    for ext in ws.CLIP_EXT:
        for name in (f"S{n:02d}{ext}", f"S{n:02d}{ext.upper()}"):
            if (d / name).exists():
                return d / name
    return None


def sub_blocks(sentence: str, line_chars: int) -> list[str]:
    """문장을 길이가 고른 2줄(줄당 line_chars자 안팎) 자막 덩어리로 나눈다."""
    words = sentence.split()
    n = max(1, math.ceil(len(sentence) / (line_chars * 2)))
    target = len(sentence) / n
    blocks, cur = [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > target * 1.15 and len(blocks) < n - 1:
            blocks.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    blocks.append(cur)
    out = []
    for b in blocks:
        if len(b) <= line_chars or " " not in b:
            out.append(b)
            continue
        spaces = [i for i, ch in enumerate(b) if ch == " "]
        cut = min(spaces, key=lambda i: abs(i - len(b) / 2) - (3 if b[i - 1] in ",." else 0))
        out.append(b[:cut] + "\n" + b[cut + 1:])
    return out


def ken_burns(src: Path, out: Path, length: float, mode: str) -> str:
    n = max(1, round(length * FPS))
    z, x, y = "1.08", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    if mode == "in":
        z = f"1+0.10*on/{n}"
    elif mode == "out":
        z = f"1.10-0.10*on/{n}"
    elif mode == "left":
        x = f"(iw-iw/zoom)*(1-on/{n})"
    else:
        x = f"(iw-iw/zoom)*on/{n}"
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
          f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={FPS},format=yuv420p")
    ws.run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(src), "-vf", vf, "-frames:v", str(n),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(out)])
    return f"이미지 움직임({mode})"


def board_fallback(sc: dict, n: int, renderer, out: Path, s0: float, v0: float, v1: float,
                   length: float) -> str:
    raw = {"scene": sc.get("fallback", "board"), "items": sc.get("screen_text") or [],
           "icon": sc.get("icon", "woman-office-worker-default"), "color": sc.get("color", "yellow")}
    prepared = scn.prepare_scene(raw, n, renderer, "yellow")
    frames = (renderer.frame(prepared, max(0.0, s0 + f / FPS - v0),
                             min(1.0, max(0.0, (s0 + f / FPS - v0) / (v1 - v0))), 0)
              for f in range(max(1, round(length * FPS))))
    ws.encode_frames(frames, out)
    return "대체 장면(전광판)"


def write_kit(spec: dict, style: dict, scenes: list, media_dir: Path, proj: Path) -> None:
    character = spec.get("character") or style["character"]
    look = style["look"] + (", " + spec["style"] if spec.get("style") else "")
    rows = [f"# {spec['topic']} — 장면 이미지 만들기", "",
            "## 순서", "",
            "1. 먼저 아래 **캐릭터 시트**를 한 장 만듭니다. 마음에 드는 결과를 저장해 두세요.",
            "2. 장면마다 캐릭터 시트 이미지를 **참조 이미지로 첨부**하고 장면 프롬프트를 넣어 세로(9:16) 이미지를 만듭니다.",
            "   - 추천: Gemini 앱의 Nano Banana Pro(한글 글자를 잘 씀), ChatGPT 이미지 생성",
            "   - 이미지 속 한글 숫자가 틀리면 그 부분만 고쳐 달라고 다시 요청하세요.",
            "3. (선택) Kling·Veo 같은 도구에서 이미지를 시작 프레임으로 넣고 움직임 프롬프트로 5초 영상을 만듭니다.",
            "   영상이 없으면 이미지에 천천히 움직이는 효과가 자동으로 들어갑니다.",
            "4. 만든 파일을 장면 순서대로 대화창에 올리세요. 이름에 `S03`처럼 번호를 넣으면 그 장면에 들어갑니다.", "",
            "## 캐릭터 시트", "", "```text",
            f"Character reference sheet of {character}. Front view, three-quarter view and back view side by side, "
            "full body, neutral friendly expression, plain light gray background, consistent proportions, no text.",
            "```", ""]
    for i, sc in enumerate(scenes, 1):
        have = find_media(media_dir, i)
        texts = sc.get("screen_text") or []
        text_part = ""
        if texts:
            quoted = ", ".join(f'"{t}"' for t in texts)
            text_part = (f" Korean text clearly visible {sc.get('screen_where', 'on a large digital display in the scene')}: "
                         f"{quoted} (exact characters, no other text).")
        rows += [f"## S{i:02d} · {sc['_len']:.1f}초" + (f"  ✅ {have.name}" if have else ""), "",
                 "내레이션: " + " ".join(sc["lines"]), "", "이미지 프롬프트:", "```text",
                 f"Use the attached character reference and keep the character exactly the same. "
                 f"{sc.get('image', '')}.{text_part} {look}.", "```"]
        if sc.get("motion"):
            rows += ["움직임 프롬프트(선택):", "```text",
                     f"{sc['motion']}. Keep the character's appearance and all on-screen text unchanged, "
                     "smooth subtle camera movement, 5 seconds.", "```"]
        rows.append("")
    (proj / "prompts.md").write_text("\n".join(rows), encoding="utf-8")
    cap = [spec.get("caption", "").strip(), "", " ".join(spec.get("hashtags", []))]
    if spec.get("date"):
        cap += ["", f"※ 영상 속 수치는 {spec['date']} 기준입니다."]
    if spec.get("note"):
        cap += ["", spec["note"]]
    (proj / "caption.txt").write_text("\n".join(cap).strip() + "\n", encoding="utf-8")


def frame_of(src: Path) -> "Image.Image":
    """이미지 파일이나 영상의 첫 장면을 1080x1920으로 꽉 차게 맞춰 돌려준다."""
    from io import BytesIO

    from PIL import Image, ImageOps

    if src.suffix.lower() in ws.IMAGE_EXT:
        im = Image.open(src).convert("RGB")
    else:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "0.5", "-i", str(src), "-frames:v", "1",
                              "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
        im = Image.open(BytesIO(raw)).convert("RGB")
    return ImageOps.fit(im, (W, H), Image.LANCZOS)


def make_cover(spec: dict, bg, out: Path, font_path: str) -> None:
    """레퍼런스형 표지: 아래쪽 어두운 붓터치 띠 위에 2줄 제목(핵심어 노랑·민트), 위에 라벨, 아래에 시리즈 표시."""
    import random

    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    cv = spec.get("cover") or {}
    lines = cv.get("lines") or [spec["topic"]]
    marks = cv.get("highlight") or []
    colors = [(255, 213, 74), (94, 242, 214)]
    im = bg.convert("RGBA")
    band = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(band)
    top, bottom = 1180, 1180 + 150 * len(lines) + 120
    rnd = random.Random(7)
    for k in range(60):  # 거친 붓터치 띠
        y = rnd.uniform(top, bottom)
        h = rnd.uniform(40, 110)
        x0, x1 = rnd.uniform(-40, 60), rnd.uniform(W - 60, W + 40)
        d.rounded_rectangle([x0, y - h / 2, x1, y + h / 2], int(h / 2), fill=rnd.randint(170, 235))
    band = band.filter(ImageFilter.GaussianBlur(3))
    im.alpha_composite(Image.composite(Image.new("RGBA", (W, H), (12, 12, 16, 255)),
                                       Image.new("RGBA", (W, H), (0, 0, 0, 0)), band))
    d = ImageDraw.Draw(im)
    if cv.get("label"):
        f = ImageFont.truetype(font_path, 44)
        w = f.getlength(cv["label"]) + 40
        d.rectangle([W / 2 - w / 2, top - 70, W / 2 + w / 2, top - 14], fill=(20, 20, 26, 235))
        d.text((W / 2, top - 42), cv["label"], font=f, fill=(255, 255, 255), anchor="mm")
    y = top + 95
    for line in lines:
        size = 128
        f = ImageFont.truetype(font_path, size)
        while f.getlength(line) > W - 90 and size > 60:
            size -= 6
            f = ImageFont.truetype(font_path, size)
        parts, rest = [], line
        while rest:  # 핵심어를 색으로 구분
            hit = min(((rest.find(m), m) for m in marks if m and rest.find(m) >= 0), default=None)
            if not hit:
                parts.append((rest, None))
                break
            i, m = hit
            if i:
                parts.append((rest[:i], None))
            parts.append((m, colors[marks.index(m) % 2]))
            rest = rest[i + len(m):]
        x = W / 2 - f.getlength(line) / 2
        for text, col in parts:
            d.text((x, y), text, font=f, fill=col or (255, 255, 255), anchor="lm",
                   stroke_width=8, stroke_fill=(0, 0, 0))
            x += f.getlength(text)
        y += size + 22
    if cv.get("series"):
        f = ImageFont.truetype(font_path, 42)
        w = f.getlength(cv["series"]) + 56
        d.rounded_rectangle([W / 2 - w / 2, y + 10, W / 2 + w / 2, y + 78], 34, fill=(122, 31, 43, 245))
        d.text((W / 2, y + 44), cv["series"], font=f, fill=(255, 255, 255), anchor="mm")
    im.convert("RGB").save(out, quality=92)


def cmd_render(a) -> None:
    spec, style = load_spec(a.spec), load_style()
    topic, slug = spec["topic"], ms.slugify(spec["topic"])
    proj = ROOT / slug
    media_dir, work = proj / "media", proj / "work"
    media_dir.mkdir(parents=True, exist_ok=True)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    if Path(a.spec).resolve() != (proj / "spec.json").resolve():
        shutil.copy(a.spec, proj / "spec.json")
    font = ms.find_font()
    sub_style = {**style["subtitle"], **spec.get("subtitle", {})}
    warnings: list[str] = []

    # 1) 내레이션
    ms.LEAD, ms.GAP, ms.TAIL = 0.15, 0.22, 0.6
    sentences, owner = [], []
    for i, sc in enumerate(spec["scenes"]):
        for line in sc["lines"]:
            if str(line).strip():
                sentences.append(str(line).strip())
                owner.append(i)
    sid = a.voice if a.voice is not None else int(spec.get("voice", style["voice"]))
    tts, why = ms.pick_tts(a.tts, sid, work)
    if why:
        warnings.append(why)
    speed = a.speed or spec.get("speed") or style["speed"]
    target = a.target or spec.get("target", 45.0)
    ms.log(f"내레이션 합성({tts.name}, 속도 {speed:.2f})")
    says = spec.get("say", {})
    clips, speed = ms.synthesize(tts, [says.get(s, s) for s in sentences], speed, target, work,
                                 check_texts=sentences)
    starts, bounds, total, voice = ms.build_timeline(clips)
    asr = ms.asr_check(clips, sentences)

    # 2) 장면 구간과 자막
    scenes = [dict(sc) for sc in spec["scenes"]]
    first = {}
    for k, i in enumerate(owner):
        first.setdefault(i, k)
    for i, sc in enumerate(scenes):
        sc["_v0"] = bounds[first[i]] if i else 0.0
    for i, sc in enumerate(scenes):
        sc["_v1"] = scenes[i + 1]["_v0"] if i + 1 < len(scenes) else total
        sc["_len"] = sc["_v1"] - sc["_v0"]
    cues = []
    for k, s in enumerate(sentences):
        blocks = sub_blocks(s, sub_style["line_chars"])
        weights = [len(b.replace(" ", "").replace("\n", "")) for b in blocks]
        t, dur = starts[k], len(clips[k]) / ms.SR
        for b, wt in zip(blocks, weights):
            d = dur * wt / sum(weights)
            cues.append((t, t + d, b))
            t += d

    # 3) 장면 영상
    icons = scn.Icons(ms.ICON_DIR, ms.ASSETS / "icons" / "png")
    renderer = scn.Renderer(font, icons, accent="yellow")
    renderer.progress = False
    segs, report = [], []
    for i, sc in enumerate(scenes, 1):
        s0 = max(0.0, sc["_v0"] - XF / 2)
        s1 = sc["_v1"] + XF / 2 if i < len(scenes) else total
        out = work / f"seg{i:02d}.mp4"
        src = find_media(media_dir, i)
        if src and src.suffix.lower() in ws.IMAGE_EXT:
            note = ken_burns(src, out, s1 - s0, sc.get("move", KB_MODES[(i - 1) % len(KB_MODES)]))
        elif src:
            note = ws.segment_from_video(src, out, s1 - s0, float(sc.get("clip_start", 0)))
        else:
            note = board_fallback(sc, i, renderer, out, s0, sc["_v0"], sc["_v1"], s1 - s0)
        segs.append((out, s0))
        report.append(f"S{i:02d} {sc['_len']:.1f}초 {('[' + src.name + ']') if src else ''} {note}")
        ms.log(report[-1])
    warnings += renderer.warnings
    visual = work / "visual.mp4"
    ms.log("장면 잇기")
    ws.join_segments(segs, None, 0, visual)

    # 4) 자막·음성 합성
    voice_wav = work / "voice.wav"
    ms.write_wav(voice_wav, voice)
    srt = work / "subtitle.srt"
    srt.write_text("\n".join(f"{n}\n{ms.srt_time(x)} --> {ms.srt_time(y)}\n{b}\n"
                             for n, (x, y, b) in enumerate(cues, 1)), encoding="utf-8")
    bgm_arg = a.bgm or spec.get("bgm")
    bgm = Path(bgm_arg) if bgm_arg else None
    if bgm and not bgm.exists():
        warnings.append(f"배경음악 파일 없음: {bgm}")
        bgm = None
    final = proj / f"{slug}.mp4"
    ms.log("자막·음성 합성(MoneyPrinterTurbo)")
    ms.compose(visual, voice_wav, srt, final, topic, style=sub_style, bgm=bgm, bgm_volume=0.1)

    # 5) 점검과 결과물
    write_kit(spec, style, scenes, media_dir, proj)
    info = ms.probe(final)
    sheet = proj / "sheet.jpg"
    times = ms.contact_sheet(final, sheet, font=font)
    sub_font = ms.MPT_DIR / "resource" / "fonts" / sub_style.get("font", ms.FONT_NAME)
    cover_font = ms.MPT_DIR / "resource" / "fonts" / "Pretendard-Black.otf"
    if not cover_font.exists():
        cover_font = sub_font if sub_font.exists() else Path(font)
    cover_src = find_media(media_dir, int((spec.get("cover") or {}).get("scene", 1)))
    make_cover(spec, frame_of(cover_src or visual), proj / "cover.jpg", str(cover_font))
    miss = ms.missing_glyphs(str(sub_font) if sub_font.exists() else font, "".join(sentences))
    if miss:
        warnings.append(f"폰트에 없는 글자(자막 깨짐): {' '.join(miss)}")
    if asr:
        for k, r in enumerate(asr, 1):
            if r["score"] < 0.75:
                warnings.append(f"문장 {k} 발음 확인 필요(일치도 {r['score']}): 들린 말 '{r['heard']}'"
                                " → spec의 say에 읽는 법 추가")
    chars = sum(len(re.sub(r"\s", "", s)) for s in sentences)
    if total < target - 5:
        warnings.append(f"내레이션 {total:.1f}초로 짧음(대본 {chars}자): 45초 ≈ 320자")
    elif total > target + 8:
        warnings.append(f"내레이션 {total:.1f}초로 김(대본 {chars}자)")
    for i, sc in enumerate(scenes, 1):
        if sc["_len"] > 7.5:
            warnings.append(f"S{i:02d}가 {sc['_len']:.1f}초로 김: 장면을 나누면 덜 지루합니다")
    missing = [i for i in range(1, len(scenes) + 1) if not find_media(media_dir, i)]
    qa = {"video": str(final), "sheet": str(sheet), "cover": str(proj / "cover.jpg"),
          "prompts": str(proj / "prompts.md"),
          "caption": str(proj / "caption.txt"), "media_dir": str(media_dir), "missing_media": missing,
          **info, "chars": chars, "tts": tts.name, "speed": round(speed, 2), "scenes": report,
          "subtitles": [{"start": round(x, 2), "end": round(y, 2), "text": b} for x, y, b in cues],
          "asr": asr, "warnings": warnings}
    (proj / "qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    if not a.keep_work:
        shutil.rmtree(work, ignore_errors=True)

    print("\n===== 결과 =====")
    print(f"영상: {final}  ({info['duration']}초, {info['width']}x{info['height']})")
    print(f"장면 확인용: {sheet}  ({', '.join(f'{t:g}s' for t in times)})")
    print(f"이미지 프롬프트: {proj / 'prompts.md'} / 게시 캡션: {proj / 'caption.txt'} / 표지: {proj / 'cover.jpg'}")
    print(f"장면 파일 폴더: {media_dir}  (넣은 파일 {len(scenes) - len(missing)}/{len(scenes)}개)")
    print(f"음성: {tts.name} (속도 {speed:.2f}) / 대본 {chars}자 / 장면 {len(scenes)}개 / 자막 {len(cues)}개")
    if asr:
        print("발음 검사(음성인식 일치도):")
        for k, r in enumerate(asr, 1):
            print(f"  {k}. {r['score']:.2f}  {r['text']}  ← 들린 말: {r['heard']}")
    print("경고:" if warnings else "경고: 없음")
    for w in warnings:
        print(f"  - {w}")


def cmd_add(a) -> None:
    """올린 파일을 media/Snn.확장자로 복사한다. 이름에 S03 같은 번호가 있으면 그 장면에, 없으면 빈 장면부터."""
    spec = load_spec(a.spec)
    media_dir = ROOT / ms.slugify(spec["topic"]) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    n_sc = len(spec["scenes"])
    nxt = a.start or 1
    for f in map(Path, a.files):
        if f.suffix.lower() not in ws.CLIP_EXT:
            print(f"건너뜀(영상/이미지 아님): {f.name}")
            continue
        m = re.search(r"(?:^|[^A-Za-z0-9])[Ss](\d{1,2})(?=\D|$)", f.stem)
        if m and not a.start:
            n = int(m.group(1))
        else:
            while nxt <= n_sc and find_media(media_dir, nxt):
                nxt += 1
            n, nxt = nxt, nxt + 1
        if not 1 <= n <= n_sc:
            print(f"건너뜀(장면 번호 {n}이 범위 밖): {f.name}")
            continue
        old = find_media(media_dir, n)
        if old:
            old.unlink()
        dst = media_dir / f"S{n:02d}{f.suffix.lower()}"
        shutil.copy(f, dst)
        print(f"{f.name} → {dst.name}")
    have = [i for i in range(1, n_sc + 1) if find_media(media_dir, i)]
    print(f"장면 파일 {len(have)}/{n_sc}개 준비됨. 비어 있는 장면: "
          f"{', '.join(f'S{i:02d}' for i in range(1, n_sc + 1) if i not in have) or '없음'}")


def main() -> None:
    p = argparse.ArgumentParser(description="경제 해부형 쇼츠 조립")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render", help="spec(JSON)과 media/로 영상 조립")
    r.add_argument("spec")
    r.add_argument("--tts", choices=["auto", "edge", "local"], default="auto")
    r.add_argument("--voice", type=int, default=None, help="Supertonic 목소리 0~9 (0~4 여성, 5~9 남성)")
    r.add_argument("--speed", type=float, default=None)
    r.add_argument("--target", type=float, default=None, help="내레이션 목표 길이(초, 기본 45)")
    r.add_argument("--bgm", default=None, help="배경음악 파일(mp3 등)")
    r.add_argument("--keep-work", action="store_true")
    r.set_defaults(func=cmd_render)
    ad = sub.add_parser("add", help="올린 이미지/클립을 media/Snn 으로 복사")
    ad.add_argument("spec")
    ad.add_argument("files", nargs="+")
    ad.add_argument("--start", type=int, default=None, help="이 장면 번호부터 순서대로 넣기")
    ad.set_defaults(func=cmd_add)
    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
