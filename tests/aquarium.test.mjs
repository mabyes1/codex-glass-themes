import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAquariumLayer} from '../packaging/payload/theme/aquarium.mjs';

function scene(backdropURL='',fishURL='',reefURL='') {
  const events=new Map(), mediaEvents=new Map(), timers=new Map(), children=[], images=[];
  let now=1, id=0, removed=0, observed=0;
  const context={translate(){},scale(){},rotate(){},clearRect(){},fillRect(){},save(){},restore(){},drawImage(){},fill(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},arc(){},stroke(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})};
  const media={matches:false,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:name=>mediaEvents.delete(name)};
  const document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    createElement:()=>({width:0,height:0,dataset:{},style:{},setAttribute(){},getContext:()=>context,toDataURL:()=> 'data:image/png;base64,fixture',remove(){removed++;}})};
  const scope=vm.createContext({window:{matchMedia:()=>media},document,
    Image:class {constructor(){this.naturalWidth=1536;this.naturalHeight=1024;images.push(this);}},
    Path2D:class {},ResizeObserver:class {observe(){observed++;}disconnect(){observed--; }},
    performance:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  const container={append:child=>children.push(child),getBoundingClientRect:()=>({width:7680,height:4320})};
  const layer=vm.runInContext(`(${createAquariumLayer.toString()})`,scope)(container,backdropURL,fishURL,reefURL);
  return {layer,timers,children,document,media,events,mediaEvents,images,
    tick(){const [key,timer]=timers.entries().next().value;timers.delete(key);now+=timer.delay;timer.fn();},
    counters:()=>({removed,observed})};
}

test('aquarium caps its raster size and frame cadence, and leaves no timer outside its mode',()=>{
  const s=scene('data:image/png;base64,fixture');assert.equal(s.children.length,0);assert.equal(s.timers.size,0);
  s.layer.setActive(true);assert.equal(s.children.length,2);assert.equal(s.timers.size,1);
  assert.ok(s.timers.values().next().value.delay>=1000/18);
  const d=s.layer.getDiagnostics();assert.ok(d.canvasWidth<=960);assert.ok(d.canvasHeight<=640);
  for(let i=0;i<4;i++)s.tick();assert.equal(s.timers.size,1);
  s.layer.setActive(false);assert.equal(s.timers.size,0);assert.ok(s.children.every(child=>child.hidden));
  s.layer.dispose();assert.equal(s.events.size,0);assert.equal(s.mediaEvents.size,0);
  assert.deepEqual(s.counters(),{removed:2,observed:0});
});

test('generated fish decode once; late image completion cannot restart a disposed aquarium',()=>{
  const s=scene('','data:image/png;base64,fixture');s.layer.setActive(true);
  assert.equal(s.images.length,1);s.images[0].onload();
  assert.equal(s.layer.getDiagnostics().fishReady,true);assert.equal(s.timers.size,1);
  s.layer.setActive(false);s.layer.setActive(true);assert.equal(s.images.length,1);
  s.layer.dispose();assert.equal(s.timers.size,0);
  const late=scene('','data:image/png;base64,fixture');late.layer.setActive(true);
  const callback=late.images[0].onload;late.layer.dispose();callback();
  assert.equal(late.timers.size,0);assert.equal(late.layer.getDiagnostics().fishReady,false);
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

test('reef expansion has ten cached species but keeps fourteen swimming slots and one timer',()=>{
  const s=scene('','base-atlas','reef-atlas');s.layer.setActive(true);
  assert.equal(s.images.length,2);s.images[1].onload();
  assert.equal(s.layer.getDiagnostics().fishReady,false);
  s.images[0].onload();const ready=s.layer.getDiagnostics();
  assert.equal(ready.fishReady,true);assert.equal(ready.speciesCount,10);assert.equal(ready.fishCount,14);
  assert.ok(ready.spriteMiB<10);
  for(let i=0;i<5000;i++)s.tick();
  assert.equal(s.layer.getDiagnostics().spriteMiB,ready.spriteMiB);
  assert.equal(s.images.length,2);assert.equal(s.timers.size,1);
  s.layer.dispose();assert.equal(s.timers.size,0);
  const late=scene('','base-atlas','reef-atlas');late.layer.setActive(true);
  const callbacks=late.images.map(image=>image.onload);late.layer.dispose();callbacks.forEach(fn=>fn());
  assert.equal(late.layer.getDiagnostics().speciesCount,0);
});
