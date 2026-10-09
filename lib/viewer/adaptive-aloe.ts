/** Aloe quality is decided from actual draw cadence, not a CPU/RAM guess.
 * The only full-quality trial is bounded and explicitly hidden by the caller. */
export type AloeQuality = 'white' | 'eligible' | 'probing' | 'full';
type Decision = 'white' | 'full';
type WindowSample = { elapsed: number; count: number; late: number; longest: number; submission: number };
const emptySample = (): WindowSample => ({ elapsed: 0, count: 0, late: 0, longest: 0, submission: 0 });
const sessionDecisions = new Map<string, Decision>();
const STORAGE_KEY = 'hyperdrink-aloe-quality-v1';

export interface AloeQualityStore {
  read(key: string): Decision | undefined;
  write(key: string, value: Decision): void;
}

/** Session-local, best effort only: blocked storage never blocks the viewer. */
export const aloeQualityStore: AloeQualityStore = {
  read(key) {
    const remembered = sessionDecisions.get(key);
    if (remembered) return remembered;
    try {
      const records = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
      if (records[key] === 'white' || records[key] === 'full') return records[key];
    } catch { /* Private mode and unavailable storage retain the white default. */ }
  },
  write(key, value) {
    sessionDecisions.set(key, value);
    try {
      const records = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
      records[key] = value;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch { /* The in-memory decision still survives component remounts. */ }
  },
};

export class AdaptiveAloeQuality {
  quality: AloeQuality = 'white';
  reason = 'collecting-white-frames';
  private key = '';
  private budget = 1000 / 60;
  private baseline = emptySample();
  private trial = emptySample();
  private monitor = emptySample();
  private previousDraw: number | undefined;
  private probeStarted = 0;
  private warmDraws = 0;
  private resolved = false;
  private downgrade = false;
  private amount = 0;

  constructor(private readonly store: AloeQualityStore = aloeQualityStore) {}

  /** A bigger drawing buffer is a different workload; never reuse a smaller
   * surface's full-quality result for a large desktop/rotated mobile viewport. */
  configure(width: number, height: number, targetFps: number) {
    const fps = Math.max(24, Math.min(60, targetFps));
    const key = `${Math.ceil(Math.max(1, width * height) / 200000)}:${Math.round(fps)}`;
    if (key === this.key) return;
    this.key = key; this.budget = 1000 / fps;
    this.baseline = emptySample(); this.trial = emptySample(); this.monitor = emptySample();
    this.previousDraw = undefined; this.amount = 0; this.downgrade = false;
    const cached = this.store.read(key);
    this.quality = cached === 'full' ? 'full' : 'white';
    this.resolved = cached !== undefined;
    this.reason = cached ? `session-${cached}` : 'collecting-white-frames';
  }

  get probing() { return this.quality === 'probing'; }
  get needsBackdrop() { return this.probing || this.quality === 'full'; }
  get mix() { return this.amount; }
  get fading() { return this.quality === 'full' && (this.amount < 1 || this.downgrade); }
  rejectFull(reason = 'backdrop-unavailable') { this.finish('white', reason); }

  /** A cached result is not permission to allocate while a pointer owns entry. */
  deferFullEntry() {
    if (this.quality !== 'full') return;
    this.quality = 'white'; this.amount = 0; this.resolved = true;
    this.reason = 'entry-interaction'; this.previousDraw = undefined;
  }

  /** Missing/paused/hidden/loading frames are not evidence of a slow device. */
  resetCadence() { this.previousDraw = undefined; }

  beginProbe(now: number, hidden: boolean, interacting: boolean) {
    if (this.quality !== 'eligible' || !hidden || interacting) return false;
    this.quality = 'probing'; this.reason = 'hidden-refraction-trial';
    this.probeStarted = now; this.warmDraws = 0; this.trial = emptySample();
    this.previousDraw = undefined; return true;
  }

  cancelProbe() {
    if (!this.probing) return;
    this.finish('white', 'trial-cancelled');
  }

  /** Even suspended RAF/very slow frames cannot prolong the hidden gap. */
  checkDeadline(now: number) {
    if (this.probing && now - this.probeStarted >= 800) this.finish('white', 'trial-timeout');
  }

  frame(now: number, submissionMs: number, steady: boolean) {
    const previous = this.previousDraw;
    this.previousDraw = steady || this.probing ? now : undefined;
    if (this.probing) {
      // Exclude a small number of cold uploads/draws from the steady trial,
      // while keeping the wall-clock deadline above. The canvas is hidden.
      if (++this.warmDraws <= 3 || previous === undefined) return;
      this.add(this.trial, now - previous, submissionMs);
      if (this.trial.longest > this.budget * 4 || this.trial.submission > this.budget * 1.8) {
        this.finish('white', 'trial-slow'); return;
      }
      if (this.trial.elapsed >= 450 && this.trial.count >= 12) {
        this.finish(this.healthy(this.trial) ? 'full' : 'white', this.healthy(this.trial) ? 'trial-stable' : 'trial-slow');
      }
      return;
    }
    if (!steady || previous === undefined) return;
    if (this.quality === 'white' && !this.resolved) {
      this.add(this.baseline, now - previous, submissionMs);
      if (this.baseline.elapsed >= 1800 && this.baseline.count >= 24) {
        if (this.healthy(this.baseline)) { this.quality = 'eligible'; this.reason = 'waiting-for-hidden-transition'; }
        else this.finish('white', 'white-frames-slow');
      }
    } else if (this.quality === 'full' && this.amount >= 1 && !this.downgrade) {
      this.add(this.monitor, now - previous, submissionMs);
      // Sustained slowdown can happen after a hidden trial (thermal throttling,
      // a busier flavour). Queue one downgrade; never change while dragging.
      if (this.monitor.elapsed >= 2200 && this.monitor.count >= 24) {
        if (!this.healthy(this.monitor)) this.downgrade = true;
        this.monitor = emptySample();
      }
    }
  }

  /** Only fade a prewarmed mode at a quiet point. No new renderer/shader/RAF. */
  advance(seconds: number, quiet: boolean) {
    if (!quiet || this.probing) return;
    if (this.downgrade) {
      this.amount = Math.max(0, this.amount - Math.max(0, seconds) / 0.55);
      if (this.amount === 0) this.finish('white', 'sustained-slowdown');
    } else if (this.quality === 'full') this.amount = Math.min(1, this.amount + Math.max(0, seconds) / 0.7);
  }

  /** Entry uses the already-tested mode. White remains white, full fades only
   * once its resources have been prepared before the bottle is shown. */
  enter() {
    if (this.reason === 'entry-interaction' && this.store.read(this.key) === 'full') this.quality = 'full';
    this.amount = 0; this.previousDraw = undefined; this.monitor = emptySample();
  }

  private add(sample: WindowSample, gap: number, submissionMs: number) {
    sample.count++; sample.elapsed += gap;
    sample.late += Number(gap > this.budget * 1.6);
    sample.longest = Math.max(sample.longest, gap);
    sample.submission = Math.max(sample.submission, submissionMs);
  }
  private healthy(sample: WindowSample) {
    return sample.elapsed / Math.max(1, sample.count) <= this.budget * 1.22
      && sample.late / Math.max(1, sample.count) <= 0.08
      && sample.longest <= this.budget * 3 && sample.submission <= this.budget * 0.9;
  }
  private finish(mode: Decision, reason: string) {
    this.quality = mode; this.reason = reason; this.resolved = true;
    this.previousDraw = undefined; this.monitor = emptySample();
    if (mode === 'white') { this.amount = 0; this.downgrade = false; }
    this.store.write(this.key, mode);
  }
}
