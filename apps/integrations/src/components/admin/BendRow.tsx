// A sideways-scrolling row whose left and right edges fold away over virtual
// cube edges as it scrolls, flattening back out at either scroll end. Adapted
// from Canvas UI's Bend (https://canvasui.dev/docs/components/bend), which
// folds the top and bottom of a vertical scroller; this is the same effect
// turned onto the horizontal axis.
//
// It draws through html-in-canvas and WebGL. Where the browser has no
// html-in-canvas (most, for now) the row renders as a plain scroller, so the
// bend is decoration and never what the content depends on. Clicks, hover and
// text selection on the folded edges are mapped back onto the element drawn
// there, so a bent card still opens.
//
// Bend: Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition
// v1.0 — permission is granted to use, copy, modify, merge, publish, and
// distribute the Software as part of an application, website, or product,
// provided this notice is kept, and the component itself is not sold,
// sublicensed or redistributed. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
// WARRANTY OF ANY KIND.

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

const canvasDimensionLimits = new WeakMap<WebGL2RenderingContext, number>();

/** Keep a DPR budget, then account for browser pinch zoom. */
function getCanvasPixelRatio(element: HTMLElement, context?: WebGL2RenderingContext): number {
  const scale = window.visualViewport?.scale || 1;
  const requested = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const width = Math.max(element.clientWidth, 1);
  const height = Math.max(element.clientHeight, 1);
  let maxDimension = 8192;
  if (context) {
    let limit = canvasDimensionLimits.get(context);
    if (limit === undefined) {
      limit = Math.min(
        maxDimension,
        context.getParameter(context.MAX_TEXTURE_SIZE),
        context.getParameter(context.MAX_RENDERBUFFER_SIZE)
      );
      canvasDimensionLimits.set(context, limit);
    }
    maxDimension = limit;
  }
  return Math.min(
    requested,
    maxDimension / Math.max(width, height),
    Math.sqrt(16_777_216 / (width * height))
  );
}

/** Pinch zoom changes visualViewport without resizing the element's CSS box. */
function createCanvasResizeObserver(onResize: () => void) {
  const viewport = window.visualViewport;
  let frame = 0;
  let disconnected = false;
  const schedule = () => {
    if (frame || disconnected) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onResize();
    });
  };
  const observer = new ResizeObserver(schedule);
  window.addEventListener('resize', schedule, { passive: true });
  viewport?.addEventListener('resize', schedule, { passive: true });
  return {
    observe(element: Element) {
      observer.observe(element);
    },
    disconnect() {
      disconnected = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
    },
  };
}

function createRectCache(element: Element) {
  let current = element.getBoundingClientRect();
  const refresh = () => {
    current = element.getBoundingClientRect();
  };
  const observer = new ResizeObserver(refresh);
  observer.observe(element);
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('scroll', refresh, { capture: true, passive: true });
  return {
    get current() {
      return current;
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    },
  };
}

type PaintableCanvas = HTMLCanvasElement & {
  onpaint?: (() => void) | null;
  requestPaint?: () => void;
  updateElementGeometry?: (element: Element, options: { canvasTransform: DOMMatrix }) => void;
};

type ElementImageContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => DOMMatrix | undefined;
};

/** Configure the capture subtree for both generations of the experimental API. */
function prepareHtmlInCanvas(source: HTMLCanvasElement, content: HTMLElement) {
  if ('content' in source) {
    source.setAttribute('content', 'drawable');
    content.setAttribute('drawable', '');
  } else {
    source.setAttribute('layoutsubtree', '');
  }
}

/** Capture pixels and keep the native DOM hit-test region aligned with them. */
function drawHtmlInCanvas(
  source: PaintableCanvas,
  context: ElementImageContext,
  content: HTMLElement
) {
  const transform = context.drawElementImage!(content, 0, 0);
  // Chrome 154 decoupled geometry from drawing before enabling automatic 2D
  // synchronization; older versions have no update method and newer ones
  // synchronize on their own and return nothing.
  if (transform && typeof source.updateElementGeometry === 'function') {
    source.updateElementGeometry(content, { canvasTransform: transform });
  }
}

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('canvas') as PaintableCanvas;
  const ctx = probe.getContext('2d') as ElementImageContext | null;
  return Boolean(
    ctx && typeof ctx.drawElementImage === 'function' && typeof probe.requestPaint === 'function'
  );
}

