/* Run with: node scripts/tests/aloe-bottle-materials.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- Runs the shipped Three materials without a browser/WebGL context. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const THREE = require('three');
require('../register-admin-typescript.cjs');
const materialAdjustments = require('../../lib/viewer/material-adjustments.ts');
const source = fs.readFileSync(path.resolve(__dirname, '../../lib/viewer/aloe-bottle-materials.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} }; new Function('require', 'module', 'exports', js)(name => name === './material-adjustments' ? materialAdjustments : require(name), loaded, loaded.exports);
const aloe = loaded.exports;
const asset = { id: 'aloe', name: 'Aloe', src: '/aloe.glb', packaging: 'pet', materialSlots: {
  body: ['Body Bottle - Rough_NormalMap', 'Body Bottle - z Glossy'], liquid: ['Aloe Vera Water'], inclusions: ['Aloe Pulp - Clear'],
} };
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, {}); return shader;
}
function fixture(context) {
  const root = new THREE.Group(), normalized = new THREE.Group(); normalized.scale.setScalar(0.1); root.add(normalized);
  const materials = {}, meshes = {};
  for (const [role, names] of Object.entries(asset.materialSlots)) {
    for (const name of names) {
      const material = new THREE.MeshPhysicalMaterial({ color: role === 'liquid' ? '#ef6828' : '#ffffff' });
      material.name = name; material.userData.bottleProfile = 'aloe-pet-v1';
      const geometry = role === 'liquid' ? new THREE.BoxGeometry(2, 2, 2) : new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
      if (role === 'liquid') mesh.scale.set(0.29, 1.05, 0.29);
      normalized.add(mesh); materials[name] = material; meshes[name] = mesh;
      context.after(() => { geometry.dispose(); material.dispose(); });
    }
  }
  return { root, normalized, materials, meshes, liquid: meshes['Aloe Vera Water'], pulp: meshes['Aloe Pulp - Clear'] };
}

test('assembled pulp shaders declare every optical uniform and helper before its first use', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.pulp.material, f.pulp, 'inclusions', '#e84a3c');
  const shader = compile(f.pulp.material);
  for (const stage of ['vertexShader', 'fragmentShader']) {
    const text = shader[stage].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const declarations = [...text.matchAll(/\b(?:uniform|varying|attribute)\s+\w+\s+((?:aloe|vAloe)\w+)/g),
      ...text.matchAll(/\b(?:float|bool|vec[234])\s+(aloe\w+)\s*\(/g)];
    assert.ok(declarations.length > 20, `${stage}: inspect the real assembled optical code`);
    for (const declaration of declarations) {
      const name = declaration[1], declaredAt = declaration.index + declaration[0].indexOf(name);
      const firstUse = new RegExp(`\\b${name}\\b`).exec(text).index;
      assert.equal(firstUse, declaredAt, `${stage}: ${name} must be declared before use`);
    }
  }
});

test('live water edits update existing Aloe volume/pulp uniforms without recoloring the neutral surface or recompiling optics', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  const back = f.liquid.material.clone(); context.after(() => back.dispose());
  for (const [material, mesh, role] of [[f.liquid.material, f.liquid, 'liquid'], [back, f.liquid, 'liquid-back'], [f.pulp.material, f.pulp, 'inclusions']]) {
    optical.configure(material, mesh, role, '#e84a3c');
    const shader = compile(material), version = material.version, key = material.customProgramCacheKey(), transmission = material.transmission;
    const update = materialAdjustments.liquidColorUpdates.get(material); assert.equal(typeof update, 'function');
    update('#148f43');
    assert.equal(shader.uniforms.aloeJuiceColor.value.getHexString(), '148f43');
    if (role === 'liquid') assert.equal(material.color.getHexString(), 'ffffff');
    else assert.deepEqual(material.color.toArray(), shader.uniforms.aloeScatteringColor.value.toArray());
    assert.equal(material.version, version); assert.equal(material.customProgramCacheKey(), key); assert.equal(material.transmission, transmission);
    update('#e84a3c'); assert.equal(shader.uniforms.aloeJuiceColor.value.getHexString(), 'e84a3c');
  }
});

test('square tapered contour uses real metres and its diagonal is longer than a cylindrical chord', context => {
  const geometry = new THREE.BoxGeometry(2, 2, 2), position = geometry.getAttribute('position');
  context.after(() => geometry.dispose());
  for (let i = 0; i < position.count; i++) if (position.getY(i) > 0) {
    position.setX(i, position.getX(i) * 0.4); position.setZ(i, position.getZ(i) * 0.4);
  }
  const matrix = new THREE.Matrix4().makeScale(0.03, 0.105, 0.03);
  const profile = aloe.fitAloeLiquidProfile(geometry, matrix);
  assert.ok(profile); assert.equal(profile.sections.length, 16);
  assert.ok(Math.abs(profile.minimumY + 0.105) < 1e-8); assert.ok(Math.abs(profile.maximumY - 0.105) < 1e-8);
  const center = new THREE.Vector3(0, -0.105, 0);
  const axial = aloe.aloeExitDistance(profile, center, new THREE.Vector3(0, 0, 1));
  const diagonal = aloe.aloeExitDistance(profile, center, new THREE.Vector3(1, 0, 1));
  const reverseDiagonal = aloe.aloeExitDistance(profile, center, new THREE.Vector3(1, 0, -1));
  assert.ok(Math.abs(axial - 0.03) < 0.00002);
  assert.ok(Math.abs(diagonal - 0.03 * Math.SQRT2) < 0.00003);
  assert.ok(Math.abs(reverseDiagonal - diagonal) < 1e-10, 'Both authored diagonal supports start at zero, including THREE.Vector4.w');
  assert.ok(profile.sections.every(section => section.w < 0.05));
  const shoulder = aloe.aloeExitDistance(profile, new THREE.Vector3(0, 0.084, 0), new THREE.Vector3(0, 0, 1));
  assert.ok(Math.abs(shoulder - 0.0138) < 0.00003, 'The shoulder is narrower than the lower bottle');
  assert.equal(aloe.aloeExitDistance(profile, new THREE.Vector3(0.1, 0, 0), new THREE.Vector3(0, 0, 1)), 0);
});

test('pulp fades by physical path length and deep silhouettes leave both color and depth capture', context => {
  const depths = [0, 0.005, 0.012, 0.02, 0.028, 0.036, 0.1];
  const visibility = depths.map(aloe.aloePulpReveal);
  assert.equal(visibility[0], aloe.ALOE_PET_OPTICS.pulpVisibility);
  for (let i = 1; i < visibility.length; i++) assert.ok(visibility[i] <= visibility[i - 1]);
  assert.ok(visibility[1] > 0.5 && visibility[1] < 0.54, 'Near-wall gel retains enough structure to remain recognizable through water');
  assert.ok(visibility[4] < 0.035); assert.equal(visibility[5], 0); assert.equal(aloe.aloePulpReveal(Infinity), 0);
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.pulp.material, f.pulp, 'inclusions', '#f35228');
  const shader = compile(f.pulp.material);
  assert.ok(shader.fragmentShader.includes('if (aloeDepth >= aloePulpFadeRange.y) discard;'));
  assert.ok(shader.fragmentShader.includes('float cloud = vAloeGelDetail.x;'));
  assert.ok(shader.fragmentShader.includes('float aloeDepth = max(vAloeDepth, 0.0);'));
  assert.ok(shader.vertexShader.includes('vAloeDepth = aloeGelDetail.z > 0.5 ? 0.0 : aloeExitDistance(vAloePosition, aloeTowardCamera);'));
  assert.ok(shader.fragmentShader.includes('if (vAloeGelDetail.z > 0.00001)'),
    'Exact per-pixel depth is reserved for the molded base and triangles crossing the fitted volume boundary');
  assert.ok(!shader.fragmentShader.includes('aloeNoise'), 'No procedural noise runs at every overlapping pulp pixel');
  assert.match(shader.fragmentShader, /float gelDensity = 65\.0+ \+ cloud \* 70\.0+/,
    'Interpolated optical constants retain explicit GLSL float literals');
  assert.ok(!shader.fragmentShader.includes('vec3 paleGel'), 'Aloe receives no ivory/coconut pigment');
  assert.ok(shader.fragmentShader.includes('float pieceTransmittance = exp(-piecePath * gelDensity);'),
    'Through-piece optical density is independent of front-water depth fade');
  assert.equal(f.pulp.material.transmission, 0, 'Gel contributes structure to one real liquid refraction, rather than refracting a second time');
  assert.deepEqual(shader.uniforms.aloeHeightRange.value.toArray().map(value => Math.round(value * 1000)), [-105, 105]);
  assert.ok(Math.abs(shader.uniforms.aloeHalfBounds.value.x - 0.029) < 1e-7, 'Blender water scale and export normalization are both retained');
});

test('gel detail is immutable authored-space density shared across pool clones and live flavour changes', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  const positions = Array.from(f.pulp.geometry.attributes.position.array);
  optical.configure(f.pulp.material, f.pulp, 'inclusions', '#e84a3c');
  const attribute = f.pulp.geometry.getAttribute('aloeGelDetail');
  assert.equal(attribute.count, f.pulp.geometry.attributes.position.count);
  assert.equal(attribute.itemSize, 3);
  assert.ok([...attribute.array].every(value => value >= 0 && value <= 1));
  const before = Array.from(attribute.array), version = attribute.version;
  const clone = f.pulp.clone(); clone.rotation.set(0.2, 0.4, 0.1);
  materialAdjustments.liquidColorUpdates.get(f.pulp.material)('#119d25');
  optical.configure(clone.material, f.pulp, 'inclusions', '#e84a3c');
  assert.equal(clone.geometry.getAttribute('aloeGelDetail'), attribute);
  assert.deepEqual(Array.from(attribute.array), before); assert.equal(attribute.version, version);
  assert.deepEqual(Array.from(f.pulp.geometry.attributes.position.array), positions,
    'Baked optical density adds an attribute without changing the authored pulp or bottle form');
  const point = new THREE.Vector3(0.017, 0.038, -0.012);
  assert.deepEqual(aloe.aloeGelDetailAt(point).toArray(), aloe.aloeGelDetailAt(point.clone()).toArray());
});

test('smooth reservoir capture and neutral gel extinction preserve flavor radiance, alpha and one real refraction', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  for (const color of ['#f35228', '#d5d598', '#efefef']) {
    const back = new THREE.MeshStandardMaterial(); context.after(() => back.dispose());
    optical.configure(back, f.liquid, 'liquid-back', color);
    optical.configure(f.pulp.material, f.pulp, 'inclusions', color);
    optical.configure(f.liquid.material, f.liquid, 'liquid', color);
    const a = compile(back).uniforms.aloeScatteringColor.value;
    const b = compile(f.pulp.material).uniforms.aloeScatteringColor.value;
    assert.deepEqual(a.toArray(), b.toArray(), 'Far gel cannot leave a darker diffuse silhouette');
    assert.equal(f.liquid.material.color.getHexString(), 'ffffff', 'Colour is applied once in the captured liquid, rather than twice through front tint');
    assert.equal(f.liquid.material.transmission, 1); assert.equal(f.liquid.material.ior, 1.335);
    assert.equal(f.liquid.material.transparent, false); assert.equal(f.liquid.material.depthWrite, true);
    assert.equal(f.liquid.material.premultipliedAlpha, true, 'Native PNG/canvas writes smooth transparent RGBA without a white fringe');
    assert.ok(f.liquid.material.thickness > 0.4 && f.liquid.material.thickness < 0.5,
      'Physical thickness divides out the retained .029 radial matrix scale');
    if (color === '#efefef') assert.ok(Math.abs(a.r - a.g) + Math.abs(a.g - a.b) < 1e-12);
    for (const material of [back, f.pulp.material, f.liquid.material]) {
      const shader = compile(material);
      assert.ok(shader.fragmentShader.includes('#include <tonemapping_fragment>'));
      assert.ok(shader.fragmentShader.includes('#include <colorspace_fragment>'));
    }
    const backShader = compile(back), gelShader = compile(f.pulp.material);
    assert.ok(backShader.fragmentShader.includes('gl_FragColor = vec4(aloeVolumeColor(path), coverage);'));
    assert.equal(back.blending, THREE.CustomBlending); assert.equal(back.blendSrc, THREE.SrcAlphaFactor);
    assert.equal(back.blendDst, THREE.OneMinusSrcAlphaFactor); assert.equal(back.depthWrite, false);
    assert.equal(back.transparent, false, 'Smooth reservoir stays in the single opaque capture');
    assert.ok(gelShader.fragmentShader.includes('gl_FragColor = vec4(vec3(2.0 * aloeClearRadiance * (1.0 - gelFilter)), gelFilter);'));
    assert.equal(f.pulp.material.blendSrc, THREE.OneMinusDstAlphaFactor); assert.equal(f.pulp.material.blendDst, THREE.SrcAlphaFactor);
    assert.equal(f.pulp.material.blendSrcAlpha, THREE.ZeroFactor); assert.equal(f.pulp.material.blendDstAlpha, THREE.OneFactor);
    assert.equal(f.pulp.material.depthWrite, false); assert.equal(f.pulp.material.toneMapped, false);
    assert.ok(!backShader.fragmentShader.includes('aloeCaptureThreshold') && !gelShader.fragmentShader.includes('aloeCaptureThreshold'),
      'No dither pattern may appear in the real capture or native PNG');
    const frontShader = compile(f.liquid.material);
    assert.ok(frontShader.fragmentShader.includes('material.transmissionAlpha'));
    assert.ok(frontShader.fragmentShader.includes('gl_FragColor = vec4(straightRadiance, finalOpacity);'));
  }
});

test('pooled geometry/camera transforms retain metric depth when the model rotates, moves and scales', context => {
  const f = fixture(context);
  // Scene placement at preparation must not contaminate the metric model profile.
  f.root.position.set(3, 1, -1); f.root.rotation.y = 0.4; f.root.scale.setScalar(2);
  const optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.pulp.material, f.pulp, 'inclusions', '#ef6828');
  const shader = compile(f.pulp.material), drawn = f.pulp.clone();
  const drawnRoot = new THREE.Group(); drawnRoot.position.set(-1, 2, 3); drawnRoot.rotation.set(0.2, 1.1, -0.1); drawnRoot.scale.setScalar(3);
  drawn.scale.setScalar(0.1); drawnRoot.add(drawn); drawnRoot.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(4, 3, 8); camera.lookAt(drawnRoot.position); camera.updateMatrixWorld(true);
  f.pulp.material.onBeforeRender({}, {}, camera, drawn.geometry, drawn, {});
  const expected = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(drawn.matrixWorld.clone().invert())
    .applyMatrix4(shader.uniforms.aloeLocalToMetric.value);
  assert.ok(shader.uniforms.aloeCamera.value.distanceTo(expected) < 1e-10);
  assert.equal(shader.uniforms.aloeOrthographic.value, 0);
  assert.ok(Math.abs(shader.uniforms.aloeHalfBounds.value.x - 0.029) < 1e-7,
    'The profile width is 58 mm even if the viewer was prepared at arbitrary scene placement');
  const orthographic = new THREE.OrthographicCamera(); orthographic.position.copy(camera.position); orthographic.quaternion.copy(camera.quaternion); orthographic.updateMatrixWorld(true);
  f.pulp.material.onBeforeRender({}, {}, orthographic, drawn.geometry, drawn, {});
  assert.equal(shader.uniforms.aloeOrthographic.value, 1);
  assert.ok(Math.abs(shader.uniforms.aloeViewDirection.value.length() - 1) < 1e-12);
});

test('liquid refraction is isotropic in metres after retained Blender scale and follows the drawn viewer scale', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.liquid.material, f.liquid, 'liquid', '#ef6828');
  const shader = compile(f.liquid.material);
  assert.ok(shader.fragmentShader.includes('return normalize( refractionVector ) * aloeWorldThickness;'));
  assert.ok(!shader.fragmentShader.includes('return normalize( refractionVector ) * thickness * modelScale;'));
  assert.ok(Math.abs(shader.uniforms.aloeWorldThickness.value - 0.029 * 0.44) < 1e-8);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0.2, 0.4, 1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  f.root.scale.setScalar(3); f.root.rotation.set(0.3, 0.8, 0.2); f.root.updateMatrixWorld(true);
  f.liquid.material.onBeforeRender({}, {}, camera, f.liquid.geometry, f.liquid, {});
  assert.ok(Math.abs(shader.uniforms.aloeWorldThickness.value - 3 * 0.029 * 0.44) < 1e-8,
    'Viewer scale changes physical refraction distance, without the original tall mesh scale stretching Y');
});

test('both authored shell regions use clean glossy PET without sampling or disposing the imported frost normal', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  const normal = new THREE.Texture(); normal.repeat.set(20, 20); normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  context.after(() => normal.dispose());
  const frosted = f.meshes['Body Bottle - Rough_NormalMap'], glossy = f.meshes['Body Bottle - z Glossy'];
  frosted.material.normalMap = normal; frosted.material.normalScale.setScalar(0.35);
  let disposed = false; normal.addEventListener('dispose', () => { disposed = true; });
  optical.configure(frosted.material, frosted, 'body'); optical.configure(glossy.material, glossy, 'body');
  assert.equal(frosted.material.normalMap, null); assert.deepEqual(normal.repeat.toArray(), [20, 20]);
  assert.equal(disposed, false, 'Removing a runtime map must not dispose a texture shared by the asset pool');
  assert.equal(frosted.material.roughness, 0.075); assert.equal(glossy.material.roughness, 0.075);
  assert.equal(frosted.material.ior, 1.47); assert.equal(glossy.material.ior, 1.47);
  assert.equal(glossy.material.normalMap, null);
  assert.equal(frosted.material.transparent, true); assert.equal(frosted.material.depthWrite, false);
  assert.equal(frosted.material.customProgramCacheKey(), glossy.material.customProgramCacheKey());
  assert.ok(!compile(frosted.material).fragmentShader.includes('aloeFrosted'));
  assert.ok(compile(frosted.material).fragmentShader.includes('totalDiffuse * 0.006'));
  assert.equal(aloe.isAloeBottleMaterial({ ...asset, packaging: 'can' }, frosted, frosted.material), false);
});

test('clear aloe gel is recognizable near the wall, keeps the water hue and loses far contrast', () => {
  const juice = new THREE.Color('#e84a3c'), volume = aloe.aloeScatteringColor(juice);
  const near = aloe.aloeGelColor(juice, 0.005), farther = aloe.aloeGelColor(juice, 0.02);
  for (const channel of ['r', 'g', 'b']) {
    const contrast = 1 - near[channel] / volume[channel];
    assert.ok(contrast > 0.14 && contrast < 0.17,
      'A near gel piece has visible 14–17% extinction, without opaque or white diffuse pigment');
    assert.ok(farther[channel] > near[channel] && farther[channel] <= volume[channel], 'Far gel converges on water radiance');
    assert.ok(1 - farther[channel] / volume[channel] < 0.06, 'A 20 mm water path removes most of the near contrast');
  }
  assert.ok(Math.abs(near.r / volume.r - near.g / volume.g) < 1e-12, 'Neutral gel extinction retains the drink hue');
  assert.deepEqual(aloe.aloeGelColor(juice, 0.1).toArray(), volume.toArray());
  const dense = aloe.aloeGelColor(juice, 0.005, 1), edge = aloe.aloeGelColor(juice, 0.005, 0.5, 0.4);
  assert.ok(dense.r < near.r && edge.r < near.r, 'Cloud density and a longer through-piece grazing path increase gel extinction');
  assert.ok(edge.r >= volume.r * (1 - aloe.ALOE_PET_OPTICS.pulpMaximumContrast),
    'Even a very close grazing gel edge cannot become a hard dark block');
});

test('final water filtering keeps dark pulp in the water hue and bounds overlapping pieces', context => {
  for (const tint of ['#e84a3c', '#c72675', '#268da7', '#eeeeee']) {
    const water = aloe.aloeScatteringColor(new THREE.Color(tint));
    const transmission = new THREE.Color(0.95, 0.23, 0.12);
    assert.deepEqual(aloe.aloeFilterCapturedWater(water, water, transmission).toArray(), water.toArray(),
      'An unchanged water capture keeps its exact radiance');
    for (const capture of [water.clone().multiplyScalar(0.88),
      water.clone().multiplyScalar(0.88).multiply(new THREE.Color(0.86, 1, 1)),
      water.clone().multiplyScalar(0.35)]) {
      const filtered = aloe.aloeFilterCapturedWater(water, capture, transmission);
      const ratios = filtered.toArray().map((value, i) => value / water.toArray()[i]);
      assert.ok(Math.abs(ratios[0] - ratios[1]) + Math.abs(ratios[1] - ratios[2]) < 1e-12,
        'Even a grey/green biased dark capture becomes the same water hue with lower brightness');
      assert.ok(ratios.every(value => value >= 0.81 - 1e-12 && value < 1),
        'Overlapping gel cannot accumulate into nearly black silhouettes');
    }
    const bright = water.clone().multiplyScalar(1.05);
    const expected = water.clone().add(bright.clone().sub(water).multiply(transmission));
    assert.deepEqual(aloe.aloeFilterCapturedWater(water, bright, transmission).toArray(), expected.toArray(),
      'The existing brighter capture filtering is retained');
  }
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.liquid.material, f.liquid, 'liquid', '#e84a3c');
  const shader = compile(f.liquid.material);
  assert.ok(shader.fragmentShader.includes('? volumeColor * retainedBrightness'));
  assert.ok(shader.fragmentShader.includes('0.810000, 1.0)'));
});

test('bulk colour and actual transmission coverage respond to short neck versus full body chords', () => {
  const juice = new THREE.Color('#e84a3c');
  const reference = aloe.aloeBulkTransmission(juice, 0.058, 0.058);
  assert.deepEqual(reference.toArray(), [1, 1, 1], 'Reference bulk radiance is not dyed twice');
  const thin = aloe.aloeBulkTransmission(juice, 0.012, 0.058), thick = aloe.aloeBulkTransmission(juice, 0.07, 0.058);
  assert.ok(thin.b > thin.g && thin.g > thin.r && thin.r > 1, 'Thin shoulders retain more light spectrally');
  assert.ok(thick.b < thick.g && thick.g < thick.r && thick.r < 1, 'Longer centre paths have stronger liquid colour');
  const neutral = aloe.aloeBulkTransmission(new THREE.Color('#eeeeee'), 0.012, 0.058);
  assert.ok(Math.abs(neutral.r - neutral.g) + Math.abs(neutral.g - neutral.b) < 1e-12);
  const body = aloe.aloeReservoirCoverage(0.058, 0.3), shoulder = aloe.aloeReservoirCoverage(0.032, 0.8), neck = aloe.aloeReservoirCoverage(0.024, 0.94);
  assert.ok(body > 0.8 && body < 0.9, 'The body remains cloudy with a small real transmission fraction');
  assert.ok(neck > 0.35 && neck < 0.55, 'Thin neck lets substantially more scene/background pass through');
  assert.ok(neck < shoulder && shoulder < body);
  assert.equal(aloe.aloeReservoirCoverage(0), 0);
  assert.ok(aloe.aloeReservoirCoverage(0.024, 0.99) < neck, 'The clear upper neck gradient responds to the liquid height');
});

test('native transmission clear sentinel is removed without losing real captured colours or rough-mip mixtures', () => {
  const clear = aloe.aloeClearCapture(new THREE.Color(1, 1, 1), 0.5);
  assert.equal(clear.opacity, 0); assert.deepEqual(clear.color.toArray(), [0, 0, 0]);
  const objectColor = new THREE.Color().setRGB(0.8, 0.06, 0.03);
  const opaque = aloe.aloeClearCapture(objectColor, 1);
  assert.equal(opaque.opacity, 1); assert.deepEqual(opaque.color.toArray(), objectColor.toArray());
  for (const coverage of [0.15, 0.5, 0.85]) {
    const mixed = new THREE.Color(1, 1, 1).lerp(objectColor, coverage);
    const recovered = aloe.aloeClearCapture(mixed, 0.5 + 0.5 * coverage);
    assert.ok(Math.abs(recovered.opacity - coverage) < 1e-12);
    for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(recovered.color[channel] - objectColor[channel]) < 1e-12,
      'A mip mixture with native clear pixels recovers actual water/object colour without white contamination');
  }
  const shader = aloe.correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment);
  assert.ok(shader.includes('transmittedLight.a = aloeCapturedCoverage;'));
  assert.ok(shader.includes('vec3(aloeClearRadiance * (1.0 - aloeCapturedCoverage))'));
});

test('gel blending attenuates real captured radiance without darkening the native white sentinel at a clear base', () => {
  const object = new THREE.Color().setRGB(0.87, 0.08, 0.045);
  for (const clearRadiance of [0.5, 1]) for (const coverage of [0, 0.05, 0.2, 0.5, 0.9, 1]) for (const filter of [1, 0.93, 0.81]) {
    const captured = new THREE.Color(clearRadiance, clearRadiance, clearRadiance).lerp(object, coverage);
    const capturedAlpha = 0.5 + coverage * 0.5;
    const sourceCompensation = new THREE.Color(1, 1, 1).multiplyScalar(2 * clearRadiance * (1 - filter));
    const blended = sourceCompensation.multiplyScalar(1 - capturedAlpha).add(captured.clone().multiplyScalar(filter));
    const recovered = aloe.aloeClearCapture(blended, capturedAlpha, clearRadiance);
    assert.ok(Math.abs(recovered.opacity - coverage) < 1e-12, 'Through-piece gel does not add an opaque alpha silhouette');
    if (coverage === 0) assert.deepEqual(recovered.color.toArray(), [0, 0, 0], 'Uncovered native clear remains transparent');
    else for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(recovered.color[channel] - object[channel] * filter) < 1e-12,
      'Low-coverage neck/base recovers only the bounded gel colour extinction, without amplified grey/black blocks');
  }
});

test('hero and Studio contexts bind their actual transmission clear before every pooled draw', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 0, 1); camera.updateMatrixWorld();
  const back = new THREE.MeshStandardMaterial(); context.after(() => back.dispose());
  for (const [material, mesh, role] of [[f.pulp.material, f.pulp, 'inclusions'], [f.liquid.material, f.liquid, 'liquid'], [back, f.liquid, 'liquid-back']]) {
    optical.configure(material, mesh, role, '#e84a3c'); const shader = compile(material);
    for (const premultipliedAlpha of [true, false, true]) {
      material.onBeforeRender({ getContextAttributes: () => ({ premultipliedAlpha }) }, {}, camera, mesh.geometry, mesh, {});
      assert.equal(shader.uniforms.aloeClearRadiance.value, premultipliedAlpha ? 0.5 : 1);
    }
  }
});

test('liquid restores the previous full-chord backdrop refraction and retains internal water plus white fallback', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.liquid.material, f.liquid, 'liquid', '#e84a3c');
  const shader = compile(f.liquid.material);
  assert.equal(f.liquid.material.transmission, 1); assert.equal(f.liquid.material.ior, 1.335);
  assert.ok(shader.fragmentShader.includes('transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );'));
  assert.ok(shader.fragmentShader.includes('return normalize( refractionVector ) * aloeWorldThickness;'));
  const transmission = aloe.correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment, true);
  assert.ok(transmission.includes('refract(-externalViewWorld, normalize(n), 1.0 / ior)'));
  assert.ok(transmission.includes('aloeExitDistance(externalFrontMetric + externalRayMetric * externalInset, externalRayMetric)'));
  assert.equal((transmission.match(/texture2D\(aloeBackdropTexture/g) ?? []).length, 5, 'Retain the former five-tap backdrop treatment');
  assert.ok(shader.fragmentShader.includes('uniform sampler2D aloeBackdropTexture;'));
  assert.ok(!shader.fragmentShader.includes('aloeExitDistance(vAloePosition'), 'Full fitted depth remains reserved for gel, not each liquid surface pixel');
  const compositeAt = shader.fragmentShader.indexOf('gl_FragColor.rgb += vec3(1.0 - gl_FragColor.a);');
  assert.ok(compositeAt > shader.fragmentShader.indexOf('#include <colorspace_fragment>'));
  assert.ok(compositeAt > shader.fragmentShader.indexOf('#include <premultiplied_alpha_fragment>'));
  assert.ok(shader.fragmentShader.includes('gl_FragColor.a = 1.0;'));
  assert.ok(!aloe.correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment).includes('aloeBackdropTexture'),
    'Ring retains its standalone clear-sentinel correction');
});

test('backdrop binds to current pooled liquid only and detaches without touching approved pulp or recompiling', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.liquid.material, f.liquid, 'liquid', '#e84a3c');
  optical.configure(f.pulp.material, f.pulp, 'inclusions', '#e84a3c');
  const liquid = compile(f.liquid.material), pulp = compile(f.pulp.material);
  const version = f.liquid.material.version, key = f.liquid.material.customProgramCacheKey();
  const drawnRoot = f.root.clone(true), texture = new THREE.Texture({ width: 512, height: 384 });
  context.after(() => texture.dispose());
  aloe.setAloeBottleBackdrop(drawnRoot, texture);
  assert.equal(liquid.uniforms.aloeBackdropTexture.value, texture);
  assert.equal(liquid.uniforms.aloeBackdropEnabled.value, 1);
  assert.deepEqual(liquid.uniforms.aloeBackdropTexel.value.toArray(), [1 / 512, 1 / 384]);
  aloe.setAloeBottleBackdrop(drawnRoot, texture, 0);
  assert.equal(liquid.uniforms.aloeBackdropEnabled.value, 1, 'Prewarm executes the real external branch behind the white appearance');
  assert.equal(liquid.uniforms.aloeBackdropMix.value, 0);
  aloe.setAloeBottleBackdrop(drawnRoot, texture, .5);
  assert.equal(liquid.uniforms.aloeBackdropMix.value, .5);
  assert.ok(liquid.fragmentShader.includes('mix(vec3(1.0), backdropDisplay, aloeBackdropMix)'));
  aloe.setAloeBottleBackdrop(drawnRoot, texture, 2);
  assert.equal(liquid.uniforms.aloeBackdropMix.value, 1);
  assert.equal(pulp.uniforms.aloeBackdropTexture, undefined, 'Pulp gains no sampler, matrix binding or external ray');
  assert.ok(!pulp.fragmentShader.includes('aloeBackdropTexture'));
  assert.ok(pulp.vertexShader.includes('vAloeDepth = aloeGelDetail.z > 0.5 ? 0.0 : aloeExitDistance'));
  assert.ok(!pulp.fragmentShader.includes('aloeNoise'));
  const camera = new THREE.PerspectiveCamera(); camera.position.z = 2;
  drawnRoot.rotation.set(.3, .7, .2); drawnRoot.scale.setScalar(2); drawnRoot.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const drawn = drawnRoot.getObjectByName(f.liquid.name);
  drawn.material.onBeforeRender({ getRenderTarget: () => null }, {}, camera, drawn.geometry, drawn, null);
  const product = liquid.uniforms.aloeWorldToMetric.value.clone().multiply(liquid.uniforms.aloeMetricToWorld.value);
  const identity = new THREE.Matrix4();
  product.elements.forEach((value, i) => assert.ok(Math.abs(value - identity.elements[i]) < 1e-10));
  aloe.setAloeBottleBackdrop(drawnRoot, null);
  assert.equal(liquid.uniforms.aloeBackdropTexture.value, null); assert.equal(liquid.uniforms.aloeBackdropEnabled.value, 0);
  assert.equal(f.liquid.material.version, version); assert.equal(f.liquid.material.customProgramCacheKey(), key);
  const expanded = liquid.fragmentShader.replace('#include <transmission_pars_fragment>', transmissionChunk());
  for (const [declared, used] of [['uniform vec4 aloeFloor[', 'float aloeFloorValue('],
    ['float aloeExitDistance(', 'vec3 externalViewWorld'], ['uniform sampler2D aloeBackdropTexture;', 'vec3 externalViewWorld']]) {
    assert.ok(expanded.indexOf(declared) >= 0 && expanded.indexOf(declared) < expanded.indexOf(used), `${declared} precedes ${used}`);
  }
  function transmissionChunk() { return aloe.correctAloeTransmissionClear(THREE.ShaderChunk.transmission_pars_fragment, true); }
});

test('actual pooled draws use white preview while offscreen PNG preserves native alpha and restore without recompilation', context => {
  const f = fixture(context), optical = aloe.createAloeBottleMaterialContext(f.root, asset);
  optical.configure(f.liquid.material, f.liquid, 'liquid', '#e84a3c');
  const drawnRoot = f.root.clone(), drawn = drawnRoot.getObjectByName(f.liquid.name);
  drawnRoot.position.set(2, -1, 3); drawnRoot.rotation.set(0.4, 0.7, -0.2); drawnRoot.scale.setScalar(2.5);
  drawnRoot.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 0, 6); camera.lookAt(drawnRoot.position); camera.updateMatrixWorld(true);
  const shader = compile(drawn.material), version = drawn.material.version, key = drawn.material.customProgramCacheKey();
  let target = null;
  const renderer = { getRenderTarget: () => target, getContextAttributes: () => ({ premultipliedAlpha: true }) };
  const draw = () => drawn.material.onBeforeRender(renderer, {}, camera, drawn.geometry, drawn, {});
  draw(); assert.equal(shader.uniforms.aloeWhiteDisplayFill.value, 1); assert.equal(shader.uniforms.aloeClearRadiance.value, 0.5);
  assert.ok(Math.abs(shader.uniforms.aloeWorldThickness.value - 0.058 * 0.22 * 2.5) < 1e-7, 'Isotropic internal ray follows the drawn clone scale');
  target = {}; draw(); assert.equal(shader.uniforms.aloeWhiteDisplayFill.value, 0, 'Linear render targets and PNG keep native alpha');
  target = null; draw(); assert.equal(shader.uniforms.aloeWhiteDisplayFill.value, 1);
  assert.equal(drawn.material.version, version); assert.equal(drawn.material.customProgramCacheKey(), key);
});

test('post-tone white reservoir matches white Studio across water coverage and exposure', () => {
  const water = new THREE.Color().setRGB(0.7, 0.09, 0.05);
  for (const coverage of [0, 0.2, 0.6, 1]) for (const exposure of [0.6, 1, 1.8]) {
    const outputWater = water.clone().multiplyScalar(exposure);
    for (const channel of ['r', 'g', 'b']) outputWater[channel] /= 1 + outputWater[channel];
    outputWater.convertLinearToSRGB();
    const filled = outputWater.clone().multiplyScalar(coverage).add(new THREE.Color(1, 1, 1).multiplyScalar(1 - coverage));
    const studioWhite = new THREE.Color(1, 1, 1).lerp(outputWater, coverage);
    for (const channel of ['r', 'g', 'b']) assert.ok(Math.abs(filled[channel] - studioWhite[channel]) < 1e-12);
  }
});

test('molded inward bottom preserves near gel rather than skipping across the base air pocket', context => {
  const points = [], triangles = [], size = 0.03, grid = 8, top = 0.08;
  for (let z = 0; z <= grid; z++) for (let x = 0; x <= grid; x++) {
    const px = -size + 2 * size * x / grid, pz = -size + 2 * size * z / grid;
    const hump = Math.max(0, 1 - (px * px + pz * pz) / (0.025 * 0.025));
    points.push(px, 0.014 * hump * hump, pz);
  }
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    const a = z * (grid + 1) + x, b = a + 1, c = a + grid + 1, d = c + 1;
    triangles.push(a, c, b, b, c, d);
  }
  const corner = points.length / 3;
  points.push(-size, 0, -size, size, 0, -size, size, 0, size, -size, 0, size,
    -size, top, -size, size, top, -size, size, top, size, -size, top, size);
  for (let side = 0; side < 4; side++) {
    const a = corner + side, b = corner + (side + 1) % 4;
    triangles.push(a, b, a + 4, b, b + 4, a + 4);
  }
  triangles.push(corner + 4, corner + 5, corner + 6, corner + 4, corner + 6, corner + 7);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setIndex(triangles);
  context.after(() => geometry.dispose());
  const profile = aloe.fitAloeLiquidProfile(geometry, new THREE.Matrix4());
  assert.ok(aloe.aloeFloorHeight(profile, 0, 0) > 0.012 && aloe.aloeFloorHeight(profile, 0, 0) < 0.0141);
  assert.ok(aloe.aloeFloorHeight(profile, 0.022, 0) < 0.002);
  const nearWall = new THREE.Vector3(-0.023, 0.004, 0);
  const depth = aloe.aloeExitDistance(profile, nearWall, new THREE.Vector3(1, 0, 0));
  assert.ok(depth > 0.003 && depth < 0.009,
    'First exit is the raised internal floor a few millimetres ahead, not the opposite wall 53 mm away');
  assert.ok(aloe.aloePulpReveal(depth) > 0.2, 'The near base piece remains visible');
  assert.equal(aloe.aloeExitDistance(profile, new THREE.Vector3(0, 0.005, 0), new THREE.Vector3(1, 0, 0)), 0,
    'The bottom air pocket contains no liquid');
});

test('vertex depth/detail interpolation stays calibrated against the previous per-pixel solver on shipped pulp and eight camera poses', async context => {
  const createDraco = require('../../public/decoders/draco/draco_decoder.js');
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../public/models/bottles/pet-500-short-label.glb'));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))), binary = bytes.subarray(28 + bytes.readUInt32LE(12));
  const draco = await createDraco({}), parent = new Map();
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => parent.set(child, index)));
  const matrixFor = index => {
    const node = gltf.nodes[index], matrix = node.matrix ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale || [1, 1, 1]));
    return parent.has(index) ? matrix.premultiply(matrixFor(parent.get(index))) : matrix;
  };
  const decode = role => {
    const nodeIndex = gltf.nodes.findIndex(node => node.extras?.materialSlot === role);
    const primitive = gltf.meshes[gltf.nodes[nodeIndex].mesh].primitives[0];
    const extension = primitive.extensions.KHR_draco_mesh_compression, view = gltf.bufferViews[extension.bufferView];
    const decoder = new draco.Decoder(), buffer = new draco.DecoderBuffer(), mesh = new draco.Mesh();
    const positions = new draco.DracoFloat32Array(), face = new draco.DracoInt32Array();
    let status;
    try {
      const data = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      buffer.Init(data, data.length); status = decoder.DecodeBufferToMesh(buffer, mesh); assert.equal(status.ok(), true);
      decoder.GetAttributeFloatForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, extension.attributes.POSITION), positions);
      const geometry = new THREE.BufferGeometry(), values = new Float32Array(mesh.num_points() * 3), indices = new Uint32Array(mesh.num_faces() * 3);
      for (let i = 0; i < values.length; i++) values[i] = positions.GetValue(i);
      for (let i = 0; i < mesh.num_faces(); i++) {
        decoder.GetFaceFromMesh(mesh, i, face);
        for (let corner = 0; corner < 3; corner++) indices[i * 3 + corner] = face.GetValue(corner);
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(values, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      context.after(() => geometry.dispose()); return { geometry, matrix: matrixFor(nodeIndex) };
    } finally {
      if (status) draco.destroy(status);
      for (const item of [face, positions, mesh, buffer, decoder]) draco.destroy(item);
    }
  };
  const water = decode('liquid'), pulp = decode('inclusions');
  const profile = aloe.fitAloeLiquidProfile(water.geometry, water.matrix);
  const position = pulp.geometry.attributes.position, indices = pulp.geometry.index;
  const points = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(pulp.matrix));
  const model = new THREE.Group(), liquidMaterial = new THREE.MeshPhysicalMaterial(), pulpMaterial = new THREE.MeshPhysicalMaterial();
  liquidMaterial.name = 'Aloe Vera Water'; pulpMaterial.name = 'Aloe Pulp - Clear';
  liquidMaterial.userData.bottleProfile = pulpMaterial.userData.bottleProfile = 'aloe-pet-v1';
  const liquidMesh = new THREE.Mesh(water.geometry, liquidMaterial), pulpMesh = new THREE.Mesh(pulp.geometry, pulpMaterial);
  liquidMesh.applyMatrix4(water.matrix); pulpMesh.applyMatrix4(pulp.matrix); model.add(liquidMesh, pulpMesh); model.updateMatrixWorld(true);
  context.after(() => { liquidMaterial.dispose(); pulpMaterial.dispose(); });
  aloe.createAloeBottleMaterialContext(model, asset).configure(pulpMaterial, pulpMesh, 'inclusions', '#e84a3c');
  const opticalAttribute = pulp.geometry.getAttribute('aloeGelDetail');
  const details = points.map((_, i) => new THREE.Vector2(opticalAttribute.getX(i), opticalAttribute.getY(i)));
  const fallbackAtVertex = points.map((_, i) => opticalAttribute.getZ(i));
  const center = new THREE.Vector3(profile.center.x, (profile.minimumY + profile.maximumY) * 0.5, profile.center.y);
  const offsets = [[0, 0, 0.6], [0.6, 0, 0], [-0.4, 0.18, 0.4], [0.4, 0.22, 0.4],
    [0.4, -0.2, -0.4], [-0.4, -0.2, -0.4], [0.12, -0.6, 0.12], [0.12, 0.6, -0.12]];
  const weights = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2]];
  const errors = [], contrastErrors = [], baseErrors = [], outliers = []; let neckSamples = 0, boundarySamples = 0;
  const contrast = (depth, detail, cosine) => Math.min(aloe.ALOE_PET_OPTICS.pulpMaximumContrast,
    (1 - Math.exp(-aloe.ALOE_PET_OPTICS.gelThicknessMetres / Math.max(Math.abs(cosine), 0.35)
      * (aloe.ALOE_PET_OPTICS.gelExtinctionPerMetre + detail.x * aloe.ALOE_PET_OPTICS.gelCloudExtinctionPerMetre + detail.y * 8)))
    * aloe.aloePulpReveal(depth));
  for (const offset of offsets) {
    const camera = center.clone().add(new THREE.Vector3().fromArray(offset));
    const depthAtVertex = points.map((point, i) => fallbackAtVertex[i] > 0.5 ? 0 : aloe.aloeExitDistance(profile, point, camera.clone().sub(point)));
    // Sample the real triangles, including molded-base and narrow-shoulder pulp.
    for (let triangle = 0; triangle < indices.count; triangle += 3 * 23) {
      const ids = [indices.getX(triangle), indices.getX(triangle + 1), indices.getX(triangle + 2)];
      const [a, b, c] = ids.map(id => points[id]);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const centroid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      if (normal.dot(camera.clone().sub(centroid)) <= 0) continue;
      for (const w of weights) {
        const point = new THREE.Vector3(), detail = new THREE.Vector2(); let interpolated = 0, fallbackWeight = 0;
        ids.forEach((id, i) => { point.addScaledVector(points[id], w[i]); detail.addScaledVector(details[id], w[i]); interpolated += depthAtVertex[id] * w[i]; fallbackWeight += fallbackAtVertex[id] * w[i]; });
        const ray = camera.clone().sub(point).normalize(), original = aloe.aloeExitDistance(profile, point, ray);
        if (fallbackWeight > 0.00001) { interpolated = original; boundarySamples++; }
        const error = Math.abs(interpolated - original); errors.push(error);
        const contrastError = Math.abs(contrast(interpolated, detail, normal.dot(ray)) - contrast(original, aloe.aloeGelDetailAt(point), normal.dot(ray)));
        contrastErrors.push(contrastError);
        if (contrastError > 0.025) outliers.push({ contrastError, original, interpolated, point: point.toArray(), triangle: triangle / 3, offset });
        if (point.y < profile.minimumY + 0.025) baseErrors.push(error);
        if (point.y > profile.maximumY - 0.05) neckSamples++;
      }
    }
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
  context.diagnostic(JSON.stringify({ samples: errors.length, baseSamples: baseErrors.length, neckSamples,
    depthMeanMm: mean(errors) * 1000, depthP95Mm: quantile(errors, 0.95) * 1000, depthMaximumMm: Math.max(...errors) * 1000,
    baseMeanMm: mean(baseErrors) * 1000, contrastMean: mean(contrastErrors), contrastP95: quantile(contrastErrors, 0.95), contrastMaximum: Math.max(...contrastErrors),
    contrastOutliers: outliers.length, exactFallbackSamples: boundarySamples }));
  assert.ok(errors.length > 6000 && baseErrors.length > 300 && neckSamples > 100);
  assert.ok(mean(errors) < 0.0002, 'Mean interpolation depth differs by less than .2 mm from fitted per-pixel depth');
  assert.ok(quantile(contrastErrors, 0.95) < 0.01, '95% of sampled gel pixels retain contrast within one percentage point');
  assert.ok(Math.max(...contrastErrors) < 0.05, 'No base discontinuity may change a faint gel pixel into a hard dark silhouette');
  assert.equal(mean(baseErrors), 0, 'Molded-base depth retains the exact first exit at the inward air pocket');
  assert.ok(boundarySamples / errors.length < 0.3, 'Most pulp pixels use interpolated depth; exact first-exit fallback remains confined to the base/boundary');
});
