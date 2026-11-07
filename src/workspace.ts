import { Dispatch, SetStateAction, useSyncExternalStore } from 'react';

export type Field = {path:string; label:string; section:string; kind:string; value:string|boolean; readonly:boolean};
export type Save = {id:string; label:string; name:string; path:string; mtime:number};
export type Backup = {id:string; created:number; reason:string; size:number; sha256:string; verified:boolean; error?:string; path:string};
export type BackupSummary = {checked_at:number; total:number; verified:number; damaged:number; directory:string; latest_verified:number|null; current_revision_backed_up:boolean};
export type Document = {save_id:string; revision:string; fields:Field[]; backups:Backup[]; backup_summary:BackupSummary; warnings:string[]; parse_error?:string; items:{id:number; name:string; kind:string}[]};
export type State = {saves:Save[]; running:boolean; message:string; discovery_warnings?:string[]};
type Operation = {type:string; id?:number; quantity?:number};
type Workspace = {
  initialized:boolean; info:State; doc:Document|null; sid:string; tab:string; section:string;
  edits:Record<string,string|boolean>; ops:Operation[]; search:string; page:number; folder:string;
  busy:boolean; message:string; confirm:string; item:number; quantity:string; itemSearch:string;
};
// Steam recreates the QAM plugin view around menus and the on-screen keyboard.
// This module owns the workspace; the mounted React tree is only a subscriber.
let current:Workspace={initialized:false,info:{saves:[],running:false,message:''},doc:null,sid:'',tab:'Saves',section:'Records',edits:{},ops:[],search:'',page:0,folder:'',busy:false,message:'',confirm:'',item:1,quantity:'1',itemSearch:''};
const listeners=new Set<()=>void>();
export const getWorkspace=()=>current;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function setWorkspace<K extends keyof Workspace>(key:K,update:SetStateAction<Workspace[K]>):void {
  const value=typeof update==='function'?(update as (old:Workspace[K])=>Workspace[K])(current[key]):update;
  if(Object.is(current[key],value))return;
  current={...current,[key]:value};listeners.forEach(listener=>listener());
}
export function useWorkspace<K extends keyof Workspace>(key:K):[Workspace[K],Dispatch<SetStateAction<Workspace[K]>>] {
  const value=useSyncExternalStore(subscribe,()=>current[key],()=>current[key]);
  return [value,update=>setWorkspace(key,update)];
}
