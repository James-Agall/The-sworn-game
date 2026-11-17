import hashlib,json,shutil,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
repo=Path('/home/james/projects/colony2d')
art=repo/'art-sources/autumn-style-v1'
source=root/'outputs/colony2d-runtime-sprites.zip'
target=art/source.name
shutil.copy2(source,target)
dest=repo/'client/public/sprites'
report=[]
with zipfile.ZipFile(target) as z:
 for entry in z.infolist():
  p=Path(entry.filename)
  assert not p.is_absolute() and '..' not in p.parts
  if entry.is_dir():continue
  data=z.read(entry);out=dest/p;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
  assert out.read_bytes()==data
  report.append({'file':str(p),'sha256':hashlib.sha256(data).hexdigest()})
(art/'runtime-installed.json').write_text(json.dumps(report,indent=2))
for name in ['autumn-runtime-map.json','autumn-runtime-coverage.json','autumn-frame-manifest.json']:
 shutil.copy2(root/'outputs'/name,art/name)
print(json.dumps({'verifiedFiles':len(report),'archiveSha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
