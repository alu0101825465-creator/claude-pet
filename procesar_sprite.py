#!/usr/bin/env python3
"""Genera los frames y overlays del Claude pet desde la imagen oficial.

Uso:
    python3 procesar_sprite.py ORIGEN [--tam 96] [--preview RUTA.png]

En assets/:
    idle_0/1, walk_0..3, jump_0/1   (con sombra lateral de profundidad, borde izq.)
    sleep_0                         (acostado: sin patas, cuerpo bajado, gorro pixel)
    moon.png, zeta.png, steam.png, chef.png   (overlays pixel-art)

Todo el pixel-art (gorro, luna, z, vapor, chef) usa el MISMO tamaño de bloque que
el personaje (~tam/16 px); las z usan bloque más pequeño para que se lean.

Solo depende de Pillow. Herramienta de build; NO la carga el shell.
"""
import sys
from PIL import Image, ImageDraw

CLAVE = (255, 0, 255)
THRESH = 120
MARGEN = 0.06
ALPHA_MIN = 40

NAVY = (26, 35, 82, 255)
POM = (255, 255, 255, 255)           # pompón blanco
GRIS_SOMBRA = (70, 70, 74)          # hacia dónde "engrisar" el borde de profundidad


# ---------- Base ----------

def quitar_fondo(img):
    rgb = img.convert('RGB')
    w, h = rgb.size
    for esq in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, esq, CLAVE, thresh=THRESH)
    px = rgb.load()
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == CLAVE:
                ap[x, y] = 0
    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out


def color_cuerpo(base):
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


def cerrar_ojos(base, cuerpo):
    f = base.copy()
    px = f.load()
    w, h = f.size
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = px[x, y]
            if pa > ALPHA_MIN and pr < 70 and pg < 70 and pb < 70:
                px[x, y] = cuerpo
    return f


def _runs(px, y, x0, x1):
    res, dentro, ini = [], False, 0
    for x in range(x0, x1):
        op = px[x, y][3] > ALPHA_MIN
        if op and not dentro:
            dentro, ini = True, x
        elif not op and dentro:
            dentro = False; res.append((ini, x - 1))
    if dentro:
        res.append((ini, x1 - 1))
    return res


