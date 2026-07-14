import * as THREE from 'three';
import { ULT, PDODGE } from './constants.js?v=8';
import { clamp01, lerp, EASE, TAU } from '../engine/utils.js?v=8';

// ---------------------------------------------------------------------------
// Ultimate cutscene: an in-engine, letterboxed, multi-cut action sequence.
//
//   cut 1  (0.0–1.1)  low orbit around the attacker charging up
//   cut 2  (1.1–3.0)  side profile: blitz rush + slow-mo punch flurry
//   cut 3  (3.0–3.9)  reverse over-victim angle: the final blow winds up
//   cut 4  (3.9–5.2)  impact — white flash, victim launched, dust, hand-back
//
// The cinematic owns both fighters' positions/animations and the camera while
// active; time inside it ramps (slow-mo) independently of the sim clock.
// Damage is streamed via onDamage so HP bars drain live on screen.
// ---------------------------------------------------------------------------

export class UltimateCinematic {
  constructor({ fightCam, effects, audio, hud }) {
    this.fightCam = fightCam;
    this.effects = effects;
    this.audio = audio;
    this.hud = hud;
    this.active = false;
  }

  start(attacker, victim, { onDamage, onDone }) {
    this.active = true;
    this.att = attacker;
    this.vic = victim;
    this.onDamage = onDamage;
    this.onDone = onDone;
    this.t = 0;
    this._hits = 0;
    this._nextHit = 1.25;
    this._finalDone = false;
    this._rushed = false;
    this._cut3Started = false;

    attacker.setCinematic(true);
    victim.setCinematic(true);
    attacker.anim.play('ultCharge', { duration: 1.15, blend: 0.14 });
    victim.anim.play('block', { duration: 1.2, blend: 0.2 });

    // pin the axis of the sequence
    this.dir = new THREE.Vector2().subVectors(victim.pos, attacker.pos).normalize();
    this.a0 = attacker.pos.clone();
    this.v0 = victim.pos.clone();
    this.mid = new THREE.Vector2().addVectors(attacker.pos, victim.pos).multiplyScalar(0.5);

    this.hud.letterbox(true);
    this.audio.ultCharge();
    this.effects.setAura(attacker, true);
    this.fightCam.override = (cam, rdt) => this._camera(cam, rdt);
  }

  _setPos(f, x, z) {
    f.pos.set(x, z);
    f.prevPos.set(x, z);
  }

