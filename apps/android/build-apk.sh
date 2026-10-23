#!/usr/bin/env bash
# Gera o APK do Guitarr (Android) dentro do Docker: nada é instalado no servidor além da imagem de build.
#   ./build-apk.sh            -> APK de release assinado   (dist/Guitarr-<versão>.apk)
#   ./build-apk.sh debug      -> APK de depuração (WebView inspecionável, assinatura de teste)
# A interface é a mesma de /app/mobile (ui/mobile): rode de novo depois de mudar lá.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
MODE=${1:-release}
IMG=guitarr-android-builder
VERSION_NAME=${VERSION_NAME:-1.0.$(date +%y%m%d)}
VERSION_CODE=${VERSION_CODE:-$(date +%y%m%d%H)}

docker image inspect "$IMG" >/dev/null 2>&1 || docker build -t "$IMG" -f tools/Dockerfile.builder tools
mkdir -p keystore dist

# Chave de assinatura: criada uma única vez. GUARDE keystore/ — sem ela não dá para atualizar o app já instalado.
if [ ! -f keystore/guitarr-release.jks ]; then
  PASS=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  docker run --rm -v "$PWD/keystore":/k "$IMG" keytool -genkeypair -keystore /k/guitarr-release.jks -alias guitarr \
    -keyalg RSA -keysize 2048 -validity 10000 -storepass "$PASS" -keypass "$PASS" -dname "CN=Guitarr, O=Guitarr, C=BR" >/dev/null
  printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=guitarr\n' "$PASS" "$PASS" > keystore/keystore.properties
  chmod 600 keystore/keystore.properties
  echo ">> chave nova em apps/android/keystore/ (faça backup!)"
fi

TASK=assembleRelease; [ "$MODE" = debug ] && TASK=assembleDebug
docker run --rm -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e TASK="$TASK" -e VN="$VERSION_NAME" -e VC="$VERSION_CODE" \
  -v "$PWD":/w -v "$ROOT":/proj:ro -v guitarr-gradle:/root/.gradle -v guitarr-npm:/root/.npm -v guitarr-androidhome:/root/.android -w /w "$IMG" bash -ec '
    mkdir -p www
    python3 /proj/ui/mobile/build_mobile.py www/index.html
    sed -i "s#\.\./#./#g" www/index.html          # ícones ficam ao lado do index dentro do APK
    cp /proj/brand/root/android-chrome-192x192.png /proj/brand/root/android-chrome-512x512.png /proj/brand/root/favicon.ico /proj/brand/root/apple-touch-icon.png www/
    npm install --no-audit --no-fund --loglevel=error
    sh tools/make-icons.sh /proj/brand android/app/src/main/res
    npx cap sync android
    cd android && chmod +x gradlew
    ./gradlew --no-daemon -q "$TASK" -PguitarrVN="$VN" -PguitarrVC="$VC"
    cd .. && chown -R "$HOST_UID:$HOST_GID" /w 2>/dev/null || true
  '
OUT=$(find android/app/build/outputs/apk -name '*.apk' -path "*/$MODE/*" | head -1)
cp "$OUT" "dist/Guitarr-${VERSION_NAME}-${MODE}.apk"
echo ">> pronto: apps/android/dist/Guitarr-${VERSION_NAME}-${MODE}.apk"
