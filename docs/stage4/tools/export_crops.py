# Crops the layers from export_layers.py into assets/pixel/start/*.png and proves the rebuild is pixel-exact.
from PIL import Image, ImageChops
import json
L=lambda n: Image.open(f'layers/{n}.png').convert('RGBA')
out={}
def save(name, img, box, layer):
    c=img.crop(box); c.save(f'out/start/{name}.png')
    out[name]={'file':f'start/{name}.png','x':box[0],'y':box[1],'w':c.width,'h':c.height,'from_layer':layer}
g=L('ground'); g.alpha_composite(L('zebra')); g.save('out/start/street-ground.png')
out['street-ground']={'file':'start/street-ground.png','x':0,'y':0,'w':400,'h':225,'from_layer':'ground+zebra'}
bb=json.load(open('layers/bboxes.json'))
for n,f in [('exhaust','exhaust-0'),('logo-plate','logo-plate'),('logo-title','logo-title'),('logo-badge','logo-badge'),('logo-tagline','logo-tagline'),('cabin-frame','cabin-frame'),('bubble-poekhali','bubble-poekhali'),('btn-start-base','btn-start-base'),('btn-start-label','btn-start-label'),('icon-hand-tap','icon-hand-tap'),('loadbar-frame','loadbar-frame')]:
    save(f, L(n), tuple(bb[n]), n)
save('loadbar-segment', L('loadbar-segments'), (42,213,46,220), 'loadbar-segments')
ch=L('chips'); save('chip-garage', ch, (270,186,318,203),'chips'); save('chip-sound', ch, (322,186,371,203),'chips')
ink=(0x2A,0x24,0x30,255); ic=Image.new('RGBA',(7,9),(0,0,0,0))
for x in range(7):
    for y in range(9):
        if ch.getpixel((326+x,189+y))==ink: ic.putpixel((x,y),ink)
ic.save('out/start/icon-speaker.png'); out['icon-speaker']={'file':'start/icon-speaker.png','x':326,'y':189,'w':7,'h':9,'from_layer':'chips (ink pixels only)'}
save('loadbar-label-ref', L('loadbar-label'), tuple(bb['loadbar-label']), 'loadbar-label')
Image.open('/workspace/bia-repo/assets/pixel/car/learner-normal.png').convert('RGBA').rotate(-90, expand=True).save('out/car/learner-normal-right.png')
ref=Image.open('/workspace/bia-pixel/start/start-mockup-native-400x225.png').convert('RGB')
comp=g.copy()
for n in ['world-top','world-bottom','cars']: comp.alpha_composite(L(n))
P=lambda n: comp.alpha_composite(Image.open(f'out/start/{n}.png'),(out[n]['x'],out[n]['y']))
for n in ['exhaust-0','logo-plate','logo-title','logo-badge','logo-tagline','cabin-frame']: P(n)
comp.alpha_composite(L('cabin-pose'))
for n in ['bubble-poekhali','btn-start-base','btn-start-label','icon-hand-tap','loadbar-frame']: P(n)
s=Image.open('out/start/loadbar-segment.png')
for x in range(42,219,5): comp.alpha_composite(s.crop((0,0,min(4,219-x),7)),(x,213))
for n in ['loadbar-label-ref','chip-garage','chip-sound']: P(n)
print('rebuild diff', ImageChops.difference(comp.convert('RGB'),ref).getbbox())
json.dump(out, open('out/start/start-layout.json','w'), indent=1, ensure_ascii=False)
