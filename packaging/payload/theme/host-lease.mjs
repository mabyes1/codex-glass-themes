import {createServer} from 'node:net';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {readFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';

// The OS owns the pipe, so crashes release the lock without a stale-file race.
// Encode the installation path directly; no content digest is involved.
export async function acquireHostLease(runtime) {
  await mkdir(runtime,{recursive:true});
  const name=Buffer.from(resolve(runtime).toLowerCase()).toString('base64url');
  const address=process.platform==='win32'?`\\\\.\\pipe\\CodexGlassThemeHost-${name}`:join(runtime,'host.sock');
  const server=createServer(socket=>socket.end());
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(address,()=>{server.removeListener('error',reject);resolve();});
    });
  } catch(error) {
    if(error.code==='EADDRINUSE')return null;
    throw error;
  }
  server.unref();
  const pidFile=join(runtime,'host.pid'),owner=String(process.pid);
  const onExit=()=>{try{if(readFileSync(pidFile,'utf8')===owner)unlinkSync(pidFile);}catch{}};
  process.once('exit',onExit);
  try {await writeFile(pidFile,owner);}catch(error){server.close();process.removeListener('exit',onExit);throw error;}
  let released=false;
  return {async release(){
    if(released)return;released=true;
    try{if(await readFile(pidFile,'utf8')===owner)await unlink(pidFile);}catch{}
    process.removeListener('exit',onExit);
    await new Promise(resolve=>server.close(resolve));
  }};
}
