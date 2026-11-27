import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

class AccountError extends Error {}

function quotaSnapshot(payload) {
  if (!payload) return null;
  const limits = payload.rateLimitsByLimitId?.codex || payload.rateLimits;
  const windows = [limits?.primary, limits?.secondary];
  function remaining(minutes, fallback) {
    const slot = windows.find(value => value?.windowDurationMins === minutes)
      || (fallback?.windowDurationMins == null ? fallback : null);
    return Number.isFinite(slot?.usedPercent) ? Math.round(Math.max(0, Math.min(100, 100 - slot.usedPercent))) : null;
  }
  const fiveHour = remaining(300, limits?.primary);
  const weekly = remaining(10080, limits?.secondary);
  const count = payload.rateLimitResetCredits?.availableCount;
  const resetCredits = Number.isSafeInteger(count) && count >= 0 ? count : null;
  if (fiveHour === null && weekly === null && resetCredits === null) return null;
  return { fiveHour, weekly, resetCredits, updatedAt: payload.updatedAt || Date.now() };
}

function identity(bytes) {
  try {
    const { tokens } = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const { access_token, refresh_token, id_token, account_id } = tokens;
    if (![access_token, refresh_token, id_token, account_id].every(value => typeof value === 'string' && value)) return null;
    const claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'));
    const user = claims['https://api.openai.com/auth']?.chatgpt_user_id || claims.sub;
    const email = claims.email || claims['https://api.openai.com/profile']?.email;
    return user && typeof email === 'string' && email.includes('@') ? { user, workspace: account_id, email } : null;
  } catch {
    return null;
  }
}

const sameAccount = (a, b) => Boolean(a && b && a.user === b.user && a.workspace === b.workspace);

async function read(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

async function replace(path, data) {
  const temporary = path + '.theme-' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function windows(script, action, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timeout = setTimeout(() => child.kill(), 12000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => { output += text; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error('Windows operation failed'));
    });
    child.stdin.end(input);
  });
}

function loginServer(executable, home) {
  const env = { ...process.env, CODEX_HOME: home };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN']) delete env[key];
  const child = spawn(executable, ['app-server', '--stdio'], {
    env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']
  });
  const pending = new Map();
  let id = 0;
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  function disconnect() {
    for (const request of pending.values()) request(null);
    pending.clear();
    finish(null);
  }
  child.on('error', disconnect);
  child.once('close', disconnect);
  child.stdin.on('error', disconnect);
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'account/login/completed') finish(message.params);
      pending.get(message.id)?.(message.result);
    } catch {}
  });
  return {
    completed,
    initialized: () => send({ method: 'initialized' }),
    request(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const consume = result => {
          clearTimeout(timeout);
          pending.delete(requestId);
          if (result == null) reject(new Error('Login RPC failed'));
          else resolve(result);
        };
        const timeout = setTimeout(() => consume(null), 15000);
        pending.set(requestId, consume);
        send({ id: requestId, method, params });
      });
    },
    async close() {
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 1000);
      await closed;
      clearTimeout(timeout);
    }
  };
}

