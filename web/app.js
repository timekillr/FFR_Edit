'use strict';
(()=>{
const $=id=>document.getElementById(id), pending=new Map();
let connectionEpoch=0,polling=false;
let seq=0, paired=false, connected=false, want=false, deadline=0, timer=0, active=true, busy=false;
let state={saves:[]}, doc=null, edits={},operations=[],page=0,tab='connection';
const categories=['Records','Characters','Visions','Inventory','Artifacts','Maps','Journal','Bestiary','Other'];
window.ForgeReply=(id,r)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);r.ok?p.resolve(r.data):p.reject(Object.assign(Error(r.error),{status:r.status||0}));};
function api(action,args={}){return new Promise((resolve,reject)=>{const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);reject(Error('Request timed out. Reload before retrying a change.'));},70000);pending.set(id,{resolve,reject,timer});window.ForgeNative.request(id,action,JSON.stringify(args));});}
function notice(text){$('alert').textContent=text;$('alert').hidden=!text;}
function locks(){document.querySelectorAll('[data-online]').forEach(b=>b.disabled=busy||!connected||!active);$('status').textContent=connected?'Connected':want?'Connecting…':'Disconnected';$('connect').textContent=want?'Disconnect':'Reconnect';$('pending').textContent=`${Object.keys(edits).length+operations.length} pending changes`;renderBackupStatus();$('pair').disabled=busy;document.querySelectorAll('#fields input').forEach(e=>{const f=doc?.fields.find(f=>f.path===e.dataset.path);e.disabled=busy||!connected||!active||f?.readonly;});}
function show(name){tab=name;['connection','saves','editor','backups'].forEach(t=>$(t).hidden=t!==name);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));}
async function run(fn){if(busy)return;busy=true;notice('');locks();try{await fn();}catch(e){notice(e.message);}finally{busy=false;locks();}}
async function command(method,args={}){if(!connected||!want||!active)throw Error('Reconnect before using saves.');return api('command',{method,args});}
function update(next){state=next;$('game').textContent=state.running?'Game is running. Close it before saving or restoring.':'Ready to edit. Automatic backups are enabled.';renderSaves();}
function renderSaves(){const list=$('saveList');list.replaceChildren();state.saves.forEach(s=>{const box=document.createElement('div');box.className='card saveRow';const b=document.createElement('button');b.dataset.online='';b.textContent=s.label+' · '+s.name;b.disabled=busy||!connected||!active||b.dataset.invalid==='1';b.onclick=()=>run(async()=>{if(dirty()&&!confirm('Discard pending edits and open this save?'))return;accept(await command('open',{sid:s.id}));show('editor');});const p=document.createElement('span');p.className='path';p.textContent=s.path+' · '+new Date(s.mtime*1000).toLocaleString();box.append(b,p);list.append(box);});}
function dirty(){return Object.keys(edits).length+operations.length>0;}
function renderBackupStatus(){
 const summary=doc?.backup_summary,el=$('backupStatus');if(!el)return;
 el.textContent=!summary?'No verified backup receipt yet. Open a save to create and verify its backup.':`${summary.current_revision_backed_up?'Current save backed up and verified':'Current save is not covered by a verified backup'} · ${summary.verified}/${summary.total} verified copies${summary.damaged?' · '+summary.damaged+' damaged':''}\nBackup folder: ${summary.directory}`;
}
function accept(next){doc=next;edits={};operations=[];page=0;$('saveName').textContent=state.saves.find(s=>s.id===doc.save_id)?.label||'Save';renderFields();renderBackups();renderItems();locks();}
function rows(){return doc?doc.fields.filter(f=>f.section===$('category').value&&`${f.path} ${f.label}`.toLowerCase().includes($('search').value.toLowerCase())):[];}
function renderFields(){const all=rows();page=Math.max(0,Math.min(page,Math.ceil(all.length/20)-1));$('fields').replaceChildren();all.slice(page*20,(page+1)*20).forEach(f=>{const label=document.createElement('label');label.className='field';const title=document.createElement('div');title.textContent=f.label;const input=document.createElement('input');input.dataset.path=f.path;input.type=f.kind==='bool'?'checkbox':'text';input.disabled=f.readonly||busy||!connected;const value=edits[f.path]??f.value;if(f.kind==='bool')input.checked=value;else input.value=value;if(f.kind!=='bool'&&f.kind!=='text'&&f.kind!=='vector')input.inputMode='decimal';input.oninput=()=>{edits[f.path]=f.kind==='bool'?input.checked:input.value;locks();};const hint=document.createElement('small');hint.textContent=f.readonly?'Read only':f.kind==='vector'?'Position [X,Y,Z]':f.path;label.append(title,input,hint);$('fields').append(label);});$('page').textContent=`${all.length} fields · ${page+1}/${Math.max(1,Math.ceil(all.length/20))}`;$('prev').disabled=page===0;$('next').disabled=(page+1)*20>=all.length;$('quick').replaceChildren();if($('category').value==='Visions')for(const [type,text]of [['max_mastery','Stage max Mastery Rank'],['awaken','Stage full Awakening']]){const b=document.createElement('button');b.dataset.online='';b.textContent=text;b.disabled=!connected||!active||busy;b.onclick=()=>{operations.push({type});locks();notice(text+' — save changes to apply.');};$('quick').append(b);}$('addItem').hidden=$('category').value!=='Inventory';}
function renderItems(){const select=$('item');select.replaceChildren();(doc?.items||[]).filter(i=>`${i.name} ${i.id}`.toLowerCase().includes($('itemSearch').value.toLowerCase())).forEach(i=>{const o=document.createElement('option');o.value=i.id;o.textContent=`${i.name} (${i.id})`;select.append(o);});}
function renderBackups(){$('backupList').replaceChildren();(doc?.backups||[]).forEach(b=>{const box=document.createElement('div');box.className='card';const title=document.createElement('p');title.textContent=new Date(b.created*1000).toLocaleString()+' · '+b.reason+' · '+(b.verified===false?'VERIFICATION FAILED: '+b.error:'SHA-256 verified')+' · '+b.size+' bytes';const button=document.createElement('button');button.dataset.online='';button.dataset.invalid=b.verified===false?'1':'';button.textContent='Restore this backup';button.disabled=!connected||!active||busy;button.onclick=()=>run(async()=>{if(!confirm('Restore this backup? Pending edits will be discarded. The current file will be backed up first.'))return;accept(await command('restore',{sid:doc.save_id,revision:doc.revision,backup_id:b.id}));notice('Backup restored.');});box.append(title,button);$('backupList').append(box);});}
async function poll(){
 clearTimeout(timer);if(!want||!active||!paired||polling)return;
 const epoch=connectionEpoch;polling=true;
 try{
  const next=await api('state',{timeout_ms:deadline?Math.max(1,Math.min(8000,deadline-Date.now())):8000});
  if(epoch!==connectionEpoch||!want||!active)return;
  connected=true;deadline=0;update(next);
 }catch(e){
  if(epoch!==connectionEpoch||!want||!active)return;
  connected=false;
  if(e.status===401){paired=false;want=false;show('connection');notice('Pairing was revoked or expired. Create a new code in Decky and pair again.');}
  else{if(!deadline)deadline=Date.now()+10000;if(Date.now()>=deadline){want=false;notice('Connection retries stopped after 10 seconds. Tap Reconnect to try again.');}}
 }finally{polling=false;locks();if(want&&active)timer=setTimeout(poll,connected?2500:700);}
}
function stop(){want=false;connected=false;connectionEpoch++;clearTimeout(timer);void api('cancel_reads').catch(()=>{});locks();}
async function settings(){const s=await api('settings');paired=s.paired;$('linkInfo').textContent=paired?'Pairing remembered · '+s.endpoint:'Not paired';$('forget').hidden=!paired;$('connect').hidden=!paired;$('permission').hidden=s.network_permission!==false;return s;}
window.ForgeLifecycle=visible=>{active=visible;connectionEpoch++;clearTimeout(timer);if(!active){connected=false;void api('cancel_reads').catch(()=>{});}else if(want){deadline=Date.now()+10000;void poll();}locks();};
window.ForgePermissionsChanged=()=>run(settings);
document.addEventListener('visibilitychange',()=>window.ForgeLifecycle(!document.hidden));
window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
$('pair').onclick=()=>run(async()=>{await api('pair',{endpoint:$('endpoint').value,code:$('code').value});await settings();want=true;deadline=Date.now()+10000;await poll();if(connected){update(await command('discover'));show('saves');}});
$('permission').onclick=()=>run(async()=>{await api('permission');await settings();});
$('connect').onclick=()=>{if(want)stop();else{want=true;deadline=Date.now()+10000;void poll();}};
$('forget').onclick=()=>run(async()=>{if(!confirm('Forget this pairing?'))return;stop();await api('forget');await settings();});
$('scan').onclick=()=>run(async()=>{update(await command('discover'));});
$('backupAll').onclick=()=>run(async()=>{const result=await command('backup_all');if(doc){const archive=await command('get_backups',{sid:doc.save_id});Object.assign(doc,archive);renderBackups();locks();}notice(result.message||'All save slots backed up and verified.');});
$('backup').onclick=()=>run(async()=>{if(!doc)return;const next=await command('backup',{sid:doc.save_id});doc.backups=next.backups;doc.backup_summary=next.backup_summary;renderBackups();locks();notice('Manual backup saved and verified on disk.');});
$('reload').onclick=()=>run(async()=>{if(doc&&(!dirty()||confirm('Discard pending edits and reload?')))accept(await command('open',{sid:doc.save_id}));});
$('save').onclick=()=>run(async()=>{if(!doc||!dirty())return;if(!confirm('Save staged changes to this slot? The current file will be backed up first.'))return;accept(await command('commit',{sid:doc.save_id,revision:doc.revision,edits:Object.entries(edits).map(([path,v])=>({path,v})),operations}));notice('Saved. The previous file is backed up.');});
$('refreshBackups').onclick=()=>run(async()=>{if(doc){const next=await command('get_backups',{sid:doc.save_id});Object.assign(doc,next);renderBackups();locks();notice('Backup files read back and verified.');}});
$('stageItem').onclick=()=>{const quantity=Number($('quantity').value);if(!Number.isInteger(quantity)||quantity<0||quantity>99){notice('Quantity must be 0–99.');return;}operations.push({type:'item',id:Number($('item').value),quantity});locks();notice('Inventory change staged.');};
$('prev').onclick=()=>{page--;renderFields();};$('next').onclick=()=>{page++;renderFields();};$('search').oninput=()=>{page=0;renderFields();};$('category').onchange=()=>{page=0;renderFields();};$('itemSearch').oninput=renderItems;
categories.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;$('category').append(o);});
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{show(b.dataset.tab);renderFields();renderBackups();});
void run(async()=>{await settings();if(paired){want=true;deadline=Date.now()+10000;await poll();if(connected)show('saves');}});
})();
