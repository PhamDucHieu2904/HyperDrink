import * as THREE from 'three';
import type { ViewerPresentation } from '../viewer-config';

export const smoothstep = (t: number) => t * t * t * (10 + t * (-15 + 6 * t));
export const packageExitProgress = (t: number) => t * t * t;
export const packageSpinProgress = (t: number) => 1 - Math.pow(1 - t, 3);

/** Canonical lid view: independent of the idle pose's yaw and roll. */
export function packageCapPose(tilt: number) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
}

type EntryMotion = Pick<ViewerPresentation['motion'],
  'packageInSeconds' | 'packageBounceSeconds' | 'packageBounceAmount' | 'packageSpringDamping'>;

/** Quintic Hermite velocity bases have zero displacement and acceleration at their endpoints. */
const endVelocity = (t: number) => t * t * t * (-4 + t * (7 - 3 * t));
const startVelocity = (t: number) => t + t * t * t * (-6 + t * (8 - 3 * t));
const interpolate = (from: number, to: number, t: number) => from + (to - from) * smoothstep(t);

/**
 * One continuous scale trajectory through entrance and rebound. The crossing at
 * scale 1 has matching positive velocity and zero acceleration on both sides;
 * a separately eased pulse would stop there before expanding again.
 */
export function packageEntryScale(elapsed: number, inScale: number, motion: EntryMotion) {
  const { packageInSeconds: entrance, packageBounceSeconds: bounce, packageBounceAmount: amount,
    packageSpringDamping: damping } = motion;
  const time = Math.max(0, elapsed);
  if (amount === 0) return interpolate(inScale, 1, Math.min(1, time / entrance));

  const crestSeconds = bounce * 0.14;
  // A normalized end tangent of 2.5 gives t^4 * (2.5 - 1.5t):
  // near-still at first, then continuously accelerating into the rebound.
  // Both tangent bounds guarantee monotonic growth for every admin duration /
  // amplitude. Recovery above scale 1 still eases down before the rebound.
  const velocity = Math.min(2.5 * Math.max(0, 1 - inScale) / entrance, 2.5 * amount / crestSeconds);
  if (time < entrance) {
    const t = time / entrance;
    return interpolate(inScale, 1, t) + velocity * entrance * endVelocity(t);
  }

  const t = (time - entrance) / bounce;
  if (t >= 1) return 1;
  if (t <= 0.14) {
    const u = t / 0.14;
    return 1 + amount * smoothstep(u) + velocity * crestSeconds * startVelocity(u);
  }
  const recoilRatio = 0.5 * Math.exp(-2.5 * (damping - 0.66));
  const firstTrough = 1 - amount * recoilRatio;
  const secondCrest = 1 + amount * recoilRatio ** 2;
  const secondTrough = 1 - amount * recoilRatio ** 3;
  const finalCrest = 1 + amount * recoilRatio ** 4;
  if (t <= 0.36) return interpolate(1 + amount, firstTrough, (t - 0.14) / 0.22);
  if (t <= 0.57) return interpolate(firstTrough, secondCrest, (t - 0.36) / 0.21);
  if (t <= 0.74) return interpolate(secondCrest, secondTrough, (t - 0.57) / 0.17);
  if (t <= 0.87) return interpolate(secondTrough, finalCrest, (t - 0.74) / 0.13);
  return interpolate(finalCrest, 1, (t - 0.87) / 0.13);
}

/** Reserve the visible rebound as well as anticipation in perspective fitting. */
export function packageMaximumScale(anticipationScale: number, bounceAmount: number) {
  return Math.max(anticipationScale, 1 + bounceAmount);
}
