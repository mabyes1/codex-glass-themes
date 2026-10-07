// Self-contained: serialized into the renderer alongside the theme panel.
export function createAquariumLayer(container, backdropURL = '') {
  let canvas, context, observer, sprites, plate;
  let active = false, motion = true, disposed = false, timer = null;
  let time = 0, lastTick = 0, frames = 0, drawTime = 0;
  const fps = 18, maxWidth = 960, maxHeight = 640;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The large, distant silhouette moves slowly; small fish share a loose school.
  const fish = [
    {kind:'whale', x:.61, y:.48, size:380, speed:.0038, direction:-1, alpha:.30, phase:2},
    {kind:'arowana', x:.18, y:.25, size:218, speed:.008, direction:1, alpha:.50, phase:0},
    {kind:'arowana', x:.79, y:.69, size:258, speed:.006, direction:-1, alpha:.42, phase:3},
    {kind:'angel', x:.18, y:.70, size:72, speed:.005, direction:1, alpha:.30, phase:1},
    {kind:'angel', x:.26, y:.76, size:55, speed:.006, direction:1, alpha:.23, phase:4},
    {kind:'angel', x:.84, y:.36, size:67, speed:.005, direction:-1, alpha:.27, phase:2},
    ...Array.from({length:8}, (_, i) => ({kind:'small', x:.31 + (i % 4) * .052,
      y:.38 + Math.floor(i / 4) * .065 + Math.sin(i * 2) * .024,
      size:26 + (i % 3) * 6, speed:.012 + (i % 3) * .0003,
      direction:1, alpha:.22 + (i % 3) * .045, phase:i * 1.7}))
  ];
  const bubbles = Array.from({length:20}, (_, i) => ({
    x:[.07,.92,.76][i % 3] + Math.sin(i * 13) * .018,
    phase:(i * .173) % 1, speed:.011 + (i % 4) * .002,
    radius:.55 + (i % 4) * .32, sway:i * 2.3
  }));
  const shapes = {
    small:'M53 62 Q127 40 192 56 Q210 62 220 65 Q180 88 117 77 Q75 69 53 68 Z',
    arowana:'M44 65 C75 55 109 44 170 46 Q208 46 229 54 L240 51 Q237 57 230 60 Q214 74 180 76 C118 81 76 72 44 69 Z',
    angel:'M64 64 C90 63 109 45 127 43 C145 42 170 54 191 65 C172 79 149 88 131 88 C108 86 88 70 64 70 Z',
    whale:'M47 63 C80 52 103 35 157 36 C198 34 226 43 233 59 Q239 80 212 84 C151 102 100 88 67 73 L47 70 Z'
  };
  const fins = {
    small:'M116 51 Q128 37 146 48 M110 76 L133 86 L139 77',
    arowana:'M78 56 Q107 39 171 41 L196 48 M72 71 Q105 88 178 82 L205 72 M184 66 Q177 85 167 88 L173 70 M232 54 Q243 43 248 45',
    angel:'M100 53 Q136 26 146 12 Q148 31 160 52 M107 82 Q134 107 148 116 Q145 95 162 80 M127 83 Q124 111 115 125 M136 84 Q139 108 133 124',
    whale:'M132 39 Q142 23 153 23 L160 38 M142 81 Q127 108 111 109 L120 80'
  };
  function makeSprites() {
    const result = {};
    for (const [kind, shape] of Object.entries(shapes)) {
      result[kind] = [];
      for (let pose = 0; pose < 5; pose++) {
      const sprite = document.createElement('canvas'); sprite.width = 280; sprite.height = 144;
      const ctx = sprite.getContext('2d');
      ctx.translate(12, 8);
      // Five tail poses are baked once. The render loop only draws cached images.
      ctx.filter = `blur(${kind === 'whale' ? 5 : kind === 'small' ? 2 : 1.6}px)`;
      const ink = ctx.createLinearGradient(0, 39, 0, 88);
      ink.addColorStop(0, kind === 'whale' ? '#17394a' : '#85b6c5');
      ink.addColorStop(.22, kind === 'arowana' ? '#9bc5d1' : kind === 'whale' ? '#102a3a' : '#3c718b');
      ink.addColorStop(.48, kind === 'whale' ? '#0b1e2e' : '#254d68');
      ink.addColorStop(1, '#071a2e'); ctx.fillStyle = ink;
      const sway=(pose-2)*2.1, neck=kind==='angel'?70:54, tail=kind==='angel'?37:17;
      ctx.globalAlpha=.60;
      ctx.fill(new Path2D(`M${neck} 63 Q38 60 ${tail} ${45+sway} Q${tail+7} 62 ${tail-1} ${87+sway} Q38 74 ${neck} 69 Z`));
      ctx.globalAlpha=.46;ctx.fill(new Path2D(fins[kind]));
      ctx.globalAlpha=1;
      ctx.fill(new Path2D(shape));
      if (kind === 'arowana') {
        ctx.strokeStyle='#bee4ed';ctx.lineWidth=.8;ctx.globalAlpha=.48;
        ctx.stroke(new Path2D('M61 62 Q143 35 218 53'));
        ctx.globalAlpha=.23;ctx.stroke(new Path2D('M211 55 Q201 64 205 71'));
        ctx.fillStyle='#061423';ctx.globalAlpha=.65;ctx.beginPath();ctx.arc(221,56,1.2,0,Math.PI*2);ctx.fill();
      }
      result[kind].push(sprite);
      }
    }
    const bubble = document.createElement('canvas'); bubble.width = bubble.height = 24;
    const ctx = bubble.getContext('2d'); ctx.filter = 'blur(.65px)';
    ctx.strokeStyle = '#7cbbd03b'; ctx.lineWidth = .85;
    ctx.beginPath(); ctx.arc(12,12,7,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#b9e4f0a0'; ctx.beginPath(); ctx.arc(12,12,5.5,3.7,4.8); ctx.stroke();
    result.bubble = bubble;
    return result;
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
      const cycle = ((f.x + .25 + f.direction * time * f.speed) % 1.5 + 1.5) % 1.5 - .25;
      const x = cycle * w, y = (f.y + Math.sin(time * .20 + f.phase) * .012) * h;
      const width = f.size * unit, height = width * 144 / 280;
      const passingLight=.58+.42*Math.max(0,1-Math.abs(cycle-.36)*1.7);
      context.save(); context.globalAlpha = f.alpha*passingLight;
      context.translate(x,y); context.scale(f.direction, 1);
      context.rotate(Math.cos(time * .20 + f.phase) * .018);
      const pose=Math.max(0,Math.min(4,Math.round(2+2*Math.sin(time*(f.kind==='whale'?.7:1.8)+f.phase))));
      context.drawImage(sprites[f.kind][pose],-width / 2,-height / 2,width,height); context.restore();
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
  function sync() {
    stop();
    if (!active || disposed) return;
    // Keep a complete still scene on first mount, even in a hidden window.
    if (document.hidden) { if (!frames) { resize(); draw(); } return; }
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
      canvasWidth:canvas?.width || 0,canvasHeight:canvas?.height || 0,fishCount:fish.length,bubbleCount:bubbles.length,hasBackdrop:!!plate}),
    dispose() {
      disposed = true; stop(); observer?.disconnect();
      document.removeEventListener('visibilitychange',visibility); reduced.removeEventListener('change',visibility);
      canvas?.remove(); plate?.remove(); sprites = null; context = null;
    }
  };
}
