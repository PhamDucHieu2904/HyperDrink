import type { BackgroundConfig } from './background-config';

/** Pointer distance never changes the configured speed; the center has no direction. */
export function backgroundPointerVelocity(dx: number, dy: number, speed: number) {
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length * speed, y: dy / length * speed } : { x: 0, y: 0 };
}

/** Time-based steering; RAF frequency and pointer distance never change travel speed.
 * Receives normalized settings. Its clock runs only while the hero is active. */
export class BackgroundAutodrift {
  private angle = 0;
  private nextDirectionAt = -Infinity;

  constructor(
    private readonly settings: Pick<BackgroundConfig, 'autoDirectionMinSeconds' | 'autoDirectionMaxSeconds'>,
    private readonly random: () => number = Math.random,
  ) {}

  reset() { this.nextDirectionAt = -Infinity; }

  direction(nowSeconds: number) {
    if (nowSeconds >= this.nextDirectionAt) {
      this.angle = this.random() * Math.PI * 2;
      const { autoDirectionMinSeconds: min, autoDirectionMaxSeconds: max } = this.settings;
      this.nextDirectionAt = nowSeconds + min + this.random() * (max - min);
    }
    return this.angle;
  }
}
