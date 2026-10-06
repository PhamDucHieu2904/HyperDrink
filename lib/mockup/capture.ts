import { normalizeMockupAspect } from './camera';

export interface MockupImageSize { width: number; height: number; longEdge: number }

/** Four-megapixel budget includes 2048 square, independent from preview DPR. */
export function mockupCaptureSize(longEdge: number, aspect: number, maximumDimension = 2048, pixelBudget = 2048 * 2048): MockupImageSize {
  const ratio = normalizeMockupAspect(aspect);
  const requested = longEdge === 1024 ? 1024 : 2048;
  const maximum = Math.max(1, Math.floor(Math.min(requested, maximumDimension)));
  let width = ratio >= 1 ? maximum : Math.round(maximum * ratio);
  let height = ratio >= 1 ? Math.round(maximum / ratio) : maximum;
  const scale = Math.min(1, Math.sqrt(Math.max(1, pixelBudget) / (width * height)));
  width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
  return { width, height, longEdge: Math.max(width, height) };
}

/** WebGL reads bottom-to-top; ImageData and PNG use top-to-bottom. */
export function flipMockupPixels(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  if (pixels.length !== width * height * 4) throw new Error('Invalid PNG pixel buffer');
  const flipped = new Uint8ClampedArray(new ArrayBuffer(pixels.length));
  const rowSize = width * 4;
  for (let row = 0; row < height; row++) flipped.set(pixels.subarray(row * rowSize, (row + 1) * rowSize), (height - row - 1) * rowSize);
  return flipped;
}

export function mockupAbortError(): DOMException { return new DOMException('Image export cancelled', 'AbortError'); }

export async function encodeMockupPng(pixels: Uint8Array, width: number, height: number, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw mockupAbortError();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG encoder unavailable');
    context.putImageData(new ImageData(flipMockupPixels(pixels, width, height), width, height), 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      let finished = false;
      const settle = (blob: Blob | null, error?: unknown) => {
        if (finished) return;
        finished = true; clearTimeout(timeout); signal?.removeEventListener('abort', aborted);
        if (error) reject(error); else if (blob) resolve(blob); else reject(new Error('PNG encoder returned an empty image'));
      };
      const aborted = () => settle(null, mockupAbortError());
      const timeout = setTimeout(() => settle(null, new Error('PNG encoder timed out')), 30000);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      try { canvas.toBlob(blob => settle(blob), 'image/png'); } catch (error) { settle(null, error); }
    });
  } finally {
    canvas.width = 1; canvas.height = 1;
  }
}

/** The gate remains held until restoration finishes, including rejected exports. */
export function createMockupCaptureGate() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run<T>(capture: () => Promise<T>, restore: () => void): Promise<T> {
      if (busy) throw new Error('An image export is already running');
      busy = true;
      try { return await capture(); } finally { try { restore(); } finally { busy = false; } }
    },
  };
}
