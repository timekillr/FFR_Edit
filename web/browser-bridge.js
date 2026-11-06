'use strict';
if (!window.ForgeNative) {
  window.ForgeNative={request(id,action,text){
    (async()=>{
      const args=JSON.parse(text);let path=action,method='GET',body;
      if(action==='cancel_reads')return {};
      if(action==='permission')path='settings';
      if(action==='forget'){path='unpair';method='POST';body={};}
      if(action==='pair'){method='POST';body={code:args.code,device_name:'FFR web browser'};}
      if(action==='command'){method='POST';body={...args,request_id:Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('')};}
      if(!['settings','pair','unpair','ping','state','command'].includes(path))throw Error('Unsupported request');
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),action==='command'?60000:Math.max(1,Math.min(8000,args.timeout_ms||8000)));
      try{
        const response=await fetch('/web-api/'+path,{method,headers:{'X-FFR-Edit-Web':'1',...(method==='POST'?{'Content-Type':'application/json'}:{})},credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();if(!result.ok)throw Error(result.error);return result.data;
      }finally{clearTimeout(timer);}
    })().then(data=>window.ForgeReply(id,{ok:true,data}),e=>window.ForgeReply(id,{ok:false,error:e.message}));
  }};
  document.getElementById('endpoint').value=location.host;
  document.getElementById('endpoint').closest('label').hidden=true;
}
