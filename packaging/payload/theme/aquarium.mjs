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
  const pellets=[], effects=[], foodRemainder={astra:0,sol:0,terra:0,luna:0,unknown:0};
  const foodColors={astra:'#ffd45c',sol:'#a9d8ff',terra:'#bc9568',luna:'#795136',unknown:'#a2aab4'};
  const eaten={astra:0,sol:0,terra:0,luna:0,unknown:0};
  let lastFoodTime=0,receivedTokens=0,droppedFood=0,manualPellets=0,vomitBursts=0,lastCapture=null,contestedPellets=0,lostRaces=0,missedAttempts=0,expiredFood=0;
  const ornamentCache=new Map();let ornamentUnit=0,ornamentBytes=0;
  const reactionEmoji={astra:'🥹💖✨',sol:'😋💕',terra:'😑💭',luna:'🤢🤮',unknown:'🤔❔'};
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  const wrapAngle=value=>Math.atan2(Math.sin(value),Math.cos(value));
  const canForage=f=>!['whale','manta','hammer','moray'].includes(f.kind);
  function spawnFood(tier,count,manual=false){
    if(disposed||!Object.hasOwn(foodRemainder,tier)||!shouldRun())return 0;
    const visible=Math.min(count,manual?6:12,48-pellets.length);
    // Small, faceted token chips; a loose shower instead of one magnetic target.
    const center=.30+Math.random()*.40;
    for(let i=0;i<visible;i++){
      const spread=(i-(visible-1)/2)*.035+(Math.random()-.5)*.025;
      pellets.push({tier,x:clamp(center+spread,.10,.90),y:-.012-i*.014,
        born:time+i*.13,phase:Math.random()*6.28,manual,spin:.5+Math.random()*.7,contenders:[],winner:null});
      droppedFood++;if(manual)manualPellets++;
    }
    return visible;
  }
  function previewFood(tier){return spawnFood(tier,6,true);}
  function feed(events) {
    if(disposed||!Array.isArray(events))return;
    for(const event of events){
      if(!Number.isSafeInteger(event.tokens)||event.tokens<=0||!Object.hasOwn(foodRemainder,event.tier))continue;
      receivedTokens+=event.tokens;foodRemainder[event.tier]+=event.tokens;
      const count=Math.floor(foodRemainder[event.tier]/10000);foodRemainder[event.tier]%=10000;
      spawnFood(event.tier,count);
    }
  }
  function loseFood(f,race=true){
    const p=f.food;f.food=null;f.foodCooldown=time+4;
    if(p){p.contenders=p.contenders.filter(other=>other!==f);if(p.winner===f){p.winner=null;p.suction=false;}}
    if(f.forage){f.forage.stage='missed';f.forage.at=time;}
    f.disappointment={at:time+.25,race};
    if(race)lostRaces++;else missedAttempts++;
  }
  function updateFood(w,h,unit,dt){
    // Eligibility is shared by all food this frame; score each candidate once
    // per pellet, keeping only its nearest three instead of sorting every fish.
    const candidates=fish.filter(f=>canForage(f)&&f.screen&&!f.food&&!f.forage&&
      time>=(f.foodCooldown||0)&&f.screen.x>0&&f.screen.x<w);
    for(let i=pellets.length-1;i>=0;i--){
      const p=pellets[i];if(time<p.born)continue;
      if(!p.suction){p.y+=dt*.026;p.x+=Math.sin(time*.8+p.phase)*dt*.0015;}
      p.contenders=p.contenders.filter(f=>fish.includes(f)&&f.food===p);
      if(p.winner&&!p.contenders.includes(p.winner)){p.winner=null;p.suction=false;}
      if(p.y>1.05||time-p.born>38){
        for(const f of p.contenders)loseFood(f,false);
        expiredFood++;pellets.splice(i,1);continue;
      }
      if(!p.winner&&p.y>.07&&p.contenders.length<3){
        const nearest=[],limit=3-p.contenders.length;
        for(const f of candidates){
          if(f.food||time-p.born<=.5+f.tailRate*.25)continue;
          const dx=p.x*w-f.screen.x,dy=p.y*h-f.screen.y,distance2=dx*dx+dy*dy;
          if(distance2>=w*w*.09)continue;
          const headingCost=1+Math.max(0,-f.screen.heading*dx/w)*2,score=distance2*headingCost*headingCost;
          let slot=0;while(slot<nearest.length&&nearest[slot].score<=score)slot++;
          if(slot<limit){nearest.splice(slot,0,{f,score});if(nearest.length>limit)nearest.pop();}
        }
        const available=nearest.map(item=>item.f);
        for(const f of available.slice(0,3-p.contenders.length)){
          f.food=p;f.noticeAt=time+.08+(f.phase%1)*.24;p.contenders.push(f);
        }
        if(!p.contested&&p.contenders.length>1){p.contested=true;contestedPellets++;}
      }
    }
  }
  function ornament(key,unit,paint,width,height){
    if(ornamentUnit!==unit){
      for(const item of ornamentCache.values()){item.width=0;item.height=0;}
      ornamentCache.clear();ornamentBytes=0;ornamentUnit=unit;
    }
    let cached=ornamentCache.get(key);
    if(!cached){
      cached=document.createElement('canvas');cached.width=Math.ceil(width*unit);cached.height=Math.ceil(height*unit);
      paint(cached.getContext('2d'),cached.width,cached.height);ornamentCache.set(key,cached);
      ornamentBytes+=cached.width*cached.height*4;
    }
    return cached;
  }
  function emoji(text,x,y,unit){
    const cached=ornament('emoji:'+text,unit,(ctx,w,h)=>{
      ctx.font=`${Math.max(14,19*unit)}px sans-serif`;ctx.textAlign='center';
      ctx.shadowColor='#03101e';ctx.shadowBlur=2*unit;ctx.fillText(text,w/2,h-10*unit);
    },110,48);
    context.drawImage(cached,x-cached.width/2,y-cached.height+10*unit,cached.width,cached.height);
  }
  function drawFood(w,h,unit){
    for(const p of pellets){
      if(time<p.born)continue;
      const cached=ornament('chip:'+p.tier,unit,(ctx,cw,ch)=>{
        ctx.translate(cw/2,ch/2);ctx.fillStyle=foodColors[p.tier];
        if(p.tier==='astra'){ctx.shadowColor='#ffd45c';ctx.shadowBlur=8*unit;}
        const r=3.2*unit;ctx.beginPath();
        for(let k=0;k<6;k++){const a=k*Math.PI/3;ctx[k?'lineTo':'moveTo'](Math.cos(a)*r,Math.sin(a)*r);}
        ctx.closePath();ctx.fill();ctx.strokeStyle=p.tier==='luna'?'#bfaa70':'#fff4cbb0';ctx.lineWidth=.65*unit;ctx.stroke();
        ctx.shadowBlur=0;ctx.strokeStyle=p.tier==='luna'?'#46301e':'#142a4b';ctx.lineWidth=.7*unit;
        ctx.beginPath();ctx.moveTo(-.5*unit,-1.5*unit);ctx.lineTo(-1.5*unit,0);ctx.lineTo(-.5*unit,1.5*unit);
        ctx.moveTo(.5*unit,-1.5*unit);ctx.lineTo(1.5*unit,0);ctx.lineTo(.5*unit,1.5*unit);ctx.stroke();
      },24,24);
      context.save();context.globalAlpha=.97;
      context.translate(p.x*w,p.y*h);context.rotate(p.phase+time*p.spin);
      context.scale(1,.70+Math.sin(time*1.7+p.phase)*.16);
      context.drawImage(cached,-cached.width/2,-cached.height/2,cached.width,cached.height);context.restore();
    }
    for(let i=effects.length-1;i>=0;i--){
      const e=effects[i],age=time-e.at;if(age>2.2){effects.splice(i,1);continue;}
      context.save();context.globalAlpha=Math.max(0,1-age/2.2)*.9;context.fillStyle='#b3ec57';
      for(let n=0;n<9;n++){
        context.beginPath();context.arc(e.x*w+Math.cos(e.angle)*age*(24+n*4)*unit,
          e.y*h+Math.sin(e.angle)*age*(24+n*4)*unit+age*age*18*unit+Math.sin(n*7)*age*8*unit,
          Math.max(.5,3.4-age)*unit,0,Math.PI*2);context.fill();
      }context.restore();
    }
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
    const foodDt=Math.max(0,Math.min(.15,time-lastFoodTime));lastFoodTime=time;
    updateFood(w,h,unit,foodDt);
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
      let heading=turn%2===0?f.direction:-f.direction;
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
      let x = cycle * w, y = (f.y + Math.sin(pathPhase)*arc+Math.sin(pathPhase*.47+f.phase)*arc*.35) * h;
      const verticalSpeed=h*arc*pathRate*(Math.cos(pathPhase)+.35*.47*Math.cos(pathPhase*.47+f.phase));
      let pitch=Math.max(-.14,Math.min(.14,Math.atan2(verticalSpeed,w*f.speed*drive)));
      const texture=sprites[kind][variant][0];
      const height = width * texture.height / texture.width;
      if(f.food&&!pellets.includes(f.food))f.food=null;
      if(f.food&&!f.forage&&time>=(f.noticeAt||0)){
        f.forage={x:f.screen?.x??x,y:f.screen?.y??y,angle:heading>0?pitch:Math.PI-pitch,
          speed:w*f.speed,stage:'approach',at:time,approachAt:time,homeY:f.y,w,h};
      }
      if(f.forage){
        const g=f.forage;
        if(g.w!==w||g.h!==h){g.x*=w/g.w;g.y*=h/g.h;g.w=w;g.h=h;}
        const nose=width*.40,cruiseSpeed=w*f.speed;
        let wantedAngle=g.angle,wantedSpeed=cruiseSpeed;
        if(f.food){
          const p=f.food;
          const mouthX=g.x+Math.cos(g.angle)*nose,mouthY=g.y+Math.sin(g.angle)*nose;
          const mouthDistance=Math.hypot(p.x*w-mouthX,p.y*h-mouthY);
          const targetAngle=Math.atan2(p.y*h-g.y,p.x*w-g.x);
          const alignment=Math.abs(wrapAngle(targetAngle-g.angle));
          wantedAngle=targetAngle;
          // Approach with bounded turning and acceleration. Brake before the
          // short suction strike, instead of swallowing food through the belly.
          wantedSpeed=clamp(mouthDistance*1.25,14*unit,(55+width/unit*.45)*unit)*Math.max(.18,1-alignment/Math.PI);
          if(g.stage==='approach'&&!p.winner&&mouthDistance<18*unit&&alignment<.30){p.winner=f;g.stage='strike';g.strikeAt=time;}
          if(g.stage==='strike'&&p.winner===f){
            wantedSpeed=8*unit;p.suction=true;
            const pull=1-Math.exp(-foodDt*15);
            p.x+=(mouthX/w-p.x)*pull;p.y+=(mouthY/h-p.y)*pull;
            if(time-g.strikeAt>.16&&mouthDistance<10*unit){
              lastCapture={mouthDistance:mouthDistance/unit,bodyLength:width/unit,kind,manual:p.manual};
              // Resolve once. Other contenders coast toward the now-empty spot,
              // pause in surprise, then leave with a disappointed expression.
              pellets.splice(pellets.indexOf(p),1);
              for(const other of [...p.contenders])if(other!==f)loseFood(other,true);
              p.contenders=[];f.food=null;p.winner=null;
              f.reaction={tier:p.tier,at:time};eaten[p.tier]++;f.foodCooldown=time+6;
              g.stage='depart';g.at=time;
            }
          }
          if(f.food&&g.stage==='approach'&&time-g.approachAt>11)loseFood(f,false);
        }else{
          if(g.stage!=='depart'&&g.stage!=='missed'){g.stage='depart';g.at=time;}
          const side=Math.cos(g.angle)>=0?1:-1;
          // Coast away and arc back into open water, then rebase the patrol at
          // the exact current position so there is no elastic snap home.
          const depthError=clamp(g.homeY,.16,.86)*h-g.y;
          wantedAngle=time-g.at<.65?(side>0?.25:Math.PI-.25):Math.atan2(depthError,side*w*.07);
          wantedSpeed=time-g.at<.35?cruiseSpeed*.4:cruiseSpeed+Math.min(70*unit,Math.abs(depthError)*.9);
          if(g.stage==='missed'&&time-g.at<.85){
            wantedAngle=g.angle;wantedSpeed=time-g.at<.25?g.speed*.65:0;
          }else if(g.stage==='missed'){g.stage='depart';g.at=time;}
        }
        // Long-bodied fish need a wider arc and more time to rotate.
        const turnRate=kind==='arowana'?1.15:kind==='seahorse'?1.5:2.1;
        const angleStep=clamp(wrapAngle(wantedAngle-g.angle),-foodDt*turnRate,foodDt*turnRate);
        g.angle+=angleStep;g.speed+=clamp(wantedSpeed-g.speed,-unit*(kind==='arowana'?85:130)*foodDt,unit*(kind==='arowana'?55:95)*foodDt);
        g.x+=Math.cos(g.angle)*g.speed*foodDt;g.y+=Math.sin(g.angle)*g.speed*foodDt;
        x=g.x;y=g.y;heading=Math.cos(g.angle)>=0?1:-1;
        pitch=Math.atan2(Math.sin(g.angle),Math.abs(Math.cos(g.angle)));
        // Pitch rotates the intact side profile; it is not a camera yaw.
        // Preserve body proportions even during a steep ascent.
        if(!f.food&&time-g.at>1.8&&Math.abs(g.y-clamp(g.homeY,.16,.86)*h)<h*.035&&Math.abs(Math.sin(g.angle))<.20){
          f.direction=heading;f.x=x/w-heading*cruise*f.speed;
          f.y=y/h-Math.sin(pathPhase)*arc-Math.sin(pathPhase*.47+f.phase)*arc*.35;
          f.turn=0;f.forage=null;
        }
      }
      f.screen={x,y,heading};
      const reaction=f.reaction,age=reaction?time-reaction.at:99;
      if(reaction&&age<5){
        if(reaction.tier==='astra')y-=Math.sin(Math.min(1,age/5)*Math.PI)*h*.018;
        if(reaction.tier==='terra')y+=Math.sin(age*15)*unit*2;
        if(reaction.tier==='luna'){
          y+=Math.sin(age*11)*unit*4;
          if(age>.7&&!reaction.vomited){reaction.vomited=true;vomitBursts++;effects.push({x:(x+heading*Math.cos(pitch)*width*.4)/w,y:(y+Math.sin(pitch)*width*.4)/h,angle:heading>0?pitch:Math.PI-pitch,at:time});}
        }
      }
      // Paint opaque fish from far to near so the nearer body occludes the farther one.
      context.save(); context.globalAlpha = 1;
      context.translate(x,y); context.scale(heading, 1);
      context.rotate(pitch+Math.sin(beat)*(['puffer','seahorse'].includes(kind)?.003:.009));
      const pose=Math.floor(((beat/(Math.PI*2))%1+1)%1*poseCount);
      if(age<5&&reaction?.tier==='luna')context.filter='sepia(1) saturate(3) hue-rotate(45deg)';
      if(age<5&&reaction?.tier==='astra'){context.shadowColor='#ffe598';context.shadowBlur=18*unit;}
      context.drawImage(sprites[kind][variant][pose],-width / 2,-height / 2,width,height); context.restore();
      const disappointed=f.disappointment,disappointedAge=disappointed?time-disappointed.at:99;
      if(disappointedAge>=0&&disappointedAge<2.6){
        context.save();context.globalAlpha=Math.min(1,(2.6-disappointedAge)*2)*.35;
        emoji('🥺💨',Math.max(40*unit,Math.min(w-40*unit,x)),Math.max(24*unit,y-height/2-12*unit),unit);context.restore();
      }
      if(age<5&&reaction){
        context.save();context.globalAlpha=Math.min(1,(5-age)*2)*.35;
        emoji(reactionEmoji[reaction.tier],Math.max(75*unit,Math.min(w-75*unit,x)),Math.max(24*unit,y-height/2-12*unit),unit);context.restore();
      }
    }
    drawFood(w,h,unit);
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
    feed,previewFood,
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
      feeding:{receivedTokens,droppedFood,manualPellets,vomitBursts,lastCapture,pellets:pellets.length,eaten:{...eaten},
        motionModel:'contest-strike-miss-retreat',competition:{maxContenders:3,contestedPellets,lostRaces,missedAttempts,expiredFood,
          chasing:pellets.map(p=>p.contenders.length),disappointed:fish.filter(f=>f.disappointment&&time>=f.disappointment.at&&time-f.disappointment.at<2.6).length},foodShape:'engraved-token-chip',reactionEmoji:{...reactionEmoji},
        foraging:fish.filter(f=>f.forage).length,
        reactions:fish.filter(f=>f.reaction&&time-f.reaction.at<5).map(f=>f.reaction.tier)},
      ornamentCache:{entries:ornamentCache.size,kiB:Number((ornamentBytes/1024).toFixed(1))},
      spriteMiB:Number((spriteBytes/1048576).toFixed(2))}),
    dispose() {
      disposed = true;for(const item of ornamentCache.values()){item.width=0;item.height=0;}ornamentCache.clear();ornamentBytes=0;pellets.length=0;effects.length=0;stop(); observer?.disconnect();
      document.removeEventListener('visibilitychange',visibility); reduced.removeEventListener('change',visibility);
      for(const atlas of atlasImages){atlas.onload=null;atlas.onerror=null;atlas.src='';}atlasImages.clear();
      canvas?.remove(); plate?.remove(); sprites = null; context = null;
    }
  };
}
