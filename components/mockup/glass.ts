import type { CSSProperties } from 'react';

// Match the storefront glass. Inline filters survive the CSS module optimizer.
export const mockupGlassStyle: CSSProperties = {
  backdropFilter: 'blur(28px) saturate(148%) brightness(1.04)',
  WebkitBackdropFilter: 'blur(28px) saturate(148%) brightness(1.04)',
};

export const mockupNavGlassStyle: CSSProperties = {
  backdropFilter: 'blur(18px) saturate(120%)',
  WebkitBackdropFilter: 'blur(18px) saturate(120%)',
};
