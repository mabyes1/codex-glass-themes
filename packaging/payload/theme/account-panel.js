(() => {
  window.__kenAccountPanel?.dispose();
  const theme = document.getElementById('ken-glass-switcher');
  if (!theme?.shadowRoot || typeof window.__kenAccountsRequest !== 'function') return false;

  const mount = document.createElement('span');
  const shadow = mount.attachShadow({ mode: 'closed' });
  shadow.innerHTML = "<style>\n  :host{font:13px/1.55 \"Segoe UI\",\"Microsoft JhengHei\",sans-serif;color:var(--kg-primary,#f7f8fa);-webkit-app-region:no-drag}\n  *{box-sizing:border-box}[hidden]{display:none!important}\n  button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--kg-stroke,#ffffff25);background:var(--kg-hover,#8882);border-radius:9px;padding:5px 10px;min-height:30px}\n  button:hover{background:var(--kg-selected,#8884)}button:disabled{opacity:.55;cursor:default}\n  button:focus-visible{outline:2px solid var(--kg-focus,#79cfe1);outline-offset:2px}\n  #toggle{position:absolute;right:calc(100% + 6px);top:0;white-space:nowrap;height:28px;min-height:28px;font-size:12px;background:var(--kg-menu,#242629)}\n  dialog{width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 30px);padding:0;border-radius:17px;border:1px solid var(--kg-stroke,#ffffff25);\n    color:inherit;background:var(--kg-menu,#242629);box-shadow:0 22px 70px #0007;overflow:auto}\n  dialog::backdrop{background:#0006}\n  header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:17px 18px 13px;border-bottom:1px solid var(--kg-stroke,#ffffff25)}\n  h2,p{margin:0}h2{font-size:17px}#close{width:30px;padding:0;font-size:17px}\n  .body{padding:14px 18px 16px}.muted,#status{color:var(--kg-muted,#bec8d2)}#active,.email{overflow-wrap:anywhere}\n  #active-card,.list{display:grid;gap:8px}.list{margin:8px 0 12px}\n  .row{padding:9px 10px;border:1px solid var(--kg-stroke,#ffffff25);border-radius:11px;background:var(--kg-hover,#8881)}\n  .card-top,.card-bottom{display:flex;justify-content:space-between;align-items:center;gap:8px}\n  .card-bottom{margin-top:7px;flex-wrap:wrap}.card-top .email{flex:1;min-width:0}\n  .row button,.current{flex:none}.row button{font-size:12px;padding:3px 7px;min-height:26px}\n  .current{color:var(--kg-link,#9ddbe6);font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:7px}\n  .metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:8px 0 0;border-top:1px solid var(--kg-stroke,#ffffff25);padding-top:6px}\n  .metric{padding:0 6px;border-inline-start:1px solid var(--kg-stroke,#ffffff25)}\n  .metric:first-child{padding-inline-start:0;border:0}.metric dt,.stamp{color:var(--kg-muted,#bec8d2);font-size:11px}\n  .metric dd{margin:0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}\n  .empty{padding:9px 0}#status{margin:11px 0 0;min-height:1.5em}#status:empty{margin:0;min-height:0}\n  #confirmation{margin:10px 0;padding:10px;background:var(--kg-hover,#8882);border:1px solid var(--kg-stroke,#ffffff25);border-radius:10px}\n  #confirm:not(:disabled){background:#136184;color:#fff;border-color:transparent}#confirm:not(:disabled):hover{background:#084b6c}\n  #confirmation p{margin:3px 0 8px}#target{overflow-wrap:anywhere}\n  @media(max-width:400px){.body,header{padding-left:13px;padding-right:13px}}\n</style>\n<button id=\"toggle\" aria-haspopup=\"dialog\">帳號</button>\n<dialog id=\"accounts\" aria-labelledby=\"heading\">\n  <header><h2 id=\"heading\">Codex 帳號</h2><button id=\"close\" aria-label=\"關閉帳號面板\" autofocus>×</button></header>\n  <div class=\"body\">\n    <div id=\"active-card\" aria-label=\"目前登入\"></div>\n    <div id=\"rows\" class=\"list\" aria-label=\"已儲存的帳號\"></div>\n    <div id=\"confirmation\" hidden>\n      <strong id=\"target\"></strong>\n      <p>Codex 會關閉再開啟。請先等執行中的工作完成。</p>\n      <div class=\"actions\"><button id=\"back\">返回</button><button id=\"confirm\">切換並重開</button></div>\n    </div>\n    <div class=\"actions\"><button id=\"save\">儲存目前帳號</button><button id=\"add\">登入其他帳號</button><button id=\"cancel\" hidden>取消登入</button></div>\n    <p id=\"status\" role=\"status\" aria-live=\"polite\"></p>\n  </div>\n</dialog>";
  theme.shadowRoot.append(mount);
  const byId = id => shadow.getElementById(id);
  const dialog = byId('accounts');
  const rows = byId('rows');
  let requestSequence = 0;
  let busy = '';
  let model = null;
  let selection = null;

  function request(action, id) {
    window.__kenAccountsRequest(JSON.stringify({ request: ++requestSequence, action, id }));
  }

  function accountCard(account) {
    const card = document.createElement('div');
    card.className = 'row';
    const top = document.createElement('div');
    top.className = 'card-top';
    const label = document.createElement('strong');
    label.className = 'email';
    label.textContent = account.email;
    top.append(label);
    if (account.active) {
      label.id = 'active';
      const active = document.createElement('span');
      active.className = 'current';
      active.textContent = '使用中';
      top.append(active);
    } else {
      const button = document.createElement('button');
      button.textContent = '切換';
      button.dataset.accountSwitch = '';
      button.setAttribute('aria-label', '切換至 ' + account.email);
      button.disabled = Boolean(busy || selection) || !model.supported || !model.current;
      button.onclick = event => {
        if (!event.isTrusted || busy) return;
        selection = account;
        update();
        byId('confirm').focus();
      };
      top.append(button);
    }
    const metrics = document.createElement('dl');
    metrics.className = 'metrics';
    for (const [name, value, unit] of [
      ['5 小時剩餘', account.quota?.fiveHour, '%'],
      ['每週剩餘', account.quota?.weekly, '%'],
      ['重置券', account.quota?.resetCredits, ' 張']
    ]) {
      const metric = document.createElement('div');
      metric.className = 'metric';
      const term = document.createElement('dt');
      term.textContent = name;
      const number = document.createElement('dd');
      number.textContent = Number.isFinite(value) ? value + unit : '—';
      metric.append(term, number);
      metrics.append(metric);
    }
    const footer = document.createElement('div');
    footer.className = 'card-bottom';
    const time = document.createElement('span');
    time.className = 'stamp';
    const date = account.quota?.updatedAt;
    time.textContent = Number.isFinite(date) && date > 0
      ? '更新 ' + new Intl.DateTimeFormat('zh-TW', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(date)
      : '尚未讀取額度';
    const updateButton = document.createElement('button');
    updateButton.textContent = '更新額度';
    updateButton.setAttribute('aria-label', '更新 ' + account.email + ' 的額度');
    updateButton.disabled = Boolean(busy || selection) || !model.supported;
    updateButton.onclick = event => start('quota', event, account.id);
    footer.append(time, updateButton);
    card.append(top, metrics, footer);
    return card;
  }

  function update() {
    byId('save').disabled = Boolean(busy || selection) || !model?.current || !model?.supported;
    byId('add').disabled = Boolean(busy || selection) || !model?.supported;
    byId('cancel').hidden = busy !== 'add' && model?.phase !== 'add';
    byId('confirm').disabled = Boolean(busy);
    byId('confirmation').hidden = !selection;
    byId('target').textContent = selection ? '切換至 ' + selection.email + '？' : '';
    const active = byId('active-card');
    active.replaceChildren();
    rows.replaceChildren();
    if (!model) return;
    if (model.current) {
      active.append(accountCard({active: true, id: 'current', email: model.current, quota: model.currentQuota}));
    } else {
      const message = document.createElement('p');
      message.id = 'active';
      message.className = 'muted';
      message.textContent = '目前未讀到 ChatGPT 登入';
      active.append(message);
    }
    const saved = model.accounts.filter(account => !account.active);
    if (!saved.length) {
      const empty = document.createElement('p');
      empty.className = 'muted empty';
      empty.textContent = model.accounts.length ? '還沒有其他帳號。' : '還沒有已儲存的帳號。';
      rows.append(empty);
    }
    for (const account of saved) rows.append(accountCard(account));
  }

  function start(action, event, id) {
    if (!event.isTrusted || busy) return;
    busy = action;
    const messages = {
      add: '會開啟官方登入頁，請在瀏覽器完成登入。',
      save: '正在儲存目前登入。',
      switch: '正在準備切換並重新開啟 Codex。',
      quota: '正在讀取額度。'
    };
    byId('status').textContent = messages[action];
    update();
    request(action, id);
  }

  byId('toggle').onclick = event => {
    if (!event.isTrusted || dialog.open) return;
    selection = null;
    dialog.showModal();
    byId('status').textContent = busy ? byId('status').textContent : '讀取帳號中…';
    update();
    if (!busy) request('list');
  };
  byId('close').onclick = event => { if (event.isTrusted) dialog.close(); };
  byId('save').onclick = event => start('save', event);
  byId('add').onclick = event => start('add', event);
  byId('cancel').onclick = event => { if (event.isTrusted) request('cancel'); };
  byId('back').onclick = event => {
    if (!event.isTrusted) return;
    selection = null;
    update();
  };
  byId('confirm').onclick = event => {
    if (selection) start('switch', event, selection.id);
  };

  window.__kenAccountPanel = {
    receive(action, data) {
      if (action !== 'list' && action !== 'cancel') busy = '';
      if (data.error) {
        byId('status').textContent = data.error;
      } else {
        model = data;
        if (action === 'switch') selection = null;
        const messages = {
          save: '已儲存目前帳號。',
          add: '登入操作已結束。',
          cancel: '已要求取消登入。',
          quota: '已更新額度。'
        };
        byId('status').textContent = model.supported
          ? (messages[action] || model.status || '')
          : '目前只支援 Windows 上的檔案型 ChatGPT 登入。';
      }
      update();
    },
    attached: () => mount.isConnected,
    dispose() {
      if (dialog.open) dialog.close();
      mount.remove();
      delete window.__kenAccountPanel;
    }
  };
  return true;
})()
