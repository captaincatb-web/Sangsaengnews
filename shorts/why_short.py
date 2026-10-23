#!/usr/bin/env python3
"""시네마틱 설명형 쇼츠 조립기.

스타일: 사실적인 AI 영상 컷 + 네온 강조, 컷마다 짧은 중앙 자막, 컷 사이 크로스페이드,
작은 워터마크, 마지막 엔딩 카드, 빠른 남성 내레이션(약 45초).

  shorts/why.sh render <spec.json>

클립은 output/why/<주제>/clips/C01.mp4, C02.png … 로 둔다. 없는 컷은 네온 장면으로 채우고,
컷별 AI 영상 프롬프트(prompts.md)를 함께 만든다. 클립을 넣고 다시 render하면 완성본이 된다.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_short as ms  # noqa: E402
import scenes as scn  # noqa: E402

ROOT = ms.REPO / "output" / "why"
W, H, FPS = scn.W, scn.H, ms.FPS
XF = 0.3  # 컷 사이 크로스페이드(초)
END_CARD = 2.8  # 엔딩 카드 길이(초)
DEFAULT_SID = 8  # Supertonic 남성 목소리(레퍼런스와 음높이가 비슷)
SUB_STYLE = dict(font_size=66, stroke_width=3, custom_position=64.0)
STYLE = ("photorealistic cinematic shot, vertical 9:16, dark moody environment, wet reflective surfaces, "
         "volumetric light, high contrast, shallow depth of field, slow forward dolly camera, "
         "ultra detailed, no text, no letters, no logos, no watermark")
NEON = "the key element outlined and highlighted with glowing {} neon light"
CLIP_EXT = (".mp4", ".mov", ".webm", ".mkv", ".png", ".jpg", ".jpeg", ".webp")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} 실패: {r.stderr[-500:]}")
    return r


def load_spec(path: str) -> dict:
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    lines = spec.get("lines") or []
    if not lines:
        raise SystemExit("spec에 lines가 없습니다.")
    for i, line in enumerate(lines, 1):
        if not line.get("cuts"):
            raise SystemExit(f"문장 {i}: cuts가 없습니다.")
        for c in line["cuts"]:
            if not str(c.get("text", "")).strip():
                raise SystemExit(f"문장 {i}: 자막(text)이 빈 컷이 있습니다.")
    spec.setdefault("topic", lines[0]["cuts"][0]["text"])
    return spec


def find_clip(clips_dir: Path, n: int) -> Path | None:
    for ext in CLIP_EXT:
        for name in (f"C{n:02d}{ext}", f"C{n:02d}{ext.upper()}"):
            p = clips_dir / name
            if p.exists():
                return p
    return None


# ---------------------------------------------------------------- 시간 계산
def build_cuts(spec, clips, starts, bounds, total):
    cuts = []
    for k, line in enumerate(spec["lines"]):
        st, dur = starts[k], len(clips[k]) / ms.SR
        weights = [max(1, len(c["text"].replace(" ", ""))) for c in line["cuts"]]
        t = st
        for j, (c, wt) in enumerate(zip(line["cuts"], weights)):
            d = dur * wt / sum(weights)
            cuts.append({**c, "line": k, "sub": (t, t + d), "v0": bounds[k] if j == 0 else t})
            t += d
    for i, c in enumerate(cuts):
        c["v1"] = cuts[i + 1]["v0"] if i + 1 < len(cuts) else total
        c["n"] = i + 1
    return cuts


# ---------------------------------------------------------------- 컷 영상
def segment_from_video(src: Path, out: Path, length: float, start: float = 0.0) -> str:
    avail = max(0.1, ms.probe(src)["duration"] - start)
    vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p"
    pre, note = [], "그대로"
    if avail < length <= avail * 1.6:
        vf = f"setpts=PTS*{length / avail:.4f}," + vf
        note = f"{length / avail:.2f}배 느리게"
    elif length > avail * 1.6:
        pre, note = ["-stream_loop", "-1"], "반복"
    run(["ffmpeg", "-y", "-v", "error", *pre, "-ss", f"{start:.3f}", "-i", str(src), "-an", "-vf", vf,
         "-t", f"{length:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(out)])
    return note


def segment_from_image(src: Path, out: Path, length: float) -> str:
    n = max(1, round(length * FPS))
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
          f"zoompan=z='1+0.12*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},"
          "format=yuv420p")
    run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(src), "-vf", vf, "-frames:v", str(n),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(out)])
    return "이미지 확대"


def encode_frames(frames, out: Path) -> None:
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    for img in frames:
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg 인코딩 실패")


def segment_fallback(cut, renderer, out: Path, s0: float, length: float, accent) -> str:
    raw = {k: v for k, v in cut.items() if k in ("scene", "icon", "icons", "labels", "items", "values",
                                                  "unit", "number", "caption", "direction", "label",
                                                  "packet", "arrow", "color")}
    raw.setdefault("scene", "neon")
    raw.setdefault("color", cut.get("neon") or accent)
    sc = scn.prepare_scene(raw, cut["n"], renderer, accent)
    span = cut["v1"] - cut["v0"]
    n = max(1, round(length * FPS))
    encode_frames((renderer.frame(sc, max(0.0, s0 + f / FPS - cut["v0"]),
                                  min(1.0, max(0.0, (s0 + f / FPS - cut["v0"]) / span)), 0)
                   for f in range(n)), out)
    return f"대체 장면({raw['scene']})"


def end_card(last_seg: Path, out: Path, length: float, handle: str, font: str, icons) -> None:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-sseof", "-0.1", "-i", str(last_seg), "-frames:v", "1",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
    from io import BytesIO

    bg = ImageEnhance.Brightness(Image.open(BytesIO(raw)).convert("RGB").resize((W, H))).enhance(0.35)
    bell = icons.get(icons.resolve("bell") or icons.names[0], 220)
    f_big, f_small = scn.ImageFont.truetype(font, 64), scn.ImageFont.truetype(font, 44)
    frames = []
    n = max(1, round(length * FPS))
    for i in range(n):
        a = min(1.0, i / (0.5 * FPS))
        im = bg.convert("RGBA")
        layer = Image.new("RGBA", (W, H))
        layer.alpha_composite(bell, ((W - bell.width) // 2, 700))
        d = ImageDraw.Draw(layer)
        if handle:
            d.text((W / 2, 1000), handle, font=f_big, fill=(255, 255, 255), anchor="mm",
                   stroke_width=3, stroke_fill=(0, 0, 0))
        d.text((W / 2, 1090), "팔로우하고 더 알아보기", font=f_small, fill=(230, 230, 230), anchor="mm",
               stroke_width=2, stroke_fill=(0, 0, 0))
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * a)))
        im.alpha_composite(layer)
        frames.append(im.convert("RGB"))
    encode_frames(frames, out)


def watermark(handle: str, font: str, out: Path) -> None:
    f = scn.ImageFont.truetype(font, 34)
    w = int(f.getlength(handle)) + 20
    im = Image.new("RGBA", (w, 60))
    ImageDraw.Draw(im).text((10, 30), handle, font=f, fill=(255, 255, 255, 215), anchor="lm",
                            stroke_width=2, stroke_fill=(0, 0, 0, 150))
    im.save(out)


def join_segments(segs, wm: Path | None, wm_until: float, out: Path) -> None:
    """세그먼트를 크로스페이드로 잇고 워터마크를 얹는다. segs: [(path, 시작시각)]"""
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for p, _ in segs:
        cmd += ["-i", str(p)]
    if wm:
        cmd += ["-i", str(wm)]
    fc = [f"[{k}:v]settb=AVTB,fps={FPS},format=yuv420p[s{k}]" for k in range(len(segs))]
    prev = "[s0]"
    for k in range(1, len(segs)):
        fc.append(f"{prev}[s{k}]xfade=transition=fade:duration={XF}:offset={segs[k][1]:.3f}[x{k}]")
        prev = f"[x{k}]"
    if wm:
        fc.append(f"{prev}[{len(segs)}:v]overlay=W-w-50:430:enable='lt(t,{wm_until:.3f})'[out]")
        prev = "[out]"
    cmd += ["-filter_complex", ";".join(fc), "-map", prev, "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)]
    run(cmd)


# ---------------------------------------------------------------- 프롬프트 문서
def write_prompts(spec, cuts, clips_dir: Path, out: Path) -> None:
    style = STYLE + (", " + spec["style"] if spec.get("style") else "")
    rows = [f"# {spec['topic']} — 컷별 AI 영상 프롬프트", "",
            f"- 컷 {len(cuts)}개, 컷마다 세로(9:16) 영상 1개를 만듭니다. 각 컷에 적힌 길이 이상이면 됩니다.",
            "- 도구 예시: Google Flow(Veo), Kling, Hailuo, Runway, Sora 등. 텍스트→영상, 이미지→영상 모두 가능합니다.",
            "- 이미지로 만들어도 됩니다(천천히 확대되는 효과가 자동으로 들어갑니다).",
            "- 만든 파일을 컷 순서대로 대화창에 올리세요. 이름에 `C05`처럼 컷 번호를 넣으면 그 컷에 들어갑니다.",
            f"- 공통 스타일(아래 프롬프트에 이미 포함): {style}", ""]
    for c in cuts:
        have = find_clip(clips_dir, c["n"])
        prompt = c.get("prompt") or c["text"]
        if c.get("neon"):
            prompt += ", " + NEON.format(c["neon"])
        rows += [f"## C{c['n']:02d} · {c['v1'] - c['v0']:.1f}초 · \"{c['text']}\""
                 + (f"  ✅ {have.name}" if have else ""), "", "```text", f"{prompt}, {style}", "```", ""]
    out.write_text("\n".join(rows), encoding="utf-8")


# ---------------------------------------------------------------- 실행
def cmd_render(a) -> None:
    spec = load_spec(a.spec)
    topic, slug = spec["topic"], ms.slugify(spec["topic"])
    proj = ROOT / slug
    clips_dir, work = proj / "clips", proj / "work"
    clips_dir.mkdir(parents=True, exist_ok=True)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    if Path(a.spec).resolve() != (proj / "spec.json").resolve():
        shutil.copy(a.spec, proj / "spec.json")
    font = ms.find_font()
    warnings: list[str] = []
    accent = spec.get("accent", "red")
    handle = spec.get("handle", "")

    # 1) 내레이션: 문장 단위로 합성하고 컷 자막 시간을 나눈다
    ms.LEAD, ms.GAP, ms.TAIL = 0.15, 0.2, 0.35
    sid = a.voice if a.voice is not None else int(spec.get("voice", DEFAULT_SID))
    tts, why = ms.pick_tts(a.tts, sid, work)
    if why:
        warnings.append(why)
    texts = [" ".join(c["text"].strip() for c in line["cuts"]) for line in spec["lines"]]
    speech = [line.get("say") or t for line, t in zip(spec["lines"], texts)]
    speed = a.speed or spec.get("speed") or (1.15 if tts.name == "edge" else 1.2)
    target = a.target or spec.get("target", 42.0)
    ms.log(f"내레이션 합성({tts.name}, 속도 {speed:.2f})")
    clips, speed = ms.synthesize(tts, speech, speed, target, work, check_texts=texts)
    starts, bounds, total, voice = ms.build_timeline(clips)
    cuts = build_cuts(spec, clips, starts, bounds, total)
    asr = ms.asr_check(clips, texts)

    # 2) 컷 영상: 클립 → 맞춤, 없으면 대체 장면
    icons = scn.Icons(ms.ICON_DIR, ms.ASSETS / "icons" / "png")
    renderer = scn.Renderer(font, icons, accent=accent)
    renderer.progress = False
    segs, report = [], []
    for c in cuts:
        s0 = max(0.0, c["v0"] - XF / 2)
        length = c["v1"] + XF / 2 - s0
        out = work / f"seg{c['n']:02d}.mp4"
        src = find_clip(clips_dir, c["n"])
        if src and src.suffix.lower() in IMAGE_EXT:
            note = segment_from_image(src, out, length)
        elif src:
            note = segment_from_video(src, out, length, float(c.get("clip_start", 0)))
        else:
            note = segment_fallback(c, renderer, out, s0, length, accent)
        segs.append((out, s0))
        report.append(f"C{c['n']:02d} {c['v1'] - c['v0']:.1f}초 {('[' + src.name + ']') if src else ''} {note}")
        ms.log(report[-1])
    warnings += renderer.warnings
    end = work / "end.mp4"
    end_card(segs[-1][0], end, END_CARD + XF / 2, handle, font, icons)
    segs.append((end, total - XF / 2))
    wm = None
    if handle:
        wm = work / "wm.png"
        watermark(handle, font, wm)
    visual = work / "visual.mp4"
    ms.log("컷 잇기(크로스페이드)")
    join_segments(segs, wm, total, visual)

    # 3) 자막·음성 합성
    voice_full = np.concatenate([voice, np.zeros(int(END_CARD * ms.SR), np.float32)])
    voice_wav = work / "voice.wav"
    ms.write_wav(voice_wav, voice_full)
    srt = work / "subtitle.srt"
    srt.write_text("\n".join(f"{c['n']}\n{ms.srt_time(c['sub'][0])} --> {ms.srt_time(c['sub'][1])}\n"
                             f"{c['text'].rstrip('.,')}\n" for c in cuts), encoding="utf-8")
    bgm = Path(a.bgm or spec.get("bgm") or "") if (a.bgm or spec.get("bgm")) else None
    if bgm and not bgm.exists():
        warnings.append(f"배경음악 파일 없음: {bgm}")
        bgm = None
    final = proj / f"{slug}.mp4"
    ms.log("자막·음성 합성(MoneyPrinterTurbo)")
    ms.compose(visual, voice_wav, srt, final, topic, style=SUB_STYLE, bgm=bgm, bgm_volume=0.12)

    # 4) 점검
    write_prompts(spec, cuts, clips_dir, proj / "prompts.md")
    info = ms.probe(final)
    sheet = proj / "sheet.jpg"
    times = ms.contact_sheet(final, sheet, font=font)
    miss = ms.missing_glyphs(font, "".join(texts) + handle)
    if miss:
        warnings.append(f"폰트에 없는 글자(자막 깨짐): {' '.join(miss)}")
    for c in cuts:
        if len(c["text"]) > 15:
            warnings.append(f"C{c['n']:02d} 자막이 김({len(c['text'])}자, 15자 이하 권장): {c['text']}")
    if asr:
        for i, r in enumerate(asr, 1):
            if r["score"] < 0.75:
                warnings.append(f"문장 {i} 발음 확인 필요(일치도 {r['score']}): 들린 말 '{r['heard']}' → say 추가")
    chars = sum(len(re.sub(r"\s", "", t)) for t in texts)
    if total < target - 4:
        warnings.append(f"내레이션 {total:.1f}초로 짧음(대본 {chars}자): 문장을 늘리세요(42초 ≈ 300자)")
    elif total > target + 5:
        warnings.append(f"내레이션 {total:.1f}초로 김(대본 {chars}자): 문장을 줄이세요")
    missing = [c["n"] for c in cuts if not find_clip(clips_dir, c["n"])]
    qa = {"video": str(final), "sheet": str(sheet), "prompts": str(proj / "prompts.md"),
          "clips_dir": str(clips_dir), "missing_clips": missing, **info, "chars": chars,
          "tts": tts.name, "speed": round(speed, 2), "cuts": report,
          "asr": asr, "warnings": warnings}
    (proj / "qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    if not a.keep_work:
        shutil.rmtree(work, ignore_errors=True)

    print("\n===== 결과 =====")
    print(f"영상: {final}  ({info['duration']}초, {info['width']}x{info['height']})")
    print(f"장면 확인용: {sheet}  ({', '.join(f'{t:g}s' for t in times)})")
    print(f"컷별 AI 영상 프롬프트: {proj / 'prompts.md'}")
    print(f"클립 폴더: {clips_dir}  (넣은 클립 {len(cuts) - len(missing)}/{len(cuts)}개)")
    print(f"음성: {tts.name} (속도 {speed:.2f}) / 대본 {chars}자 / 컷 {len(cuts)}개")
    if asr:
        print("발음 검사(음성인식 일치도):")
        for i, r in enumerate(asr, 1):
            print(f"  {i}. {r['score']:.2f}  {r['text']}  ← 들린 말: {r['heard']}")
    print("경고:" if warnings else "경고: 없음")
    for w in warnings:
        print(f"  - {w}")


def cmd_add(a) -> None:
    """올린 파일을 clips/Cnn.확장자로 복사한다. 이름에 C05 같은 번호가 있으면 그 컷에, 없으면 빈 컷부터 차례로."""
    spec = load_spec(a.spec)
    clips_dir = ROOT / ms.slugify(spec["topic"]) / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    n_cuts = sum(len(line["cuts"]) for line in spec["lines"])
    nxt = a.start or 1
    for f in map(Path, a.files):
        if f.suffix.lower() not in CLIP_EXT:
            print(f"건너뜀(영상/이미지 아님): {f.name}")
            continue
        m = re.search(r"(?:^|[^A-Za-z0-9])[Cc](\d{1,2})(?=\D|$)", f.stem)
        if m and not a.start:
            n = int(m.group(1))
        else:
            while nxt <= n_cuts and find_clip(clips_dir, nxt):
                nxt += 1
            n, nxt = nxt, nxt + 1
        if not 1 <= n <= n_cuts:
            print(f"건너뜀(컷 번호 {n}이 범위 밖): {f.name}")
            continue
        old = find_clip(clips_dir, n)
        if old:
            old.unlink()
        dst = clips_dir / f"C{n:02d}{f.suffix.lower()}"
        shutil.copy(f, dst)
        print(f"{f.name} → {dst.name}")
    have = [i for i in range(1, n_cuts + 1) if find_clip(clips_dir, i)]
    print(f"클립 {len(have)}/{n_cuts}개 준비됨. 비어 있는 컷: "
          f"{', '.join(f'C{i:02d}' for i in range(1, n_cuts + 1) if i not in have) or '없음'}")


def main() -> None:
    p = argparse.ArgumentParser(description="시네마틱 설명형 쇼츠 조립")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render", help="spec(JSON)과 clips/로 영상 조립")
    r.add_argument("spec")
    r.add_argument("--tts", choices=["auto", "edge", "local"], default="auto")
    r.add_argument("--voice", type=int, default=None,
                   help=f"Supertonic 목소리 0~9 (0~4 여성, 5~9 남성, 기본 {DEFAULT_SID})")
    r.add_argument("--speed", type=float, default=None)
    r.add_argument("--target", type=float, default=None, help="내레이션 목표 길이(초, 기본 42)")
    r.add_argument("--bgm", default=None, help="배경음악 파일(mp3 등)")
    r.add_argument("--keep-work", action="store_true")
    r.set_defaults(func=cmd_render)
    ad = sub.add_parser("add", help="올린 클립을 clips/Cnn 으로 복사")
    ad.add_argument("spec")
    ad.add_argument("files", nargs="+")
    ad.add_argument("--start", type=int, default=None, help="이 컷 번호부터 순서대로 넣기")
    ad.set_defaults(func=cmd_add)
    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
