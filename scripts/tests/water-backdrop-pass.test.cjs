/* eslint-disable @typescript-eslint/no-require-imports -- Stub GPU boundaries while executing the production pass. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');

function fixture(floatSupported = true) {
  const targets = [];
  class RenderTarget {
    constructor(width, height, options) {
      this.width = width; this.height = height; this.options = options;
      this.texture = new THREE.Texture();
      this.texture.colorSpace = options.colorSpace;
      this.resizes = []; this.disposals = 0; targets.push(this);
    }
    setSize(width, height) { this.width = width; this.height = height; this.resizes.push([width, height]); }
    dispose() { this.disposals += 1; }
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../../lib/viewer/water-backdrop-pass.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name === 'three'
    ? { ...THREE, WebGLRenderTarget: RenderTarget } : require(name), loaded, loaded.exports);
  const previousTarget = { name: 'caller-target' };
  let activeTarget = previousTarget, cubeFace = 3, mipmapLevel = 2;
  const renderer = {
    extensions: { has(name) { assert.equal(name, 'EXT_color_buffer_float'); return floatSupported; } },
    getRenderTarget() { return activeTarget; },
    getActiveCubeFace() { return cubeFace; },
    getActiveMipmapLevel() { return mipmapLevel; },
    setRenderTarget(target, face = 0, mip = 0) { activeTarget = target; cubeFace = face; mipmapLevel = mip; },
    render() {},
  };
  const scene = new THREE.Scene();
  const originalBackground = new THREE.Color('#4d284f');
  scene.background = originalBackground;
  const product = new THREE.Group(); scene.add(product);
  const fruit = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  scene.add(fruit);
  const waterMaterial = new THREE.ShaderMaterial({ name: 'colorless-water-droplet' });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(), [new THREE.MeshBasicMaterial(), waterMaterial]);
  const hiddenWater = new THREE.Mesh(new THREE.PlaneGeometry(), waterMaterial);
  hiddenWater.visible = false;
  // A similarly named ordinary material is not a water sampler and must remain visible.
  const ordinary = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ name: 'colorless-water-droplet' }));
  scene.add(water, hiddenWater, ordinary);
  const camera = new THREE.PerspectiveCamera();
  const background = new THREE.Texture({ width: 512, height: 768 });
  const pass = loaded.exports.createWaterBackdropPass(renderer, scene, product);
  return { pass, targets, renderer, scene, product, fruit, water, hiddenWater, ordinary, camera,
    background, originalBackground, previousTarget };
}

test('capture includes actual accents, excludes product/water feedback and restores caller state on success or render failure', () => {
  const f = fixture();
  const target = f.targets[0];
  for (const shouldThrow of [false, true]) {
    const oldProductVisibility = !shouldThrow;
    f.product.visible = oldProductVisibility;
    f.renderer.render = (scene, camera) => {
      assert.equal(scene, f.scene); assert.equal(camera, f.camera);
      assert.equal(scene.background, f.background);
      assert.equal(f.product.visible, false);
      assert.equal(f.water.visible, false);
      assert.equal(f.hiddenWater.visible, false);
      assert.equal(f.fruit.visible, true, 'Fruit remains in the water sampler instead of being replaced by CSS color');
      assert.equal(f.ordinary.visible, true);
      assert.equal(f.renderer.getRenderTarget(), target);
      if (shouldThrow) throw new Error('test render failure');
    };
    if (shouldThrow) assert.throws(() => f.pass.render(f.background, f.camera), /test render failure/);
    else f.pass.render(f.background, f.camera);
    assert.equal(f.scene.background, f.originalBackground);
    assert.equal(f.product.visible, oldProductVisibility);
    assert.equal(f.water.visible, true);
    assert.equal(f.hiddenWater.visible, false);
    assert.equal(f.renderer.getRenderTarget(), f.previousTarget);
    assert.equal(f.renderer.getActiveCubeFace(), 3);
    assert.equal(f.renderer.getActiveMipmapLevel(), 2);
  }
  f.pass.dispose();
});

test('capture resolution follows the small backing canvas and keeps a stable linear sampler across resizes', () => {
  const f = fixture();
  const target = f.targets[0];
  const sampler = f.pass.texture;
  assert.equal(target.options.type, THREE.HalfFloatType);
  assert.equal(sampler.colorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(target.options.depthBuffer, true);
  assert.equal(target.options.generateMipmaps, false);
  f.pass.render(f.background, f.camera);
  f.pass.render(f.background, f.camera);
  assert.deepEqual(target.resizes, [[512, 768]], 'Unchanged canvases do not reallocate every frame');
  f.background.image = { width: 768, height: 512 };
  f.pass.render(f.background, f.camera);
  assert.deepEqual(target.resizes, [[512, 768], [768, 512]]);
  assert.equal(f.pass.texture, sampler);
  f.background.image = { width: NaN, height: 0 };
  f.pass.render(f.background, f.camera);
  assert.equal(target.width, 1); assert.equal(target.height, 1);
  f.pass.dispose();
});

test('phones without float color buffers use a safe byte target and disposal never owns the background', () => {
  const f = fixture(false);
  const target = f.targets[0];
  assert.equal(target.options.type, THREE.UnsignedByteType);
  let backgroundDisposals = 0;
  f.background.addEventListener('dispose', () => { backgroundDisposals += 1; });
  f.pass.dispose(); f.pass.dispose();
  assert.equal(target.disposals, 1);
  assert.equal(backgroundDisposals, 0);
  f.renderer.render = () => { throw new Error('disposed pass rendered'); };
  assert.doesNotThrow(() => f.pass.render(f.background, f.camera));
});
