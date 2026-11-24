from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,statistics
root=Path(__file__).resolve().parents[2];out=root/'outputs/special-cast';cast=json.loads((out/'cast.json').read_text());manifest=[]
for gi,g in enumerate(dict.fromkeys(c['group'] for c in cast)):
 src=out/(g+'-source.png')
 if not src.exists():continue
 im=Image.open(src).convert('RGBA');w,h=im.size
 # Threshold only near-transparent encoding noise; retain the generated artwork and alpha.
 a=im.getchannel('A').point(lambda x:0 if x<40 else 255 if x>235 else x);im.putalpha(a)
 # Locate the quietest gutters near the requested 10x10 lattice. This accommodates
 # small generation offsets without moving pixels between characters or frames.
 rows=[sum(a.crop((0,y,w,y+1)).getdata())/255 for y in range(h)]
 cols=[sum(a.crop((x,0,x+1,h)).getdata())/255 for x in range(w)]
 def cuts(profile,size):
  out=[0]
  for n in range(1,10):
   target=n*size/10;lo=int(target-size*.021);hi=int(target+size*.021)
   choices=range(max(out[-1]+1,lo),min(size,hi)+1)
   out.append(min(choices,key=lambda i:(sum(profile[max(0,i-1):i+2]),abs(i-target))))
  return out+[size]
 gutters=[];start=None
 for i,v in enumerate(rows+[9999]):
  if v<15 and start is None:start=i
  if v>=15 and start is not None:
   if i-start>=2 and start>h*.04 and i<h*.97:gutters.append((start+i-1)//2)
   start=None
 assert len(gutters)==9,(g,'expected nine row gutters',gutters)
 ys=[0]+gutters+[h];xs=cuts(cols,w);atlas=Image.new('RGBA',(960,960));stats=[]
 for row in range(10):
  cells=[im.crop((xs[col],ys[row],xs[col+1],ys[row+1])) for col in range(10)]
  boxes=[c.getbbox() for c in cells];assert all(boxes),(g,row,'empty cell')
  # One scale per identity, preserving action reach and walk phase proportions.
  def foot_anchor(cell,b):
   if gi==9:return (b[0]+b[2])/2
   aa=cell.getchannel('A');points=[]
   for yy in range(round(b[1]+(b[3]-b[1])*.77),b[3]):
    for xx in range(b[0],b[2]):
     if aa.getpixel((xx,yy))>80:points.append(xx)
   return statistics.mean(points) if points else (b[0]+b[2])/2
  anchors=[foot_anchor(c,b) for c,b in zip(cells,boxes)]
  def body_h(cell,b,ax):
   if gi==9:return b[3]-b[1]
   aa=cell.getchannel('A');span=max(7,round((b[2]-b[0])*.19));left=max(0,round(ax-span));right=min(cell.width,round(ax+span))
   for yy in range(b[1],b[3]):
    if sum(aa.getpixel((xx,yy))>80 for xx in range(left,right))>=max(3,span*.3):return b[3]-yy
   return b[3]-b[1]
  idle_h=statistics.median([body_h(cells[i],boxes[i],anchors[i]) for i in (0,1)])
  scale=48/idle_h
  maxw=max((b[2]-b[0])*scale for b in boxes);maxh=max((b[3]-b[1])*scale for b in boxes)
  if maxw>88 or maxh>78:scale*=min(88/maxw,78/maxh)
  for col,(cell,b) in enumerate(zip(cells,boxes)):
   piece=cell.crop(b);piece=piece.resize((max(1,round(piece.width*scale)),max(1,round(piece.height*scale))),Image.Resampling.NEAREST)
   # Align feet and body centres, retain an identical frame canvas for all states.
   left=round(48-(anchors[col]-b[0])*scale)
   assert left>=0 and left+piece.width<=96,(g,row,col,'frame clipped',left,piece.width)
   atlas.alpha_composite(piece,(col*96+left,row*96+84-piece.height))
  stats.append({'id':cast[gi*10+row]['id'],'row':row,'idleHeight':round(idle_h*scale),'scale':scale,'sourceCuts':ys[row:row+2]})
 # The watch grip pass targets only its three sword/shield users. Keep the
 # original halter, keys, horn and other equipment rows byte-for-byte intact.
 targets={'wayfarers':[0,1,8],'watch':[0,1,3,6],'outlaws':[4]}
 if g in targets and (out/(g+'-unmodified.png')).exists():
  original=Image.open(out/(g+'-unmodified.png')).convert('RGBA')
  for row in range(10):
   if row not in targets[g]:atlas.paste(original.crop((0,row*96,960,(row+1)*96)),(0,row*96))
 # Discard isolated tips that overflowed into a neighbouring cell. Never remove
 # a held object on the body side, or a hurt splash in the final column.
 for row in range(10):
  for col in range(9):
   cell=atlas.crop((col*96,row*96,(col+1)*96,(row+1)*96));aa=cell.getchannel('A');pts={(x,y) for y in range(96) for x in range(96) if aa.getpixel((x,y))>80};parts=[]
   while pts:
    todo=[pts.pop()]
    for x,y in todo:
     for dx,dy in [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)]:
      q=(x+dx,y+dy)
      if q in pts:pts.remove(q);todo.append(q)
    parts.append(todo)
   parts.sort(key=len,reverse=True)
   if not parts:continue
   left=min(x for x,y in parts[0])
   for part in parts[1:]:
    overflow=len(part)<len(parts[0])*.1 and max(x for x,y in part)<left-2 and min(x for x,y in part)<25
    reviewed_tip=g=='rural' and (row,col) in [(0,8),(1,8),(5,7),(5,8)] and 14<len(part)<50
    if overflow or reviewed_tip:
     for x,y in part:cell.putpixel((x,y),(0,0,0,0))
   atlas.paste(cell,(col*96,row*96))
 atlas.save(out/(g+'.png'),optimize=True)
 manifest.append({'sheet':g,'source':src.name,'sourceSize':[w,h],'size':[960,960],'cell':[96,96],'baseline':84,'rows':stats,'frames':{'idle':[0,1],'walk':[2,3,4,5],'action':[6,7,8],'hurt':[9]}})
 print(g,im.size,'alpha',im.getchannel('A').getextrema(),'gutters',ys,'written')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
# Readable contact sheet at a common game-relative scale, not a concept painting.
thumb=Image.new('RGB',(1440,1260),(31,30,26));d=ImageDraw.Draw(thumb)
try:font=ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',14)
except:font=ImageFont.load_default()
for i,c in enumerate(cast):
 p=out/(c['group']+'.png')
 if not p.exists():continue
 atlas=Image.open(p);pose=atlas.crop((0,c['row']*96,96,(c['row']+1)*96));pose=pose.resize((96,96),Image.Resampling.NEAREST)
 x=i%10*144;y=i//10*126;thumb.paste(pose,(x+24,y),pose)
 name=c['name'];d.text((x+4,y+96),name,font=font,fill='#efe0b6')
 d.text((x+4,y+114),c['title'][:22],font=font,fill='#b8ad94')
thumb.save(out/'cast-overview.png')
