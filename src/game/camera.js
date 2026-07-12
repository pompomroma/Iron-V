import * as THREE from 'three';
import { damp, clamp, makeNoise1D } from '../engine/utils.js?v=5';

// ---------------------------------------------------------------------------
// Lock-on shoulder camera.
//
// Anchored behind-right of the player's right shoulder, slightly above head
// height with a very slight downward pitch. The camera's yaw is driven
// entirely by the player→opponent direction, so as the opponent circles, the
// camera orbits ("rolls") with them and the opponent's front stays dead
// center on screen at all times.
// ---------------------------------------------------------------------------

const BACK = 3.9;           // distance behind the player
const SIDE = 1.34;          // offset to the right of the right shoulder
const HEIGHT = 2.72;        // camera height (player is ~2.06 tall)
const LOOK_HEIGHT = 1.3;    // aim at the opponent's upper chest → slight down pitch

export class FightCamera {
  constructor(camera) {
    this.cam = camera;
    this.player = null;
    this.opponent = null;

    this._pos = new THREE.Vector3(0, HEIGHT, -6);
    this._look = new THREE.Vector3(0, 1.4, 0);
    this._trauma = 0;
    this._fovKick = 0;
    this._rollKick = 0;
    this._noise = [makeNoise1D(1), makeNoise1D(7), makeNoise1D(13)];
    this._t = 0;
    this._roll = 0;
    this._prevOppX = null;
    this.override = null;      // fn(cam, rdt, t) — cinematics take full control
    this.baseFov = 58;
  }

  follow(player, opponent) { this.player = player; this.opponent = opponent; }

  addShake(amount) { this._trauma = Math.min(1, this._trauma + amount); }
  fovKick(amount) { this._fovKick = amount; }
  rollKick(amount) { this._rollKick = amount; }   // brief horizon tilt (dashes)

  snap() {
    // hard-set to the ideal shoulder position (round start / after cinematic)
    const { pos, look } = this._ideal();
    this._pos.copy(pos);
    this._look.copy(look);
    this._apply(0);
  }

  _ideal() {
    // scratch vectors — this runs every frame, no allocation allowed
    const p = this.player.avatar.group.position;
    const o = this.opponent.avatar.group.position;
    const f = _f.set(o.x - p.x, 0, o.z - p.z);
    const dist = Math.max(f.length(), 0.001);
    f.divideScalar(dist);
    const back = BACK + clamp(dist - 3, 0, 8) * 0.09;       // subtle pullback when far apart

    // character right = (-f.z, 0, f.x)
    const pos = _idealPos.set(
      p.x - f.x * back + -f.z * SIDE,
      HEIGHT,
      p.z - f.z * back + f.x * SIDE
    );
    const look = _idealLook.set(o.x, LOOK_HEIGHT, o.z);
    return { pos, look, dist };
  }

  update(rdt) {
    this._t += rdt;
    const cam = this.cam;

    if (this.override) {
      this.override(cam, rdt, this._t);
      // keep the smoothing state glued to wherever the cinematic left us so
      // the hand-back glides instead of popping
      this._pos.copy(cam.position);
      this._look.copy(_lookProbe(cam));
      return;
    }
    if (!this.player) return;

    // gentle damping — the lock stays centered but direction changes glide
    // (snappier values make every opponent micro-move yank the whole view)
    const { pos, look } = this._ideal();
    this._pos.x = damp(this._pos.x, pos.x, 8.5, rdt);
    this._pos.y = damp(this._pos.y, pos.y, 8.5, rdt);
    this._pos.z = damp(this._pos.z, pos.z, 8.5, rdt);
    this._look.x = damp(this._look.x, look.x, 9.5, rdt);
    this._look.y = damp(this._look.y, look.y, 9.5, rdt);
    this._look.z = damp(this._look.z, look.z, 9.5, rdt);

    // subtle roll bank while the opponent strafes across the screen
    const oppX = this.opponent.avatar.group.position.x + this.opponent.avatar.group.position.z * 0.0001;
    const lateral = this._prevOppX === null ? 0 : (oppX - this._prevOppX) / Math.max(rdt, 1e-4);
    this._prevOppX = oppX;
    this._roll = damp(this._roll, clamp(lateral * 0.004, -0.022, 0.022), 3, rdt);

    this._apply(rdt);
  }

  _apply(rdt) {
    const cam = this.cam;
    // trauma shake
    this._trauma = Math.max(0, this._trauma - rdt * 2.4);
    const sh = this._trauma * this._trauma;
    const n = this._noise;
    const t = this._t * 26;
    const ox = n[0](t) * 0.24 * sh;
    const oy = n[1](t) * 0.2 * sh;
    const oroll = n[2](t) * 0.05 * sh;

    this._rollKick = damp(this._rollKick, 0, 6, rdt);
    const roll = this._roll + this._rollKick + oroll;
    cam.position.set(this._pos.x + ox, Math.max(this._pos.y + oy, 0.3), this._pos.z + ox * 0.5);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(this._look);

    // fov kicks decay
    this._fovKick = damp(this._fovKick, 0, 7, rdt);
    const wanted = this.baseFov + this._fovKick;
    if (Math.abs(cam.fov - wanted) > 0.01) {
      cam.fov = wanted;
      cam.updateProjectionMatrix();
    }
  }

  setAspect(aspect) {
    // widen on tall/portrait screens so both fighters stay readable
    this.baseFov = aspect < 0.75 ? 72 : aspect < 1.1 ? 64 : 58;
  }
}

const _f = new THREE.Vector3();
const _idealPos = new THREE.Vector3();
const _idealLook = new THREE.Vector3();
const _probe = new THREE.Vector3();
function _lookProbe(cam) {
  cam.getWorldDirection(_probe);
  return _probe.multiplyScalar(5).add(cam.position);
}
