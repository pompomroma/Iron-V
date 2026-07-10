// Fixed-timestep simulation with interpolated, uncapped rendering.
//
//   update(fixedDt)            — deterministic combat logic at 60 Hz
//   render(visualDt, alpha)    — every display frame; visualDt is real frame
//                                time scaled by timeScale (for slow-mo VFX),
//                                alpha is the sim interpolation factor 0..1
export class GameLoop {
  constructor({ fixedDt = 1 / 60, update, render, frameBegin }) {
    this.fixedDt = fixedDt;
    this.update = update;
    this.render = render;
    this.frameBegin = frameBegin;   // gets raw dtMs (drives dynamic resolution)
    this.timeScale = 1;
    this._acc = 0;
    this._last = 0;
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

    const alpha = this._acc / this.fixedDt;
    this.render(dt, alpha);
  }
}
