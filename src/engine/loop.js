// Fixed-timestep simulation with interpolated rendering and a frame governor.
//
//   update(fixedDt)                  — deterministic combat logic at 60 Hz
//   render(visualDt, alpha, rawDt)   — on each RENDERED frame; visualDt is the
//                                      time since the last rendered frame scaled
//                                      by timeScale (slow-mo VFX), rawDt the
//                                      unscaled version, alpha the sim
//                                      interpolation factor 0..1
//   frameRendered(renderMs)          — fed to the dynamic-resolution monitor
//
// Governor: native refresh is the target — a 120/144/240 Hz display renders at
// its FULL rate so motion gets the maximum number of frames. The resolution
// scaler holds the native-refresh budget first (trading a little sharpness on
// devices that need it). Only as a LAST RESORT — when the scaler is already
// pinned at its floor AND frames stay catastrophically over budget for a long
// stretch — does rendering settle onto an even, still-high cadence (never below
// ~2/3 refresh) to convert an erratic judder into a smooth one. Sticky.
export class GameLoop {
  constructor({ fixedDt = 1 / 60, update, render, frameBegin, frameRendered, governor }) {
    this.fixedDt = fixedDt;
    this.update = update;
    this.render = render;
    this.frameBegin = frameBegin;         // every rAF, raw dtMs
    this.frameRendered = frameRendered;   // rendered frames only, ms since last render
    this.governor = governor || null;     // { getRefresh(), onGovern(fps) }
    this.timeScale = 1;
    this.renderTargetFps = 0;             // 0 = native refresh (ungoverned)
    this._acc = 0;
    this._last = 0;
    this._sinceRenderMs = 0;
    this._govMs = 0; this._govMiss = 0; this._govFrames = 0;
    this._running = false;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);

    let dtMs = now - this._last;
    this._last = now;
    if (dtMs > 100) dtMs = 100;          // tab-switch / hitch guard
    if (this.frameBegin) this.frameBegin(dtMs);

    const dt = (dtMs / 1000) * this.timeScale;
    this._acc += dt;

    let steps = 0;
    while (this._acc >= this.fixedDt && steps < 8) {
      this.update(this.fixedDt);
      this._acc -= this.fixedDt;
      steps++;
    }
    if (steps === 8) this._acc = 0;      // death-spiral guard

    // ---- frame governor ------------------------------------------------------
    // Default: never cap — render every vsync at native refresh. Only accumulate
    // toward a governed cadence when the resolution scaler is already exhausted
    // (can't lower res any further to help) and frames are CATASTROPHICALLY over
    // budget across a long window. Even then the fallback is a high even cadence,
    // not a hard halving.
    this._sinceRenderMs += dtMs;
    if (this.governor && !this.renderTargetFps) {
      const refresh = this.governor.getRefresh();
      const resExhausted = this.governor.atFloor ? this.governor.atFloor() : true;
      if (refresh > 90 && resExhausted) {
        this._govMs += dtMs; this._govFrames++;
        if (dtMs > (1000 / refresh) * 1.5) this._govMiss++;      // catastrophic only
        if (this._govMs > 4000) {                                // long observation window
          if (this._govMiss / this._govFrames > 0.6) {
            this.renderTargetFps = Math.max(72, Math.round(refresh * 2 / 3));
            this.governor.onGovern && this.governor.onGovern(this.renderTargetFps);
          }
          this._govMs = 0; this._govMiss = 0; this._govFrames = 0;
        }
      } else {
        this._govMs = 0; this._govMiss = 0; this._govFrames = 0;   // has headroom / res not yet exhausted
      }
    }
    if (this.renderTargetFps &&
        this._sinceRenderMs < 1000 / this.renderTargetFps - 0.5) {
      return;                            // sim advanced; skip this vsync's render
    }

    const renderMs = this._sinceRenderMs;
    this._sinceRenderMs = 0;
    if (this.frameRendered) this.frameRendered(renderMs);

    const alpha = this._acc / this.fixedDt;
    const rawDt = renderMs / 1000;
    this.render(rawDt * this.timeScale, alpha, rawDt);
  }
}
