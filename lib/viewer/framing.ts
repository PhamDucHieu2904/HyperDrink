import * as THREE from 'three';

export interface ProductFramingFrame {
  orientation: THREE.Quaternion;
  scale: number;
  lift?: number;
}

export interface ProductFramingOptions {
  /** A conservative outline enclosing the actual geometry, in product space. */
  points?: THREE.Vector3[];
  frames?: ProductFramingFrame[];
  sizeMultiplier?: number;
  referenceMaximumScale?: number;
}

export interface ProductFramingMotion {
  rocking: number;
  tilt: number;
  maximumScale: number;
  anticipationScale: number;
  entranceSeconds: number;
  entryScale: (elapsed: number) => number;
}

/**
 * Aim the product axis at the lid view while unwinding its local yaw separately.
 * Quaternion slerp alone can turn a half-rotated upright can sideways mid-aim.
 * Swing/twist interpolation keeps the product's up vector on the direct arc.
 */
export function interpolatePackageAim(origin: THREE.Quaternion, cap: THREE.Quaternion, t: number, result = new THREE.Quaternion()) {
  if (t <= 0) return result.copy(origin);
  if (t >= 1) return result.copy(cap);
  const axis = new THREE.Vector3(0, 1, 0);
  const fromUp = axis.clone().applyQuaternion(origin);
  const capUp = axis.clone().applyQuaternion(cap);
  const swing = new THREE.Quaternion().setFromUnitVectors(fromUp, capUp);
  const aligned = origin.clone().premultiply(swing);
  const twist = cap.clone().invert().multiply(aligned).normalize();
  let twistAngle = 2 * Math.atan2(twist.y, twist.w);
  if (twistAngle > Math.PI) twistAngle -= Math.PI * 2;
  else if (twistAngle < -Math.PI) twistAngle += Math.PI * 2;
  const partialSwing = new THREE.Quaternion().slerp(swing, t);
  const partialTwist = new THREE.Quaternion().setFromAxisAngle(axis, -twistAngle * t);
  return result.copy(origin).multiply(partialTwist).premultiply(partialSwing).normalize();
}

/** Sample visible poses at their actual scales, instead of enlarging every pose. */
export function createProductFramingFrames(rest: THREE.Quaternion, motion: ProductFramingMotion, radius: number) {
  const frames: ProductFramingFrame[] = [];
  const cap = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), motion.tilt);
  const yaw = new THREE.Quaternion();
  const sway = new THREE.Quaternion();
  const origin = new THREE.Quaternion();
  const orientation = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const add = (scale: number, lift = 0) => frames.push({ orientation: orientation.clone(), scale, lift });
  // Idle/flavor spins, and the complete aim from every normal idle orientation.
  for (let angle = 0; angle < 16; angle += 1) {
    yaw.setFromAxisAngle(axis, angle * Math.PI / 8);
    for (const x of [-motion.rocking, 0, motion.rocking]) for (const z of [-motion.rocking, 0, motion.rocking]) {
      origin.copy(rest).multiply(yaw).premultiply(sway.setFromEuler(new THREE.Euler(x, 0, z)));
      orientation.copy(origin); add(1); add(1, radius * 0.055);
      for (let step = 1; step <= 8; step += 1) {
        interpolatePackageAim(origin, cap, step / 8, orientation); add(1); add(1, radius * 0.055);
      }
    }
  }
  // A rapid new selection can restart aim during entrance or rebound. Preserve
  // that visible scale while aiming; never move the camera partway through it.
  for (let sample = 0; sample <= 128; sample += 1) {
    const t = sample / 128;
    const eased = t * t * t * (10 + t * (-15 + 6 * t));
    const spin = 1 - (1 - t) ** 3;
    origin.copy(cap).slerp(rest, eased).multiply(yaw.setFromAxisAngle(axis, Math.PI * 2 * spin));
    const scale = motion.entryScale(t * motion.entranceSeconds);
    orientation.copy(origin); add(scale);
    for (let step = 1; step <= 8; step += 1) {
      interpolatePackageAim(origin, cap, step / 8, orientation); add(scale);
    }
  }
  // Once fully present, rebound is at the resting pose. Its full peak can also
  // be interrupted by another package selection, so reserve that aim as well.
  for (let step = 0; step <= 24; step += 1) {
    interpolatePackageAim(rest, cap, step / 24, orientation); add(motion.maximumScale);
  }
  // Cap-facing anticipation and exit have a fixed axis, even for rapid choices.
  for (let sample = 0; sample < 96; sample += 1) {
    orientation.copy(cap).multiply(yaw.setFromAxisAngle(axis, sample * Math.PI / 48));
    add(Math.max(motion.anticipationScale, motion.maximumScale));
  }
  return frames;
}

