"""Compile Android's pure-Java transport and run it against the real Python plugin."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--companion',type=Path,default=ROOT.parent/'FFR_Edit_Companion')
args=parser.parse_args()

async def main():
    with tempfile.TemporaryDirectory(prefix='ffr-java-test-') as temp:
        temp=Path(temp)
        json_jar=temp/'json.jar'
        json_jar.write_bytes(urllib.request.urlopen('https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar',timeout=45).read())
        source=args.companion/'app/src/main/java/io/github/timekillr/ffredit/companion'
        files=[str(source/'Endpoint.java'),str(source/'Transport.java'),str(ROOT/'tests/BackendRoundTrip.java')]
        if shutil.which('javac'):
            compile_cmd=['javac','--release','17','-cp',str(json_jar),'-d',str(temp),*files]
        else:
            compiler=os.environ.get('FFR_ECJ_JAR')
            if not compiler:raise RuntimeError('JDK 17 (javac) is required')
            compile_cmd=['java','-jar',compiler,'-17','-proc:none','-cp',str(json_jar),'-d',str(temp),*files]
        subprocess.run(compile_cmd,check=True)
        backend=await asyncio.create_subprocess_exec(sys.executable,str(ROOT/'tests/backend_harness.py'),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE)
        seq=0
        async def rpc(route,*args):
            nonlocal seq
            seq+=1
            backend.stdin.write((json.dumps({'id':seq,'route':route,'args':args})+'\n').encode());await backend.stdin.drain()
            result=json.loads(await backend.stdout.readline())
            if not result['ok']:raise RuntimeError(result['error'])
            return result['data']
        try:
            ready=json.loads(await backend.stdout.readline())
            status=await rpc('companion_enable',True)
            code=(await rpc('companion_pairing'))['pairing_code']
            java=await asyncio.create_subprocess_exec('java','-cp',str(temp)+os.pathsep+str(json_jar),'io.github.timekillr.ffredit.companion.BackendRoundTrip',f"127.0.0.1:{status['port']}",status['fingerprint'],code)
            if await java.wait():raise RuntimeError('Android transport round trip failed')
            from hashlib import sha256
            for path in Path(ready['save_directory']).glob('*.sav'):
                assert sha256(path.read_bytes()).hexdigest()==ready['original_sha256'],'Android restore must restore original bytes'
            print('PASS Android round trip restored original encrypted save bytes')
        finally:
            backend.stdin.close()
            await backend.wait()

asyncio.run(main())
