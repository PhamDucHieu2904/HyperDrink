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

/** The clipped HTML surface declares gesture ownership before the finger lands. */
export function createProductHitRegion(mount: HTMLDivElement) {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true'); element.dataset.productHitRegion = 'true';
  Object.assign(element.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', background: 'transparent',
    display: 'none', touchAction: 'none', cursor: 'grab', userSelect: 'none', overflow: 'hidden' });
  mount.appendChild(element);
  const silhouette = new ProductSilhouette();
  let previous: number[] = [], lastUpdate = -Infinity;
  const clear = () => { element.style.display = 'none'; previous = []; lastUpdate = -Infinity; };
  return {
    element, clear,
    update(root: THREE.Object3D | null, camera: THREE.Camera, width: number, height: number, now: number, force = false) {
      const meshes = visibleProductMeshes(root);
      if (!meshes.length) { clear(); return; }
      root!.updateWorldMatrix(true, true); camera.updateMatrixWorld();
      const signature = [root!.id, width, height, ...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements];
      for (const mesh of meshes) signature.push(mesh.id, mesh.geometry.id, attributeVersion(mesh.geometry.getAttribute('position')), mesh.geometry.getIndex()?.version ?? 0,
        mesh.geometry.drawRange.start, mesh.geometry.drawRange.count, ...mesh.matrixWorld.elements,
        ...((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.visible && material.opacity > 0 ? material.side + 1 : 0)));
      const changed = signature.length !== previous.length || signature.some((value, index) => value !== previous[index] && Math.abs(value - previous[index]) > 1e-7);
      if (!force && (!changed || previous.length && now - lastUpdate < 50)) return;
      const path = silhouette.project(meshes, camera, width, height);
      element.style.clipPath = path ? `path("${path}")` : 'path("M0,0Z")';
      element.style.display = path ? 'block' : 'none';
      previous = signature; lastUpdate = now;
    },
    dispose() { clear(); element.remove(); },
  };
}
