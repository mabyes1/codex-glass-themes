import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual host request/repair handlers with a controlled window lifecycle.
// No Codex process, PowerShell, DWM, or wall-clock sleeps are used here.
const source=await readFile(new URL('../packaging/payload/theme/theme-host.mjs',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('function onNative('),source.indexOf('function backdropRepaired('))+
  source.slice(source.indexOf('async function checkBackdrop('),source.indexOf('async function connect('));
function fixture({permanent=false}={}){
  const timers=new Map(),calls=[],renderer=[],watched=[];let nextId=0,ready=false;
  const scope=vm.createContext({console:{error(){}},
    setTimeout:(fn,delay)=>{timers.set(++nextId,{fn,delay});return nextId;},clearTimeout:id=>timers.delete(id),
    native:async mode=>{calls.push(mode);if(mode==='background'&&!ready)throw Error(permanent?'Windows rejected the requested material':'Codex main window was not found.');return {handle:42};},
    call:async(method,params)=>{if(method==='Runtime.evaluate')renderer.push(params.expression);},
    backdropWatch:{off(){},watch:(...args)=>watched.push(args),check(){}}
  });
  vm.runInContext(`let nativeQueue=Promise.resolve(),nativeRevision=0,stopping=false,nativeWanted=null,nativeRetryTimer=null,nativeFailures=0,nativeFailed=false,nativePending=false;const socket={readyState:1};${handlers}`,scope);
  const drain=()=>vm.runInContext('nativeQueue',scope);
  return {timers,calls,renderer,watched,ready(){ready=true;},
    async request(mode='background'){vm.runInContext(`onNative(JSON.stringify({mode:${JSON.stringify(mode)},opacity:100,blur:true}))`,scope);await drain();},
    async focus(){await vm.runInContext(`checkBackdrop('check')`,scope);await drain();},
    async tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await drain();},
    stop(){vm.runInContext('stopping=true',scope);},failed:()=>vm.runInContext('nativeFailed',scope)};
}
test('window appearing after first injection recovers automatically without a theme toggle',async()=>{
  const f=fixture();await f.request();assert.equal(f.failed(),true);assert.equal(f.timers.size,1);
  f.ready();await f.tick();assert.deepEqual(f.calls,['background','restore','background']);
  assert.deepEqual(f.watched,[[42,3]]);assert.equal(f.failed(),false);assert.equal(f.timers.size,0);
  assert.ok(f.renderer.some(s=>s.includes('NativeResult?.(true')));
});
test('focus replays a failed request even though the native watcher was turned off',async()=>{
  const f=fixture();await f.request();f.ready();await f.focus();
  assert.equal(f.failed(),false);assert.deepEqual(f.watched,[[42,3]]);assert.equal(f.timers.size,0);
});
test('restoring original appearance cancels a pending startup recovery',async()=>{
  const f=fixture();await f.request();await f.request('restore');
  assert.equal(f.timers.size,0);assert.deepEqual(f.calls,['background','restore','restore']);assert.equal(f.failed(),false);
});
test('startup retry budget is bounded; a later focus can recover a window that appeared much later',async()=>{
  const f=fixture();await f.request();for(let i=0;i<5;i++)await f.tick();
  assert.equal(f.timers.size,0);assert.equal(f.calls.filter(mode=>mode==='background').length,6);
  f.ready();await f.focus();assert.equal(f.failed(),false);assert.equal(f.timers.size,0);
});
test('permanent native failures are reported without a background retry loop',async()=>{
  const f=fixture({permanent:true});await f.request();assert.equal(f.failed(),true);assert.equal(f.timers.size,0);
});
test('stopping during a recovery delay cannot reapply the background',async()=>{
  const f=fixture();await f.request();f.stop();f.ready();await f.tick();
  assert.deepEqual(f.calls,['background','restore']);assert.equal(f.timers.size,0);
});
