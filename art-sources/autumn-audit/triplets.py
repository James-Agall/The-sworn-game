# pages of orig | codex | new thumbnails per runtime path. usage: triplets.py orig cur new names.txt outprefix [T] [cols]
import os,sys
from PIL import Image,ImageDraw
orig,cur,new,names,outp=sys.argv[1:6]; T=int(sys.argv[6]) if len(sys.argv)>6 else 56; C=int(sys.argv[7]) if len(sys.argv)>7 else 8
names=[l.strip() for l in open(names) if l.strip()]
def th(p):
  bg=Image.new('RGBA',(T,T),(78,92,70,255))
  if not os.path.exists(p): ImageDraw.Draw(bg).line((0,0,T,T),fill=(255,0,0,255)); return bg
  im=Image.open(p).convert('RGBA'); s=min(T/im.width,T/im.height); im=im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.NEAREST)
  bg.alpha_composite(im,((T-im.width)//2,T-im.height)); return bg
per=C*12; CW=3*T+10; RH=T+12
for pi in range(0,len(names),per):
  chunk=names[pi:pi+per]; rows=(len(chunk)+C-1)//C
  sh=Image.new('RGBA',(C*CW,rows*RH),(30,30,36,255)); d=ImageDraw.Draw(sh)
  for i,n in enumerate(chunk):
    x=(i%C)*CW; y=(i//C)*RH
    for j,root in enumerate((orig,cur,new)): sh.alpha_composite(th(os.path.join(root,n)),(x+j*(T+1),y))
    d.text((x+1,y+T),n.replace('.png','')[-26:],fill=(255,255,140,255))
  sh.convert('RGB').save(f'{outp}-{pi//per:02d}.png')
print((len(names)+per-1)//per)
