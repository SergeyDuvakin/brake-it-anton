# Start-screen mockup: native 400x225, every element placed on the pixel grid, x4 nearest.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
A = '/workspace/bia-repo/assets/pixel/'
F = A + 'fonts/PixeloidSans-Bold.ttf'
W, H = 400, 225
INK = (0x2A,0x24,0x30); INK2=(0x1C,0x18,0x1C); CREAM=(0xFF,0xF6,0xE4); PAPER=(0xF6,0xEC,0xD6)
GRASS=(0x5C,0xB8,0x7A); GRASS_D=(0x4C,0xA0,0x68); GRASS_L=(0x74,0xC8,0x8C)
ROAD=(0x58,0x60,0x78); ROAD_D=(0x48,0x50,0x68); SIDE=(0xB4,0xB4,0xC4); SIDE_D=(0x9A,0x9A,0xAC); SIDE_L=(0xE8,0xE8,0xF0)
YEL=(0xFA,0xC8,0x3C); YEL_L=(0xFF,0xE0,0x6A); YEL_D=(0xD4,0x9A,0x20); BROWN=(0x6E,0x42,0x10)
GREEN=(0x8C,0xBE,0x5A); GREEN_D=(0x5E,0x94,0x3A); RED=(0xE8,0x34,0x28); BEIGE=(0xCC,0xBE,0x9E)
im = Image.new('RGBA', (W, H), GRASS + (255,)); d = ImageDraw.Draw(im); d.fontmode = '1'
def px(x,y,c): im.putpixel((x,y), c + (255,))
def rect(x0,y0,x1,y1,c): d.rectangle([x0,y0,x1,y1], fill=c)
def spr(name, x, y, rot=0, flip=False):
    s = Image.open(A + name).convert('RGBA')
    if rot: s = s.rotate(rot, expand=True)          # 90-degree steps only: lossless
    if flip: s = s.transpose(Image.FLIP_LEFT_RIGHT)
    im.alpha_composite(s, (x, y)); return s.size
def shadow(x0,y0,x1,y1):
    sh = Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sh).rectangle([x0,y0,x1,y1], fill=(0x1C,0x18,0x1C,70)); im.alpha_composite(sh)
def font(n): return ImageFont.truetype(F, n)
def text(x,y,s,n,c): d.text((x,y), s, font=font(n), fill=c)
def tw(s,n): b=d.textbbox((0,0),s,font=font(n)); return b[2]-b[0], b[1], b[3]
# grass speckle, deterministic
import random; r = random.Random(7)
for _ in range(520):
    x,y = r.randrange(W), r.randrange(H); px(x,y, GRASS_D if r.random()<0.6 else GRASS_L)
# --- street band ---
SW1, RD0, RD1, SW2 = 93, 103, 166, 167   # sidewalk 93..102, road 103..166 (64 px = 6.5 m), sidewalk 167..176
rect(0,SW1,W-1,RD0-1,SIDE); rect(0,SW2,W-1,SW2+9,SIDE)
for x in range(0,W,8):
    for y in range(SW1,RD0): px(x,y,SIDE_D)
    for y in range(SW2,SW2+10): px(x,y,SIDE_D)
