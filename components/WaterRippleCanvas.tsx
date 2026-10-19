'use client';

import { useEffect, useRef, useState } from 'react';
import { waterSimulationShader, waterSurfaceShader, waterVertexShader } from '@/lib/contact-water-shaders';

function rgb(value: string): number[] {
  const hex = value.replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [.85, .94, .90];
  return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16) / 255);
}

function program(gl: WebGL2RenderingContext, fragmentSource: string) {
  const shaders: WebGLShader[] = [];
  const result = gl.createProgram();
  if (!result) throw new Error('Cannot allocate water program.');
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, waterVertexShader], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Cannot allocate water shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Water shader failed.');
      gl.attachShader(result, shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) || 'Water program failed.');
    return result;
  } catch (error) {
    gl.deleteProgram(result);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
}

export default function WaterRippleCanvas({ tint, baseColor, patternUrl, period }: {
  tint: string; baseColor: string; patternUrl: string; period: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef({ tint, baseColor });
  const [contextVersion, setContextVersion] = useState(0);
  useEffect(() => { paletteRef.current = { tint, baseColor }; }, [tint, baseColor]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const section = root?.parentElement;
    if (!root || !canvas || !section) return;
    root.dataset.renderer = 'fallback';
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return;
    const textures: WebGLTexture[] = [];
    const targets: WebGLFramebuffer[] = [];
    const programs: WebGLProgram[] = [];
    let buffer: WebGLBuffer | null = null;
    let contextInvalidated = false;
    const dispose = () => {
      // Context loss already releases these objects; restored contexts cannot delete them.
      if (contextInvalidated || gl.isContextLost()) return;
      textures.forEach(texture => gl.deleteTexture(texture));
      targets.forEach(target => gl.deleteFramebuffer(target));
      programs.forEach(item => gl.deleteProgram(item));
      gl.deleteBuffer(buffer);
    };
    try {
      const simulation = program(gl, waterSimulationShader); programs.push(simulation);
      const surface = program(gl, waterSurfaceShader); programs.push(surface);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('Cannot allocate water geometry.');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const locations = (item: WebGLProgram, names: string[]) => Object.fromEntries(names.map(name => [name, gl.getUniformLocation(item, name)]));
      const sim = locations(simulation, ['u_state', 'u_texel', 'u_size', 'u_from', 'u_to', 'u_impulse']);
      const view = locations(surface, ['u_state', 'u_pattern', 'u_texel', 'u_size', 'u_period', 'u_offset', 'u_time', 'u_base', 'u_accent']);
      const bind = (item: WebGLProgram) => {
        gl.useProgram(item);
        const position = gl.getAttribLocation(item, 'a_position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      };
      const texture = () => {
        const item = gl.createTexture();
        if (!item) throw new Error('Cannot allocate water texture.');
        textures.push(item);
        gl.bindTexture(gl.TEXTURE_2D, item);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return item;
      };
      const states = [texture(), texture()];
      states.forEach(item => {
        gl.bindTexture(gl.TEXTURE_2D, item);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      });
      for (let i = 0; i < 2; i++) {
        const target = gl.createFramebuffer();
        if (!target) throw new Error('Cannot allocate water target.');
        targets.push(target);
      }
      const tile = texture();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.generateMipmap(gl.TEXTURE_2D);

      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      let active = true, visible = false, lost = false, ready = false;
      let width = 1, height = 1, simWidth = 1, simHeight = 1, read = 0, frame = 0;
      let last = 0, elapsed = 0, accumulator = 0, impulse = 0;
      let fromX = .5, fromY = .5, toX = .5, toY = .5, pointerPresent = false;
      const currentBase = rgb(paletteRef.current.baseColor), currentTint = rgb(paletteRef.current.tint);
      const tick = (now: number) => {
        frame = 0;
        if (!active || !visible || lost || document.hidden || reduced.matches || !ready) return;
        const dt = Math.min((now - last) / 1000, .05);
        last = now; elapsed += dt; accumulator += dt;
        // Fixed-rate simulation keeps wave speed stable at 30/60/120 Hz.
        while (accumulator >= 1 / 60) {
          const write = 1 - read;
          gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write]);
          gl.viewport(0, 0, simWidth, simHeight);
          bind(simulation);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[read]);
          gl.uniform1i(sim.u_state, 0);
          gl.uniform2f(sim.u_texel, 1 / simWidth, 1 / simHeight);
          gl.uniform2f(sim.u_size, simWidth, simHeight);
          gl.uniform2f(sim.u_from, fromX, fromY); gl.uniform2f(sim.u_to, toX, toY);
          gl.uniform1f(sim.u_impulse, impulse);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          read = write; accumulator -= 1 / 60;
          impulse = 0; fromX = toX; fromY = toY;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        bind(surface);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[read]);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tile);
        gl.uniform1i(view.u_state, 0); gl.uniform1i(view.u_pattern, 1);
        gl.uniform2f(view.u_texel, 1 / simWidth, 1 / simHeight);
        gl.uniform2f(view.u_size, width, height);
        gl.uniform1f(view.u_period, period);
        gl.uniform1f(view.u_offset, (elapsed * 10) % period);
        gl.uniform1f(view.u_time, elapsed);
        const nextBase = rgb(paletteRef.current.baseColor), nextTint = rgb(paletteRef.current.tint);
        for (let i = 0; i < 3; i++) {
          currentBase[i] += (nextBase[i] - currentBase[i]) * Math.min(1, dt * 3);
          currentTint[i] += (nextTint[i] - currentTint[i]) * Math.min(1, dt * 3);
        }
        gl.uniform3fv(view.u_base, currentBase); gl.uniform3fv(view.u_accent, currentTint);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (root.dataset.renderer !== 'webgl') root.dataset.renderer = 'webgl';
        frame = requestAnimationFrame(tick);
      };
      const wake = () => {
        cancelAnimationFrame(frame); frame = 0;
        if (reduced.matches || lost) root.dataset.renderer = 'fallback';
        if (active && visible && !document.hidden && !reduced.matches && !lost && ready) {
          last = performance.now(); frame = requestAnimationFrame(tick);
        }
      };
      const resize = () => {
        if (lost) return;
        const rect = root.getBoundingClientRect();
        width = Math.max(1, rect.width); height = Math.max(1, rect.height);
        const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1920 / width);
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const ratio = 384 / Math.max(width, height);
        simWidth = Math.max(64, Math.round(width * ratio)); simHeight = Math.max(64, Math.round(height * ratio));
        gl.activeTexture(gl.TEXTURE0);
        states.forEach((item, i) => {
          gl.bindTexture(gl.TEXTURE_2D, item);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, simWidth, simHeight, 0, gl.RGBA, gl.HALF_FLOAT, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, targets[i]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, item, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Water target unavailable.');
          gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        accumulator = 0; impulse = 0; pointerPresent = false;
        wake();
      };
      const point = (event: PointerEvent, press = false) => {
        if (reduced.matches || (event.pointerType === 'touch' && !press)) return;
        const rect = section.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        if (!pointerPresent) { fromX = x; fromY = y; toX = x; toY = y; }
        const distance = Math.hypot((x - toX) * width, (y - toY) * height);
        impulse = Math.max(impulse, press ? .55 : Math.min(.28, .08 + distance * .008));
        toX = x; toY = y; pointerPresent = true;
      };
      const move = (event: PointerEvent) => point(event);
      const down = (event: PointerEvent) => point(event, true);
      const leave = () => { pointerPresent = false; };
      const contextLost = (event: Event) => { event.preventDefault(); lost = true; contextInvalidated = true; wake(); };
      const contextRestored = () => setContextVersion(version => version + 1);
      const image = new Image();
      image.onload = () => {
        if (!active || lost) return;
        const raster = document.createElement('canvas'); raster.width = raster.height = 512;
        const context = raster.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 512, 512);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tile);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster);
        gl.generateMipmap(gl.TEXTURE_2D);
        ready = true; wake();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); });
      resizeObserver.observe(root); observer.observe(root);
      section.addEventListener('pointermove', move, { passive: true });
      section.addEventListener('pointerdown', down, { passive: true });
      section.addEventListener('pointerleave', leave); section.addEventListener('pointercancel', leave);
      document.addEventListener('visibilitychange', wake); reduced.addEventListener('change', wake);
      canvas.addEventListener('webglcontextlost', contextLost); canvas.addEventListener('webglcontextrestored', contextRestored);
      image.src = patternUrl;
      return () => {
        active = false; cancelAnimationFrame(frame); image.onload = null;
        observer.disconnect(); resizeObserver.disconnect();
        section.removeEventListener('pointermove', move); section.removeEventListener('pointerdown', down);
        section.removeEventListener('pointerleave', leave); section.removeEventListener('pointercancel', leave);
        document.removeEventListener('visibilitychange', wake); reduced.removeEventListener('change', wake);
        canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
        dispose();
      };
    } catch (error) {
      root.dataset.renderer = 'fallback';
      console.warn('Contact water rendering unavailable:', error);
      dispose();
    }
  }, [contextVersion, patternUrl, period]);

  return <div ref={rootRef} className="contact-backdrop" aria-hidden="true">
    <div className="contact-background-pattern" style={{ backgroundImage: `url("${patternUrl}")`, backgroundSize: `${period}px ${period}px` }} />
    <canvas ref={canvasRef} className="contact-water-canvas" />
  </div>;
}
