'use strict';
if (!window.ForgeNative) {
  const reads=new Set();
  window.ForgeNative={request(id,action,text){
    (async()=>{
      const args=JSON.parse(text);let path=action,method='GET',body;
      if(action==='cancel_reads'){for(const read of reads)read.abort();return {};}
      if(action==='permission')path='settings';
      if(action==='forget'){path='unpair';method='POST';body={};}
      if(action==='pair'){method='POST';body={code:args.code,device_name:'FFR web browser'};}
      if(action==='command'){method='POST';body={...args,request_id:Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('')};}
      if(!['settings','pair','unpair','ping','state','command'].includes(path))throw Error('Unsupported request');
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),action==='command'?60000:Math.max(1,Math.min(8000,args.timeout_ms||8000)));
      const read=method==='GET';if(read)reads.add(controller);
      try{
        const response=await fetch('/web-api/'+path,{method,headers:{'X-FFR-Edit-Web':'1',...(method==='POST'?{'Content-Type':'application/json'}:{})},credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();if(!result.ok){const error=Error(result.error);error.status=response.status;throw error;}return result.data;
      }finally{clearTimeout(timer);reads.delete(controller);}
    })().then(data=>window.ForgeReply(id,{ok:true,data}),e=>window.ForgeReply(id,{ok:false,error:e.message,status:e.status||0}));
  }};
  document.getElementById('endpoint').value=location.host;
  document.getElementById('endpoint').closest('label').hidden=true;
}
