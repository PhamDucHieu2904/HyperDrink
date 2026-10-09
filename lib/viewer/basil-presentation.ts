import { DEFAULT_VIEWER_PRESENTATION, type ProductAsset, type ViewerPresentation } from '../viewer-config';

export const isBasilHighAsset = (asset?: ProductAsset | null) => asset?.packaging === 'glass' && asset.materialSlots?.body?.includes('basil-high-outer') === true;

/** Label Lab's saved HDRI / EV15 / 100000 lux sun, normalized once for Three. */
export function basilHighPresentation(): ViewerPresentation {
  const defaults = DEFAULT_VIEWER_PRESENTATION;
  return {
    ...defaults,
    environment: { ...defaults.environment, mode: 'hdri', src: '/environments/label-lab-basil-high.exr', intensity: .20318, rotation: [0, 0, 0] },
    lights: [
      { type: 'directional', color: '#ffffff', intensity: 2.54313, position: [.321394, .766044, -.55667] },
      { ...defaults.lights[1], intensity: 0 },
      { ...defaults.lights[2], intensity: 0 },
    ],
    toneMapping: 'aces', exposure: 1,
  };
}
