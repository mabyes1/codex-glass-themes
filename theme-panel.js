// Runs only in the Codex main renderer. Images stay in local IndexedDB.
(function installGlass(css, appearanceFor) {
  window.__kenGlassPanel?.dispose(false);
  for (const id of ['ken-desktop-test', 'ken-glass-foreground', 'ken-glass-background', 'ken-glass-switcher']) {
    document.getElementById(id)?.remove();
  }
  const root = document.documentElement;
  if (window.__kenGlassOriginalTheme === undefined) window.__kenGlassOriginalTheme = root.getAttribute('data-theme');
  const key = 'ken-glass-preferences-v1';
  const firstColors = {base:'#111d30', left:'#3b91b3', right:'#7e55a7'};
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { saved = {}; }
  const prefs = {mode:'clear', opacity:82, keepForeground:true, backgroundOpacity:45, backgroundBlur:false, imageShade:28, ...saved};
  prefs.mode = {desktop:'clear', silver:'clear', blue:'color'}[prefs.mode] || prefs.mode;
  if (!['clear', 'color', 'image', 'original'].includes(prefs.mode)) prefs.mode = 'clear';
  const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  prefs.opacity = number(prefs.opacity, 55, 100, 82);
  prefs.backgroundOpacity = number(prefs.backgroundOpacity, 0, 100, 45);
  prefs.imageShade = number(prefs.imageShade, 0, 65, 28);
  prefs.keepForeground = prefs.keepForeground === true;
  prefs.backgroundBlur = prefs.backgroundBlur === true;
  prefs.colors = {...firstColors, ...saved?.colors};
  for (const k of Object.keys(firstColors)) {
    if (!/^#[0-9a-f]{6}$/i.test(prefs.colors[k])) prefs.colors[k] = firstColors[k];
  }
  let imageURL = '', disposed = false, expectedTheme = 'dark', nativeSignature = '', nativeFailed = false, nativePending = false;
  let style = document.getElementById('ken-codex-glass');
  if (!style) { style = document.createElement('style'); style.id = 'ken-codex-glass'; document.head.append(style); }
  const background = document.createElement('div');
  background.id = 'ken-glass-background'; background.setAttribute('aria-hidden', 'true');
  document.body.prepend(background);
  const host = document.createElement('div'); host.id = 'ken-glass-switcher';
  host.style.cssText = 'position:fixed;top:8px;right:160px;z-index:2147483000;-webkit-app-region:no-drag;';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>
    :host{font:13px/1.5 "Segoe UI","Microsoft JhengHei",sans-serif;color:var(--kg-primary,#f7f8fa);color-scheme:var(--kg-scheme,dark);text-shadow:none}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;color:inherit}[hidden]{display:none!important}
    #toggle{padding:4px 12px;border:1px solid var(--kg-stroke,#ffffff30);border-radius:20px;background:var(--kg-menu,#242629);box-shadow:inset 0 1px 0 var(--kg-gleam,#ffffff30);-webkit-app-region:no-drag}
    #panel{position:absolute;right:0;top:37px;width:310px;padding:16px;border-radius:18px;background:var(--kg-menu,#242629);border:1px solid var(--kg-stroke,#ffffff30);box-shadow:inset 0 1px 0 var(--kg-gleam,#ffffff30),0 16px 48px #0004;max-height:calc(100vh - 70px);overflow:auto}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}header strong{font-size:15px}#close{background:none;border:0;font-size:20px;line-height:1;padding:4px}
    .choices{display:grid;gap:7px}.choice{display:flex;align-items:center;gap:11px;background:transparent;border:1px solid var(--kg-stroke,#ffffff30);border-radius:11px;padding:10px;text-align:left}
    .choice:hover,.action:hover{background:var(--kg-hover,#ffffff14)}.choice[aria-pressed=true]{border-color:var(--kg-focus,#abd1fc);background:var(--kg-selected,#ffffff20)}
    .choice strong{font-size:13px;font-weight:600}.choice .description{display:block;font-size:11px;color:var(--kg-secondary,#e1e4e9);margin-top:2px}
    .swatch{width:35px;height:35px;border-radius:9px;flex:none;border:1px solid #ffffff50;box-shadow:inset 0 1px 0 #fff8}
    #swatch-clear{background:linear-gradient(135deg,#ffffff30,#ffffff08),repeating-conic-gradient(#555 0% 25%,#747474 0% 50%) 0 0/12px 12px}
    #swatch-color{background:radial-gradient(at 0% 10%,#3b91b3,transparent 75%),radial-gradient(at 100% 100%,#7e55a7,transparent 80%),#111d30}
    #swatch-image{background:linear-gradient(165deg,#8297a9 45%,#546d69 46%,#304541 75%,#283533 76%);background-size:cover;background-position:center}
    .control{margin-top:14px;padding-top:12px;border-top:1px solid var(--kg-stroke,#ffffff30)}label{display:flex;align-items:center;justify-content:space-between;gap:8px}
    output,.note,#status{color:var(--kg-secondary,#e1e4e9)}input[type=range]{width:100%;accent-color:var(--kg-focus,#abd1fc);margin-top:9px}
    input[type=checkbox]{accent-color:var(--kg-focus,#abd1fc)}.note{font-size:11px;margin:6px 0 0;line-height:1.6}
    .palette{display:flex;gap:10px}.palette label{display:block;flex:1;font-size:11px}.palette input{display:block;width:100%;height:32px;border:1px solid var(--kg-stroke,#ffffff30);border-radius:7px;padding:2px;margin-top:5px;background:transparent}
    .action{width:100%;border:1px solid var(--kg-stroke,#ffffff30);border-radius:9px;padding:7px;background:transparent;margin-top:9px}
    #status{min-height:17px;font-size:11px;margin-top:12px}#original{background:none;border:0;color:var(--kg-secondary,#e1e4e9);font-size:11px;padding:9px 0 0}
    button:focus-visible,input:focus-visible{outline:2px solid var(--kg-focus,#abd1fc);outline-offset:2px}
  </style>
  <button id="toggle" aria-expanded="false" aria-label="開啟佈景切換器">◈ 佈景</button>
  <section id="panel" hidden aria-label="佈景切換器">
    <header><strong>玻璃佈景</strong><button id="close" aria-label="關閉">×</button></header>
    <div class="choices">
      <button class="choice" data-mode="clear"><span class="swatch" id="swatch-clear" aria-hidden="true"></span><span><strong>無色透明玻璃</strong><span class="description">中性透明 · 亮面邊緣與白色前景</span></span></button>
      <button class="choice" data-mode="color"><span class="swatch" id="swatch-color" aria-hidden="true"></span><span><strong>多色玻璃</strong><span class="description">自訂三色光暈 · 介面配色一起調整</span></span></button>
      <button class="choice" data-mode="image"><span class="swatch" id="swatch-image" aria-hidden="true"></span><span><strong>圖片玻璃</strong><span class="description">照片背景 · 中性深色玻璃與白字</span></span></button>
    </div>
    <div class="control" id="palette-control" hidden>
      <div class="palette"><label>底色<input id="color-base" type="color"></label><label>左側光暈<input id="color-left" type="color"></label><label>右側光暈<input id="color-right" type="color"></label></div>
      <button class="action" id="reset-colors">還原第一版配色</button><p class="note">底色較亮時自動使用深色字；卡片與輸入框沿用同一組色調。</p>
    </div>
    <div class="control" id="desktop-control">
      <label for="keep-foreground">保持前景清晰<input id="keep-foreground" type="checkbox"></label>
      <label for="opacity" style="margin-top:12px"><span id="opacity-label">背景不透明度</span><output id="opacity-value"></output></label><input id="opacity" type="range" min="0" max="100" step="1"><p class="note" id="opacity-note"></p>
      <label id="blur-control" for="background-blur" style="margin-top:10px">模糊背後背景（Acrylic）<input id="background-blur" type="checkbox"></label>
    </div>
    <div class="control" id="image-control" hidden>
      <button class="action" id="choose">選擇圖片…</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden>
      <label for="shade" style="margin-top:12px">圖片暗化<output id="shade-value"></output></label><input id="shade" type="range" min="0" max="65">
      <p class="note">圖片只存在本機。支援 PNG、JPG、WebP、AVIF，最大 12 MB。</p>
    </div>
    <div id="status" role="status"></div><button id="original">還原原始外觀</button>
  </section>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  const save = () => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { $('status').textContent = '目前可用，但無法儲存偏好。'; } };
  function restoreTheme() {
    root.removeAttribute('data-ken-glass');
    const t = window.__kenGlassOriginalTheme;
    t === null ? root.removeAttribute('data-theme') : root.setAttribute('data-theme', t);
  }
  function status() {
    $('status').textContent = prefs.mode === 'original' ? '已還原原始外觀' :
      prefs.keepForeground ? `前景清晰 · 背景 ${prefs.backgroundOpacity}% · ${prefs.backgroundBlur ? 'Acrylic' : '清透玻璃'}` : `共用視窗不透明度 · ${prefs.opacity}%`;
  }
  function native(force = false) {
    const value = {mode:prefs.mode === 'original' ? 'restore' : prefs.keepForeground ? 'background' : prefs.opacity === 100 ? 'restore' : 'set', opacity:prefs.keepForeground ? 100 : prefs.opacity, blur:prefs.backgroundBlur};
    const signature = JSON.stringify(value);
    if (!force && signature === nativeSignature) { if (!nativeFailed) status(); return; }
    if (typeof window.__kenGlassNative !== 'function') { $('status').textContent = '透明度助手未連線，請執行桌面啟動器。'; return; }
    nativeSignature = signature;
    nativePending = true;
    window.__kenGlassNative(signature);
  }
  function apply(updateNative = true) {
    const mode = prefs.mode;
    let themeChanged = false;
    if (mode === 'original') {
      style.textContent = ''; background.hidden = true; restoreTheme();
    } else {
      const appearance = appearanceFor(prefs, imageURL);
      themeChanged = expectedTheme !== appearance.theme;
      expectedTheme = appearance.theme;
      // Build directly from preferences, never from the current app's computed
      // background (which can be midway through a native theme transition).
      style.textContent = `html[data-ken-glass]{${Object.entries(appearance.variables).map(([k,v]) => `${k}:${v};`).join('')}}\n${css}`;
      root.setAttribute('data-ken-glass', mode);
      root.setAttribute('data-theme', expectedTheme);
      background.style.background = appearance.background;
      background.style.opacity = String(prefs.keepForeground && !nativeFailed ? prefs.backgroundOpacity / 100 : 1);
      background.hidden = false;
      $('swatch-color').style.background = appearanceFor({...prefs,mode:'color'}).background;
      if (imageURL) $('swatch-image').style.backgroundImage = `url(${JSON.stringify(imageURL)})`;
    }
    shadow.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('desktop-control').hidden = mode === 'original';
    $('palette-control').hidden = mode !== 'color'; $('image-control').hidden = mode !== 'image';
    for (const k of Object.keys(firstColors)) $('color-' + k).value = prefs.colors[k];
    $('keep-foreground').checked = prefs.keepForeground; $('background-blur').checked = prefs.backgroundBlur;
    $('blur-control').hidden = !prefs.keepForeground;
    $('opacity').min = prefs.keepForeground ? '0' : '55';
    $('opacity').value = prefs.keepForeground ? prefs.backgroundOpacity : prefs.opacity;
    $('opacity-value').textContent = $('opacity').value + '%';
    $('opacity-label').textContent = prefs.keepForeground ? '背景不透明度' : '視窗不透明度';
    $('opacity-note').textContent = prefs.keepForeground ? '三種佈景共用。只淡化背景，文字與按鈕保持清晰；關閉模糊就是清透玻璃。' : '三種佈景共用；降低後文字也會一起變透明。';
    $('shade').value = prefs.imageShade; $('shade-value').textContent = prefs.imageShade + '%';
    save(); if (updateNative || themeChanged) native(themeChanged); else if (!nativeFailed) status();
  }
  function open(value) { $('panel').hidden = !value; $('toggle').setAttribute('aria-expanded', String(value)); }
  $('toggle').onclick = () => open($('panel').hidden); $('close').onclick = () => open(false);
  shadow.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    prefs.mode = b.dataset.mode; apply();
    if (prefs.mode === 'image' && !imageURL) $('status').textContent = '選擇一張圖片，就能套用背景。';
  });
  for (const k of Object.keys(firstColors)) $('color-' + k).oninput = () => { prefs.colors[k] = $('color-' + k).value; apply(false); };
  $('reset-colors').onclick = () => { prefs.colors = {...firstColors}; apply(false); };
  $('original').onclick = () => { prefs.mode = 'original'; apply(); };
  $('opacity').oninput = () => {
    prefs[prefs.keepForeground ? 'backgroundOpacity' : 'opacity'] = Number($('opacity').value);
    if (prefs.keepForeground) apply(false); else $('opacity-value').textContent = $('opacity').value + '%';
  };
  $('opacity').onchange = () => { apply(); };
  $('keep-foreground').onchange = () => { prefs.keepForeground = $('keep-foreground').checked; apply(); };
  $('background-blur').onchange = () => { prefs.backgroundBlur = $('background-blur').checked; native(); save(); };
  $('shade').oninput = () => { prefs.imageShade = Number($('shade').value); apply(false); };
  $('choose').onclick = () => $('file').click();
  function database() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('ken-glass-images',1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function loadImage() {
    const db = await database();
    try { return await new Promise((r,j) => { const q = db.transaction('images').objectStore('images').get('background'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); }
    finally { db.close(); }
  }
  async function storeImage(value) {
    const db = await database();
    try { await new Promise((r,j) => { const tx = db.transaction('images','readwrite'); tx.objectStore('images').put(value,'background'); tx.oncomplete = r; tx.onerror = () => j(tx.error); tx.onabort = () => j(tx.error); }); }
    finally { db.close(); }
  }
  async function importFile(file) {
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp','image/avif'].includes(file.type) || file.size > 12*1024*1024) throw Error('請選擇 12 MB 以下的 PNG、JPG、WebP 或 AVIF。');
    const url = await new Promise((r,j) => { const reader = new FileReader(); reader.onload = () => r(reader.result); reader.onerror = () => j(Error('圖片讀取失敗。')); reader.readAsDataURL(file); });
    const img = new Image(); img.src = url; await img.decode();
    if (img.naturalWidth * img.naturalHeight > 60000000) throw Error('圖片尺寸太大，請縮小後再選擇。');
    await storeImage(url); imageURL = url; prefs.mode = 'image'; apply(); $('status').textContent = '圖片已儲存在本機。';
  }
  $('file').onchange = async () => { try { await importFile($('file').files[0]); } catch(e) { $('status').textContent = e.message; } finally { $('file').value = ''; } };
  let repairTimer = null, themeRepairs = 0, backdropRepairs = 0;
  function scheduleBackdropRepair() {
    clearTimeout(repairTimer);
    repairTimer = setTimeout(() => { if (!disposed && prefs.mode !== 'original') native(true); },80);
  }
  const themeGuard = new MutationObserver(() => {
    if (disposed || prefs.mode === 'original' || root.getAttribute('data-theme') === expectedTheme) return;
    themeRepairs++; root.setAttribute('data-theme',expectedTheme); scheduleBackdropRepair();
  });
  themeGuard.observe(root,{attributes:true,attributeFilter:['data-theme']});
  const backdropChanged = event => {
    if (event.data?.type !== 'electron-window-opaque-surface-changed' || prefs.mode === 'original') return;
    backdropRepairs++; scheduleBackdropRepair();
  };
  const outside = event => { if (!event.composedPath().includes(host)) open(false); };
  const escape = event => { if (event.key === 'Escape') open(false); };
  const activated = () => { if (prefs.mode !== 'original' && prefs.keepForeground) scheduleBackdropRepair(); };
  const visible = () => { if (document.visibilityState === 'visible') activated(); };
  window.addEventListener('message',backdropChanged);
  window.addEventListener('focus',activated); document.addEventListener('visibilitychange',visible);
  document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape);
  window.__kenGlassNativeResult = (ok,message) => {
    if (disposed) return;
    nativeFailed = !ok;
    nativePending = false;
    if (prefs.mode !== 'original') background.style.opacity = String(ok && prefs.keepForeground ? prefs.backgroundOpacity / 100 : 1);
    if (ok) status(); else { nativeSignature = ''; $('status').textContent = message; }
  };
  window.__kenGlassPanel = {
    getState:() => ({...prefs, colors:{...prefs.colors}, hasImage:!!imageURL}),
    getDiagnostics:() => ({themeRepairs,backdropRepairs,expectedTheme,nativeFailed,nativePending}),
    importFile,
    open:() => open(true),
    dispose(restore = true) {
      disposed = true; themeGuard.disconnect(); clearTimeout(repairTimer);
      window.removeEventListener('message',backdropChanged);
      window.removeEventListener('focus',activated); document.removeEventListener('visibilitychange',visible);
      document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape);
      host.remove(); background.remove(); root.removeAttribute('data-ken-glass');
      if (restore) { style.remove(); restoreTheme(); delete window.__kenGlassOriginalTheme; }
      delete window.__kenGlassPanel; delete window.__kenGlassNativeResult;
    }
  };
  apply();
  loadImage().then(url => {
    if (disposed || !url) return;
    imageURL = url; $('swatch-image').style.backgroundImage = `url(${JSON.stringify(imageURL)})`;
    if (prefs.mode === 'image') apply(false);
  }).catch(() => { if (!disposed && prefs.mode === 'image') $('status').textContent = '無法讀取已儲存的圖片，請重新選擇。'; });
})(CSS_PLACEHOLDER, APPEARANCE_PLACEHOLDER);