rect(0,SW1,W-1,SW1,SIDE_L); rect(0,SW2+9,W-1,SW2+9,SIDE_D)
rect(0,RD0,W-1,RD1,ROAD); rect(0,RD0,W-1,RD0,ROAD_D); rect(0,RD1,W-1,RD1,ROAD_D)
cy = (RD0+RD1)//2
for x in range(0,W,12): rect(x,cy,x+5,cy+1,CREAM)
# --- above the road: a small park under the title, one tall block by the light ---
spr('world/sprites/block-teal-tall.png', 210, SW1-41)
for x,y in [(-4,SW1-20),(58,SW1-24),(118,SW1-24),(176,SW1-23)]: spr('world/sprites/tree.png', x, y)
spr('world/sprites/bench.png', 26, SW1-10); spr('world/sprites/planter.png', 86, SW1-8); spr('world/sprites/bench.png', 146, SW1-10)
spr('world/sprites/traffic-light-green.png', 247, SW1-22); spr('world/sprites/sign-zebra.png', 198, SW1-12)
spr('world/sprites/hydrant.png', 106, SW1+1); spr('world/sprites/trash-bin.png', 180, SW1+1)
spr('world/sprites/ped-pink-right-0.png', 64, SW1-6)
# zebra across the road
for y in range(RD0+3, RD1-2, 6): rect(214,y,227,y+3,(0xE8,0xE8,0xF0))
# below the road
spr('world/sprites/dog-right.png', 194, SW2+1); spr('world/sprites/ped-blue-left-1.png', 230, SW2-7)
spr('world/sprites/tree.png', 4, SW2+14); spr('world/sprites/tree.png', 236, SW2+22); spr('world/sprites/manhole.png', 150, RD0+10)
# --- cars: learner heading right in the near lane, white NPC heading left in the far lane ---
spr('car/npc-white-left.png', 18, RD0+4)
spr('car/learner-normal.png', 112, RD1-29, rot=-90)
# idle exhaust puffs behind the learner (two frames would alternate)
for (x,y,c) in [(108,RD1-6,CREAM),(107,RD1-7,CREAM),(108,RD1-7,CREAM),(103,RD1-9,SIDE_L),(102,RD1-8,SIDE_L),(98,RD1-10,SIDE)]: px(x,y,c)
# --- logo plate ---
shadow(12,8,206,75)
rect(9,5,203,72,INK); rect(10,6,202,71,CREAM); rect(11,7,201,7,(0xFF,0xFF,0xF4)); rect(11,70,201,70,BEIGE)
def outlined(x,y,s,n,fill,shade):
    m = Image.new('L',(W,H),0); ImageDraw.Draw(m).text((x,y),s,font=font(n),fill=255)
    dm = m.filter(ImageFilter.MaxFilter(3))
    sh = Image.new('L',(W,H),0); sh.paste(dm,(0,2))
    im.paste(Image.new('RGBA',(W,H),shade+(255,)),(0,0),sh)
    im.paste(Image.new('RGBA',(W,H),INK+(255,)),(0,0),dm)
    im.paste(Image.new('RGBA',(W,H),fill+(255,)),(0,0),m)
