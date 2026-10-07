// Runs only in the Codex main renderer. Images stay in local IndexedDB.
(function installGlass(css, appearanceFor, presets, panelCss, createAquarium) {
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
  const prefs = {mode:'clear', opacity:82, keepForeground:true, backgroundOpacity:45, backgroundBlur:false, imageShade:28, surfaceStrength:50, aquariumMotion:true, aquariumOpacity:85, ...saved};
  prefs.mode = {desktop:'clear', silver:'clear', blue:'color'}[prefs.mode] || prefs.mode;
  if (!['clear', 'color', 'image', 'aquarium', 'original'].includes(prefs.mode)) prefs.mode = 'clear';
  prefs.aquariumMotion = prefs.aquariumMotion !== false;
  const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  prefs.opacity = number(prefs.opacity, 55, 100, 82);
  prefs.backgroundOpacity = number(prefs.backgroundOpacity, 0, 100, 45);
  prefs.aquariumOpacity = number(prefs.aquariumOpacity, 0, 100, 85);
  prefs.imageShade = number(prefs.imageShade, 0, 65, 28);
  prefs.surfaceStrength = number(prefs.surfaceStrength, 0, 100, 50);
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
  const aquarium = createAquarium(background);
  const host = document.createElement('div'); host.id = 'ken-glass-switcher';
  host.style.cssText = 'position:fixed;top:8px;right:160px;z-index:2147483000;-webkit-app-region:no-drag;';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>${panelCss}</style>

  <button id="toggle" aria-expanded="false" aria-haspopup="dialog" aria-controls="panel" aria-label="開啟佈景工作室"><span id="toggle-dot" aria-hidden="true"></span>佈景</button>
  <section id="panel" hidden role="dialog" aria-modal="false" aria-labelledby="panel-title">
    <header class="panel-header"><div><div class="eyebrow">CODEX GLASS</div><h1 id="panel-title">佈景工作室</h1><p class="subtitle" id="active-name">替今天的工作換個心情。</p></div><button id="close" aria-label="關閉佈景工作室">×</button></header>
    <div class="panel-body">
      <div class="choices" role="group" aria-label="背景種類">
        <button class="choice" data-mode="clear"><span class="swatch" id="swatch-clear" aria-hidden="true"></span>清透</button>
        <button class="choice" data-mode="color"><span class="swatch" id="swatch-color" aria-hidden="true"></span>配色</button>
        <button class="choice" data-mode="image"><span class="swatch" id="swatch-image" aria-hidden="true"></span>圖片</button>
        <button class="choice" data-mode="aquarium"><span class="swatch" id="swatch-aquarium" aria-hidden="true"></span>水族館</button>
      </div>
      <div id="gallery-control">
        <div class="section-heading"><strong>精選佈景</strong><span>點選縮圖，立即套用</span></div>
        <div id="gallery" role="group" aria-label="精選配色"></div>
      </div>
      <details id="palette-control" hidden><summary>微調這組配色</summary>
        <div class="palette"><label>底色<input id="color-base" type="color"></label><label>左側光暈<input id="color-left" type="color"></label><label>右側光暈<input id="color-right" type="color"></label></div>
        <button class="action" id="reset-colors">重設為經典藍紫</button><p class="note">明亮底色會搭配深色字，深色底色會搭配淺色字。</p>
      </details>
      <div id="image-control" hidden>
        <p id="image-name">選一張喜歡的照片，讓它陪你工作。</p>
        <button class="action" id="choose">選擇背景圖片…</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden>
        <label for="shade" class="range-label">圖片暗化<output id="shade-value"></output></label><input id="shade" type="range" min="0" max="65">
        <p class="note">圖片保存在本機。PNG、JPG、WebP、AVIF，最大 12 MB。</p>
      </div>
      <div id="aquarium-control" hidden>
        <div class="aquarium-title"><span aria-hidden="true">◌</span><div><strong>玻璃後的小小海洋</strong><p class="note">銀龍魚、神仙魚與小魚群，陪你慢慢游。</p></div></div>
        <label class="range-label" for="aquarium-pause">暫停游動<input id="aquarium-pause" type="checkbox"></label>
        <p class="note">休息時留下靜態魚影。也會配合系統的減少動態效果設定。</p>
      </div>
      <div class="control" id="desktop-control">
        <div class="section-heading" style="margin-top:0"><strong>閱讀舒適度</strong><span>各佈景共用</span></div>
        <div class="reading-options" role="group" aria-label="閱讀舒適度">
          <button data-reading="30">輕盈</button><button data-reading="50">均衡</button><button data-reading="85">專注</button>
        </div>
        <p class="note">專注模式加厚閱讀區、卡片與輸入框的底色。</p>
        <label for="opacity" class="range-label"><span id="opacity-label">背景濃度</span><output id="opacity-value"></output></label><input id="opacity" type="range" min="0" max="100" step="1">
        <div class="range-ends"><span id="opacity-low">更清透</span><span>更濃郁</span></div>
        <p class="note" id="opacity-note"></p>
        <details><summary>透明效果</summary>
          <label for="keep-foreground">保持文字與按鈕清晰<input id="keep-foreground" type="checkbox"></label>
          <label id="blur-control" for="background-blur" class="range-label">毛玻璃背景<input id="background-blur" type="checkbox"></label>
          <p class="note">毛玻璃柔化視窗後方的桌面。</p>
        </details>
      </div>
    </div>
    <footer class="panel-footer"><div class="footer-actions"><button id="original">還原 Codex 原始外觀</button><button id="done">完成</button></div><div id="status" role="status" aria-live="polite"></div></footer>
  </section>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  for (const preset of presets) {
    const appearance = appearanceFor({...prefs,mode:'color',colors:preset.colors,surfaceStrength:50});
    const button = document.createElement('button');
    button.className = 'preset'; button.dataset.preset = preset.id;
    button.setAttribute('aria-label', `${preset.name}，${preset.family}`);
    button.innerHTML = '<span class="preset-preview" aria-hidden="true"><span class="mini-app"><span class="mini-sidebar"></span><span class="mini-content"></span></span></span><span class="preset-copy"><strong></strong><small></small></span><span class="preset-check" aria-hidden="true">✓</span>';
    button.querySelector('strong').textContent = preset.name;
    button.querySelector('small').textContent = preset.family;
    const preview = button.querySelector('.preset-preview');
    preview.style.background = appearance.background;
    for (const [name,key] of Object.entries({main:'--kg-main',sidebar:'--kg-sidebar',stroke:'--kg-stroke',text:'--kg-primary',composer:'--kg-composer'})) preview.style.setProperty('--preview-'+name,appearance.variables[key]);
    button.onclick = () => { prefs.mode = 'color'; prefs.colors = {...preset.colors}; apply(); };
    $('gallery').append(button);
  }
  const selectedPreset = () => presets.find(p => Object.keys(firstColors).every(k => p.colors[k].toLowerCase() === prefs.colors[k].toLowerCase()));
  const save = () => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { $('status').textContent = '目前可用，但無法儲存偏好。'; } };
  const backgroundStrength = () => prefs.mode === 'aquarium' ? prefs.aquariumOpacity : prefs.backgroundOpacity;
  function restoreTheme() {
    root.removeAttribute('data-ken-glass');
    const t = window.__kenGlassOriginalTheme;
    t === null ? root.removeAttribute('data-theme') : root.setAttribute('data-theme', t);
  }
  function status() {
    $('status').textContent = prefs.mode === 'aquarium' ? `已自動儲存 · 毛玻璃水族館 · ${aquarium.getDiagnostics().running ? '魚兒悠游中' : '靜靜看海'}` : prefs.mode === 'original' ? '已還原原始外觀' :
      prefs.keepForeground ? `已自動儲存 · 背景 ${prefs.backgroundOpacity}% · ${prefs.backgroundBlur ? '毛玻璃' : '清透玻璃'}` : `已自動儲存 · 視窗不透明度 ${prefs.opacity}%`;
  }
  function native(force = false) {
    const value = {mode:prefs.mode === 'original' ? 'restore' : prefs.keepForeground ? 'background' : prefs.opacity === 100 ? 'restore' : 'set', opacity:prefs.keepForeground ? 100 : prefs.opacity, blur:prefs.mode === 'aquarium' || prefs.backgroundBlur};
    const signature = JSON.stringify(value);
    if (!force && signature === nativeSignature) { if (!nativeFailed) status(); return; }
    if (typeof window.__kenGlassNative !== 'function') { $('status').textContent = '透明度助手未連線，請確認背景助手正在執行。'; return; }
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
      const nextCSS = `html[data-ken-glass]{${Object.entries(appearance.variables).map(([k,v]) => `${k}:${v};`).join('')}}\n${css}`;
      if (style.textContent !== nextCSS) style.textContent = nextCSS;
      root.setAttribute('data-ken-glass', mode);
      root.setAttribute('data-theme', expectedTheme);
      background.style.background = appearance.background;
      background.style.opacity = String(prefs.keepForeground && !nativeFailed ? backgroundStrength() / 100 : 1);
      background.hidden = false;
      $('swatch-color').style.background = appearanceFor({...prefs,mode:'color'}).background;
      if (imageURL) $('swatch-image').style.backgroundImage = `url(${JSON.stringify(imageURL)})`;
    }
    shadow.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const preset = mode === 'color' ? selectedPreset() : null;
    shadow.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.preset === preset?.id)));
    shadow.querySelectorAll('[data-reading]').forEach(b => b.setAttribute('aria-pressed',String(Number(b.dataset.reading) === prefs.surfaceStrength)));
    aquarium.setActive(mode === 'aquarium' && (!prefs.keepForeground || backgroundStrength() > 0),prefs.aquariumMotion);
    $('active-name').textContent = mode === 'aquarium' ? '毛玻璃水族館 · 把工作放慢一點點' : mode === 'color' ? `${preset?.name || '我的配色'} · ${expectedTheme === 'light' ? '明亮' : '深色'}玻璃` : mode === 'image' ? '圖片玻璃 · 讓喜歡的風景陪你工作' : mode === 'original' ? 'Codex 原始外觀' : '清透玻璃 · 留一點空間給桌面風景';
    $('toggle-dot').style.background = mode === 'color' || mode === 'aquarium' ? appearanceFor(prefs).background : mode === 'image' && imageURL ? `url(${JSON.stringify(imageURL)}) center/cover` : 'linear-gradient(135deg,#b5bdc9,#687686)';
    $('toggle').title = $('active-name').textContent;
    $('gallery-control').hidden = mode === 'image' || mode === 'aquarium';
    $('aquarium-control').hidden = mode !== 'aquarium';
    $('aquarium-pause').checked = !prefs.aquariumMotion;
    $('desktop-control').hidden = mode === 'original';
    $('palette-control').hidden = mode !== 'color'; $('image-control').hidden = mode !== 'image';
    for (const k of Object.keys(firstColors)) $('color-' + k).value = prefs.colors[k];
    $('keep-foreground').checked = prefs.keepForeground; $('background-blur').checked = mode === 'aquarium' || prefs.backgroundBlur;
    $('background-blur').disabled = mode === 'aquarium';
    $('blur-control').hidden = !prefs.keepForeground;
    $('opacity').min = prefs.keepForeground ? '0' : '55';
    $('opacity').value = prefs.keepForeground ? backgroundStrength() : prefs.opacity;
    $('opacity-value').textContent = $('opacity').value + '%';
    $('opacity-label').textContent = prefs.keepForeground ? mode === 'aquarium' ? '水色濃度' : '背景濃度' : '視窗不透明度';
    $('opacity-low').textContent = prefs.keepForeground ? '更清透' : '更透明';
    $('opacity-note').textContent = prefs.keepForeground ? '調整背景的濃淡，文字與按鈕維持清晰。' : '整個視窗一起變透明，包含文字與按鈕。';
    $('image-name').textContent = imageURL ? (typeof prefs.imageName === 'string' ? prefs.imageName : '已儲存的背景圖片') : '選一張喜歡的照片，讓它陪你工作。';
    $('shade').value = prefs.imageShade; $('shade-value').textContent = prefs.imageShade + '%';
    save(); if (updateNative || themeChanged) native(themeChanged); else if (!nativeFailed) status();
  }
  function open(value, returnFocus = false) {
    $('panel').hidden = !value; $('toggle').setAttribute('aria-expanded', String(value));
    if (value) (shadow.querySelector('.choice[aria-pressed="true"]') || $('close')).focus({preventScroll:true});
    else if (returnFocus) $('toggle').focus({preventScroll:true});
  }
  $('toggle').onclick = () => open($('panel').hidden);
  $('close').onclick = $('done').onclick = () => open(false,true);
  shadow.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    prefs.mode = b.dataset.mode; apply();
    if (prefs.mode === 'image' && !imageURL) $('status').textContent = '選擇一張圖片，就能套用背景。';
  });
  for (const k of Object.keys(firstColors)) $('color-' + k).oninput = () => { prefs.colors[k] = $('color-' + k).value; apply(false); };
  $('reset-colors').onclick = () => { prefs.colors = {...firstColors}; apply(false); };
  shadow.querySelectorAll('[data-reading]').forEach(b => b.onclick = () => { prefs.surfaceStrength = Number(b.dataset.reading); apply(false); });
  $('original').onclick = () => { prefs.mode = 'original'; apply(); };
  $('aquarium-pause').onchange = () => { prefs.aquariumMotion = !$('aquarium-pause').checked; apply(false); };
  $('opacity').oninput = () => {
    prefs[prefs.keepForeground ? prefs.mode === 'aquarium' ? 'aquariumOpacity' : 'backgroundOpacity' : 'opacity'] = Number($('opacity').value);
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
    await storeImage(url);
    if (disposed) return;
    imageURL = url; prefs.imageName = file.name; prefs.mode = 'image'; apply(); $('status').textContent = '圖片已儲存在本機。';
  }
  $('file').onchange = async () => { try { await importFile($('file').files[0]); } catch(e) { $('status').textContent = e.message; } finally { $('file').value = ''; } };
  let checkScheduled = false, themeRepairs = 0, backdropRepairs = 0;
  function scheduleBackdropCheck() {
    if (checkScheduled) return;
    checkScheduled = true;
    queueMicrotask(() => {
      checkScheduled = false;
      if (!disposed && prefs.mode !== 'original' && prefs.keepForeground) window.__kenGlassNativeCheck?.('check');
    });
  }
  const themeGuard = new MutationObserver(() => {
    if (disposed || prefs.mode === 'original' || root.getAttribute('data-theme') === expectedTheme) return;
    themeRepairs++; root.setAttribute('data-theme',expectedTheme); scheduleBackdropCheck();
  });
  themeGuard.observe(root,{attributes:true,attributeFilter:['data-theme']});
  const backdropChanged = event => {
    if (event.data?.type !== 'electron-window-opaque-surface-changed' || prefs.mode === 'original') return;
    scheduleBackdropCheck();
  };
  const titleGuard = new MutationObserver(scheduleBackdropCheck);
  const title = document.head.querySelector('title');
  if (title) titleGuard.observe(title,{childList:true,characterData:true,subtree:true});
  const unsubscribeSystemTheme = window.electronBridge?.subscribeToSystemThemeVariant?.(scheduleBackdropCheck);
  const outside = event => { if (!event.composedPath().includes(host)) open(false); };
  const escape = event => {
    if ($('panel').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open(false,true); }
    if (event.key === 'Tab' && event.composedPath().includes(host)) {
      const elements = [...$('panel').querySelectorAll('button,input,summary')].filter(el => !el.disabled && el.getClientRects().length);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const activated = scheduleBackdropCheck;
  const visible = () => { if (document.visibilityState === 'visible') activated(); };
  window.addEventListener('message',backdropChanged);
  window.addEventListener('focus',activated); document.addEventListener('visibilitychange',visible);
  document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape,true);
  window.__kenGlassNativeResult = (ok,message) => {
    if (disposed) return;
    nativeFailed = !ok;
    nativePending = false;
    if (prefs.mode !== 'original') background.style.opacity = String(ok && prefs.keepForeground ? backgroundStrength() / 100 : 1);
    if (ok) status(); else { nativeSignature = ''; $('status').textContent = message; }
  };
  window.__kenGlassNativeRepaired = () => {
    if (disposed) return;
    backdropRepairs++; nativePending = false;
    status();
  };
  window.__kenGlassPanel = {
    getState:() => ({...prefs, colors:{...prefs.colors}, hasImage:!!imageURL}),
    getDiagnostics:() => ({themeRepairs,backdropRepairs,expectedTheme,nativeFailed,nativePending,aquarium:aquarium.getDiagnostics()}),
    importFile,
    open:() => open(true),
    dispose(restore = true) {
      disposed = true; aquarium.dispose(); themeGuard.disconnect(); titleGuard.disconnect(); unsubscribeSystemTheme?.();
      window.removeEventListener('message',backdropChanged);
      window.removeEventListener('focus',activated); document.removeEventListener('visibilitychange',visible);
      document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape,true);
      host.remove(); background.remove(); root.removeAttribute('data-ken-glass');
      if (restore) { style.remove(); restoreTheme(); delete window.__kenGlassOriginalTheme; }
      delete window.__kenGlassPanel; delete window.__kenGlassNativeResult;
      delete window.__kenGlassNativeRepaired;
      delete window.__kenGlassNativeStats;
    }
  };
  apply();
  loadImage().then(url => {
    if (disposed || !url) return;
    imageURL = url; $('swatch-image').style.backgroundImage = `url(${JSON.stringify(imageURL)})`;
    if (prefs.mode === 'image') apply(false);
  }).catch(() => { if (!disposed && prefs.mode === 'image') $('status').textContent = '無法讀取已儲存的圖片，請重新選擇。'; });
})(CSS_PLACEHOLDER, APPEARANCE_PLACEHOLDER, PRESETS_PLACEHOLDER, PANEL_CSS_PLACEHOLDER, AQUARIUM_PLACEHOLDER);
