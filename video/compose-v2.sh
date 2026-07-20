#!/usr/bin/env bash
# Teaser v2: variable-speed edit of the live Claude Code capture
# (mintDemoNFT-2.mov) + title/closing cards + Etherscan cutaway.
# Produces video/out/teaser-v2-silent.mp4 (narration added separately).
set -euo pipefail
cd "$(dirname "$0")"

SRC=mintDemoNFT-2.mov
OUT=out
NORM="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p"

# seg <name> <start> <end> <speed> [freeze_seconds]
seg() {
  local name=$1 start=$2 end=$3 speed=$4 freeze=${5:-0}
  local vf="setpts=PTS/${speed},${NORM}"
  if [[ $freeze != 0 ]]; then
    vf="${vf},tpad=stop_mode=clone:stop_duration=${freeze}"
  fi
  ffmpeg -hide_banner -loglevel error -y -ss "$start" -to "$end" -i "$SRC" \
    -vf "$vf" -an -c:v libx264 -crf 20 -preset veryfast "$OUT/v2-$name.mp4"
  echo "v2-$name.mp4"
}

echo "== cutting variable-speed segments from $SRC"
seg s1-minted     0    11   2         # mint summary readable, "Revoke…" typed
seg s2-revoking   11   63   13        # agent works (13x)
seg s3-revoked    63   73   1         # result: revoked & verified gone (1x)
seg s4-ask-again  74   109  7         # human types the second mint request
seg s5-checking   109  134  8         # agent checks its role
seg s6-denied     134  139.5 1 4      # "I can't mint" + 4s freeze on last frame

echo "== normalizing cards and cutaway"
ffmpeg -hide_banner -loglevel error -y -i "$OUT/01-title.webm" \
  -vf "$NORM" -an -c:v libx264 -crf 20 -preset veryfast "$OUT/v2-title.mp4"
ffmpeg -hide_banner -loglevel error -y -ss 2.5 -t 8 -i "$OUT/04-etherscan.webm" \
  -vf "$NORM" -an -c:v libx264 -crf 20 -preset veryfast "$OUT/v2-etherscan.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$OUT/06-closing.webm" \
  -vf "$NORM" -an -c:v libx264 -crf 20 -preset veryfast "$OUT/v2-closing.mp4"

echo "== concatenating"
cd "$OUT"
: > v2-list.txt
for c in v2-title v2-s1-minted v2-s2-revoking v2-s3-revoked v2-etherscan \
         v2-s4-ask-again v2-s5-checking v2-s6-denied v2-closing; do
  echo "file '$c.mp4'" >> v2-list.txt
  ffprobe -hide_banner -v error -show_entries format=duration -of csv=p=0 "$c.mp4" \
    | xargs printf '%-18s %ss\n' "$c"
done
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i v2-list.txt \
  -c copy teaser-v2-silent.mp4
rm -f v2-list.txt
echo "wrote video/out/teaser-v2-silent.mp4"
ffprobe -hide_banner -v error -show_entries format=duration -of default=nw=1 teaser-v2-silent.mp4
