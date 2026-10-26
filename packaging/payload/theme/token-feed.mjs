import {open,readdir,stat,readFile,writeFile,rename,unlink,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
export const TOKENS_PER_PELLET=10000;
export const BASELINE_BYTES=256*1024;
export const POLL_BYTES=2*1024*1024;
export function foodTier(model='') {return /(?:^|-)astra(?:-|$)/i.test(model)?'astra':/(?:^|-)sol(?:-|$)/i.test(model)?'sol':/(?:^|-)terra(?:-|$)/i.test(model)?'terra':/(?:^|-)luna(?:-|$)/i.test(model)?'luna':'unknown';}
export function createUsageCounter(){
 const totals={astra:0,sol:0,terra:0,luna:0,unknown:0};
 return {consume(state,line,emit=true){
  let row;try{row=typeof line==='string'?JSON.parse(line):line}catch{return null;}
  if(row.type==='turn_context'&&typeof row.payload?.model==='string')state.model=row.payload.model;
  if(row.type!=='event_msg'||row.payload?.type!=='token_count')return null;
  const total=row.payload.info?.total_token_usage?.total_tokens;
  if(!Number.isSafeInteger(total)||total<0)return null;
  const delta=Math.max(0,total-(state.total??0));state.total=total;state.hasTotal=true;
  const suppress=state.suppressNextTotal;state.suppressNextTotal=false;
  if(!emit||suppress||!delta)return null;
  const tier=foodTier(state.model);totals[tier]+=delta;
  return {tier,tokens:delta};
 },snapshot:()=>({totalTokens:Object.values(totals).reduce((a,b)=>a+b,0),byModel:{...totals},tokensPerPellet:TOKENS_PER_PELLET})};
}
// Only usage metadata crosses CDP. Prompts and responses stay in the local reader.
export function createTokenFeed(root,{cursorPath}={}){
 const files=new Map(),counter=createUsageCounter(),started=Date.now();let initialized=false,lastDiscovery=0,recentDays=[];
 let saved={},loaded=false,lastSaved='';
 const identity=info=>`${info.dev}:${info.ino}:${info.birthtimeMs}`;
 async function load(){
  if(loaded)return;loaded=true;
  if(!cursorPath)return;
  try{
   if((await stat(cursorPath)).size>2*1024*1024)return;
   const data=JSON.parse(await readFile(cursorPath,'utf8'));
   if(data.version===1&&data.root===resolve(root)&&data.files&&typeof data.files==='object')saved=data.files;
  }catch{} // Missing or interrupted checkpoints fall back to bounded tail baselines.
 }
 async function checkpoint(){
  if(!cursorPath)return;
  const entries=[...files].slice(-128).map(([path,s])=>[path,{
   identity:s.identity,offset:s.offset-s.partial.length,model:s.model,total:s.total,hasTotal:!!s.hasTotal,
   discarding:!!s.discarding,suppressNextTotal:!!s.suppressNextTotal,mtimeMs:s.mtimeMs
  }]);
  const data=JSON.stringify({version:1,root:resolve(root),files:Object.fromEntries(entries)});
  if(data===lastSaved)return;
  const temp=`${cursorPath}.${process.pid}.tmp`;
  try{
   await mkdir(dirname(cursorPath),{recursive:true});await writeFile(temp,data);await rename(temp,cursorPath);lastSaved=data;
  }finally{await unlink(temp).catch(()=>{});}
 }
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
  if(size===state.offset||io.bytesRead>=POLL_BYTES)return;
  io.filesRead++;
  const handle=await open(path,'r');
  try{
   if(size<state.offset){state.offset=0;state.partial=Buffer.alloc(0);state.total=0;state.model='';state.discarding=false;state.suppressNextTotal=false;}
   // Bounded reads also preserve UTF-8 and JSON split across writes.
   let budget=POLL_BYTES-io.bytesRead;
   while(state.offset<size&&budget>0){
    const buf=Buffer.alloc(Math.min(65536,size-state.offset,budget));
    const {bytesRead}=await handle.read(buf,0,buf.length,state.offset);if(!bytesRead)break;
    state.offset+=bytesRead;budget-=bytesRead;io.bytesRead+=bytesRead;
    let chunk=buf.subarray(0,bytesRead);
    if(state.discarding){const first=chunk.indexOf(10);if(first<0)continue;chunk=chunk.subarray(first+1);state.discarding=false;}
    const raw=Buffer.concat([state.partial,chunk]),end=raw.lastIndexOf(10);
    if(end<0){state.discarding=raw.length>BASELINE_BYTES;state.partial=state.discarding?Buffer.alloc(0):raw;continue;}
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
  await load();
  for(const {path,info} of await discover()){
   let state=files.get(path);
   if(state&&state.identity!==identity(info)){files.delete(path);state=null;}
   if(!state){
    // Windows creation timestamps can lag Date.now() slightly for a new file.
    const baseline=!initialized||info.birthtimeMs<started-1000;
    const cached=saved[path];
    const reusable=baseline&&cached&&cached.identity===identity(info)&&Number.isSafeInteger(cached.offset)&&cached.offset>=0&&cached.offset<=info.size&&
     Number.isSafeInteger(cached.total)&&cached.total>=0&&typeof cached.model==='string'&&cached.model.length<256&&
     (cached.offset<info.size||cached.mtimeMs===info.mtimeMs);
    const offset=reusable?cached.offset:baseline?Math.max(0,info.size-BASELINE_BYTES):0;
    state={offset,partial:Buffer.alloc(0),model:'',total:0,live:false,discarding:offset>0,baselineEnd:baseline?info.size:null};
    if(reusable)Object.assign(state,{model:cached.model,total:cached.total,hasTotal:cached.hasTotal,discarding:cached.discarding,suppressNextTotal:cached.suppressNextTotal});
    files.set(path,state);
   }
   state.identity=identity(info);state.mtimeMs=info.mtimeMs;
   try{
    if(state.baselineEnd!==null){
     // Snapshot the startup end, even if this file waits for the next poll's budget.
     const end=Math.min(state.baselineEnd,info.size);
     if(end<state.offset){state.offset=0;state.discarding=false;}
     await read(path,state,end,true,events,io);
     if(state.offset===end){state.baselineEnd=null;state.suppressNextTotal=!state.hasTotal;}
    }else await read(path,state,info.size,false,events,io);
   }catch{errors++;}
  }
  initialized=true;
  try{await checkpoint();}catch{errors++;}
  return {...counter.snapshot(),events,source:'local-session-token-count',errors,io};
 }};
}
