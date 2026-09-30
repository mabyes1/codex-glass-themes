import {spawn} from 'node:child_process';
import {access,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

export async function startBackdropWatch(dir, runtime, exec, onMismatch) {
  const source = join(dir, 'NativeBackdropWatch.cs');
  const executable = join(runtime, 'NativeBackdropWatch.exe');
  const built = await stat(executable).catch(() => null);
  if (!built || built.mtimeMs < (await stat(source)).mtimeMs) {
    const compiler = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    await access(compiler);
    await exec(compiler, ['/nologo', '/target:exe', '/out:' + executable, source], {windowsHide:true, timeout:12000});
  }
  const child = spawn(executable, [], {windowsHide:true, stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const closed = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({input:child.stdout});
  lines.on('line', line => {
    const match = /^MISMATCH (\d+) (-?\d+) ([13])$/.exec(line);
    if (match) onMismatch({handle:Number(match[1]),actual:Number(match[2]),expected:Number(match[3])});
  });
  child.stderr.on('data', chunk => console.error('Backdrop watcher:', String(chunk).trim()));
  child.stdin.on('error', error => console.error('Backdrop watcher pipe:', error.message));
  const send = command => { if (!child.killed && child.stdin.writable) child.stdin.write(command + '\n'); };
  return {
    off:() => send('OFF'),
    watch:(handle, expected) => send(`WATCH ${handle} ${expected}`),
    async stop() {
      send('STOP'); child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 2000);
      try { await closed; } finally { clearTimeout(timeout); lines.close(); }
    }
  };
}
