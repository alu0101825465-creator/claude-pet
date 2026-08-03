#!/usr/bin/env python3
"""Build every sprite and overlay for Claude Pet from the official artwork.

Usage:
    python3 build_sprites.py SOURCE [--size 96] [--preview OUT.png]

Writes to assets/:
    idle_0/1, walk_0..3, jump_0/1   (with depth shading on the trailing edge)
    sleep_0                         (lying down: no legs, body lowered, sleep cap)
    moon, zeta, steam, chef, pan, note, note_0..5, lens, bubble,
    hat_christmas, hat_halloween, hat_birthday, heart, sweat, star, coffee

All pixel art uses the SAME block size as the character (~size/16); the "z" and
the star use a smaller block so they stay legible.

Only depends on Pillow. Build-time tool: the shell never loads this.
"""
import sys
from PIL import Image, ImageDraw

KEY = (255, 0, 255)
THRESH = 120
MARGIN = 0.06
ALPHA_MIN = 40

NAVY = (26, 35, 82, 255)
POM = (255, 255, 255, 255)
SHADE_GREY = (70, 70, 74)          # colour the trailing edge is blended towards


# ---------- Character ----------

def remove_background(img):
    """Clear only the dark background connected to the border (keeps the eyes)."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, corner, KEY, thresh=THRESH)
    px = rgb.load()
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == KEY:
                ap[x, y] = 0
    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out


def body_colour(base):
    px = base.load()
    w, h = base.size
    r = g = b = n = 0
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            pr, pg, pb, pa = px[x, y]
            if pa > ALPHA_MIN and not (pr < 70 and pg < 70 and pb < 70):
                r += pr; g += pg; b += pb; n += 1
    n = max(n, 1)
    return (r // n, g // n, b // n, 255)


def close_eyes(base, body):
    """Blink frame: paint the dark opaque pixels (the eyes) in the body colour."""
    f = base.copy()
    px = f.load()
    w, h = f.size
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = px[x, y]
            if pa > ALPHA_MIN and pr < 70 and pg < 70 and pb < 70:
                px[x, y] = body
    return f


def _runs(px, y, x0, x1):
    """Spans of opaque columns on row y, within [x0, x1)."""
    res, inside, start = [], False, 0
    for x in range(x0, x1):
        op = px[x, y][3] > ALPHA_MIN
        if op and not inside:
            inside, start = True, x
        elif not op and inside:
            inside = False; res.append((start, x - 1))
    if inside:
        res.append((start, x1 - 1))
    return res


def detect_legs(base):
    """(band_y0, band_y1, [column spans, one per leg])."""
    px = base.load()
    x0, y0, x1, y1 = base.getbbox()
    band_y0 = y1
    y = y1 - 1
    while y > y0 and len(_runs(px, y, x0, x1)) >= 2:
        band_y0 = y
        y -= 1
    row = min(y1 - 2, (band_y0 + y1) // 2)
    return band_y0, y1, _runs(px, row, x0, x1)


def lift_legs(base, by0, by1, runs, lift):
    """Copy of base with the given leg columns shifted up (walk cycle)."""
    f = base.copy()
    fp = f.load(); bp = base.load()
    for (xs, xe) in runs:
        for x in range(xs, xe + 1):
            for y in range(by0, by1):
                fp[x, y] = (0, 0, 0, 0)
            for y in range(by0, by1):
                s = bp[x, y]
                if s[3] > ALPHA_MIN and by0 - lift <= y - lift < by1:
                    fp[x, y - lift] = s
    return f


def body_x_range(base):
    """(x_start, x_end) of the torso block, ignoring the arms."""
    px = base.load()
    x0, y0, x1, y1 = base.getbbox()
    y = y0 + max(1, (y1 - y0) // 10)
    runs = _runs(px, y, x0, x1)
    return max(runs, key=lambda r: r[1] - r[0])


def arms_up(base, torso_x, lift):
    """Copy of base with the arms (pixels outside the torso) shifted up."""
    bx0, bx1 = torso_x
    f = base.copy()
    fp = f.load(); bp = base.load()
    x0, y0, x1, y1 = base.getbbox()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x < bx0 or x > bx1) and bp[x, y][3] > ALPHA_MIN:
                fp[x, y] = (0, 0, 0, 0)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x < bx0 or x > bx1):
                s = bp[x, y]
                if s[3] > ALPHA_MIN and 0 <= y - lift:
                    fp[x, y - lift] = s
    return f


def lie_down(base):
    """Drop the legs and lower the body to the old ground line (sleeping pose)."""
    by0, by1, _ = detect_legs(base)
    lift = by1 - by0
    f = Image.new('RGBA', base.size, (0, 0, 0, 0))
    bp = base.load(); fp = f.load()
    x0, y0, x1, y1 = base.getbbox()
    for y in range(y0, by0):
        for x in range(x0, x1):
            s = bp[x, y]
            if s[3] > ALPHA_MIN:
                fp[x, y + lift] = s
    return f


def side_shading(sprite, block):
    """Darken the leftmost opaque columns of each row (fake depth)."""
    s = sprite.copy()
    px = s.load()
    w, h = s.size
    for y in range(h):
        counted = 0
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > ALPHA_MIN:
                px[x, y] = (int(r * 0.6 + SHADE_GREY[0] * 0.4),
                            int(g * 0.6 + SHADE_GREY[1] * 0.4),
                            int(b * 0.6 + SHADE_GREY[2] * 0.4), a)
                counted += 1
                if counted >= block:
                    break
    return s


def extract(frame, cx, cy, side, size):
    """Crop a `side` square centred on (cx, cy) — same framing for every frame."""
    left, top = cx - side // 2, cy - side // 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    crop = frame.crop((left, top, left + side, top + side))
    canvas.paste(crop, (0, 0), crop)
    return canvas.resize((size, size), Image.LANCZOS)


# ---------- Pixel-art overlays ----------

def stamp(draw, grid, colours, block, x0, y0):
    for gy, row in enumerate(grid):
        for gx, ch in enumerate(row):
            c = colours.get(ch)
            if c:
                x, y = x0 + gx * block, y0 + gy * block
                draw.rectangle([x, y, x + block - 1, y + block - 1], fill=c)


def png_from_grid(grid, colours, block, path, anchor='centre'):
    """anchor='bottom' keeps the drawing flush with the bottom of the square.

    St.Icon forces a square canvas; a wide drawing would otherwise get
    transparent padding above and below, which made the hats look detached.
    Hats are anchored at the bottom and the extension places them by that edge.
    """
    w, h = len(grid[0]) * block, len(grid) * block
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    stamp(ImageDraw.Draw(img), grid, colours, block, 0, 0)
    img = img.crop(img.getbbox())
    side = max(img.width, img.height)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    off_y = side - img.height if anchor == 'bottom' else (side - img.height) // 2
    square.paste(img, ((side - img.width) // 2, off_y), img)
    square.save(path)
    print(f'wrote {path} ({side}x{side}, anchor={anchor})')


GRID_SLEEP_CAP = [
    '........OOO.',
    '.......OOOOO',
    '.......OOOO.',
    '.....NNNN...',
    '..NNNNNNNN..',
    'OOOOOOOOOOOO',
    'OOOOOOOOOOOO',
]
GRID_HAT_CHRISTMAS = [
    '........OOO.',
    '.......OOOOO',
    '.......OOOO.',
    '.....RRRR...',
    '....RRRRR...',
    '...RRRRRR...',
    '..RRRRRRR...',
    '.RRRRRRRR...',
    'OOOOOOOOOOOO',
    'OOOOOOOOOOOO',
]
GRID_HAT_HALLOWEEN = [
    '.....GG...',
    '....GG....',
    '..CCCCCC..',
    '.CCCCCCCC.',
    'CCCCCCCCCC',
    'CXXCCCCXXC',
    'CCXCCCCXCC',
    'CCCCCCCCCC',
    'CXCCCCCCXC',
    'CXXXXXXXXC',
    '.CXCCCCXC.',
    '..CCCCCC..',
]
GRID_HAT_BIRTHDAY = [
    '.....O.....',
    '....AAA....',
    '....BBB....',
    '...AAAAA...',
    '...BBBBB...',
    '..AAAAAAA..',
]
GRID_HEART = [
    '.RR.RR.',
    'RRRRRRR',
    'RRRRRRR',
    '.RRRRR.',
    '..RRR..',
    '...R...',
]
GRID_SWEAT = [
    '..Q..',
    '..Q..',
    '.QQQ.',
    'QQQQQ',
    'QQQQQ',
    '.QQQ.',
]
GRID_STAR = [
    '..Y..',
    'YYYYY',
    '.YYY.',
    'YY.YY',
]
GRID_NOTE = [
    '....MM',
    '...M.M',
    '...M.M',
    '...M..',
    '.MMM..',
    'MMMM..',
    'MMMM..',
    '.MM...',
]
GRID_LENS = [
    '.LLL..',
    'L...L.',
    'L...L.',
    'L...L.',
    '.LLL..',
    '...LDD',
    '.....D',
]
GRID_BUBBLE = [
    'BBBBBB',
    'BDBDBB',
    'BBBBBB',
    'BBBBBB',
    'BB....',
    '.B....',
]
GRID_STEAM = [
    '.SSS.',
    'SSSSS',
    'SSSSS',
    '.SSS.',
]
GRID_CHEF = [
    '.WWWWW.',
    'WWWWWWW',
    'WWWWWWW',
    '.WWWWW.',
    'WWWWWWW',
]
GRID_PAN = [
    '.KKKKKK.....',
    'KKKKKKKKHHHH',
    'KKKKKKKKHHHH',
    '.KKKKKK.....',
]
GRID_MOON = [
    '..YYYY..',
    '.YYYYY..',
    'YYYY....',
    'YYYY....',
    'YYYY....',
    'YYYY....',
    '.YYYYY..',
    '..YYYY..',
]
GRID_Z = [
    'ZZZZZ',
    '...ZZ',
    '..ZZ.',
    '.ZZ..',
    'ZZZZZ',
]
GRID_SHADOW = [
    '..VVVVVVVV..',
    '.VVVVVVVVVV.',
    'VVVVVVVVVVVV',
    '.VVVVVVVVVV.',
    '..VVVVVVVV..',
]
GRID_COFFEE = [
    '..UU....',
    'TTTTTTT.',
    'TTTTTTTE',
    'TTTTTTTE',
    'TTTTTTTE',
    '.TTTTT..',
]

COL = {
    'N': NAVY, 'O': POM,
    'Y': (247, 206, 70, 255),
    'Z': (247, 247, 252, 255),
    'S': (232, 232, 238, 255),
    'W': (247, 247, 249, 255),
    'K': (66, 66, 72, 255),
    'H': (58, 42, 30, 255),
    'M': (44, 44, 54, 255),
    'L': (90, 130, 210, 255),
    'D': (70, 70, 80, 255),
    'B': (240, 240, 245, 255),
    'R': (214, 52, 74, 255),
    'X': (26, 26, 32, 255),
    'P': (108, 60, 150, 255),
    'A': (240, 120, 170, 255),
    'Q': (110, 170, 235, 255),
    'C': (235, 125, 30, 255),
    'G': (95, 145, 60, 255),
    'T': (238, 238, 242, 255),   # coffee mug
    'E': (200, 200, 206, 255),   # mug handle
    'U': (206, 206, 212, 255),   # steam wisp
    'V': (0, 0, 0, 90),          # ground shadow (semi-transparent)
}

NOTE_COLOURS = [
    (232, 74, 95, 255),
    (243, 146, 55, 255),
    (246, 208, 68, 255),
    (106, 200, 110, 255),
    (86, 165, 240, 255),
    (178, 120, 232, 255),
]


def add_sleep_cap(sprite, block):
    """Stamp the pixel sleep cap onto the lying-down sprite."""
    s = sprite.copy()
    d = ImageDraw.Draw(s)
    px = s.load()
    x0, y0, x1, y1 = s.getbbox()
    yh = y0 + 2
    xs = [x for x in range(x0, x1) if px[x, yh][3] > ALPHA_MIN]
    hx0, hx1 = (min(xs), max(xs)) if xs else (x0, x1)
    cx = (hx0 + hx1) // 2
    width = len(GRID_SLEEP_CAP[0]) * block
    rows = len(GRID_SLEEP_CAP)
    stamp(d, GRID_SLEEP_CAP, COL, block, cx - width // 2, y0 - (rows - 2) * block)
    return s


# ---------- Main ----------

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    size = 96
    preview = None
    for i, a in enumerate(sys.argv):
        if a.startswith('--size'):
            size = int(a.split('=')[1]) if '=' in a else int(sys.argv[i + 1])
        if a.startswith('--preview'):
            preview = a.split('=')[1] if '=' in a else sys.argv[i + 1]
    source = args[0]

    block = max(2, round(size / 16))
    block_small = max(1, round(size / 32))
    block_pan = max(2, round(size / 24))

    base = remove_background(Image.open(source))
    body = body_colour(base)
    by0, by1, runs = detect_legs(base)
    lift = max(6, (by1 - by0) // 2)
    torso_x = body_x_range(base)
    x0b, y0b, x1b, y1b = base.getbbox()
    hands = arms_up(base, torso_x, int((y1b - y0b) * 0.28))

    even = [runs[i] for i in range(0, len(runs), 2)]
    odd = [runs[i] for i in range(1, len(runs), 2)]

    frames = {
        'idle_0': base,
        'idle_1': close_eyes(base, body),
        'walk_0': lift_legs(base, by0, by1, even, lift),
        'walk_1': base,
        'walk_2': lift_legs(base, by0, by1, odd, lift),
        'walk_3': base,
        'jump_0': hands,
        'jump_1': close_eyes(hands, body),
    }

    cx, cy = (x0b + x1b) // 2, (y0b + y1b) // 2
    side = int(max(x1b - x0b, y1b - y0b) * (1 + 2 * MARGIN))

    sprites = {n: side_shading(extract(f, cx, cy, side, size), block)
               for n, f in frames.items()}
    sprites['sleep_0'] = add_sleep_cap(
        extract(lie_down(close_eyes(base, body)), cx, cy, side, size), block)

    for n, s in sprites.items():
        s.save(f'assets/{n}.png')
        print(f'wrote assets/{n}.png')

    # Hats are anchored at the bottom (the extension places them by that edge).
    png_from_grid(GRID_HAT_CHRISTMAS, COL, block, 'assets/hat_christmas.png', 'bottom')
    png_from_grid(GRID_HAT_HALLOWEEN, COL, block, 'assets/hat_halloween.png', 'bottom')
    png_from_grid(GRID_HAT_BIRTHDAY, COL, block, 'assets/hat_birthday.png', 'bottom')
    png_from_grid(GRID_CHEF, COL, block, 'assets/chef.png', 'bottom')

    for grid, name, blk in [
        (GRID_MOON, 'moon', block), (GRID_Z, 'zeta', block_small),
        (GRID_STEAM, 'steam', block), (GRID_PAN, 'pan', block_pan),
        (GRID_NOTE, 'note', block), (GRID_LENS, 'lens', block),
        (GRID_BUBBLE, 'bubble', block), (GRID_HEART, 'heart', block),
        (GRID_SWEAT, 'sweat', block), (GRID_STAR, 'star', block_small),
        (GRID_COFFEE, 'coffee', block), (GRID_SHADOW, 'shadow', block),
    ]:
        png_from_grid(grid, COL, blk, f'assets/{name}.png')

    for i, c in enumerate(NOTE_COLOURS):
        png_from_grid(GRID_NOTE, {**COL, 'M': c}, block, f'assets/note_{i}.png')

    if preview:
        order = ['idle_0', 'walk_0', 'jump_0', 'sleep_0']
        extras = ['hat_christmas', 'hat_halloween', 'coffee', 'heart']
        strip = Image.new('RGBA', (size * (len(order) + len(extras)), size),
                          (130, 130, 130, 255))
        for i, n in enumerate(order):
            strip.alpha_composite(sprites[n], (i * size, 0))
        for j, n in enumerate(extras):
            ov = Image.open(f'assets/{n}.png').convert('RGBA')
            strip.alpha_composite(ov, ((len(order) + j) * size +
                                       (size - ov.width) // 2,
                                       size - ov.height))
        strip.convert('RGB').save(preview)
        print(f'preview {preview}')


if __name__ == '__main__':
    main()
