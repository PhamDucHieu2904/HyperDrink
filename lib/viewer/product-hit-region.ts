import * as THREE from 'three';

type Face = { vertices: [number, number, number]; normal: THREE.Vector3; center: THREE.Vector3; material: number; offset: number };
type Edge = Array<{ face: number; from: number; to: number }>;
type Topology = { vertices: THREE.Vector3[]; faces: Face[]; edges: Edge[]; version: number; indexVersion: number };
type ClipPoint = [number, number, number, number];
const attributeVersion = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute.version;

function materialVisible(material: THREE.Material | undefined) {
  return Boolean(material && material.visible && material.opacity > 0);
}

/** Only the model's rendered meshes participate; decorative scene siblings never do. */
export function visibleProductMeshes(root: THREE.Object3D | null): THREE.Mesh[] {
  if (!root) return [];
  for (let ancestor: THREE.Object3D | null = root; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return [];
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible(node => {
    if (node instanceof THREE.Mesh && node.geometry.getAttribute('position') && (Array.isArray(node.material) ? node.material : [node.material]).some(materialVisible)) meshes.push(node);
  });
  return meshes;
}

export function hitVisibleProduct(raycaster: THREE.Raycaster, meshes: THREE.Mesh[]) {
  return raycaster.intersectObjects(meshes, false).some(hit => {
    const mesh = hit.object as THREE.Mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
    return materialVisible(material);
  });
}

function topologyFor(geometry: THREE.BufferGeometry): Topology {
  const position = geometry.getAttribute('position');
  const indices = geometry.getIndex();
  const vertices: THREE.Vector3[] = [], remap: number[] = [];
  const welded = new Map<string, number>();
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    const key = `${point.x},${point.y},${point.z}`;
    let id = welded.get(key);
    if (id === undefined) { id = vertices.length; welded.set(key, id); vertices.push(point); }
    remap.push(id);
  }
  const faces: Face[] = [], edgeMap = new Map<number, Edge>();
  const count = indices?.count ?? position.count;
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const ids: [number, number, number] = [remap[indices ? indices.getX(offset) : offset],
      remap[indices ? indices.getX(offset + 1) : offset + 1], remap[indices ? indices.getX(offset + 2) : offset + 2]];
    const a = vertices[ids[0]], b = vertices[ids[1]], c = vertices[ids[2]];
    if (!a || !b || !c) continue;
    const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, cx = c.x - a.x, cy = c.y - a.y, cz = c.z - a.z;
    const normal = new THREE.Vector3(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx);
    if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-24) continue;
    const face = faces.length;
    faces.push({ vertices: ids, normal, center: new THREE.Vector3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3),
      material: geometry.groups.find(group => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0, offset });
    for (let step = 0; step < 3; step++) {
      const from = ids[step], to = ids[(step + 1) % 3], key = Math.min(from, to) * vertices.length + Math.max(from, to);
      let edge = edgeMap.get(key);
      if (!edge) { edge = []; edgeMap.set(key, edge); }
      edge.push({ face, from, to });
    }
  }
  return { vertices, faces, edges: [...edgeMap.values()], version: attributeVersion(position), indexVersion: indices?.version ?? 0 };
}

function outlineLoops(topology: Topology, selected: Uint8Array, reverse: boolean) {
  const next = new Map<number, number[]>();
  for (const edge of topology.edges) {
    let included: Edge[number] | undefined, count = 0;
    for (const link of edge) if (selected[link.face]) { included = link; count++; }
    if (count !== 1 || !included) continue;
    const from = reverse ? included.to : included.from, to = reverse ? included.from : included.to;
    const outgoing = next.get(from);
    if (outgoing) outgoing.push(to); else next.set(from, [to]);
  }
  const loops: number[][] = [];
  while (next.size) {
    const start = next.keys().next().value as number;
    const loop = [start]; let cursor = start;
    for (let remaining = next.size + 1; remaining > 0; remaining--) {
      const outgoing = next.get(cursor);
      if (!outgoing?.length) break;
      cursor = outgoing.pop()!;
      if (!outgoing.length) next.delete(loop[loop.length - 1]);
      if (cursor === start) { if (loop.length >= 3) loops.push(loop); break; }
      loop.push(cursor);
    }
    // Malformed/open boundaries cannot produce an unbounded invisible hit area.
    next.delete(start);
  }
  return loops;
}

