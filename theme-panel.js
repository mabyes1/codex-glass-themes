// Runs only in the Codex main renderer. Images stay in this app's local IndexedDB.
(function installGlass(themes) {
  window.__kenGlassPanel?.dispose(false);
  document.getElementById('ken-desktop-test')?.remove();
  const root=document.documentElement;
  if(window.__kenGlassOriginalTheme===undefined)window.__kenGlassOriginalTheme=root.getAttribute('data-theme');
  const key='ken-glass-preferences-v1';
  let prefs;try{prefs=JSON.parse(localStorage.getItem(key)||'{}')}catch{prefs={}}
  prefs={mode:'clear',opacity:82,keepForeground:true,backgroundOpacity:45,backgroundBlur:false,imageShade:28,colors:{base:'#111d30',left:'#3b91b3',right:'#7e55a7'},...prefs};
  prefs.mode={desktop:'clear',silver:'clear',blue:'color'}[prefs.mode]||prefs.mode;
  if(!['clear','color','image','original'].includes(prefs.mode))prefs.mode='clear';
  prefs.opacity=Math.max(55,Math.min(100,Number(prefs.opacity)||82));
  prefs.keepForeground=prefs.keepForeground===true;
  prefs.backgroundBlur=prefs.backgroundBlur===true;
  prefs.backgroundOpacity=Number.isFinite(Number(prefs.backgroundOpacity))?Math.max(0,Math.min(100,Number(prefs.backgroundOpacity))):45;
  prefs.imageShade=Math.max(0,Math.min(65,Number(prefs.imageShade)||28));
  prefs.colors={base:'#111d30',left:'#3b91b3',right:'#7e55a7',...prefs.colors};
  for(const k of ['base','left','right'])if(!/^#[0-9a-f]{6}$/i.test(prefs.colors[k]))prefs.colors[k]={base:'#111d30',left:'#3b91b3',right:'#7e55a7'}[k];
  let imageURL='',disposed=false;
  let style=document.getElementById('ken-codex-glass');
  if(!style){style=document.createElement('style');style.id='ken-codex-glass';document.head.append(style)}
  const backgroundLayer=document.createElement('div');backgroundLayer.id='ken-glass-background';backgroundLayer.setAttribute('aria-hidden','true');
  backgroundLayer.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none;';document.body.prepend(backgroundLayer);
  const foregroundStyle=document.createElement('style');foregroundStyle.id='ken-glass-foreground';document.head.append(foregroundStyle);
  const host=document.createElement('div');host.id='ken-glass-switcher';
  host.style.cssText='position:fixed;top:8px;right:160px;z-index:2147483000;-webkit-app-region:no-drag;';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
  :host{font:13px/1.5 "Segoe UI","Microsoft JhengHei",sans-serif;color:#343b44;color-scheme:light}
  *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;color:inherit}
  #toggle{padding:4px 12px;border:1px solid #ffffffa6;border-radius:20px;background:#f4f6f7dc;box-shadow:0 2px 8px #17233316;-webkit-app-region:no-drag}
  #panel{position:absolute;right:0;top:37px;width:290px;padding:17px;border-radius:19px;background:#f5f7f9fa;border:1px solid #fff;box-shadow:0 16px 50px #16202c30;max-height:calc(100vh - 70px);overflow:auto}
  [hidden]{display:none!important}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}strong{font-size:15px}#close{background:none;border:0;font-size:20px}
  .choices{display:grid;grid-template-columns:1fr;gap:8px}.choice{background:#fff9;border:1px solid #aeb8c544;border-radius:12px;padding:9px 11px;text-align:left}.choice[aria-pressed=true]{border-color:#697785;background:#e4e9ef;box-shadow:inset 0 1px #fff}.choice span{display:block;font-size:11px;color:#707983;margin-top:3px}
  .palette{display:flex;gap:10px;margin-top:10px}.palette label{display:block;flex:1;font-size:11px}.palette input{display:block;width:100%;height:32px;border:1px solid #b6bec955;border-radius:7px;padding:2px;margin-top:4px;background:white}.control{margin-top:15px}label{display:flex;justify-content:space-between;gap:8px}input[type=range]{width:100%;accent-color:#667a8f;margin-top:8px}.note{font-size:11px;color:#6b7580;margin:6px 0 0}.action{width:100%;border:1px solid #b6bec955;border-radius:10px;padding:8px;background:white;margin-top:8px}#status{min-height:17px;font-size:11px;color:#637181;margin-top:12px}#original{background:none;border:0;color:#737b85;font-size:11px;padding:9px 0 0}button:focus-visible,input:focus-visible{outline:2px solid #4d739e;outline-offset:2px}
  </style>
  <button id="toggle" aria-expanded="false" aria-label="開啟佈景切換器">◈ 佈景</button>
  <section id="panel" hidden aria-label="佈景切換器"><header><strong>玻璃佈景</strong><button id="close" aria-label="關閉">×</button></header>
  <div class="choices">
  <button class="choice" data-mode="clear">無色透明玻璃<span>中性透明 · 白色文字與圖示</span></button>
  <button class="choice" data-mode="color">多色玻璃<span>三色調色盤 · 自由搭配</span></button>
  <button class="choice" data-mode="image">圖片玻璃<span>選一張自己的背景</span></button>
  </div>
  <div class="control" id="palette-control" hidden><div class="palette"><label>底色<input id="color-base" type="color"></label><label>左側光暈<input id="color-left" type="color"></label><label>右側光暈<input id="color-right" type="color"></label></div><button class="action" id="reset-colors">還原第一版配色</button></div>
  <div class="control" id="desktop-control"><label for="keep-foreground">保持前景清晰<input id="keep-foreground" type="checkbox"></label><label for="opacity" style="margin-top:12px"><span id="opacity-label">視窗不透明度</span><output id="opacity-value"></output></label><input id="opacity" type="range" min="55" max="100" step="1"><p class="note" id="opacity-note"></p><label id="blur-control" for="background-blur" style="margin-top:10px" hidden>模糊背後背景（Acrylic）<input id="background-blur" type="checkbox"></label></div>
  <div class="control" id="image-control" hidden><button class="action" id="choose">選擇圖片…</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden><label for="shade" style="margin-top:12px">圖片暗化 <output id="shade-value"></output></label><input id="shade" type="range" min="0" max="65"><p class="note">圖片只存在本機，不會上傳。支援 PNG、JPG、WebP、AVIF，最大 12 MB。</p></div>
  <div id="status" role="status"></div><button id="original">還原原始外觀</button></section>`;
  document.body.append(host);
  const $=id=>shadow.getElementById(id);
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(prefs))}catch{ $('status').textContent='目前可用，但無法儲存偏好。' }};
  function native(){
    $('status').textContent=prefs.mode!=='original'?'正在調整視窗透明度…':'';
    if(typeof window.__kenGlassNative==='function')window.__kenGlassNative(JSON.stringify({mode:prefs.mode==='original'?'restore':prefs.keepForeground?'background':prefs.opacity===100?'restore':'set',opacity:prefs.keepForeground?prefs.backgroundOpacity:prefs.opacity,blur:prefs.backgroundBlur}));
    else if(prefs.mode!=='original')$('status').textContent='透明度助手未連線，請執行「啟動佈景切換器」。';
  }
  function apply(updateNative=true){
    const mode=prefs.mode;
    foregroundStyle.textContent='';backgroundLayer.hidden=true;
    root.setAttribute('data-theme','dark');
    if(mode==='original'){
      style.textContent='';const t=window.__kenGlassOriginalTheme;t===null?root.removeAttribute('data-theme'):root.setAttribute('data-theme',t);
    }else if(mode==='color') {
      const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(',');
      const {base,left,right}=prefs.colors;
      const original=base==='#111d30'&&left==='#3b91b3'&&right==='#7e55a7';
      style.textContent=themes.color+(original?'':`\nhtml{background:${base}!important}body{background:radial-gradient(ellipse at 0% 10%,rgba(${rgb(left)},.46),transparent 58%),radial-gradient(ellipse at 95% 90%,rgba(${rgb(right)},.42),transparent 58%),${base}!important}aside.app-shell-left-panel{background:rgba(${rgb(left)},.10)!important}[data-composer-surface-variant],[data-user-message-bubble],[data-composer-placement="home"] [data-composer-body]{background:linear-gradient(125deg,rgba(${rgb(left)},.18),rgba(${rgb(right)},.16))!important}`);
    }
    else if(mode==='clear') style.textContent=themes.clear;
    else {
      style.textContent=themes.color+`\nhtml{background:#182029!important}body{background-color:#182029!important;background-image:${imageURL?'url('+JSON.stringify(imageURL)+')':'none'}!important;background-size:cover!important;background-position:center!important;background-attachment:fixed!important;box-shadow:inset 0 0 0 100vmax rgba(0,0,0,${prefs.imageShade/100})!important}body::before,body::after{display:none!important}main[class*='_MainContentSurface_'],aside.app-shell-left-panel,[data-composer-surface-variant]{backdrop-filter:none!important}aside.app-shell-left-panel{background:rgba(15,22,32,.22)!important}[data-composer-surface-variant],[data-user-message-bubble],[data-composer-placement="home"] [data-composer-body]{background:rgba(255,255,255,.12)!important}`;
    }
    if(mode!=='original'&&prefs.keepForeground){
      // Fade a separate background plane, never the container of the text.
      const surface=getComputedStyle(document.body);
      for(const name of ['backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','backgroundAttachment','boxShadow'])backgroundLayer.style[name]=surface[name];
      backgroundLayer.style.opacity=String(prefs.backgroundOpacity/100);backgroundLayer.hidden=false;
      foregroundStyle.textContent=`html{background:transparent!important}body{background:transparent!important;box-shadow:none!important;isolation:isolate}body::before,body::after{opacity:${prefs.backgroundOpacity/100}!important}main[class*='_MainContentSurface_'],aside.app-shell-left-panel,[data-composer-surface-variant],[data-composer-body]{backdrop-filter:none!important}`;
    }
    shadow.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
    $('desktop-control').hidden=mode==='original';$('palette-control').hidden=mode!=='color';$('image-control').hidden=mode!=='image';for(const k of ['base','left','right'])$('color-'+k).value=prefs.colors[k];
    $('keep-foreground').checked=prefs.keepForeground;$('background-blur').checked=prefs.backgroundBlur;
    $('blur-control').hidden=!prefs.keepForeground;
    $('opacity').min=prefs.keepForeground?'0':'55';$('opacity').value=prefs.keepForeground?prefs.backgroundOpacity:prefs.opacity;$('opacity-value').textContent=$('opacity').value+'%';
    $('opacity-label').textContent=prefs.keepForeground?'背景不透明度':'視窗不透明度';
    $('opacity-note').textContent=prefs.keepForeground?'所有佈景共用，只淡化背景；文字和按鈕維持不透明。關閉模糊就是清透玻璃。':'所有佈景共用。100% 完全不透明；降低後文字也會一起變透明。';
    $('shade').value=prefs.imageShade;$('shade-value').textContent=prefs.imageShade+'%';
    if(updateNative)native();save();
  }
  function open(value){$('panel').hidden=!value;$('toggle').setAttribute('aria-expanded',String(value))}
  $('toggle').onclick=()=>open($('panel').hidden);$('close').onclick=()=>open(false);
  shadow.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{prefs.mode=b.dataset.mode;apply();if(prefs.mode==='image'&&!imageURL)$('status').textContent='選擇一張圖片，就能套用背景。'});
  for(const k of ['base','left','right'])$('color-'+k).oninput=()=>{prefs.colors[k]=$('color-'+k).value;apply(false)};
  $('reset-colors').onclick=()=>{prefs.colors={base:'#111d30',left:'#3b91b3',right:'#7e55a7'};apply(false)};
  $('original').onclick=()=>{prefs.mode='original';apply()};
  $('opacity').oninput=()=>{$('opacity-value').textContent=$('opacity').value+'%'};
  $('opacity').onchange=()=>{prefs[prefs.keepForeground?'backgroundOpacity':'opacity']=Number($('opacity').value);apply()};
  $('keep-foreground').onchange=()=>{prefs.keepForeground=$('keep-foreground').checked;apply()};
  $('background-blur').onchange=()=>{prefs.backgroundBlur=$('background-blur').checked;native();save()};
  $('shade').oninput=()=>{prefs.imageShade=Number($('shade').value);apply(false)};
  $('choose').onclick=()=>$('file').click();
  function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('ken-glass-images',1);request.onupgradeneeded=()=>request.result.createObjectStore('images');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
  async function loadImage(){const db=await database();try{return await new Promise((r,j)=>{const q=db.transaction('images').objectStore('images').get('background');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}finally{db.close()}}
  async function storeImage(value){const db=await database();try{await new Promise((r,j)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(value,'background');tx.oncomplete=r;tx.onerror=()=>j(tx.error);tx.onabort=()=>j(tx.error)})}finally{db.close()}}
  async function importFile(file){
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp','image/avif'].includes(file.type)||file.size>12*1024*1024)throw Error('請選擇 12 MB 以下的 PNG、JPG、WebP 或 AVIF。');
    const url=await new Promise((r,j)=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.onerror=()=>j(Error('圖片讀取失敗。'));reader.readAsDataURL(file)});
    const img=new Image();img.src=url;await img.decode();
    if(img.naturalWidth*img.naturalHeight>60000000)throw Error('圖片尺寸太大，請縮小後再選擇。');
    await storeImage(url);imageURL=url;prefs.mode='image';apply();$('status').textContent='圖片已儲存在本機。';
  }
  $('file').onchange=async()=>{try{await importFile($('file').files[0])}catch(e){$('status').textContent=e.message}finally{$('file').value=''}};
  const outside=e=>{if(!e.composedPath().includes(host))open(false)};
  const escape=e=>{if(e.key==='Escape')open(false)};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  window.__kenGlassNativeResult=(ok,message)=>{if(!disposed)$('status').textContent=ok?(prefs.mode==='original'?'已還原原始外觀':prefs.keepForeground?'前景清晰 · 背景 '+prefs.backgroundOpacity+'% · '+(prefs.backgroundBlur?'Acrylic':'清透玻璃'):'共用不透明度 · '+prefs.opacity+'%'):message};
  window.__kenGlassPanel={
    getState:()=>({...prefs,hasImage:!!imageURL}),
    importFile,
    open:()=>open(true),
    dispose(restore=true){disposed=true;document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);host.remove();backgroundLayer.remove();foregroundStyle.remove();if(restore){style.remove();const t=window.__kenGlassOriginalTheme;t===null?root.removeAttribute('data-theme'):root.setAttribute('data-theme',t);delete window.__kenGlassOriginalTheme}delete window.__kenGlassPanel;}
  };
  apply();
  loadImage().then(url=>{if(disposed)return;if(url){imageURL=url;if(prefs.mode==='image')apply(false)}}).catch(()=>{if(!disposed&&prefs.mode==='image')$('status').textContent='無法讀取已儲存的圖片，請重新選擇。'});
})(THEMES_PLACEHOLDER);
