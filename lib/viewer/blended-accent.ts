import * as THREE from 'three';
import { publicUrl } from '../public-url';

/** Project a Three image plane into a CSS image without dropping perspective.
 * CSS pixels point downward; the image's UV origin is the plane's upper-left.
 * Output Z is zero so browser compositing order is controlled by CSS layers. */
export function projectAccentImage(world: THREE.Matrix4, camera: THREE.Camera, width: number, height: number, pixels = 768, zoom = 1, imageSize: [number, number] = [1, 1]): THREE.Matrix4 {
  const local = new THREE.Matrix4().set(
    zoom / pixels, 0, 0, -0.5 * imageSize[0] * zoom,
    0, -zoom / pixels, 0, 0.5 * imageSize[1] * zoom,
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

/** A hidden counterpart of the CSS splash, enabled only by the backdrop pass.
 * Geometry and the transformed image map stay owned by the normal accent layer.
 * Hard Light and image opacity are evaluated in CSS/sRGB space before returning
 * linear radiance to the existing backdrop target. */
export function createHardLightCaptureProxy(map: THREE.Texture, geometry: THREE.BufferGeometry, imageZoom = 1): THREE.Mesh {
  map.updateMatrix();
  const material = new THREE.ShaderMaterial({
    name: 'rear-hard-light-capture',
    uniforms: {
      splashMap: { value: map }, splashMapTransform: { value: map.matrix },
      backdrop: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, opacity: { value: 1 },
    },
    vertexShader: /* glsl */`
      uniform mat3 splashMapTransform;
      varying vec2 vSplashUv;
      void main() {
        vSplashUv = (splashMapTransform * vec3(uv, 1.0)).xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D splashMap;
      uniform sampler2D backdrop;
      uniform vec2 resolution;
      uniform float opacity;
      varying vec2 vSplashUv;
      void main() {
        vec4 source = texture2D(splashMap, vSplashUv);
        vec2 screenUv = gl_FragCoord.xy / resolution;
        vec3 base = sRGBTransferOETF(vec4(texture2D(backdrop, screenUv).rgb, 1.0)).rgb;
        vec3 blend = sRGBTransferOETF(vec4(source.rgb, 1.0)).rgb;
        vec3 low = 2.0 * base * blend;
        vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
        vec3 hardLight = mix(low, high, step(vec3(0.5), blend));
        vec3 cssComposite = mix(base, hardLight, clamp(source.a * opacity, 0.0, 1.0));
        gl_FragColor = sRGBTransferEOTF(vec4(cssComposite, 1.0));
        #include <colorspace_fragment>
      }
    `,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const proxy = new THREE.Mesh(geometry, material);
  proxy.name = 'rear-hard-light-capture-proxy';
  proxy.userData.hardLightCapture = true;
  proxy.renderOrder = -10;
  proxy.scale.setScalar(imageZoom);
  proxy.visible = false;
  // Capture-only decoration is never a product interaction surface.
  proxy.raycast = () => {};
  return proxy;
}

/** Real CSS Hard Light against the authored DOM background, beneath WebGL.
 * The clip wrapper deliberately creates NO stacking context: isolating it
 * would prevent its child from blending with the flavor background.
 * A hidden mesh counterpart can join the existing water backdrop capture;
 * the visible hero still uses only this DOM image. */
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
    add(src: string, ready: () => void, imageSize: [number, number] = [1, 1]) {
      const image = document.createElement('img');
      image.alt = ''; image.draggable = false;
      image.setAttribute('aria-hidden', 'true');
      image.dataset.accentBlend = 'hard-light';
      Object.assign(image.style, {
        position: 'absolute', left: '0', top: '0', width: `${768 * imageSize[0]}px`, height: `${768 * imageSize[1]}px`, maxWidth: 'none',
        transformOrigin: '0 0', mixBlendMode: 'hard-light', zIndex: '1', pointerEvents: 'none', display: 'none',
      });
      let removed = false, loaded = false;
      const target = {
        update(world: THREE.Matrix4, camera: THREE.Camera, opacity: number, visible: boolean, zoom = 1) {
          if (removed) return;
          image.style.display = visible && loaded ? 'block' : 'none';
          image.style.opacity = String(opacity);
          if (visible) image.style.transform = `matrix3d(${projectAccentImage(world, camera, width, height, 768, zoom, imageSize).elements.join(',')})`;
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
