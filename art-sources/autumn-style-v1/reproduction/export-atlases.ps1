param([string[]]$Only=@(), [string]$PackName='autumn-art-pack', [string]$SpecsFile='atlas-specs.json')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
public static class AtlasAudit {
 public static int[] Cuts(Bitmap b,int count,bool horizontal) {
  int size=horizontal?b.Width:b.Height, other=horizontal?b.Height:b.Width;
  var cuts=new System.Collections.Generic.List<int>(); cuts.Add(0); int start=-1;
  for(int p=0;p<size;p++){
   bool hit=false;
   for(int q=0;q<other;q+=2){if((horizontal?b.GetPixel(p,q):b.GetPixel(q,p)).A>180){hit=true;break;}}
   if(!hit && start<0)start=p;
   if(hit && start>=0){if(start>0 && p-start>=2)cuts.Add((start+p)/2);start=-1;}
  }
  cuts.Add(size);
  if(cuts.Count==count+1)return cuts.ToArray();
  var uniform=new int[count+1];
  for(int i=0;i<=count;i++){
   int target=(int)Math.Round((double)i*size/count);uniform[i]=target;
   if(i==0||i==count)continue;
   int distance=size;foreach(int candidate in cuts){int d=Math.Abs(candidate-target);if(candidate>0&&candidate<size&&d<distance&&d<size/count*0.4){uniform[i]=candidate;distance=d;}}
  }
  return uniform;
 }
 public static int[] Bounds(Bitmap b) {
  int minX=b.Width,minY=b.Height,maxX=-1,maxY=-1,clear=0,edge=0;
  for(int y=0;y<b.Height;y++) for(int x=0;x<b.Width;x++){
   var a=b.GetPixel(x,y).A;
   if(a==0)clear++;
   if(a>32){minX=Math.Min(minX,x);minY=Math.Min(minY,y);maxX=Math.Max(maxX,x);maxY=Math.Max(maxY,y);
    if(x==0||y==0||x==b.Width-1||y==b.Height-1)edge++;
   }
  }
  return new int[]{minX,minY,maxX,maxY,clear,edge};
 }
}
'@ -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Collections
$bundled=Test-Path (Join-Path $PSScriptRoot 'atlases')
$root=if($bundled){Join-Path $PSScriptRoot 'atlases'}else{Join-Path $PSScriptRoot '..\outputs'}
$pack=if($bundled){$PSScriptRoot}else{Join-Path $root $PackName}
New-Item -ItemType Directory -Force -Path $pack,(Join-Path $pack 'atlases'),(Join-Path $pack 'frames') | Out-Null
$specs=Get-Content (Join-Path $PSScriptRoot $SpecsFile) -Raw | ConvertFrom-Json
$catalog=@()
if($Only.Count -gt 0){
 $catalog=@(Get-Content (Join-Path $pack 'catalog.json') -Raw | ConvertFrom-Json | Where-Object { $_.name -notin $Only })
 $specs=@($specs | Where-Object { $_.name -in $Only })
}
foreach($spec in $specs){
 $source=Join-Path $root ($spec.name+'.png')
 if(-not $bundled){Copy-Item -LiteralPath $source -Destination (Join-Path $pack ('atlases\'+$spec.name+'.png')) -Force}
 $im=[System.Drawing.Bitmap]::new($source)
 $xCuts=if($spec.detectGutters){[AtlasAudit]::Cuts($im,$spec.cols,$true)}else{@(0..$spec.cols|ForEach-Object {[int][math]::Round($_*$im.Width/$spec.cols)})}
 $yCuts=if($spec.detectGutters){[AtlasAudit]::Cuts($im,$spec.rows,$false)}else{@(0..$spec.rows|ForEach-Object {[int][math]::Round($_*$im.Height/$spec.rows)})}
 $dir=Join-Path $pack ('frames\'+$spec.name)
 New-Item -ItemType Directory -Force -Path $dir | Out-Null
 $frames=@()
 for($r=0;$r -lt $spec.rows;$r++){
  if($spec.detectGutters){
   $strip=$im.Clone([System.Drawing.Rectangle]::new(0,$yCuts[$r],$im.Width,$yCuts[$r+1]-$yCuts[$r]),[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
   $xCuts=[AtlasAudit]::Cuts($strip,$spec.cols,$true)
   $strip.Dispose()
  }
  for($c=0;$c -lt $spec.cols;$c++){
   $x=$xCuts[$c];$y=$yCuts[$r]
   $right=$xCuts[$c+1];$bottom=$yCuts[$r+1]
   $rect=[System.Drawing.Rectangle]::new($x,$y,$right-$x,$bottom-$y)
   $frame=$im.Clone($rect,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
   $bounds=[AtlasAudit]::Bounds($frame)
   $name=('{0}-{1:d2}.png' -f $spec.rowNames[$r],($c+1))
   $frame.Save((Join-Path $dir $name),[System.Drawing.Imaging.ImageFormat]::Png)
   $frames+=@{file="frames/$($spec.name)/$name";row=$r;column=$c;rect=@($x,$y,$rect.Width,$rect.Height);opaqueBounds=$bounds[0..3];transparentPixels=$bounds[4];edgePixels=$bounds[5];needsReview=($bounds[5] -gt 0 -or $bounds[2] -lt 0)}
   $frame.Dispose()
  }
 }
 $catalog+=@{name=$spec.name;cols=$spec.cols;rows=$spec.rows;rowNames=$spec.rowNames;width=$im.Width;height=$im.Height;source="atlases/$($spec.name).png";frames=$frames;status='extracted-candidate'}
 $im.Dispose()
}
$catalog | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $pack 'catalog.json')
if(-not $bundled){Copy-Item (Join-Path $root 'generation-prompts.json') $pack -Force}
$frameCount=($catalog.frames | Measure-Object).Count
$reviewCount=($catalog.frames | Where-Object needsReview | Measure-Object).Count
@{atlases=$catalog.Count;frames=$frameCount;boundaryOrEmptyReview=$reviewCount} | ConvertTo-Json | Set-Content (Join-Path $pack 'export-report.json')
Get-Content (Join-Path $pack 'export-report.json')

