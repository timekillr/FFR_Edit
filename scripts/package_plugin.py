import hashlib
from pathlib import Path
import zipfile
ROOT=Path(__file__).resolve().parents[1]
required=['dist/index.js','bin/node','bin/NODE_LICENSE','main.py','save_store.py','companion_server.py','web/index.html']
for name in required:
    if not (ROOT/name).is_file():raise SystemExit('Missing build input: '+name)
out=ROOT/'artifacts';out.mkdir(exist_ok=True)
archive=out/'FFR_Edit.zip'
skip={'.git','node_modules','artifacts','__pycache__','integration'}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(ROOT.rglob('*')):
        rel=p.relative_to(ROOT)
        if (not p.name.startswith('.') or p.name == '.gitignore') and p.is_file() and not p.is_symlink() and not skip.intersection(rel.parts) and p.suffix not in ('.pyc','.sav'):
            z.write(p,'ffr-edit/'+rel.as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert z.getinfo('ffr-edit/bin/node').external_attr>>16&0o111
(out/'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  FFR_Edit.zip\n')
print(archive)