function clipPolygon(input: ClipPoint[]): ClipPoint[] {
  let points = input;
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const output: ClipPoint[] = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      const da = a[3] + sign * a[axis], db = b[3] + sign * b[axis];
      if (da >= 0) output.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        output.push(a.map((value, component) => value + (b[component] - value) * t) as ClipPoint);
      }
    }
    points = output;
    if (points.length < 3) return [];
  }
  return points.filter(point => point[3] > 1e-10 && point.every(Number.isFinite));
}

/** Cached adjacency yields boundary paths, rather than serializing every triangle per frame. */
export class ProductSilhouette {
  private cache = new WeakMap<THREE.BufferGeometry, Topology>();

  project(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number) {
    if (!(width > 0 && height > 0)) return '';
    camera.updateMatrixWorld();
    const paths: string[] = [];
    const cameraWorld = camera.getWorldPosition(new THREE.Vector3());
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      if (!geometry.getAttribute('position')) continue;
      const position = geometry.getAttribute('position'), index = geometry.getIndex();
      let topology = this.cache.get(geometry);
      if (!topology || topology.version !== attributeVersion(position) || topology.indexVersion !== (index?.version ?? 0)) {
        topology = topologyFor(geometry); this.cache.set(geometry, topology);
      }
      mesh.updateWorldMatrix(true, false);
      const inverse = mesh.matrixWorld.clone().invert(), eye = cameraWorld.clone().applyMatrix4(inverse);
      const direction = camera.getWorldDirection(new THREE.Vector3()).negate().transformDirection(inverse);
      const matrix = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const front = new Uint8Array(topology.faces.length), back = new Uint8Array(topology.faces.length);
      let hasFront = false, hasBack = false;
      for (let i = 0; i < topology.faces.length; i++) {
        const face = topology.faces[i], material = Array.isArray(mesh.material) ? materials[face.material] : materials[0];
        if (!materialVisible(material) || face.offset < geometry.drawRange.start || face.offset >= geometry.drawRange.start + geometry.drawRange.count) continue;
        const facing = (camera instanceof THREE.OrthographicCamera ? face.normal.dot(direction) :
          face.normal.x * (eye.x - face.center.x) + face.normal.y * (eye.y - face.center.y) + face.normal.z * (eye.z - face.center.z)) >= 0;
        if (facing && material.side !== THREE.BackSide) { front[i] = 1; hasFront = true; }
        if (!facing && material.side !== THREE.FrontSide) { back[i] = 1; hasBack = true; }
      }
      const loops = [...(hasFront ? outlineLoops(topology, front, false) : []), ...(hasBack ? outlineLoops(topology, back, true) : [])];
      for (const loop of loops) {
        // Mirrored authoring transforms must union with other meshes instead of cancelling their winding.
        if (mesh.matrixWorld.determinant() < 0) loop.reverse();
        const points = clipPolygon(loop.map(id => {
          const point = new THREE.Vector4(...topology!.vertices[id].toArray(), 1).applyMatrix4(matrix);
          return point.toArray() as ClipPoint;
        }));
        if (points.length < 3) continue;
        paths.push(points.map((point, index) => `${index ? 'L' : 'M'}${((point[0] / point[3] + 1) * width / 2).toFixed(2)},${((1 - point[1] / point[3]) * height / 2).toFixed(2)}`).join('') + 'Z');
      }
    }
    return paths.join('');
  }
}

