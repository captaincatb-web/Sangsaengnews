#!/usr/bin/env python3
"""주제 하나로 세로 쇼츠(9:16, 약 30초)를 만드는 도구. MoneyPrinterTurbo 위에서 동작한다.

  shorts/run.sh render spec.json   영상 생성 (spec 형식: shorts/README.md)
  shorts/run.sh icons robot chart  아이콘 이름 검색
  shorts/run.sh doctor             설치/네트워크 상태 점검

음성은 Edge TTS(접속 가능할 때) 또는 로컬 Supertonic, 화면은 Pixabay 영상(접속 가능할
때) 또는 아이콘 애니메이션을 자동으로 고른다. 자막 합성은 MoneyPrinterTurbo가 한다.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
import uuid
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scenes as scn  # noqa: E402

REPO = HERE.parent
MPT_DIR = Path(os.environ.get("MPT_DIR", Path.home() / "MoneyPrinterTurbo"))
ASSETS = Path(os.environ.get("SHORTS_ASSETS", Path.home() / ".cache" / "shorts"))
TTS_DIR = ASSETS / "models" / "sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
ASR_DIR = ASSETS / "models" / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
ICON_DIR = ASSETS / "icons" / "modern"
FONT_NAME = "NanumGothicBold.ttf"
OUT_ROOT = REPO / "output" / "shorts"

FPS = 30
SR = 44100
LEAD, GAP, TAIL = 0.2, 0.28, 0.7  # 처음 / 문장 사이 / 끝 무음(초)
EDGE_VOICE = "ko-KR-SunHiNeural"
DEFAULT_SID = 2  # Supertonic 여성 목소리 중 음성인식 일치도가 가장 높았던 번호
SUB = dict(font_size=120, stroke_width=7, custom_position=75.0, max_chars=9)


def log(msg: str) -> None:
    print(f"[shorts] {msg}", flush=True)


# ---------------------------------------------------------------- 한국어 읽기
_SINO = "영일이삼사오육칠팔구"
_NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
_NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]
# 고유어 수사로 읽는 단위(1~99). "개월"처럼 한자어로 읽는 예외는 먼저 거른다.
_NATIVE_COUNTERS = ("개", "명", "잔", "마리", "살", "시간", "시", "번", "가지", "곳", "권",
                    "대", "병", "사람", "송이", "장", "채", "켤레", "그루", "달", "군데",
                    "벌", "쌍", "배", "줄", "바퀴", "걸음")
_SINO_EXCEPTIONS = ("개월", "번지", "시즌", "대학", "시대")
_UNITS = {"%": "퍼센트", "kWh": "킬로와트시", "kW": "킬로와트", "GHz": "기가헤르츠",
          "MHz": "메가헤르츠", "TB": "테라바이트", "GB": "기가바이트", "MB": "메가바이트",
          "mg": "밀리그램", "kg": "킬로그램", "km": "킬로미터", "cm": "센티미터",
          "mm": "밀리미터", "nm": "나노미터", "ml": "밀리리터", "g": "그램", "m": "미터",
          "W": "와트", "℃": "도", "°C": "도"}
_LETTERS = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 "
                    "에스 티 유 브이 더블유 엑스 와이 제트".split()))
_NUM_RE = re.compile(
    r"(\d+(?:\.\d+)?)(\s*)(kWh|kW|GHz|MHz|TB|GB|MB|mg|kg|km|cm|mm|nm|ml|°C|℃|%"
    r"|g(?![A-Za-z])|m(?![A-Za-z])|W(?![A-Za-z]))?")


def sino(n: int) -> str:
    if n == 0:
        return "영"
    out = []
    for i, big in enumerate(["", "만", "억", "조", "경"]):
        n, chunk = divmod(n, 10000)
        if chunk:
            s = ""
            for j, small in ((3, "천"), (2, "백"), (1, "십"), (0, "")):
                d = chunk // 10 ** j % 10
                if d:
                    s += ("" if d == 1 and j else _SINO[d]) + small
            out.append(("" if i == 1 and chunk == 1 else s) + big)
        if n == 0:
            break
    return "".join(reversed(out))


def native(n: int) -> str:
    return "스무" if n == 20 else _NATIVE_TENS[n // 10] + _NATIVE_ONES[n % 10]


def read_number(num: str) -> str:
    whole, _, frac = num.partition(".")
    s = sino(int(whole))
    return s + ("점" + "".join(_SINO[int(c)] for c in frac) if frac else "")


def _number(m: re.Match) -> str:
    num, space, unit = m.groups()
    if unit:
        return read_number(num) + _UNITS[unit]
    rest = m.string[m.end():]
    if "." not in num and 1 <= int(num) <= 99 and not rest.startswith(_SINO_EXCEPTIONS):
        n = int(num)
        for c in _NATIVE_COUNTERS:
            if rest.startswith(c) and not (c == "대" and n % 10 == 0):
                return native(n) + " "
    return read_number(num) + space


def to_speech(text: str) -> str:
    """TTS가 잘 읽도록 숫자·단위·영문 약어를 한글 읽기로 바꾼다. 자막은 원문을 쓴다."""
    s = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", text)
    s = re.sub(r"\$\s?(\d[\d.]*)", r"\1달러", s)
    s = re.sub(r"(\d)\s*~\s*(\d)", r"\1에서 \2", s)
    s = _NUM_RE.sub(_number, s)
    s = re.sub(r"(?<![A-Za-z])[A-Z]{1,5}(?![A-Za-z])",
               lambda m: "".join(_LETTERS[c] for c in m.group()), s)
    return s.replace("+", " 플러스 ").replace("&", " 앤드 ").replace("→", " ").replace("·", " ")


def _cmp_norm(s: str) -> str:
    return re.sub(r"[^가-힣a-z]", "", to_speech(s).lower())


def similarity(expected: str, heard: str) -> float:
    return difflib.SequenceMatcher(None, _cmp_norm(expected), _cmp_norm(heard)).ratio()


# ---------------------------------------------------------------- 음성
def trim_silence(x: np.ndarray, thr=0.01, pad=0.04) -> np.ndarray:
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    p = int(pad * SR)
    return x[max(0, idx[0] - p): idx[-1] + p]


def decode_audio(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


class LocalTTS:
    name = "local"

    def __init__(self, sid: int):
        import sherpa_onnx

        self.so = sherpa_onnx
        self.sid = sid
        d = TTS_DIR
        cfg = sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=str(d / "duration_predictor.int8.onnx"),
            text_encoder=str(d / "text_encoder.int8.onnx"),
            vector_estimator=str(d / "vector_estimator.int8.onnx"),
            vocoder=str(d / "vocoder.int8.onnx"),
            tts_json=str(d / "tts.json"),
            unicode_indexer=str(d / "unicode_indexer.bin"),
            voice_style=str(d / "voice.bin"),
        )
        self.tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(supertonic=cfg, num_threads=os.cpu_count() or 2)))

    def synth(self, text: str, speed: float, work: Path, idx: int) -> np.ndarray:
        g = self.so.GenerationConfig()
        g.sid, g.num_steps, g.speed = self.sid, 8, speed
        g.extra["lang"] = "ko"
        a = self.tts.generate(to_speech(text), g)
        x = np.asarray(a.samples, np.float32)
        if a.sample_rate != SR:
            n = int(len(x) * SR / a.sample_rate)
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
        return trim_silence(x)


class EdgeTTS:
    name = "edge"

    def synth(self, text: str, speed: float, work: Path, idx: int) -> np.ndarray:
        import edge_tts

        out = work / f"edge_{idx}.mp3"
        rate = f"{round((speed - 1) * 100):+d}%"

        async def go():
            c = edge_tts.Communicate(text, EDGE_VOICE, rate=rate,
                                     proxy=os.environ.get("HTTPS_PROXY") or None)
            await asyncio.wait_for(c.save(str(out)), timeout=60)

        asyncio.run(go())
        return trim_silence(decode_audio(out))


def pick_tts(mode: str, sid: int, work: Path):
    if mode in ("auto", "edge"):
        try:
            EdgeTTS().synth("테스트", 1.0, work, 999)
            return EdgeTTS(), None
        except Exception as e:  # 막힌 네트워크 등
            reason = f"Edge TTS 사용 불가({type(e).__name__}) → 로컬 Supertonic 음성 사용"
            if mode == "edge":
                log(reason)
            return LocalTTS(sid), reason
    return LocalTTS(sid), None


def synthesize(tts, texts, speed, target, work):
    def run(sp):
        return [tts.synth(t, sp, work, i) for i, t in enumerate(texts)]

    clips = run(speed)
    fixed = LEAD + GAP * (len(texts) - 1) + TAIL
    speech = sum(len(c) for c in clips) / SR
    factor = speech / max(1.0, target - fixed)
    new = speed
    if factor > 1.08:
        new = min(1.45, speed * factor)
    elif factor < 0.85:
        new = max(0.95, speed * factor)
    if abs(new - speed) > 0.02:
        log(f"길이 맞춤: 속도 {speed:.2f} → {new:.2f}")
        clips, speed = run(new), new
    return clips, speed


def build_timeline(clips):
    starts, t = [], LEAD
    for k, c in enumerate(clips):
        starts.append(t)
        t += len(c) / SR + (GAP if k < len(clips) - 1 else TAIL)
    total = t
    bounds = [0.0] + [s - GAP / 2 for s in starts[1:]] + [total]
    parts = [np.zeros(int(LEAD * SR), np.float32)]
    for k, c in enumerate(clips):
        parts.append(c)
        parts.append(np.zeros(int((GAP if k < len(clips) - 1 else TAIL) * SR), np.float32))
    voice = np.concatenate(parts)
    return starts, bounds, len(voice) / SR, voice


def asr_check(clips, texts):
    if not (ASR_DIR / "model.int8.onnx").exists():
        return None
    import sherpa_onnx

    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(ASR_DIR / "model.int8.onnx"), tokens=str(ASR_DIR / "tokens.txt"),
        language="ko", use_itn=False, num_threads=os.cpu_count() or 2)
    out = []
    for c, t in zip(clips, texts):
        s = rec.create_stream()
        s.accept_waveform(SR, c)
        rec.decode_stream(s)
        heard = s.result.text.strip()
        out.append({"text": t, "heard": heard, "score": round(similarity(t, heard), 2)})
    return out


# ---------------------------------------------------------------- 자막
def chunk_text(s: str, max_chars: int) -> list[str]:
    chunks, cur = [], ""
    for w in s.split():
        if cur and len(cur) + 1 + len(w) > max_chars:
            chunks.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        chunks.append(cur)
    if len(chunks) > 1 and len(chunks[-1]) <= 3 and len(chunks[-2]) + 1 + len(chunks[-1]) <= max_chars + 3:
        chunks[-2] = f"{chunks[-2]} {chunks.pop()}"
    return [c.rstrip(".,") for c in chunks]


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def write_srt(path: Path, texts, starts, clips) -> list[tuple[float, float, str]]:
    cues = []
    for text, st, c in zip(texts, starts, clips):
        dur = len(c) / SR
        chunks = chunk_text(text, SUB["max_chars"])
        weights = [max(1, len(x.replace(" ", ""))) for x in chunks]
        t = st
        for x, wgt in zip(chunks, weights):
            d = dur * wgt / sum(weights)
            cues.append((t, t + d, x))
            t += d
    path.write_text("\n".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{x}\n"
                              for i, (a, b, x) in enumerate(cues, 1)), encoding="utf-8")
    return cues


# ---------------------------------------------------------------- 화면
def find_font() -> str:
    cand = [MPT_DIR / "resource" / "fonts" / FONT_NAME,
            Path("/usr/share/fonts/truetype/nanum") / FONT_NAME]
    for p in cand:
        if p.exists():
            return str(p)
    raise SystemExit("한글 굵은 폰트(NanumGothicBold.ttf)가 없습니다. shorts/setup.sh를 실행하세요.")


def render_graphics(scenes, bounds, total, renderer, out: Path):
    W, H = scn.W, scn.H
    n_frames = int(round(total * FPS))
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    k, start_f, prev_last, last, fade = 0, 0, None, None, 8
    for f in range(n_frames):
        t = f / FPS
        while k < len(scenes) - 1 and t >= bounds[k + 1]:
            k, start_f, prev_last = k + 1, f, last
        local = t - bounds[k]
        img = renderer.frame(scenes[k], local, local / (bounds[k + 1] - bounds[k]), t / total)
        if prev_last is not None and f - start_f < fade:
            img = Image.blend(prev_last, img, (f - start_f + 1) / (fade + 1))
        proc.stdin.write(img.tobytes())
        last = img
        if f % (FPS * 10) == 0:
            log(f"화면 그리는 중 {t:4.1f}/{total:.1f}초")
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg 화면 인코딩 실패")


def pixabay_key() -> str | None:
    if os.environ.get("PIXABAY_API_KEY"):
        return os.environ["PIXABAY_API_KEY"]
    try:
        keys = tomllib.loads((MPT_DIR / "config.toml").read_text()).get("app", {}).get("pixabay_api_keys")
        return keys[0] if keys else None
    except Exception:
        return None


def pixabay_ok() -> bool:
    key = pixabay_key()
    if not key:
        return False
    try:
        import requests

        r = requests.get("https://pixabay.com/api/videos/", params={"key": key, "q": "chip", "per_page": 3},
                         timeout=10)
        return r.status_code == 200
    except Exception:
        return False


def render_footage(scenes, voice_wav: Path, source="pixabay", materials=None) -> Path:
    """MoneyPrinterTurbo CLI로 소재 영상을 받아 이어 붙인다(자막 없이, 우리 음성 길이에 맞춤)."""
    task_id = str(uuid.uuid4())
    terms = ",".join(re.sub(r"[,\n]+", " ", s.get("terms") or s["_icons"][0].replace("-", " "))
                     for s in scenes)
    cmd = [sys.executable, "cli.py", "--video-script", " ".join(s["text"] for s in scenes),
           "--video-terms", terms, "--video-language", "ko-KR", "--video-source", source,
           "--video-aspect", "9:16", "--custom-audio-file", str(voice_wav), "--no-subtitle-enabled",
           "--bgm-type", "none", "--match-materials-to-script", "--video-concat-mode", "sequential",
           "--video-clip-duration", "4", "--n-threads", str(os.cpu_count() or 2), "--task-id", task_id]
    if materials:
        cmd += ["--video-materials", ",".join(materials)]
    r = subprocess.run(cmd, cwd=MPT_DIR, capture_output=True, text=True)
    task_dir = MPT_DIR / "storage" / "tasks" / task_id
    for name in ("combined-1.mp4", "final-1.mp4"):
        if (task_dir / name).exists():
            return task_dir / name
    raise RuntimeError("MoneyPrinterTurbo 소재 단계 실패: " + (r.stderr or r.stdout)[-600:])


def compose(visual: Path, audio: Path, srt: Path, out: Path, topic: str) -> None:
    """MoneyPrinterTurbo의 최종 합성(자막·음성)을 그대로 쓴다."""
    sys.path.insert(0, str(MPT_DIR))
    cwd = os.getcwd()
    os.chdir(MPT_DIR)
    try:
        from app.models.schema import VideoParams
        from app.services import video as mpt_video

        params = VideoParams(
            video_subject=topic, video_aspect="9:16", bgm_type="none", subtitle_enabled=True,
            font_name=FONT_NAME, font_size=SUB["font_size"], text_fore_color="#FFFFFF",
            stroke_color="#000000", stroke_width=SUB["stroke_width"], subtitle_position="custom",
            custom_position=SUB["custom_position"], n_threads=os.cpu_count() or 2)
        mpt_video.generate_video(str(visual), str(audio), str(srt), str(out), params)
    finally:
        os.chdir(cwd)
    if not out.exists():
        raise RuntimeError("최종 합성 실패")


# ---------------------------------------------------------------- 점검
def probe(video: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height",
                        "-of", "json", str(video)], capture_output=True, text=True, check=True)
    j = json.loads(r.stdout)
    st = next((s for s in j.get("streams", []) if "width" in s), {})
    return {"duration": round(float(j["format"]["duration"]), 2), "width": st.get("width"),
            "height": st.get("height")}


def contact_sheet(video: Path, out: Path, interval=3.0, cols=5, tile_w=270, font=None) -> list[float]:
    dur = probe(video)["duration"]
    times = [round(interval / 2 + k * interval, 2) for k in range(max(1, int(dur // interval)))]
    tiles = []
    for t in times:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video), "-frames:v", "1",
                              "-vf", f"scale={tile_w}:-2", "-f", "image2pipe", "-vcodec", "png", "-"],
                             capture_output=True, check=True).stdout
        from io import BytesIO

        tiles.append(Image.open(BytesIO(raw)).convert("RGB"))
    th, lab = tiles[0].height, 34
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tile_w, rows * (th + lab)), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(font, 24) if font else None
    for i, (t, im) in enumerate(zip(times, tiles)):
        x, y = (i % cols) * tile_w, (i // cols) * (th + lab)
        sheet.paste(im, (x, y + lab))
        d.text((x + 8, y + 5), f"{t:04.1f}s", fill=(255, 220, 120), font=f)
    sheet.save(out, quality=90)
    return times


def missing_glyphs(font_path: str, text: str) -> list[str]:
    f = ImageFont.truetype(font_path, 40)
    nd = f.getmask("\U0010fffd")
    nd_key = (nd.size, bytes(nd))
    miss = set()
    for ch in set(text):
        if ch.isspace():
            continue
        m = f.getmask(ch)
        if (m.size, bytes(m)) == nd_key:
            miss.add(ch)
    return sorted(miss)


# ---------------------------------------------------------------- 명령
def load_spec(path: str) -> dict:
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(spec, list):
        spec = {"scenes": spec}
    scenes = spec.get("scenes") or []
    if not scenes:
        raise SystemExit("spec에 scenes가 없습니다.")
    for i, s in enumerate(scenes):
        if not str(s.get("text", "")).strip():
            raise SystemExit(f"장면 {i + 1}: text가 비어 있습니다.")
    spec.setdefault("topic", scenes[0]["text"][:20])
    return spec


def slugify(s: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "-", s).strip("-")[:40] or "shorts"


def cmd_render(a) -> None:
    spec = load_spec(a.spec)
    topic = spec["topic"]
    slug = slugify(topic)
    out_dir = Path(a.out) if a.out else OUT_ROOT / f"{dt.datetime.now():%Y%m%d-%H%M%S}-{slug}"
    work = out_dir / "work"
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(a.spec, out_dir / "spec.json")
    font = find_font()
    warnings: list[str] = []

    icons = scn.Icons(ICON_DIR, ASSETS / "icons" / "png")
    renderer = scn.Renderer(font, icons, accent=spec.get("accent", "blue"))
    scenes = [scn.prepare_scene(s, i, renderer, spec.get("accent", "blue"))
              for i, s in enumerate(spec["scenes"])]
    texts = [s["text"].strip() for s in scenes]

    # 1) 음성
    sid = a.voice if a.voice is not None else int(spec.get("voice", DEFAULT_SID))
    tts, why = pick_tts(a.tts, sid, work)
    if why:
        warnings.append(why)
    speed = a.speed if a.speed else (1.05 if tts.name == "edge" else 1.1)
    log(f"음성 합성({tts.name}, 속도 {speed:.2f})")
    speech_in = [s.get("say") or s["text"] for s in scenes]
    clips, speed = synthesize(tts, speech_in, speed, a.target, work)
    starts, bounds, total, voice = build_timeline(clips)
    voice_wav = work / "voice.wav"
    write_wav(voice_wav, voice)
    srt = work / "subtitle.srt"
    cues = write_srt(srt, texts, starts, clips)
    asr = asr_check(clips, texts)

    # 2) 화면
    visual_mode = "graphics"
    visual = work / "visual.mp4"
    if a.visual in ("auto", "pixabay") and pixabay_ok():
        try:
            log("Pixabay 영상 소재 받는 중(MoneyPrinterTurbo)")
            visual = render_footage(scenes, voice_wav)
            visual_mode = "pixabay"
        except Exception as e:
            warnings.append(f"Pixabay 소재 실패 → 아이콘 애니메이션 사용: {e}")
    elif a.visual == "pixabay":
        warnings.append("Pixabay에 접속할 수 없거나 키가 없음 → 아이콘 애니메이션 사용")
    if visual_mode == "graphics":
        log("장면 애니메이션 렌더링")
        render_graphics(scenes, bounds, total, renderer, visual)
    warnings += renderer.warnings

    # 3) 합성 + 점검
    final = out_dir / f"{slug}.mp4"
    log("자막·음성 합성(MoneyPrinterTurbo)")
    compose(visual, voice_wav, srt, final, topic)
    info = probe(final)
    sheet = out_dir / "sheet.jpg"
    times = contact_sheet(final, sheet, font=font)

    on_screen = [s.get(k) for s in scenes for k in ("title", "caption", "label", "unit", "prefix")]
    on_screen += [x for s in scenes for k in ("labels", "items") for x in (s.get(k) or [])]
    all_text = "".join(texts) + "".join(str(x) for x in on_screen if x)
    miss = missing_glyphs(font, all_text)
    if miss:
        warnings.append(f"폰트에 없는 글자(자막 깨짐): {' '.join(miss)}")
    chars = sum(len(re.sub(r"\s", "", t)) for t in texts)
    if info["duration"] < a.target - 3:
        warnings.append(f"길이 {info['duration']}초로 짧음(대본 {chars}자): 문장을 1~2개 늘리세요"
                        f"(30초 ≈ 공백 빼고 180자)")
    elif info["duration"] > a.target + 4:
        warnings.append(f"길이 {info['duration']}초로 김(대본 {chars}자): 문장을 줄이세요")
    if asr:
        for i, r in enumerate(asr, 1):
            if r["score"] < 0.75:
                warnings.append(f"문장 {i} 발음 확인 필요(일치도 {r['score']}): 들린 말 '{r['heard']}'"
                                f" → 해당 장면에 say(읽는 법)를 넣어 다시 만드세요")
    for i, s in enumerate(scenes, 1):
        if len(str(s.get("title", ""))) > 12:
            warnings.append(f"장면 {i} 제목이 김(12자 이하 권장)")

    qa = {"video": str(final), "sheet": str(sheet), "sheet_times": times, **info, "chars": chars,
          "tts": tts.name, "speed": round(speed, 2), "visual": visual_mode,
          "scenes": [{"start": round(b, 2), "end": round(bounds[i + 1], 2), "text": texts[i],
                      "scene": scenes[i]["scene"], "icons": scenes[i]["_icons"],
                      **({"asr": asr[i]} if asr else {})} for i, b in enumerate(bounds[:-1])],
          "subtitles": [{"start": round(x, 2), "end": round(y, 2), "text": t} for x, y, t in cues],
          "warnings": warnings}
    (out_dir / "qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    if not a.keep_work:
        shutil.rmtree(work, ignore_errors=True)

    print("\n===== 결과 =====")
    print(f"영상: {final}  ({info['duration']}초, {info['width']}x{info['height']})")
    print(f"장면 확인용: {sheet}  ({', '.join(f'{t:g}s' for t in times)})")
    print(f"음성: {tts.name} (속도 {speed:.2f}) / 화면: {visual_mode} / 대본 {chars}자")
    if asr:
        print("발음 검사(음성인식 일치도):")
        for i, r in enumerate(asr, 1):
            print(f"  {i}. {r['score']:.2f}  {r['text']}  ← 들린 말: {r['heard']}")
    print("경고:" if warnings else "경고: 없음")
    for w in warnings:
        print(f"  - {w}")


def cmd_icons(a) -> None:
    icons = scn.Icons(ICON_DIR, ASSETS / "icons" / "png")
    for q in a.query:
        hits = icons.search(q)
        print(f"{q}: {', '.join(hits) if hits else '(없음)'}")


def cmd_sheet(a) -> None:
    out = Path(a.out or Path(a.video).with_name("sheet.jpg"))
    times = contact_sheet(Path(a.video), out, font=find_font())
    print(f"{out}  ({', '.join(f'{t:g}s' for t in times)})")


def cmd_doctor(a) -> None:
    def row(name, ok, detail=""):
        print(f"  {'OK ' if ok else 'NO '} {name} {detail}")

    print("설치 상태")
    row("MoneyPrinterTurbo", (MPT_DIR / "cli.py").exists(), str(MPT_DIR))
    row("Python 환경", (MPT_DIR / ".venv" / "bin" / "python").exists())
    try:
        import sherpa_onnx  # noqa: F401
        row("sherpa-onnx", True)
    except Exception:
        row("sherpa-onnx", False)
    row("Supertonic 음성 모델", (TTS_DIR / "voice.bin").exists())
    row("음성인식(발음 검사) 모델", (ASR_DIR / "model.int8.onnx").exists())
    row("아이콘", ICON_DIR.exists(), f"{len(list(ICON_DIR.glob('*.svg')))}개" if ICON_DIR.exists() else "")
    row("한글 굵은 폰트", (MPT_DIR / "resource" / "fonts" / FONT_NAME).exists())
    row("ffmpeg", bool(shutil.which("ffmpeg")))
    row("rsvg-convert", bool(shutil.which("rsvg-convert")))
    print("네트워크")
    row("Pixabay 키", bool(pixabay_key()))
    row("Pixabay 접속", pixabay_ok())
    tmp = Path(os.environ.get("TMPDIR", "/tmp"))
    try:
        EdgeTTS().synth("테스트", 1.0, tmp, 999)
        row("Edge TTS 접속", True)
    except Exception as e:
        row("Edge TTS 접속", False, type(e).__name__)


def main() -> None:
    p = argparse.ArgumentParser(description="주제 → 세로 쇼츠 영상")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render", help="spec(JSON)으로 영상 생성")
    r.add_argument("spec")
    r.add_argument("--tts", choices=["auto", "edge", "local"], default="auto")
    r.add_argument("--visual", choices=["auto", "pixabay", "graphics"], default="auto")
    r.add_argument("--voice", type=int, default=None,
                   help=f"Supertonic 목소리 0~9 (0~4 여성, 5~9 남성, 기본 {DEFAULT_SID})")
    r.add_argument("--speed", type=float, default=None)
    r.add_argument("--target", type=float, default=30.0, help="목표 길이(초)")
    r.add_argument("--out", default=None)
    r.add_argument("--keep-work", action="store_true")
    r.set_defaults(func=cmd_render)
    i = sub.add_parser("icons", help="아이콘 이름 검색")
    i.add_argument("query", nargs="+")
    i.set_defaults(func=cmd_icons)
    s = sub.add_parser("sheet", help="3초 간격 장면 모음 이미지")
    s.add_argument("video")
    s.add_argument("--out", default=None)
    s.set_defaults(func=cmd_sheet)
    d = sub.add_parser("doctor", help="설치/네트워크 점검")
    d.set_defaults(func=cmd_doctor)
    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
