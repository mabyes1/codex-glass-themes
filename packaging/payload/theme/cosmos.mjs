// Self-contained: serialized into the renderer by the theme host.
export function createCosmosLayer(container, galaxyURL = '') {
  const fps = 18, maxWidth = 960, maxHeight = 640, tau = Math.PI * 2;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, motion = true, disposed = false;
  let canvas = null, plate = null, ctx = null, observer = null, image = null;
  let timer = null, lastTick = 0, time = 0, frames = 0, drawTime = 0, imageReady = false, imageError = null;
  let seed = 7193;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const stars = Array.from({length:110}, () => ({x:random(),y:random(),size:.45+random()*1.1,phase:random()*tau,speed:.3+random()*.6}));
  const dust = Array.from({length:32}, () => ({x:random(),y:random(),phase:random()*tau}));
  function glow(c,x,y,r,color,strength=1) {
    const g=c.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,`rgba(${color},${strength})`);g.addColorStop(.22,`rgba(${color},${strength*.25})`);g.addColorStop(1,`rgba(${color},0)`);
    c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);
  }
  function bake() {
    if(!plate)return;
    const c=plate.getContext('2d'),w=plate.width,h=plate.height;
    const sky=c.createLinearGradient(0,0,w,h);
    sky.addColorStop(0,'#080b1c');sky.addColorStop(1,'#01040b');
    c.fillStyle=sky;c.fillRect(0,0,w,h);
    if(imageReady){
      const s=Math.max(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*s,ih=image.naturalHeight*s;
      c.drawImage(image,(w-iw)/2,(h-ih)/2,iw,ih);
      c.fillStyle='rgba(2,5,17,.16)';c.fillRect(0,0,w,h);
    } else {
      glow(c,w*.72,h*.28,w*.6,'51,38,70',.25);
      for(let i=0;i<430;i++){
        const x=((i*0.61803398875)%1)*w,y=((i*i*.38196601125)%1)*h;
        c.fillStyle=`rgba(196,213,240,${.08+(i%7)*.055})`;c.fillRect(x,y,i%19===0?1.1:.6,i%19===0?1.1:.6);
      }
    }
    const vignette=c.createRadialGradient(w*.55,h*.4,h*.2,w*.55,h*.4,w*.8);
    vignette.addColorStop(0,'#01030a00');vignette.addColorStop(1,'#01030a9c');
    c.fillStyle=vignette;c.fillRect(0,0,w,h);
  }
  function loadImage() {
    if(!galaxyURL||image)return;
    const pending=new Image();image=pending;imageError=null;
    pending.onload=()=>{if(disposed||!active||image!==pending)return;imageReady=true;bake();draw();};
    pending.onerror=()=>{if(image===pending)imageError='Galaxy background could not be decoded';};
    pending.src=galaxyURL;
  }
  function releaseImage(){if(image){image.onload=null;image.onerror=null;image.src='';image=null;}imageReady=false;}
  function resize() {
    if(!canvas)return;
    const bounds=container.getBoundingClientRect();
    const scale=Math.min(1,maxWidth/Math.max(1,bounds.width),maxHeight/Math.max(1,bounds.height));
    const w=Math.max(1,Math.round(bounds.width*scale)),h=Math.max(1,Math.round(bounds.height*scale));
    if(canvas.width!==w||canvas.height!==h){canvas.width=plate.width=w;canvas.height=plate.height=h;bake();}
  }
  function ensure() {
    if(canvas)return;
    canvas=document.createElement('canvas');canvas.dataset.glassCosmos='';canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    plate=document.createElement('canvas');ctx=canvas.getContext('2d',{alpha:false});container.append(canvas);
    resize();bake();loadImage();
    observer=new ResizeObserver(()=>{if(active&&!document.hidden){resize();draw();}});observer.observe(container);
  }
  function comet(w,h) {
    // One long, quiet pass every 26 seconds; simulation time freezes on pause.
    const cycle=(time+4)%26;if(cycle>6)return;
    const p=cycle/6,x=(1.08-p*1.4)*w,y=(.08+p*.52)*h;
    const fade=Math.min(1,p*7,(1-p)*6),len=w*.16;
    ctx.globalAlpha=fade*.75;
    const tail=ctx.createLinearGradient(x,y,x+len,y-len*.37);
    tail.addColorStop(0,'#e7f6ff');tail.addColorStop(.12,'#a1cfffaa');tail.addColorStop(1,'#6484e000');
    ctx.strokeStyle=tail;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+len,y-len*.37);ctx.stroke();
    glow(ctx,x,y,7,'187,226,255',.85);ctx.globalAlpha=1;
  }
  function draw() {
    if(!active||disposed||!ctx)return;
    const start=performance.now(),w=canvas.width,h=canvas.height;
    ctx.globalAlpha=1;ctx.drawImage(plate,0,0);
    for(const s of stars){
      const x=s.x*w,y=s.y*h;
      ctx.globalAlpha=.16+.48*(.5+.5*Math.sin(time*s.speed+s.phase));ctx.fillStyle='#d9eaff';
      ctx.fillRect(x,y,s.size,s.size);
    }
    ctx.globalAlpha=1;
      for(const d of dust){
        const x=((d.x+time*.0009)%1)*w,y=(d.y+Math.sin(time*.06+d.phase)*.008)*h;
        ctx.fillStyle='rgba(174,178,232,.28)';ctx.fillRect(x,y,1.3,1.3);
      }
    comet(w,h);
    frames++;drawTime+=performance.now()-start;
  }
  function stop(){clearTimeout(timer);timer=null;lastTick=0;}
  function shouldRun(){return active&&motion&&!document.hidden&&!reduced.matches&&!disposed;}
  function tick(){
    timer=null;if(!shouldRun())return;
    const now=performance.now();if(lastTick)time+=Math.min(.2,(now-lastTick)/1000);lastTick=now;
    draw();timer=setTimeout(tick,1000/fps);
  }
  function sync(){stop();if(!active||disposed)return;resize();draw();if(shouldRun())timer=setTimeout(tick,1000/fps);}
  function release(){
    stop();observer?.disconnect();observer=null;releaseImage();
    if(canvas){canvas.remove();canvas.width=canvas.height=1;}
    if(plate)plate.width=plate.height=1;
    canvas=null;plate=null;ctx=null;
  }
  const visibility=()=>{if(document.hidden)stop();else sync();};
  document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);
  return {
    setActive(value,animate=true){
      if(disposed)return;
      const changed=active!==value||motion!==animate;
      active=value;motion=animate;
      if(!active){release();return;}
      ensure();
      if(changed)sync();
    },
    getDiagnostics:()=>({active,scene:'galaxy',motion,running:timer!==null,reducedMotion:reduced.matches,fpsLimit:fps,frames,
      averageDrawMs:frames?Number((drawTime/frames).toFixed(3)):0,canvasWidth:canvas?.width||0,canvasHeight:canvas?.height||0,
      rasterMiB:Number(((canvas?canvas.width*canvas.height*8:0)/1048576).toFixed(2)),imageReady,imageError}),
    dispose(){disposed=true;active=false;release();document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);}
  };
}
