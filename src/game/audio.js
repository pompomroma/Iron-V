// Procedural WebAudio SFX — every sound is synthesized (noise bursts, tuned
// oscillators, FM bells). No audio files. The context unlocks on first user
// gesture (required on mobile browsers).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
    this._ambience = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startAmbience();
  }

  get t() { return this.ctx.currentTime; }

  _noise({ dur = 0.2, filter = 'bandpass', freq = 1000, q = 1, gain = 0.5,
           attack = 0.002, sweepTo = null, when = 0 }) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), this.t + when + dur);
    const g = this.ctx.createGain();
    const t0 = this.t + when;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  _tone({ type = 'sine', freq = 200, dur = 0.2, gain = 0.4, sweepTo = null,
          attack = 0.002, when = 0 }) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const t0 = this.t + when;
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ---- game sounds -----------------------------------------------------------
  whoosh(heavy = false) {
    this._noise({ dur: heavy ? 0.3 : 0.16, filter: 'bandpass', freq: heavy ? 500 : 900, sweepTo: heavy ? 2600 : 2100, q: 1.6, gain: 0.34 });
  }
  hit(heavy = false, counter = false) {
    this._noise({ dur: 0.1, filter: 'lowpass', freq: 3200, gain: 0.85 });
    this._tone({ type: 'sine', freq: heavy ? 150 : 210, sweepTo: heavy ? 46 : 70, dur: heavy ? 0.3 : 0.16, gain: 0.95 });
    if (heavy) this._noise({ dur: 0.34, filter: 'lowpass', freq: 700, gain: 0.5, when: 0.01 });
    if (counter) this._tone({ type: 'triangle', freq: 1180, sweepTo: 1660, dur: 0.22, gain: 0.3, when: 0.02 });
  }
  blocked() {
    this._tone({ type: 'square', freq: 320, sweepTo: 160, dur: 0.1, gain: 0.22 });
    this._noise({ dur: 0.12, filter: 'highpass', freq: 2400, gain: 0.3 });
  }
  guardCrack() {
    this._noise({ dur: 0.3, filter: 'bandpass', freq: 3000, sweepTo: 700, q: 2.5, gain: 0.7 });
    this._tone({ type: 'sawtooth', freq: 500, sweepTo: 90, dur: 0.4, gain: 0.4 });
    for (let i = 0; i < 5; i++) {
      this._tone({ type: 'sine', freq: 1900 - i * 260, dur: 0.14, gain: 0.16, when: 0.03 + i * 0.045 });
    }
  }
  dash() {
    this._noise({ dur: 0.22, filter: 'bandpass', freq: 2600, sweepTo: 500, q: 1.1, gain: 0.3 });
  }
  dodge() {
    this._noise({ dur: 0.18, filter: 'bandpass', freq: 3400, sweepTo: 1200, q: 3, gain: 0.22 });
  }
  feint() {
    this._noise({ dur: 0.1, filter: 'bandpass', freq: 1500, sweepTo: 2600, q: 2, gain: 0.2 });
  }
  noStamina() {
    this._tone({ type: 'square', freq: 150, dur: 0.09, gain: 0.12 });
  }
  bell(times = 1) {
    for (let i = 0; i < times; i++) {
      const w = i * 0.42;
      this._tone({ type: 'sine', freq: 1180, dur: 1.1, gain: 0.4, when: w });
      this._tone({ type: 'sine', freq: 1770, dur: 0.8, gain: 0.18, when: w });
      this._tone({ type: 'sine', freq: 592, dur: 1.3, gain: 0.22, when: w });
    }
  }
  ko() {
    this._tone({ type: 'sine', freq: 210, sweepTo: 34, dur: 0.9, gain: 1.0 });
    this._noise({ dur: 0.5, filter: 'lowpass', freq: 900, gain: 0.6 });
    this._noise({ dur: 1.1, filter: 'bandpass', freq: 500, sweepTo: 90, q: 1, gain: 0.3, when: 0.05 });
  }
  ultCharge() {
    this._noise({ dur: 1.15, filter: 'bandpass', freq: 300, sweepTo: 3400, q: 3, gain: 0.34 });
    this._tone({ type: 'sawtooth', freq: 70, sweepTo: 420, dur: 1.15, gain: 0.16 });
  }
  // pitched energy riser for the charge beats + final windup
  ultRiser() {
    this._noise({ dur: 0.5, filter: 'bandpass', freq: 520, sweepTo: 4200, q: 4, gain: 0.2 });
    this._tone({ type: 'sawtooth', freq: 190, sweepTo: 940, dur: 0.5, gain: 0.12 });
  }
  // blitz whoosh as the attacker closes the gap
  ultRush() {
    this._noise({ dur: 0.34, filter: 'bandpass', freq: 900, sweepTo: 220, q: 1.2, gain: 0.42 });
    this._tone({ type: 'sawtooth', freq: 460, sweepTo: 80, dur: 0.32, gain: 0.2 });
  }
  ultImpact() {
    this.hit(true);
    this._tone({ type: 'sine', freq: 90, sweepTo: 30, dur: 0.5, gain: 0.9, when: 0.01 });
  }
  ultFinal() {
    this._noise({ dur: 0.16, filter: 'lowpass', freq: 4000, gain: 1 });
    this._tone({ type: 'sine', freq: 170, sweepTo: 26, dur: 1.2, gain: 1.1 });
    this._tone({ type: 'sine', freq: 62, sweepTo: 20, dur: 1.5, gain: 0.95, when: 0.02 });   // deep sub boom
    this._noise({ dur: 1.4, filter: 'lowpass', freq: 500, gain: 0.5, when: 0.04 });
    this._noise({ dur: 0.3, filter: 'highpass', freq: 3000, gain: 0.42 });                    // bright crack
    this._tone({ type: 'triangle', freq: 1500, sweepTo: 2400, dur: 0.5, gain: 0.14, when: 0.02 });
  }
  perfectDodge() {
    // deep presence: sub boom + airy riser + a glassy ping on top
    this._tone({ type: 'sine', freq: 120, sweepTo: 30, dur: 0.7, gain: 0.9 });
    this._noise({ dur: 0.6, filter: 'bandpass', freq: 400, sweepTo: 3800, q: 2.2, gain: 0.22, when: 0.02 });
    this._tone({ type: 'sine', freq: 1560, dur: 0.5, gain: 0.2, when: 0.1 });
    this._tone({ type: 'sine', freq: 2340, dur: 0.35, gain: 0.09, when: 0.12 });
  }
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      this._tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.22, when: i * 0.13 }));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) =>
      this._tone({ type: 'triangle', freq: f, dur: 0.55, gain: 0.2, when: i * 0.16 }));
  }
  uiTick() {
    this._tone({ type: 'triangle', freq: 900, dur: 0.06, gain: 0.14 });
  }

  _startAmbience() {
    // low desert-wind bed: filtered noise with a slow LFO on the filter
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 0.7;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    this._ambience = { src, lfo };
  }
}
