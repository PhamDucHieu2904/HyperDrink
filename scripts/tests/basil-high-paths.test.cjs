/* Run with: node scripts/tests/basil-high-paths.test.cjs */
/* eslint-disable @typescript-eslint/no-require-imports -- An independent CPU ray reference checks the shipped Unity optical buffers. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const assert = require('node:assert/strict');
function readOpticalData(name) {
  const payload = zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname, `../../public/models/bottles/${name}`)));
  assert.equal(payload.toString('ascii', 0, 4), 'B290');
  const headerLength = payload.readUInt32LE(4);
  const header = JSON.parse(payload.toString('utf8', 8, 8 + headerLength).trim());
  const baseOffset = 8 + headerLength;
  const arrays = Object.fromEntries(Object.entries(header.buffers).map(([name, item]) => {
    const bytes = payload.subarray(baseOffset + item.byteOffset, baseOffset + item.byteOffset + item.floatCount * 4);
    const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    return [name, new Float32Array(exact)];
  }));
  return { header, arrays, epsilon: Math.max(1e-9, Math.hypot(...header.bounds.extent.map(v => v * 2)) * 1e-6) };
}
const body = readOpticalData('glass-290-basil-high.bin.gz');
const neck = readOpticalData('glass-290-basil-neck.bin.gz');
const { header, arrays, epsilon } = body;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, scalar) => a.map(v => v * scalar);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const normalize = a => mul(a, 1 / length(a));
const vec3 = (source, offset) => [source[offset], source[offset + 1], source[offset + 2]];
const ior = medium => medium === 0 ? 1 : medium === 1 ? 1.52 : 1.333;
function box(origin, direction, nodes, offset, nearest, expansion = 0) {
  let low = 0, high = nearest;
  for (let i = 0; i < 3; i++) {
    const inverse = 1 / (Math.abs(direction[i]) < 1e-10 ? 1e-10 : direction[i]);
    const a = (nodes[offset + i] - expansion - origin[i]) * inverse;
    const b = (nodes[offset + 4 + i] + expansion - origin[i]) * inverse;
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
  }
  return low <= high;
}
function trace(origin, direction, data = body) {
  const { header, arrays, epsilon } = data;
  let hit = { distance: 1000, primitive: 'miss' };
  const octant = (direction[0] < 0 ? 1 : 0) + (direction[1] < 0 ? 2 : 0) + (direction[2] < 0 ? 4 : 0);
  let node = octant * header.residualNodeStride;
  const nodes = arrays.residualNodes, triangles = arrays.residualTriangles;
  const end = nodes[node * 12 + 3];
  while (node < end) {
    const n = node * 12;
    if (!box(origin, direction, nodes, n, hit.distance)) { node = nodes[n + 3]; continue; }
    for (let i = 0; i < nodes[n + 9]; i++) {
      const t = (nodes[n + 8] + i) * 24;
      const a = vec3(triangles, t), e1 = vec3(triangles, t + 4), e2 = vec3(triangles, t + 8);
      const p = cross(direction, e2), determinant = dot(e1, p);
      if (Math.abs(determinant) < Math.max(1e-30, triangles[t + 11])) continue;
      const offset = sub(origin, a), u = dot(offset, p) / determinant;
      if (u < -1e-5 || u > 1.00001) continue;
      const q = cross(offset, e1), v = dot(direction, q) / determinant;
      if (v < -1e-5 || u + v > 1.00001) continue;
      const distance = dot(e2, q) / determinant;
      if (distance <= epsilon * .5 || distance >= hit.distance) continue;
      const n0 = vec3(triangles, t + 12), n1 = vec3(triangles, t + 16), n2 = vec3(triangles, t + 20);
      hit = { distance, normal: normalize(add(add(mul(n0, 1 - u - v), mul(n1, u)), mul(n2, v))),
        geometric: normalize(cross(e1, e2)), outside: triangles[t + 3], inside: triangles[t + 7], primitive: 'triangle' };
    }
    node++;
  }
  // Test the axisymmetric interfaces independently of their BVH ordering.
  const profiles = header.neck ? [] : arrays.profiles;
  for (let p = 0; p < profiles.length; p += 12) {
    const z0 = profiles[p], z1 = profiles[p + 1], slope = profiles[p + 3];
    if (Math.abs(direction[2]) < 1e-10 && (origin[2] < z0 || origin[2] > z1)) continue;
    const r = profiles[p + 2] + slope * (origin[2] - z0), dr = slope * direction[2];
    const a = direction[0] ** 2 + direction[1] ** 2 - dr * dr;
    const b = origin[0] * direction[0] + origin[1] * direction[1] - r * dr;
    const c = origin[0] ** 2 + origin[1] ** 2 - r * r;
    const accept = distance => {
      if (!Number.isFinite(distance) || distance <= epsilon * .5 || distance >= hit.distance) return;
      const position = add(origin, mul(direction, distance));
      if (position[2] < z0 - epsilon || position[2] > z1 + epsilon) return;
      const along = Math.max(0, Math.min(1, (position[2] - z0) / (z1 - z0)));
      const radial = normalize([position[0], position[1], 0]);
      const nr = profiles[p + 4] * (1 - along) + profiles[p + 6] * along;
      const nz = profiles[p + 5] * (1 - along) + profiles[p + 7] * along;
      hit = { distance, normal: normalize([radial[0] * nr, radial[1] * nr, nz]),
        geometric: mul(normalize([radial[0], radial[1], -slope]), profiles[p + 10]),
        outside: profiles[p + 8], inside: profiles[p + 9], primitive: 'profile' };
    };
    if (Math.abs(a) < 1e-8) { if (Math.abs(b) > 1e-20) accept(-c / (2 * b)); continue; }
    const discriminant = b * b - a * c;
    if (discriminant < 0) continue;
    const q = -b - (b >= 0 ? 1 : -1) * Math.sqrt(discriminant);
    if (Math.abs(q) < 1e-20) accept(-b / a);
    else { accept(q / a); accept(c / q); }
  }
  return hit;
}
function follow(origin, direction, maxSteps = 24, data = body) {
  const { header, epsilon } = data;
  let medium = 0;
  const events = [], distances = [0, 0, 0];
  for (let step = 0; step < maxSteps; step++) {
    const hit = trace(origin, direction, data);
    if (hit.distance >= 999) break;
    if (header.neck && hit.inside > 2.5) {
      events.push({ source: medium, next: 3, distance: hit.distance, primitive: 'opaque-cap', tir: false });
      return { medium: 3, events, distances };
    }
    const entering = dot(direction, hit.geometric) < 0;
    const expected = entering ? hit.outside : hit.inside;
    const next = entering ? hit.inside : hit.outside;
    assert.equal(medium, expected, `Medium continuity at ${JSON.stringify({ step, hit, origin, direction, events })}`);
    let normal = entering ? hit.normal : mul(hit.normal, -1);
    if (dot(normal, direction) >= -.0001) normal = entering ? hit.geometric : mul(hit.geometric, -1);
    const ratio = ior(medium) / ior(next), cosine = Math.max(0, Math.min(1, -dot(normal, direction)));
    const k = 1 - ratio * ratio * (1 - cosine * cosine);
    distances[medium] += hit.distance;
    events.push({ source: medium, next, distance: hit.distance, primitive: hit.primitive, tir: k < 0 });
    origin = add(origin, mul(direction, hit.distance));
    if (k < 0) {
      direction = sub(direction, mul(normal, 2 * dot(direction, normal)));
      origin = add(origin, mul(hit.geometric, (entering ? 1 : -1) * epsilon * 2));
    } else {
      direction = normalize(add(mul(direction, ratio), mul(normal, ratio * cosine - Math.sqrt(k))));
      medium = next;
      origin = add(origin, mul(hit.geometric, (entering ? -1 : 1) * epsilon * 2));
    }
    if (medium === 0 && step > 0 && !header.neck) break;
  }
  return { medium, events, distances };
}

test('the shipped High buffers retain full molded-base interfaces and all hydrated seed fits', () => {
  assert.equal(header.buffers.seedEllipsoids.count, 330);
  assert.equal(header.buffers.profiles.count, 48);
  assert.equal(header.buffers.residualTriangles.count, 23552);
  assert.equal(header.buffers.residualNodes.count, header.residualNodeStride * 8);
  for (const [name, array] of Object.entries(arrays)) assert.ok(array.every(Number.isFinite), `${name} has no NaN/Infinity`);
  for (const name of ['residualNodes', 'profileNodes', 'seedNodes']) {
    const values = arrays[name], count = values.length / 12;
    for (let node = 0; node < count; node++) {
      const escape = values[node * 12 + 3];
      assert.ok(Number.isInteger(escape) && escape > node && escape <= count, `${name} node ${node} escape`);
    }
  }
});

test('side rays cross air, glass, water, glass, air and preserve the authored 1mm body wall', () => {
  for (const z of [.0035, .005, .007, .0105]) {
    const ray = follow([0, -.015, z], [0, 1, 0]);
    assert.equal(ray.medium, 0);
    assert.deepEqual(ray.events.map(event => [event.source, event.next]), [[0, 1], [1, 2], [2, 1], [1, 0]]);
    assert.ok(ray.events.every(event => event.primitive === 'profile'));
    const wall = ray.distances[1];
    assert.ok(wall > .00018 && wall < .00035, `both body walls total ${wall}`);
    assert.ok(ray.distances[2] > .004 && ray.distances[2] < .007);
  }
});

test('bottom-up rays traverse the actual thick molded base and water domain without a hole', () => {
  for (const x of [-.0015, -.0005, .0003, .0015]) {
    const ray = follow([x, .00011, -.01], [0, 0, 1]);
    assert.equal(ray.medium, 0);
    assert.equal(ray.events[0].primitive, 'triangle');
    assert.deepEqual([ray.events[0].source, ray.events[0].next], [0, 1]);
    assert.deepEqual([ray.events[1].source, ray.events[1].next], [1, 2]);
    assert.ok(ray.events[1].distance > .00015, `base has thickness ${ray.events[1].distance}`);
    assert.ok(ray.distances[2] > .005, `ray survives through the filled liquid ${ray.distances[2]}`);
    assert.ok(ray.events.every(event => Number.isFinite(event.distance) && event.distance > epsilon * .5));
  }
});

test('five radial views and oblique bottom views maintain glass/water medium continuity', () => {
  for (const elevation of [0, .35, .75, 1.25]) {
    for (const azimuth of [0, .5, 1.2, 2.4, 3.8]) {
      const unit = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), -Math.sin(elevation)];
      const origin = add(header.bounds.center, mul(unit, .032));
      const target = add(header.bounds.center, [.00021, -.00014, -.0013]);
      const ray = follow(origin, normalize(sub(target, origin)));
      // A refracted ray can leave directly through the liquid/air free surface,
      // which has three interfaces instead of the four body-wall interfaces.
      assert.ok(ray.events.length >= 3 && ray.events.length <= 24, JSON.stringify({ elevation, azimuth, events: ray.events }));
      assert.equal(ray.medium, 0);
      assert.ok(ray.distances[1] > 0 && ray.distances[2] > 0);
    }
  }
});

test('all 330 analytic gel envelopes stay centered on their source cores with the fixed normal offset', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/models/bottles/glass-290-basil.manifest.json'), 'utf8'));
  const thickness = manifest.highInterface.gelThicknessNative;
  const values = arrays.seedEllipsoids;
  for (let i = 0; i < values.length; i += 16) {
    const center = vec3(values, i);
    const inverse = [vec3(values, i + 4), vec3(values, i + 8), vec3(values, i + 12)];
    const radii = inverse.map(axis => 1 / length(axis));
    const axes = inverse.map(normalize);
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) assert.ok(Math.abs(dot(axes[a], axes[b])) < 1e-5);
      const origin = add(center, mul(axes[a], (radii[a] + thickness) * 4));
      const direction = mul(axes[a], -1);
      const offset = sub(origin, center);
      const o = inverse.map(axis => dot(offset, axis)), d = inverse.map(axis => dot(direction, axis));
      const intersection = scale => {
        const go = o.map((v, k) => v / scale[k]), gd = d.map((v, k) => v / scale[k]);
        const a = dot(gd, gd), middle = -dot(go, gd) / a;
        const closest = add(go, mul(gd, middle));
        return middle - Math.sqrt((1 - dot(closest, closest)) / a);
      };
      const coreEntry = intersection([1, 1, 1]);
      const gelEntry = intersection(radii.map(radius => 1 + thickness / radius));
      assert.ok(Math.abs(coreEntry - gelEntry - thickness) < 1e-10,
        `seed ${i / 16} axis ${a}: gel displacement ${coreEntry - gelEntry}`);
    }
  }
});

test('the neck uses the source product-local BVH and continues through its hollow air domain', () => {
  assert.equal(neck.header.neck, true);
  assert.equal(neck.header.residualNodeStride, 0);
  assert.equal(neck.header.buffers.residualTriangles.count, 18207);
  assert.equal(neck.header.buffers.residualNodes.count, 8191);
  assert.ok(neck.epsilon > 5e-7 && neck.epsilon < 6e-7, 'neck product-local units differ from the body-native units');
  for (const y of [1.55, 1.60]) {
    const ray = follow([0, y, -1], [0, 0, 1], 8, neck);
    assert.equal(ray.medium, 0);
    assert.deepEqual(ray.events.map(event => [event.source, event.next]), [[0, 1], [1, 0], [0, 1], [1, 0]]);
    assert.ok(ray.events.every(event => event.primitive === 'triangle'));
    assert.ok(ray.distances[1] > .007 && ray.distances[1] < .0085);
  }
});

test('the neck terminates refracted rays on the authored opaque gold cap within High\'s eight-bounce budget', () => {
  for (const [y, angle] of [[1.52, .4], [1.55, .2], [1.57, .2], [1.6, .1]]) {
    const ray = follow([0, y, -.3], normalize([0, angle, 1]), 8, neck);
    assert.equal(ray.medium, 3);
    assert.deepEqual(ray.events.map(event => [event.source, event.next]), [[0, 1], [1, 0], [0, 1], [1, 0], [0, 3]]);
    assert.equal(ray.events.at(-1).primitive, 'opaque-cap');
    assert.ok(ray.distances[1] > 0 && ray.distances[2] === 0);
  }
});
