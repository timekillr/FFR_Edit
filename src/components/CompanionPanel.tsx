import { useEffect, useRef, useState } from 'react';
import { ButtonItem, PanelSection, PanelSectionRow } from '@decky/ui';
import { callable } from '@decky/api';

interface Status {
  enabled:boolean; listening:boolean; error?:string; addresses:string[]; hostname:string;
  web_urls?:string[]; fingerprint:string; pairing_code:string; expires_in:number;
  self_test?:{ok:boolean; checked_at:number; error?:string};
  devices:{id:string; name:string; last_seen?:number}[];
}
const status=callable<[],Status>('companion_status');
const enable=callable<[enabled:boolean],Status>('companion_enable');
const check=callable<[],Status>('companion_check');
const pair=callable<[],Status>('companion_pairing');
const revoke=callable<[deviceId:string],Status>('companion_revoke');
let cached:Status|null=null;
export function CompanionPanel({visible}:{visible:boolean}) {
  const [data,setData]=useState<Status|null>(cached),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remove,setRemove]=useState('');
  const mounted=useRef(true), inFlight=useRef(false), actionInFlight=useRef(false), generation=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const apply=(next:Status)=>{cached=next;if(mounted.current){setData(next);setError('');}};
  useEffect(()=>{
    if(!visible)return;
    const update=async()=>{
      if(inFlight.current||actionInFlight.current)return;
      const serial=generation.current;
      inFlight.current=true;
      try{const next=await status();if(mounted.current&&generation.current===serial)apply(next);}
      catch(e){if(mounted.current&&generation.current===serial)setError(String(e));}
      finally{inFlight.current=false;}
    };
    void update();const timer=window.setInterval(()=>void update(),2000);
    return()=>{generation.current++;window.clearInterval(timer);};
  },[visible]);
  const run=async(action:()=>Promise<Status>)=>{
    if(actionInFlight.current)return;
    actionInFlight.current=true;generation.current++;setBusy(true);setError('');
    try{apply(await action());}catch(e){if(mounted.current){try{const latest=await status();cached=latest;setData(latest);}catch{}setError(String(e));}}
    finally{actionInFlight.current=false;if(mounted.current)setBusy(false);}
  };
  const row=(text:string,onClick:()=>void,description?:string,disabled=false)=><PanelSectionRow><ButtonItem layout="below" disabled={busy||disabled} description={description} onClick={onClick}>{text}</ButtonItem></PanelSectionRow>;
  return <PanelSection title="Phone & web companion">
    <PanelSectionRow><div role="status" style={{padding:8,overflowWrap:'anywhere'}}>
      <strong>{busy?'Updating connection…':!data?'Checking companion service…':data.listening?'Companion server listening':'Companion server off'}</strong>
      {data?.listening&&<div>{data.self_test?.ok?'HTTPS self-test passed':data.self_test?.error||'HTTPS self-test has not passed'}</div>}
      {data?.self_test?.checked_at&&<div>Checked {new Date(data.self_test.checked_at*1000).toLocaleTimeString()}</div>}
    </div></PanelSectionRow>
    {(error||data?.error)&&<PanelSectionRow><div role="alert" style={{padding:8,color:'#ffb0a8',overflowWrap:'anywhere'}}>{error||data?.error}</div></PanelSectionRow>}
    {row(data?.listening?'Stop companion server':'Start companion server',()=>void run(()=>enable(!data?.listening)),'Enable access from Android or a browser on your home network.',!data)}
    {row('Refresh connection status',()=>void run(status))}
    {data?.listening&&<>
      {row('Test HTTPS connection',()=>void run(check),'Verifies a real HTTPS request to this plugin. Other devices must be on the same network; this does not test your router/firewall.')}
      <PanelSectionRow><div style={{padding:8,whiteSpace:'normal',overflowWrap:'anywhere'}}>
        <strong>Android machine address</strong>
        {(data.addresses||[]).map(a=><div key={a}>{a}</div>)}
        <div>{data.hostname}</div>
        <p>Browser address</p>
        {(data.web_urls||[]).map(a=><div key={a}>{a}</div>)}
        <p>Certificate SHA-256 fingerprint</p>
        <div>{data.fingerprint.toUpperCase().match(/.{1,4}/g)?.join(' ')}</div>
        <p>Compare this fingerprint in Android's pairing prompt or the browser's certificate details before trusting the connection.</p>
        {data.pairing_code&&<><strong>Pairing code: {data.pairing_code}</strong><div>Expires in {data.expires_in}s · one use per phone/browser</div></>}
      </div></PanelSectionRow>
      {row(data.pairing_code?'Create a new pairing code':'Pair a phone or browser',()=>void run(pair),'Open the address above, then enter this code. Pairing is remembered.')}
      {data.devices.length===0&&<PanelSectionRow><p>No devices paired yet.</p></PanelSectionRow>}
      {data.devices.map(device=><PanelSectionRow key={device.id}><div style={{padding:8,overflowWrap:'anywhere'}}>
        <strong>Paired: {device.name}</strong><div>{device.last_seen?`Last request: ${new Date(device.last_seen*1000).toLocaleTimeString()}`:'Waiting for the first authenticated request'}</div>
        <ButtonItem layout="below" disabled={busy} onClick={()=>{if(remove!==device.id){setRemove(device.id);return;}void run(()=>revoke(device.id));setRemove('');}}>{remove===device.id?`Confirm remove ${device.name}`:`Remove ${device.name}`}</ButtonItem>
      </div></PanelSectionRow>)}
    </>}
  </PanelSection>;
}
