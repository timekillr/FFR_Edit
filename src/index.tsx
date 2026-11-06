import { useEffect, useMemo, useState } from 'react';
import { ButtonItem, Dropdown, PanelSection, PanelSectionRow, TextField, ToggleField } from '@decky/ui';
import { callable, definePlugin } from '@decky/api';
import { CompanionPanel } from './components/CompanionPanel';

type Field = {path:string; label:string; section:string; kind:string; value:string|boolean; readonly:boolean};
type Save = {id:string; label:string; name:string; path:string; mtime:number};
type Backup = {id:string; created:number; reason:string};
type Document = {save_id:string; revision:string; fields:Field[]; backups:Backup[]; warnings:string[]; items:{id:number; name:string; kind:string}[]};
type State = {saves:Save[]; running:boolean; message:string};
const execute=callable<[method:string,args:Record<string,unknown>], any>('execute');
const state=callable<[],State>('get_state');
const addFolder=callable<[folder:string],State>('add_folder');
const sections=['Records','Characters','Visions','Inventory','Artifacts','Maps','Journal','Bestiary','Other'];
function Editor() {
  const [info,setInfo]=useState<State>({saves:[],running:false,message:''});
  const [doc,setDoc]=useState<Document|null>(null), [sid,setSid]=useState('');
  const [tab,setTab]=useState('Saves'), [section,setSection]=useState('Records');
  const [edits,setEdits]=useState<Record<string,string|boolean>>({}),[ops,setOps]=useState<any[]>([]);
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[folder,setFolder]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirm,setConfirm]=useState('');
  const [item,setItem]=useState(1),[quantity,setQuantity]=useState('1'),[itemSearch,setItemSearch]=useState('');
  const dirty=Object.keys(edits).length+ops.length;
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await action();}catch(e){setMessage(String(e));}finally{setBusy(false);setConfirm('');}};
  const load=async(id:string)=>{const next=await execute('open',{sid:id});setDoc(next);setSid(id);setEdits({});setOps([]);setPage(0);};
  useEffect(()=>{void run(async()=>{setInfo(await execute('discover',{}));});},[]);
  const rows=useMemo(()=>doc?.fields.filter(f=>f.section===section&&`${f.label} ${f.path}`.toLowerCase().includes(search.toLowerCase()))||[],[doc,section,search]);
  const mutate=(f:Field,v:string|boolean)=>{setEdits(old=>({...old,[f.path]:v}));setConfirm('');};
  const ask=(id:string,action:()=>Promise<void>)=>{if(confirm!==id){setConfirm(id);return;}void run(action);};
  const notice=<PanelSectionRow><div style={{whiteSpace:'normal',wordBreak:'break-word',padding:8}}>{message|| (info.running?'Game is running. Close it before saving or restoring.':dirty?`${dirty} pending change(s). Save when ready.`:'All changes are backed up before writing.')}</div></PanelSectionRow>;
  const button=(text:string,onClick:()=>void,disabled=false,description?:string)=><PanelSectionRow><ButtonItem layout="below" disabled={busy||disabled} description={description} onClick={onClick}>{text}</ButtonItem></PanelSectionRow>;
  return <>
    <PanelSection title="FFR Edit · 0.1.1">
      <PanelSectionRow><Dropdown strDefaultLabel="Page" selectedOption={tab} rgOptions={['Saves','Editor','Backups','Connection'].map(x=>({data:x,label:x}))} onChange={x=>{setTab(x.data);setConfirm('');}} /></PanelSectionRow>
      {notice}
    </PanelSection>
    {tab==='Saves'&&<PanelSection title="Save files">
      {button('Scan for saves',()=>void run(async()=>{setInfo(await execute('discover',{}));}))}
      {!info.saves.length&&<PanelSectionRow><div>No saves found. Launch and save the game once, or add a folder below.</div></PanelSectionRow>}
      {info.saves.map(s=><PanelSectionRow key={s.id}><ButtonItem layout="below" disabled={busy} description={`${s.path} · ${new Date(s.mtime*1000).toLocaleString()}`} onClick={()=>ask('open-'+s.id,async()=>{await load(s.id);setTab('Editor');})}>{confirm==='open-'+s.id?'Confirm open (discard pending edits)':s.label+' · '+s.name}</ButtonItem></PanelSectionRow>)}
      {button('Back up all saves now',()=>void run(async()=>{setInfo(await execute('backup_all',{}));setMessage('All save slots backed up.');}))}
      <PanelSectionRow><TextField label="Custom save folder" value={folder} onChange={e=>setFolder(e.target.value)} /></PanelSectionRow>
      {button('Add folder & scan',()=>void run(async()=>{setInfo(await addFolder(folder));}),!folder)}
    </PanelSection>}
    {tab==='Editor'&&<PanelSection title={info.saves.find(s=>s.id===sid)?.label||'Choose a save first'}>
      {doc&&<>
        {button(confirm==='save'?'Confirm save to disk':'Save changes',()=>ask('save',async()=>{setDoc(await execute('commit',{sid,revision:doc.revision,edits:Object.entries(edits).map(([path,v])=>({path,v})),operations:ops}));setEdits({});setOps([]);setInfo(await state());setMessage('Saved. The previous file is backed up.');}),!dirty)}
        {button('Back up this save now',()=>void run(async()=>{const result=await execute('backup',{sid});setDoc(old=>old?{...old,backups:result.backups}:old);setMessage('Manual backup created.');}))}
        {button(confirm==='reload'?'Confirm discard & reload':'Reload from disk',()=>ask('reload',async()=>{await load(sid);}))}
        <PanelSectionRow><Dropdown selectedOption={section} rgOptions={sections.map(x=>({data:x,label:x}))} onChange={x=>{setSection(x.data);setPage(0);}} /></PanelSectionRow>
        <PanelSectionRow><TextField label="Search fields" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></PanelSectionRow>
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
          <PanelSectionRow><Dropdown selectedOption={item} rgOptions={doc.items.filter(i=>`${i.name} ${i.id}`.toLowerCase().includes(itemSearch.toLowerCase())).map(i=>({data:i.id,label:`${i.name} (${i.id})`}))} onChange={x=>setItem(x.data)} /></PanelSectionRow>
          <PanelSectionRow><TextField label="Quantity (0–99)" value={quantity} onChange={e=>setQuantity(e.target.value)} /></PanelSectionRow>
          {button('Stage inventory item',()=>{setOps(o=>[...o,{type:'item',id:item,quantity:Number(quantity)}]);setMessage('Item staged. Save changes to apply.');})}
        </>}
        {doc.warnings.map(w=><PanelSectionRow key={w}><p>{w}</p></PanelSectionRow>)}
      </>}
    </PanelSection>}
    {tab==='Backups'&&<PanelSection title="Backups for the open save">
      {!doc&&<PanelSectionRow><div>Open a save to view its backups.</div></PanelSectionRow>}
      {doc&&button('Refresh backup list',()=>void run(async()=>{const next=await execute('open',{sid});setDoc({...doc,backups:next.backups});}))}
      {doc?.backups.map(b=><PanelSectionRow key={b.id}><ButtonItem layout="below" disabled={busy} description={b.reason+' · Restore first backs up the current save.'} onClick={()=>ask(b.id,async()=>{setDoc(await execute('restore',{sid,revision:doc.revision,backup_id:b.id}));setEdits({});setOps([]);setMessage('Backup restored. The previous save is also backed up.');})}>{confirm===b.id?'Confirm restore (discard pending edits)':new Date(b.created*1000).toLocaleString()}</ButtonItem></PanelSectionRow>)}
    </PanelSection>}
    {tab==='Connection'&&<CompanionPanel visible />}
  </>;
}
export default definePlugin(()=>({name:'FFR Edit',title:<div>FFR Edit</div>,content:<Editor/>,icon:<span>✦</span>}));
