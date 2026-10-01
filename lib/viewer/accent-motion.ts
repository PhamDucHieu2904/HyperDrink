import type { Vector3Tuple } from '../viewer-config';
import type { ProductAccentMotion, ProductAccentNode } from './accent-config';

export type AccentPhase = 'waiting' | 'fading' | 'entering' | 'idle';

export interface AccentMotionState {
  phase: AccentPhase;
  /** Render the previous flavor until it has faded completely. */
  renderedKey: string;
  targetKey: string;
  elapsed: number;
  /** Preserve fan position if a new selection interrupts its entrance. */
  entranceElapsed: number;
  floatTime: number;
  opacity: number;
  fadeFromOpacity: number;
  reducedMotion: boolean;
}

export interface AccentMotionInput {
  /** Include both packaging and appearance revision in this key. */
  key: string;
  /** True only once product and assigned accent assets are ready. */
  ready: boolean;
  /** ProductViewer reaches idle only after the package rebound completes. */
  viewerIdle: boolean;
  reducedMotion: boolean;
  deltaSeconds: number;
  nodeCount?: number;
}

export interface AccentNodeFrame {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: number;
  opacity: number;
  blur: number;
  visible: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
/** Fast release followed by a gradual approach, with zero arrival velocity. */
export const accentBurstProgress = (value: number) => 1 - Math.pow(1 - clamp01(value), 4);

export function createAccentMotion(key: string): AccentMotionState {
  return {
    phase: 'waiting', renderedKey: key, targetKey: key, elapsed: 0, entranceElapsed: 0,
    floatTime: 0, opacity: 0, fadeFromOpacity: 0, reducedMotion: false,
  };
}

/** Pure controller: it consumes the product's actual phase, never independent
 * timeout guesses. Rapid retargets keep fading the current composition and only
 * reveal the latest key after the corresponding product is fully settled. */
export function advanceAccentMotion(
  previous: AccentMotionState, input: AccentMotionInput, motion: ProductAccentMotion,
): AccentMotionState {
  const state = { ...previous, reducedMotion: input.reducedMotion };
  const dt = Number.isFinite(input.deltaSeconds) ? Math.min(0.25, Math.max(0, input.deltaSeconds)) : 0;
  const canReveal = input.ready && input.viewerIdle;
  if (input.reducedMotion) {
    return {
      ...state, targetKey: input.key, renderedKey: input.key,
      phase: canReveal ? 'idle' : 'waiting', opacity: canReveal ? 1 : 0,
      elapsed: 0,
      entranceElapsed: canReveal ? motion.burstSeconds + motion.staggerSeconds * Math.max(0, (input.nodeCount ?? 29) - 1) : 0,
      floatTime: 0, fadeFromOpacity: 0,
    };
  }

  if (input.key !== state.targetKey) {
    state.targetKey = input.key;
    // Preserve a running fade's velocity and opacity when another selection
    // arrives; restarting its ease curve would produce a perceptible hitch.
    if (state.phase !== 'fading') {
      state.phase = state.opacity > 0 ? 'fading' : 'waiting';
      state.fadeFromOpacity = state.opacity;
      state.elapsed = 0;
    }
  }
  if (!canReveal && (state.phase === 'idle' || state.phase === 'entering')) {
    state.phase = 'fading';
    state.fadeFromOpacity = state.opacity;
    state.elapsed = 0;
  }

  if (state.phase === 'fading') {
    state.elapsed += dt;
    state.floatTime += dt;
    state.opacity = state.fadeFromOpacity * (1 - smoothstep(state.elapsed / motion.fadeSeconds));
    if (state.elapsed < motion.fadeSeconds) return state;
    state.phase = 'waiting';
    state.opacity = 0;
    state.elapsed = 0;
    state.entranceElapsed = 0;
    state.floatTime = 0;
  }

  if (state.phase === 'waiting') {
    state.renderedKey = state.targetKey;
    if (!canReveal) return state;
    state.phase = 'entering';
    state.elapsed = 0;
    state.entranceElapsed = 0;
    state.floatTime = 0;
  }
  if (state.phase === 'entering') {
    state.elapsed += dt;
    state.entranceElapsed = state.elapsed;
    state.floatTime += dt;
    state.opacity = smoothstep(state.elapsed / (motion.burstSeconds * 0.28));
    const count = Math.max(1, Math.floor(input.nodeCount ?? 29));
    if (state.elapsed >= motion.burstSeconds + motion.staggerSeconds * (count - 1)) {
      state.phase = 'idle';
      state.opacity = 1;
    }
  } else if (state.phase === 'idle') {
    state.floatTime += dt;
    state.opacity = 1;
  }
  return state;
}

/** Renderer-neutral transforms. Apply the resulting values to GLB groups,
 * lightweight demo geometry or sprite assets in the same scene coordinates. */
export function sampleAccentNode(
  node: ProductAccentNode, state: AccentMotionState, index: number, motion: ProductAccentMotion,
): AccentNodeFrame {
  // An interrupted entrance freezes its fan progression while fading; it does
  // not suddenly jump to the destination or reset to the central origin.
  const rawProgress = state.phase === 'waiting' ? 0
    : state.phase === 'entering' || state.phase === 'fading'
      ? clamp01((state.entranceElapsed - index * motion.staggerSeconds) / motion.burstSeconds)
    : 1;
  const progress = state.reducedMotion ? 1 : accentBurstProgress(rawProgress);
  const idleWeight = state.reducedMotion ? 0 : smoothstep((progress - 0.55) / 0.45);
  const angle = state.floatTime * Math.PI * 2 / node.idle.periodSeconds + node.idle.phase;
  const drift = node.idle.floatAmplitude * idleWeight;
  const rock = node.idle.rockAmplitude * idleWeight;
  const position: Vector3Tuple = [
    motion.origin[0] + (node.position[0] - motion.origin[0]) * progress + Math.cos(angle * 0.73) * drift * 0.35,
    motion.origin[1] + (node.position[1] - motion.origin[1]) * progress + Math.sin(angle) * drift,
    motion.origin[2] + (node.position[2] - motion.origin[2]) * progress + Math.cos(angle * 0.61) * drift * 0.25,
  ];
  const rotation: Vector3Tuple = [
    node.rotation[0] + Math.sin(angle * 0.83) * rock * 0.6,
    node.rotation[1] + (1 - progress) * 0.35 + Math.cos(angle * 0.67) * rock * 0.45,
    node.rotation[2] + (1 - progress) * (node.position[0] < 0 ? 0.4 : -0.4) + Math.sin(angle * 0.91) * rock,
  ];
  const opacity = node.enabled && rawProgress > 0 ? state.opacity * smoothstep(rawProgress / 0.2) : 0;
  return {
    position, rotation, scale: node.scale * (motion.startScale + (1 - motion.startScale) * progress),
    opacity, blur: node.blur, visible: opacity > 0.001,
  };
}
