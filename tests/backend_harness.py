"""Test-only RPC host for the production Decky backend; all files are temporary."""
import asyncio
import hashlib
import json
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
import types
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

async def run():
    with tempfile.TemporaryDirectory(prefix='ffr-integration-') as tmp:
        directory=Path(tmp)
        sys.modules['decky']=types.SimpleNamespace(DECKY_PLUGIN_SETTINGS_DIR=str(directory/'settings'),logger=logging.getLogger('decky-test'))
        from main import Plugin
        from save_store import SaveStore
        raw=subprocess.check_output(['node',str(ROOT/'tests/fixture.cjs')])
        home=directory/'home'
        saves=home/'.local/share/Steam/steamapps/compatdata/3259780/pfx/drive_c/users/steamuser/AppData/Local/FFRS/Steam/test'
        saves.mkdir(parents=True)
        for slot in (0,1):(saves/f'GameSaveData{slot}.sav').write_bytes(raw)
        plugin=Plugin()
        with patch('pwd.getpwall', return_value=[]):
            await plugin._main()
        plugin.store=SaveStore(directory/'settings/saves',homes=[home],running=lambda:False)
        plugin.companion.host='127.0.0.1';plugin.companion.port=0
        print(json.dumps({'ready':True,'directory':str(directory),'save_directory':str(saves),'original_sha256':hashlib.sha256(raw).hexdigest()}),flush=True)
        try:
            while line:=await asyncio.to_thread(sys.stdin.readline):
                request=json.loads(line)
                try:
                    if request['route']=='_shutdown':break
                    result=await getattr(plugin,request['route'])(*request.get('args',[]))
                    print(json.dumps({'id':request['id'],'ok':True,'data':result},allow_nan=False),flush=True)
                except Exception as error:
                    print(json.dumps({'id':request['id'],'ok':False,'error':str(error)}),flush=True)
        finally:await plugin._unload()

asyncio.run(run())
