#!/bin/sh
# Build every character in the app from the Microsoft Rocketbox library, with swappable outfits.
# Needs: Blender 4.2+ on PATH (or BLENDER=...), and a "rocketbox" folder next to this script holding
#   <Avatar folder>/Export/<name>_facial.fbx + <Avatar folder>/Textures/  (people and outfit donors)
#   anims/<clip>.fbx                                                   (from Assets/Animations/...)
# See the README for the exact files. Output: ../../models/<id>_<outfit>.glb
cd "$(dirname "$0")"
BLENDER=${BLENDER:-blender}
SRC=${RB_SRC:-rocketbox}
OUT=../../models
for spec in sophia:formal:Business_Female_04:f mia:smart:Female_Adult_05:f priya:casual:Female_Adult_08:f emma:casual:Female_Adult_01:f \
            daniel:formal:Business_Male_03:m marcus:formal:Business_Male_05:m arjun:smart:Business_Male_06:m ryan:smart:Male_Adult_08:m; do
  id=${spec%%:*}; r=${spec#*:}; outfit=${r%%:*}; r=${r#*:}; avatar=${r%%:*}; sex=${r#*:}
  RB_ANIMS="$SRC/anims" "$BLENDER" -b --factory-startup -P rb_outfits.py -- "$SRC/$avatar" "$sex" "$OUT/${id}_${outfit}.glb" > "build_$id.log" 2>&1
  echo "$id: $(grep -c '\[rb\] move' build_$id.log) moves, $(grep -o 'EXPORTED.* MB' build_$id.log)"
done
