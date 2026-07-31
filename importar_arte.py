#!/usr/bin/env python3
"""Adapta un PNG que hayas dibujado tú al formato que necesita la extensión.

Uso:
    python3 importar_arte.py MI_DIBUJO.png navidad      # sombrero de Navidad
    python3 importar_arte.py MI_DIBUJO.png halloween
    python3 importar_arte.py MI_DIBUJO.png cumple
    python3 importar_arte.py MI_DIBUJO.png chef         # gorro de cocinero
    python3 importar_arte.py MI_DIBUJO.png pan          # sartén
    python3 importar_arte.py MI_DIBUJO.png moon|zeta|steam|note|lens|bubble|heart|sweat|star

Dibuja con TOTAL libertad (cualquier tamaño, con fondo transparente) en
Pixelorama, LibreSprite, GIMP... y este script se encarga de:
  - recortar al contenido,
  - escalar SIN suavizado (nearest neighbor) para que siga siendo pixel-art nítido,
  - dejar el lienzo CUADRADO (St.Icon lo exige; si no, se deforma),
  - anclar el dibujo abajo en los sombreros (la extensión los apoya por su base),
  - guardarlo en assets/ con el nombre correcto.

Después:  ./install.sh   y cerrar sesión / entrar.
"""
import sys
from PIL import Image

# destino -> (fichero en assets/, anclaje, lado del lienzo en px)
DESTINOS = {
    'navidad':   ('hat_navidad.png',   'abajo',  72),
    'halloween': ('hat_halloween.png', 'abajo',  72),
    'cumple':    ('hat_cumple.png',    'abajo',  72),
    'chef':      ('chef.png',          'abajo',  42),
    'pan':       ('pan.png',           'centro', 48),
    'moon':      ('moon.png',          'centro', 48),
    'zeta':      ('zeta.png',          'centro', 15),
    'steam':     ('steam.png',         'centro', 30),
    'note':      ('note.png',          'centro', 48),
    'lens':      ('lens.png',          'centro', 42),
    'bubble':    ('bubble.png',        'centro', 36),
    'heart':     ('heart.png',         'centro', 42),
    'sweat':     ('sweat.png',         'centro', 36),
    'star':      ('star.png',          'centro', 15),
}


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in DESTINOS:
        print(__doc__)
        print('Destinos válidos:', ', '.join(DESTINOS))
        sys.exit(1)

    origen, destino = sys.argv[1], sys.argv[2]
    fichero, anclaje, lado = DESTINOS[destino]

    img = Image.open(origen).convert('RGBA')
    bbox = img.getbbox()
    if not bbox:
        print('El dibujo está vacío (¿todo transparente?).')
        sys.exit(1)
    img = img.crop(bbox)

    # Escalado entero sin suavizado mientras quepa; si no, reducción nítida.
    factor = max(1, min(lado // max(img.width, 1), lado // max(img.height, 1)))
    if factor > 1:
        img = img.resize((img.width * factor, img.height * factor), Image.NEAREST)
    if img.width > lado or img.height > lado:
        escala = min(lado / img.width, lado / img.height)
        img = img.resize((max(1, round(img.width * escala)),
                          max(1, round(img.height * escala))), Image.NEAREST)

    lienzo = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    x = (lado - img.width) // 2
    y = lado - img.height if anclaje == 'abajo' else (lado - img.height) // 2
    lienzo.paste(img, (x, y), img)

    salida = f'assets/{fichero}'
    lienzo.save(salida)
    print(f'escrito {salida}  ({lado}x{lado}, anclaje={anclaje})')
    print('Ahora:  ./install.sh   y cierra sesión / vuelve a entrar.')


if __name__ == '__main__':
    main()
