# side-by-side old|new thumbnails for every cell of a sheet. usage: cmpsheet.py old_root new_root sheet out [thumb]
import json,os,sys
from PIL import Image,ImageDraw
old,new,sheet,out=sys.argv[1:5]; T=int(sys.argv[5]) if len(sys.argv)>5 else 72
cat={a['name']:a for a in json.load(open(new+'/catalog.json',encoding='utf-8-sig'))}[sheet]
cols=cat['cols']; rows=cat['rows']
W=cols*(2*T+6); Hh=rows*(T+14)
sh=Image.new('RGB',(W,Hh),(40,40,48)); d=ImageDraw.Draw(sh)
def th(p):
  im=Image.open(p).convert('RGBA'); s=min(T/im.width,T/im.height); im=im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.NEAREST)
  bg=Image.new('RGBA',(T,T),(70,70,85,255)); bg.alpha_composite(im,((T-im.width)//2,T-im.height)); return bg.convert('RGB')
for f in cat['frames']:
  r,c=f['row'],f['column']; x=c*(2*T+6); y=r*(T+14)
  sh.paste(th(os.path.join(old,f['file'])),(x,y)); sh.paste(th(os.path.join(new,f['file'])),(x+T+2,y))
  d.text((x+2,y+T+1),f"{r},{c} {f.get('method','')[:4]}",fill=(220,220,120))
sh.save(out)