const interiorSlot = /^(?:liquid(?:-back)?|inclusions?|pulp|jelly)$/i;
const interiorName = /(?:^|[\s_-])(?:water|liquid|pulp|jelly|inclusions?)(?:$|[\s_-])/i;
function interiorMesh(mesh: THREE.Mesh) {
  if (mesh.userData.nataLiquidBack || mesh.userData.aloeLiquidBack || interiorName.test(mesh.name)) return true;
  // glTF may put semantic extras on the parent of a primitive mesh.
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
    if (interiorSlot.test(String(node.userData.materialSlot ?? ''))) return true;
  }
  return false;
}
function gestureMaterialVisible(material: THREE.Material | undefined) {
  return materialVisible(material) && !interiorSlot.test(String(material?.userData.materialSlot ?? '')) && !interiorName.test(material?.name ?? '');
}

/** Liquids and inclusions cannot enlarge the outer surface that owns a gesture. */
export function visibleProductGestureMeshes(root: THREE.Object3D | null): THREE.Mesh[] {
  if (!root) return [];
  for (let ancestor: THREE.Object3D | null = root; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return [];
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible(node => {
    if (node instanceof THREE.Mesh && !interiorMesh(node)
      && (Array.isArray(node.material) ? node.material : [node.material]).some(gestureMaterialVisible)
      && node.geometry.getAttribute('position')) meshes.push(node);
  });
  return meshes;
}

type GestureProxy = { points: THREE.Vector3[]; slabs: number[][] };
type GestureProxyCache = { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null;
  version: number; indexVersion: number; variants: Map<string, GestureProxy> };
const proxyBins = 16, proxyDirections = 16;
const supportDirections = Array.from({ length: proxyDirections }, (_, index) => {
  const angle = index * Math.PI * 2 / proxyDirections;
  return [Math.cos(angle), Math.sin(angle)];
});

function proxyRanges(mesh: THREE.Mesh) {
  const geometry = mesh.geometry, count = geometry.index?.count ?? geometry.getAttribute('position').count;
  const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
  if (!Array.isArray(mesh.material)) return gestureMaterialVisible(mesh.material) && end > start ? [[start, end]] : [];
  return geometry.groups.filter(group => gestureMaterialVisible((mesh.material as THREE.Material[])[group.materialIndex ?? 0]))
    .map(group => [Math.max(start, group.start), Math.min(end, group.start + group.count)]).filter(([from, to]) => to > from);
}

/** Build once from positions, never face normals/adjacency. Short convex slabs retain
 * the shoulder, waist and cap instead of turning a bottle into one large touch box. */
function buildGestureProxy(geometry: THREE.BufferGeometry, ranges: number[][]): GestureProxy {
  const position = geometry.getAttribute('position'), indices = geometry.index;
  const used = new Uint8Array(position.count), references: number[] = [];
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const [start, end] of ranges) for (let offset = start; offset < end; offset++) {
    const id = indices ? indices.getX(offset) : offset;
    if (used[id]) continue;
    used[id] = 1;
    const point = [position.getX(id), position.getY(id), position.getZ(id)];
    if (!point.every(Number.isFinite)) continue;
    references.push(id);
    for (let axis = 0; axis < 3; axis++) { minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]); }
  }
  if (!references.length) return { points: [], slabs: [] };
  const extents = maximum.map((value, axis) => value - minimum[axis]);
  const axis = extents.indexOf(Math.max(...extents)), u = (axis + 1) % 3, v = (axis + 2) % 3;
  const bins = Array.from({ length: extents[axis] > 1e-10 ? proxyBins : 1 }, () => ({
    scores: new Float64Array(proxyDirections).fill(-Infinity), lowIds: new Int32Array(proxyDirections).fill(-1), highIds: new Int32Array(proxyDirections).fill(-1),
    low: new Float64Array(proxyDirections).fill(Infinity), high: new Float64Array(proxyDirections).fill(-Infinity),
    first: -1, last: -1, minimum: Infinity, maximum: -Infinity,
  }));
  for (const id of references) {
    const point = [position.getX(id), position.getY(id), position.getZ(id)];
    const bin = bins[Math.min(bins.length - 1, Math.floor((point[axis] - minimum[axis]) / (extents[axis] || 1) * bins.length))];
    if (point[axis] < bin.minimum) { bin.minimum = point[axis]; bin.first = id; }
    if (point[axis] > bin.maximum) { bin.maximum = point[axis]; bin.last = id; }
    for (let direction = 0; direction < proxyDirections; direction++) {
      const score = point[u] * supportDirections[direction][0] + point[v] * supportDirections[direction][1];
      if (score > bin.scores[direction] + 1e-12) {
        bin.scores[direction] = score; bin.lowIds[direction] = bin.highIds[direction] = id; bin.low[direction] = bin.high[direction] = point[axis];
      } else if (Math.abs(score - bin.scores[direction]) <= 1e-12) {
        // Retain both ends of straight walls regardless of vertex ordering.
        if (point[axis] < bin.low[direction]) { bin.low[direction] = point[axis]; bin.lowIds[direction] = id; }
        if (point[axis] > bin.high[direction]) { bin.high[direction] = point[axis]; bin.highIds[direction] = id; }
      }
    }
  }
  const points: THREE.Vector3[] = [], remap = new Map<number, number>();
  const rings = bins.map(bin => [...new Set([...bin.lowIds, ...bin.highIds, bin.first, bin.last].filter(id => id >= 0))].map(id => {
    let mapped = remap.get(id);
    if (mapped === undefined) { mapped = points.length; remap.set(id, mapped); points.push(new THREE.Vector3().fromBufferAttribute(position, id)); }
    return mapped;
  })).filter(ring => ring.length);
  return { points, slabs: rings.length === 1 ? rings : rings.slice(1).map((ring, index) => [...new Set([...rings[index], ...ring])]) };
}

