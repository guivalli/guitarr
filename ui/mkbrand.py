from PIL import Image, ImageDraw, ImageFilter, ImageChops
import base64, io
im=Image.open('logo.jpeg').convert('RGB')
S=2752/2000
def px(*v): return [int(round(x*S)) for x in v]
def bbox(box,thr,img=im):
    sub=img.crop(box).convert('L').point(lambda v:255 if v>thr else 0)
    b=sub.getbbox(); return (box[0]+b[0],box[1]+b[1],box[0]+b[2],box[1]+b[3])

def circle_mask(size, cx, cy, r, ss=4):
    m=Image.new('L',(size[0]*ss,size[1]*ss),0)
    ImageDraw.Draw(m).ellipse([(cx-r)*ss,(cy-r)*ss,(cx+r)*ss,(cy+r)*ss],fill=255)
    return m.resize(size,Image.LANCZOS)

def disc(box,thr=16):
    b=bbox(box,thr); cx=(b[0]+b[2])/2; cy=(b[1]+b[3])/2; r=min(b[2]-b[0],b[3]-b[1])/2
    return cx,cy,r

# 1) marca (disco) — círculo transparente
cx,cy,r=disc(px(60,60,560,520))
sq=im.crop((round(cx-r),round(cy-r),round(cx+r),round(cy+r)))
mask=circle_mask(sq.size,r,r,r-1.5)
mark=sq.copy(); mark.putalpha(mask)
mark512=mark.resize((512,512),Image.LANCZOS)
mark512.save('brand/logos/logo-mark.png',optimize=True)
print('mark r',r)

# 2) logos com texto: disco opaco + texto por luminância
def with_text_alpha(box, disc_box, manual=None):
    dcx,dcy,dr=manual or disc(disc_box)
    crop=im.crop(box)
    lum=crop.convert('L')
    a=lum.point(lambda v:max(0,min(255,int((v-20)*255/70))))
    dm=circle_mask(crop.size,dcx-box[0],dcy-box[1],dr-1.5)
    alpha=ImageChops.lighter(a,dm)
    out=crop.copy(); out.putalpha(alpha); return out
hb=bbox(px(60,600,1180,1030),30)
h=hb[3]-hb[1]; horiz=with_text_alpha(hb,None,(hb[0]+h/2,hb[1]+h/2,h/2))
horiz.save('brand/logos/logo-horizontal.png',optimize=True)
vb=bbox(px(1250,150,1990,950),30)
vert=with_text_alpha(vb,px(1330,170,1870,680))
vert.save('brand/logos/logo-vertical.png',optimize=True)
print('horiz',horiz.size,'vert',vert.size)

# 3) favicon: marca verde sobre tile escuro, quadrado
tb=bbox(px(640,60,1180,520),20)
tile_bg=im.getpixel((tb[0]+tb[2]//12*0+40, (tb[1]+tb[3])//2))
inner=im.crop((tb[0]+30,tb[1]+30,tb[2]-30,tb[3]-30))
# bbox do verde (canal G alto e R baixo)
g=Image.eval(inner.split()[1],lambda v:255 if v>120 else 0)
gb=g.getbbox(); glyph=inner.crop(gb)
print('tile',tb,'bg',tile_bg,'glyph',glyph.size)
def tile_icon(n, pad, rounded=True, bg=tile_bg):
    c=Image.new('RGB',(n,n),bg)
    s=n*(1-2*pad)/max(glyph.size)
    gw,gh=round(glyph.width*s),round(glyph.height*s)
    c.paste(glyph.resize((gw,gh),Image.LANCZOS),((n-gw)//2,(n-gh)//2))
    c=c.convert('RGBA')
    if rounded:
        ss=4; m=Image.new('L',(n*ss,n*ss),0)
        ImageDraw.Draw(m).rounded_rectangle([0,0,n*ss-1,n*ss-1],radius=int(n*ss*0.18),fill=255)
        c.putalpha(m.resize((n,n),Image.LANCZOS))
    return c
R='brand/root/'
for n in (16,32): tile_icon(n,0.10 if n>16 else 0.06).save(f'{R}favicon-{n}x{n}.png',optimize=True)
tile_icon(192,0.14).save(R+'android-chrome-192x192.png',optimize=True)
tile_icon(512,0.14).save(R+'android-chrome-512x512.png',optimize=True)
tile_icon(512,0.22,rounded=False).convert('RGB').save(R+'maskable-512x512.png',optimize=True)
for n in (180,152,120,76,60): tile_icon(n,0.16,rounded=False).convert('RGB').save(f'{R}apple-touch-icon-{n}x{n}.png',optimize=True)
tile_icon(180,0.16,rounded=False).convert('RGB').save(R+'apple-touch-icon.png',optimize=True)
for n in (70,144,150,310): tile_icon(n,0.16,rounded=False).convert('RGB').save(f'{R}mstile-{n}x{n}.png',optimize=True)
ico=tile_icon(64,0.10)
ico.save(R+'favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])
# versões inline para o HTML
def b64png(img,w=None,colors=None):
    if w: img=img.resize((w,round(img.height*w/img.width)),Image.LANCZOS)
    buf=io.BytesIO(); img.save(buf,'PNG',optimize=True); return 'data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
open('brand/inline_mark.txt','w').write(b64png(mark512,96))
open('brand/inline_favicon.txt','w').write(b64png(tile_icon(64,0.10)))
open('brand/inline_vertical.txt','w').write(b64png(vert,300))
for f in ('inline_mark','inline_favicon','inline_vertical'): print(f,len(open(f'brand/{f}.txt').read()))
