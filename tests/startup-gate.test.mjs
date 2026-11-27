import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {probeThemeStartup,showThemeLoading} from '../packaging/payload/theme/startup-gate.mjs';

test('startup accepts a visible shell despite hidden first editor and active conversation',()=>{
  let now=0, shell=false;
  const context=vm.createContext({window:{},performance:{now:()=>now},document:{
    readyState:'loading',hidden:false,
    querySelectorAll:()=>[{getClientRects:()=>[]},...(shell?[{getClientRects:()=>[{}]}]:[])],
    body:{querySelector:()=>({})}
  }});
  const probe=()=>vm.runInContext(`(${probeThemeStartup})()`,context);
  assert.equal(probe(),'waiting');
  now=1000;context.document.readyState='interactive';assert.equal(probe(),'waiting');
  shell=true;assert.equal(probe(),'waiting');
  now+=349;assert.equal(probe(),'waiting');
  now+=1;assert.equal(probe(),'ready');
  context.document.hidden=true;assert.equal(probe(),'ready');
  context.window.__kenGlassPanel={};assert.equal(probe(),'mounted');
  context.window={};assert.equal(probe(),'waiting');
});

test('changed shell selectors fall back after four seconds once the document has controls',()=>{
  let now=0,content=false;
  const ctx=vm.createContext({window:{},performance:{now:()=>now},document:{readyState:'loading',querySelectorAll:()=>[],body:{querySelector:()=>content?{}:null}}});
  const probe=()=>vm.runInContext(`(${probeThemeStartup})()`,ctx);
  assert.equal(probe(),'waiting');now=3999;assert.equal(probe(),'waiting');
  ctx.document.readyState='complete';assert.equal(probe(),'waiting');content=true;assert.equal(probe(),'waiting');
  now=4000;assert.equal(probe(),'waiting');
  now+=350;assert.equal(probe(),'ready');
});

test('loading veil cannot intercept input and expires without host cleanup',()=>{
  let expiry,removed=false,appended=false;
  const veil={style:{},setAttribute(){},remove(){removed=true;}};
  vm.runInNewContext(`(${showThemeLoading})()`,{
    document:{getElementById:()=>null,createElement:()=>veil,body:{append(){appended=true;}}},
    setTimeout(fn,ms){assert.equal(ms,5000);expiry=fn;}
  });
  assert.ok(appended);assert.match(veil.style.cssText,/pointer-events:none/);
  expiry();assert.ok(removed);
});