outlined(18, 4, 'BRAKE IT,', 18, YEL, YEL_D)
outlined(18, 26, 'ANTON', 27, YEL, YEL_D)
cx0,cy0 = 168, 14
rect(cx0,cy0,cx0+24,cy0+24,INK); rect(cx0+1,cy0+1,cx0+23,cy0+23,YEL); rect(cx0+1,cy0+1,cx0+23,cy0+2,YEL_L); rect(cx0+1,cy0+21,cx0+23,cy0+23,YEL_D)
for p in [(cx0,cy0),(cx0+24,cy0),(cx0,cy0+24),(cx0+24,cy0+24)]: px(*p, CREAM)
rect(cx0+11,cy0+5,cx0+13,cy0+14,INK); rect(cx0+11,cy0+17,cx0+13,cy0+19,INK)
tg = 'Он газует. Ты жмёшь тормоз.'
wt,t0,t1 = tw(tg,9); rect(14,59,198,59,BEIGE); text(10+(193-wt)//2, 62 - t0, tg, 9, (0xA8,0x5A,0x20))
# --- cabin panel on the right: approved frame, Anton preening ---
CX, CY = 267, 6
shadow(CX+2, CY+3, CX+128, CY+156)
rect(CX-2,CY-2,CX+126,CY+151,INK); rect(CX-1,CY-1,CX+125,CY+150,CREAM)
spr('cabin/poses/yasam.png', CX, CY)
# speech bubble from Anton: "ПОЕХАЛИ?"
bx,by = CX+6, CY+6; bt='ПОЕХАЛИ?'; bw,b0,b1 = tw(bt,9)
rect(bx,by,bx+bw+7,by+13,INK); rect(bx+1,by+1,bx+bw+6,by+12,CREAM); px(bx,by,(0xA6,0xD1,0xE4)); px(bx+bw+7,by,(0xA6,0xD1,0xE4)); px(bx,by+13,(0xA6,0xD1,0xE4)); px(bx+bw+7,by+13,(0xA6,0xD1,0xE4))
text(bx+4, by+3-b0+1, bt, 9, INK)
for i,(x,y) in enumerate([(bx+20,by+14),(bx+21,by+14),(bx+22,by+14),(bx+21,by+15),(bx+22,by+15),(bx+22,by+16)]): px(x,y,INK)
px(bx+21,by+13,CREAM); px(bx+20,by+13,CREAM)
# --- start button (the whole screen is the tap target; the button is the visible promise) ---
BX0,BY0,BX1,BY1 = 40, 182, 220, 206
shadow(BX0+2,BY0+3,BX1+2,BY1+3)
rect(BX0,BY0,BX1,BY1,INK); rect(BX0+1,BY0+1,BX1-1,BY1-1,YEL); rect(BX0+1,BY0+1,BX1-1,BY0+2,YEL_L); rect(BX0+1,BY1-3,BX1-1,BY1-1,YEL_D)
for p in [(BX0,BY0),(BX1,BY0),(BX0,BY1),(BX1,BY1)]: px(*p, GRASS)
bl = 'ПОЕХАЛИ!'; bw,b0,b1 = tw(bl,18)
tx = BX0 + 26 + (BX1-BX0-26-bw)//2; ty = BY0 + (BY1-BY0+1-(b1-b0))//2 - b0 - 1
text(tx, ty+1, bl, 18, YEL_D); text(tx, ty, bl, 18, INK)
# hand-drawn pointing finger (11x13), tapping
HAND = ["...##......",
        "..#oo#.....",
        "..#oo#.....",
        "..#oo###...",
        "..#oo#oo##.",
        "###oo#oo#o#",
        "#oo#ooooooo#"[:11],
        "#ooooooooo#",
        ".#oooooooo#",
        ".#ooooooo#.",
        "..#ooooo#..",
        "..#######.."]
hx,hy = BX0+8, BY0+6
for j,row in enumerate(HAND):
    for i,ch in enumerate(row):
        if ch=='#': px(hx+i,hy+j,INK)
        elif ch=='o': px(hx+i,hy+j,CREAM)
# tap ripple ticks above the fingertip
for (x,y) in [(hx+1,hy-3),(hx+3,hy-4),(hx+5,hy-3),(hx,hy-1),(hx+6,hy-1)]: px(x,y,INK)
# --- loading bar: fills while the pixel pack loads, then the button lights up ---
LX0,LY0,LX1,LY1 = 40, 211, 220, 221
rect(LX0,LY0,LX1,LY1,INK); rect(LX0+1,LY0+1,LX1-1,LY1-1,CREAM)
for x in range(LX0+2, LX1-1, 5): rect(x,LY0+2,min(x+3,LX1-2),LY1-2,GREEN); rect(x,LY1-3,min(x+3,LX1-2),LY1-2,GREEN_D)
lt = 'ГОТОВО · 91/91'; lw,l0,l1 = tw(lt,9)
rect(LX0+(LX1-LX0-lw)//2-3, LY0+1, LX0+(LX1-LX0+lw)//2+2, LY1-1, CREAM)
text(LX0+(LX1-LX0-lw)//2, LY0+(LY1-LY0+1-(l1-l0))//2-l0, lt, 9, INK)
# --- small chips under the cabin: garage and sound ---
def chip(x0,y0,label,icon=None):
    w,c0,c1 = tw(label,9); x1 = x0 + w + 9 + (10 if icon else 0); y1 = y0 + 14
    shadow(x0+1,y0+2,x1+1,y1+2)
    rect(x0,y0,x1,y1,INK); rect(x0+1,y0+1,x1-1,y1-1,CREAM); rect(x0+1,y1-2,x1-1,y1-1,BEIGE)
    for p in [(x0,y0),(x1,y0),(x0,y1),(x1,y1)]: px(*p, im.getpixel((p[0],p[1]-20 if p[1]>20 else p[1]))[:3] if False else GRASS)
    ix = x0+4
    if icon == 'speaker':
        for (x,y) in [(0,3),(0,4),(0,5),(1,3),(1,4),(1,5),(2,2),(2,3),(2,4),(2,5),(2,6),(3,1),(3,7),(3,2),(3,3),(3,4),(3,5),(3,6),(5,2),(6,3),(6,4),(6,5),(5,6)]: px(ix+x,y0+3+y,INK)
        ix += 10
    text(ix, y0+(15-(c1-c0))//2-c0-1, label, 9, INK); return x1
x = chip(270, 186, 'ГАРАЖ'); chip(x+6, 186, 'ЗВУК', 'speaker')
text(268, 200, 'v0.6 · пиксельная', 9, (0x2E,0x7A,0x52)) if False else None
im = im.convert('RGB')
im.save('/workspace/bia-pixel/start/start-mockup-native-400x225.png')
big = im.resize((1600,900), Image.NEAREST); big.save('/workspace/bia-pixel/start/start-mockup-1600x900.png')
# phone preview: iPhone 11 landscape 896x414 CSS @2x; the game letterboxes to 736x414
PW,PH = 1792, 828; gw,gh = 1472, 828
ph = Image.new('RGB',(PW+80,PH+80),(18,18,22)); scr = Image.new('RGB',(PW,PH),(0x1C,0x18,0x1C))
scr.paste(big.resize((gw,gh), Image.BOX), ((PW-gw)//2,0)); ph.paste(scr,(40,40))
ImageDraw.Draw(ph).rounded_rectangle([2,2,PW+77,PH+77], radius=90, outline=(70,70,78), width=4)
ph.save('/workspace/bia-pixel/start/start-mockup-phone-iphone11.png')
