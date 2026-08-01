#!/usr/bin/env python3
"""Adapt a PNG you drew yourself into the format the extension expects.

Usage:
    python3 import_art.py MY_DRAWING.png christmas    # Christmas hat
    python3 import_art.py MY_DRAWING.png halloween
    python3 import_art.py MY_DRAWING.png birthday
    python3 import_art.py MY_DRAWING.png chef         # chef hat
    python3 import_art.py MY_DRAWING.png pan|moon|zeta|steam|note|lens|bubble|
                                        heart|sweat|star|coffee

Draw however you like (any size, transparent background) in Pixelorama,
LibreSprite, GIMP… and this script will:
  - crop to the drawing,
  - scale it with NEAREST neighbour so it stays crisp pixel art,
  - pad the canvas to a SQUARE (St.Icon requires it, otherwise it stretches),
  - anchor hats at the bottom (the extension rests them on the head by that edge),
  - save it into assets/ under the right name.

Then run:  ./install.sh   and log out / back in.
"""
import sys
from PIL import Image

# target -> (file in assets/, anchor, canvas side in px)
TARGETS = {
    'christmas': ('hat_christmas.png', 'bottom', 72),
    'halloween': ('hat_halloween.png', 'bottom', 72),
    'birthday':  ('hat_birthday.png',  'bottom', 72),
    'chef':      ('chef.png',          'bottom', 42),
    'pan':       ('pan.png',           'centre', 48),
    'moon':      ('moon.png',          'centre', 48),
    'zeta':      ('zeta.png',          'centre', 15),
    'steam':     ('steam.png',         'centre', 30),
    'note':      ('note.png',          'centre', 48),
    'lens':      ('lens.png',          'centre', 42),
    'bubble':    ('bubble.png',        'centre', 36),
    'heart':     ('heart.png',         'centre', 42),
    'sweat':     ('sweat.png',         'centre', 36),
    'star':      ('star.png',          'centre', 15),
    'coffee':    ('coffee.png',        'centre', 48),
}


def main():
    if len(sys.argv) < 3 or sys.argv[2] not in TARGETS:
        print(__doc__)
        print('Valid targets:', ', '.join(TARGETS))
        sys.exit(1)

    source, target = sys.argv[1], sys.argv[2]
    filename, anchor, side = TARGETS[target]

    img = Image.open(source).convert('RGBA')
    bbox = img.getbbox()
    if not bbox:
        print('The drawing is empty (fully transparent?).')
        sys.exit(1)
    img = img.crop(bbox)

    # Integer upscale without smoothing while it fits; crisp downscale otherwise.
    factor = max(1, min(side // max(img.width, 1), side // max(img.height, 1)))
    if factor > 1:
        img = img.resize((img.width * factor, img.height * factor), Image.NEAREST)
    if img.width > side or img.height > side:
        scale = min(side / img.width, side / img.height)
        img = img.resize((max(1, round(img.width * scale)),
                          max(1, round(img.height * scale))), Image.NEAREST)

    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    x = (side - img.width) // 2
    y = side - img.height if anchor == 'bottom' else (side - img.height) // 2
    canvas.paste(img, (x, y), img)

    out = f'assets/{filename}'
    canvas.save(out)
    print(f'wrote {out}  ({side}x{side}, anchor={anchor})')
    print('Now run:  ./install.sh   and log out / back in.')


if __name__ == '__main__':
    main()
