#!/bin/sh
# Gera os ícones do app (adaptativo, legado, redondo) e o ícone da abertura a partir de brand/.
# Roda dentro da imagem guitarr-android-builder (ImageMagick).
set -e
B=${1:-/proj/brand}
RES=${2:-android/app/src/main/res}
for spec in mdpi:108:48 hdpi:162:72 xhdpi:216:96 xxhdpi:324:144 xxxhdpi:432:192; do
  d=${spec%%:*}; r=${spec#*:}; fg=${r%%:*}; ic=${r#*:}
  mkdir -p "$RES/mipmap-$d"
  convert "$B/root/maskable-512x512.png" -resize ${fg}x${fg} "$RES/mipmap-$d/ic_launcher_foreground.png"
  convert "$B/root/android-chrome-512x512.png" -resize ${ic}x${ic} "$RES/mipmap-$d/ic_launcher.png"
  convert "$B/logos/logo-mark.png" -resize ${ic}x${ic} "$RES/mipmap-$d/ic_launcher_round.png"
done
mkdir -p "$RES/drawable-nodpi"
convert "$B/logos/logo-mark.png" -resize 360x360 -background none -gravity center -extent 576x576 "$RES/drawable-nodpi/splash_icon.png"
find "$RES" -name splash.png -delete
echo "icones ok"
