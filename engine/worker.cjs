// Thin adapter around the MIT upstream parser; never receives filesystem paths.
const F = require('../vendor/ffrs-save.cjs');
const {decryptSave, encryptSave} = require('../vendor/save-crypto.cjs');
const names = require('../vendor/data/names_en.json');
const progression = require('../vendor/data/progression.json');
const equipment = require('../vendor/data/equipment.json');
const items = require('../vendor/data/items.json');
function value(b,f) {
  if (f.kind === 'Int64Property') return new DataView(b.buffer,b.byteOffset,b.byteLength).getBigInt64(f.off,true).toString();
  const v=F.getField(b,f); if(!Number.isFinite(v)) throw Error('Non-finite save value'); return String(v);
}
function number(b,f,v) {
  if(f.kind==='Int64Property') {
    if(!/^-?\d+$/.test(String(v))) throw Error('Enter a whole number');
    const n=BigInt(v); if(n<-(1n<<63n)||n>=(1n<<63n)) throw Error('64-bit value out of range');
    new DataView(b.buffer,b.byteOffset,b.byteLength).setBigInt64(f.off,n,true);
  } else {if(!Number.isFinite(Number(v))) throw Error('Enter a finite number'); F.setField(b,f,v);}
}
function section(path) {
  if(path.startsWith('unitParameterList')) return 'Characters';
  if(path.startsWith('visionList')) return 'Visions';
  if(path.startsWith('inventory')) return 'Inventory';
  if(path.startsWith('artifactList')) return 'Artifacts';
  if(/^Map\./.test(path)) return 'Maps';
  if(/quest|scenario|story|request|colosseum/i.test(path)) return 'Journal';
  if(/enemy|monster|bestiary/i.test(path)) return 'Bestiary';
  if(path.startsWith('Player.')) return 'Records';
  return 'Other';
}
function describe(path,b,p) {
  const get=k=>p.fields.has(k)?value(b,p.fields.get(k)):'';
  let label=path, m;
  if((m=/^unitParameterList\[(\d+)\]/.exec(path))) label=path.replace(m[0], names['unit:'+get(m[0]+'.UnitId')]||m[0]);
  if((m=/^visionList\[(\d+)\]/.exec(path))) {
    label=path.replace(m[0],names['vis:'+get(m[0]+'.ID')]||m[0]);
    const q=/synchroPoints\{\d+\}/.exec(path);
    if(q) label=label.replace(q[0],(names['unit:'+get(m[0]+'.'+q[0]+'.key')]||q[0])+' MRP');
  }
  if((m=/^inventory\[(\d+)\]/.exec(path))) label=path.replace(m[0],names['item:'+get(m[0]+'.ItemId')]||m[0]);
  return label.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\./g,' · ');
}
const readonly=path=>/(?:\.key|\.ID|\.UnitId|\.ItemId)$/.test(path)||/story|scenario/i.test(path);
function snapshot(b,p) {
  const fields=[];
  for(const [path,f] of p.fields) fields.push({path,kind:f.kind,value:value(b,f),section:section(path),label:describe(path,b,p),readonly:readonly(path)});
  for(const [path,v] of p.bools) fields.push({path,kind:'bool',value:v,section:section(path),label:describe(path,b,p),readonly:readonly(path)});
  for(const [path,v] of p.strings) fields.push({path,kind:'text',value:v,section:section(path),label:describe(path,b,p),readonly:true});
  for(const [path,off] of p.vectors) fields.push({path,kind:'vector',value:JSON.stringify(F.getVector(b,off)),section:section(path),label:describe(path,b,p),readonly:false});
  return {fields, items:[...equipment,...items].map(e=>({id:e.id,name:e.name,kind:e.kind})), warnings:['Close Final Fantasy Resonance before saving or restoring. Steam Cloud can replace local changes.','Changing EXP/MRP may require the game to recalculate levels, abilities or stats. Test a spare slot.']};
}
function run(req) {
  const raw=Buffer.from(req.raw,'base64');
  const {header,plain}=decryptSave(raw); let b=new Uint8Array(plain), p=F.parse(b);
  if(!p.fields.has('Player.currentMoney')||p.end>b.length) throw Error('Unrecognized or incomplete save layout');
  if(!encryptSave(header,plain).equals(raw)) throw Error('Save does not round-trip');
  if(req.action==='inspect') return snapshot(b,p);
  if(req.action!=='edit') throw Error('Unknown operation');
  if(!Array.isArray(req.edits)||req.edits.length>10000) throw Error('Invalid edit list');
  for(const edit of req.edits) {
    const {path,v}=edit;
    if(typeof path!=='string'||readonly(path)) throw Error('Read-only field: '+path);
    if(p.fields.has(path)) number(b,p.fields.get(path),v);
    else if(p.boolRefs.has(path)) {if(typeof v!=='boolean') throw Error('Boolean required'); F.setBool(b,p.boolRefs.get(path),v);}
    else if(p.vectors.has(path)) F.setVector(b,p.vectors.get(path),JSON.parse(v));
    else throw Error('Unknown editable field: '+path);
  }
  if(!Array.isArray(req.operations||[]) || (req.operations||[]).length>1000) throw Error('Invalid quick action list');
  for(const op of req.operations||[]) {
    if(op.type==='item') {
      if(![...equipment,...items].some(e=>e.id===op.id)||!Number.isInteger(op.quantity)||op.quantity<0||op.quantity>99) throw Error('Choose a known item and quantity 0–99');
      b=F.addInventoryItem(b,op.id,op.quantity);
    } else if(op.type==='max_mastery') {
      for(const [path,f] of p.fields) {
        const m=/^(visionList\[\d+\])\.synchroPoints\{\d+\}\.value$/.exec(path); if(!m) continue;
        const id=F.getField(b,p.fields.get(m[1]+'.ID')), curve=progression.masteryMrp[id];
        if(curve) number(b,f,curve.at(-1));
      }
    } else if(op.type==='awaken') {
      for(const [path,f] of p.fields) if(/^visionList\[\d+\]\.awakeningPoint$/.test(path)) number(b,f,progression.awakeningMax||3);
    } else throw Error('Unknown quick action');
    p=F.parse(b);
  }
  p=F.parse(b); if(!p.fields.has('Player.currentMoney')||p.end>b.length) throw Error('Edited save failed validation');
  const out=encryptSave(header,Buffer.from(b));
  const check=decryptSave(out); if(!check.plain.equals(Buffer.from(b))) throw Error('Encrypted save verification failed');
  return {raw:out.toString('base64')};
}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;if(input.length>48000000)process.exit(2);});
process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify({ok:true,data:run(JSON.parse(input))}));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}});
module.exports={run};
