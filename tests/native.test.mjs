// Exercise the actual shipped Decky JS and Python backend, including a QAM remount.
// Steam-only widgets are represented by accessible controls; their overlay lifecycle is simulated.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {JSDOM} from 'jsdom';
const backend=spawn('python3',['tests/backend_harness.py'],{stdio:['pipe','pipe','inherit']});
const waiting=new Map();let seq=0,readyResolve;
const ready=new Promise(r=>readyResolve=r);
createInterface({input:backend.stdout}).on('line',line=>{const r=JSON.parse(line);if(r.ready){readyResolve(r);return;}const q=waiting.get(r.id);if(!q)return;waiting.delete(r.id);r.ok?q.resolve(r.data):q.reject(Error(r.error));});
const rpc=(route,...args)=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});backend.stdin.write(JSON.stringify({id,route,args})+'\n');});
const environment=await ready;
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
const w=dom.window;globalThis.window=w;globalThis.document=w.document;globalThis.HTMLElement=w.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
const React=await import('react'),JSX=await import('react/jsx-runtime');
const {createRoot}=await import('react-dom/client');const h=React.createElement;
const dropdown=({label,strDefaultLabel,rgOptions,selectedOption,disabled,onChange})=>h('label',{},label||strDefaultLabel||'Section',h('select',{'aria-label':label||strDefaultLabel||'Section',value:selectedOption,disabled,onChange:e=>onChange(rgOptions.find(o=>String(o.data)===e.target.value))},rgOptions.map(o=>h('option',{value:o.data,key:o.data},o.label))));
const UI={PanelSection:({title,children})=>h('section',{},h('h2',{},title),children),PanelSectionRow:({children})=>h('div',{},children),
 ButtonItem:({children,onClick,disabled,description})=>h('div',{},h('button',{onClick,disabled},children),description&&h('small',{},description)),
 TextField:({label,value,disabled,onChange,description})=>h('label',{},label,h('input',{'aria-label':label,value,disabled,onChange}),description&&h('small',{},description)),
 ToggleField:({label,checked,disabled,onChange})=>h('label',{},label,h('input',{'aria-label':label,type:'checkbox',checked,disabled,onChange:e=>onChange(e.target.checked)})),
 Dropdown:dropdown,DropdownItem:dropdown};
