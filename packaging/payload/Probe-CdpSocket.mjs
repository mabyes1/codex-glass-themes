import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [profile,themeRoot]=process.argv.slice(2);
const inspectTheme=themeRoot==='--inspect-theme';
let themeSource=null;
if(themeRoot&&!inspectTheme){
  const {createGlassAppearance}=await import(pathToFileURL(join(themeRoot,'glass-design.mjs')));
  const {glassPresets}=await import(pathToFileURL(join(themeRoot,'glass-presets.mjs')));
  const [css,panelCss,panel]=await Promise.all(['glass.css','theme-panel.css','theme-panel.js'].map(name=>readFile(join(themeRoot,name),'utf8')));
  themeSource=panel.replace('CSS_PLACEHOLDER',()=>JSON.stringify(css)).replace('APPEARANCE_PLACEHOLDER',()=>createGlassAppearance.toString()).replace('PRESETS_PLACEHOLDER',()=>JSON.stringify(glassPresets)).replace('PANEL_CSS_PLACEHOLDER',()=>JSON.stringify(panelCss));
}
let port,path;
if(/^port:\d+$/.test(profile)){
  port=profile.slice(5);if(Number(port)<1||Number(port)>65535)throw Error('Invalid loopback port');
  const version=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(3000)}).then(response=>response.json());
  const endpoint=new URL(version.webSocketDebuggerUrl);
  if(endpoint.hostname!=='127.0.0.1'||endpoint.port!==port)throw Error('CDP endpoint is not the selected loopback listener');
  path=endpoint.pathname;
}else{[port,path]=(await readFile(`${profile}/DevToolsActivePort`,'utf8')).trim().split(/\r?\n/);}
if(!/^\d+$/.test(port)||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path))throw Error('Invalid probe CDP endpoint');
const result={port:Number(port),opened:false,mainPresent:false,targetCount:null,rendererReady:false,renderer:null,theme:null,error:null};
const socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);
await new Promise(resolve=>{
  let sessionId;
  const finish=()=>{clearTimeout(timer);socket.close();resolve()};
  const timer=setTimeout(()=>{result.error='Connection or approval timed out';finish()},12000);
  socket.onopen=()=>{result.opened=true;socket.send(JSON.stringify({id:1,method:'Target.getTargets'}))};
  socket.onmessage=e=>{
    const m=JSON.parse(e.data);if(!m.id)return;
    if(m.error){result.error=m.error.message;finish();return}
    if(m.id===1){
      const targets=m.result.targetInfos;result.targetCount=targets.length;
      const main=targets.find(t=>t.type==='page'&&t.url==='app://-/index.html');
      result.mainPresent=!!main;if(!main){finish();return}
      socket.send(JSON.stringify({id:2,method:'Target.attachToTarget',params:{targetId:main.targetId,flatten:true}}));
    }else if(m.id===2){
      sessionId=m.result.sessionId;
      socket.send(JSON.stringify({id:3,sessionId:m.result.sessionId,method:'Runtime.evaluate',params:{expression:'new Promise(resolve => { const check = () => { const elements=document.body?.querySelectorAll("*").length || 0; if (document.readyState !== "loading" && elements > 10) resolve({readyState:document.readyState,bodyChildren:document.body.childElementCount,elements}); else setTimeout(check,100); }; check(); })',awaitPromise:true,returnByValue:true}}));
    }else if(m.id===3){
      if(m.result.exceptionDetails)result.error='Renderer evaluation failed';
      else{result.renderer=m.result.result.value;result.rendererReady=!!result.renderer?.bodyChildren}
      if(themeSource&&!result.error){socket.send(JSON.stringify({id:4,sessionId,method:'Runtime.evaluate',params:{expression:themeSource,returnByValue:true}}));return}
      if(inspectTheme&&!result.error){socket.send(JSON.stringify({id:5,sessionId,method:'Runtime.evaluate',params:{expression:'({mounted:!!window.__kenGlassPanel && !!document.getElementById("ken-glass-switcher")?.shadowRoot?.getElementById("toggle"),styleLength:document.getElementById("ken-codex-glass")?.textContent.length||0,mode:window.__kenGlassPanel?.getState().mode})',returnByValue:true}}));return}
      finish();
    }else if(m.id===4){
      if(m.result.exceptionDetails){result.error='Theme injection failed';finish();return}
      socket.send(JSON.stringify({id:5,sessionId,method:'Runtime.evaluate',params:{expression:'({mounted:!!window.__kenGlassPanel && !!document.getElementById("ken-glass-switcher")?.shadowRoot?.getElementById("toggle"),styleLength:document.getElementById("ken-codex-glass")?.textContent.length||0,mode:window.__kenGlassPanel?.getState().mode})',returnByValue:true}}));
    }else if(m.id===5){
      result.theme=m.result.result.value;
      if(!result.theme?.mounted||result.theme.styleLength<500)result.error='Theme panel or CSS was not mounted';
      finish();
    }
  };
  socket.onerror=e=>{result.error=e.message||'WebSocket connection rejected';finish()};
  socket.onclose=e=>{if(!result.targetCount&&!result.error)result.error=`Closed ${e.code} ${e.reason}`;finish()};
});
if(!result.opened){
  result.handshake=await new Promise(resolve=>{
    const request=http.request({host:'127.0.0.1',port:Number(port),path,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'}},response=>{
      let body='';response.on('data',chunk=>{if(body.length<240)body+=chunk});response.on('end',()=>resolve({status:response.statusCode,message:body.slice(0,240)}));
    });
    request.setTimeout(3000,()=>{request.destroy();resolve({error:'Handshake timed out'})});
    request.on('upgrade',(response,socket)=>{socket.destroy();resolve({status:response.statusCode})});
    request.on('error',error=>resolve({error:error.message}));request.end();
  });
}
console.log(JSON.stringify(result));
