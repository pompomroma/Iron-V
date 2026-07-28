import * as THREE from 'three';

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const randRange = (a, b) => a + Math.random() * (b - a);
export const randPick = (arr) => arr[(Math.random() * arr.length) | 0];

// Frame-rate independent exponential smoothing.
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
export const angleDamp = (a, b, lambda, dt) =>
  angleLerp(a, b, 1 - Math.exp(-lambda * dt));

export const smoothstep = (t) => t * t * (3 - 2 * t);

export const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inQuart: (t) => t * t * t * t,
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
  },
};

// Beveled box: BoxGeometry vertices pushed onto a rounded-corner shell.
// Gives the soft "premium blocky" look without importing example modules.
export function roundedBoxGeometry(w, h, d, radius, segments = 3) {
  radius = Math.min(radius, w / 2, h / 2, d / 2);
  const geo = new THREE.BoxGeometry(w, h, d, segments, segments, segments);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - radius, h / 2 - radius, d / 2 - radius);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = clamp(v.x, -inner.x, inner.x);
    const cy = clamp(v.y, -inner.y, inner.y);
    const cz = clamp(v.z, -inner.z, inner.z);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const s = radius / len;
      v.set(cx + dx * s, cy + dy * s, cz + dz * s);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function canvasTexture(w, h, draw, { colorSpace = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (colorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Merge non-indexed position+normal geometries (with transforms already
// baked in) into one BufferGeometry — collapses dozens of static meshes
// into a single draw call.
export function mergeGeometries(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off);
    norm.set(g.attributes.normal.array, off);
    off += g.attributes.position.count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

// 1D value-noise (for camera shake / sway) — cheap and smooth.
export function makeNoise1D(seed = 1) {
  const rand = mulberry32(seed);
  const grads = new Float32Array(256);
  for (let i = 0; i < 256; i++) grads[i] = rand() * 2 - 1;
  return (x) => {
    const i0 = Math.floor(x), f = x - i0;
    const g0 = grads[i0 & 255], g1 = grads[(i0 + 1) & 255];
    return lerp(g0, g1, smoothstep(f));
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
