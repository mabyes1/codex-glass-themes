// Pure palette calculation. The same function runs in Node checks and in the renderer.
export function createGlassAppearance(prefs, imageURL = '') {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, amount) => a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount));
  const solid = value => `rgb(${value.join(',')})`;
  const alpha = (value, opacity) => `rgba(${value.join(',')},${opacity})`;
  const luminance = value => value.map(v => {
    v /= 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const color = prefs.mode === 'color';
  const image = prefs.mode === 'image';
  const clear = prefs.mode === 'clear';
  const base = color ? rgb(prefs.colors.base) : image ? [19, 21, 24] : [0, 0, 0];
  const left = color ? rgb(prefs.colors.left) : base;
  const right = color ? rgb(prefs.colors.right) : base;
  const light = color && luminance(base) > .28;
  // Every surface comes from one shared tint. Accent colors belong to the light
  // behind the glass, not to unrelated red/blue panels on opposite sides.
  const tint = color ? mix(base, mix(left, right, .5), .09) : base;
  let glass = light ? mix(tint, [255, 255, 255], .66) : mix(tint, [24, 25, 28], .30);
  // Medium/saturated dark palettes still need a dark enough reading surface.
  if (!light) while (luminance(glass) > .12) glass = mix(glass, [18, 21, 25], .14);
  const primary = light ? '#182029' : '#f7f8fa';
  const secondary = light ? '#424953' : '#e1e4e9';
  const muted = light ? '#525b66' : '#bcc2cc';
  const accent = color ? mix(left, right, .42) : [191, 205, 221];
  const link = light ? '#225fa9' : '#9ecbff';
  const stroke = light ? 'rgba(28,35,44,.13)' : 'rgba(255,255,255,.12)';
  const gleam = light ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.18)';
  const background = color
    ? `radial-gradient(ellipse at 0% 10%,${alpha(left, .38)},transparent 58%),radial-gradient(ellipse at 95% 90%,${alpha(right, .34)},transparent 58%),${solid(base)}`
    : image && imageURL
      ? `linear-gradient(rgba(0,0,0,${prefs.imageShade / 100}),rgba(0,0,0,${prefs.imageShade / 100})),url(${JSON.stringify(imageURL)}) center/cover no-repeat`
      : solid(base);
  return {
    theme: light ? 'light' : 'dark',
    background,
    variables: {
      '--kg-primary': primary,
      '--kg-secondary': secondary,
      '--kg-muted': muted,
      '--kg-inverse': light ? '#fff' : '#182029',
      '--kg-solid': light ? '#182029' : '#f7f8fa',
      '--kg-main': alpha(glass, light ? .72 : clear ? .20 : .26),
      '--kg-sidebar': alpha(glass, light ? .76 : clear ? .24 : .32),
      '--kg-sidebar-overlay': alpha(glass, light ? .14 : clear ? .05 : .08),
      '--kg-soft': clear ? 'rgba(255,255,255,.045)' : alpha(glass, light ? .30 : .22),
      '--kg-card': clear ? 'rgba(255,255,255,.065)' : alpha(glass, light ? .66 : image ? .42 : .34),
      '--kg-menu': solid(light ? mix(glass, [255, 255, 255], .35) : mix(glass, [24, 25, 28], .55)),
      '--kg-composer': clear ? 'rgba(255,255,255,.08)' : alpha(glass, light ? .72 : image ? .50 : .46),
      '--kg-bubble': clear ? 'rgba(255,255,255,.075)' : alpha(light ? mix(glass, accent, .12) : mix(glass, accent, color ? .12 : .035), light ? .62 : .42),
      '--kg-hover': light ? 'rgba(24,32,41,.07)' : 'rgba(255,255,255,.09)',
      '--kg-selected': light ? 'rgba(24,32,41,.12)' : 'rgba(255,255,255,.15)',
      '--kg-stroke': stroke,
      '--kg-gleam': gleam,
      '--kg-shadow': light ? 'rgba(25,30,40,.08)' : 'rgba(0,0,0,.10)',
      '--kg-text-shadow': light ? 'none' : '0 1px 2px rgba(0,0,0,.7)',
      '--kg-link': link,
      '--kg-success': light ? '#197143' : '#80e3a9',
      '--kg-danger': light ? '#b12c3b' : '#ff9da5',
      '--kg-warning': light ? '#95501c' : '#ffbd87',
      '--kg-focus': light ? '#346da8' : '#abd1fc',
      '--kg-scheme': light ? 'light' : 'dark'
    }
  };
}
