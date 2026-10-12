#!/usr/bin/env bash
# 쇼츠 제작 도구 설치. 여러 번 실행해도 안전하며, 이미 있는 것은 건너뛴다.
# 막히는 단계는 대체 경로로 계속 진행하고, 마지막에 doctor로 상태를 출력한다.
set -uo pipefail

MPT_DIR="${MPT_DIR:-$HOME/MoneyPrinterTurbo}"
ASSETS="${SHORTS_ASSETS:-$HOME/.cache/shorts}"
MPT_REPO="https://github.com/harry0703/MoneyPrinterTurbo"
MPT_COMMIT="4204d0f39afa8ada6f3edc31604141f959fe254e"  # 동작 확인한 버전
RELEASES="https://github.com/k2-fsa/sherpa-onnx/releases/download"
TTS_MODEL="sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
ASR_MODEL="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
ICONS_TGZ="https://registry.npmjs.org/fluentui-emoji/-/fluentui-emoji-1.3.0.tgz"
FONT_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Bold.ttf"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[setup] $*"; }
fetch() { curl -fsSL --retry 4 --retry-delay 2 -o "$2" "$1"; }
export PATH="$HOME/.local/bin:$PATH"
SUDO=""; [ "$(id -u)" != 0 ] && command -v sudo >/dev/null && SUDO="sudo"

apt_install() {
  command -v apt-get >/dev/null || return 1
  $SUDO apt-get install -y -qq "$@" >/dev/null 2>&1 && return 0
  $SUDO apt-get update -qq >/dev/null 2>&1
  $SUDO apt-get install -y -qq "$@" >/dev/null 2>&1
}

# 1) uv
if ! command -v uv >/dev/null; then
  log "uv 설치"
  python3 -m pip install -q --user uv 2>/dev/null \
    || python3 -m pip install -q --user --break-system-packages uv 2>/dev/null \
    || curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# 2) MoneyPrinterTurbo (git → 실패하면 zip)
if [ ! -f "$MPT_DIR/cli.py" ]; then
  log "MoneyPrinterTurbo 내려받기"
  if command -v git >/dev/null; then
    mkdir -p "$MPT_DIR" && git -C "$MPT_DIR" init -q \
      && git -C "$MPT_DIR" fetch -q --depth 1 "$MPT_REPO" "$MPT_COMMIT" \
      && git -C "$MPT_DIR" checkout -q FETCH_HEAD \
      || { rm -rf "$MPT_DIR"; git clone -q --depth 1 "$MPT_REPO" "$MPT_DIR"; }
  fi
  if [ ! -f "$MPT_DIR/cli.py" ]; then
    tmp="$(mktemp -d)"
    fetch "$MPT_REPO/archive/$MPT_COMMIT.zip" "$tmp/mpt.zip" \
      || fetch "https://codeload.github.com/harry0703/MoneyPrinterTurbo/zip/refs/heads/main" "$tmp/mpt.zip"
    unzip -q "$tmp/mpt.zip" -d "$tmp" && rm -rf "$MPT_DIR" && mv "$tmp"/MoneyPrinterTurbo-* "$MPT_DIR"
    rm -rf "$tmp"
  fi
fi
[ -f "$MPT_DIR/cli.py" ] || { log "MoneyPrinterTurbo를 받지 못했습니다"; exit 1; }

# 3) 파이썬 환경 (uv)
PY="$MPT_DIR/.venv/bin/python"
if [ ! -x "$PY" ] || ! "$PY" -c "import moviepy, edge_tts" 2>/dev/null; then
  log "파이썬 환경 준비(uv sync)"
  (cd "$MPT_DIR" && uv sync -q) || (cd "$MPT_DIR" && uv sync)
fi
"$PY" -c "import sherpa_onnx, emoji" 2>/dev/null || uv pip install -q --python "$PY" sherpa-onnx emoji

# 4) 시스템 도구: ffmpeg, 굵은 한글 폰트, SVG 변환기
command -v ffmpeg >/dev/null || apt_install ffmpeg || log "ffmpeg 설치 실패"
command -v rsvg-convert >/dev/null || apt_install librsvg2-bin \
  || uv pip install -q --python "$PY" cairosvg
FONT_DST="$MPT_DIR/resource/fonts/NanumGothicBold.ttf"
if [ ! -f "$FONT_DST" ]; then
  FONT_SRC="$(fc-list 2>/dev/null | grep -m1 -o '/[^:]*NanumGothicBold.ttf')"
  if [ -z "$FONT_SRC" ] && apt_install fonts-nanum; then
    FONT_SRC="/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"
  fi
  if [ -n "$FONT_SRC" ] && [ -f "$FONT_SRC" ]; then cp "$FONT_SRC" "$FONT_DST"
  else log "폰트 직접 내려받기"; fetch "$FONT_URL" "$FONT_DST"; fi
fi

# 자막용 굵은 폰트(Pretendard, OFL)
PRET_DST="$MPT_DIR/resource/fonts/Pretendard-ExtraBold.otf"
PRET_BLACK="$MPT_DIR/resource/fonts/Pretendard-Black.otf"
[ -f "$PRET_BLACK" ] || fetch "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/public/static/Pretendard-Black.otf" "$PRET_BLACK" \
  || log "Pretendard Black 받기 실패(표지는 ExtraBold로 대체됨)"
[ -f "$PRET_DST" ] || fetch "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/public/static/Pretendard-ExtraBold.otf" "$PRET_DST" \
  || log "Pretendard 폰트 받기 실패(나눔고딕으로 대체됨)"

# 5) config.toml (Pixabay 키는 환경변수 PIXABAY_API_KEY가 있으면 저장)
CFG="$MPT_DIR/config.toml"
[ -f "$CFG" ] || cp "$MPT_DIR/config.example.toml" "$CFG"
sed -i 's/^video_source = .*/video_source = "pixabay"/' "$CFG"
if [ -n "${PIXABAY_API_KEY:-}" ]; then
  sed -i "s/^pixabay_api_keys = .*/pixabay_api_keys = [\"$PIXABAY_API_KEY\"]/" "$CFG"
fi

# 6) 음성 모델(Supertonic)과 발음 검사용 음성인식 모델(SenseVoice)
mkdir -p "$ASSETS/models"
for m in "tts-models/$TTS_MODEL" "asr-models/$ASR_MODEL"; do
  name="${m#*/}"
  if [ ! -d "$ASSETS/models/$name" ]; then
    log "모델 내려받기: $name"
    fetch "$RELEASES/$m.tar.bz2" "$ASSETS/models/$name.tar.bz2" \
      && tar xjf "$ASSETS/models/$name.tar.bz2" -C "$ASSETS/models" \
      || log "모델 받기 실패: $name"
    rm -f "$ASSETS/models/$name.tar.bz2"
  fi
done

# 7) 아이콘(Fluent Emoji, MIT)
if [ ! -d "$ASSETS/icons/modern" ]; then
  log "아이콘 내려받기"
  tmp="$(mktemp -d)"
  fetch "$ICONS_TGZ" "$tmp/icons.tgz" \
    && tar xzf "$tmp/icons.tgz" -C "$tmp" package/icons/modern package/LICENSE \
    && mkdir -p "$ASSETS/icons" && mv "$tmp/package/icons/modern" "$ASSETS/icons/modern" \
    && mv "$tmp/package/LICENSE" "$ASSETS/icons/LICENSE"
  rm -rf "$tmp"
fi

"$PY" "$HERE/make_short.py" doctor
