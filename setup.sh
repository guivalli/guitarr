#!/bin/sh
# Prepares the server: folders with the right owner and an slskd.yml with a fresh API key.
# The Soulseek and slskd panel logins can be changed later in Guitarr -> Settings.
set -e
cd "$(dirname "$0")"

touch .env && chmod 600 .env
# GUITARR_DATA and MUSIC_DIR come from .env (default: ./data and ./music, next to docker-compose.yml)
set -a; . ./.env; set +a
DATA="${GUITARR_DATA:-$PWD/data}"; MUSIC="${MUSIC_DIR:-$PWD/music}"
OWNER="${PUID:-1000}:${PGID:-1000}"

sudo mkdir -p "$DATA/guitarr" "$DATA/slskd/downloads" "$MUSIC/Seer"
sudo chown -R "$OWNER" "$DATA" "$MUSIC/Seer"
echo "Folders ready: $DATA and $MUSIC/Seer"

yml="$DATA/slskd/slskd.yml"
# The folder already belongs to the containers' user: read and write it with sudo so any user can run this.
# Single quotes in the YAML, with ' doubled: a password with " or \ does not break the file.
yq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
if ! sudo test -s "$yml" || ! sudo grep -q '^web:' "$yml"; then
  key=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf 'Soulseek username (the account is created on first login): '; read -r slsk_user
  printf 'Soulseek password: '; stty -echo; read -r slsk_pass; stty echo; echo
  printf 'slskd web panel password (username is the same as Soulseek): '; stty -echo; read -r web_pass; stty echo; echo
  sudo tee -a "$yml" >/dev/null <<YML
# --- Guitarr: logins edited in Settings (ND_SEER_SOULSEEK_CONFIGFILE) ---
soulseek:
  username: $(yq "$slsk_user")
  password: $(yq "$slsk_pass")
web:
  authentication:
    username: $(yq "$slsk_user")
    password: $(yq "$web_pass")
    api_keys:
      guitarr:
        key: "$key"
        role: administrator
        cidr: 0.0.0.0/0,::/0
YML
  sudo chmod 600 "$yml"; sudo chown "$OWNER" "$yml"
  # The key stays in .env only until the first start: Guitarr then stores it encrypted and it can be removed.
  if grep -q '^SLSKD_API_KEY=' .env; then sed -i "s/^SLSKD_API_KEY=.*/SLSKD_API_KEY=$key/" .env; else echo "SLSKD_API_KEY=$key" >> .env; fi
  echo "slskd.yml created at $yml"
fi
echo "All set: docker compose up -d --build"
