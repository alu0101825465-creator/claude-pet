# Claude Pet 🐙👨‍🍳

Extensión de **GNOME Shell** (Wayland/X11, GNOME 45+) que muestra una **mascota
animada de Claude Code** —un pulpo naranja pixel-art— posada sobre el dock,
siempre visible por encima de las ventanas. Camina, reacciona a lo que haces y
duerme. **100 % local, sin ninguna llamada de red.**

- **UUID:** `claude-pet@gumer`
- **Probada en:** GNOME Shell 50 (Fedora 44), Wayland.

## Qué hace

- **Camina** por encima del dock moviendo las patitas; se para y gira en los extremos.
- **Se sincroniza con el auto-ocultado del dock** (Dash2Dock Animated): si el dock
  se esconde, ella se desliza hacia abajo; si aparece, sube. *(Opcional — ver abajo.)*
- **Salta** (manos arriba + parpadeo) al abrir o cambiar de aplicación.
- **Reacciones por app:** 🎵 Spotify/VLC → baila con nota musical; 🔍 navegador →
  lupa; 💬 Discord → burbuja de chat.
- **Modo cocina** 👨‍🍳: gorro de chef + sartén con humo mientras **Claude** o
  **VSCode** están en marcha.
- **Se duerme** tras unos segundos de inactividad (se estira, se acuesta con gorro
  de dormir + luna 🌙 y zzz).
- **Interactiva:** clic → saluda ondeando; **arrastrable** (cae de vuelta al dock).
- **Se asoma** cuando llega una notificación.
- **Configurable** por GSettings (tamaño, velocidad, activar/desactivar reacciones).

## Requisitos

- **GNOME Shell 45–50** (formato ESM). En < 45 no funciona; en 51+ añade `"51"` a
  `shell-version` en `metadata.json`.
- **Opcional:** [Dash2Dock Animated](https://extensions.gnome.org/extension/4994/dash2dock-lite/)
  (`dash2dock-lite@icedman.github.com`) para posarse sobre él y sincronizar el
  ocultado. **Sin él**, la mascota degrada a "abajo-izquierda, siempre visible".

## Instalación

### Opción A — desde el código (recomendada para desarrollar)

```bash
git clone https://github.com/alu0101825465-creator/claude-pet.git
cd claude-pet
./install.sh                       # copia a ~/.local/share/... y compila el esquema
gnome-extensions enable claude-pet@gumer
```
Luego **cierra sesión y vuelve a entrar** (en Wayland no se puede recargar el shell
en caliente).

### Opción B — desde un zip empaquetado

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/claude-pet@gumer
unzip -o claude-pet@gumer.zip -d ~/.local/share/gnome-shell/extensions/claude-pet@gumer/
gnome-extensions enable claude-pet@gumer     # tras cerrar y abrir sesión
```

> **Nota sobre Wayland:** los cambios de **imágenes (PNG)** no se refrescan con
> `disable/enable` (GNOME cachea texturas por sesión). Para verlos hace falta
> **cerrar sesión y entrar**.

## Preferencias

```bash
gnome-extensions prefs claude-pet@gumer
```
Tamaño, velocidad del paseo, y activar/desactivar: saltar al abrir apps, saludar al
clic, seguir el cursor, dormir, modo cocina.

## Modo cocina por fichero (hook)

Además de detectar Claude/VSCode, el modo cocina se activa si existe el fichero
`~/.config/claude-pet/cocinando`. Puedes engancharlo a un hook para que cocine
mientras Claude trabaja:

```bash
touch ~/.config/claude-pet/cocinando   # empieza a "cocinar"
rm    ~/.config/claude-pet/cocinando   # deja de cocinar
```

## Arquitectura (para desarrollar)

- `extension.js` — núcleo: `enable()`/`disable()`, máquina de estados
  (paseo · idle · reacción · saludo · baile · arrastrando · durmiendo · estirando),
  y todos los overlays. Del dock solo **lee** (estado + geometría), de forma
  defensiva.
- `prefs.js` — panel de preferencias (libadwaita).
- `schemas/` — esquema GSettings (`./install.sh` compila `gschemas.compiled`).
- `assets/` — todos los fotogramas y overlays en PNG (**ya generados**).
- `procesar_sprite.py` — herramienta de build (solo Pillow): genera los PNG desde
  `sprite_fuente.webp` (quita el fondo, detecta patas/brazos, dibuja gorros/luna/z/
  vapor/chef/sartén en pixel-art). **No la necesitas para usar la extensión.**

Regenerar los sprites tras editar el arte o los grids:
```bash
python3 procesar_sprite.py ./sprite_fuente.webp --tam 96
./install.sh
```

## Ciclo de prueba

`./install.sh` → cerrar sesión y entrar. Logs:
```bash
journalctl --user -b 0 -o cat /usr/bin/gnome-shell | grep -iE 'claude-pet|JS ERROR'
```

## Créditos y licencia

Proyecto de aprendizaje. La imagen del personaje es el pixel-art de Claude Code.
Código bajo licencia **MIT** (ver `LICENSE`).
