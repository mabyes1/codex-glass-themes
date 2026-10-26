import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

const moduleUrl=new URL('../packaging/payload/theme/host-lease.mjs',import.meta.url).href;
const code=`
 const {acquireHostLease}=await import(process.argv[2]);
 const lease=await acquireHostLease(process.argv[1]);
 if(!lease){process.send({owner:false});process.disconnect();}
 else {
  if(process.argv[3]==='fail')throw Error('fixture initialization failure');
  process.send({owner:true,pid:process.pid});
  const timer=setInterval(()=>{},1000);
  process.on('message',async()=>{clearInterval(timer);await lease.release();process.disconnect();});
 }
`;
function launch(runtime,mode=''){
 const child=spawn(process.execPath,['--input-type=module','-e',code,runtime,moduleUrl,mode],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 child.stderr.resume();
 child.done=once(child,'exit');
 child.result=new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>resolve(null));});
 return child;
}
test('20 simultaneous slow initializations leave one owner and cannot overwrite its PID',async()=>{
 const runtime=await mkdtemp(join(tmpdir(),'glass-lease-')),children=[];
 try{
  for(let i=0;i<20;i++)children.push(launch(runtime));
  const results=await Promise.all(children.map(child=>child.result));
  const owners=results.filter(result=>result?.owner);assert.equal(owners.length,1);
  assert.equal(await readFile(join(runtime,'host.pid'),'utf8'),String(owners[0].pid));
  const owner=children.find(child=>child.pid===owners[0].pid);owner.send('stop');await owner.done;
  await assert.rejects(access(join(runtime,'host.pid')));
  const next=launch(runtime);children.push(next);assert.equal((await next.result).owner,true);next.send('stop');await next.done;
 }finally{for(const child of children){if(child.exitCode===null)child.kill();await child.done;}await rm(runtime,{recursive:true,force:true});}
});
test('crash releases the OS lock, stale PID recovers, and startup exceptions clean up',async()=>{
 const runtime=await mkdtemp(join(tmpdir(),'glass-crash-')),children=[];
 try{
  const first=launch(runtime);children.push(first);assert.equal((await first.result).owner,true);first.kill('SIGKILL');await first.done;
  const second=launch(runtime);children.push(second);assert.equal((await second.result).owner,true);
  assert.equal(await readFile(join(runtime,'host.pid'),'utf8'),String(second.pid));second.send('stop');await second.done;
  const failed=launch(runtime,'fail');children.push(failed);assert.equal((await failed.done)[0],1);
  await assert.rejects(access(join(runtime,'host.pid')));
  const recovered=launch(runtime);children.push(recovered);assert.equal((await recovered.result).owner,true);recovered.send('stop');await recovered.done;
 }finally{for(const child of children){if(child.exitCode===null)child.kill();await child.done;}await rm(runtime,{recursive:true,force:true});}
});
