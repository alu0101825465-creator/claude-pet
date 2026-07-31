#!/usr/bin/env bash
# Instala la extensión copiándola a la carpeta de extensiones del usuario.
# Uso:  ./install.sh
set -euo pipefail

UUID="claude-pet@gumer"
ORIGEN="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Instalando $UUID"
mkdir -p "$DESTINO"
# --delete: el destino queda EXACTAMENTE igual que el origen (sin restos viejos).
rsync -a --delete --delete-excluded \
    --exclude '.git' \
    --exclude 'install.sh' \
    --exclude 'procesar_sprite.py' \
    --exclude 'generate_placeholders.js' \
    --exclude 'sprite_fuente.webp' \
    --exclude 'README.md' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$ORIGEN/" "$DESTINO/"

# Compilar el esquema de GSettings en el destino (necesario para las prefs).
if [ -d "$DESTINO/schemas" ]; then
    glib-compile-schemas "$DESTINO/schemas"
    echo "Esquema compilado"
fi

echo "Copiado en $DESTINO"
echo "Actívala con:  gnome-extensions enable $UUID"
