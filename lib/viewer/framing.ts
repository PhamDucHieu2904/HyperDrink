import * as THREE from 'three';

/** Projected corner constraints preserve meters without combining unrelated extrema. */
export function fitProductCamera(
  bounds: THREE.Box3,
  rest: THREE.Quaternion,
  aspect: number,
  fov: number,
  fill: number,
  rocking: number,
  target: THREE.Vector3,
  radius: number,
  capTilt = 0,
  maximumScale = 1,
) {
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const verticalTan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const horizontalTan = verticalTan * Math.max(0.1, aspect);
  const yaw = new THREE.Quaternion();
  const sway = new THREE.Quaternion();
  const orientation = new THREE.Quaternion();
  const point = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  const views = [rest];
  if (capTilt) {
    const cap = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), capTilt);
    for (let step = 1; step <= 8; step += 1) views.push(rest.clone().slerp(cap, step / 8));
  }
  let distance = radius;
  // Include the full turn plus the cinematic tilt and upward weight shift.
  // Every transformed point contributes its own z-depth to perspective fitting.
  for (const view of views) {
    for (let sample = 0; sample < 24; sample += 1) {
      yaw.setFromAxisAngle(axis, sample * Math.PI / 12);
      for (const xRock of [-rocking, 0, rocking]) {
        for (const zRock of [-rocking, 0, rocking]) {
          sway.setFromEuler(new THREE.Euler(xRock, 0, zRock));
          orientation.copy(view).multiply(yaw).premultiply(sway);
          for (const corner of corners) {
            point.copy(corner).multiplyScalar(maximumScale).applyQuaternion(orientation);
            const vertical = Math.max(Math.abs(point.y - target.y), Math.abs(point.y + radius * 0.055 - target.y));
            const horizontal = Math.abs(point.x - target.x);
            distance = Math.max(distance,
              vertical / (fill * verticalTan) + point.z,
              horizontal / (fill * horizontalTan) + point.z,
            );
          }
        }
      }
    }
  }
  // Continuous rotations between samples need a small numerical safety margin.
  return distance + radius * 0.012;
}
