import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCosmosLayer} from '../packaging/payload/theme/cosmos.mjs';

function fixture(){
  const events=new Map(),mediaEvents=new Map(),timers=new Map(),images=[],children=[];
  let now=1,id=0,observers=0;
  const gradient={addColorStop(){}};
  const context=new Proxy({}, {get:(object,key)=>key.startsWith('create')?()=>gradient:()=>{},set:()=>true});
  const media={matches:false,addEventListener:(n,f)=>mediaEvents.set(n,f),removeEventListener:n=>mediaEvents.delete(n)};
  const document={hidden:false,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),createElement:()=>({width:0,height:0,dataset:{},style:{},setAttribute(){},getContext:()=>context,remove(){children.splice(children.indexOf(this),1);}})};
  const scope=vm.createContext({window:{matchMedia:()=>media},document,
    Image:class{constructor(){this.naturalWidth=1672;this.naturalHeight=941;images.push(this);}},
    ResizeObserver:class{observe(){observers++;}disconnect(){observers--; }},performance:{now:()=>now},
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  const layer=vm.runInContext(`(${createCosmosLayer.toString()})`,scope)({append:c=>children.push(c),getBoundingClientRect:()=>({width:7680,height:4320})},'galaxy-fixture');
  return {layer,document,media,events,mediaEvents,timers,images,children,observers:()=>observers,
    tick(){const [key,timer]=timers.entries().next().value;timers.delete(key);now+=timer.delay;timer.fn();}};
}
test('repeated activation reuses one bounded canvas, one timer, and release raster storage when inactive',()=>{
  const s=fixture();assert.equal(s.children.length,0);
  for(let i=0;i<4;i++){
    s.layer.setActive(true,true);const d=s.layer.getDiagnostics();
    assert.equal(d.scene,'galaxy');assert.equal(s.children.length,1);assert.equal(s.timers.size,1);
    assert.ok(d.canvasWidth<=960&&d.canvasHeight<=640&&d.rasterMiB<=4.69);
    for(let i=0;i<10;i++)s.tick();assert.equal(s.timers.size,1);
    assert.ok(s.timers.values().next().value.delay>=1000/18);
  }
  s.layer.setActive(false);assert.equal(s.timers.size,0);assert.equal(s.children.length,0);
  assert.equal(s.layer.getDiagnostics().rasterMiB,0);assert.equal(s.observers(),0);
  s.layer.dispose();assert.equal(s.events.size,0);assert.equal(s.mediaEvents.size,0);
});
test('pause, hidden document, and reduced motion stop the clock without duplicate loops',()=>{
  const s=fixture();s.layer.setActive(true);s.layer.setActive(true,false);
  const still=s.layer.getDiagnostics().frames;s.layer.setActive(true,false);
  assert.equal(s.layer.getDiagnostics().frames,still);assert.equal(s.timers.size,0);
  s.layer.setActive(true);s.document.hidden=true;s.events.get('visibilitychange')();assert.equal(s.timers.size,0);
  s.document.hidden=false;s.events.get('visibilitychange')();assert.equal(s.timers.size,1);
  s.media.matches=true;s.mediaEvents.get('change')();assert.equal(s.timers.size,0);
  s.media.matches=false;s.mediaEvents.get('change')();assert.equal(s.timers.size,1);
  s.layer.dispose();assert.equal(s.timers.size,0);
});
test('late galaxy decodes cannot repaint an inactive scene or restart a disposed layer',()=>{
  const s=fixture();s.layer.setActive(true);const old=s.images[0],loaded=old.onload;
  s.layer.setActive(false);const frames=s.layer.getDiagnostics().frames;loaded();
  assert.equal(s.layer.getDiagnostics().frames,frames);assert.equal(s.layer.getDiagnostics().imageReady,false);assert.equal(old.src,'');
  s.layer.setActive(true);const final=s.images.at(-1).onload;s.layer.dispose();final();
  assert.equal(s.timers.size,0);assert.equal(s.layer.getDiagnostics().imageReady,false);
});
