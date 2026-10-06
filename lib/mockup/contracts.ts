import type { ProductAppearance, ProductAsset } from '../viewer-config';

export type MockupCameraPreset = 'front' | 'three-quarter' | 'left' | 'right' | 'back' | 'top';
export type MockupBackgroundType = 'white' | 'gray' | 'dark' | 'color' | 'gradient' | 'transparent';
export interface MockupBackground { type: MockupBackgroundType; color?: string; colorEnd?: string }
export interface MockupAnimation { mode: 'off' | 'turntable' | 'camera-orbit'; speed: number; playing: boolean }
export interface MockupCaptureOptions { longEdge: 1024 | 2048; aspect?: number; signal?: AbortSignal }
export interface MockupStatus {
  phase: 'loading-model' | 'loading-label' | 'preparing' | 'ready' | 'exporting' | 'error';
  assetId: string;
  appearanceId?: string;
  selectionKey?: string;
  revision: number;
  hasProduct: boolean;
  message?: string;
  error?: 'model' | 'label' | 'webgl' | 'export';
}
export interface MockupRuntimeOptions {
  onStatus(value: MockupStatus): void;
  /** Called on manual camera input, which also pauses a playing animation. */
  onInteraction?(): void;
}
export interface MockupRuntime {
  select(asset: ProductAsset, appearance?: ProductAppearance, frontYaw?: number): void;
  setCamera(preset: MockupCameraPreset): void;
  setBackground(background: MockupBackground): void;
  setAnimation(animation: MockupAnimation): void;
  /** Numeric width/height ratio; the host should display the same frame. */
  setAspect(aspect: number): void;
  /** Keyboard-accessible free orbit; pitch increases the polar angle. */
  orbitView(yawRadians: number, pitchRadians: number): void;
  /** Factors above 1 zoom in; factors below 1 zoom out. */
  zoom(factor: number): void;
  resetView(): void;
  capture(options: MockupCaptureOptions): Promise<Blob>;
  dispose(): void;
}
