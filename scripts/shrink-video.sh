#!/bin/zsh
# Make a phone-sized copy of a game video for offline viewing (uses the converter built into macOS).
#   npm run shrink -- <video file> [--sharper]
#   640×360 ≈ 0.75 GB for a 40-minute game (default); --sharper: 960×540 ≈ 1.4 GB.
# The copy lands next to the original as "<name> (phone).mp4": AirDrop it to your phone, then in VolleyRate open
# the game and tap "Save for offline".
set -e
src="$1"
[[ -f "$src" ]] || { echo "Usage: npm run shrink -- <video file> [--sharper]"; exit 1; }
preset=Preset640x480
[[ "$2" == "--sharper" ]] && preset=Preset960x540
out="${src%.*} (phone).mp4"
echo "Making $out ($preset)…"
avconvert --source "$src" --preset "$preset" --output "$out" --replace --progress
ls -lh "$out" | awk '{print "Done:", $5}'
