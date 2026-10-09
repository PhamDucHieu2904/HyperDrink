/* eslint-disable @typescript-eslint/no-require-imports -- Test manual preference with blocked storage and actual shaders. */
require('../register-admin-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const path = require.resolve('../../lib/viewer/graphics-mode.ts');
const fresh = () => { delete require.cache[path]; return require(path); };

test('default is lightweight, remembered choice survives reload, and cross-tab changes notify subscribers', context => {
  const data = new Map(), events = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  context.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window; });
  delete globalThis.window;
  let mode = fresh(); assert.equal(mode.graphicsModeServerSnapshot(), 'standard'); assert.equal(mode.graphicsModeSnapshot(), 'standard');
  globalThis.window = { localStorage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) },
    addEventListener: (key, handler) => events.set(key, handler), removeEventListener: key => events.delete(key) };
  assert.equal(mode.graphicsModeSnapshot(), 'standard');
  let notifications = 0; const unsubscribe = mode.subscribeGraphicsMode(() => notifications++);
  mode.setGraphicsMode('enhanced'); assert.equal(notifications, 1);
  assert.equal(data.get(mode.GRAPHICS_STORAGE_KEY), 'enhanced'); assert.equal(mode.graphicsModeSnapshot(), 'enhanced');
  assert.equal(mode.graphicsModeServerSnapshot(), 'standard', 'SSR stays stable even when client has a saved preference');
  data.set(mode.GRAPHICS_STORAGE_KEY, 'standard'); events.get('storage')({ key: mode.GRAPHICS_STORAGE_KEY });
  assert.equal(notifications, 2); assert.equal(mode.graphicsModeSnapshot(), 'standard');
  events.get('storage')({ key: 'unrelated' }); assert.equal(notifications, 2);
  unsubscribe(); assert.equal(events.size, 0);
  data.set(mode.GRAPHICS_STORAGE_KEY, 'enhanced'); mode = fresh(); assert.equal(mode.graphicsModeSnapshot(), 'enhanced');
});

test('blocked local storage still permits manual session switching and corrupt values fall back to lightweight', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  context.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window; });
  globalThis.window = { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } };
  let mode = fresh(); assert.equal(mode.graphicsModeSnapshot(), 'standard');
  assert.doesNotThrow(() => mode.setGraphicsMode('enhanced')); assert.equal(mode.graphicsModeSnapshot(), 'enhanced');
  mode.setGraphicsMode('standard'); assert.equal(mode.graphicsModeSnapshot(), 'standard');
  globalThis.window.localStorage.getItem = () => 'automatic-ultra'; mode = fresh(); assert.equal(mode.graphicsModeSnapshot(), 'standard');
});

test('scene-owned rear sampler changes without altering uniforms, and released targets cannot reach pooled draws', () => {
  const optics = require('../../lib/viewer/bottle-backdrop.ts');
  const scene = new THREE.Scene(), other = new THREE.Scene(), texture = new THREE.Texture();
  const uniforms = optics.createBottleBackdropUniforms(), identity = uniforms.bottleBackdrop;
  optics.setBottleBackdrop(scene, texture); optics.updateBottleBackdropUniforms(uniforms, scene);
  assert.equal(uniforms.bottleBackdrop.value, texture); assert.equal(uniforms.bottleBackdrop, identity);
  optics.updateBottleBackdropUniforms(uniforms, other); assert.equal(uniforms.bottleBackdropEnabled.value, 0);
  optics.setBottleBackdrop(scene, null); optics.updateBottleBackdropUniforms(uniforms, scene);
  assert.equal(uniforms.bottleBackdrop.value, null); assert.equal(uniforms.bottleBackdropEnabled.value, 0); texture.dispose();
  const chunk = optics.trackBottleRefraction(THREE.ShaderChunk.transmission_pars_fragment);
  assert.equal((chunk.match(/bottleRefractionUv = refractionCoords/g) ?? []).length, 2, 'Both normal and dispersion projections keep their actual refracted exit UV');
  assert.match(chunk, /getTransmissionSample\( refractionCoords, roughness, ior \)/, 'Internal native capture remains intact');
});
