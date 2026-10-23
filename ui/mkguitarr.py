# Gera logo-guitarr.png a partir do logo.jpeg: o verde vira o azul da marca
# (#3b8cff) e o texto "Guitarr" vira "Guitarr" (Plus Jakarta Sans 800).
# Uso: python3 mkguitarr.py logo.jpeg PlusJakartaSans.ttf logo-guitarr.png
import sys, colorsys
from PIL import Image, ImageDraw, ImageFont

src, font_path, out = sys.argv[1:4]
im = Image.open(src).convert('RGB')
S = im.width / 2000  # coordenadas medidas na imagem com 2000 px de largura
def px(*v): return tuple(int(round(x * S)) for x in v)

# 1) verde -> azul, mantendo o antisserrilhado (só muda o matiz)
BLUE_H = 216 / 360
hsv = im.convert('HSV')
H, Sat, V = hsv.split()
h, s, v = H.load(), Sat.load(), V.load()
for y in range(im.height):
    for x in range(im.width):
        hh = h[x, y] * 360 / 255
        if 85 <= hh <= 170 and s[x, y] > 60:
            h[x, y] = int(BLUE_H * 255)
            v[x, y] = min(255, int(v[x, y] * 1.12))
im = Image.merge('HSV', (H, Sat, V)).convert('RGB')

# 2) apaga o texto antigo com a cor do fundo logo acima dele
d = ImageDraw.Draw(im)
def blank(box):
    x0, y0, x1, y1 = box
    strip = im.crop((x0, y0 - px(0, 0, 0, 30)[3], x1, y0 - 4)).resize((1, 1), Image.BOX)
    d.rectangle(box, fill=strip.getpixel((0, 0)))
blank(px(500, 700, 1180, 945))    # horizontal
blank(px(1270, 700, 1990, 945))   # vertical

# 3) escreve "Guit" azul + "arr" claro, numa linha
BLUE, WHITE = (59, 140, 255), (240, 242, 245)
def word(cx, cy, width, left=None):
    size = 400
    while True:
        f = ImageFont.truetype(font_path, size)
        f.set_variation_by_axes([800])
        w = d.textlength('Guitarr', font=f)
        if w <= width or size < 40:
            break
        size -= 4
    asc, desc = f.getmetrics()
    x = left if left is not None else cx - w / 2
    y = cy - (asc + desc) / 2 + desc * 0.35
    d.text((x, y), 'Guit', font=f, fill=BLUE)
    d.text((x + d.textlength('Guit', font=f), y), 'arr', font=f, fill=WHITE)

word(None, px(0, 828)[1], px(560)[0], left=px(515)[0])       # ao lado do disco
word(px(1597)[0], px(0, 820)[1], px(620)[0])                 # abaixo do disco, centralizado
im.save(out)
print('ok', out, im.size)
