param([switch]$OnlyWalls,[string[]]$OnlyNames=@())
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class SpriteExport {
 public static Rectangle Bounds(Bitmap b){
  int l=b.Width,t=b.Height,r=-1,d=-1;
  for(int y=0;y<b.Height;y++)for(int x=0;x<b.Width;x++)if(b.GetPixel(x,y).A>64){l=Math.Min(l,x);t=Math.Min(t,y);r=Math.Max(r,x);d=Math.Max(d,y);}
  if(r<l)throw new Exception("Empty sprite");return Rectangle.FromLTRB(l,t,r+1,d+1);
 }
 public static void Save(string source,string dest,string mode,double actorScale,int actorWidth,int mask){
  using(var b=new Bitmap(source)){
   var q=Bounds(b);int w=128,h=128;Rectangle target;
   if(mode=="actor"){
    w=actorWidth;h=128;int dw=Math.Max(1,(int)Math.Round(q.Width*actorScale)),dh=Math.Max(1,(int)Math.Round(q.Height*actorScale));
    int x=(int)Math.Round((w-b.Width*actorScale)/2+q.X*actorScale);x=Math.Max(0,Math.Min(w-dw,x));target=new Rectangle(x,126-dh,dw,dh);
   }else if(mode=="wall"){
    w=68;h=88;int left=(mask&8)!=0?0:17,right=(mask&2)!=0?68:51,top=(mask&1)!=0?0:17,bottom=(mask&4)!=0?68:51;target=new Rectangle(left,top,right-left,bottom-top+20);
   }else if(mode=="tile"){
    w=64;h=64;target=new Rectangle(0,0,w,h);
   }else{
    w=mode=="icon"?64:128;h=w;double scale=Math.Min((w-4.0)/q.Width,(h-4.0)/q.Height);int dw=Math.Max(1,(int)Math.Round(q.Width*scale)),dh=Math.Max(1,(int)Math.Round(q.Height*scale));target=new Rectangle((w-dw)/2,mode=="effect"?(h-dh)/2:h-dh,dw,dh);
    if(mode=="furniture"){w=64;h=96;scale=Math.Min(64.0/q.Width,96.0/q.Height);dw=Math.Max(1,(int)Math.Round(q.Width*scale));dh=Math.Max(1,(int)Math.Round(q.Height*scale));target=new Rectangle((w-dw)/2,h-dh,dw,dh);}
   }
   using(var result=new Bitmap(w,h,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(result)){
    g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.NearestNeighbor;g.PixelOffsetMode=PixelOffsetMode.Half;
    g.DrawImage(b,target,q,GraphicsUnit.Pixel);result.Save(dest,ImageFormat.Png);
   }
  }
 }
}
'@ -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Collections,System.Private.Windows.GdiPlus,System.Private.Windows.Core
$root=Join-Path $PSScriptRoot '..\outputs'
$dest=Join-Path $root 'runtime-sprites'
New-Item -ItemType Directory -Force -Path $dest|Out-Null
$map=Get-Content (Join-Path $root 'autumn-runtime-map.json') -Raw|ConvertFrom-Json -AsHashtable
$catalog=@{}
foreach($pack in @('autumn-art-pack','building-wall-kit','remaining-and-caves')){
 foreach($a in (Get-Content (Join-Path $root ($pack+'/catalog.json')) -Raw|ConvertFrom-Json)){$catalog[$a.name]=@{atlas=$a;pack=$pack}}
}
$actorSheets=@('workers-a-transparent','workers-b','workers-c','village-life','specialists-npcs','infantry-v2','heavy-soldiers-v4','mounted-units-v2','heroes','bandits','spear-pike-tiers','small-monsters','large-monsters','wildlife-v2','livestock','young-animals-transport','wagons-riders','human-tasks','human-tasks-directions-a','human-tasks-directions-b','human-life-directions','hero-tool-actions','animal-walks-a','animal-walks-b','animal-walks-c','animal-idle-eat-sleep','combat-animation-completion')
$groups=@{}
foreach($s in $actorSheets){$a=$catalog[$s].atlas;for($r=0;$r -lt $a.rows;$r++){
 $fs=@($a.frames|Where-Object row -eq $r);$maxH=0;$maxW=0
 foreach($f in $fs){$maxH=[math]::Max($maxH,$f.opaqueBounds[3]-$f.opaqueBounds[1]+1);$maxW=[math]::Max($maxW,$f.rect[2])}
 $sc=116.0/$maxH;$groups["$s/$r"]=@($sc,[int][math]::Ceiling($maxW*$sc+8))
}}
$frameManifest=@()
foreach($s in ($catalog.Keys|Sort-Object)){
 if($OnlyNames.Count){continue}
 $entry=$catalog[$s];$a=$entry.atlas
 foreach($f in $a.frames){
  $mode=if($s -in $actorSheets){'actor'}elseif($s -match '^(square-terrain|terrain-connections|cave-surfaces|bridges-water-roofs|floors-roofs-terrain|crops)$'){'tile'}elseif($s -match '^(walls-doors|interior-walls|exterior-walls-damaged|interior-walls-damaged|cave-walls)$'){'wall'}elseif($s -match '(effects|hit-effects)$'){'effect'}elseif($s -match '^(ui-|resources-|equipment-)'){'icon'}else{'prop'}
  $p='autumn/frames/'+$s+'/'+$a.rowNames[$f.row]+'-'+('{0:d2}' -f ($f.column+1))+'.png'
  if($OnlyWalls -and $mode -ne 'wall'){continue}
  $file=Join-Path $dest $p;New-Item -ItemType Directory -Force -Path (Split-Path $file)|Out-Null
  $group=$groups["$s/$($f.row)"];if(-not $group){$group=@(1.0,128)}
  [SpriteExport]::Save((Join-Path $root ($entry.pack+'/'+$f.file)),$file,$mode,$group[0],$group[1],(($f.row%2)*8+$f.column))
  $frameManifest+=[pscustomobject]@{sheet=$s;row=$f.row;column=$f.column;url=('/sprites/'+$p);mode=$mode}
 }
}
foreach($name in $map.Keys){
 if($OnlyNames.Count -and $name -notin $OnlyNames){continue}
 $m=$map[$name];$target=Join-Path $dest $name;New-Item -ItemType Directory -Force -Path (Split-Path $target)|Out-Null
 if($OnlyWalls -and $m.mode -ne 'wall'){continue}
 $g=$groups["$($m.sheet)/$($m.row)"];if(-not $g){$g=@(1.0,128)}
 $mask=if($m.sheet -match '(wall-kit-doors|wall-kit-windows)'){if($m.column -ge 4){5}else{10}}else{($m.row%2)*8+$m.column}
 [SpriteExport]::Save((Join-Path $root $m.source),$target,$m.mode,$g[0],$g[1],$mask)
}
if(-not $OnlyWalls -and -not $OnlyNames.Count){$frameManifest|ConvertTo-Json -Depth 5|Set-Content (Join-Path $root 'autumn-frame-manifest.json')}
@{runtimeReplacements=$map.Count;libraryFrames=$frameManifest.Count}|ConvertTo-Json