export interface BendRowOptions {
  /** Width of the folded region at each edge, in CSS pixels. */
  zone?: number;
  /** Maximum fold angle in degrees, reached away from the scroll ends. 90 is a cube edge. */
  angle?: number;
  /** Radius in CSS pixels of the arc that rounds each crease. 0 keeps a sharp edge. */
  rounding?: number;
  /** Perspective focal length in CSS pixels. Smaller values pinch the folds harder. */
  perspective?: number;
  /** "out" folds the edges away from the viewer, "in" tilts them toward the viewer. */
  direction?: 'out' | 'in';
  /** Scroll distance in CSS pixels over which an edge flattens near its scroll end. */
  ease?: number;
  /** Seconds the bend takes to settle after a scroll. 0 snaps instantly. */
  smoothing?: number;
  /** Bend the left edge. */
  left?: boolean;
  /** Bend the right edge. */
  right?: boolean;
  /** Overscroll tip strength (0 to 1). Rubber-banding past a scroll end tips the face. */
  tumble?: number;
  /** Pointer tilt strength (0 to 1). The face leans toward the cursor. */
  tilt?: number;
}

const DEFAULTS: Required<BendRowOptions> = {
  zone: 240,
  angle: 80,
  rounding: 150,
  perspective: 700,
  direction: 'in',
  ease: 240,
  smoothing: 0.1,
  left: true,
  right: true,
  tumble: 0.5,
  tilt: 0.5,
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The fold maths works in a frame where "along" runs the scroll axis, 1 at
// the left (scroll start) down to 0 at the right, and "across" runs 0 at the
// top to uMaxC at the content's bottom (short of any scrollbar). Lengths are
// fractions of the row's width; the cross axis only ever enters as a ratio.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform float uZone;
uniform float uAngle;
uniform float uPersp;
uniform float uDir;
uniform float uStartAmt;
uniform float uEndAmt;
uniform float uMaxC;
uniform float uPxA;
uniform float uPxC;
uniform float uCover;
uniform vec3 uBg;
uniform float uTiltC;
uniform float uTiltA;
uniform float uPhi;
uniform float uRound;

vec3 foldEdge (float sy, float amt) {
  float yf = 1.0 - uZone;
  if (amt < 1e-4) return vec3(sy, 0.0, 1.0);
  float theta = uAngle * amt;
  if (uRound < 1e-4) {
    float s = sin(theta) * uDir;
    float c = cos(theta);
    float denom = max(c * uPersp + s * (0.5 - sy), 1e-5);
    float tRaw = uPersp * (sy - yf) / denom;
    float t = clamp(tRaw, 0.0, uZone);
    float z = max(t * s, -0.85 * uPersp);
    float alpha = 1.0 - smoothstep(uZone, uZone + 2.0 * uPxA, tRaw);
    return vec3(yf + t, z, alpha);
  }
  if (sy <= yf) return vec3(sy, 0.0, 1.0);
  float R = min(uRound, uZone);
  float r = R / theta;
  float ca = cos(theta);
  float sa = sin(theta);
  float yA = r * sa;
  float zA = r * (1.0 - ca);
  float prevSy = yf;
  float prevZ = 0.0;
  float prevU = 0.0;
  float bestU = -1.0;
  float bestZ = 0.0;
  float maxSy = yf;
  float du = uZone / 40.0;
  for (int i = 1; i <= 40; i++) {
    float u = du * float(i);
    float Y;
    float Zm;
    if (u <= R) {
      float a = u / r;
      Y = r * sin(a);
      Zm = r * (1.0 - cos(a));
    } else {
      Y = yA + (u - R) * ca;
      Zm = zA + (u - R) * sa;
    }
    Y += yf;
    float Z = max(Zm * uDir, -0.85 * uPersp);
    float scr = 0.5 + (Y - 0.5) * uPersp / (uPersp + Z);
    if ((prevSy - sy) * (scr - sy) <= 0.0 && abs(scr - prevSy) > 1e-7) {
      float f = clamp((sy - prevSy) / (scr - prevSy), 0.0, 1.0);
      bestU = mix(prevU, u, f);
      bestZ = mix(prevZ, Z, f);
      if (uDir > 0.0) break;
    }
    maxSy = max(maxSy, scr);
    prevSy = scr;
    prevZ = Z;
    prevU = u;
  }
  if (bestU < 0.0) {
    float alpha = 1.0 - smoothstep(maxSy - uPxA, maxSy + uPxA, sy);
    return vec3(1.0, prevZ, alpha);
  }
  return vec3(yf + bestU, bestZ, 1.0);
}

vec2 tipPlane (float sy, float phi) {
  float s = sin(phi);
  float c = cos(phi);
  float denom = max(c * uPersp + s * (sy - 0.5), 1e-4);
  float t = uPersp * (1.0 - sy) / denom;
  return vec2(1.0 - t, t * s);
}

void main () {
  float across = 1.0 - vUv.y;
  float along = 1.0 - vUv.x;
  float cc = uMaxC * 0.5;
  float zSum = 0.0;

  if (abs(uPhi) > 1e-4) {
    if (uPhi > 0.0) {
      vec2 r = tipPlane(along, uPhi);
      along = r.x;
      zSum += r.y;
    } else {
      vec2 r = tipPlane(1.0 - along, -uPhi);
      along = 1.0 - r.x;
      zSum += r.y;
    }
  }

  float zG = uTiltC * (across - cc) + uTiltA * (along - 0.5);
  zSum += zG;
  along = 0.5 + (along - 0.5) * (uPersp + zG) / uPersp;

  float inStart = step(1.0 - uZone, along);
  float inEnd = step(along, uZone);

  vec3 start = foldEdge(along, uStartAmt);
  vec3 end = foldEdge(1.0 - along, uEndAmt);

  float srcA = along;
  srcA = mix(srcA, start.x, inStart);
  srcA = mix(srcA, 1.0 - end.x, inEnd);

  zSum += inStart * start.y + inEnd * end.y;
  float alpha = mix(1.0, start.z, inStart) * mix(1.0, end.z, inEnd);

  float srcC = cc + (across - cc) * (uPersp + zSum) / uPersp;

  alpha *= smoothstep(-2.0 * uPxC, 0.0, srcC);
  alpha *= 1.0 - smoothstep(uMaxC, uMaxC + 2.0 * uPxC, srcC);
  alpha *= smoothstep(-2.0 * uPxA, 0.0, srcA);
  alpha *= 1.0 - smoothstep(1.0, 1.0 + 2.0 * uPxA, srcA);

  vec2 p = vec2(
    clamp(1.0 - srcA, 0.0005, 0.9995),
    clamp(srcC, 0.0005, uMaxC - 0.0005)
  );
  vec4 base = texture(uContent, p);

  outColor = vec4(mix(uBg, base.rgb, alpha * base.a), uCover);
}`;

const HOVER_ATTR = 'data-canvasui-hover';
const CONTENT_ATTR = 'data-canvasui-content';
const CURSOR_ATTR = 'data-canvasui-cursor';
const HOVER_REWRITE = `:is([${HOVER_ATTR}], :hover:where(:not([${CONTENT_ATTR}], [${CONTENT_ATTR}] *)))`;

/**
 * The real pointer sits over the output canvas, not the drawn content, so
 * every :hover rule is taught to also match an attribute the row sets on the
 * element actually drawn under the pointer.
 */
function patchHoverRules() {
  if (document.documentElement.dataset.canvasuiHoverRules === '') return;
  document.documentElement.dataset.canvasuiHoverRules = '';
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes(':hover')) {
          try {
            rule.selectorText = rule.selectorText.replace(/:hover\b/g, HOVER_REWRITE);
          } catch {}
        }
        if (rule.cssRules.length) walk(rule.cssRules);
      } else if ('cssRules' in rule) {
        try {
          walk((rule as CSSGroupingRule).cssRules);
        } catch {}
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {}
  }
  const style = document.createElement('style');
  style.textContent = `[${CONTENT_ATTR}][${CURSOR_ATTR}], [${CONTENT_ATTR}][${CURSOR_ATTR}] * { cursor: var(--canvasui-cursor) !important; }`;
  document.head.appendChild(style);
}

interface BendRowElements {
  /** Canvas with layoutsubtree that hosts the HTML content. */
  source: HTMLCanvasElement;
  /** The scrollable element inside the source canvas that gets captured. */
  content: HTMLElement;
  /** Canvas the WebGL effect renders to. */
  output: HTMLCanvasElement;
}

interface BendRowInstance {
  setOptions: (options: BendRowOptions) => void;
  destroy: () => void;
}

function createBendRow(
  elements: BendRowElements,
  options: BendRowOptions = {}
): BendRowInstance | null {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl || gl.isContextLost()) return null;

  const paintable = source as PaintableCanvas;
  const sourceCtx = source.getContext('2d') as ElementImageContext | null;
  const htmlInCanvas = Boolean(
    sourceCtx &&
      typeof sourceCtx.drawElementImage === 'function' &&
      typeof paintable.requestPaint === 'function'
  );

  if (htmlInCanvas) prepareHtmlInCanvas(source, content);

  let contentDirty = false;
  let wake = () => {};

  if (htmlInCanvas) {
    paintable.onpaint = () => {
      try {
        sourceCtx!.reset();
        drawHtmlInCanvas(paintable, sourceCtx!, content);
        contentDirty = true;
        wake();
      } catch {}
    };
  }

  function compile(type: number, text: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, text);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error('BendRow shader error:', gl!.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name] = gl.getUniformLocation(program, info.name)!;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const contentTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0])
  );
  gl.generateMipmap(gl.TEXTURE_2D);

  // The share of the row's height the content fills, short of a scrollbar.
  let contentMaxC = 1;

  let bg: [number, number, number] = [0, 0, 0];
  const bgProbe = document.createElement('canvas');
  bgProbe.width = bgProbe.height = 1;
  const bgCtx = bgProbe.getContext('2d', { willReadFrequently: true });

  /** What shows where the folds pull content away: the first painted ancestor. */
  function syncBgColor() {
    if (!bgCtx) return;
    let el: Element | null = content;
    while (el) {
      const css = getComputedStyle(el).backgroundColor;
      if (css && css !== 'transparent') {
        bgCtx.clearRect(0, 0, 1, 1);
        bgCtx.fillStyle = css;
        bgCtx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = bgCtx.getImageData(0, 0, 1, 1).data;
        if (a > 0) {
          bg = [r / 255, g / 255, b / 255];
          return;
        }
      }
      el = el.parentElement;
    }
    bg = [0, 0, 0];
  }

  function syncCanvasSize() {
    const dpr = getCanvasPixelRatio(output, gl!);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    contentMaxC = Math.min(
      1,
      Math.max(0.05, content.clientHeight / Math.max(output.clientHeight, 1))
    );
    if (htmlInCanvas) {
      const sourceWidth = Math.max(1, Math.round(source.clientWidth * dpr));
      const sourceHeight = Math.max(1, Math.round(source.clientHeight * dpr));
      if (source.width !== sourceWidth || source.height !== sourceHeight) {
        source.width = sourceWidth;
        source.height = sourceHeight;
      }
      paintable.requestPaint!();
    }
  }

  let startTarget = 0;
  let endTarget = 0;
  let startCurrent = 0;
  let endCurrent = 0;
  let over = 0;
  let phiCurrent = 0;
  let tiltCTarget = 0;
  let tiltATarget = 0;
  let tiltCCurrent = 0;
  let tiltACurrent = 0;

  function syncScroll() {
    const max = content.scrollWidth - content.clientWidth;
    const t = content.scrollLeft;
    const e = Math.max(config.ease, 1);
    const ramp = (v: number) => {
      const x = Math.min(Math.max(v / e, 0), 1);
      return x * x * (3 - 2 * x);
    };
    startTarget = max > 1 && config.left ? ramp(t) : 0;
    endTarget = max > 1 && config.right ? ramp(max - t) : 0;
  }

  syncCanvasSize();
  syncScroll();
  syncBgColor();

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    syncBgColor();
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
    gl!.generateMipmap(gl!.TEXTURE_2D);
  }

  /** The fold geometry in row-width fractions, shared by the shader and mapPoint. */
  function geometry() {
    const w = Math.max(output.clientWidth, 1);
    const zone = Math.min(Math.max(config.zone, 8) / w, 0.49);
    return {
      w,
      h: Math.max(output.clientHeight, 1),
      zone,
      persp: Math.max(config.perspective, 50) / w,
      round: Math.min(Math.max(config.rounding, 0) / w, zone),
      angle: Math.min(Math.max(config.angle, 1), 160) * (Math.PI / 180),
      dir: config.direction === 'in' ? -1 : 1,
    };
  }

  function render() {
    uploadContent();
    const g = geometry();
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);
    gl!.uniform1f(uniforms.uZone, g.zone);
    gl!.uniform1f(uniforms.uAngle, g.angle);
    gl!.uniform1f(uniforms.uPersp, g.persp);
    gl!.uniform1f(uniforms.uDir, g.dir);
    gl!.uniform1f(uniforms.uStartAmt, startCurrent);
    gl!.uniform1f(uniforms.uEndAmt, endCurrent);
    gl!.uniform1f(uniforms.uMaxC, contentMaxC);
    gl!.uniform1f(uniforms.uPxA, 1.5 / g.w);
    gl!.uniform1f(uniforms.uPxC, 1.5 / g.h);
    gl!.uniform1f(uniforms.uCover, htmlInCanvas ? 1 : 0);
    gl!.uniform3f(uniforms.uBg, bg[0], bg[1], bg[2]);
    gl!.uniform1f(uniforms.uTiltC, tiltCCurrent);
    gl!.uniform1f(uniforms.uTiltA, tiltACurrent);
    gl!.uniform1f(uniforms.uPhi, phiCurrent);
    gl!.uniform1f(uniforms.uRound, g.round);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, output.width, output.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;

  function frame(now: number) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    const tau = config.smoothing;
    const k = reducedMotion || tau <= 0 ? 1 : 1 - Math.exp(-delta / Math.max(tau, 1e-4));
    startCurrent += (startTarget - startCurrent) * k;
    endCurrent += (endTarget - endCurrent) * k;
    if (Math.abs(startTarget - startCurrent) < 0.001) startCurrent = startTarget;
    if (Math.abs(endTarget - endCurrent) < 0.001) endCurrent = endTarget;

    over *= Math.exp(-delta / 0.22);
    if (Math.abs(over) < 0.5) over = 0;
    const phiTarget =
      reducedMotion || config.tumble <= 0
        ? 0
        : Math.tanh(over / 500) * 0.4 * Math.min(config.tumble, 1);
    phiCurrent += (phiTarget - phiCurrent) * Math.min(delta / 0.09, 1);
    if (phiTarget === 0 && Math.abs(phiCurrent) < 1e-4) phiCurrent = 0;

    if (reducedMotion || config.tilt <= 0) {
      tiltCTarget = 0;
      tiltATarget = 0;
    }
    const kT = Math.min(delta / 0.15, 1);
    tiltCCurrent += (tiltCTarget - tiltCCurrent) * kT;
    tiltACurrent += (tiltATarget - tiltACurrent) * kT;
    if (Math.abs(tiltCTarget - tiltCCurrent) < 1e-4) tiltCCurrent = tiltCTarget;
    if (Math.abs(tiltATarget - tiltACurrent) < 1e-4) tiltACurrent = tiltATarget;

    render();
    if (
      !contentDirty &&
      startCurrent === startTarget &&
      endCurrent === endTarget &&
      over === 0 &&
      phiCurrent === 0 &&
      tiltCCurrent === tiltCTarget &&
      tiltACurrent === tiltATarget
    ) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  wake = start;
  start();

  function onScroll() {
    syncScroll();
    if (htmlInCanvas) paintable.requestPaint!();
    if (hoverOn) updateHover(hoverClientX, hoverClientY);
    start();
  }
  content.addEventListener('scroll', onScroll, { passive: true });

  function onWheel(event: WheelEvent) {
    if (config.tumble <= 0 || reducedMotion) return;
    const max = content.scrollWidth - content.clientWidth;
    if (max <= 1) return;
    const sl = content.scrollLeft;
    if (event.deltaX > 0 && sl >= max - 1) {
      over = Math.min(over + event.deltaX, 900);
    } else if (event.deltaX < 0 && sl <= 1) {
      over = Math.max(over + event.deltaX, -900);
    } else {
      return;
    }
    start();
  }
  content.addEventListener('wheel', onWheel, { passive: true });

  const rectCache = createRectCache(output);

  function onPointerMove(event: PointerEvent) {
    if (!event.isPrimary) return;
    hoverClientX = event.clientX;
    hoverClientY = event.clientY;
    hoverOn = true;
    updateHover(event.clientX, event.clientY);
    if (config.tilt > 0 && !reducedMotion) {
      const rect = rectCache.current;
      if (rect.width > 0 && rect.height > 0) {
        const nc = (event.clientY - rect.top) / rect.height - 0.5;
        const na = 0.5 - (event.clientX - rect.left) / rect.width;
        const amp = Math.min(config.tilt, 1) * 0.14;
        tiltCTarget = -nc * amp;
        tiltATarget = -na * amp;
        start();
      }
    }
  }
  content.addEventListener('pointermove', onPointerMove, { passive: true });

  function onPointerLeave() {
    hoverOn = false;
    setHoverTarget(null);
    tiltCTarget = 0;
    tiltATarget = 0;
    start();
  }
  content.addEventListener('pointerleave', onPointerLeave);

  /** Where a point on the output canvas samples the content from (CSS px, local). */
  function mapPoint(px: number, py: number) {
    const { w, h, zone, persp, round, angle, dir } = geometry();
    const cc = contentMaxC * 0.5;
    const cross = py / h;
    let along = 1 - px / w;
    let zSum = 0;

    if (Math.abs(phiCurrent) > 1e-4) {
      const tip = (sy: number, phi: number): [number, number] => {
        const s = Math.sin(phi);
        const c = Math.cos(phi);
        const denom = Math.max(c * persp + s * (sy - 0.5), 1e-4);
        const t = (persp * (1 - sy)) / denom;
        return [1 - t, t * s];
      };
      if (phiCurrent > 0) {
        const tipped = tip(along, phiCurrent);
        along = tipped[0];
        zSum += tipped[1];
      } else {
        const tipped = tip(1 - along, -phiCurrent);
        along = 1 - tipped[0];
        zSum += tipped[1];
      }
    }

    const zG = tiltCCurrent * (cross - cc) + tiltACurrent * (along - 0.5);
    zSum += zG;
    along = 0.5 + (along - 0.5) * ((persp + zG) / persp);

    const fold = (sy: number, amt: number): [number, number, number] => {
      const yf = 1 - zone;
      if (amt < 1e-4) return [sy, 0, 1];
      const theta = angle * amt;
      if (round < 1e-4) {
        const s = Math.sin(theta) * dir;
        const c = Math.cos(theta);
        const denom = Math.max(c * persp + s * (0.5 - sy), 1e-5);
        const tRaw = (persp * (sy - yf)) / denom;
        const t = Math.min(Math.max(tRaw, 0), zone);
        const z = Math.max(t * s, -0.85 * persp);
        return [yf + t, z, tRaw > zone ? 0 : 1];
      }
      if (sy <= yf) return [sy, 0, 1];
      const R = Math.min(round, zone);
      const r = R / theta;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);
      const yA = r * sa;
      const zA = r * (1 - ca);
      let prevSy = yf;
      let prevZ = 0;
      let prevU = 0;
      let bestU = -1;
      let bestZ = 0;
      const du = zone / 40;
      for (let i = 1; i <= 40; i++) {
        const u = du * i;
        let py2: number;
        let zm: number;
        if (u <= R) {
          const a = u / r;
          py2 = r * Math.sin(a);
          zm = r * (1 - Math.cos(a));
        } else {
          py2 = yA + (u - R) * ca;
          zm = zA + (u - R) * sa;
        }
        const worldY = yf + py2;
        const worldZ = Math.max(zm * dir, -0.85 * persp);
        const scr = 0.5 + ((worldY - 0.5) * persp) / (persp + worldZ);
        if ((prevSy - sy) * (scr - sy) <= 0 && Math.abs(scr - prevSy) > 1e-7) {
          const f = Math.min(Math.max((sy - prevSy) / (scr - prevSy), 0), 1);
          bestU = prevU + (u - prevU) * f;
          bestZ = prevZ + (worldZ - prevZ) * f;
          if (dir > 0) break;
        }
        prevSy = scr;
        prevZ = worldZ;
        prevU = u;
      }
      if (bestU < 0) return [1, prevZ, 0];
      return [yf + bestU, bestZ, 1];
    };

    let srcA = along;
    let alpha = 1;
    if (along >= 1 - zone) {
      const folded = fold(along, startCurrent);
      srcA = folded[0];
      zSum += folded[1];
      alpha *= folded[2];
    } else if (along <= zone) {
      const folded = fold(1 - along, endCurrent);
      srcA = 1 - folded[0];
      zSum += folded[1];
      alpha *= folded[2];
    }
    const srcC = cc + (cross - cc) * ((persp + zSum) / persp);
    if (srcC < 0 || srcC > contentMaxC || srcA < 0 || srcA > 1) alpha = 0;
    return { x: (1 - srcA) * w, y: srcC * h, alpha };
  }

  let forwarding = false;
  let hoverChain: Element[] = [];
  let hoverTarget: Element | null = null;
  let hoverClientX = 0;
  let hoverClientY = 0;
  let hoverOn = false;

  if (htmlInCanvas) {
    patchHoverRules();
    content.setAttribute(CONTENT_ATTR, '');
  }

  function setHoverTarget(target: Element | null) {
    if (target === hoverTarget) return;
    hoverTarget = target;
    const next = new Set<Element>();
    for (let el: Element | null = target; el; el = el.parentElement) {
      next.add(el);
      if (el === content) break;
    }
    for (const el of hoverChain) {
      if (!next.has(el)) el.removeAttribute(HOVER_ATTR);
    }
    for (const el of next) el.setAttribute(HOVER_ATTR, '');
    hoverChain = Array.from(next);
    content.removeAttribute(CURSOR_ATTR);
    content.style.removeProperty('--canvasui-cursor');
    if (target) {
      content.style.setProperty('--canvasui-cursor', getComputedStyle(target).cursor);
      content.setAttribute(CURSOR_ATTR, '');
    }
  }

  /** A client point remapped onto the content drawn under it, or null if off it or unmoved. */
  function remapped(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = output.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const mapped = mapPoint(
      (clientX - rect.left) / (rect.width / Math.max(output.clientWidth, 1)),
      (clientY - rect.top) / (rect.height / Math.max(output.clientHeight, 1))
    );
    if (mapped.alpha < 0.5) return null;
    return {
      x: rect.left + mapped.x * (rect.width / Math.max(output.clientWidth, 1)),
      y: rect.top + mapped.y * (rect.height / Math.max(output.clientHeight, 1)),
    };
  }

  function updateHover(clientX: number, clientY: number) {
    if (!htmlInCanvas) return;
    const point = remapped(clientX, clientY);
    const target = point ? document.elementFromPoint(point.x, point.y) : null;
    setHoverTarget(target && content.contains(target) ? target : null);
  }

  function onClick(event: MouseEvent) {
    if (forwarding || !htmlInCanvas || event.button !== 0) return;
    const point = remapped(event.clientX, event.clientY);
    if (point && Math.hypot(point.x - event.clientX, point.y - event.clientY) < 1.5) return;
    event.preventDefault();
    event.stopPropagation();
    if (!point) return;
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) return;
    forwarding = true;
    try {
      target.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: event.detail,
          clientX: point.x,
          clientY: point.y,
          screenX: event.screenX,
          screenY: event.screenY,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          button: event.button,
        })
      );
      if (
        target instanceof HTMLElement &&
        target.matches('input, textarea, select, [contenteditable]')
      ) {
        target.focus();
      }
    } finally {
      forwarding = false;
    }
  }
  content.addEventListener('click', onClick, true);

  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (typeof doc.caretPositionFromPoint === 'function') {
      const c = doc.caretPositionFromPoint(x, y);
      return c ? { node: c.offsetNode, offset: c.offset } : null;
    }
    const r = doc.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  function movedPoint(event: MouseEvent) {
    const point = remapped(event.clientX, event.clientY);
    if (!point || Math.hypot(point.x - event.clientX, point.y - event.clientY) < 1.5) return null;
    return point;
  }

  let selecting = false;

  function onMouseDown(event: MouseEvent) {
    if (forwarding || !htmlInCanvas || event.button !== 0) return;
    const m = movedPoint(event);
    if (!m) return;
    event.preventDefault();
    const caret = caretAt(m.x, m.y);
    if (!caret || !content.contains(caret.node)) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.collapse(caret.node, caret.offset);
    selecting = true;
  }

  function onSelMove(event: MouseEvent) {
    if (!selecting) return;
    if (!(event.buttons & 1)) {
      selecting = false;
      return;
    }
    const m = movedPoint(event);
    const caret = m ? caretAt(m.x, m.y) : null;
    const sel = window.getSelection();
    if (caret && sel?.anchorNode && content.contains(caret.node)) {
      sel.extend(caret.node, caret.offset);
    }
  }

  function onSelEnd() {
    selecting = false;
  }

  content.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onSelMove, true);
  window.addEventListener('mouseup', onSelEnd, true);

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }
  motionQuery.addEventListener('change', onMotionChange);

  const observer = createCanvasResizeObserver(() => {
    syncCanvasSize();
    syncScroll();
    start();
  });
  observer.observe(output);
  observer.observe(content);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  return {
    setOptions(next) {
      if (
        !Object.entries(next).some(([key, value]) => config[key as keyof BendRowOptions] !== value)
      )
        return;
      Object.assign(config, next);
      syncScroll();
      start();
    },
    destroy() {
      destroyed = true;
      rectCache.destroy();
      cancelAnimationFrame(raf);
      setHoverTarget(null);
      content.removeAttribute(CONTENT_ATTR);
      content.removeAttribute(CURSOR_ATTR);
      content.removeEventListener('scroll', onScroll);
      content.removeEventListener('wheel', onWheel);
      content.removeEventListener('pointermove', onPointerMove);
      content.removeEventListener('pointerleave', onPointerLeave);
      content.removeEventListener('click', onClick, true);
      content.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onSelMove, true);
      window.removeEventListener('mouseup', onSelEnd, true);
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      gl!.deleteTexture(contentTexture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}

export interface BendRowProps extends BendRowOptions {
  children: ReactNode;
  /** Classes on the outer box (margins, sizing). */
  className?: string;
  /** Classes on the scroller itself (padding, scroll snapping). */
  contentClassName?: string;
  style?: CSSProperties;
}

const emptySubscribe = () => () => {};

/**
 * Scrolls `children` sideways, bending the row's left and right edges. Hand it
 * one child that lays the row out (a `flex w-max` list); the row takes that
 * child's height, since a canvas cannot size itself from what it hosts.
 */
export function BendRow({
  children,
  className,
  contentClassName,
  style,
  ...options
}: BendRowProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<BendRowInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number | null>(null);

  const supported = useSyncExternalStore(emptySubscribe, supportsHtmlInCanvas, () => false);
  const native = supported && !failed;

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    // Without html-in-canvas there is nothing to draw: the plain scroller stands.
    if (!native || !source || !content || !output) return;
    instanceRef.current = createBendRow({ source, content, output }, initialOptions);
    if (!instanceRef.current) setFailed(true);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  // Inside the canvas the scroller is out of flow, so the row is sized to
  // the content it holds plus whatever the scroller's padding and scrollbar take.
  useLayoutEffect(() => {
    const content = contentRef.current;
    const inner = content?.firstElementChild;
    if (!native || !content || !inner) {
      setHeight(null);
      return;
    }
    const measure = () => {
      const styles = getComputedStyle(content);
      setHeight(
        (inner as HTMLElement).offsetHeight +
          Number.parseFloat(styles.paddingTop) +
          Number.parseFloat(styles.paddingBottom) +
          (content.offsetHeight - content.clientHeight)
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [native]);

  const scroller = (
    <div
      ref={contentRef}
      className={contentClassName}
      style={{
        position: 'relative',
        width: '100%',
        height: native ? '100%' : undefined,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {children}
    </div>
  );

  return (
    <div
      className={className}
      style={{ position: 'relative', ...(native && height !== null ? { height } : null), ...style }}
    >
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        suppressHydrationWarning
        style={
          native
            ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
            : { display: 'none' }
        }
      >
        {native ? scroller : null}
      </canvas>
      {native ? null : scroller}
      <canvas
        ref={outputRef}
        aria-hidden
        style={
          native
            ? {
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }
            : { display: 'none' }
        }
      />
    </div>
  );
}
