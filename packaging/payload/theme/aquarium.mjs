// Self-contained: serialized into the renderer alongside the theme panel.
export function createAquariumLayer(container, backdropURL = '', fishURL = '', reefURL = '', exoticURL = '') {
  let canvas, context, observer, sprites, plate, backdropId='original';
  const atlasImages=new Set();
  let spriteBytes=0,loadedAtlases=0;
  let fishReady=false,fishError=null;
  let active = false, motion = true, disposed = false, timer = null;
  let time = 0, lastTick = 0, frames = 0, drawTime = 0;
  const fps = 24, poseCount = 12, maxWidth = 1920, maxHeight = 1280;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The large, distant silhouette moves slowly; small fish share a loose school.
  const tailStrength=.92+Math.random()*.12;
  // Cycles per second, tail bend as a fraction of body length, and path curvature.
  const swimProfiles={
    whale:{hz:.42,bend:.023,arc:.006},hammer:{hz:.72,bend:.031,arc:.009},
    manta:{hz:.34,bend:.009,arc:.013},moray:{hz:.65,bend:.048,arc:.010},
    seahorse:{hz:1.3,bend:.002,arc:.012},puffer:{hz:1.6,bend:.006,arc:.010},
    betta:{hz:.88,bend:.042,arc:.014},lion:{hz:.70,bend:.022,arc:.010},
    default:{hz:1.15,bend:.034,arc:.014}
  };
  // Screen composition sizes: species retain their own scale when a slot changes fish.
  const speciesSizes={whale:500,manta:258,arowana:218,hammer:185,moray:158,puffer:76,seahorse:48,mandarin:64,anthias:68};
  const exoticKinds=['hammer','moray','puffer','seahorse','mandarin','anthias'];
  const fish = [
    {kind:'whale', pool:['whale','manta'], x:.61, y:.48, size:500, speed:.008, direction:-1, alpha:.40, phase:2},
    {kind:'arowana', x:.18, y:.25, size:218, speed:.016, direction:1, alpha:.78, phase:0},
    {kind:'manta', pool:['manta','arowana'], x:.79, y:.69, size:258, speed:.011, direction:-1, alpha:.52, phase:3},
    {kind:'lion', pool:['lion','angel'], x:.15, y:.72, size:90, speed:.013, direction:1, alpha:.62, phase:1},
    {kind:'betta', pool:['betta','butterfly'], x:.27, y:.79, size:92, speed:.014, direction:1, alpha:.57, phase:4},
    {kind:'angel', pool:['angel','betta'], x:.84, y:.36, size:67, speed:.014, direction:-1, alpha:.55, phase:2},
    ...Array.from({length:8}, (_, i) => ({kind:['small','clown','tang','butterfly'][i%4],pool:['small','clown','tang','butterfly'], x:.31 + (i % 4) * .052,
      y:.38 + Math.floor(i / 4) * .065 + Math.sin(i * 2) * .024,
      size:26 + (i % 3) * 6, speed:.022 + (i % 3) * .001,
      direction:i % 2 ? -1 : 1, alpha:.48 + (i % 3) * .055, phase:i * 1.7}))
  ].map(f=>({...f,depth:f.alpha,speed:f.speed*(.78+Math.random()*.44),
    tailVariant:Math.random()<.5?0:1,tailRate:.85+Math.random()*.3}));
  function addSchoolFish(i) {
    const school=Math.floor(i/14)%4, member=i%14;
    const medium=i%5===0;
    const pool=exoticURL&&i<6?[exoticKinds[i]]:medium?['angel','butterfly','betta','lion',...(exoticURL?['puffer','seahorse','mandarin']:[])]:['small','clown','tang','butterfly',...(exoticURL?['anthias','mandarin']:[])];
    const speed=(medium?.015:.025)*(1+school*.08)*(.86+Math.random()*.28);
    const direction=school%2?-1:1,margin=.12,span=1+2*margin;
    // Join the school at its current position, even if the density changes mid-swim.
    const x=[.20,.43,.66,.81][school]+((member%7)-3)*.052+(Math.random()-.5)*.025;
    const start=((x+margin-direction*time*speed)%(2*span)+2*span)%(2*span)-margin;
    return {kind:pool[(member+school)%pool.length],pool,x:start,
      y:[.22,.40,.58,.77][school]+Math.floor(member/7)*.045+(Math.random()-.5)*.045,
      size:medium?48+Math.random()*30:24+Math.random()*24,speed,direction,
      depth:medium?.65:.42+Math.random()*.25,phase:i*1.7,
      tailVariant:Math.random()<.5?0:1,tailRate:.85+Math.random()*.3};
  }
  let drawOrder=[];
  function population(value) {
    const count=Number.isFinite(Number(value))?Math.max(14,Math.min(90,Math.round(Number(value)))):60;
    if(fish.length===count)return false;
    while(fish.length<count)fish.push(addSchoolFish(fish.length-14));
    fish.length=count;
    drawOrder=[...fish].sort((a,b)=>a.depth-b.depth);return true;
  }
  population(60);
  function updateBackdrop() {
    if(plate)plate.style.backgroundImage=`linear-gradient(180deg,rgba(2,8,19,.12),rgba(2,8,19,.38)),url(${JSON.stringify(backdropURL)})`;
  }
  const bubbles = Array.from({length:20}, (_, i) => ({
    x:[.07,.92,.76][i % 3] + Math.sin(i * 13) * .018,
    phase:(i * .173) % 1, speed:.011 + (i % 4) * .002,
    radius:.55 + (i % 4) * .32, sway:i * 2.3
  }));
  // Verified alpha bounds in the generated 1536 × 1024 atlas, with padding.
  const crops={arowana:[20,134,862,278,384],angel:[953,22,476,564,148],
    small:[58,611,620,346,96],whale:[768,621,760,324,760]};
  const reefCrops={clown:[99,1,515,287,96],tang:[887,5,528,287,104],
    butterfly:[131,289,513,317,104],betta:[888,296,562,380,156],
    lion:[68,606,564,411,144],manta:[715,646,794,343,640]};
  const exoticCrops={hammer:[12,8,780,324,420],moray:[798,18,718,282,360],
    puffer:[132,338,516,342,196],seahorse:[1052,291,295,398,116],
    mandarin:[116,684,616,333,184],anthias:[846,686,654,338,204]};
  function makeSprites() {
    const bubble=document.createElement('canvas');bubble.width=bubble.height=24;
    const ctx=bubble.getContext('2d');ctx.filter='blur(.65px)';
    ctx.strokeStyle='#7cbbd03b';ctx.lineWidth=.85;
    ctx.beginPath();ctx.arc(12,12,7,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#b9e4f0a0';ctx.beginPath();ctx.arc(12,12,5.5,3.7,4.8);ctx.stroke();
    return {bubble};
  }
  function bakeFish(atlas,regions) {
    if(atlas.naturalWidth!==1536 || atlas.naturalHeight!==1024)throw Error('Unexpected fish atlas dimensions');
    for(const [kind,[sx,sy,sw,sh,width]] of Object.entries(regions)) {
      const height=Math.round(width*sh/sw),base=document.createElement('canvas');
      base.width=width+24;base.height=height+24;
      const ctx=base.getContext('2d');
      const large=['whale','manta'].includes(kind);
      ctx.imageSmoothingQuality='high';
      ctx.filter=large?'brightness(.82) saturate(.78)':'brightness(.82) saturate(.70) blur(.25px)';
      // These two atlas rectangles overlap in empty space; exclude the neighbour's fin.
      if(kind==='betta'||kind==='manta'){
        const polygon=kind==='betta'?[[0,0],[1,0],[1,.91],[.60,.91],[.60,1],[0,1]]:[[0,.14],[.62,.14],[.62,0],[1,0],[1,1],[0,1]];
        ctx.beginPath();polygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](12+x*width,12+y*height));ctx.closePath();ctx.clip();
      }
      ctx.drawImage(atlas,sx,sy,sw,sh,12,12,width,height);
      // Generated body alpha is often 251–254; restore full coverage inside the body.
      // Retain feathered outlines and naturally thin fins below that threshold.
      const pixels=ctx.getImageData(0,0,base.width,base.height);
      for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]>=240)pixels.data[i]=255;
      ctx.putImageData(pixels,0,0);
      // One twelve-pose cycle replaces duplicate strength sets at similar cache cost.
      // The head stays steady while a delayed bending wave grows toward the tail.
      const profile=swimProfiles[kind]||swimProfiles.default;
      sprites[kind]=[tailStrength].map(strength=>{
        const frames=[];
        for(let pose=0;pose<poseCount;pose++) {
          const frame=document.createElement('canvas');frame.width=base.width;frame.height=base.height;
          const out=frame.getContext('2d'),phase=pose*Math.PI*2/poseCount;
          for(let x=0;x<base.width;x+=4) {
            const slice=Math.min(4,base.width-x),rear=Math.max(0,Math.min(1,(width-(x-12))/width));
            const envelope=Math.pow(rear,kind==='moray'?1.25:2.3);
            const wave=Math.sin(phase-rear*(kind==='moray'?5.2:3.1));
            const bend=wave*envelope*strength*width*profile.bend;
            const tuck=Math.sin(phase-rear*2.4)*envelope*width*.020;
            if(kind==='manta'){
              // Pectoral fins flex around the body, instead of wagging the whole ray.
              const center=12+height*.55,flap=Math.sin(phase-(x/base.width)*.9);
              const topScale=1+flap*.19,bottomScale=1-flap*.11;
              out.drawImage(base,x,0,slice,center,x+tuck,center-center*topScale+bend,slice+.4,center*topScale);
              out.drawImage(base,x,center,slice,base.height-center,x+tuck,center+bend,slice+.4,(base.height-center)*bottomScale);
            }else{
              const roll=1-Math.sin(phase-rear*2.4)**2*envelope*.12;
              out.drawImage(base,x,0,slice,base.height,x+tuck,bend+base.height*(1-roll)/2,slice+.4,base.height*roll);
            }
          }
          frames.push(frame);
          spriteBytes+=frame.width*frame.height*4;
        }
        return frames;
      });
    }
  }
  function loadFish() {
    if(!fishURL){fishError='Fish atlas unavailable';return;}
    const sources=[[fishURL,crops],...(reefURL?[[reefURL,reefCrops]]:[]),...(exoticURL?[[exoticURL,exoticCrops]]:[])];
    for(const [url,regions] of sources){
      const atlas=new Image();atlasImages.add(atlas);
      const release=()=>{atlas.onload=null;atlas.onerror=null;atlasImages.delete(atlas);};
      atlas.onload=()=>{
        if(disposed)return;
        try{bakeFish(atlas,regions);loadedAtlases++;fishReady=loadedAtlases===sources.length;sync(true);}
        catch(error){fishError=error.message;}
        finally{release();}
      };
      atlas.onerror=()=>{if(disposed)return;fishError='Fish atlas could not be decoded';release();};
      atlas.src=url;
    }
  }
  function ensure() {
    if (canvas) return;
    if (backdropURL) {
      plate=document.createElement('div');plate.dataset.glassOcean='';
      plate.setAttribute('aria-hidden','true');
      plate.style.cssText='position:absolute;inset:-12px;pointer-events:none;filter:blur(3px);background-size:cover;background-position:center;';
      updateBackdrop();
      container.append(plate);
    }
    canvas = document.createElement('canvas');
    canvas.dataset.glassAquarium = ''; canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    container.append(canvas); context = canvas.getContext('2d');
    sprites = makeSprites();
    loadFish();
    observer = new ResizeObserver(() => { if (active && !document.hidden) { resize(); draw(); } });
    observer.observe(container);
  }
  function resize() {
    const {width, height} = container.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2, maxWidth / Math.max(1,width), maxHeight / Math.max(1,height));
    const w = Math.max(1,Math.round(width * scale)), h = Math.max(1,Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function draw() {
    if (!context || !active || disposed) return;
    const started = performance.now(), w = canvas.width, h = canvas.height;
    const unit = Math.min(w / 1000, h / 600);
    context.imageSmoothingQuality='high';
    context.clearRect(0,0,w,h);
    for (const f of drawOrder) {
      const slotWidth=f.size*unit, margin=Math.max(.12,slotWidth/(2*w)+.03);
      const driveRate=.55+f.tailRate*.18,drivePhase=f.phase;
      // Integrating the speed pulse keeps travel continuous through acceleration/coast.
      const cruise=time+.16/driveRate*(Math.sin(time*driveRate+drivePhase)-Math.sin(drivePhase));
      const drive=1+.16*Math.cos(time*driveRate+drivePhase);
      const span=1+2*margin, travel=f.x+margin+f.direction*cruise*f.speed;
      const turn=Math.floor(travel/span), progress=((travel%(2*span)+2*span)%(2*span));
      // Turn outside the frame so a fish never flips while it is visible.
      const cycle=progress<=span?-margin+progress:1+margin-(progress-span);
      const heading=turn%2===0?f.direction:-f.direction;
      // Change species only during an unseen turn.
      if(f.turn!==undefined&&f.turn!==turn&&f.pool){
        const available=f.pool.filter(kind=>sprites[kind]);
        if(available.length)f.kind=available[(available.indexOf(f.kind)+1)%available.length];
      }
      f.turn=turn;
      const kind=sprites[f.kind]?f.kind:'small';
      if(!sprites[kind])continue;
      const width=(speciesSizes[kind]||f.size)*unit;
      const variant=f.tailVariant%sprites[kind].length;
      const profile=swimProfiles[kind]||swimProfiles.default;
      const beatTime=time+.11/driveRate*(Math.sin(time*driveRate+drivePhase)-Math.sin(drivePhase));
      const beat=beatTime*profile.hz*f.tailRate*Math.PI*2+f.phase;
      const pathRate=.28+f.tailRate*.06,pathPhase=time*pathRate+f.phase;
      const arc=profile.arc;
      const x = cycle * w, y = (f.y + Math.sin(pathPhase)*arc+Math.sin(pathPhase*.47+f.phase)*arc*.35) * h;
      const verticalSpeed=h*arc*pathRate*(Math.cos(pathPhase)+.35*.47*Math.cos(pathPhase*.47+f.phase));
      const pitch=Math.max(-.14,Math.min(.14,Math.atan2(verticalSpeed,w*f.speed*drive)));
      const texture=sprites[kind][variant][0];
      const height = width * texture.height / texture.width;
      // Paint opaque fish from far to near so the nearer body occludes the farther one.
      context.save(); context.globalAlpha = 1;
      context.translate(x,y); context.scale(heading, 1);
      context.rotate(pitch+Math.sin(beat)*(['puffer','seahorse'].includes(kind)?.003:.009));
      const pose=Math.floor(((beat/(Math.PI*2))%1+1)%1*poseCount);
      context.drawImage(sprites[kind][variant][pose],-width / 2,-height / 2,width,height); context.restore();
    }
    for (const b of bubbles) {
      const progress = (b.phase + time * b.speed) % 1;
      const x = (b.x + Math.sin(time * .55 + b.sway) * .008) * w;
      const y = (1.06 - progress * 1.15) * h, size = b.radius * unit * 5;
      context.globalAlpha = Math.min(1,progress * 5,(1-progress) * 5) * .40;
      context.drawImage(sprites.bubble,x-size/2,y-size/2,size,size);
    }
    context.globalAlpha = 1;
    frames++; drawTime += performance.now() - started;
  }
  function stop() { clearTimeout(timer); timer = null; lastTick = 0; }
  function shouldRun() { return active && motion && !reduced.matches && !document.hidden && !disposed; }
  function tick() {
    timer = null;
    if (!shouldRun()) return;
    const now = performance.now();
    if (lastTick) time += Math.min(.15,(now-lastTick)/1000);
    lastTick = now; draw();
    timer = setTimeout(tick,1000/fps);
  }
  function sync(forceStill=false) {
    stop();
    if (!active || disposed) return;
    // Keep a complete still scene on first mount, even in a hidden window.
    if (document.hidden) { if (!frames || forceStill) { resize(); draw(); } return; }
    resize(); draw();
    if (shouldRun()) timer = setTimeout(tick,1000/fps);
  }
  const visibility = () => sync();
  document.addEventListener('visibilitychange',visibility);
  reduced.addEventListener('change',visibility);
  return {
    setFishCount(value) { if(!disposed&&population(value)&&active)sync(true); },
    setBackdrop(url,id='original') {
      if(disposed||!url)return;
      backdropId=id;
      if(backdropURL===url)return;
      backdropURL=url;updateBackdrop();
    },
    setActive(value, animate = true) {
      if (disposed) return;
      const changed = active !== value || motion !== animate;
      active = value; motion = animate;
      if (active) ensure();
      if (canvas) canvas.hidden = !active;
      if (plate) plate.hidden = !active;
      if (changed) sync();
    },
    getDiagnostics:() => ({active,running:timer !== null,motion,reducedMotion:reduced.matches,
      fpsLimit:fps,poseCount,motionModel:'species-wave-and-coast',frames,averageDrawMs:frames ? Number((drawTime/frames).toFixed(3)) : 0,
      canvasWidth:canvas?.width || 0,canvasHeight:canvas?.height || 0,fishCount:fish.length,bubbleCount:bubbles.length,hasBackdrop:!!plate,backdropId,fishReady,fishError,
      speciesCount:Object.keys(sprites||{}).filter(kind=>kind!=='bubble').length,
      speciesInScene:[...new Set(fish.map(f=>f.kind))],fishOcclusion:'opaque-far-to-near',
      spriteMiB:Number((spriteBytes/1048576).toFixed(2))}),
    dispose() {
      disposed = true; stop(); observer?.disconnect();
      document.removeEventListener('visibilitychange',visibility); reduced.removeEventListener('change',visibility);
      for(const atlas of atlasImages){atlas.onload=null;atlas.onerror=null;atlas.src='';}atlasImages.clear();
      canvas?.remove(); plate?.remove(); sprites = null; context = null;
    }
  };
}
