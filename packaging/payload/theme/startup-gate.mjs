// Small renderer probe: never ship/parse the image payload during app startup.
export function probeThemeStartup() {
  if (window.__kenGlassPanel) return 'mounted';
  const now = performance.now();
  const state = window.__kenGlassStartup ||= {since: null, first: now};
  if (document.readyState === 'loading' || !document.body) return 'waiting';
  const shell = [...document.querySelectorAll('[aria-label="Open profile menu"],[aria-label="開啟個人檔案選單"],main [contenteditable="true"],main textarea')].some(node => node.getClientRects().length);
  // Conversation activity is not app startup. Hidden template editors must not
  // hide a later visible match, and a changed label gets a bounded fallback.
  const fallback = now - state.first >= 4000 && document.readyState === 'complete' && !!document.body.querySelector('button');
  const ready = shell || fallback;
  if (!ready) { state.since = null; return 'waiting'; }
  state.since ??= now;
  return now - state.since >= 350 ? 'ready' : 'waiting';
}

export function showThemeLoading() {
  document.getElementById('ken-theme-loading')?.remove();
  const veil = document.createElement('div');
  veil.id = 'ken-theme-loading';
  veil.textContent = '正在套用布景…';
  veil.setAttribute('role', 'status');
  // No blur, animation, or input interception while the renderer is busy.
  veil.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:#16191c35;display:grid;place-items:center;color:#fff;font:14px "Segoe UI",sans-serif;text-shadow:0 1px 4px #000';
  document.body.append(veil);
  setTimeout(() => veil.remove(), 5000);
}
