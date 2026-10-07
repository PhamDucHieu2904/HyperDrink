import type { MockupFocalPreset } from './contracts';

export const MOCKUP_FOCAL_PRESETS: readonly MockupFocalPreset[] = ['ultraWide', 'wide', 'standard', 'long', 'telephoto'];
/** Vertical FOV at each lens level. Standard retains the original studio lens. */
export const MOCKUP_FOCAL_FOV: Record<MockupFocalPreset, number> = { ultraWide: 50, wide: 40, standard: 30, long: 22, telephoto: 16 };
