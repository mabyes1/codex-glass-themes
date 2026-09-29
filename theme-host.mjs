import {readFile,writeFile,mkdir,unlink,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),dir=dirname(fileURLToPath(import.meta.url)),runtime=join(dir,'.runtime');
await mkdir(runtime,{recursive:true});
const stopFile=join(runtime,'stop'),pidFile=join(runtime,'host.pid');
await unlink(stopFile).catch(()=>{});await writeFile(pidFile,String(process.pid));
const themes={color:await readFile(join(dir,'blue-glass.css'),'utf8'),clear:await readFile(join(dir,'clear-glass.css'),'utf8')};
const source=(await readFile(join(dir,'theme-panel.js'),'utf8')).replace('THEMES_PLACEHOLDER',JSON.stringify(themes));
let socket=null,seq=0,pending=new Map(),nativeQueue=Promise.resolve(),stopping=false,scriptId=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
async function native(mode,opacity=82,blur=false){const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',join(dir,'native-window.ps1'),'-Mode',mode,'-Opacity',String(opacity),'-Backdrop',blur?'acrylic':'clear'],{windowsHide:true,timeout:12000});return JSON.parse(stdout.trim())}
async function currentCdpPort(){
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',join(dir,'find-codex-cdp.ps1')],{windowsHide:true,timeout:12000});
 const port=Number(stdout.trim());if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid Codex CDP port');return port;
}
function onNative(payload){
 let value;try{value=JSON.parse(payload)}catch{return}
 if(!['set','background','restore'].includes(value.mode)||!Number.isFinite(value.opacity))return;
 const opacity=Math.max(value.mode==='background'?0:55,Math.min(100,Math.round(value.opacity)));
 nativeQueue=nativeQueue.catch(()=>{}).then(async()=>{
  try{
   await call('Emulation.setDefaultBackgroundColorOverride',value.mode==='background'?{color:{r:0,g:0,b:0,a:0}}:{});
   await native(value.mode,opacity,value.blur===true);
   if(socket?.readyState===1)await call('Runtime.evaluate',{expression:'window.__kenGlassNativeResult?.(true,"")'});
  }catch(e){
   console.error(e.message);
   await native('restore').catch(()=>{});
   if(socket?.readyState===1){
    await call('Emulation.setDefaultBackgroundColorOverride',{}).catch(()=>{});
    await call('Runtime.evaluate',{expression:`window.__kenGlassNativeResult?.(false,${JSON.stringify('背景透明調整失敗，已還原原生視窗；可關閉「保持前景清晰」使用原模式。')})`}).catch(()=>{});
   }
  }
 });
}
async function connect(){
 const port=await currentCdpPort();
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2500)})).json();
 const target=targets.find(t=>t.type==='page'&&t.url==='app://-/index.html');if(!target)throw Error('Waiting for main window');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
 socket.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.bindingCalled'&&m.params.name==='__kenGlassNative')onNative(m.params.payload)};
 socket.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP disconnected'))}pending.clear()};
 await call('Runtime.enable');await call('Page.enable');
 await call('Runtime.addBinding',{name:'__kenGlassNative'});
 scriptId=(await call('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;
 const result=await call('Runtime.evaluate',{expression:source});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 console.log(new Date().toISOString(),'Theme switcher connected');
}
process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
try{
 while(!stopping){
  try{await access(stopFile);stopping=true;break}catch{}
  if(!socket||socket.readyState!==1){try{await connect()}catch(e){console.error(new Date().toISOString(),e.message);socket?.close();socket=null}}
  await sleep(2000);
 }
}finally{
 await nativeQueue.catch(()=>{});
 if(socket?.readyState===1){
  if(scriptId)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId}).catch(()=>{});
  await call('Runtime.evaluate',{expression:'window.__kenGlassPanel?.dispose(true)'}).catch(()=>{});
  await call('Runtime.removeBinding',{name:'__kenGlassNative'}).catch(()=>{});
  await call('Emulation.setDefaultBackgroundColorOverride',{}).catch(()=>{});
 }
 await native('restore').catch(()=>{});socket?.close();await unlink(pidFile).catch(()=>{});console.log('Original appearance restored');
}