type ScreenPoint = [number, number];
function convexScreenHull(points: ScreenPoint[]): ScreenPoint[] {
  if (points.length < 3) return [];
  const ordered = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower: ScreenPoint[] = [], upper: ScreenPoint[] = [];
  for (const point of ordered) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-12) lower.pop(); lower.push(point); }
  for (let index = ordered.length - 1; index >= 0; index--) { const point = ordered[index]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-12) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop();
  return lower.length + upper.length >= 3 ? lower.concat(upper) : [];
}

/** Bounded outer proxy for browser gesture routing; visual topology stays untouched. */
export class ProductGestureProxy {
  private cache = new WeakMap<THREE.BufferGeometry, GestureProxyCache>();

  project(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number) {
    if (!(width > 0 && height > 0)) return '';
    camera.updateMatrixWorld();
    const viewProjection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse), paths: string[] = [];
    for (const mesh of meshes) {
      if (interiorMesh(mesh)) continue;
      const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
      if (!position) continue;
      const ranges = proxyRanges(mesh), key = ranges.map(range => range.join(':')).join(',');
      if (!ranges.length) continue;
      let cache = this.cache.get(geometry);
      if (!cache || cache.position !== position || cache.index !== index || cache.version !== attributeVersion(position) || cache.indexVersion !== (index?.version ?? 0)) {
        cache = { position, index, version: attributeVersion(position), indexVersion: index?.version ?? 0, variants: new Map() }; this.cache.set(geometry, cache);
      }
      let proxy = cache.variants.get(key);
      if (!proxy) {
        proxy = buildGestureProxy(geometry, ranges);
        if (cache.variants.size >= 4) cache.variants.delete(cache.variants.keys().next().value!);
        cache.variants.set(key, proxy);
      }
      mesh.updateWorldMatrix(true, false);
      const matrix = viewProjection.clone().multiply(mesh.matrixWorld);
      const cloud = proxy.points.map(point => new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(matrix).toArray() as ClipPoint);
      for (const slab of proxy.slabs) {
        const source = slab.map(id => cloud[id]), depthInside = (point: ClipPoint) => point[3] > 1e-10 && point[2] >= -point[3] && point[2] <= point[3];
        const clipped = source.filter(depthInside);
        // Crossing the near/far plane is rare. Clip the small support cloud, not
        // the rendered triangles, so a camera inside a bottle stays bounded.
        if (clipped.length !== source.length) for (let a = 0; a < source.length; a++) for (let b = a + 1; b < source.length; b++) for (const sign of [-1, 1]) {
          const from = source[a], to = source[b], da = from[3] + sign * from[2], db = to[3] + sign * to[2];
          if ((da >= 0) === (db >= 0)) continue;
          const t = da / (da - db), point = from.map((value, component) => value + (to[component] - value) * t) as ClipPoint;
          if (point[3] > 1e-10 && point.every(Number.isFinite)) clipped.push(point);
        }
        const hull = convexScreenHull(clipped.filter(depthInside).map(point => [point[0] / point[3], point[1] / point[3]]));
        const polygon = clipPolygon(hull.map(([x, y]) => [x, y, 0, 1]));
        if (polygon.length >= 3) paths.push(polygon.map((point, id) => `${id ? 'L' : 'M'}${((point[0] + 1) * width / 2).toFixed(2)},${((1 - point[1]) * height / 2).toFixed(2)}`).join('') + 'Z');
      }
    }
    return paths.join('');
  }
}

