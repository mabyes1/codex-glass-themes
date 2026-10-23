// Record the shipping aquarium renderer in an isolated Chromium profile.
// No Codex conversations, account data or real quota values enter this fixture.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAquariumLayer} from '../packaging/payload/theme/aquarium.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'dist','v2-video');await mkdir(out,{recursive:true});
const profile=join(out,'chrome-profile'),framesDir=join(out,'frames');await mkdir(framesDir,{recursive:true});
const executable=process.env.CHROME_PATH||join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe');await access(executable);
const dir=join(root,'packaging','payload','theme','assets');
const server=createServer(async(req,res)=>{
 try{
  const name=req.url.slice(1);
  if(['fish-atlas.png','fish-atlas-reef.png','fish-atlas-exotic.png','deep-sea-bioluminescent.png'].includes(name)){res.setHeader('Content-Type','image/png');res.end(await readFile(join(dir,name)));return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#061626;color:#f1f5ff;font-family:'Segoe UI','Microsoft JhengHei',sans-serif}header{height:170px;padding:28px 36px 16px}small{color:#9abccf;font-size:17px;letter-spacing:3px}h1{font-size:38px;margin:8px 0 4px}header p{font-size:19px;color:#aacae0;margin:0}.grid{height:1030px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;padding:0 18px}section{position:relative;overflow:hidden;background:#092338;border:1px solid #9bc6e32b;border-radius:14px}.label{position:absolute;top:15px;left:18px;z-index:2;text-shadow:0 2px 8px #000}h2{margin:0;font-size:28px}.label p{margin:4px 0;font-size:17px;color:#e3edfa}footer{height:150px;padding:18px 36px;font-size:21px;line-height:1.6}footer strong{color:#f4d58b}.note{font-size:16px;color:#aacae0}</style><header><small>CODEX GLASS THEMES · v2.0.0</small><h1>燒掉的 token，拿來餵魚。</h1><p id="caption">四種模型，四種口味。魚魚自己搶，吃完自己演。</p></header><div class="grid">${[['astra','Astra','金色飼料 🥹💖✨'],['sol','Sol','高級飼料 😋💕'],['terra','Terra','普通飼料 😑💭'],['luna','Luna','可疑口味 🤢🤮']].map(([tier,name,desc])=>`<section id="${tier}"><div class="label"><h2>${name}</h2><p>${desc}</p></div></section>`).join('')}</div><footer><strong>還有額度觀測：</strong>5 小時／每週剩餘、恢復時間、重置券<div class="note">獨立測試場景 · 手動試吃不增加用量 · 重置仍需 Codex 原生確認</div></footer><script>const create=${createAquariumLayer.toString()};window.layers=[];for(const tier of ['astra','sol','terra','luna']){const layer=create(document.getElementById(tier),'/deep-sea-bioluminescent.png','/fish-atlas.png','/fish-atlas-reef.png','/fish-atlas-exotic.png');layer.setFishCount(24);layer.setActive(true);window.layers.push({tier,layer});}window.ready=()=>layers.every(x=>x.layer.getDiagnostics().fishReady);window.feed=()=>layers.forEach(x=>x.layer.previewFood(x.tier));</script>`);
 }catch(e){res.statusCode=500;res.end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=spawn(executable,['--headless=new','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'--window-size=1080,1350','--no-first-run','--no-default-browser-check',`http://127.0.0.1:${server.address().port}`],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,id=0,queue=Promise.resolve(),capturing=false;const pending=new Map(),frames=[],exceptions=[];
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
try{
 let port;for(let i=0;i<150;i++){const text=await readFile(join(profile,'DevToolsActivePort'),'utf8').catch(()=>null);if(text){port=Number(text.split(/\r?\n/)[0]);break;}await delay(100);}
 if(!port)throw Error('Chromium did not start');const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params);
  if(m.method==='Page.screencastFrame'){
   call('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});if(!capturing)return;
   const path=join(framesDir,String(frames.length).padStart(5,'0')+'.jpg');frames.push({path,time:m.params.metadata.timestamp});
   const data=Buffer.from(m.params.data,'base64');queue=queue.then(()=>writeFile(path,data));
  }
 };
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1080,height:1350,deviceScaleFactor:1,mobile:false});
 for(let i=0;i<150;i++){if(await evaluate('window.ready?.()'))break;if(i===149)throw Error('Fish atlases not ready');await delay(100);}
 capturing=true;await call('Page.startScreencast',{format:'jpeg',quality:88,maxWidth:1080,maxHeight:1350,everyNthFrame:1});
 await delay(1800);await evaluate('window.feed()');await delay(12500);
 const poster=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'docs','images','token-aquarium-v2.png'),Buffer.from(poster.data,'base64'));
 await evaluate("window.feed();document.getElementById('caption').textContent='搶到了 😋｜沒搶到 🥺💨｜吃到 Luna 🤢🤮';");await delay(15500);
 await evaluate("document.getElementById('caption').textContent='Codex Glass Themes v2.0.0 · GitHub 開源下載';");await delay(3000);
 capturing=false;await call('Page.stopScreencast');await queue;
 const stats=await evaluate('window.layers.map(({tier,layer})=>({tier,...layer.getDiagnostics()}))');
 if(exceptions.length)throw Error(JSON.stringify(exceptions));if(!stats.every(x=>x.feeding.eaten[x.tier]>0)||!stats.find(x=>x.tier==='luna').feeding.vomitBursts)throw Error('Missing reactions: '+JSON.stringify(stats));
 const lines=[];for(let i=0;i<frames.length;i++){lines.push(`file '${frames[i].path.replaceAll('\\','/')}'`);if(i+1<frames.length)lines.push('duration '+Math.max(.001,frames[i+1].time-frames[i].time).toFixed(6));}lines.push(`file '${frames.at(-1).path.replaceAll('\\','/')}'`);
 await writeFile(join(out,'frames.txt'),lines.join('\n'));await writeFile(join(out,'recording-report.json'),JSON.stringify({frames:frames.length,duration:frames.at(-1).time-frames[0].time,stats},null,2));console.log(JSON.stringify({out,frames:frames.length,allFourEaten:true,lunaVomited:true}));
}finally{if(ws?.readyState===1){await call('Browser.close').catch(()=>{});ws.close();}browser.kill();server.close();}
