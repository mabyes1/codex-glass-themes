import test from 'node:test';
import assert from 'node:assert/strict';
import {createGlassAppearance} from '../packaging/payload/theme/glass-design.mjs';
import {glassPresets} from '../packaging/payload/theme/glass-presets.mjs';

const defaults = {mode:'color',imageShade:28,colors:{base:'#111d30',left:'#3b91b3',right:'#7e55a7'}};
const rgb = value => value.startsWith('#') ? [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)) : value.match(/[\d.]+/g).map(Number).slice(0,3);
const luminance = value => rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => {const [low,high]=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (high+.05)/(low+.05);};

test('primary and secondary text stay readable on menus across bright, dark and saturated palettes',()=>{
  for(const base of ['#111d30','#c3cad5','#db95cb','#ffffff','#000000','#808080','#999999','#ff0000','#00ff00','#0000ff','#ffff00']){
    const {variables:v}=createGlassAppearance({...defaults,colors:{...defaults.colors,base}});
    for(const name of ['--kg-primary','--kg-secondary','--kg-muted']) assert.ok(contrast(v[name],v['--kg-menu'])>=4.5,`${base} ${name}`);
  }
});
test('neutral themes keep a white foreground and no palette color leaks',()=>{
  for(const mode of ['clear','image']){
    const a=createGlassAppearance({...defaults,mode});
    const b=createGlassAppearance({...defaults,mode,colors:{base:'#ff0000',left:'#00ff00',right:'#0000ff'}});
    assert.deepEqual(a,b);
    assert.equal(a.theme,'dark');assert.equal(a.variables['--kg-primary'],'#f7f8fa');
    if(mode==='clear')assert.ok(!a.background.includes('gradient'));
  }
});
test('image shading accepts zero and returning to a theme has no inherited palette state',()=>{
  const a=createGlassAppearance(defaults);
  const image=createGlassAppearance({...defaults,mode:'image',imageShade:0},'data:image/png;base64,AAAA');
  assert.ok(image.background.includes('rgba(0,0,0,0)'));
  assert.ok(image.background.includes('data:image/png;base64,AAAA'));
  createGlassAppearance({...defaults,mode:'clear'});
  assert.deepEqual(createGlassAppearance(defaults),a);
});
test('curated palettes have legible menu text and distinct light and dark variants',()=>{
  assert.equal(new Set(glassPresets.map(p=>p.id)).size,6);
  for(const preset of glassPresets){
    const {theme,variables:v}=createGlassAppearance({...defaults,colors:preset.colors});
    assert.equal(theme,['cream','matcha','sakura'].includes(preset.id)?'light':'dark');
    for(const name of ['--kg-primary','--kg-secondary','--kg-muted']) assert.ok(contrast(v[name],v['--kg-menu'])>=4.5,`${preset.id} ${name}`);
    assert.ok(contrast(v['--kg-focus'],v['--kg-menu'])>=3,`${preset.id} focus indicator`);
  }
});
test('reading strength increases surface coverage while preserving the palette and background',()=>{
  const alpha=value=>Number(value.match(/[\d.]+/g).at(-1));
  for(const mode of ['clear','color','image','aquarium']){
    const light=createGlassAppearance({...defaults,mode,surfaceStrength:30});
    const balanced=createGlassAppearance({...defaults,mode,surfaceStrength:50});
    const focus=createGlassAppearance({...defaults,mode,surfaceStrength:85});
    assert.equal(light.background,focus.background);
    assert.equal(light.variables['--kg-primary'],focus.variables['--kg-primary']);
    for(const name of ['--kg-main','--kg-card','--kg-composer']){
      assert.ok(alpha(light.variables[name])<alpha(balanced.variables[name]),`${mode} ${name} light`);
      assert.ok(alpha(balanced.variables[name])<alpha(focus.variables[name]),`${mode} ${name} focus`);
    }
  }
});

test('aquarium stays readable and independent of saved colors or wallpaper',()=>{
  const a=createGlassAppearance({...defaults,mode:'aquarium'});
  const b=createGlassAppearance({...defaults,mode:'aquarium',colors:{base:'#ffffff',left:'#ff0000',right:'#00ff00'}},'private-image');
  assert.deepEqual(a,b);assert.equal(a.theme,'dark');
  for(const name of ['--kg-primary','--kg-secondary','--kg-muted'])assert.ok(contrast(a.variables[name],a.variables['--kg-menu'])>=4.5);
  assert.ok(a.background.includes('#020813'));assert.ok(!a.background.includes('private-image'));
});