/** The clipped HTML surface declares gesture ownership before the finger lands. */
export function createProductHitRegion(mount: HTMLDivElement) {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true'); element.dataset.productHitRegion = 'true';
  Object.assign(element.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', background: 'transparent',
    display: 'none', touchAction: 'none', cursor: 'grab', userSelect: 'none', overflow: 'hidden' });
  mount.appendChild(element);
  const silhouette = new ProductGestureProxy();
  let previous: number[] = [], previousAttributes: Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null> = [], lastUpdate = -Infinity, captured = false;
  const clear = () => { element.style.display = 'none'; previous = []; previousAttributes = []; lastUpdate = -Infinity; };
  return {
    element, clear,
    beginDrag() { captured = true; },
    endDrag() { captured = false; previous = []; previousAttributes = []; lastUpdate = -Infinity; },
    update(root: THREE.Object3D | null, camera: THREE.Camera, width: number, height: number, now: number, force = false) {
      if (!root) { clear(); return; }
      // Pointer capture already delivers the drag even when the bottle moves
      // away from the finger. Rebuilding a CSS path cannot improve ownership.
      if (captured) return;
      const meshes = visibleProductGestureMeshes(root);
      if (!meshes.length) { clear(); return; }
      root.updateWorldMatrix(true, true); camera.updateMatrixWorld();
      const signature = [root.id, width, height, ...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements];
      const attributes: Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null> = [];
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
        attributes.push(position, index);
        signature.push(mesh.id, mesh.geometry.id, attributeVersion(position), index?.version ?? 0,
          mesh.geometry.drawRange.start, mesh.geometry.drawRange.count, ...mesh.matrixWorld.elements,
          ...mesh.geometry.groups.flatMap(group => [group.start, group.count, group.materialIndex ?? 0]),
          ...((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => gestureMaterialVisible(material) ? 1 : 0)));
      }
      const changed = attributes.length !== previousAttributes.length || attributes.some((attribute, index) => attribute !== previousAttributes[index])
        || signature.length !== previous.length || signature.some((value, index) => value !== previous[index] && Math.abs(value - previous[index]) > 1e-7);
      if (!force && (!changed || previous.length && now - lastUpdate < 50)) return;
      const path = silhouette.project(meshes, camera, width, height);
      element.style.clipPath = path ? `path("${path}")` : 'path("M0,0Z")';
      element.style.display = path ? 'block' : 'none';
      previous = signature; previousAttributes = attributes; lastUpdate = now;
    },
    dispose() { clear(); element.remove(); },
  };
}
