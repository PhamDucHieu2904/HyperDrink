import * as THREE from 'three';
import type { MockupCameraPreset } from './contracts';

export const MOCKUP_ASPECTS = { square: 1, portrait: 4 / 5, landscape: 16 / 9 } as const;

export function normalizeMockupAspect(aspect: number): number {
  return Number.isFinite(aspect) ? Math.min(3, Math.max(0.4, aspect)) : 1;
}

export function mockupCameraDirection(preset: MockupCameraPreset): THREE.Vector3 {
  const yaw = { front: 0, 'three-quarter': Math.PI / 4, left: -Math.PI / 2, right: Math.PI / 2, back: Math.PI, top: Math.PI / 8 }[preset];
  const elevation = preset === 'top' ? Math.PI / 3 : preset === 'three-quarter' ? 0.12 : 0.025;
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
}

/** Perspective fit in the actual view basis, valid at every azimuth/elevation. */
export function fitMockupCamera(bounds: THREE.Box3, direction: THREE.Vector3, aspect: number, fov: number, fill = 0.8): number {
  const view = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), view).normalize();
  if (right.lengthSq() < 0.5) right.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(view, right).normalize();
  const center = bounds.getCenter(new THREE.Vector3());
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * Math.min(0.95, Math.max(0.4, fill));
  const tanX = tanY * normalizeMockupAspect(aspect);
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const relative = new THREE.Vector3(x, y, z).sub(center);
    const depth = relative.dot(view);
    distance = Math.max(distance, depth + Math.abs(relative.dot(right)) / tanX, depth + Math.abs(relative.dot(up)) / tanY);
  }
  return Math.max(distance, bounds.getSize(new THREE.Vector3()).length() * 0.55, 0.001);
}

/** Conservative radial envelope keeps a freely rotated product inside its fit. */
export function mockupOrbitBounds(bounds: THREE.Box3): THREE.Box3 {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.hypot(size.x, size.z) / 2;
  return new THREE.Box3(new THREE.Vector3(center.x - radius, bounds.min.y, center.z - radius),
    new THREE.Vector3(center.x + radius, bounds.max.y, center.z + radius));
}

export function orbitMockupCamera(position: THREE.Vector3, target: THREE.Vector3, radians: number): void {
  const relative = position.clone().sub(target);
  relative.applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  position.copy(target).add(relative);
}
