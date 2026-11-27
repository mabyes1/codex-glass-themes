import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const host=await readFile(new URL('../packaging/payload/theme/theme-host.mjs',import.meta.url),'utf8');
const upload=host.slice(host.indexOf('async function publishAsset('),host.indexOf('async function prepareTheme('));
test('image transfer yields between bounded chunks and preserves exact decoded bytes',async()=>{
  const data=Buffer.from(Array.from({length:700000},(_,i)=>i%251));
  const renderer=vm.createContext({window:{__kenGlassAssetURLs:[]},Uint8Array,atob,Blob,URL});
  const lengths=[],delays=[];
  const ctx=vm.createContext({performance,startupTiming:null,readFile:async()=>data,join:()=>'',dir:'',
    sleep:async ms=>delays.push(ms),
    call:async(method,params)=>{lengths.push(params.expression.length);return {result:{value:vm.runInContext(params.expression,renderer)}};}
  });
  const url=await vm.runInContext(`${upload};publishAsset('test.png')`,ctx);
  try{
    assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()),data);
    assert.equal(delays.length,4);assert.ok(delays.every(ms=>ms===5));
    assert.ok(Math.max(...lengths)<263000);
  }finally{URL.revokeObjectURL(url);}
});
