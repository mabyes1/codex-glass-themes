import {spawn} from 'node:child_process';
import {access,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

export async function startBackdropWatch(dir, runtime, exec, onRepaired, onFailure) {
  const source = join(dir, 'NativeBackdropWatch.cs');
  const executable = join(runtime, 'NativeBackdropWatch.exe');
  const built = await stat(executable).catch(() => null);
  if (!built || built.mtimeMs < (await stat(source)).mtimeMs) {
    const compiler = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    await access(compiler);
    await exec(compiler, ['/nologo', '/target:exe', '/reference:System.Windows.Forms.dll', '/out:' + executable, source], {windowsHide:true, timeout:12000});
  }
  const child = spawn(executable, [], {windowsHide:true, stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const closed = new Promise(resolve => child.once('close', resolve));
  const lines = createInterface({input:child.stdout});
  let statsRequest = null;
  lines.on('line', line => {
    const match = /^(REPAIRED|REPAIR_FAILED) (\d+) (-?\d+) ([13])$/.exec(line);
    if (match) (match[1] === 'REPAIRED' ? onRepaired : onFailure)?.({handle:Number(match[2]),actual:Number(match[3]),expected:Number(match[4])});
    const stats = /^STATS (\d+) (\d+)$/.exec(line);
    if (stats && statsRequest) { statsRequest.resolve({checks:Number(stats[1]),notifications:Number(stats[2])}); statsRequest = null; }
  });
  child.stderr.on('data', chunk => console.error('Backdrop watcher:', String(chunk).trim()));
  child.stdin.on('error', error => console.error('Backdrop watcher pipe:', error.message));
  const send = command => { if (!child.killed && child.stdin.writable) child.stdin.write(command + '\n'); };
  return {
    off:() => send('OFF'),
    check:() => send('CHECK'),
    watch:(handle, expected) => send(`WATCH ${handle} ${expected}`),
    async stats() {
      if (statsRequest) return statsRequest.promise;
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      statsRequest = {promise,resolve}; send('STATS');
      const timeout = setTimeout(() => { if (statsRequest?.promise === promise) { statsRequest = null; resolve(null); } },1000);
      try { return await promise; } finally { clearTimeout(timeout); }
    },
    async stop() {
      send('STOP'); child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 2000);
      try { await closed; } finally { clearTimeout(timeout); lines.close(); }
    }
  };
}
