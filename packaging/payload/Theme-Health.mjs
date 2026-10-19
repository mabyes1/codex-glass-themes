// Self-contained so the probe can execute this in the selected renderer.
export function inspectThemeHealth() {
  const panel=window.__kenGlassPanel;
  const diagnostics=panel?.getDiagnostics();
  return {
    mounted:!!panel&&!!document.getElementById('ken-glass-switcher')?.shadowRoot?.getElementById('toggle'),
    styleLength:document.getElementById('ken-codex-glass')?.textContent.length||0,
    mode:panel?.getState().mode,
    nativeReady:diagnostics?.nativeFailed===false&&diagnostics?.nativePending===false,
    nativeFailed:diagnostics?.nativeFailed??null,
    nativePending:diagnostics?.nativePending??null
  };
}
