"""Fetch the pinned official runtime, verify its digest, retain licensing."""
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request
VERSION='22.16.0'
ROOT=Path(__file__).resolve().parents[1]
name=f'node-v{VERSION}-linux-x64.tar.xz'
base=f'https://nodejs.org/dist/v{VERSION}/'
checks=urllib.request.urlopen(base+'SHASUMS256.txt',timeout=60).read().decode()
expected=next(line.split()[0] for line in checks.splitlines() if line.split()[-1]==name)
raw=urllib.request.urlopen(base+name,timeout=120).read()
if hashlib.sha256(raw).hexdigest()!=expected:raise SystemExit('Node download checksum mismatch')
root=f'node-v{VERSION}-linux-x64'
out=ROOT/'bin';out.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:xz') as archive:
    for src,dst in [('bin/node','node'),('LICENSE','NODE_LICENSE')]:
        (out/dst).write_bytes(archive.extractfile(root+'/'+src).read())
(out/'node').chmod(0o755)
(out/'NODE_SHA256SUMS').write_text(next(line for line in checks.splitlines() if line.split()[-1]==name)+'\n')
print('Verified Node',VERSION)
