#!/usr/bin/env bash
# make_short.py를 MoneyPrinterTurbo 가상환경의 파이썬으로 실행한다.
MPT_DIR="${MPT_DIR:-$HOME/MoneyPrinterTurbo}"
PY="$MPT_DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "설치가 필요합니다: bash shorts/setup.sh" >&2
  exit 1
fi
exec "$PY" "$(dirname "$0")/make_short.py" "$@"