  update(rdt) {
    if (!this.active) return;
    // dramatic time ramp: normal → slow through the flurry → snap back
    const rate = this.t < 1.1 ? 1 : this.t < 3.0 ? 0.62 : this.t < 3.9 ? 0.7 : 1;
    this.t += rdt * rate;
    const t = this.t;
    const att = this.att, vic = this.vic;
    const dir = this.dir;

    // both stare each other down the whole time
    att.facing = Math.atan2(vic.pos.x - att.pos.x, vic.pos.y - att.pos.y);
    vic.facing = Math.atan2(att.pos.x - vic.pos.x, att.pos.y - vic.pos.y);
    att.prevFacing = att.facing; vic.prevFacing = vic.facing;

    // ---- rush in --------------------------------------------------------------
    if (t >= 1.1 && !this._rushed) {
      this._rushed = true;
      this.hud.flash(0.5, 120);
      this.audio.dash();
      this.effects.dashGhosts(att);
      this.effects.setAura(att, false);
      att._cineTrails = true;
    }
    if (t >= 1.1 && t < 1.35) {
      const u = EASE.outQuart(clamp01((t - 1.1) / 0.25));
      const target = new THREE.Vector2().copy(this.v0).addScaledVector(dir, -1.45);
      this._setPos(att,
        lerp(this.a0.x, target.x, u),
        lerp(this.a0.y, target.y, u));
    }

    // ---- flurry ---------------------------------------------------------------
    if (t >= 1.35 && t < 3.0 && t >= this._nextHit) {
      this._nextHit = t + 0.21;
      this._hits++;
      const side = this._hits % 2 === 0 ? 'L' : 'R';
      att.anim.play('ultFlurry' + side, { duration: 0.24, blend: 0.05 });
      vic.anim.play(this._hits % 2 === 0 ? 'hitLight' : 'hitHeavy', { duration: 0.3, blend: 0.05 });
      const chest = vic.avatar.group.position.clone().setY(1.35);
      this.effects.impact(chest, att.avatar.palette.accent, this._hits % 3 === 0);
      this.audio.ultImpact();
      this.fightCam.addShake(0.36);
      this.onDamage(ULT.DAMAGE * 0.62 / 8, false);
      // victim gets rocked backward a touch each hit
      this._setPos(vic, vic.pos.x + dir.x * 0.12, vic.pos.y + dir.y * 0.12);
      const gap = new THREE.Vector2().subVectors(vic.pos, att.pos);
      if (gap.length() > 1.6) this._setPos(att, vic.pos.x - dir.x * 1.45, vic.pos.y - dir.y * 1.45);
    }

    // ---- final windup ----------------------------------------------------------
    if (t >= 3.0 && !this._cut3Started) {
      this._cut3Started = true;
      att._cineTrails = false;
      att.anim.play('ultFinal', { duration: 1.05, blend: 0.12 });
      vic.anim.play('stunned', { duration: 1.0, blend: 0.2 });
      this.audio.ultCharge();
      this.effects.setAura(att, true);
      att.avatar.setGloveGlow(1);
    }

    // ---- the blow ---------------------------------------------------------------
    if (t >= 3.9 && !this._finalDone) {
      this._finalDone = true;
      this.effects.setAura(att, false);
      att.avatar.setGloveGlow(0);
      this.hud.flash(0.95, 200);
      this.audio.ultFinal();
      const chest = vic.avatar.group.position.clone().setY(1.5);
      this.effects.impact(chest, 0xffffff, true);
      this.effects.koBurst(chest);
      this.fightCam.addShake(1.0);
      this.onDamage(ULT.DAMAGE * 0.38, true);
      vic.anim.play('ko', { duration: 1.3, blend: 0.05 });
    }
    if (t >= 3.9 && t < 4.75) {
      // victim launched, skidding away
      const u = EASE.outCubic(clamp01((t - 3.9) / 0.85));
      const from = this._vLaunch || (this._vLaunch = this.vic.pos.clone());
      this._setPos(vic, from.x + dir.x * 5.2 * u, from.y + dir.y * 5.2 * u);
      if (Math.random() < 0.4) this.effects.groundDust(new THREE.Vector3(vic.pos.x, 0, vic.pos.y), 2.5);
    }

    // ---- wrap up -----------------------------------------------------------------
    if (t >= 4.75) this.hud.letterbox(false);
    if (t >= 5.2) this._finish();
  }

  _finish() {
    this.active = false;
    this.att._cineTrails = false;
    this.effects.setAura(this.att, false);
    this.fightCam.override = null;       // FightCamera glides back on its own
    this._vLaunch = null;
    this.onDone();
  }