/**
 * Static round packages do not occupy their bounding box's empty diagonal
 * corners. Measure every vertex, then build a circumscribed elliptical prism.
 * The prism contains every measured vertex, including tabs and label offsets.
 * Animated/instanced meshes keep the generic box fallback.
 */
export function createRadialProductEnvelope(root: THREE.Object3D, bounds: THREE.Box3, segments = 32) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const rx = size.x / 2;
  const rz = size.z / 2;
  if (rx <= 0 || rz <= 0) return undefined;
  let radial = 0;
  let unsupported = false;
  const point = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.SkinnedMesh || node instanceof THREE.InstancedMesh || Object.keys(node.geometry.morphAttributes).length) {
      unsupported = true;
      return;
    }
    const positions = node.geometry.getAttribute('position');
    if (!positions) return;
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
      radial = Math.max(radial, Math.hypot((point.x - center.x) / rx, (point.z - center.z) / rz));
    }
  });
  if (unsupported || !Number.isFinite(radial) || radial <= 0) return undefined;
  // Polygon sides are tangent to the measured ellipse, rather than cutting it.
  const extent = radial / Math.cos(Math.PI / segments);
  const points: THREE.Vector3[] = [];
  for (const y of [bounds.min.y, bounds.max.y]) {
    for (let step = 0; step < segments; step += 1) {
      const angle = step * Math.PI * 2 / segments;
      points.push(new THREE.Vector3(center.x + rx * extent * Math.cos(angle), y, center.z + rz * extent * Math.sin(angle)));
    }
  }
  return points;
}

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
  options?: ProductFramingOptions,
): number {
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
  // Preserve the generic fitting contract for callers without a tighter outline.
  if (!options) return distance + radius * 0.012;

  const points = options.points ?? corners;
  let minimumDistance = radius;
  const constrain = (frame: ProductFramingFrame) => {
    for (const source of points) {
      point.copy(source).multiplyScalar(frame.scale).applyQuaternion(frame.orientation);
      const vertical = Math.abs(point.y + (frame.lift ?? 0) - target.y);
      const horizontal = Math.abs(point.x - target.x);
      minimumDistance = Math.max(minimumDistance,
        vertical / (fill * verticalTan) + point.z,
        horizontal / (fill * horizontalTan) + point.z,
      );
    }
  };
  if (options.frames?.length) options.frames.forEach(constrain);
  else {
    for (const view of views) for (let sample = 0; sample < 48; sample += 1) {
      yaw.setFromAxisAngle(axis, sample * Math.PI / 24);
      for (const xRock of [-rocking, 0, rocking]) for (const zRock of [-rocking, 0, rocking]) {
        sway.setFromEuler(new THREE.Euler(xRock, 0, zRock));
        orientation.copy(view).multiply(yaw).premultiply(sway);
        constrain({ orientation, scale: maximumScale });
        constrain({ orientation, scale: maximumScale, lift: radius * 0.055 });
      }
    }
  }
  minimumDistance += radius * 0.016;

  // Compare the actual resting silhouette with the previous box-framed camera.
  // Perspective depth makes simply dividing camera distance by 1.15 inaccurate.
  const reference = options.referenceMaximumScale === undefined ? distance + radius * 0.012
    : fitProductCamera(bounds, rest, aspect, fov, fill, rocking, target, radius, capTilt, options.referenceMaximumScale);
  const footprint = (atDistance: number) => {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const source of points) {
      point.copy(source).applyQuaternion(rest);
      const depth = atDistance - point.z;
      if (depth <= 0) return Infinity;
      const x = (point.x - target.x) / (depth * horizontalTan);
      const y = (point.y - target.y) / (depth * verticalTan);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return Math.max(maxX - minX, maxY - minY);
  };
  const requested = footprint(reference) * Math.max(1, options.sizeMultiplier ?? 1);
  let near = radius * 0.01;
  let far = reference;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const middle = (near + far) / 2;
    if (footprint(middle) > requested) near = middle;
    else far = middle;
  }
  // User/admin size settings cannot sacrifice the visible animation's headroom.
  return Math.max(minimumDistance, far);
}
