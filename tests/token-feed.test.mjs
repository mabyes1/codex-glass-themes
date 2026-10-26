import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm,utimes,open,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUsageCounter,createTokenFeed,foodTier,BASELINE_BYTES,POLL_BYTES} from '../packaging/payload/theme/token-feed.mjs';
const context=model=>JSON.stringify({type:'turn_context',payload:{model}});
const usage=(total,timestamp=new Date().toISOString())=>JSON.stringify({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:total}}}});
test('model families, cumulative deltas, duplicate notifications and switches',()=>{
 const c=createUsageCounter(),s={};
 for(const tier of ['astra','sol','terra','luna'])assert.equal(foodTier(`gpt-6.1-${tier}`),tier);
 assert.equal(foodTier('other'),'unknown');
 c.consume(s,context('gpt-6-astra'));c.consume(s,usage(100),false);
 assert.deepEqual(c.consume(s,usage(120)),{tier:'astra',tokens:20});
 assert.equal(c.consume(s,usage(120)),null);
 c.consume(s,context('gpt-6-luna'));assert.deepEqual(c.consume(s,usage(130)),{tier:'luna',tokens:10});
 assert.equal(c.consume(s,'broken'),null);assert.equal(c.snapshot().totalTokens,30);
});

test('2.1 GiB session baselines only its tail, then restarts with zero history reads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feed-large-'));
 try{
  const day=join(root,'2026','10','26');await mkdir(day,{recursive:true});
  const path=join(day,'rollout-large.jsonl'),cursorPath=join(root,'runtime','cursors.json');
  const handle=await open(path,'w');
  const tail=Buffer.from('\n'+context('gpt-6-sol')+'\n'+usage(90000)+'\n');
  try{await handle.write(tail,0,tail.length,Math.ceil(2.1*1024**3));}finally{await handle.close();}
  let feed=createTokenFeed(root,{cursorPath});let result=await feed.poll();
  assert.equal(result.totalTokens,0);assert.equal(result.io.bytesRead,BASELINE_BYTES);
  await appendFile(path,usage(90050)+'\n');result=await feed.poll();assert.equal(result.totalTokens,50);
  const cached=JSON.parse(await readFile(cursorPath,'utf8'));assert.equal(cached.files[path].total,90050);
  feed=createTokenFeed(root,{cursorPath});result=await feed.poll();assert.equal(result.io.bytesRead,0);assert.equal(result.totalTokens,0);
  await appendFile(path,usage(90080)+'\n');result=await feed.poll();assert.equal(result.totalTokens,30);assert.equal(result.byModel.sol,30);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('session checkpoints survive split writes and baseline downtime without replay',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feed-restart-'));
 try{
  const day=join(root,'2026','10','26');await mkdir(day,{recursive:true});
  const a=join(day,'rollout-a.jsonl'),b=join(day,'rollout-b.jsonl'),cursorPath=join(root,'cursors.json');
  await writeFile(a,context('gpt-6-astra')+'\n'+usage(100)+'\n');
  await writeFile(b,context('gpt-6-luna')+'\n'+usage(500)+'\n');
  let feed=createTokenFeed(root,{cursorPath});await feed.poll();
  const next=usage(130)+'\n';await appendFile(a,next.slice(0,31));await feed.poll();
  feed=createTokenFeed(root,{cursorPath});await feed.poll();
  await appendFile(a,next.slice(31));await appendFile(b,usage(550)+'\n');
  let result=await feed.poll();assert.equal(result.byModel.astra,0);assert.equal(result.byModel.luna,50);
  await appendFile(a,usage(160)+'\n');assert.equal((await feed.poll()).byModel.astra,30);
  await appendFile(a,usage(200)+'\n'); // Helper was offline when these tokens arrived.
  feed=createTokenFeed(root,{cursorPath});result=await feed.poll();assert.equal(result.totalTokens,0);
  await appendFile(a,usage(210)+'\n');assert.equal((await feed.poll()).byModel.astra,10);
  await writeFile(cursorPath,'broken checkpoint');
  feed=createTokenFeed(root,{cursorPath});result=await feed.poll();assert.equal(result.errors,0);assert.equal(result.totalTokens,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('many sessions share a 2 MiB poll budget; oversized tool lines stay bounded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feed-budget-'));
 try{
  const day=join(root,'2026','10','26');await mkdir(day,{recursive:true});
  for(let i=0;i<12;i++)await writeFile(join(day,`rollout-${i}.jsonl`),'x'.repeat(BASELINE_BYTES)+'\n'+context('gpt-6-sol')+'\n'+usage(100)+'\n');
  const feed=createTokenFeed(root);
  for(let i=0;i<3;i++){const result=await feed.poll();assert.ok(result.io.bytesRead<=POLL_BYTES);assert.equal(result.totalTokens,0);}
  const path=join(day,'rollout-0.jsonl');
  await appendFile(path,'x'.repeat(POLL_BYTES*2+100)+'\n'+usage(120)+'\n');
  let result;for(let i=0;i<4;i++){result=await feed.poll();assert.ok(result.io.bytesRead<=POLL_BYTES);}
  assert.equal(result.totalTokens,20);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('missing tail metadata suppresses historical totals; replaced sessions reject stale cursors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feed-missing-'));
 try{
  const day=join(root,'2026','10','26');await mkdir(day,{recursive:true});
  const path=join(day,'rollout-a.jsonl'),cursorPath=join(root,'cursors.json');
  await writeFile(path,context('gpt-6-sol')+'\n'+usage(100000)+'\n'+'x'.repeat(BASELINE_BYTES*2)+'\n');
  let feed=createTokenFeed(root,{cursorPath});await feed.poll();
  await appendFile(path,context('gpt-6-astra')+'\n'+usage(100100)+'\n');assert.equal((await feed.poll()).totalTokens,0);
  await appendFile(path,usage(100110)+'\n');assert.equal((await feed.poll()).byModel.astra,10);
  await rm(path);await writeFile(path,context('gpt-6-luna')+'\n'+usage(5)+'\n');
  feed=createTokenFeed(root,{cursorPath});assert.equal((await feed.poll()).totalTokens,0);
  await appendFile(path,usage(8)+'\n');assert.equal((await feed.poll()).byModel.luna,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('reader baselines history, retains split writes and finds new sessions without replay',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-feed-'));
 try{
  const day=join(root,'2026','10','23');await mkdir(day,{recursive:true});const path=join(day,'rollout-a.jsonl');
  await writeFile(path,context('gpt-6-sol')+'\n'+usage(90000)+'\n');
  const feed=createTokenFeed(root);assert.equal((await feed.poll()).totalTokens,0);
  const line=usage(110000)+'\n';await appendFile(path,line.slice(0,30));assert.equal((await feed.poll()).events.length,0);
  await appendFile(path,line.slice(30));let result=await feed.poll();assert.equal(result.totalTokens,20000);assert.equal(result.events[0].tier,'sol');
  await appendFile(path,usage(110000)+'\n');assert.equal((await feed.poll()).totalTokens,20000);
  const next=join(day,'rollout-b.jsonl');await writeFile(next,context('gpt-6-luna')+'\n'+usage(30000)+'\n');
  result=await feed.poll();assert.equal(result.totalTokens,50000);assert.equal(result.byModel.luna,30000);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('idle polls skip cold history and unchanged files; tool text is not parsed for usage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'feed-io-'));
 try{
  const day=join(root,'2026','10','23');await mkdir(day,{recursive:true});
  const cold=join(day,'rollout-cold.jsonl'),hot=join(day,'rollout-hot.jsonl');
  await writeFile(cold,context('gpt-6-luna')+'\n'+usage(999999)+'\n');
  const old=new Date(Date.now()-3*86400000);await utimes(cold,old,old);
  await writeFile(hot,context('gpt-6-sol')+'\n'+usage(100)+'\n');
  const feed=createTokenFeed(root);await feed.poll();
  let r=await feed.poll();assert.deepEqual(r.io,{filesRead:0,bytesRead:0,recordsParsed:0});
  await appendFile(hot,JSON.stringify({type:'response_item',payload:{content:'tool output '.repeat(50000)}})+'\n'+usage(120)+'\n');
  r=await feed.poll();assert.equal(r.totalTokens,20);assert.equal(r.io.filesRead,1);assert.equal(r.io.recordsParsed,1);
  await writeFile(hot,context('gpt-6-luna')+'\n'+usage(5)+'\n');
  r=await feed.poll();assert.equal(r.byModel.luna,5);
 }finally{await rm(root,{recursive:true,force:true});}
});