export function createAccountSwitcher({
  root, script, getTarget, quit, getCurrentLimits = async () => null,
  home = process.env.CODEX_HOME || join(homedir(), '.codex'),
  run = (action, input) => windows(script, action, input),
  openLogin = loginServer,
  pause = delay
}) {
  const store = join(root, 'accounts.json');
  const liveAuth = join(home, 'auth.json');
  const status = join(root, 'switch-status.json');
  let phase = '';
  let login = null;
  let activeQuota = null;
  const getAccounts = async () => JSON.parse(await read(store) || '{"accounts":[]}').accounts;
  const inspect = async () => JSON.parse(await run('inspect'));

  async function checkStorage() {
    const config = (await read(join(home, 'config.toml')))?.toString('utf8') || '';
    const setting = config.split(/^[ \t]*\[/m, 1)[0].match(/^[ \t]*cli_auth_credentials_store[ \t]*=[ \t]*([^\r\n#]+)/m);
    const ageStore = await access(join(home, 'secrets', 'codex_auth.age')).then(() => true, () => false);
    if (ageStore || (setting && !/^["']file["']$/.test(setting[1].trim()))) {
      throw new AccountError('目前只支援 Windows 上的檔案型 ChatGPT 登入。');
    }
  }

  async function save(bytes, account, quota) {
    const accounts = await getAccounts();
    const old = accounts.find(value => sameAccount(value, account));
    const encrypted = await run('protect', bytes.toString('base64'));
    if (!encrypted) throw new Error('Credential protection failed');
    const next = { ...account, id: old?.id || randomUUID(), encrypted, quota: quota || old?.quota };
    const entries = old ? accounts.map(value => value.id === old.id ? next : value) : [...accounts, next];
    await replace(store, JSON.stringify({ accounts: entries }));
  }

  async function model() {
    const bytes = await read(liveAuth);
    const active = identity(bytes);
    const fileMode = await checkStorage().then(() => true, () => false);
    const accounts = await getAccounts();
    const currentQuota = active ? await readCurrentQuota(active) || accounts.find(account => sameAccount(account, active))?.quota : null;
    return {
      phase, supported: fileMode && (!bytes || Boolean(active)), current: active?.email || '',
      currentQuota: currentQuota || null,
      accounts: accounts.map(account => ({
        id: account.id, email: account.email, active: sameAccount(account, active), quota: account.quota || null
      })),
      status: JSON.parse(await read(status) || 'null')
    };
  }

  async function readCurrentQuota(account, refresh = false) {
    const quota = quotaSnapshot(await getCurrentLimits(refresh).catch(() => null));
    if (quota && (!sameAccount(activeQuota?.account, account) || quota.updatedAt >= activeQuota.quota.updatedAt)) {
      activeQuota = { account, quota };
    }
    return sameAccount(activeQuota?.account, account) ? activeQuota.quota : null;
  }

  async function refreshQuota(id) {
    const activeBytes = await read(liveAuth);
    const active = identity(activeBytes);
    const accounts = await getAccounts();
    const selected = accounts.find(account => account.id === id);
    if (id === 'current' || sameAccount(selected, active)) {
      if (!active) throw new AccountError('目前沒有登入的 ChatGPT 帳號。');
      const quota = quotaSnapshot(await getCurrentLimits(true).catch(() => null));
      if (!quota) throw new AccountError('目前帳號的額度暫時讀不到。');
      activeQuota = { account: active, quota };
      const latest = await read(liveAuth);
      if (accounts.some(account => sameAccount(account, active)) && sameAccount(identity(latest), active)) {
        await save(latest, active, quota);
      }
      return;
    }
    if (!selected) throw new AccountError('找不到這個已儲存的帳號。');
    const { cli } = await inspect();
    if (!cli) throw new AccountError('找不到 Codex 官方程式，暫時無法讀取額度。');
    const bytes = Buffer.from(await run('unprotect', selected.encrypted), 'base64');
    if (!sameAccount(identity(bytes), selected)) throw new AccountError('這個帳號需要重新登入。');

    const stage = await mkdtemp(join(root, 'limits-'));
    const stageAuth = join(stage, 'auth.json');
    let client, quota;
    try {
      await writeFile(join(stage, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
      await writeFile(stageAuth, bytes, { mode: 0o600 });
      client = openLogin(cli, stage);
      await client.request('initialize', { clientInfo: { name: 'codex-glass-themes', version: '1.0' } });
      client.initialized();
      const result = await client.request('account/rateLimits/read');
      if (!result.accountId || result.accountId === selected.workspace) quota = quotaSnapshot(result);
    } catch {
      // Keep any rotated credentials from the isolated profile even if the usage read fails.
    } finally {
      try {
        await client?.close();
        const latest = await read(stageAuth);
        if (sameAccount(identity(latest), selected) && !sameAccount(identity(await read(liveAuth)), selected)
            && (quota || !latest.equals(bytes))) {
          await save(latest, selected, quota);
        }
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
    if (!quota) throw new AccountError('這個帳號的額度暫時讀不到，已保留上次數字。');
  }

  async function signIn() {
    const operation = login;
    let stage, client, timeout;
    try {
      const { cli } = await inspect();
      if (operation.canceled) return;
      if (!cli) throw new AccountError('找不到 Codex 官方登入程式。');
      stage = await mkdtemp(join(root, 'login-'));
      await writeFile(join(stage, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
      if (operation.canceled) return;
      client = openLogin(cli, stage);
      operation.client = client;
      await client.request('initialize', { clientInfo: { name: 'codex-glass-themes', version: '1.0' } });
      if (operation.canceled) return;
      client.initialized();
      const result = await client.request('account/login/start', { type: 'chatgpt' });
      operation.id = result.loginId;
      const url = new URL(result.authUrl);
      if (result.type !== 'chatgpt' || !operation.id || url.origin !== 'https://auth.openai.com') {
        throw new AccountError('Codex 沒有提供預期的官方登入頁。');
      }
      if (operation.canceled) return;
      await run('browser', url.href);
      const completed = await Promise.race([
        client.completed,
        new Promise(resolve => { timeout = setTimeout(() => resolve(null), 180000); })
      ]);
      if (operation.canceled) return;
      if (completed?.loginId !== operation.id || completed?.success !== true) {
        throw new AccountError('登入沒有完成，請再試一次。');
      }
      const bytes = await read(join(stage, 'auth.json'));
      const account = identity(bytes);
      if (!account) throw new AccountError('登入已完成，但沒有找到可儲存的 ChatGPT 帳號。');
      await save(bytes, account);
    } catch (error) {
      if (!operation.canceled) throw error;
    } finally {
      clearTimeout(timeout);
      await client?.close();
      if (stage) await rm(stage, { recursive: true, force: true });
    }
  }

  async function waitFor(check, duration) {
    const deadline = Date.now() + duration;
    do {
      if (await check()) return true;
      if (Date.now() >= deadline) break;
      await pause(650);
    } while (true);
    return false;
  }

  async function desktopStopped() {
    const { mains, desktopServers } = await inspect();
    return mains.length === 0 && desktopServers.length === 0;
  }

  async function commitAuth(expected, next) {
    const result = await run('commit', JSON.stringify({
      home, expected: expected.toString('base64'), next: next.toString('base64')
    }));
    if (result === 'committed') return true;
    if (result === 'conflict' || result === 'busy') return false;
    throw new Error('Unexpected authentication commit result');
  }

  async function switchTo(id) {
    const account = (await getAccounts()).find(value => value.id === id);
    if (!account) throw new AccountError('找不到這個已儲存的帳號。');
    const target = await getTarget();
    const { mains } = await inspect();
    if (!target || mains.length !== 1 || mains[0] !== target) {
      throw new AccountError('請在預設的 Codex 視窗切換帳號。');
    }
    let original = await read(liveAuth);
    const current = identity(original);
    if (!current) throw new AccountError('請先登入目前的 Codex 帳號。');
    if (sameAccount(current, account)) return;
    const incoming = Buffer.from(await run('unprotect', account.encrypted), 'base64');
    if (!sameAccount(identity(incoming), account)) throw new AccountError('登入資料無法使用，請重新加入這個帳號。');

    await save(original, current, await readCurrentQuota(current));
    await replace(status, JSON.stringify('等待 Codex 結束後切換帳號。'));
    let changed = false;
    try {
      await quit();
      if (!await waitFor(desktopStopped, 30000)) {
        throw new AccountError('Codex 桌面版還沒退出，登入維持原帳號。');
      }
      await checkStorage();
      for (let attempt = 0; attempt < 3; attempt++) {
        original = await read(liveAuth);
        if (!sameAccount(identity(original), current)) {
          throw new AccountError('登入狀態已由其他程式更新，這次保留目前的帳號。');
        }
        await save(original, current);
        if (!await desktopStopped()) throw new AccountError('Codex 桌面版已經重開，這次保留目前的帳號。');
        changed = await commitAuth(original, incoming);
        if (changed) break;
      }
      if (!changed) throw new AccountError('登入資料仍在更新，已保留目前的帳號。請再切換一次。');
      await run('activate');
    } catch (error) {
      const idle = await desktopStopped().catch(() => false);
      const restored = changed && idle && await commitAuth(incoming, original).catch(() => false);
      await replace(status, JSON.stringify(restored ? 'Codex 重開失敗，已還原原本的帳號。'
        : error instanceof AccountError ? error.message : '切換中斷，請確認目前的登入帳號。'));
      if (idle) await run('activate').catch(() => {});
      throw error;
    }

    const opened = await waitFor(async () => {
      const next = await getTarget();
      return Boolean(next && next !== target);
    }, 40000);
    const activeAuth = await read(liveAuth);
    const matches = sameAccount(identity(activeAuth), account);
    if (!opened && matches && await desktopStopped().catch(() => false)) {
      const restored = await commitAuth(activeAuth, original).catch(() => false);
      const message = restored ? 'Codex 沒有重新開啟，已還原原本的帳號。'
        : 'Codex 沒有重新開啟，請從原本的入口開啟並確認帳號。';
      await replace(status, JSON.stringify(message));
      await run('activate').catch(() => {});
      throw new AccountError(message);
    }
    await replace(status, JSON.stringify(opened && matches
      ? '已切換登入資料，Codex 已重新開啟。'
      : '登入資料已更新，請確認 Codex 的登入狀態。'));
  }

  async function handle(action, id) {
    if (action === 'list') return model();
    if (action === 'cancel') {
      const pending = login;
      if (pending) {
        pending.canceled = true;
        if (pending.id && pending.client) await pending.client.request('account/login/cancel', { loginId: pending.id }).catch(() => {});
        await pending.client?.close();
      }
      return model();
    }
    if (phase) throw new AccountError('已有帳號操作正在進行。');
    if (!['save', 'add', 'switch', 'quota'].includes(action)) throw new AccountError('無法辨識這項帳號操作。');
    phase = action;
    if (action === 'add') login = { client: null, id: null, canceled: false };
    try {
      await mkdir(root, { recursive: true });
      await checkStorage();
      if (action === 'save') {
        const bytes = await read(liveAuth);
        const active = identity(bytes);
        if (!active) throw new AccountError('目前沒有可儲存的 ChatGPT 帳號。');
        await save(bytes, active, await readCurrentQuota(active));
      } else if (action === 'quota') {
        await refreshQuota(id);
      } else if (action === 'add') {
        await signIn();
      } else {
        await switchTo(id);
      }
    } finally {
      login = null;
      phase = '';
    }
    return model();
  }

  return {
    async request(action, id) {
      try { return await handle(action, id); }
      catch (error) { return { error: error instanceof AccountError ? error.message : '帳號操作未完成，請稍後再試。' }; }
    }
  };
}