  // ---- camera script -------------------------------------------------------------
  _camera(cam, rdt) {
    const t = this.t;
    const A = this.att.avatar.group.position;
    const V = this.vic.avatar.group.position;
    const dir3 = new THREE.Vector3(this.dir.x, 0, this.dir.y);
    const side3 = new THREE.Vector3(-dir3.z, 0, dir3.x);

    let pos = new THREE.Vector3(), look = new THREE.Vector3();

    if (t < 1.1) {
      // cut 1: low arc orbit around the charging attacker
      const u = EASE.inOutCubic(clamp01(t / 1.1));
      const ang = Math.atan2(-dir3.x, -dir3.z) + lerp(-0.9, 0.55, u);
      const r = lerp(3.1, 2.3, u);
      pos.set(A.x + Math.sin(ang) * r, lerp(0.7, 1.6, u), A.z + Math.cos(ang) * r);
      look.set(A.x, 1.25, A.z);
    } else if (t < 3.0) {
      // cut 2: side profile tracking the flurry, slow push-in
      const u = clamp01((t - 1.1) / 1.9);
      const mid = new THREE.Vector3().addVectors(A, V).multiplyScalar(0.5);
      const r = lerp(4.6, 3.6, EASE.outQuad(u));
      pos.copy(mid).addScaledVector(side3, r).setY(lerp(1.35, 1.6, u));
      look.copy(mid).setY(1.3);
    } else if (t < 3.9) {
      // cut 3: reverse angle over the victim's shoulder, dolly toward the fist
      const u = EASE.outQuad(clamp01((t - 3.0) / 0.9));
      pos.copy(V).addScaledVector(dir3, lerp(1.9, 1.45, u))
        .addScaledVector(side3, -0.85)
        .setY(lerp(1.7, 1.5, u));
      look.copy(A).setY(1.4);
    } else {
      // cut 4: wide shot whipping with the launched victim
      const u = clamp01((t - 3.9) / 1.3);
      pos.copy(A).addScaledVector(side3, 5.4).addScaledVector(dir3, lerp(0.4, 2.6, EASE.outCubic(u)))
        .setY(lerp(1.4, 2.2, u));
      look.copy(V).setY(1.0);
    }

    cam.up.set(0, 1, 0);
    cam.position.copy(pos);
    cam.lookAt(look);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
  }
}

// ---------------------------------------------------------------------------
// Perfect-dodge cutscene (~1.85s): the attacker's punch whiffs in heavy
// slow-mo while the dodger ghost-dashes around behind them, then a tight
// close-up — the attacker's face front-on in the foreground, the dodger
// looming over their shoulder — before combat snaps back with the attacker
// stunned and still facing the wrong way.
// ---------------------------------------------------------------------------
export class PerfectDodgeCinematic {
  constructor({ fightCam, effects, audio, hud }) {
    this.fightCam = fightCam;
    this.effects = effects;
    this.audio = audio;
    this.hud = hud;
    this.active = false;
  }

  start(dodger, attacker, { onDone }) {
    this.active = true;
    this.dod = dodger;
    this.att = attacker;
    this.onDone = onDone;
    this.t = 0;
    this._cut2 = false;
    this._flashed = false;

    dodger.setCinematic(true);
    attacker.setCinematic(true);

    // pin geometry: attacker keeps facing where the dodger USED to be
    this.attFacing = attacker.facing;
    this.f = new THREE.Vector2(Math.sin(attacker.facing), Math.cos(attacker.facing));
    this.a0 = attacker.pos.clone();
    this.d0 = dodger.pos.clone();
    // land behind the attacker, offset to the far side of the close-up camera
    // so the dodger's head looms over the attacker's shoulder
    const side = new THREE.Vector2(-this.f.y, this.f.x);
    this.dEnd = attacker.pos.clone()
      .addScaledVector(this.f, -PDODGE.BEHIND_DIST)
      .addScaledVector(side, -0.42);

    // attacker holds a whiffed full extension; dodger is mid-dash
    attacker.anim.play('ultFlurryR', { duration: 1.4, blend: 0.05, speed: 0.5 });
    dodger.anim.play('dashF', { duration: 0.5, blend: 0.05 });
    this.effects.dashGhosts(dodger);

    this.hud.letterbox(true);
    this.audio.dash();
    this.fightCam.override = (cam, rdt) => this._camera(cam);
  }

  _setPos(fh, x, z) { fh.pos.set(x, z); fh.prevPos.set(x, z); }

