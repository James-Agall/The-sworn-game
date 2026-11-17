$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '..\outputs'
$all=@{}
foreach($pack in @('autumn-art-pack','building-wall-kit','remaining-and-caves')){
 foreach($a in (Get-Content (Join-Path $root ($pack+'/catalog.json')) -Raw|ConvertFrom-Json)){$all[$a.name]=@{atlas=$a;pack=$pack}}
}
foreach($kind in @('colony2d-autumn-complete','colony2d-cave-kit')){
 $dest=Join-Path $root $kind
 New-Item -ItemType Directory -Force -Path $dest,(Join-Path $dest 'atlases'),(Join-Path $dest 'frames')|Out-Null
 $catalog=@()
 foreach($name in ($all.Keys|Sort-Object)){
  if($kind -eq 'colony2d-cave-kit' -and $name -notlike 'cave-*'){continue}
  $e=$all[$name];$a=$e.atlas;$catalog+=$a
  Copy-Item -LiteralPath (Join-Path $root ($e.pack+'/'+$a.source)) -Destination (Join-Path $dest $a.source) -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $dest ('frames/'+$name))|Out-Null
  foreach($f in $a.frames){Copy-Item -LiteralPath (Join-Path $root ($e.pack+'/'+$f.file)) -Destination (Join-Path $dest $f.file) -Force}
 }
 $catalog|ConvertTo-Json -Depth 9|Set-Content (Join-Path $dest 'catalog.json')
 $template=Get-Content (Join-Path $PSScriptRoot 'art-index-template.html') -Raw
 $template.Replace('__CATALOG__',($catalog|ConvertTo-Json -Depth 9 -Compress))|Set-Content (Join-Path $dest 'index.html')
 $parts=foreach($a in $catalog){foreach($f in $a.frames){[pscustomobject]@{sheet=$a.name;row=($f.row+1);column=($f.column+1);group=$a.rowNames[$f.row];file=$f.file;edgeReview=$f.needsReview}}}
 $parts|Export-Csv (Join-Path $dest 'pieces.csv') -NoTypeInformation
 $validation=@{sheets=$catalog.Count;cells=$parts.Count;emptyCells=@($catalog.frames|Where-Object {$_.opaqueBounds[2] -lt 0}).Count;missingFiles=@($parts|Where-Object {-not(Test-Path (Join-Path $dest $_.file))}).Count;sheetsWithoutAlpha=@($catalog|Where-Object {($_.frames.transparentPixels|Measure-Object -Sum).Sum -eq 0}).Count;edgeReviewFlags=@($parts|Where-Object edgeReview).Count}
 $validation|ConvertTo-Json|Set-Content (Join-Path $dest 'validation.json')
 Copy-Item (Join-Path $root 'grid-projection-contract.txt'),(Join-Path $root 'finish-generation-prompts.json'),(Join-Path $root 'autumn-runtime-coverage.json') $dest -Force
 if($kind -eq 'colony2d-cave-kit'){
  Copy-Item (Join-Path $root 'cave-scene-preview.png') $dest -Force
  @'
COLONY2D CAVE KIT
3 source atlases / 192 cells: cave-surfaces, cave-walls, cave-props.
X/Y orthogonal grid; transparent external backgrounds. Floors remain opaque inside their tiles.
Walls: basalt, limestone, mossy basalt, broken basalt. Each family has 16 connection masks,
ordered N=1 E=2 S=4 W=8 (two rows of eight). Includes isolated pieces, ends, straights,
corners, T junctions and crossings. Rock caps with upright south faces.
Surfaces: dry/wet rock, limestone, gravel, packed earth, moss, mud, water, chasm and transitions.
Props: four-facing entrances and blocked variants, timber supports, stairs, ladder, ramp,
stalagmites/stalactites, coal/iron/crystal/gold deposits and depleted states, fungi, bones,
webs, rails/cart, ripple/drip effects, torch, lantern and campfire states.
The scene preview is an illustration. The game asset library also assembles a cave from actual exports.
Cave art is installed under sprites/autumn/frames but no cave biome/mining gameplay was added.
Open index.html to inspect and download cells. Generated source cells may need bespoke seam polish.
'@|Set-Content (Join-Path $dest 'README.txt')
 }else{
  Copy-Item (Join-Path $root 'autumn-runtime-map.json'),(Join-Path $root 'autumn-frame-manifest.json'),(Join-Path $root 'generation-prompts.json'),(Join-Path $root 'wall-kit-prompts.json') $dest -Force
  @'
COLONY2D AUTUMN ART LIBRARY
61 selected source sheets / 3218 source cells, covering characters, military, monsters,
wildlife, livestock, tasks, buildings/damage, interior/exterior wall kits, terrain, caves,
crops, furniture, UI and effects. Built-in image_gen was used; prompt files are included.
Open index.html for sheets and animated row previews. Individual unscaled cells are in frames/.
The Ubuntu project now has runtime conversions for all 1310 existing PNG paths plus 12 names.
Mappings are explicit in autumn-runtime-map.json. Multiple runtime states can intentionally reuse
a source cell, including recovery poses and cosmetic variants. This is not 1310 distinct drawings.
Runtime conversions use nearest-neighbour scaling, shared row canvas/foot baselines for actors,
64px flat tiles, and 68px wall grid registration. Original runtime art is backed up in the project.
Additional directional animals, hero tools/classes, village life, interior poses/walls/stairs,
road masks, building damage and occupied/empty animal houses are connected to existing state.
All new cells are installed in the game's art library. Extra variants without gameplay states
(including caves and dogs/cats) are available as art rather than new simulation features.
Source flags in validation.json indicate edge/boundary review, including intentional tile joins.
These are editable source exports; the runtime conversions are in the game, not in frames/ here.
No live deployment, save changes or push was performed.
'@|Set-Content (Join-Path $dest 'README.txt')
 }
 Compress-Archive -Path $dest -DestinationPath (Join-Path $root ($kind+'.zip')) -Force
 $validation|ConvertTo-Json
}
