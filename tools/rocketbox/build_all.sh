#!/bin/sh
# Build every character in the app from the Microsoft Rocketbox library, with swappable outfits.
# Needs: Blender 4.2+ on PATH (or BLENDER=...), and a "rocketbox" folder next to this script holding
#   <Avatar folder>/Export/<name>_facial.fbx + <Avatar folder>/Textures/  (people and outfit donors)
#   anims/<clip>.fbx                                                   (from Assets/Animations/...)
# See the README for the exact files. Output: ../../models/<id>_<outfit>.glb
# Fields: id : their own outfit : Rocketbox avatar : sex : office-formal suit donor (- = own outfit is a suit)
cd "$(dirname "$0")"
BLENDER=${BLENDER:-blender}
SRC=${RB_SRC:-rocketbox}
OUT=../../models
for spec in sophia:formal:Business_Female_04:f:- mia:smart:Female_Adult_05:f:Business_Female_01 priya:casual:Female_Adult_08:f:Business_Female_04 \
            emma:casual:Female_Adult_01:f:Business_Female_04 aisha:formal:Business_Female_01:f:- olivia:smart:Female_Adult_15:f:Business_Female_01 \
            mei:casual:Female_Adult_03:f:Business_Female_04 hannah:casual:Female_Adult_17:f:Business_Female_01 \
            daniel:formal:Business_Male_03:m:- marcus:formal:Business_Male_05:m:- arjun:smart:Business_Male_06:m:Business_Male_01 \
            ryan:smart:Male_Adult_08:m:Business_Male_02 james:formal:Business_Male_01:m:- kenji:formal:Business_Male_02:m:- \
            leo:smart:Male_Adult_07:m:Business_Male_03 ethan:casual:Male_Adult_01:m:Business_Male_05 noah:smart:Male_Adult_02:m:Business_Male_01 \
            luca:smart:Male_Adult_11:m:Business_Male_02 carlos:casual:Male_Adult_06:m:Business_Male_03 andre:casual:Male_Adult_12:m:Business_Male_05; do
  id=${spec%%:*}; r=${spec#*:}; outfit=${r%%:*}; r=${r#*:}; avatar=${r%%:*}; r=${r#*:}; sex=${r%%:*}; suit=${r#*:}
  [ "$suit" = "-" ] && suit=""
  RB_ANIMS="$SRC/anims" "$BLENDER" -b --factory-startup -P rb_outfits.py -- "$SRC/$avatar" "$sex" "$OUT/${id}_${outfit}.glb" "" $suit > "build_$id.log" 2>&1
  echo "$id: $(grep -o 'EXPORTED.* MB' build_$id.log)"
done
