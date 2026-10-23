// Optional integration check: real Chromium DOM, isolated profile, stubbed native bridge.
// Does not attach to Codex or validate Windows DWM/install acceptance.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGlassAppearance} from '../packaging/payload/theme/glass-design.mjs';
import {glassPresets} from '../packaging/payload/theme/glass-presets.mjs';
import {createAquariumLayer} from '../packaging/payload/theme/aquarium.mjs';
import {aquariumBackdrops} from '../packaging/payload/theme/aquarium-backdrops.mjs';
import {createCosmosLayer} from '../packaging/payload/theme/cosmos.mjs';
const repository=fileURLToPath(new URL('../',import.meta.url));
const dir=join(repository,'packaging/payload/theme');
const report=join(repository,'experiments','compat-browser-'+Date.now());
await mkdir(report,{recursive:true});
const browserCandidates=[process.env.CHROME_PATH,join(process.env['ProgramFiles(x86)']||'', 'Microsoft/Edge/Application/msedge.exe'),join(process.env.ProgramFiles||'', 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
let executable;
for(const candidate of browserCandidates){if(await access(candidate).then(()=>true,()=>false)){executable=candidate;break;}}
assert.ok(executable,'Set CHROME_PATH to a Chromium browser executable');
const [css,panelCss,panel]=await Promise.all(['glass.css','theme-panel.css','theme-panel.js'].map(name=>readFile(join(dir,name),'utf8')));
let source;
const assets=new Map();
for(const name of [...aquariumBackdrops.map(s=>s.file),'fish-atlas.png','fish-atlas-reef.png','fish-atlas-exotic.png','milky-way.png'])assets.set('/assets/'+name,await readFile(join(dir,'assets',name)));
const server=createServer((req,res)=>{
  if(assets.has(req.url)){res.writeHead(200,{'Content-Type':'image/png'});res.end(assets.get(req.url));return;}
  if(req.url==='/panel.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(source);return;}
  const compatibility=new URL(req.url,'http://localhost').searchParams.get('compat')==='1';
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"></head><body><main data-app-shell-main-surface><h1>Compatibility acceptance fixture</h1><p>Colors, artwork, and readable foreground.</p></main><script>localStorage.clear();window.__kenGlassWin10Compat=${compatibility};window.nativeRequests=[];window.__kenGlassNative=value=>{nativeRequests.push(JSON.parse(value));queueMicrotask(()=>window.__kenGlassNativeResult?.(true,''));};</script><script>
window.fixtureQuota={rate_limit:{primary_window:{used_percent:25,reset_at:1792800000},secondary_window:{used_percent:40,reset_at:1793000000}},rate_limit_reset_credits:{available_count:2}};
window.fixtureQuery={state:{data:window.fixtureQuota,dataUpdatedAt:Date.now()}};
window.fixtureListeners=[];window.fixtureResetConfirm=0;
const fixtureClient={getQueryCache:()=>({find:()=>window.fixtureQuery,subscribe:fn=>{window.fixtureListeners.push(fn);return ()=>{};}}),refetchQueries:()=>Promise.resolve()};
const profileButton=document.createElement('button');profileButton.setAttribute('aria-label','Open profile menu');profileButton.setAttribute('aria-controls','fixture-profile-menu');profileButton.setAttribute('aria-expanded','false');
profileButton.__reactFiber$fixture={memoizedProps:{client:fixtureClient}};
profileButton.addEventListener('pointerdown',()=>{profileButton.setAttribute('aria-expanded','true');if(document.getElementById('fixture-profile-menu'))return;const menu=document.createElement('div');menu.id='fixture-profile-menu';menu.innerHTML='<div role="menuitem">Usage</div><button>2 resets available</button>';menu.querySelector('[role="menuitem"]').__reactFiber$fixture={memoizedProps:{onSelect:()=>{}}};menu.querySelector('button').onclick=()=>{window.fixtureResetConfirm++;};document.body.append(menu);});document.body.append(profileButton);
</script><script src="/panel.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const asset=name=>origin+'/assets/'+name;
const replacements={CSS_PLACEHOLDER:JSON.stringify(css),APPEARANCE_PLACEHOLDER:createGlassAppearance.toString(),PRESETS_PLACEHOLDER:JSON.stringify(glassPresets),PANEL_CSS_PLACEHOLDER:JSON.stringify(panelCss),AQUARIUM_PLACEHOLDER:createAquariumLayer.toString(),AQUARIUM_IMAGE_PLACEHOLDER:JSON.stringify(aquariumBackdrops.map(s=>({...s,url:asset(s.file)}))),FISH_ATLAS_PLACEHOLDER:JSON.stringify(asset('fish-atlas.png')),REEF_ATLAS_PLACEHOLDER:JSON.stringify(asset('fish-atlas-reef.png')),EXOTIC_ATLAS_PLACEHOLDER:JSON.stringify(asset('fish-atlas-exotic.png')),COSMOS_PLACEHOLDER:createCosmosLayer.toString(),GALAXY_IMAGE_PLACEHOLDER:JSON.stringify(asset('milky-way.png'))};
source=panel;
for(const [key,value] of Object.entries(replacements))source=source.replace(key,()=>value);
const profile=resolve(report,'profile');
const browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1280,800','about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket,sequence=0;const pending=new Map(),exceptions=[],results=[];
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const value=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!value.exceptionDetails,JSON.stringify(value.exceptionDetails));return value.result.value;}
async function until(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression);}
try{
  let port;
  for(let i=0;i<150;i++){const text=await readFile(join(profile,'DevToolsActivePort'),'utf8').catch(()=>null);if(text){port=Number(text.split(/\r?\n/)[0]);break;}await delay(100);}
  assert.ok(port,'Browser did not open CDP');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params);const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);};
  await call('Runtime.enable');await call('Page.enable');
  for(const compatibility of [true,false]){
    await call('Page.navigate',{url:origin+'/?compat='+(compatibility?'1':'0')});
    await until('!!window.__kenGlassPanel');
    const result=await evaluate(`(async()=>{
      const checks=[];const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
      const shadow=document.getElementById('ken-glass-switcher').shadowRoot;
      const $=id=>shadow.getElementById(id),choose=mode=>shadow.querySelector('[data-mode="'+mode+'"]').click();
      const last=()=>nativeRequests.at(-1),state=()=>window.__kenGlassPanel.getState();
      const background=document.getElementById('ken-glass-background');
      const quota=document.getElementById('ken-usage-shortcuts').shadowRoot;
      check(window.__kenUsageShortcuts.getDiagnostics().connected,'quota query cache connects');
      check(quota.getElementById('primary').querySelector('strong').textContent==='75%','quota primary shows remaining percentage');
      check(quota.getElementById('weekly').querySelector('strong').textContent==='60%','quota weekly shows remaining percentage');
      check(quota.getElementById('primary').title.includes('恢復時間'),'quota reset time tooltip');
      fixtureQuota.rate_limit.primary_window.used_percent=80;fixtureListeners.forEach(fn=>fn({query:{queryKey:['rate-limit-status']}}));
      check(quota.getElementById('primary').querySelector('strong').textContent==='20%','quota observes cache updates');
      quota.getElementById('reset').click();await new Promise(resolve=>setTimeout(resolve,120));
      check(fixtureResetConfirm===1&&fixtureQuota.rate_limit_reset_credits.available_count===2,'reset shortcut opens confirmation without consuming credit');
      check(last().mode===(${compatibility}?'restore':'background'),'clear mode native routing');
      check(getComputedStyle(document.documentElement).backgroundColor===(${compatibility}?'rgb(16, 20, 27)':'rgba(0, 0, 0, 0)'),'opaque fallback vs transparent native canvas');
      choose('color');$('background-blur').checked=true;$('background-blur').onchange();
      check(${compatibility}?getComputedStyle(background).filter==='blur(12px)':last().blur===true,'blur control applies to correct layer');
      $('opacity').value=37;$('opacity').oninput();
      check(state().backgroundOpacity===37&&background.style.opacity==='0.37','background strength preserves foreground');
      const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
      await window.__kenGlassPanel.importFile(new File([png],'fixture.png',{type:'image/png'}));choose('image');
      check(state().hasImage&&background.style.background.includes('data:image/png'),'wallpaper imports into image mode');
      choose('aquarium');check(last().mode===(${compatibility}?'restore':'background')&&last().blur===!${compatibility},'aquarium native routing');
      check(window.__kenGlassPanel.getDiagnostics().aquarium.active,'aquarium remains available');
      $('aquarium-pause').checked=true;$('aquarium-pause').onchange();
      check(!window.__kenGlassPanel.getDiagnostics().aquarium.running,'aquarium pause');
      choose('cosmos');check(last().mode===(${compatibility}?'restore':'background')&&last().blur===!${compatibility},'cosmos native routing');
      $('opacity').value=63;$('opacity').oninput();
      check(state().cosmosOpacity===63&&state().backgroundOpacity===37,'cosmos strength independent of colors');
      $('keep-foreground').checked=false;$('keep-foreground').onchange();
      check(last().mode==='set'&&last().opacity===82,'whole-window opacity remains available');
      $('original').click();check(last().mode==='restore'&&!document.documentElement.hasAttribute('data-ken-glass')&&background.hidden,'restore removes theme');
      choose('clear');$('keep-foreground').checked=true;$('keep-foreground').onchange();
      check(!${compatibility}||nativeRequests.every(r=>r.mode!=='background'&&!r.blur),'fallback never requests native backdrop');
      check(JSON.parse(localStorage.getItem('ken-glass-preferences-v1')).mode==='clear','preferences persist');
      choose('cosmos');return {compatibility:${compatibility},checks};
    })()`);
    await until('window.__kenGlassPanel.getDiagnostics().cosmos.imageReady');
    const screenshot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(report,compatibility?'compatibility.png':'native-routing.png'),Buffer.from(screenshot.data,'base64'));
    await evaluate('window.__kenGlassPanel.dispose(true)');
    assert.equal(await evaluate('!!document.getElementById("ken-glass-switcher")'),false);
    assert.equal(await evaluate('!!document.getElementById("ken-usage-shortcuts")'),false);
    results.push(result);
  }
  assert.deepEqual(exceptions,[],'Unexpected browser exceptions');
  await writeFile(join(report,'result.json'),JSON.stringify({results,exceptions,nativeBridge:'stubbed; Windows DWM and install acceptance not exercised'},null,2));
  console.log(JSON.stringify({passed:results.reduce((n,r)=>n+r.checks.length+1,0),report,scope:'Chromium DOM with both routing policies; native bridge stubbed'},null,2));
}finally{
  socket?.close();for(const item of pending.values())clearTimeout(item.timer);pending.clear();
  // Browser is our unique headless process with an isolated profile.
  browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
