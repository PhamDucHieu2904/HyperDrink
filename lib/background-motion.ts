/** Pointer distance never changes the configured speed; the center has no direction. */
export function backgroundPointerVelocity(dx: number, dy: number, speed: number) {
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length * speed, y: dy / length * speed } : { x: 0, y: 0 };
}
