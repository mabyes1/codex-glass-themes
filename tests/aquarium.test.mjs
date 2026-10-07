import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAquariumLayer} from '../packaging/payload/theme/aquarium.mjs';

function scene() {
  const events=new Map(), mediaEvents=new Map(), timers=new Map(), children=[];
  let now=1, id=0, removed=0, observed=0;
  const context={translate(){},scale(){},rotate(){},clearRect(){},save(){},restore(){},drawImage(){},fill(){},beginPath(){},arc(){},stroke(){},createLinearGradient:()=>({addColorStop(){}})};
  const media={matches:false,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:name=>mediaEvents.delete(name)};
  const document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    createElement:()=>({width:0,height:0,dataset:{},style:{},setAttribute(){},getContext:()=>context,remove(){removed++;}})};
  const scope=vm.createContext({window:{matchMedia:()=>media},document,
    Path2D:class {},ResizeObserver:class {observe(){observed++;}disconnect(){observed--; }},
    performance:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  const container={append:child=>children.push(child),getBoundingClientRect:()=>({width:7680,height:4320})};
  const layer=vm.runInContext(`(${createAquariumLayer.toString()})`,scope)(container);
  return {layer,timers,children,document,media,events,mediaEvents,
    tick(){const [key,timer]=timers.entries().next().value;timers.delete(key);now+=timer.delay;timer.fn();},
    counters:()=>({removed,observed})};
}

test('aquarium caps its raster size and frame cadence, and leaves no timer outside its mode',()=>{
  const s=scene();assert.equal(s.children.length,0);assert.equal(s.timers.size,0);
  s.layer.setActive(true);assert.equal(s.children.length,1);assert.equal(s.timers.size,1);
  assert.ok(s.timers.values().next().value.delay>=1000/18);
  const d=s.layer.getDiagnostics();assert.ok(d.canvasWidth<=960);assert.ok(d.canvasHeight<=640);
  for(let i=0;i<4;i++)s.tick();assert.equal(s.timers.size,1);
  s.layer.setActive(false);assert.equal(s.timers.size,0);assert.equal(s.children[0].hidden,true);
  s.layer.dispose();assert.equal(s.events.size,0);assert.equal(s.mediaEvents.size,0);
  assert.deepEqual(s.counters(),{removed:1,observed:0});
});

test('hidden windows, pause, and reduced motion stop rendering and resume without duplicate loops',()=>{
  const s=scene();s.layer.setActive(true);
  s.document.hidden=true;s.events.get('visibilitychange')();
  assert.equal(s.timers.size,0);const frames=s.layer.getDiagnostics().frames;
  s.layer.setActive(true);assert.equal(s.layer.getDiagnostics().frames,frames);
  s.document.hidden=false;s.events.get('visibilitychange')();assert.equal(s.timers.size,1);
  s.layer.setActive(true,false);assert.equal(s.timers.size,0);
  s.layer.setActive(true,true);assert.equal(s.timers.size,1);
  s.media.matches=true;s.mediaEvents.get('change')();assert.equal(s.timers.size,0);
  s.media.matches=false;s.mediaEvents.get('change')();assert.equal(s.timers.size,1);
  s.layer.dispose();assert.equal(s.timers.size,0);
});
