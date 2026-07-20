#!/usr/bin/env bash
# Normalize every rendered clip and concatenate into the draft teaser.
set -euo pipefail
cd "$(dirname "$0")/out"

CLIPS=(
  01-title.webm
  02-grant.mp4
  03-revoke.mp4
  04-etherscan.webm
  05-denied.mp4
  06-closing.webm
)

rm -f list.txt seg-*.mp4
i=0
for clip in "${CLIPS[@]}"; do
  if [[ ! -f $clip ]]; then
    echo "skip missing $clip"
    continue
  fi
  seg=$(printf 'seg-%02d.mp4' "$i")
  ffmpeg -hide_banner -loglevel error -y -i "$clip" \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p" \
    -an -c:v libx264 -crf 20 -preset veryfast "$seg"
  echo "file '$seg'" >> list.txt
  i=$((i + 1))
done

ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i list.txt -c copy teaser-draft.mp4
rm -f list.txt seg-*.mp4
echo "wrote video/out/teaser-draft.mp4"
ffprobe -hide_banner -v error -show_entries format=duration -of default=nw=1 teaser-draft.mp4
