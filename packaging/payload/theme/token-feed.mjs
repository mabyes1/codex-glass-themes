import {open,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
export const TOKENS_PER_PELLET=10000;
export function foodTier(model='') {return /(?:^|-)astra(?:-|$)/i.test(model)?'astra':/(?:^|-)sol(?:-|$)/i.test(model)?'sol':/(?:^|-)terra(?:-|$)/i.test(model)?'terra':/(?:^|-)luna(?:-|$)/i.test(model)?'luna':'unknown';}
export function createUsageCounter(){
 const totals={astra:0,sol:0,terra:0,luna:0,unknown:0};
 return {consume(state,line,emit=true){
  let row;try{row=typeof line==='string'?JSON.parse(line):line}catch{return null;}
  if(row.type==='turn_context'&&typeof row.payload?.model==='string')state.model=row.payload.model;
  if(row.type!=='event_msg'||row.payload?.type!=='token_count')return null;
  const total=row.payload.info?.total_token_usage?.total_tokens;
  if(!Number.isSafeInteger(total)||total<0)return null;
  const delta=Math.max(0,total-(state.total??0));state.total=total;
  if(!emit||!delta)return null;
  const tier=foodTier(state.model);totals[tier]+=delta;
  return {tier,tokens:delta};
 },snapshot:()=>({totalTokens:Object.values(totals).reduce((a,b)=>a+b,0),byModel:{...totals},tokensPerPellet:TOKENS_PER_PELLET})};
}
// Only usage metadata crosses CDP. Prompts and responses stay in the local reader.
export function createTokenFeed(root){
 const files=new Map(),counter=createUsageCounter(),started=Date.now();let initialized=false,lastDiscovery=0,recentDays=[];
 async function discover(){
  if(initialized&&Date.now()-lastDiscovery<15000){
   const known=await Promise.all([...files.keys()].map(async path=>({path,info:await stat(path).catch(()=>null)})));
   const paths=new Set(known.map(x=>x.path));
   for(const day of recentDays)for(const name of await readdir(day).catch(()=>[])){
    const path=join(day,name);if(!/^rollout-.*\.jsonl$/.test(name)||paths.has(path))continue;
    const info=await stat(path).catch(()=>null);if(info&&info.mtimeMs>=started-86400000)known.push({path,info});
   }
   return known.filter(x=>x.info);
  }
  lastDiscovery=Date.now();
  const days=[];
  for(const y of (await readdir(root).catch(()=>[])).filter(x=>/^\d{4}$/.test(x)).sort())
   for(const m of (await readdir(join(root,y))).filter(x=>/^\d{2}$/.test(x)).sort())
    for(const d of (await readdir(join(root,y,m))).filter(x=>/^\d{2}$/.test(x)))days.push(join(root,y,m,d));
  recentDays=days.sort().slice(-3);
  const found=[];
  for(const day of days.sort())for(const name of await readdir(day))if(/^rollout-.*\.jsonl$/.test(name)){
   const path=join(day,name),info=await stat(path).catch(()=>null);
   if(info&&info.mtimeMs>=started-86400000)found.push({path,info});
  }
  return found.sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs).slice(0,128);
 }
 async function read(path,state,size,baseline,events,io){
  if(size===state.offset)return;
  io.filesRead++;
  const handle=await open(path,'r');
  try{
   if(size<state.offset){state.offset=0;state.partial=Buffer.alloc(0);state.total=0;state.model='';}
   // Bounded reads also preserve UTF-8 and JSON split across writes.
   let budget=baseline?size:2*1024*1024;
   while(state.offset<size&&budget>0){
    const buf=Buffer.alloc(Math.min(65536,size-state.offset,budget));
    const {bytesRead}=await handle.read(buf,0,buf.length,state.offset);if(!bytesRead)break;
    state.offset+=bytesRead;budget-=bytesRead;io.bytesRead+=bytesRead;
    const raw=Buffer.concat([state.partial,buf.subarray(0,bytesRead)]),end=raw.lastIndexOf(10);
    if(end<0){state.partial=raw.length>16*1024*1024?Buffer.alloc(0):raw;continue;}
    state.partial=end+1===raw.length?Buffer.alloc(0):Buffer.from(raw.subarray(end+1));
    for(const line of raw.subarray(0,end).toString('utf8').split('\n')){
     // Most log bytes are prompts/tool output. Do not parse those to count tokens.
     if(!/"type"\s*:\s*"(?:turn_context|token_count)"/.test(line))continue;
     let row;try{row=JSON.parse(line);io.recordsParsed++;}catch{continue;}
     // Existing history is baselined; newly discovered old sessions are too.
     let emit=!baseline;
     if(emit&&!state.live){try{state.live=Date.parse(row.timestamp)>=started;}catch{}}
     emit=emit&&state.live;
     const event=counter.consume(state,row,emit);if(event)events.push(event);
    }
   }
  }finally{await handle.close();}
 }
 return {async poll(){const events=[],io={filesRead:0,bytesRead:0,recordsParsed:0};let errors=0;
  for(const {path,info} of await discover()){
   let state=files.get(path);if(!state){state={offset:0,partial:Buffer.alloc(0),model:'',total:0,live:false};files.set(path,state);}
   try{await read(path,state,info.size,!initialized,events,io);}catch{errors++;}
  }
  initialized=true;
  return {...counter.snapshot(),events,source:'local-session-token-count',errors,io};
 }};
}
