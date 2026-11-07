// Real same-origin browser transport -> production HTTPS server -> save codec -> files.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {JSDOM} from 'jsdom';
const backend=spawn('python3',['tests/backend_harness.py'],{stdio:['pipe','pipe','inherit']});
const waiting=new Map();let seq=0,start;
const ready=new Promise(r=>start=r);
createInterface({input:backend.stdout}).on('line',line=>{const r=JSON.parse(line);if(r.ready){start(r);return;}const p=waiting.get(r.id);if(p){waiting.delete(r.id);r.ok?p.resolve(r.data):p.reject(Error(r.error));}});
const rpc=(route,...args)=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});backend.stdin.write(JSON.stringify({id,route,args})+'\n');});
const env=await ready;let dom;
try{
 const service=await rpc('companion_enable',true);assert.equal(service.self_test.ok,true);
 const origin=`https://127.0.0.1:${service.port}`,cert=readFileSync(env.directory+'/settings/companion/server.pem');
 let cookie='',lastSentCookie='';
 const request=(path,options={})=>new Promise((resolve,reject)=>{
  const headers={...options.headers,Host:`127.0.0.1:${service.port}`};
  if(options.method==='POST'){headers.Origin=origin;headers['Content-Length']=Buffer.byteLength(options.body||'');}
  if(cookie)headers.Cookie=cookie;lastSentCookie=headers.Cookie||'';
  const req=https.request(origin+path,{...options,headers,ca:cert,checkServerIdentity:(_host,peer)=>peer.fingerprint256.replaceAll(':','').toLowerCase()===service.fingerprint?undefined:Error('Wrong certificate')},res=>{
   let body='';res.on('data',c=>body+=c);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];resolve({status:res.statusCode,ok:res.statusCode===200,body,json:async()=>JSON.parse(body)});});
  });
  req.on('error',reject);if(options.body)req.write(options.body);req.end();
 });
 const html=await request('/');assert.equal(html.status,200);
 dom=new JSDOM(html.body,{runScripts:'outside-only',url:origin,pretendToBeVisual:true});
 const w=dom.window;w.confirm=()=>true;
 w.fetch=(path,options)=>request(path,{...options,signal:options.signal});
 w.eval((await request('/browser-bridge.js')).body);w.eval((await request('/app.js')).body);
 const until=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}assert.ok(fn(),'Expected UI state: '+w.document.body.textContent);};
 const $=id=>w.document.getElementById(id);
 await until(()=>$('linkInfo').textContent==='Not paired');
 assert.match($('status').textContent,/Disconnected/);
 const code=(await rpc('companion_pairing')).pairing_code;$('code').value=code;$('pair').click();
 await until(()=>$('status').textContent==='Connected'&&!$('saves').hidden);
 assert.match(cookie,/^__Host-FFREdit=/);assert.ok(!w.document.body.textContent.includes(cookie.split('=')[1]));
 console.log('PASS browser pairing uses actual HTTPS and keeps its cookie out of the interface');
 await until(()=>w.document.querySelector('#saveList button')&&!w.document.querySelector('#saveList button').disabled);
 const state=await rpc('get_state'),save=state.saves.find(s=>s.slot===1);
 const button=[...w.document.querySelectorAll('#saveList button')].find(b=>b.textContent.includes('Slot 1'));
 button.click();await until(()=>w.document.querySelector('#fields input')&&!$('editor').hidden);
 assert.match($('backupStatus').textContent,/Current save backed up and verified/);
 const money=()=>[...w.document.querySelectorAll('#fields .field')].find(f=>f.textContent.includes('current Money')).querySelector('input');
 money().value='444';money().dispatchEvent(new w.Event('input'));
 for(const category of ['Characters','Visions','Inventory','Artifacts','Maps','Journal','Bestiary','Other','Records']){
   $('category').value=category;$('category').dispatchEvent(new w.Event('change'));
   assert.equal($('editor').hidden,false,'Changing a section must not navigate to saves');
 }
 assert.equal(money().value,'444','Switching sections preserves staged changes');
 $('backup').click();await until(()=>$('alert').textContent.includes('Manual backup saved and verified'));
 let archive=await rpc('execute','get_backups',{sid:save.id});assert.ok(archive.backups.every(b=>b.verified));
 const original=archive.backups.at(-1);
 $('save').click();await until(()=>$('alert').textContent.includes('Saved. The previous'));
 let actual=await rpc('execute','open',{sid:save.id});assert.equal(actual.fields.find(f=>f.path==='Player.currentMoney').value,'444');
 w.document.querySelector('[data-tab=backups]').click();$('refreshBackups').click();await until(()=>$('alert').textContent.includes('Backup files read back and verified'));
 // Restore the earliest original snapshot from the actual rendered list.
 const candidates=w.document.querySelectorAll('#backupList button');candidates[candidates.length-1].click();
 await until(()=>$('alert').textContent==='Backup restored.');
 assert.equal(createHash('sha256').update(readFileSync(save.path)).digest('hex'),env.original_sha256);
 assert.ok(original.verified);
 console.log('PASS browser section navigation, manual backup receipt, edit, save, verification and exact restore');
 $('connect').click();assert.equal($('status').textContent,'Disconnected');assert.equal($('save').disabled,true);
 $('connect').click();await until(()=>$('status').textContent==='Connected');
 const devices=(await rpc('companion_status')).devices;await rpc('companion_revoke',devices[0].id);
 // A foreground transition prompts a fresh read instead of waiting for a poll interval.
 w.ForgeLifecycle(false);w.ForgeLifecycle(true);
 await until(()=>$('alert').textContent.includes('Pairing was revoked'));
 assert.equal($('connection').hidden,false);assert.equal($('save').disabled,true);
 assert.ok(lastSentCookie);
 console.log('PASS reconnect, revoked-pairing feedback and blocked disconnected writes');
}finally{
 if(dom)dom.window.close();backend.stdin.write(JSON.stringify({id:++seq,route:'_shutdown'})+'\n');backend.stdin.end();
}
