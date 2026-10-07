// Self-contained: serialized into the renderer alongside the theme panel.
export function createAquariumLayer(container) {
  let canvas, context, observer, sprites;
  let active = false, motion = true, disposed = false, timer = null;
  let time = 0, lastTick = 0, frames = 0, drawTime = 0;
  const fps = 18, maxWidth = 960, maxHeight = 640;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The large, distant silhouette moves slowly; small fish share a loose school.
  const fish = [
    {kind:'whale', x:.69, y:.38, size:450, speed:.007, direction:-1, alpha:.23, phase:2},
    {kind:'arowana', x:.12, y:.23, size:290, speed:.014, direction:1, alpha:.55, phase:0},
    {kind:'arowana', x:.78, y:.73, size:220, speed:.011, direction:-1, alpha:.31, phase:3},
    {kind:'angel', x:.22, y:.63, size:112, speed:.009, direction:1, alpha:.42, phase:1},
    {kind:'angel', x:.33, y:.72, size:85, speed:.010, direction:1, alpha:.31, phase:4},
    {kind:'angel', x:.81, y:.43, size:98, speed:.009, direction:-1, alpha:.37, phase:2},
    ...Array.from({length:8}, (_, i) => ({kind:'small', x:.31 + (i % 4) * .052,
      y:.38 + Math.floor(i / 4) * .065 + Math.sin(i * 2) * .024,
      size:42 + (i % 3) * 9, speed:.020 + (i % 3) * .0006,
      direction:1, alpha:.30 + (i % 3) * .09, phase:i * 1.7}))
  ];
  const bubbles = Array.from({length:20}, (_, i) => ({
    x:[.10,.87,.72][i % 3] + Math.sin(i * 13) * .028,
    phase:(i * .173) % 1, speed:.017 + (i % 4) * .003,
    radius:1.4 + (i % 4) * .8, sway:i * 2.3
  }));
  const shapes = {
    small:'M54 61 Q116 21 207 57 Q226 62 207 69 Q119 109 54 67 L18 94 Q29 64 18 35 Z',
    arowana:'M47 62 C89 42 177 41 224 55 L240 53 L232 61 Q221 76 191 79 L96 80 Q68 78 47 69 L15 88 Q24 65 15 43 Z M90 50 Q145 25 198 47 M85 79 Q136 100 190 79 M229 55 L245 46 L239 56',
    angel:'M69 64 Q97 45 123 37 L160 9 L151 48 Q183 56 197 65 Q184 74 153 82 L153 115 L120 92 Q101 85 69 71 L35 91 L44 65 L35 39 Z M117 88 Q109 114 103 122 L120 92',
    whale:'M48 60 C72 44 126 33 183 38 Q219 41 229 61 Q233 82 203 88 Q146 102 96 86 L68 105 L84 81 L48 70 L16 93 L28 64 L16 35 Z M146 39 L160 25 L169 39'
  };
  function makeSprites() {
    const result = {};
    for (const [kind, shape] of Object.entries(shapes)) {
      const sprite = document.createElement('canvas'); sprite.width = 280; sprite.height = 144;
      const ctx = sprite.getContext('2d');
      ctx.translate(12, 8);
      // Blur is baked only once into four small textures, never into a full frame.
      ctx.filter = `blur(${kind === 'whale' ? 5 : kind === 'small' ? 2 : 3}px)`;
      const ink = ctx.createLinearGradient(0, 20, 0, 110);
      ink.addColorStop(0, kind === 'whale' ? '#032e40' : '#a5d8d2');
      ink.addColorStop(.42, kind === 'arowana' ? '#c5e2df' : kind === 'whale' ? '#092d41' : '#438d98');
      ink.addColorStop(1, '#104d66'); ctx.fillStyle = ink;
      ctx.fill(new Path2D(shape));
      result[kind] = sprite;
    }
    const bubble = document.createElement('canvas'); bubble.width = bubble.height = 24;
    const ctx = bubble.getContext('2d'); ctx.filter = 'blur(.65px)';
    ctx.strokeStyle = '#afdedb80'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(12,12,7,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#e0f5e5aa'; ctx.beginPath(); ctx.arc(12,12,5.5,3.7,4.8); ctx.stroke();
    result.bubble = bubble;
    return result;
  }
  function ensure() {
    if (canvas) return;
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
      const x = cycle * w, y = (f.y + Math.sin(time * .31 + f.phase) * .018) * h;
      const width = f.size * unit, height = width * 144 / 280;
      context.save(); context.globalAlpha = f.alpha;
      context.translate(x,y); context.scale(f.direction, 1 + Math.sin(time * 1.3 + f.phase) * .025);
      context.rotate(Math.cos(time * .31 + f.phase) * .025);
      context.drawImage(sprites[f.kind],-width / 2,-height / 2,width,height); context.restore();
    }
    for (const b of bubbles) {
      const progress = (b.phase + time * b.speed) % 1;
      const x = (b.x + Math.sin(time * .55 + b.sway) * .008) * w;
      const y = (1.06 - progress * 1.15) * h, size = b.radius * unit * 5;
      context.globalAlpha = Math.min(1,progress * 5,(1-progress) * 5) * .53;
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
    if (!active || disposed || document.hidden) return;
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
      if (changed) sync();
    },
    getDiagnostics:() => ({active,running:timer !== null,motion,reducedMotion:reduced.matches,
      fpsLimit:fps,frames,averageDrawMs:frames ? Number((drawTime/frames).toFixed(3)) : 0,
      canvasWidth:canvas?.width || 0,canvasHeight:canvas?.height || 0,fishCount:fish.length,bubbleCount:bubbles.length}),
    dispose() {
      disposed = true; stop(); observer?.disconnect();
      document.removeEventListener('visibilitychange',visibility); reduced.removeEventListener('change',visibility);
      canvas?.remove(); sprites = null; context = null;
    }
  };
}
