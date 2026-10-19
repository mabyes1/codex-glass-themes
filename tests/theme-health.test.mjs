import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inspectThemeHealth} from '../packaging/payload/Theme-Health.mjs';
function inspect(diagnostics,present=true){
  return vm.runInNewContext(`(${inspectThemeHealth.toString()})()`,{
    window:{__kenGlassPanel:present?{getDiagnostics:()=>diagnostics,getState:()=>({mode:'aquarium'})}:undefined},
    document:{getElementById:id=>id==='ken-codex-glass'?{textContent:'x'.repeat(600)}:{shadowRoot:{getElementById:()=>({})}}}
  });
}
test('a mounted panel is not native acceptance while the window is missing or pending',()=>{
  for(const diagnostics of [{nativeFailed:true,nativePending:false},{nativeFailed:false,nativePending:true}]){
    const state=inspect(diagnostics);assert.equal(state.mounted,true);assert.equal(state.nativeReady,false);
  }
});
test('native acceptance requires explicit success and a mounted renderer panel',()=>{
  assert.equal(inspect({nativeFailed:false,nativePending:false}).nativeReady,true);
  const absent=inspect(undefined,false);assert.equal(absent.mounted,false);assert.equal(absent.nativeReady,false);
});