  update(rdt) {
    if (!this.active) return;
    // deep slow-mo through the whiff, easing back for the close-up
    const rate = this.t < 0.45 ? 0.4 : 1;
    this.t += rdt * rate;
    const t = this.t;
    const att = this.att, dod = this.dod;

    // attacker never turns — that's the whole point
    att.facing = this.attFacing; att.prevFacing = att.facing;

    if (t < 0.45) {
      // dodger arcs around the attacker to the spot behind them
      const u = EASE.inOutCubic(clamp01(t / 0.45));
      const side = new THREE.Vector2(-this.f.y, this.f.x);
      const mid = this.a0.clone().addScaledVector(side, 1.4);   // swing wide
      const p = bezier2(this.d0, mid, this.dEnd, u);
      this._setPos(dod, p.x, p.y);
      dod.facing = Math.atan2(att.pos.x - dod.pos.x, att.pos.y - dod.pos.y);
      dod.prevFacing = dod.facing;
      if (Math.random() < 0.5) {
        this.effects.groundDust(new THREE.Vector3(dod.pos.x, 0, dod.pos.y), 2);
      }
    } else if (!this._cut2) {
      this._cut2 = true;
      // THE shot: attacker face foreground, dodger looming behind
      this._setPos(dod, this.dEnd.x, this.dEnd.y);
      dod.facing = this.attFacing; dod.prevFacing = dod.facing;  // stares at their back
      dod.anim.play('idle', { duration: 1.4, blend: 0.14 });
      att.anim.play('blockHit', { duration: 0.5, blend: 0.08 }); // startled flinch
      this.audio.perfectDodge();
      this.hud.popupSide('PERFECT DODGE!', 'perfect');
    }

    if (t >= 1.5 && !this._flashed) {
      this._flashed = true;
      this.hud.flash(0.4, 100);
      this.hud.letterbox(false);
    }
    if (t >= 1.85) this._finish();
  }

  _finish() {
    this.active = false;
    this.fightCam.override = null;      // shoulder camera glides back
    this.onDone();
  }

  _camera(cam) {
    const t = this.t;
    const A = this.att.avatar.group.position;
    const D = this.dod.avatar.group.position;
    const f3 = new THREE.Vector3(this.f.x, 0, this.f.y);
    // "in front of the attacker" is derived from the real attacker→dodger
    // axis so the attacker's face reliably faces camera regardless of setup
    const toA = new THREE.Vector3(A.x - D.x, 0, A.z - D.z);
    if (toA.lengthSq() < 1e-4) toA.copy(f3);
    toA.normalize();
    const side3 = new THREE.Vector3(-toA.z, 0, toA.x);
    let fov = 50;

    if (t < 0.45) {
      // side-on wide: the punch sails through empty space
      const u = clamp01(t / 0.45);
      _pPos.set(A.x, 1.5, A.z).addScaledVector(side3, -3.8).addScaledVector(f3, lerp(0.6, 0.2, u));
      _pLook.set(A.x, 1.35, A.z).addScaledVector(f3, 0.6);
    } else {
      // THE close-up: camera in front of the attacker's face, offset to one
      // side so the dodger looms over the far shoulder; both faces in frame
      const u = EASE.outQuad(clamp01((t - 0.45) / 1.05));
      _pPos.copy(A).addScaledVector(toA, lerp(1.5, 1.16, u))
        .addScaledVector(side3, 0.52)
        .setY(lerp(1.66, 1.56, u));
      // aim between the two heads, biased back toward the looming dodger
      _pLook.copy(A).addScaledVector(toA, -0.55).addScaledVector(side3, -0.12);
      _pLook.y = 1.62;
      fov = 40;
    }

    cam.up.set(0, 1, 0);
    cam.position.copy(_pPos);
    cam.lookAt(_pLook);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}

const _pPos = new THREE.Vector3();
const _pLook = new THREE.Vector3();
const _bz = new THREE.Vector2();
function bezier2(p0, p1, p2, u) {
  const v = 1 - u;
  _bz.set(
    v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x,
    v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y
  );
  return _bz;
}
