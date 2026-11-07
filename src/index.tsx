import { useEffect, useMemo } from 'react';
import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, TextField, ToggleField } from '@decky/ui';
import { callable, definePlugin, useQuickAccessVisible } from '@decky/api';
import { CompanionPanel } from './components/CompanionPanel';

import { Field, State, Document, useWorkspace, getWorkspace, setWorkspace } from './workspace';
const execute=callable<[method:string,args:Record<string,unknown>], any>('execute');
const state=callable<[],State>('get_state');
const addFolder=callable<[folder:string],State>('add_folder');
const sections=['Records','Characters','Visions','Inventory','Artifacts','Maps','Journal','Bestiary','Other'];
function BackupStatus({document:doc}:{document:Document}) {
  const summary=doc.backup_summary;
  if(!summary)return <PanelSectionRow><div role="status">Backup status unavailable. Open Backups and verify the archive.</div></PanelSectionRow>;
  return <PanelSectionRow><div role="status" style={{padding:8,whiteSpace:'normal',overflowWrap:'anywhere'}}>
    <strong>{summary.current_revision_backed_up?'Current save backed up and verified':'Current save is not covered by a verified backup'}</strong>
    <div>{summary.verified} verified / {summary.total} backup copies{summary.damaged?` · ${summary.damaged} damaged`:''}</div>
    {summary.latest_verified&&<div>Latest verified copy: {new Date(summary.latest_verified*1000).toLocaleString()}</div>}
    <div>Verified at {new Date(summary.checked_at*1000).toLocaleTimeString()}</div><div>Backup folder: {summary.directory}</div>
  </div></PanelSectionRow>;
}
function Editor() {
  const visible=typeof useQuickAccessVisible==='function'?useQuickAccessVisible():true;
  const [info,setInfo]=useWorkspace('info');
  const [doc,setDoc]=useWorkspace('doc');
  const [sid,setSid]=useWorkspace('sid');
  const [tab,setTab]=useWorkspace('tab');
  const [section,setSection]=useWorkspace('section');
  const [edits,setEdits]=useWorkspace('edits');
  const [ops,setOps]=useWorkspace('ops');
  const [search,setSearch]=useWorkspace('search');
  const [page,setPage]=useWorkspace('page');
  const [folder,setFolder]=useWorkspace('folder');
  const [busy,setBusy]=useWorkspace('busy');
  const [message,setMessage]=useWorkspace('message');
  const [confirm,setConfirm]=useWorkspace('confirm');
  const [item,setItem]=useWorkspace('item');
  const [quantity,setQuantity]=useWorkspace('quantity');
  const [itemSearch,setItemSearch]=useWorkspace('itemSearch');
  const dirty=Object.keys(edits).length+ops.length;
  const run=async(action:()=>Promise<void>)=>{if(getWorkspace().busy)return;setBusy(true);setMessage('');try{await action();}catch(e){setMessage(String(e));}finally{setBusy(false);setConfirm('');}};
  const load=async(id:string)=>{const next=await execute('open',{sid:id});setDoc(next);setSid(id);setEdits({});setOps([]);setPage(0);setMessage(next.parse_error?'This save needs recovery. Open Backups to restore a verified copy.':'Opened save. Its current revision has a verified backup.');};
  useEffect(()=>{if(getWorkspace().initialized)return;setWorkspace('initialized',true);void run(async()=>{setInfo(await execute('discover',{}));});},[]);
  useEffect(()=>{if(!visible)return;let active=true;void state().then(next=>{if(active)setInfo(next);}).catch(error=>{if(active)setMessage(String(error));});return()=>{active=false;};},[visible]);
  const rows=useMemo(()=>doc?.fields.filter(f=>f.section===section&&`${f.label} ${f.path}`.toLowerCase().includes(search.toLowerCase()))||[],[doc,section,search]);
  const mutate=(f:Field,v:string|boolean)=>{setEdits(old=>({...old,[f.path]:v}));setConfirm('');};
  const ask=(id:string,action:()=>Promise<void>)=>{if(confirm!==id){setConfirm(id);return;}void run(action);};
  const notice=<PanelSectionRow><div style={{whiteSpace:'normal',wordBreak:'break-word',padding:8}}>{message|| (info.running?'Game is running. Close it before saving or restoring.':dirty?`${dirty} pending change(s). Save when ready.`:'All changes are backed up before writing.')}</div></PanelSectionRow>;
  const button=(text:string,onClick:()=>void,disabled=false,description?:string)=><PanelSectionRow><ButtonItem layout="below" disabled={busy||disabled} description={description} onClick={onClick}>{text}</ButtonItem></PanelSectionRow>;
  return <>
    <PanelSection title="FFR Edit · 0.2.0">
      {['Saves','Editor','Backups','Connection'].map(name=><PanelSectionRow key={name}><ButtonItem layout="below" disabled={busy} onClick={()=>{setTab(name);setConfirm('');}}>{tab===name?'● '+name:name}</ButtonItem></PanelSectionRow>)}
      {notice}
      {doc&&<BackupStatus document={doc}/>}
      {info.discovery_warnings?.map(w=><PanelSectionRow key={w}><p>{w}</p></PanelSectionRow>)}
    </PanelSection>
    {tab==='Saves'&&<PanelSection title="Save files">
      {button('Scan for saves',()=>void run(async()=>{setInfo(await execute('discover',{}));}))}
      {!info.saves.length&&<PanelSectionRow><div>No saves found. Launch and save the game once, or add a folder below.</div></PanelSectionRow>}
      {info.saves.map(s=><PanelSectionRow key={s.id}><ButtonItem layout="below" disabled={busy} description={`${s.path} · ${new Date(s.mtime*1000).toLocaleString()}`} onClick={()=>{const open=async()=>{await load(s.id);setTab('Editor');};if(dirty)ask('open-'+s.id,open);else void run(open);}}>{confirm==='open-'+s.id?'Confirm open (discard pending edits)':s.label+' · '+s.name}</ButtonItem></PanelSectionRow>)}
      {button('Back up all saves now',()=>void run(async()=>{const next=await execute('backup_all',{});setInfo(next);if(sid){const archive=await execute('get_backups',{sid});setDoc(old=>old?{...old,...archive}:old);}setMessage(next.message);}))}
      <PanelSectionRow><TextField label="Custom save folder" value={folder} onChange={e=>setFolder(e.target.value)} /></PanelSectionRow>
      {button('Add folder & scan',()=>void run(async()=>{setInfo(await addFolder(folder));}),!folder)}
    </PanelSection>}
    {tab==='Editor'&&<PanelSection title={info.saves.find(s=>s.id===sid)?.label||'Choose a save first'}>
      {!doc&&<PanelSectionRow><p>Open a save from Saves to begin editing.</p></PanelSectionRow>}
      {doc&&<>
        {button(confirm==='save'?'Confirm save to disk':'Save changes',()=>ask('save',async()=>{setDoc(await execute('commit',{sid,revision:doc.revision,edits:Object.entries(edits).map(([path,v])=>({path,v})),operations:ops}));setEdits({});setOps([]);setInfo(await state());setMessage('Saved. The previous file is backed up.');}),!dirty)}
        {button('View & verify backups',()=>{setTab('Backups');setConfirm('');})}
        {button('Back up this save now',()=>void run(async()=>{const result=await execute('backup',{sid});setDoc(old=>old?{...old,backups:result.backups,backup_summary:result.backup_summary}:old);setMessage('Manual backup saved and verified on disk.');}))}
        {button(confirm==='reload'?'Confirm discard & reload':'Reload from disk',()=>ask('reload',async()=>{await load(sid);}))}
        <PanelSectionRow><DropdownItem label="Section" disabled={busy} selectedOption={section} rgOptions={sections.map(x=>({data:x,label:x}))} onChange={x=>{setSection(x.data);setPage(0);}} /></PanelSectionRow>
        <PanelSectionRow><TextField label="Search fields" disabled={busy} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></PanelSectionRow>
        {rows.slice(page*12,(page+1)*12).map(f=><PanelSectionRow key={doc.revision+f.path}>{f.kind==='bool'?<ToggleField label={f.label} checked={Boolean(edits[f.path]??f.value)} disabled={busy||f.readonly} onChange={v=>mutate(f,v)} />:<TextField label={f.label} description={f.readonly?'Read only':f.kind==='vector'?'Position [X,Y,Z]':f.path} value={String(edits[f.path]??f.value)} disabled={busy||f.readonly} onChange={e=>mutate(f,e.target.value)} />}</PanelSectionRow>)}
        <PanelSectionRow><div>{rows.length} fields · Page {page+1} of {Math.max(1,Math.ceil(rows.length/12))}</div></PanelSectionRow>
        {button('Previous page',()=>setPage(p=>p-1),page===0)}
        {button('Next page',()=>setPage(p=>p+1),(page+1)*12>=rows.length)}
        {section==='Visions'&&<>
          {button('Stage max Mastery Rank for all Visions',()=>setOps(o=>[...o,{type:'max_mastery'}]))}
          {button('Stage full Awakening for all Visions',()=>setOps(o=>[...o,{type:'awaken'}]),false,'Finish the Moogle of Light awakening tutorial first.')}
        </>}
        {section==='Inventory'&&<>
          <PanelSectionRow><TextField label="Find an item to add" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} /></PanelSectionRow>
          <PanelSectionRow><DropdownItem label="Item" disabled={busy} selectedOption={item} rgOptions={doc.items.filter(i=>`${i.name} ${i.id}`.toLowerCase().includes(itemSearch.toLowerCase())).map(i=>({data:i.id,label:`${i.name} (${i.id})`}))} onChange={x=>setItem(x.data)} /></PanelSectionRow>
          <PanelSectionRow><TextField label="Quantity (0–99)" value={quantity} onChange={e=>setQuantity(e.target.value)} /></PanelSectionRow>
          {button('Stage inventory item',()=>{const count=Number(quantity);if(!quantity.trim()||!Number.isInteger(count)||count<0||count>99||!doc.items.some(i=>i.id===item)){setMessage('Choose an item and a whole quantity from 0 to 99.');return;}setOps(o=>[...o,{type:'item',id:item,quantity:count}]);setMessage('Item staged. Save changes to apply.');})}
        </>}
        {doc.warnings.map(w=><PanelSectionRow key={w}><p>{w}</p></PanelSectionRow>)}
      </>}
    </PanelSection>}
    {tab==='Backups'&&<PanelSection title="Backups for the open save">
      {!doc&&<PanelSectionRow><div>Open a save to view its backups.</div></PanelSectionRow>}
      {doc&&button('Verify backups now',()=>void run(async()=>{const next=await execute('get_backups',{sid});setDoc(old=>old?{...old,...next}:old);setMessage('Backup files read back and checked against their SHA-256 checksums.');}))}
      {doc?.backups.map(b=><PanelSectionRow key={b.id}><ButtonItem layout="below" disabled={busy||!b.verified} description={`${b.reason} · ${b.size.toLocaleString()} bytes · ${b.verified?'SHA-256 verified':b.error||'Verification failed'}. Restore first backs up the current save.`} onClick={()=>ask(b.id,async()=>{setDoc(await execute('restore',{sid,revision:doc.revision,backup_id:b.id}));setEdits({});setOps([]);setMessage('Backup restored. The previous save is also backed up.');})}>{confirm===b.id?'Confirm restore (discard pending edits)':`${new Date(b.created*1000).toLocaleString()} · ${b.id.slice(0,8)}`}</ButtonItem></PanelSectionRow>)}
    </PanelSection>}
    {tab==='Connection'&&<CompanionPanel visible={visible} />}
  </>;
}
export default definePlugin(()=>({name:'FFR Edit',title:<div>FFR Edit</div>,content:<Editor/>,icon:<span>✦</span>}));
