import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAquariumLayer} from '../packaging/payload/theme/aquarium.mjs';

function scene(backdropURL='',fishURL='',reefURL='',random=()=>.5,exoticURL='') {
  const events=new Map(), mediaEvents=new Map(), timers=new Map(), children=[], images=[], headings=[], positions=[], draws=[], rotations=[];
  let now=1, id=0, removed=0, observed=0;
  const context={getImageData:()=>({data:new Uint8ClampedArray([0,0,0,252])}),putImageData(){},translate(x){positions.push(x);},scale(x){headings.push(x);},rotate(angle){rotations.push(angle);},clearRect(){},fillRect(){},save(){},restore(){},drawImage(...args){if(args.length===5)draws.push({image:args[0],textureWidth:args[0].width,width:args[3],alpha:this.globalAlpha});},fill(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},arc(){},stroke(){},createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})};
  const media={matches:false,addEventListener:(name,fn)=>mediaEvents.set(name,fn),removeEventListener:name=>mediaEvents.delete(name)};
  const document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    createElement:()=>({width:0,height:0,dataset:{},style:{},setAttribute(){},getContext:()=>context,toDataURL:()=> 'data:image/png;base64,fixture',remove(){removed++;}})};
  const seededMath=Object.create(Math);seededMath.random=random;
  const scope=vm.createContext({window:{matchMedia:()=>media},document,Math:seededMath,
    Image:class {constructor(){this.naturalWidth=1536;this.naturalHeight=1024;images.push(this);}},
    Path2D:class {},ResizeObserver:class {observe(){observed++;}disconnect(){observed--; }},
    performance:{now:()=>now},setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  const container={append:child=>children.push(child),getBoundingClientRect:()=>({width:7680,height:4320})};
  const layer=vm.runInContext(`(${createAquariumLayer.toString()})`,scope)(container,backdropURL,fishURL,reefURL,exoticURL);
  return {layer,timers,children,document,media,events,mediaEvents,images,headings,positions,draws,rotations,
    tick(ms){const [key,timer]=timers.entries().next().value;timers.delete(key);now+=ms??timer.delay;timer.fn();},
    counters:()=>({removed,observed})};
}

test('aquarium caps its raster size and frame cadence, and leaves no timer outside its mode',()=>{
  const s=scene('data:image/png;base64,fixture');assert.equal(s.children.length,0);assert.equal(s.timers.size,0);
  s.layer.setActive(true);assert.equal(s.children.length,2);assert.equal(s.timers.size,1);
  assert.ok(s.timers.values().next().value.delay>=1000/24);
  const d=s.layer.getDiagnostics();assert.ok(d.canvasWidth<=1920);assert.ok(d.canvasHeight<=1280);
  for(let i=0;i<4;i++)s.tick();assert.equal(s.timers.size,1);
  s.layer.setActive(false);assert.equal(s.timers.size,0);assert.ok(s.children.every(child=>child.hidden));
  s.layer.dispose();assert.equal(s.events.size,0);assert.equal(s.mediaEvents.size,0);
  assert.deepEqual(s.counters(),{removed:2,observed:0});
});

test('swimming varies its forward pace continuously and cycles body poses without new random jitter',()=>{
  const s=scene('ocean','base-atlas','reef-atlas');s.layer.setActive(true);
  s.images.forEach(img=>img.onload());
  const poses=new Set(),steps=[];let previous;
  for(let i=0;i<96;i++){
    s.tick(1000/24);const x=s.positions.at(-60);
    if(previous!==undefined)steps.push(previous-x);previous=x;
    poses.add(s.draws.at(-80).image);
    assert.ok(Math.abs(s.rotations.at(-60))<.16);
  }
  assert.ok(steps.every(step=>step>0),'fish keeps moving forward during its coast');
  const normal=steps.slice(2),low=Math.min(...normal),high=Math.max(...normal);
  assert.ok(high>low*1.12,'pace should have visible acceleration and coast');
  assert.ok(high<low*1.5,'pace changes must remain smooth and bounded');
  assert.equal(poses.size,12);
  assert.equal(s.layer.getDiagnostics().fishOcclusion,'opaque-far-to-near');
  s.layer.dispose();
});

test('six additional species decode once and bodies render opaque in stable depth order',()=>{
  const s=scene('ocean','base-atlas','reef-atlas',()=>.5,'exotic-atlas');s.layer.setActive(true);
  assert.equal(s.images.length,3);s.images.forEach(img=>img.onload());
  const d=s.layer.getDiagnostics();assert.equal(d.speciesCount,16);assert.equal(d.fishReady,true);
  for(const kind of ['hammer','moray','puffer','seahorse','mandarin','anthias'])assert.ok(d.speciesInScene.includes(kind));
  assert.ok(d.spriteMiB<45);
  const fishDraws=s.draws.slice(-80,-20);
  assert.ok(fishDraws.every(draw=>draw.alpha===1));
  assert.equal(fishDraws[0].textureWidth,784,'distant whale shark paints first');
  assert.equal(fishDraws.at(-1).textureWidth,408,'near arowana paints last');
  s.layer.setFishCount(24);assert.equal(s.layer.getDiagnostics().fishCount,24);
  for(const kind of ['hammer','moray','puffer','seahorse','mandarin','anthias'])assert.ok(s.layer.getDiagnostics().speciesInScene.includes(kind));
  assert.equal(s.images.length,3);s.layer.dispose();assert.equal(s.timers.size,0);
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

test('reef expansion has ten cached species, sixty swimming slots and one timer',()=>{
  const s=scene('','base-atlas','reef-atlas');s.layer.setActive(true);
  assert.equal(s.images.length,2);s.images[1].onload();
  assert.equal(s.layer.getDiagnostics().fishReady,false);
  s.images[0].onload();const ready=s.layer.getDiagnostics();
  assert.equal(ready.fishReady,true);assert.equal(ready.speciesCount,10);assert.equal(ready.fishCount,60);
  assert.ok(ready.spriteMiB<32);
  for(let i=0;i<5000;i++)s.tick();
  assert.equal(s.layer.getDiagnostics().spriteMiB,ready.spriteMiB);
  assert.equal(s.images.length,2);assert.equal(s.timers.size,1);
  s.layer.dispose();assert.equal(s.timers.size,0);
  const late=scene('','base-atlas','reef-atlas');late.layer.setActive(true);
  const callbacks=late.images.map(image=>image.onload);late.layer.dispose();callbacks.forEach(fn=>fn());
  assert.equal(late.layer.getDiagnostics().speciesCount,0);
});

test('a ray replacing a whale shark keeps ray proportions and a detailed source texture',()=>{
  const s=scene('','base-atlas','reef-atlas');s.layer.setActive(true);
  s.images[0].onload();s.images[1].onload();
  const d=s.layer.getDiagnostics(),unit=Math.min(d.canvasWidth/1000,d.canvasHeight/600);
  const initial=s.draws.at(-80);assert.equal(initial.textureWidth,784);
  assert.equal(initial.width,500*unit);
  let replacement;
  for(let i=0;i<1400;i++){
    s.tick(150);const first=s.draws.at(-80);
    if(first.textureWidth===664){replacement=first;break;}
  }
  assert.ok(replacement,'the large slot should eventually switch to a ray');
  assert.equal(replacement.width,258*unit);
  assert.ok(replacement.width<initial.width*.6);
  s.layer.dispose();
});

test('fish travel sideways and reverse direction only after leaving the frame',()=>{
  const s=scene('','base-atlas','reef-atlas');s.layer.setActive(true);
  s.images[0].onload();s.images[1].onload();
  const initialX=s.positions.at(-60), initialHeading=s.headings.at(-60);
  for(let i=0;i<60;i++)s.tick(150);
  assert.ok(s.positions.at(-60)<initialX);
  assert.equal(s.headings.at(-60),initialHeading);
  for(let i=0;i<690;i++)s.tick(150);
  assert.equal(s.headings.at(-60),-initialHeading);
  assert.ok(s.positions.at(-60)<0);
  s.layer.dispose();
});

test('random draws give individual fish different cruising speeds',()=>{
  const slow=scene('','base-atlas','reef-atlas',()=>0);
  const fast=scene('','base-atlas','reef-atlas',()=>.999);
  for(const s of [slow,fast]){
    s.layer.setActive(true);s.images[0].onload();s.images[1].onload();
    for(let i=0;i<60;i++)s.tick(150);
  }
  assert.ok(fast.positions.at(-60)<slow.positions.at(-60));
  slow.layer.dispose();fast.layer.dispose();
});

test('density and backdrop changes reuse decoded fish, preserve pause and keep one loop',()=>{
  const s=scene('original','base-atlas','reef-atlas');s.layer.setActive(true);
  s.images[0].onload();s.images[1].onload();const bytes=s.layer.getDiagnostics().spriteMiB;
  for(const count of [90,24,60,90]){
    s.layer.setFishCount(count);assert.equal(s.layer.getDiagnostics().fishCount,count);
    assert.equal(s.timers.size,1);assert.equal(s.images.length,2);
    assert.equal(s.layer.getDiagnostics().spriteMiB,bytes);
  }
  s.layer.setActive(true,false);s.layer.setFishCount(24);s.layer.setBackdrop('new-ocean','trench');
  assert.equal(s.timers.size,0);assert.equal(s.layer.getDiagnostics().backdropId,'trench');
  assert.ok(s.children[0].style.backgroundImage.includes('new-ocean'));
  s.layer.setFishCount(10000);assert.equal(s.layer.getDiagnostics().fishCount,90);
  s.layer.setFishCount(-1);assert.equal(s.layer.getDiagnostics().fishCount,14);
  s.layer.dispose();s.layer.setFishCount(60);s.layer.setBackdrop('late','late');
  assert.equal(s.layer.getDiagnostics().fishCount,14);assert.equal(s.timers.size,0);
});

test('token feeding accumulates fractions, caps bursts and fish eat every model tier',()=>{
 for(const tier of ['astra','sol','terra','luna']){
  const s=scene('ocean','base-atlas','reef-atlas');s.layer.setActive(true);s.images.forEach(img=>img.onload());
  s.layer.feed([{tier,tokens:9999}]);assert.equal(s.layer.getDiagnostics().feeding.pellets,0);
  s.layer.feed([{tier,tokens:1}]);assert.equal(s.layer.getDiagnostics().feeding.pellets,1);
  let reacted=false;
  for(let i=0;i<700;i++){s.tick(1000/24);if(s.layer.getDiagnostics().feeding.reactions.includes(tier))reacted=true;}
  assert.ok(s.layer.getDiagnostics().feeding.eaten[tier]>0,`${tier} should be eaten`);assert.ok(reacted);
  s.layer.feed([{tier,tokens:10000000}]);assert.ok(s.layer.getDiagnostics().feeding.pellets<=12);
  s.layer.setActive(false);s.layer.feed([{tier,tokens:100000}]);assert.ok(s.layer.getDiagnostics().feeding.pellets<=12);
  s.layer.dispose();s.layer.feed([{tier,tokens:10000}]);assert.equal(s.layer.getDiagnostics().feeding.pellets,0);
 }
});

test('manual tasting leaves token totals and fractional credit untouched, uses emoji and mouth capture',()=>{
 for(const tier of ['astra','sol','terra','luna']){
  const s=scene('ocean','base-atlas','reef-atlas');s.layer.setActive(true);s.images.forEach(img=>img.onload());
  s.layer.feed([{tier,tokens:9999}]);assert.equal(s.layer.previewFood(tier),6);
  assert.equal(s.layer.getDiagnostics().feeding.receivedTokens,9999);
  let captures=0,maxDistance=0;
  for(let i=0;i<1100;i++){
   s.tick(1000/24);const d=s.layer.getDiagnostics().feeding;
   if(d.lastCapture){captures++;maxDistance=Math.max(maxDistance,d.lastCapture.mouthDistance);assert.ok(!['whale','manta','hammer','moray'].includes(d.lastCapture.kind));}
  }
  const d=s.layer.getDiagnostics().feeding;
  assert.ok(captures>0,`${tier} manual food should reach a mouth`);
  assert.ok(maxDistance<10,'capture requires close mouth proximity');
  assert.equal(d.receivedTokens,9999);assert.equal(d.manualPellets,6);
  assert.ok(s.headings.every(scale=>Math.abs(scale)===1),'feeding and steep climbs must preserve fish body width');
  assert.ok(!/[\u3400-\u9fff]/.test(Object.values(d.reactionEmoji).join('')));
  if(tier==='luna')assert.ok(d.vomitBursts>0);
  s.layer.feed([{tier,tokens:1}]);assert.equal(s.layer.getDiagnostics().feeding.receivedTokens,10000);
  s.layer.setActive(true,false);const before=s.layer.getDiagnostics().feeding.manualPellets;
  assert.equal(s.layer.previewFood(tier),0);assert.equal(s.layer.getDiagnostics().feeding.manualPellets,before);
  s.layer.dispose();assert.equal(s.layer.previewFood(tier),0);
 }
});

test('shared pellets have up to three contenders, one winner and disappointed losers',()=>{
 const s=scene('ocean','base-atlas','reef-atlas');s.layer.setActive(true);s.images.forEach(img=>img.onload());
 s.layer.feed([{tier:'sol',tokens:10000}]);
 let sawContest=false,sawDisappointment=false;
 for(let i=0;i<1300;i++){
  s.tick(1000/24);const d=s.layer.getDiagnostics().feeding,c=d.competition;
  assert.ok(c.chasing.every(count=>count<=3));
  if(c.chasing.some(count=>count>1))sawContest=true;
  if(c.disappointed>0)sawDisappointment=true;
  assert.ok(d.eaten.sol<=1,'a single shared token must never be consumed twice');
 }
 const d=s.layer.getDiagnostics().feeding;
 assert.ok(sawContest,'multiple fish must chase the same pellet');assert.equal(d.eaten.sol,1);
 assert.ok(d.competition.lostRaces>0);assert.ok(sawDisappointment);
 assert.equal(d.manualPellets,0);assert.equal(d.receivedTokens,10000);
 assert.ok(s.layer.getDiagnostics().ornamentCache.entries>0);
 assert.ok(s.layer.getDiagnostics().ornamentCache.kiB<1024);
 const entries=s.layer.getDiagnostics().ornamentCache.entries;for(let i=0;i<200;i++)s.tick(1000/24);
 assert.equal(s.layer.getDiagnostics().ornamentCache.entries,entries);
 s.layer.dispose();assert.equal(s.layer.getDiagnostics().ornamentCache.entries,0);
 s.layer.dispose();
});
