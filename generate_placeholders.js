#!/usr/bin/env gjs
// Genera PNGs de la mascota con Cairo, a partir de un MAPA ASCII de píxeles.
// Uso:  gjs -m generate_placeholders.js
// Escribe assets/idle_0.png ... assets/idle_3.png
//
// Cada carácter del mapa es un "píxel lógico" que se dibuja como un bloque
// sólido de ESCALA×ESCALA px, con los bordes duros (sin antialias) -> pixel-art
// nítido. El PNG sale ya al tamaño final, así que St.Icon no lo reescala ni lo
// difumina.  Edita MAPA para cambiar la forma; edita los colores abajo.
//
//   '.' -> transparente     'B' -> cuerpo (naranja)     'E' -> ojo (oscuro)

import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const ESCALA = 4;   // px por píxel lógico  (24 cols × 4 = 96 px)

// Paleta (tomada de la imagen de referencia: naranja arcilla + ojos casi negros)
const CUERPO = [0.80, 0.47, 0.35];
const OJO    = [0.08, 0.08, 0.08];

// El bicho: cuerpo ancho, ojos verticales, brazos laterales, 4 patas.
// 24×24 (cuadrado -> el PNG queda 96×96 sin deformar el aspecto).
const MAPA = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBEEBBBBEEBBB.....',
    '.....BBBEEBBBBEEBBB.....',
    '.....BBBEEBBBBEEBBB.....',
    '.....BBBEEBBBBEEBBB.....',
    '.BBBBBBBBBBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBBBBBBBBBB.',
    '.....BBBBBBBBBBBBBB.....',
    '.....BBBBBBBBBBBBBB.....',
    '......BB.BB..BB.BB......',
    '......BB.BB..BB.BB......',
    '......BB.BB..BB.BB......',
    '........................',
    '........................',
    '........................',
    '........................',
];

// --- Directorio de salida (assets/ junto a este script) ---
const rutaScript = GLib.path_get_dirname(
    Gio.File.new_for_uri(import.meta.url).get_path());
const dirAssets = GLib.build_filenamev([rutaScript, 'assets']);
GLib.mkdir_with_parents(dirAssets, 0o755);

const cols = Math.max(...MAPA.map(f => f.length));
const filas = MAPA.length;

// Devuelve una copia del mapa con los ojos "cerrados" (para el parpadeo):
// convierte 'E' en 'B' salvo en la última fila con ojos -> queda una rendija.
function cerrarOjos(mapa) {
    const filasConOjo = mapa
        .map((f, i) => (f.includes('E') ? i : -1))
        .filter(i => i >= 0);
    const ultima = filasConOjo[filasConOjo.length - 1];
    return mapa.map((f, i) =>
        i === ultima ? f : f.replaceAll('E', 'B'));
}

function pintar(mapa, dyPx) {
    const surface = new Cairo.ImageSurface(
        Cairo.Format.ARGB32, cols * ESCALA, filas * ESCALA);
    const cr = new Cairo.Context(surface);
    cr.setAntialias(Cairo.Antialias.NONE);   // bordes duros

    for (let y = 0; y < mapa.length; y++) {
        for (let x = 0; x < mapa[y].length; x++) {
            const c = mapa[y][x];
            if (c === '.') continue;
            cr.setSourceRGB(...(c === 'E' ? OJO : CUERPO));
            cr.rectangle(x * ESCALA, y * ESCALA + dyPx, ESCALA, ESCALA);
            cr.fill();
        }
    }
    return surface;
}

// 4 frames idle: leve balanceo vertical (bob) + un parpadeo.
//   0: base   1: bob abajo   2: parpadeo   3: bob abajo
const abierto = MAPA;
const cerrado = cerrarOjos(MAPA);
const frames = [
    pintar(abierto, 0),
    pintar(abierto, ESCALA),
    pintar(cerrado, 0),
    pintar(abierto, ESCALA),
];

frames.forEach((surface, i) => {
    const ruta = GLib.build_filenamev([dirAssets, `idle_${i}.png`]);
    surface.writeToPNG(ruta);
    surface.finish();
    print(`escrito ${ruta}`);
});

print(`Listo: ${frames.length} frames (${cols * ESCALA}×${filas * ESCALA}) en ${dirAssets}`);
