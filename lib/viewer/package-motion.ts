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

  const crestSeconds = bounce * 0.24;
  // Bounds on both Hermite tangents preserve monotonic growth for every allowed
  // duration/amplitude. Recovery from a failed load above scale 1 eases down first.
  const velocity = Math.min(1.5 * Math.max(0, 1 - inScale) / entrance, 1.5 * amount / crestSeconds);
  if (time < entrance) {
    const t = time / entrance;
    return interpolate(inScale, 1, t) + velocity * entrance * endVelocity(t);
  }

  const t = (time - entrance) / bounce;
  if (t >= 1) return 1;
  if (t <= 0.24) {
    const u = t / 0.24;
    return 1 + amount * smoothstep(u) + velocity * crestSeconds * startVelocity(u);
  }
  const recoilRatio = 0.35 * Math.exp(-2.5 * (damping - 0.66));
  const trough = 1 - amount * recoilRatio;
  const finalCrest = 1 + amount * recoilRatio * recoilRatio;
  if (t <= 0.58) return interpolate(1 + amount, trough, (t - 0.24) / 0.34);
  if (t <= 0.82) return interpolate(trough, finalCrest, (t - 0.58) / 0.24);
  return interpolate(finalCrest, 1, (t - 0.82) / 0.18);
}

/** Reserve the visible rebound as well as anticipation in perspective fitting. */
export function packageMaximumScale(anticipationScale: number, bounceAmount: number) {
  return Math.max(anticipationScale, 1 + bounceAmount);
}
