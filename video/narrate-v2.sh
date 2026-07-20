#!/usr/bin/env bash
# Generate English narration (macOS `say`, voice Samantha) and mix it
# onto teaser-v2-silent.mp4 at scene-aligned offsets → teaser-v2.mp4.
set -euo pipefail
cd "$(dirname "$0")/out"

VOICE=Samantha
RATE=180

# line <id> <text>
line() {
  say -v "$VOICE" -r "$RATE" -o "n$1.aiff" "$2"
  ffmpeg -hide_banner -loglevel error -y -i "n$1.aiff" \
    -ar 44100 -ac 2 "n$1.wav"
  rm -f "n$1.aiff"
  ffprobe -hide_banner -v error -show_entries format=duration -of csv=p=0 "n$1.wav" \
    | xargs printf 'n%s: %ss\n' "$1"
}

# Scene offsets in teaser-v2-silent.mp4 (from compose-v2.sh output):
# title 0.0 | s1 7.33 | s2 12.83 | s3 16.83 | etherscan 27.23
# s4 34.77 | s5 39.80 | s6 43.13 | closing 51.00
line 1 "Your AI agent has too much power. Here's the kill switch."
line 2 "This agent just minted an NFT, after proving on-chain that it holds the required role."
line 3 "Now the human says: revoke."
line 4 "The role token is burned on Sepolia. Revoked, and verified gone. No permission server. No key rotation. One transaction."
line 5 "The burn is public. Anyone can verify the agent's authority on-chain."
line 6 "Now ask the agent to mint again."
line 7 "It checks its role, finds nothing, and refuses. Enforcement lives on-chain."
line 8 "Roles are tokens. Grant with a mint. Revoke with a burn. E-R-C 7303, plus M-C-P."

# offsets (ms)
ffmpeg -hide_banner -loglevel error -y \
  -i teaser-v2-silent.mp4 \
  -i n1.wav -i n2.wav -i n3.wav -i n4.wav \
  -i n5.wav -i n6.wav -i n7.wav -i n8.wav \
  -filter_complex "\
[1:a]adelay=500|500[a1];\
[2:a]adelay=7500|7500[a2];\
[3:a]adelay=13000|13000[a3];\
[4:a]adelay=17200|17200[a4];\
[5:a]adelay=27500|27500[a5];\
[6:a]adelay=35000|35000[a6];\
[7:a]adelay=43400|43400[a7];\
[8:a]adelay=51300|51300[a8];\
[a1][a2][a3][a4][a5][a6][a7][a8]amix=inputs=8:normalize=0,\
apad=whole_dur=58.933,loudnorm=I=-18:TP=-2[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 160k -shortest \
  teaser-v2.mp4

echo "wrote video/out/teaser-v2.mp4"
ffprobe -hide_banner -v error -show_entries format=duration -of default=nw=1 teaser-v2.mp4
