// Use native backdrops only where the Windows API is supported.
export function getWindowsAppearancePolicy(version) {
  const match = /^10\.0\.(\d+)(?:\.|$)/.exec(version);
  if (!match || Number(match[1]) < 19045) throw new Error('Windows 10 build 19045 or newer is required');
  return {compatibility:Number(match[1]) < 22621};
}
