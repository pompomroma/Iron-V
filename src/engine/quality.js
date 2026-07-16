import { clamp } from './utils.js?v=12';

// ---------------------------------------------------------------------------
// Device tier detection + real-time dynamic resolution.
//
// Goal: hold the display's native refresh rate everywhere. Average phones get
// a sensible pixel-ratio window; desktops with real GPUs get full DPR and the
// HIGH feature tier (bigger shadows, more particles). A rolling frame-time
// monitor then fine-tunes render resolution inside the tier's window.
// ---------------------------------------------------------------------------

export function detectTier() {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;

  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '';
    }
  } catch (_) { /* tier falls back to heuristics */ }
  const g = gpu.toLowerCase();

  const discrete = /nvidia|geforce|rtx|gtx|radeon(?! r[2-5])|rx \d{3,4}|arc(\s|™)/.test(g);
  const appleDesktop = /apple m\d/.test(g) && !isTouch;
  const weak = /mali-[gt]?[0-7]\d\b|adreno \(tm\) [1-5]\d\d\b|powervr|swiftshader|llvmpipe/.test(g);

  let name;
  if (!isTouch && (discrete || appleDesktop || (mem >= 8 && cores >= 8))) name = 'HIGH';
  else if (weak || mem <= 3 || cores <= 4) name = 'LOW';
  else name = 'MED';

  const dpr = window.devicePixelRatio || 1;
  const tiers = {
    // maxPR = the sharpness ceiling; the scaler starts here and only backs off
    // when frames blow budget, so capable devices render at full native DPR.
    LOW:  { shadow: 1024, maxPR: Math.min(dpr, 2.0), minPR: 0.75, particles: 0.5, dust: false, antialias: false, softShadow: false, floorSeg: 64 },
    MED:  { shadow: 2048, maxPR: dpr,                minPR: 0.9,  particles: 1.0, dust: true,  antialias: true,  softShadow: true,  floorSeg: 96 },
    HIGH: { shadow: 2048, maxPR: dpr,                minPR: 1.0,  particles: 1.6, dust: true,  antialias: true,  softShadow: true,  floorSeg: 96 },
  };
  return { name, isTouch, gpu, ...tiers[name] };
}

export class DynamicResolution {
  constructor(renderer, tier, onChange) {
    this.renderer = renderer;
    this.tier = tier;
    this.onChange = onChange;
    // start at the sharpness ceiling — only back off if frames can't hold it
    this.scale = tier.maxPR;
    this.emaFrame = 16.7;
    this.refresh = 60;          // estimated display Hz
    this.targetFps = 0;         // set by the frame governor (0 = native refresh)
    this._samples = [];
    this._calibrated = false;
    this._holdTimer = 0;
    this.fps = 60;
    this._fpsAccum = 0; this._fpsCount = 0;
    renderer.setPixelRatio(this.scale);
  }

  // Call once per rAF with the raw frame delta in ms.
  frame(dtMs) {
    if (dtMs <= 0 || dtMs > 250) return;

    // FPS readout (0.5s buckets)
    this._fpsAccum += dtMs; this._fpsCount++;
    if (this._fpsAccum >= 500) {
      this.fps = Math.round(1000 * this._fpsCount / this._fpsAccum);
      this._fpsAccum = 0; this._fpsCount = 0;
    }

    // Estimate native refresh from the first ~40 clean frames.
    if (!this._calibrated) {
      this._samples.push(dtMs);
      if (this._samples.length >= 40) {
        const sorted = [...this._samples].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        const hz = 1000 / median;
        const known = [60, 75, 90, 120, 144, 165, 240];
        this.refresh = known.reduce((p, c) => Math.abs(c - hz) < Math.abs(p - hz) ? c : p, 60);
        if (hz > 250) this.refresh = 240;
        this._calibrated = true;
      }
      return;
    }

    this.emaFrame = this.emaFrame * 0.92 + dtMs * 0.08;
    this._holdTimer += dtMs;
    if (this._holdTimer < 450) return;   // evaluate ~2×/second
    this._holdTimer = 0;

    // Hysteresis: HOLD resolution for sharpness — only drop it on a sizable,
    // sustained overload (sharpness is preferred over squeezing out the last
    // frames; the relaxed governor keeps the framerate uncapped meanwhile).
    // Every setPixelRatio() reallocates the drawing buffer, so grow only after
    // sustained headroom — oscillating around a threshold reads as stutter.
    const budget = 1000 / (this.targetFps || this.refresh);
    this._stable = this._stable || 0;
    let next = this.scale;

    if (this.emaFrame > budget * 1.4) {
      next = this.scale * 0.85;                        // shrink only on a real overload
      this._stable = 0;
    } else if (this.emaFrame < budget * 0.82) {
      this._stable++;
      if (this._stable >= 3) {                         // ~1.5s headroom → climb back to max quickly
        next = this.scale * (this.emaFrame < budget * 0.6 ? 1.18 : 1.09);
        this._stable = 0;
      }
    } else {
      this._stable = 0;                                // in the comfort band
    }

    // quantize to 0.05 steps so near-identical sizes don't thrash the buffer
    next = clamp(Math.round(next * 20) / 20, this.tier.minPR, this.tier.maxPR);

    if (Math.abs(next - this.scale) >= 0.04) {
      this.scale = next;
      this.renderer.setPixelRatio(this.scale);
      this._holdTimer = -1000;                         // extra settle time after a change
      this.onChange && this.onChange(this.scale);
    }
  }
}
