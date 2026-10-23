#!/usr/bin/env bash
# Instala o Guitarr como app no Linux (com Flatpak).
# Cria um atalho no menu de aplicativos que abre o Guitarr numa janela própria,
# sem barra de endereço, usando um navegador baseado em Chromium.
#
# Uso: ./instalar-linux.sh https://seu-servidor          (instala)
#      ./instalar-linux.sh --remover                      (desinstala)
set -euo pipefail

URL="${1:-${SEER_URL:-https://guitarr.example.com}}"
APP_ID="guitarr"
DESKTOP="$HOME/.local/share/applications/$APP_ID.desktop"
ICON="$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"

if [ "$URL" = "--remover" ]; then
  rm -f "$DESKTOP" "$ICON"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "Guitarr removido do menu."
  exit 0
fi

if [ -z "$URL" ]; then
  read -rp "Endereço do seu Guitarr (ex.: https://musica.exemplo.com): " URL
fi
URL="${URL%/}"
case "$URL" in
  http://*|https://*) ;;
  *) URL="https://$URL" ;;
esac
APP_URL="$URL/app/"

# Escolhe o navegador: Flatpak primeiro (padrão do Linux), depois os nativos.
BROWSER=""
for id in com.google.Chrome com.brave.Browser com.microsoft.Edge org.chromium.Chromium io.github.ungoogled_software.ungoogled_chromium; do
  if flatpak info "$id" >/dev/null 2>&1; then
    BROWSER="flatpak run $id"
    break
  fi
done
if [ -z "$BROWSER" ]; then
  for bin in google-chrome google-chrome-stable brave-browser microsoft-edge chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      BROWSER="$bin"
      break
    fi
  done
fi
if [ -z "$BROWSER" ]; then
  echo "Nenhum navegador Chromium encontrado (o Firefox não abre apps web em janela própria)."
  read -rp "Instalar o Chromium pelo Flathub agora? [S/n] " ok
  if [ "${ok:-S}" != "n" ] && [ "${ok:-S}" != "N" ]; then
    flatpak install --user -y flathub org.chromium.Chromium
    BROWSER="flatpak run org.chromium.Chromium"
  else
    exit 1
  fi
fi

mkdir -p "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
if ! curl -fsSL "$URL/app/android-chrome-512x512.png" -o "$ICON"; then
  echo "Aviso: não consegui baixar o ícone de $URL (o servidor está no ar?)."
fi

cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=Guitarr
GenericName=Player de música
Comment=Sua biblioteca de música e pedidos
Exec=$BROWSER --app=$APP_URL
Icon=$ICON
Terminal=false
Categories=AudioVideo;Audio;Player;
DESK
chmod +x "$DESKTOP"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Pronto: \"Guitarr\" está no menu de aplicativos ($BROWSER)."
if command -v steamos-add-to-steam >/dev/null 2>&1; then
  read -rp "Adicionar também à Steam, para abrir no Modo Jogo? [s/N] " st
  if [ "${st:-N}" = "s" ] || [ "${st:-N}" = "S" ]; then
    steamos-add-to-steam "$DESKTOP" || echo "Não deu para adicionar à Steam automaticamente."
  fi
fi