def detectar_patas(base):
    px = base.load()
    x0, y0, x1, y1 = base.getbbox()
    by0 = y1
    y = y1 - 1
    while y > y0 and len(_runs(px, y, x0, x1)) >= 2:
        by0 = y
        y -= 1
    rep = min(y1 - 2, (by0 + y1) // 2)
    return by0, y1, _runs(px, rep, x0, x1)


def levantar_patas(base, by0, by1, runs, lift):
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


def cuerpo_rango_x(base):
    px = base.load()
    x0, y0, x1, y1 = base.getbbox()
    y = y0 + max(1, (y1 - y0) // 10)
    runs = _runs(px, y, x0, x1)
    return max(runs, key=lambda r: r[1] - r[0])


def manos_arriba(base, cuerpo_x, lift):
    bx0, bx1 = cuerpo_x
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


def acostar(base):
    """Quita las patas y baja el cuerpo hasta la antigua línea del suelo (acostado)."""
    by0, by1, _ = detectar_patas(base)
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


def sombra_lado(sprite, block):
    """Engrisa las 'block' columnas opacas más a la IZQUIERDA de cada fila (profundidad)."""
    s = sprite.copy()
    px = s.load()
    w, h = s.size
    for y in range(h):
        contadas = 0
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > ALPHA_MIN:
                nr = int(r * 0.6 + GRIS_SOMBRA[0] * 0.4)
                ng = int(g * 0.6 + GRIS_SOMBRA[1] * 0.4)
                nb = int(b * 0.6 + GRIS_SOMBRA[2] * 0.4)
                px[x, y] = (nr, ng, nb, a)
                contadas += 1
                if contadas >= block:
                    break
    return s


def extraer(frame_full, cx, cy, lado, tam):
    izq, arr = cx - lado // 2, cy - lado // 2
    lienzo = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    rec = frame_full.crop((izq, arr, izq + lado, arr + lado))
    lienzo.paste(rec, (0, 0), rec)
    return lienzo.resize((tam, tam), Image.LANCZOS)


# ---------- Pixel-art (bloques) ----------

def stamp(draw, grid, colores, block, x0, y0):
    for gy, fila in enumerate(grid):
        for gx, ch in enumerate(fila):
            c = colores.get(ch)
            if c:
                X, Y = x0 + gx * block, y0 + gy * block
                draw.rectangle([X, Y, X + block - 1, Y + block - 1], fill=c)


def png_de_grid(grid, colores, block, ruta, anclaje='centro'):
    """anclaje='abajo' deja el contenido pegado al borde INFERIOR del cuadrado.

    St.Icon fuerza lienzo cuadrado; si el dibujo es apaisado queda relleno
    transparente arriba y abajo. Para los sombreros eso los hacía "flotar", así
    que se anclan abajo y la extensión los posiciona por su borde inferior.
    """
    w, h = len(grid[0]) * block, len(grid) * block
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    stamp(ImageDraw.Draw(img), grid, colores, block, 0, 0)
    img = img.crop(img.getbbox())
    lado = max(img.width, img.height)
    cuad = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    off_y = lado - img.height if anclaje == 'abajo' else (lado - img.height) // 2
    cuad.paste(img, ((lado - img.width) // 2, off_y), img)
    cuad.save(ruta)
    print(f'escrito {ruta} ({lado}x{lado}, anclaje={anclaje})')


GRID_GORRO = [
    '.........OOO',
    '........OOOO',
    '.....NNNNN..',
    '...NNNNNNNN.',
    'OOOOOOOOOOOO',
    'OOOOOOOOOOOO',
]
GRID_SARTEN = [
    '.KKKKKK.....',
    'KKKKKKKKHHHH',
    'KKKKKKKKHHHH',
    '.KKKKKK.....',
]
GRID_LUNA = [
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
GRID_VAPOR = [
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
# Gorro de Papá Noel: pompón blanco arriba-derecha, cuerpo rojo escalonado
# cayendo hacia la izquierda y banda blanca gruesa abajo.
GRID_HAT_NAVIDAD = [
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
# Calabaza de Halloween (jack-o'-lantern) con rabito verde.
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
GRID_HAT_CUMPLE = [
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
COL = {
    'N': NAVY, 'O': POM,
    'Y': (247, 206, 70, 255),
    'Z': (247, 247, 252, 255),
    'S': (232, 232, 238, 255),
    'W': (247, 247, 249, 255),
    'K': (66, 66, 72, 255),          # sartén (gris oscuro)
    'H': (58, 42, 30, 255),          # mango (marrón)
    'M': (44, 44, 54, 255),          # nota musical (casi negro)
    'L': (90, 130, 210, 255),        # aro de la lupa (azul)
    'D': (70, 70, 80, 255),          # detalle (mango lupa / puntos burbuja)
    'B': (240, 240, 245, 255),       # burbuja (blanco)
    'R': (214, 52, 74, 255),         # rojo (gorro Navidad / corazón)
    'X': (26, 26, 32, 255),          # negro (bruja)
    'P': (108, 60, 150, 255),        # morado (ala de bruja)
    'A': (240, 120, 170, 255),       # rosa (fiesta)
    'Q': (110, 170, 235, 255),       # azul (gotita de sudor)
    'C': (235, 125, 30, 255),        # naranja calabaza
    'G': (95, 145, 60, 255),         # verde rabito
}

# Colores por los que van rotando las notas musicales.
NOTA_COLORES = [
    (232, 74, 95, 255),     # rojo
    (243, 146, 55, 255),    # naranja
    (246, 208, 68, 255),    # amarillo
    (106, 200, 110, 255),   # verde
    (86, 165, 240, 255),    # azul
    (178, 120, 232, 255),   # morado
]


def poner_gorro(sleep96, block):
    """Estampa el gorrito pixel sobre la cabeza del sprite acostado (tam×tam)."""
    s = sleep96.copy()
    d = ImageDraw.Draw(s)
    px = s.load()
    x0, y0, x1, y1 = s.getbbox()
    yh = y0 + 2
    xs = [x for x in range(x0, x1) if px[x, yh][3] > ALPHA_MIN]
    hx0, hx1 = (min(xs), max(xs)) if xs else (x0, x1)
    cxh = (hx0 + hx1) // 2
    ancho = len(GRID_GORRO[0]) * block
    filas = len(GRID_GORRO)
    # Banda CENTRADA y apoyada en el borde superior de la cabeza (sin dejar
    # techo naranja por encima).
    x_ini = cxh - ancho // 2
    y_ini = y0 - (filas - 2) * block
    stamp(d, GRID_GORRO, COL, block, x_ini, y_ini)
    return s


# ---------- Main ----------

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    tam = 96
    preview = None
    for i, a in enumerate(sys.argv):
        if a.startswith('--tam'):
            tam = int(a.split('=')[1]) if '=' in a else int(sys.argv[i + 1])
        if a.startswith('--preview'):
            preview = a.split('=')[1] if '=' in a else sys.argv[i + 1]
    origen = args[0]

    block = max(2, round(tam / 16))        # bloque del personaje (~6 a 96)
    block_z = max(1, round(tam / 32))      # z más pequeñas (~3 a 96)
    block_pan = max(2, round(tam / 24))    # sartén más compacta (~4 a 96)

    base = quitar_fondo(Image.open(origen))
    cuerpo = color_cuerpo(base)
    by0, by1, runs = detectar_patas(base)
    lift = max(6, (by1 - by0) // 2)
    cuerpo_x = cuerpo_rango_x(base)
    x0b, y0b, x1b, y1b = base.getbbox()
    arm_lift = int((y1b - y0b) * 0.28)
    manos = manos_arriba(base, cuerpo_x, arm_lift)

    pares = [runs[i] for i in range(0, len(runs), 2)]
    impares = [runs[i] for i in range(1, len(runs), 2)]

    frames_full = {
        'idle_0': base,
        'idle_1': cerrar_ojos(base, cuerpo),
        'walk_0': levantar_patas(base, by0, by1, pares, lift),
        'walk_1': base,
        'walk_2': levantar_patas(base, by0, by1, impares, lift),
        'walk_3': base,
        'jump_0': manos,
        'jump_1': cerrar_ojos(manos, cuerpo),
    }

    cx, cy = (x0b + x1b) // 2, (y0b + y1b) // 2
    lado = int(max(x1b - x0b, y1b - y0b) * (1 + 2 * MARGEN))

    sprites = {}
    for n, f in frames_full.items():
        sp = extraer(f, cx, cy, lado, tam)
        sprites[n] = sombra_lado(sp, block)     # profundidad (borde izq.)

    # Acostado: sin patas, cuerpo bajado, ojos cerrados + gorro pixel. Sin sombra.
    sleep_full = acostar(cerrar_ojos(base, cuerpo))
    sleep96 = extraer(sleep_full, cx, cy, lado, tam)
    sprites['sleep_0'] = poner_gorro(sleep96, block)

    for n, s in sprites.items():
        s.save(f'assets/{n}.png')
        print(f'escrito assets/{n}.png')

    # Overlays pixel-art independientes.
    png_de_grid(GRID_LUNA, COL, block, 'assets/moon.png')
    png_de_grid(GRID_Z, COL, block_z, 'assets/zeta.png')
    png_de_grid(GRID_VAPOR, COL, block, 'assets/steam.png')
    png_de_grid(GRID_CHEF, COL, block, 'assets/chef.png')
    png_de_grid(GRID_SARTEN, COL, block_pan, 'assets/pan.png')
    png_de_grid(GRID_NOTE, COL, block, 'assets/note.png')
    # Notas de colores para el goteo continuo mientras suena música.
    for i, c in enumerate(NOTA_COLORES):
        png_de_grid(GRID_NOTE, {**COL, 'M': c}, block, f'assets/note_{i}.png')
    png_de_grid(GRID_LENS, COL, block, 'assets/lens.png')
    png_de_grid(GRID_BUBBLE, COL, block, 'assets/bubble.png')
    # Sombreros: anclados abajo (se posicionan por su borde inferior).
    png_de_grid(GRID_HAT_NAVIDAD, COL, block, 'assets/hat_navidad.png', 'abajo')
    png_de_grid(GRID_HAT_HALLOWEEN, COL, block, 'assets/hat_halloween.png', 'abajo')
    png_de_grid(GRID_HAT_CUMPLE, COL, block, 'assets/hat_cumple.png', 'abajo')
    png_de_grid(GRID_HEART, COL, block, 'assets/heart.png')
    png_de_grid(GRID_SWEAT, COL, block, 'assets/sweat.png')
    png_de_grid(GRID_STAR, COL, block_z, 'assets/star.png')

    if preview:
        orden = ['idle_0', 'walk_0', 'jump_0', 'sleep_0']
        extras = ['moon', 'zeta', 'steam', 'chef']
        tira = Image.new('RGBA', (tam * (len(orden) + len(extras)), tam),
                         (130, 130, 130, 255))
        for i, n in enumerate(orden):
            tira.alpha_composite(sprites[n], (i * tam, 0))
        for j, n in enumerate(extras):
            ov = Image.open(f'assets/{n}.png').convert('RGBA')
            tira.alpha_composite(ov, ((len(orden) + j) * tam + (tam - ov.width) // 2,
                                      (tam - ov.height) // 2))
        tira.convert('RGB').save(preview)
        print(f'preview {preview}')


if __name__ == '__main__':
    main()
