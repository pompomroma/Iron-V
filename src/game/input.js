// Keyboard + touch input, aggregated into one intent per sim tick.
// Presses are edge-buffered between ticks so nothing is dropped at low FPS.

export class InputSystem {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this._down = new Set();
    this._edgeQueue = [];           // ordered presses since last tick
    this.joy = { x: 0, y: 0, active: false };
    this._touchBlock = false;
    this.onAnyInput = null;         // audio unlock / menu advance hook

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._down.add(e.code);
      this._edgeQueue.push(e.code);
      this._fireAny();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this._down.delete(e.code));
    addEventListener('blur', () => { this._down.clear(); this.joy.x = this.joy.y = 0; this._touchBlock = false; });
  }

  _fireAny() { this.onAnyInput && this.onAnyInput(); }

  // Wire the on-screen controls. Call once the DOM exists.
  bindTouch(els) {
    const { zone, base, knob, btnLight, btnHeavy, btnBlock, btnDash, btnUlt } = els;

    // --- dynamic joystick: appears wherever the thumb lands on the left half
    const R = 56;                     // knob travel radius (px)
    let joyId = null, cx = 0, cy = 0;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (joyId !== null) return;
      joyId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
      cx = e.clientX; cy = e.clientY;
      base.style.left = cx + 'px'; base.style.top = cy + 'px';
      base.classList.add('on');
      this.joy.active = true;
      setKnob(0, 0);
      this._fireAny();
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      setKnob(dx, dy);
      this.joy.x = dx / R;
      this.joy.y = -dy / R;           // screen-up = approach
    });
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.joy.x = this.joy.y = 0;
      this.joy.active = false;
      base.classList.remove('on');
    };
    zone.addEventListener('pointerup', joyEnd);
    zone.addEventListener('pointercancel', joyEnd);

    // --- action buttons
    const bindBtn = (el, onDown, onUp) => {
      el.addEventListener('pointerdown', (e) => {
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
        el.classList.add('pressed');
        onDown();
        this._fireAny();
        e.preventDefault();
      });
      const up = () => { el.classList.remove('pressed'); onUp && onUp(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    bindBtn(btnLight, () => this._edgeQueue.push('KeyK'));
    bindBtn(btnHeavy, () => this._edgeQueue.push('KeyL'));
    bindBtn(btnDash, () => this._edgeQueue.push('Space'));
    bindBtn(btnUlt, () => this._edgeQueue.push('KeyQ'));
    bindBtn(btnBlock, () => { this._touchBlock = true; }, () => { this._touchBlock = false; });
  }

  // Consume buffered input → one intent (call exactly once per sim tick).
  //
  // Attack presses are released one per tick, in press order. If K and L both
  // arrive between two ticks (fast feint on a slow frame), the first starts
  // the punch this tick and the second cancels it into the other punch on the
  // NEXT tick — so feint switches survive any frame rate.
  readIntent() {
    const d = this._down;
    let moveX = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    let moveY = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    if (this.joy.active) {
      moveX = Math.abs(this.joy.x) > 0.14 ? this.joy.x : 0;   // tighter deadzone → reacts sooner
      moveY = Math.abs(this.joy.y) > 0.14 ? this.joy.y : 0;
    }
    const intent = {
      moveX, moveY,
      light: false, heavy: false, dash: false, ult: false,
      block: d.has('KeyF') || this._touchBlock,
    };
    let attackTaken = false;
    const deferred = [];
    for (const code of this._edgeQueue) {
      const isAttack = code === 'KeyK' || code === 'KeyL';
      if (isAttack && attackTaken) { deferred.push(code); continue; }
      if (code === 'KeyK') { intent.light = true; attackTaken = true; }
      else if (code === 'KeyL') { intent.heavy = true; attackTaken = true; }
      else if (code === 'Space') intent.dash = true;
      else if (code === 'KeyQ') intent.ult = true;
    }
    this._edgeQueue = deferred;
    return intent;
  }

  // consume a pending press (used by menus)
  consumeKey(code) {
    const i = this._edgeQueue.indexOf(code);
    if (i === -1) return false;
    this._edgeQueue.splice(i, 1);
    return true;
  }

  // Getting hit wipes any punches queued before the impact — you can't
  // "attack through" a hit. Buffered dashes are kept (escape option).
  clearAttackBuffer() {
    this._edgeQueue = this._edgeQueue.filter((c) => c !== 'KeyK' && c !== 'KeyL' && c !== 'KeyQ');
  }
}
