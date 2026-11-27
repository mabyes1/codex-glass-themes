import {readFile,writeFile,mkdir,unlink,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createGlassAppearance} from './glass-design.mjs';
import {glassPresets} from './glass-presets.mjs';
import {createAquariumLayer} from './aquarium.mjs';
import {aquariumBackdrops} from './aquarium-backdrops.mjs';
import {createCosmosLayer} from './cosmos.mjs';
import {startBackdropWatch} from './native-watch.mjs';
import {getWindowsAppearancePolicy} from './windows-compat.mjs';
import {release,homedir} from 'node:os';
import {createTokenFeed} from './token-feed.mjs';
import {acquireHostLease} from './host-lease.mjs';
import {probeThemeStartup,showThemeLoading} from './startup-gate.mjs';
import {createAccountSwitcher} from './account-switcher.mjs';
const compatibility=getWindowsAppearancePolicy(release()).compatibility;
const exec=promisify(execFile),dir=dirname(fileURLToPath(import.meta.url)),runtime=join(dir,'.runtime');
await mkdir(runtime,{recursive:true});
const hostLease=await acquireHostLease(runtime);
if(!hostLease){console.log('Theme helper already running');process.exit(0);}
try {
const stopFile=join(runtime,'stop'),pidFile=join(runtime,'host.pid');
const cdpHint=process.env.CODEX_THEME_CDP_HINT;
await unlink(stopFile).catch(()=>{});
const tokenFeed=createTokenFeed(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions'),{cursorPath:join(runtime,'token-cursors.json')});
let source=null,startupTiming=null,assetQueue=Promise.resolve(),assetEpoch=0;
const assetFiles=new Set([...aquariumBackdrops.map(scene=>scene.file),'fish-atlas.png','fish-atlas-reef.png','fish-atlas-exotic.png','milky-way.png']);
async function publishAsset(name,contextId,isCurrent=()=>true){
 const assetStart=performance.now();
 const data=await readFile(join(dir,'assets',name));
 const evaluate=(expression,returnByValue=false)=>{
  if(!isCurrent())throw Error('Theme renderer changed during asset upload');
  return call('Runtime.evaluate',{expression,contextId,returnByValue});
 };
 await evaluate('window.__kenGlassAssetChunks=[]');
 for(let offset=0;offset<data.length;offset+=192*1024){
  const chunk=data.subarray(offset,offset+192*1024).toString('base64');
  const result=await evaluate('window.__kenGlassAssetChunks.push(((s)=>{const out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out})(atob('+JSON.stringify(chunk)+')))');
  if(result.exceptionDetails)throw Error('Image chunk upload failed: '+name);
  await sleep(5);
 }
 const result=await evaluate("(()=>{const url=URL.createObjectURL(new Blob(window.__kenGlassAssetChunks,{type:'image/png'}));(window.__kenGlassAssetURLs ||= []).push(url);delete window.__kenGlassAssetChunks;return url})()",true);
 if(!result.result?.value)throw Error('Image upload failed: '+name);
 startupTiming?.assets?.push({name,bytes:data.length,ms:Math.round(performance.now()-assetStart)});
 return result.result.value;
}
async function prepareTheme(){
if(source)return;
const [css,panelCss,panel]=await Promise.all(['glass.css','theme-panel.css','theme-panel.js'].map(name=>readFile(join(dir,name),'utf8')));
source=`window.__kenGlassWin10Compat=${compatibility};\n`+panel
 .replace('CSS_PLACEHOLDER',()=>JSON.stringify(css))
 .replace('APPEARANCE_PLACEHOLDER',()=>createGlassAppearance.toString())
 .replace('PRESETS_PLACEHOLDER',()=>JSON.stringify(glassPresets))
 .replace('PANEL_CSS_PLACEHOLDER',()=>JSON.stringify(panelCss))
 .replace('AQUARIUM_PLACEHOLDER',()=>createAquariumLayer.toString())
 .replace('AQUARIUM_IMAGE_PLACEHOLDER',()=>JSON.stringify(aquariumBackdrops))
 .replace('FISH_ATLAS_PLACEHOLDER','""')
 .replace('REEF_ATLAS_PLACEHOLDER','""')
 .replace('EXOTIC_ATLAS_PLACEHOLDER','""')
 .replace('COSMOS_PLACEHOLDER',()=>createCosmosLayer.toString())
 .replace('GALAXY_IMAGE_PLACEHOLDER','""');
}
function queueAsset({payload:name,executionContextId:contextId}){
 if(!assetFiles.has(name))return;
 const connection=socket,epoch=assetEpoch;
 const isCurrent=()=>connection===socket&&socket.readyState===1&&epoch===assetEpoch&&!stopping;
 assetQueue=assetQueue.then(async()=>{
  if(!isCurrent())return;
  let url='';
  try{url=await publishAsset(name,contextId,isCurrent);}catch(error){if(isCurrent())console.error(error.message);}
  if(isCurrent())await call('Runtime.evaluate',{expression:`window.__kenGlassPanel?.receiveAsset(${JSON.stringify(name)},${JSON.stringify(url)})`,contextId});
 }).catch(error=>{if(isCurrent())console.error(error.message);});
}
let socket=null,seq=0,pending=new Map(),nativeQueue=Promise.resolve(),nativeRevision=0,stopping=false;
let backdropWatch=null,nativeWanted=null,lastUsageSignature=null;
let codexPid=0;
let nativeRetryTimer=null,nativeFailures=0,nativeFailed=false,nativePending=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
async function native(mode,opacity=82,blur=false){const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',join(dir,'native-window.ps1'),'-Mode',mode,'-Opacity',String(opacity),'-Backdrop',blur?'acrylic':'clear','-CodexPid',String(codexPid)],{windowsHide:true,timeout:12000});return JSON.parse(stdout.trim())}
async function currentCdp(){
 if(cdpHint){
  const data=await readFile(cdpHint,'utf8').catch(()=>null);
  return data?JSON.parse(data):null;
 }
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',join(dir,'find-codex-cdp.ps1')],{windowsHide:true,timeout:12000});
 return {port:Number(stdout.trim()),mainPid:0};
}
function onNative(payload,retry=false){
 let value;try{value=JSON.parse(payload)}catch{return}
 if(!['set','background','restore'].includes(value.mode)||!Number.isFinite(value.opacity))return;
 clearTimeout(nativeRetryTimer);nativeRetryTimer=null;
 if(!retry)nativeFailures=0;
 nativePending=true;
 nativeWanted=value;
 backdropWatch?.off();
 const opacity=Math.max(value.mode==='background'?0:55,Math.min(100,Math.round(value.opacity)));
 const revision=++nativeRevision;
 nativeQueue=nativeQueue.catch(()=>{}).then(async()=>{
  if(revision!==nativeRevision||stopping)return;
  try{
   if(!backdropWatch&&!compatibility&&value.mode==='background')backdropWatch=await startBackdropWatch(dir,runtime,exec,backdropRepaired,backdropRepairFailed);
   await call('Emulation.setDefaultBackgroundColorOverride',value.mode==='background'?{color:{r:0,g:0,b:0,a:0}}:{});
   // Commit the renderer's alpha surface before DWM binds the backdrop to it.
   if(value.mode==='background')await call('Runtime.evaluate',{expression:'new Promise(resolve=>{const finish=()=>resolve(true);setTimeout(finish,150);requestAnimationFrame(()=>requestAnimationFrame(finish))})',awaitPromise:true});
   if(revision!==nativeRevision||stopping)return;
   const state=await native(value.mode,opacity,value.blur===true);
   if(revision===nativeRevision&&socket?.readyState===1){
    nativeFailed=false;nativeFailures=0;
    if(value.mode==='background')backdropWatch?.watch(state.handle,value.blur===true?3:1);
    await call('Runtime.evaluate',{expression:'window.__kenGlassNativeResult?.(true,"")'});
   }
  }catch(e){
   console.error(e.message);
   if(revision!==nativeRevision)return;
   nativeFailed=true;
   backdropWatch?.off();
   await native('restore').catch(()=>{});
   if(socket?.readyState===1){
    const transient=/Codex main window was not found|Codex is not running/.test(e.message);
    const retrying=transient&&nativeFailures<5&&!stopping;
    if(retrying){
     const delay=Math.min(8000,1000*2**nativeFailures++);
     console.error(new Date().toISOString(),`Native window not ready; retry ${nativeFailures}/5 in ${delay} ms`);
     nativeRetryTimer=setTimeout(()=>{nativeRetryTimer=null;if(!stopping&&revision===nativeRevision&&socket?.readyState===1)onNative(JSON.stringify(value),true);},delay);
    }
    await call('Emulation.setDefaultBackgroundColorOverride',{}).catch(()=>{});
    const message=retrying?'主視窗尚未就緒，背景助手正在自動重試。':transient?'主視窗尚未就緒；回到視窗時會重新套用背景。':'背景透明調整失敗，已還原原生視窗；請查看背景助手的錯誤紀錄。';
    await call('Runtime.evaluate',{expression:`window.__kenGlassNativeResult?.(false,${JSON.stringify(message)})`}).catch(()=>{});
   }
  }finally{if(revision===nativeRevision)nativePending=false;}
 });
}
function backdropRepaired(state){
 if(stopping||socket?.readyState!==1||nativeWanted?.mode!=='background')return;
 if(state.expected!==(nativeWanted.blur===true?3:1))return;
 console.log(new Date().toISOString(),`Native backdrop restored directly: ${state.actual} -> ${state.expected}`);
 call('Runtime.evaluate',{expression:'window.__kenGlassNativeRepaired?.()'}).catch(()=>{});
}
function backdropRepairFailed(state){
 if(stopping||socket?.readyState!==1||nativeWanted?.mode!=='background')return;
 if(state.expected!==(nativeWanted.blur===true?3:1))return;
 console.error('Direct backdrop repair failed; using full initialization.');
 onNative(JSON.stringify(nativeWanted));
}
async function checkBackdrop(payload){
 if(stopping||socket?.readyState!==1)return;
 if(payload==='stats'){
  const stats=await backdropWatch?.stats();
  if(socket?.readyState===1)await call('Runtime.evaluate',{expression:`window.__kenGlassNativeStats=${JSON.stringify(stats??null)}`});
 }else if(payload==='check'&&nativeWanted?.mode==='background'){
  // A failed first application has no watched HWND. A CHECK on an OFF watcher
  // cannot repair it: replay the request when the window becomes available.
  if(nativeFailed&&!nativePending)onNative(JSON.stringify(nativeWanted));
  else backdropWatch?.check();
 }
}
const accountWorld='CodexGlassAccounts';
let accountContext=null, accountAttempted=false;
const accountSwitcher=process.platform==='win32'&&process.env.LOCALAPPDATA&&cdpHint
 ?createAccountSwitcher({
  root:join(process.env.LOCALAPPDATA,'Codex Glass Themes','accounts'),
  script:join(dir,'account-windows.ps1'),
  getTarget:async()=>(await currentCdp())?.mainPid,
  getCurrentLimits:async refresh=>{
   const result=await call('Runtime.evaluate',{expression:'window.__kenUsageShortcuts?.readLimits('+Boolean(refresh)+')',returnByValue:true,awaitPromise:true});
   return result.result?.value;
  },
  quit:async()=>{
   const result=await call('Runtime.evaluate',{expression:'(()=>{const api=window.electronBridge;if(typeof api?.sendMessageFromView!=="function")return false;setTimeout(()=>Promise.resolve(api.sendMessageFromView({type:"quit-app"})).catch(()=>{}),0);return true})()',returnByValue:true});
   if(result.result?.value!==true)throw Error('Native quit is unavailable');
  }
 }):null;
async function mountAccountPanel(){
 if(!accountSwitcher||accountAttempted)return;
 accountAttempted=true;
 try{
  const {frameTree}=await call('Page.getFrameTree');
  const {executionContextId}=await call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:accountWorld});
  const result=await call('Runtime.evaluate',{contextId:executionContextId,expression:await readFile(join(dir,'account-panel.js'),'utf8'),returnByValue:true});
  if(result.result?.value===true)accountContext=executionContextId;
 }catch{console.error('Codex account panel could not start');}
}
async function handleAccounts({payload,executionContextId}){
 if(!accountSwitcher||executionContextId!==accountContext||payload.length>1000)return;
 let message;try{message=JSON.parse(payload)}catch{return}
 if(!message||!Number.isSafeInteger(message.request)||!['list','save','add','cancel','switch','quota'].includes(message.action))return;
 const connection=socket;
 const data=await accountSwitcher.request(message.action,message.id);
 if(connection!==socket||accountContext!==executionContextId||socket.readyState!==1)return;
 await call('Runtime.evaluate',{contextId:executionContextId,expression:'window.__kenAccountPanel?.receive('+JSON.stringify(message.action)+','+JSON.stringify(data)+')'});
}
async function connect(){
 const info=await currentCdp();if(!info)return;
 const {port,mainPid}=info;
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid Codex CDP port');
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)})).json();
 const target=targets.find(t=>t.type==='page'&&t.url==='app://-/index.html');if(!target)throw Error('Waiting for main window');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
 codexPid=mainPid;accountContext=null;accountAttempted=false;
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.executionContextsCleared'){lastUsageSignature=null;assetEpoch++;accountContext=null;accountAttempted=false;}const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.bindingCalled'){
  if(m.params.name==='__kenGlassNative')onNative(m.params.payload);
  else if(m.params.name==='__kenGlassNativeCheck')checkBackdrop(m.params.payload).catch(e=>console.error(e.message));
  else if(m.params.name==='__kenGlassLoadAsset')queueAsset(m.params);
  else if(m.params.name==='__kenAccountsRequest')handleAccounts(m.params).catch(()=>{});
 }};
 socket.onclose=()=>{assetEpoch++;nativeRevision++;clearTimeout(nativeRetryTimer);nativeRetryTimer=null;backdropWatch?.off();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP disconnected'))}pending.clear()};
 lastUsageSignature=null;startupTiming={connectedAt:new Date().toISOString(),start:performance.now(),assets:[]};
 await call('Runtime.enable');await call('Page.enable');
 await call('Runtime.addBinding',{name:'__kenGlassNative'});
 await call('Runtime.addBinding',{name:'__kenGlassNativeCheck'});
 await call('Runtime.addBinding',{name:'__kenGlassLoadAsset'});
 if(accountSwitcher)await call('Runtime.addBinding',{name:'__kenAccountsRequest',executionContextName:accountWorld}).catch(()=>{});
 console.log(new Date().toISOString(),'Theme connected; waiting for app shell');
}
async function mountWhenReady(){
 const probe=await call('Runtime.evaluate',{expression:`(${probeThemeStartup.toString()})()`,returnByValue:true});
 if(probe.result?.value==='mounted')return true;
 if(probe.result?.value!=='ready')return false;
 const readyAt=performance.now();
 if(startupTiming)startupTiming.gateMs=Math.round(readyAt-startupTiming.start);
 await prepareTheme();
 const preparedAt=performance.now();
 if(startupTiming)startupTiming.prepareMs=Math.round(preparedAt-readyAt);
 await call('Runtime.evaluate',{expression:`(${showThemeLoading.toString()})()`});
 try{
  const evalStart=performance.now();
  const result=await call('Runtime.evaluate',{expression:source});
  const evalEnd=performance.now();
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  await nativeQueue;
  if(startupTiming){
   const timing={...startupTiming,evalMs:Math.round(evalEnd-evalStart),visualMs:Math.round(evalEnd-startupTiming.start),nativeMs:Math.round(performance.now()-evalEnd),totalMs:Math.round(performance.now()-startupTiming.start),payloadBytes:Buffer.byteLength(source)};
   delete timing.start;
   await writeFile(join(runtime,'startup-timing.json'),JSON.stringify(timing,null,2)).catch(()=>{});
   console.log(new Date().toISOString(),'Theme startup timing',JSON.stringify(timing));
  }
  console.log(new Date().toISOString(),'Theme mounted after app shell settled');
  return true;
 }finally{
  await call('Runtime.evaluate',{expression:"document.getElementById('ken-theme-loading')?.remove()"}).catch(()=>{});
 }
}
process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
try{
 while(!stopping){
  try{await access(stopFile);stopping=true;break}catch{}
  if(!socket||socket.readyState!==1){try{await connect()}catch(e){console.error(new Date().toISOString(),e.message);socket?.close();socket=null}}
  let mounted=false;
  if(socket?.readyState===1)try{mounted=await mountWhenReady()}catch(e){console.error('Theme startup:',e.message)}
  try{
   if(!mounted){await sleep(socket?.readyState===1?250:cdpHint?500:2000);continue;}
   await mountAccountPanel();
   const usage=await tokenFeed.poll();
   const signature=JSON.stringify([usage.totalTokens,usage.errors]);
   if(socket?.readyState===1&&(usage.events.length||signature!==lastUsageSignature)){
    const accepted=await call('Runtime.evaluate',{expression:`Boolean(window.__kenGlassPanel&&(window.__kenGlassPanel.receiveTokenUsage(${JSON.stringify(usage)}),true))`,returnByValue:true});
    if(accepted.result?.value)lastUsageSignature=signature;
   }
  }catch(e){console.error('Token feed:',e.message);}
  await sleep(2000);
 }
}finally{
 clearTimeout(nativeRetryTimer);nativeRetryTimer=null;
 await backdropWatch?.stop();
 await nativeQueue.catch(()=>{});
 if(socket?.readyState===1){
  await call('Runtime.evaluate',{expression:"document.getElementById('ken-theme-loading')?.remove()"}).catch(()=>{});
  await call('Runtime.evaluate',{expression:'window.__kenGlassPanel?.dispose(true)'}).catch(()=>{});
  await call('Runtime.evaluate',{expression:'window.__kenGlassAssetURLs?.forEach(url=>URL.revokeObjectURL(url));delete window.__kenGlassAssetURLs;delete window.__kenGlassAssetChunks'}).catch(()=>{});
  await call('Runtime.removeBinding',{name:'__kenGlassNative'}).catch(()=>{});
  await call('Runtime.removeBinding',{name:'__kenGlassNativeCheck'}).catch(()=>{});
  await call('Runtime.removeBinding',{name:'__kenGlassLoadAsset'}).catch(()=>{});
  if(accountContext)await call('Runtime.evaluate',{contextId:accountContext,expression:'window.__kenAccountPanel?.dispose()'}).catch(()=>{});
  if(accountSwitcher)await call('Runtime.removeBinding',{name:'__kenAccountsRequest'}).catch(()=>{});
  await call('Emulation.setDefaultBackgroundColorOverride',{}).catch(()=>{});
 }
 if(nativeWanted)await native('restore').catch(()=>{});socket?.close();console.log('Original appearance restored');
}
} finally {await hostLease.release();}
