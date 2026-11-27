#!/usr/bin/env bash
# Build the toyshop marble Short: frames -> audio -> MP4 -> QC.
# usage: assemble.sh <workdir>   (workdir holds wbt_kit.js, render_test.mjs and node_modules/three@0.186.1 + playwright)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; W="$1"; cd "$W"
cp "$HERE/marble_toyshop.js" .
node render_test.mjs marble_toyshop.js M01 full 0-450 1080 1920 | grep -v 'GL Driver'
node "$HERE/timing.mjs"                                   # writes timing.json from window.MARBLE_TIMING
python3 "$HERE/make_audio.py" timing.json raw.wav
# loudness: -14 LUFS integrated, true peak under -1 dBTP (measured gain, applied linearly so the loop stays seamless)
GAIN=$(ffmpeg -hide_banner -stream_loop 3 -i raw.wav -af loudnorm=I=-14:TP=-1.5:print_format=json -f null /dev/null 2>&1 | python3 -c "import sys,json,re; j=json.loads(re.search(r'\{[^}]*\}', sys.stdin.read()).group()); print(-14-float(j['input_i']))")
ffmpeg -v error -y -i raw.wav -af "volume=${GAIN}dB" -c:a pcm_s16le audio.wav
ffmpeg -v error -y -framerate 30 -i full/f_%04d.jpg -i audio.wav -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -shortest -movflags +faststart marble_toyshop_short.mp4
python3 "$HERE/../../.claude/skills/weird-but-true-visual-style/scripts/wbt_frame_qc.py" frames marble_toyshop_short.mp4 --profile short --every 1.0
