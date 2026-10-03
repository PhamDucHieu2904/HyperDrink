import type { Vector3Tuple } from '../viewer-config';
import type { ProductAccentNode } from './accent-config';
import type { AccentNodeFrame } from './accent-motion';

export interface AccentProductEnvelope {
  height: number;
  width: number;
  /** Full model bounding-sphere radius, independent of its current rotation. */
  productRadius: number;
  maximumProductScale: number;
}

export interface AccentViewport {
  distance: number;
  fov: number;
  aspect: number;
  center: Vector3Tuple;
}

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Fit the source canvas's longest edge to the slot without stretching pixels. */
export function accentImageSize(width: number, height: number, size = 1): [number, number] {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return [size, size];
  const longest = Math.max(width, height);
  return [width / longest * size, height / longest * size];
}

/** Alpha-bound extents only affect image framing. The full plane sphere remains
 * the conservative geometry radius for product clearance and rear ordering. */
export function accentImageExtent(node: ProductAccentNode, planeSize: number | [number, number] = 1): Vector3Tuple {
  const [width, height] = typeof planeSize === 'number' ? [planeSize, planeSize] : planeSize;
  const [left, top, right, bottom] = node.imageBounds ?? [0, 0, 1, 1];
  return [Math.max(Math.abs(left - 0.5), Math.abs(right - 0.5)) * width,
    Math.max(Math.abs(top - 0.5), Math.abs(bottom - 0.5)) * height, 0];
}

/** Width carries more weight on squat packages: a short 250ml can needs a
 * broader composition than a slim package of the same visible height. */
export function accentLayoutMetrics(envelope: AccentProductEnvelope) {
  const height = positive(envelope.height, 0.1);
  const width = positive(envelope.width, height * 0.55);
  return {
    height,
    horizontalSpan: Math.max(height * 1.16, height * 0.55 + width * 1.35),
    sizeMetric: Math.max(height, width * 1.3),
    sweptRadius: positive(envelope.productRadius, Math.hypot(height, width, width) * 0.5)
      * Math.max(1, positive(envelope.maximumProductScale, 1)),
  };
}

/** Solve depth and perspective compensation together. Pushing an accent back
 * without compensation would make it both smaller and visually too clustered.
 * Its entire sphere stays behind the product's maximum swept sphere, including
 * during a burst, idle rocking, user rotation or an overshoot at package scale.
 * geometryRadius is the accent's normalized local geometry radius before scale. */
export function adaptAccentFrame(
  sample: AccentNodeFrame, node: ProductAccentNode, envelope: AccentProductEnvelope,
  viewport: AccentViewport, geometryRadius: number, geometryExtent?: Vector3Tuple, minimumRearDepth = 0,
): AccentNodeFrame {
  const metrics = accentLayoutMetrics(envelope);
  const distance = positive(viewport.distance, metrics.height * 2);
  const tangent = Math.tan(clamp(positive(viewport.fov, 30), 5, 100) * Math.PI / 360);
  const aspect = positive(viewport.aspect, 1);
  const radius = positive(geometryRadius, Math.sqrt(3) / 2);
  const baseRadius = radius * node.scale * metrics.sizeMetric;
  // Bound unusually large admin sizes before the perspective solve. This also
  // leaves a small viewport margin on narrow screens, without moving UI layers.
  const angle = tangent * Math.min(1, aspect) * 0.94;
  const maximumBaseRadius = distance * angle / (1 + angle);
  let maximumRadius = maximumBaseRadius;
  let rotatedExtent: Vector3Tuple | undefined;
  if (geometryExtent) {
    const [x, y, z] = sample.rotation;
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const matrix = [
      [cy * cz, -cy * sz, sy],
      [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
      [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ];
    rotatedExtent = matrix.map(row => row.reduce((sum, value, axis) => sum + Math.abs(value) * geometryExtent[axis], 0)) as Vector3Tuple;
    if (node.kind === 'splash') {
      // A broad, almost face-on splash is a plane rather than a solid sphere.
      // Fit its actual rotated extents so narrow screens keep a useful broad
      // splash instead of reducing it to a small ring behind the can center.
      const [ex, ey, ez] = rotatedExtent;
      const maximumScale = Math.min(
        distance * tangent * aspect / Math.max(ex + ez * tangent * aspect, 0.000001),
        distance * tangent / Math.max(ey + ez * tangent, 0.000001),
        distance / (radius * 1.02),
      ) * 0.94;
      maximumRadius = maximumScale * radius;
    }
  }
  const sizeAdjustment = Math.min(1, maximumRadius / Math.max(baseRadius, 0.000001));
  const adjustedRadius = baseRadius * sizeAdjustment;
  const clearance = Math.max(metrics.height * 0.05, metrics.sweptRadius * 0.06);
  const artisticDepth = Math.max(0, -sample.position[2]) * metrics.height * 0.45;
  const rearDepth = Math.max(metrics.sweptRadius + clearance + artisticDepth, minimumRearDepth);
  const compensation = (distance + rearDepth) / (distance - adjustedRadius);
  const depth = distance * (compensation - 1);
  const fullRadius = adjustedRadius * compensation;
  const worldScale = sample.scale * metrics.sizeMetric * sizeAdjustment * compensation;
  // Use the closest possible point of each bounding sphere for a conservative
  // frustum fit. All imagery stays within this viewer rather than spilling over
  // the title, packaging row or neighboring desktop cards.
  let extent: Vector3Tuple = [fullRadius, fullRadius, fullRadius];
  if (rotatedExtent) extent = rotatedExtent.map(value => value * worldScale) as Vector3Tuple;
  const nearDistance = distance + depth - extent[2];
  const halfWidth = Math.max(0, nearDistance * tangent * aspect - extent[0]);
  const halfHeight = Math.max(0, nearDistance * tangent - extent[1]);
  const center = viewport.center;
  const position: Vector3Tuple = [
    clamp(sample.position[0] * metrics.horizontalSpan * compensation, center[0] - halfWidth, center[0] + halfWidth),
    clamp(sample.position[1] * metrics.height * compensation, center[1] - halfHeight, center[1] + halfHeight),
    -depth,
  ];
  return { ...sample, position, scale: worldScale };
}
