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
// Governor: high-refresh displays (120 Hz+) that can't hold native refresh get
// an erratic 70–100 fps cadence that looks worse than a locked 60. When >40%
// of frames blow the native budget over ~2 s, rendering locks to refresh/2
// (sim still runs every rAF) — a perfectly even cadence, and the resolution
// scaler can then climb against the achievable budget. Sticky per session.
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
    this._sinceRenderMs += dtMs;
    if (this.governor && !this.renderTargetFps) {
      const refresh = this.governor.getRefresh();
      if (refresh > 90) {
        this._govMs += dtMs; this._govFrames++;
        if (dtMs > (1000 / refresh) * 1.15) this._govMiss++;
        if (this._govMs > 2000) {
          if (this._govMiss / this._govFrames > 0.4) {
            this.renderTargetFps = Math.max(60, Math.round(refresh / 2));
            this.governor.onGovern && this.governor.onGovern(this.renderTargetFps);
          }
          this._govMs = 0; this._govMiss = 0; this._govFrames = 0;
        }
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
