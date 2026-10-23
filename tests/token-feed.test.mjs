import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createUsageCounter,createTokenFeed,foodTier} from '../packaging/payload/theme/token-feed.mjs';
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
