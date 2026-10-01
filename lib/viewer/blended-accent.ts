import * as THREE from 'three';
import { publicUrl } from '../public-url';

/** Project a unit Three plane into a CSS image without dropping perspective.
 * CSS pixels point downward; the image's UV origin is the plane's upper-left.
 * Output Z is zero so browser compositing order is controlled by CSS layers. */
export function projectAccentImage(world: THREE.Matrix4, camera: THREE.Camera, width: number, height: number, pixels = 768): THREE.Matrix4 {
  const local = new THREE.Matrix4().set(
    1 / pixels, 0, 0, -0.5,
    0, -1 / pixels, 0, 0.5,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  const viewport = new THREE.Matrix4().set(
    width / 2, 0, 0, width / 2,
    0, -height / 2, 0, height / 2,
    0, 0, 0, 0,
    0, 0, 0, 1,
  );
  const projected = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world).multiply(local);
  const result = viewport.multiply(projected);
  // Keep an invertible CSS transform. A zero Z row makes the entire 4×4
  // singular and browsers discard the image even though its rectangle exists.
  result.elements[10] = 1;
  // Normalize homogeneous W; changes no position after perspective division.
  const divisor = result.elements[15];
  if (divisor > 0) result.elements.forEach((value, index) => { result.elements[index] = value / divisor; });
  return result;
}

/** Real CSS Hard Light against the authored DOM background, beneath WebGL.
 * The clip wrapper deliberately creates NO stacking context: isolating it
 * would prevent its child from blending with the flavor background.
 * No additional WebGL render, capture, texture upload or animation loop. */
export function createBlendedAccentHost(mount: HTMLDivElement) {
  const parent = mount.closest<HTMLElement>('.showcase-hero');
  if (!parent) return undefined;
  const host = document.createElement('div');
  host.className = 'blended-accent-clip';
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: 'auto' });
  parent.appendChild(host);
  let width = 1, height = 1;
  let disposed = false;
  const measure = () => {
    if (disposed) return;
    const box = mount.getBoundingClientRect(), area = parent.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    Object.assign(host.style, { left: `${box.left - area.left}px`, top: `${box.top - area.top}px`, width: `${width}px`, height: `${height}px` });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(parent); observer.observe(mount);
  measure();
  const targets = new Set<{ dispose(): void }>();
  return {
    add(src: string, ready: () => void) {
      const image = document.createElement('img');
      image.alt = ''; image.draggable = false;
      image.setAttribute('aria-hidden', 'true');
      image.dataset.accentBlend = 'hard-light';
      Object.assign(image.style, {
        position: 'absolute', left: '0', top: '0', width: '768px', height: '768px', maxWidth: 'none',
        transformOrigin: '0 0', mixBlendMode: 'hard-light', zIndex: '1', pointerEvents: 'none', display: 'none',
      });
      let removed = false, loaded = false;
      const target = {
        update(world: THREE.Matrix4, camera: THREE.Camera, opacity: number, visible: boolean) {
          if (removed) return;
          image.style.display = visible && loaded ? 'block' : 'none';
          image.style.opacity = String(opacity);
          if (visible) image.style.transform = `matrix3d(${projectAccentImage(world, camera, width, height).elements.join(',')})`;
        },
        dispose() {
          if (removed) return;
          removed = true; image.onload = null; image.onerror = null;
          image.remove(); targets.delete(target);
        },
      };
      image.onload = () => { if (!removed && !disposed) { loaded = true; ready(); } };
      image.onerror = () => { if (!removed && !disposed) { loaded = false; ready(); } };
      host.appendChild(image); targets.add(target);
      image.src = publicUrl(src);
      return target;
    },
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect();
      [...targets].forEach(target => target.dispose());
      host.remove();
    },
  };
}
