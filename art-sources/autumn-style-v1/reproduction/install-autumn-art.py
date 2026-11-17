import hashlib,json,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
repo=Path('/home/james/projects/colony2d')
source=ROOT/'outputs/runtime-sprites'
dest=repo/'client/public/sprites'
archive=repo/'art-sources/autumn-style-v1'
archive.mkdir(parents=True,exist_ok=True)
mapping=json.loads((ROOT/'outputs/autumn-runtime-map.json').read_text())
backup=archive/'pre-autumn-runtime.zip'
if not backup.exists():
 with zipfile.ZipFile(backup,'w',zipfile.ZIP_DEFLATED) as z:
  for name in mapping:
   old=dest/name
   if old.exists():z.write(old,name)
report=[]
for f in source.rglob('*.png'):
 rel=f.relative_to(source)
 assert '..' not in rel.parts
 data=f.read_bytes()
 assert data[:8]==b'\x89PNG\r\n\x1a\n',str(f)
 target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True)
 shutil.copy2(f,target)
 assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(data).digest()
 report.append({'file':str(rel),'sha256':hashlib.sha256(data).hexdigest()})
for name in ['autumn-runtime-map.json','autumn-runtime-coverage.json','autumn-frame-manifest.json']:
 shutil.copy2(ROOT/'outputs'/name,archive/name)
shutil.copy2(ROOT/'outputs/autumn-frame-manifest.json',dest/'autumn/catalog.json')
(archive/'runtime-installed.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'verifiedFiles':len(report),'backup':str(backup)}))
