import asyncio
import contextlib
import hashlib
import json
from pathlib import Path
import ssl
import tempfile
import unittest
from companion_server import CompanionServer

class FakePlugin:
    def __init__(self):self.calls=0
    async def get_state(self,*args,**kwargs):return {'saves':[],'running':False}
    async def execute(self,method,args):self.calls+=1;return {'method':method,'args':args}

class CompanionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.plugin=FakePlugin()
        self.server=CompanionServer(self.plugin,Path(self.tmp.name),host='127.0.0.1',port=0)
        await self.server.enable(True)
        self.tls=ssl.create_default_context(cafile=str(self.server.directory/'server.pem'));self.tls.check_hostname=False
        self.addAsyncCleanup(self.server.close);self.addCleanup(self.tmp.cleanup)
    async def request(self,path,method='GET',body=None,headers=None):
        r,w=await asyncio.open_connection('127.0.0.1',self.server.port,ssl=self.tls)
        self.assertEqual(hashlib.sha256(w.get_extra_info('ssl_object').getpeercert(binary_form=True)).hexdigest(),self.server.fingerprint)
        raw=json.dumps(body or {}).encode();h={'Host':f'localhost:{self.server.port}','Content-Type':'application/json','Content-Length':str(len(raw)),**(headers or {})}
        w.write((f'{method} {path} HTTP/1.1\r\n'+''.join(f'{k}: {v}\r\n' for k,v in h.items())+'\r\n').encode()+raw);await w.drain()
        head=(await r.readuntil(b'\r\n\r\n')).decode();size=int(next(l.split(':',1)[1] for l in head.split('\r\n') if l.startswith('Content-Length:')))
        payload=await r.readexactly(size);w.close()
        with contextlib.suppress(OSError):await w.wait_closed()
        return int(head.split()[1]),head,payload
    async def pair(self):
        code=self.server.begin_pairing()['pairing_code'];status,_,raw=await self.request('/v1/pair','POST',{'code':code,'device_name':'test'})
        self.assertEqual(status,200);return json.loads(raw)['data']['token']
    async def test_auth_and_revocation(self):
        status,_,_=await self.request('/v1/state');self.assertEqual(status,401)
        token=await self.pair();h={'Authorization':'Bearer '+token}
        status,_,_=await self.request('/v1/state',headers=h);self.assertEqual(status,200)
        status,_,_=await self.request('/v1/state',headers={**h,'Origin':'https://evil.invalid'});self.assertEqual(status,403)
        self.server.revoke(self.server.status()['devices'][0]['id'])
        status,_,_=await self.request('/v1/state',headers=h);self.assertEqual(status,401)
    async def test_idempotency_and_method_allowlist(self):
        token=await self.pair();h={'Authorization':'Bearer '+token}
        data={'method':'backup','args':{'sid':'test'},'request_id':'unique-request'}
        for _ in range(2):
            status,_,_=await self.request('/v1/command','POST',data,h);self.assertEqual(status,200)
        self.assertEqual(self.plugin.calls,1)
        data['method']='restore';status,_,_=await self.request('/v1/command','POST',data,h);self.assertEqual(status,409)
        data['method']='add_folder';data['request_id']='other-request';status,_,_=await self.request('/v1/command','POST',data,h);self.assertEqual(status,400)
    async def test_web_origin_cookie_and_static(self):
        h={'X-FFR-Edit-Web':'1','Origin':f'https://localhost:{self.server.port}'}
        status,_,raw=await self.request('/',headers={});self.assertEqual(status,200);self.assertIn(b'FFR EDIT',raw)
        code=self.server.begin_pairing()['pairing_code']
        status,head,raw=await self.request('/web-api/pair','POST',{'code':code,'device_name':'browser'},h)
        self.assertEqual(status,200);self.assertNotIn(b'token',raw)
        self.assertIn('Secure; HttpOnly; SameSite=Strict',head)
        cookie=next(l.split(': ',1)[1].split(';')[0] for l in head.split('\r\n') if l.startswith('Set-Cookie:'))
        status,_,_=await self.request('/web-api/state',headers={**h,'Cookie':cookie});self.assertEqual(status,200)
        status,_,_=await self.request('/web-api/state',headers={**h,'Cookie':cookie,'Origin':'https://evil.invalid'});self.assertEqual(status,403)
        status,_,_=await self.request('/web-api/state',headers={'Cookie':cookie});self.assertEqual(status,403)
    async def test_pair_code_single_use(self):
        code=self.server.begin_pairing()['pairing_code']
        for expected in (200,403):
            status,_,_=await self.request('/v1/pair','POST',{'code':code,'device_name':'test'});self.assertEqual(status,expected)

    async def test_tls_selftest_and_persistent_pairing(self):
        self.assertTrue(self.server.status()['self_test']['ok'])
        token=await self.pair()
        fingerprint=self.server.fingerprint
        port=self.server.port
        await self.server.close()
        await self.server.start()
        self.assertEqual(self.server.port,port)
        self.assertEqual(self.server.fingerprint,fingerprint)
        self.assertTrue((await self.server.check_connection())['self_test']['ok'])
        status,_,_=await self.request('/v1/state',headers={'Authorization':'Bearer '+token})
        self.assertEqual(status,200)

    async def test_listener_failure_is_reported(self):
        from unittest.mock import patch
        await self.server.close()
        with patch('asyncio.start_server',side_effect=OSError('Address already in use')):
            with self.assertRaisesRegex(ValueError,'Address already in use'):
                await self.server.enable(True)
        self.assertFalse(self.server.status()['listening'])
        self.assertIn('Address already in use',self.server.status()['error'])
