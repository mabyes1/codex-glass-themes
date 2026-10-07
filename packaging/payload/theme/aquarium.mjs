// Self-contained: serialized into the renderer alongside the theme panel.
export function createAquariumLayer(container, backdropURL = '', fishURL = '', reefURL = '') {
  let canvas, context, observer, sprites, plate;
  const atlasImages=new Set();
  let spriteBytes=0,loadedAtlases=0;
  let fishReady=false,fishError=null;
  let active = false, motion = true, disposed = false, timer = null;
  let time = 0, lastTick = 0, frames = 0, drawTime = 0;
  const fps = 18, maxWidth = 960, maxHeight = 640;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The large, distant silhouette moves slowly; small fish share a loose school.
  const fish = [
    {kind:'whale', pool:['whale','manta'], x:.61, y:.48, size:380, speed:.0038, direction:-1, alpha:.40, phase:2},
    {kind:'arowana', x:.18, y:.25, size:218, speed:.008, direction:1, alpha:.78, phase:0},
    {kind:'manta', pool:['manta','arowana'], x:.79, y:.69, size:258, speed:.006, direction:-1, alpha:.52, phase:3},
    {kind:'lion', pool:['lion','angel'], x:.15, y:.72, size:90, speed:.005, direction:1, alpha:.62, phase:1},
    {kind:'betta', pool:['betta','butterfly'], x:.27, y:.79, size:92, speed:.006, direction:1, alpha:.57, phase:4},
    {kind:'angel', pool:['angel','betta'], x:.84, y:.36, size:67, speed:.005, direction:-1, alpha:.55, phase:2},
    ...Array.from({length:8}, (_, i) => ({kind:['small','clown','tang','butterfly'][i%4],pool:['small','clown','tang','butterfly'], x:.31 + (i % 4) * .052,
      y:.38 + Math.floor(i / 4) * .065 + Math.sin(i * 2) * .024,
      size:26 + (i % 3) * 6, speed:.012 + (i % 3) * .0003,
      direction:1, alpha:.48 + (i % 3) * .055, phase:i * 1.7}))
  ];
  const bubbles = Array.from({length:20}, (_, i) => ({
    x:[.07,.92,.76][i % 3] + Math.sin(i * 13) * .018,
    phase:(i * .173) % 1, speed:.011 + (i % 4) * .002,
    radius:.55 + (i % 4) * .32, sway:i * 2.3
  }));
  // Verified alpha bounds in the generated 1536 × 1024 atlas, with padding.
  const crops={arowana:[20,134,862,278,384],angel:[953,22,476,564,148],
    small:[58,611,620,346,96],whale:[768,621,760,324,384]};
  const reefCrops={clown:[99,1,515,287,96],tang:[887,5,528,287,104],
    butterfly:[131,289,513,317,104],betta:[888,296,562,380,156],
    lion:[68,606,564,411,144],manta:[715,646,794,343,320]};
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
      ctx.filter=['whale','manta'].includes(kind)?'brightness(.68) saturate(.58) blur(1px)':'brightness(.82) saturate(.70) blur(.25px)';
      // These two atlas rectangles overlap in empty space; exclude the neighbour's fin.
      if(kind==='betta'||kind==='manta'){
        const polygon=kind==='betta'?[[0,0],[1,0],[1,.91],[.60,.91],[.60,1],[0,1]]:[[0,.14],[.62,.14],[.62,0],[1,0],[1,1],[0,1]];
        ctx.beginPath();polygon.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](12+x*width,12+y*height));ctx.closePath();ctx.clip();
      }
      ctx.drawImage(atlas,sx,sy,sw,sh,12,12,width,height);
      sprites[kind]=[];
      // Bake gentle tail/body bends once. Each live fish remains one drawImage.
      for(let pose=0;pose<8;pose++) {
        const frame=document.createElement('canvas');frame.width=base.width;frame.height=base.height;
        const out=frame.getContext('2d'),phase=pose*Math.PI/4;
        for(let x=0;x<base.width;x+=6) {
          const slice=Math.min(7,base.width-x),rear=Math.max(0,1-x/base.width);
          const offset=Math.sin(phase+rear*2.3)*rear*rear*height*.045;
          out.drawImage(base,x,0,slice,base.height,x,offset,slice,base.height);
        }
        sprites[kind].push(frame);
        spriteBytes+=frame.width*frame.height*4;
      }
    }
  }
  function loadFish() {
    if(!fishURL){fishError='Fish atlas unavailable';return;}
    const sources=[[fishURL,crops],...(reefURL?[[reefURL,reefCrops]]:[])];
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
      plate.style.cssText='position:absolute;inset:-12px;pointer-events:none;filter:blur(5px);background-size:cover;background-position:center;';
      plate.style.backgroundImage=`linear-gradient(180deg,rgba(2,8,19,.12),rgba(2,8,19,.38)),url(${JSON.stringify(backdropURL)})`;
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
    const scale = Math.min(1, maxWidth / Math.max(1,width), maxHeight / Math.max(1,height));
    const w = Math.max(1,Math.round(width * scale)), h = Math.max(1,Math.round(height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function draw() {
    if (!context || !active || disposed) return;
    const started = performance.now(), w = canvas.width, h = canvas.height;
    const unit = Math.min(w / 1000, h / 600);
    context.clearRect(0,0,w,h);
    for (const f of fish) {
      const position=f.x+.25+f.direction*time*f.speed,lap=Math.floor(position/1.5);
      // Change species only beyond the edge; keep the same 14 swimming slots.
      if(f.lap!==undefined&&f.lap!==lap&&f.pool){
        const available=f.pool.filter(kind=>sprites[kind]);
        if(available.length)f.kind=available[(available.indexOf(f.kind)+1)%available.length];
      }
      f.lap=lap;
      const kind=sprites[f.kind]?f.kind:'small';
      if(!sprites[kind])continue;
      const cycle = ((position % 1.5 + 1.5) % 1.5) - .25;
      const x = cycle * w, y = (f.y + Math.sin(time * .20 + f.phase) * .012) * h;
      const texture=sprites[kind][0];
      const width = f.size * unit, height = width * texture.height / texture.width;
      const passingLight=.58+.42*Math.max(0,1-Math.abs(cycle-.36)*1.7);
      context.save(); context.globalAlpha = f.alpha*passingLight;
      context.translate(x,y); context.scale(f.direction, 1);
      context.rotate(Math.cos(time * .20 + f.phase) * .018);
      const pose=Math.floor(time*(['whale','manta'].includes(kind)?2.4:6.4)+f.phase*2)%8;
      context.drawImage(sprites[kind][pose],-width / 2,-height / 2,width,height); context.restore();
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
      fpsLimit:fps,frames,averageDrawMs:frames ? Number((drawTime/frames).toFixed(3)) : 0,
      canvasWidth:canvas?.width || 0,canvasHeight:canvas?.height || 0,fishCount:fish.length,bubbleCount:bubbles.length,hasBackdrop:!!plate,fishReady,fishError,
      speciesCount:Object.keys(sprites||{}).filter(kind=>kind!=='bubble').length,spriteMiB:Number((spriteBytes/1048576).toFixed(2))}),
    dispose() {
      disposed = true; stop(); observer?.disconnect();
      document.removeEventListener('visibilitychange',visibility); reduced.removeEventListener('change',visibility);
      for(const atlas of atlasImages){atlas.onload=null;atlas.onerror=null;atlas.src='';}atlasImages.clear();
      canvas?.remove(); plate?.remove(); sprites = null; context = null;
    }
  };
}