w.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit={connect:()=>({_version:2,callable:route=>(...args)=>rpc(route,...args),useQuickAccessVisible:()=>true})};
const source=readFileSync('dist/index.js','utf8').replace('export { index as default };','index;');
const factory=vm.runInNewContext(source,{window:w,document:w.document,SP_REACT:React,SP_JSX:JSX,DFL:UI,console,setInterval,clearInterval,setTimeout,clearTimeout});
let root;
async function mount(){root=createRoot(document.getElementById('root'));await React.act(async()=>{root.render(factory().content);await new Promise(r=>setTimeout(r,100));});}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await React.act(async()=>{await new Promise(r=>setTimeout(r,30));});}assert.ok(fn(),'Expected UI state not reached: '+document.body.textContent);}
const click=async name=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===name);assert.ok(b,'Missing '+name);assert.equal(b.disabled,false,'Disabled '+name);await React.act(async()=>{b.click();await new Promise(r=>setTimeout(r,20));});};
async function select(label,value){const node=document.querySelector(`select[aria-label="${label}"]`);assert.ok(node,`Missing selector ${label}`);await React.act(async()=>{node.value=value;node.dispatchEvent(new w.Event('change',{bubbles:true}));});}
async function input(label,value){const node=document.querySelector(`input[aria-label="${label}"]`);assert.ok(node,'Missing field '+label);await React.act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new w.Event('input',{bubbles:true}));});}
async function remount(){await React.act(async()=>root.unmount());await mount();}
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
try{
 await mount();await until(()=>document.body.textContent.includes('Slot 1 ·'));
 const slot=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Slot 1 ·'));
 await React.act(async()=>slot.click());
 const confirm=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirm open'));
 if(confirm)await React.act(async()=>confirm.click());
 await until(()=>document.querySelector('select[aria-label=Section]'));
 assert.match(document.body.textContent,/Current save backed up and verified/);
 let info=await rpc('get_state'),sid=info.saves.find(s=>s.slot===1).id;
 let archive=await rpc('execute','get_backups',{sid});
 assert.ok(archive.backup_summary.current_revision_backed_up);
 assert.ok(archive.backups.every(b=>b.verified&&existsSync(b.path)&&sha(b.path)===b.sha256));
 const originalBackup=archive.backups[0];
 for(const section of ['Characters','Visions','Inventory','Artifacts','Maps','Journal','Bestiary','Other','Records']){
   await select('Section',section);await remount();
   assert.equal(document.querySelector('select[aria-label=Section]')?.value,section,'Section and selected save must survive QAM/menu remount');
   assert.match(document.body.textContent,/Current save backed up and verified/);
 }
 console.log('PASS all nine native sections and automatic backup receipt survive QAM remounts');
 await input('Player · current Money','333');
 await remount();assert.equal(document.querySelector('input[aria-label="Player · current Money"]').value,'333');
 await click('Connection');await remount();await until(()=>document.body.textContent.includes('Companion server off'));
 assert.ok(!document.querySelector('select[aria-label=Section]'));
 await click('Start companion server');await until(()=>document.body.textContent.includes('HTTPS self-test passed'));
 let service=await rpc('companion_status');assert.equal(service.enabled,true);assert.equal(service.listening,true);assert.equal(service.self_test.ok,true);
 await remount();await until(()=>document.body.textContent.includes('HTTPS self-test passed'));
 await click('Test HTTPS connection');await until(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Test HTTPS connection'&&!b.disabled));
 await click('Pair a phone or browser');await until(()=>/Pairing code: \d{6}/.test(document.body.textContent));
 service=await rpc('companion_status');assert.match(service.pairing_code,/^\d{6}$/);
 console.log('PASS Connection remains open, enables real TLS listener, self-tests and creates a pairing code');
 await click('Editor');await remount();assert.equal(document.querySelector('input[aria-label="Player · current Money"]').value,'333');
 await click('Back up this save now');await until(()=>document.body.textContent.includes('Manual backup saved and verified on disk.'));
 archive=await rpc('execute','get_backups',{sid});assert.ok(archive.backups.some(b=>b.reason==='manual'&&b.verified));
 await click('Save changes');await remount();await click('Confirm save to disk');await until(()=>document.body.textContent.includes('Saved. The previous file is backed up.'));
 const savePath=info.saves.find(s=>s.id===sid).path;assert.notEqual(sha(savePath),environment.original_sha256);
 const reopened=await rpc('execute','open',{sid});assert.equal(reopened.fields.find(f=>f.path==='Player.currentMoney').value,'333');
 await input('Player · current Money','NaN');await click('Save changes');await click('Confirm save to disk');
 await until(()=>document.body.textContent.includes('finite number'));assert.ok(document.querySelector('select[aria-label=Section]'),'Validation error must stay in editor');
 await click('Reload from disk');await remount();await click('Confirm discard & reload');await until(()=>document.querySelector('input[aria-label="Player · current Money"]')?.value==='333');
 await click('Backups');await remount();await click('Verify backups now');await until(()=>document.body.textContent.includes('Backup files read back'));
 const restoreButton=[...document.querySelectorAll('button')].find(b=>b.textContent.endsWith(originalBackup.id.slice(0,8)));assert.ok(restoreButton);
 await React.act(async()=>restoreButton.click());await remount();await click('Confirm restore (discard pending edits)');await until(()=>document.body.textContent.includes('Backup restored.'));
 assert.equal(sha(savePath),environment.original_sha256,'Native restore must recover the exact original bytes');
 console.log('PASS manual backup, staged edits, confirmation remount, save validation, reload, checksum verification and byte-exact restore');
 await click('Saves');await remount();await click('Back up all saves now');await until(()=>document.body.textContent.includes('2 save slots backed up and verified on disk.'));
 for(const save of info.saves){const copies=await rpc('execute','get_backups',{sid:save.id});assert.ok(copies.backups.some(b=>b.reason==='manual all slots'&&b.verified));}
 await click('Connection');await until(()=>document.body.textContent.includes('Companion server listening'));await click('Stop companion server');await until(()=>document.body.textContent.includes('Companion server off'));
 assert.equal((await rpc('companion_status')).listening,false);
 await remount();assert.match(document.body.textContent,/Companion server off/);
 console.log('PASS backup-all receipts, Connection stop and repeated page remounts');
}finally{if(root)await React.act(async()=>root.unmount());backend.stdin.write(JSON.stringify({id:++seq,route:'_shutdown'})+'\n');backend.stdin.end();w.close();}
