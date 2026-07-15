import * as THREE from 'three';
import {
  FIGHTER, LIGHT, HEAVY, FEINT, BLOCK, DASH, STAMINA, COUNTER, ULT, ARENA, CHAIN_WINDOW,
} from './constants.js?v=11';
import { AnimPlayer } from './animation.js?v=11';
import { clamp, clamp01, angleDamp, damp } from '../engine/utils.js?v=11';

const ATTACKS = { light: LIGHT, heavy: HEAVY };

// ---------------------------------------------------------------------------
// Fighter: deterministic combat entity. Reads an intent each sim tick:
//   { moveX, moveY, light, heavy, block, dash, ult }  (light/heavy/dash/ult
// are edge-triggered). Pushes gameplay events onto the shared bus for
// effects / audio / HUD / AI to consume.
// ---------------------------------------------------------------------------
export class Fighter {
  constructor({ id, name, avatar, events }) {
    this.id = id;
    this.name = name;
    this.avatar = avatar;
    this.anim = new AnimPlayer(avatar);
    this.events = events;
    this.opponent = null;

    this.pos = new THREE.Vector2(0, 0);      // x, z
    this.prevPos = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0);
    this.facing = 0;                          // yaw toward opponent
    this.prevFacing = 0;

    this.hp = FIGHTER.MAX_HP;
    this.stamina = FIGHTER.MAX_STAMINA;
    this.guard = FIGHTER.MAX_GUARD;
    this.ult = 0;

    this.state = 'idle';
    this.stateT = 0;
    this.blocking = false;
    this.attack = null;                       // { kind, side, phase, t, hasHit, feints }
    this.dashInfo = null;                     // { x, z, t }
    this.dashCooldown = 0;
    this._staminaDelay = 0;
    this._guardDelay = 0;
    this._jabSide = 'L';
    this.roundsWon = 0;
    this.moveIntent = { x: 0, y: 0 };         // raw intents (AI reads these)
    this._moveSmooth = { x: 0, y: 0 };        // damped copies driving the anim lean
    this._speedSmooth = 0;
  }

  // ---- helpers -------------------------------------------------------------
  emit(type, data = {}) { this.events.push({ type, fighter: this, ...data }); }
  distanceTo(o) { return this.pos.distanceTo(o.pos); }
  get isKO() { return this.state === 'ko'; }
  get canAct() { return this.state === 'idle'; }
  get inWindup() { return this.state === 'attack' && this.attack.phase === 'windup'; }
  get dashInvuln() {
    return this.state === 'dash' && this.dashInfo && this.dashInfo.t < DASH.IFRAMES;
  }

  _spendStamina(cost) {
    if (this.stamina < cost) { this.emit('noStamina'); return false; }
    this.stamina -= cost;
    this._staminaDelay = STAMINA.REGEN_DELAY;
    return true;
  }

  // ---- round lifecycle -------------------------------------------------------
  resetForRound(x, z, faceTowards) {
    this.pos.set(x, z); this.prevPos.set(x, z);
    this.vel.set(0, 0);
    this.hp = FIGHTER.MAX_HP;
    this.stamina = FIGHTER.MAX_STAMINA;
    this.guard = FIGHTER.MAX_GUARD;
    this.state = 'idle'; this.stateT = 0;
    this.attack = null; this.dashInfo = null;
    this.blocking = false; this.dashCooldown = 0;
    this.facing = Math.atan2(faceTowards.x - x, faceTowards.y - z);
    this.prevFacing = this.facing;
    this.avatar.setGhost(0);
    this.avatar.setGloveGlow(0);
    this.avatar.setTelegraph(0);
    this.avatar.resetStretch();
    this.anim.play('idle', { duration: 1, blend: 0.25 });
  }

  setVictory() {
    if (this.state === 'ko') return;
    this.state = 'victory'; this.stateT = 0;
    this.vel.set(0, 0);
    this.anim.play('victory', { duration: 2.2, blend: 0.3 });
  }

  // externally driven during cutscenes (ultimate / perfect dodge)
  setCinematic(on) {
    if (on) {
      this.state = 'cinematic'; this.stateT = 0; this.vel.set(0, 0);
      this.blocking = false; this.attack = null;
      this.dashInfo = null; this.avatar.setGhost(0);   // a cutscene can start mid-dash
      this.avatar.setTelegraph(0);
      this.avatar.setGloveGlow(0);
      this.avatar.resetStretch();
    }
    else if (this.state === 'cinematic') { this.state = 'idle'; this.stateT = 0; this.anim.play('idle', { duration: 1, blend: 0.2, restart: false }); }
  }

  // ---- main sim tick ---------------------------------------------------------
  update(dt, intent) {
    const opp = this.opponent;
    this.prevPos.copy(this.pos);
    this.prevFacing = this.facing;
    this.stateT += dt;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.moveIntent.x = intent.moveX; this.moveIntent.y = intent.moveY;

    // regen
    this._staminaDelay = Math.max(0, this._staminaDelay - dt);
    if (this._staminaDelay === 0 && this.state !== 'ko') {
      const mult = this.blocking ? BLOCK.STAMINA_REGEN_MULT : 1;
      this.stamina = Math.min(FIGHTER.MAX_STAMINA, this.stamina + STAMINA.REGEN * mult * dt);
    }
    this._guardDelay = Math.max(0, this._guardDelay - dt);
    if (!this.blocking && this._guardDelay === 0 && this.state !== 'guardbreak') {
      this.guard = Math.min(FIGHTER.MAX_GUARD, this.guard + BLOCK.GUARD_REGEN * dt);
    }

    // face the opponent at all times (mutual lock-on) except when down/cinematic;
    // turn rate is capped so point-blank passes rotate smoothly instead of whipping
    if (opp && this.state !== 'ko' && this.state !== 'cinematic') {
      const target = Math.atan2(opp.pos.x - this.pos.x, opp.pos.y - this.pos.y);
      const next = angleDamp(this.facing, target, 22, dt);
      let dTurn = next - this.facing;
      if (dTurn > Math.PI) dTurn -= Math.PI * 2;
      if (dTurn < -Math.PI) dTurn += Math.PI * 2;
      const maxStep = FIGHTER.MAX_TURN * dt;
      this.facing += clamp(dTurn, -maxStep, maxStep);
    }

    switch (this.state) {
      case 'idle':       this._tickIdle(dt, intent, opp); break;
      case 'attack':     this._tickAttack(dt, intent, opp); break;
      case 'ultwind':    this._tickUltWind(dt); break;
      case 'dash':       this._tickDash(dt); break;
      case 'hitstun':    this._tickSimple(dt, this._stunDur); break;
      case 'guardbreak': this._tickSimple(dt, BLOCK.BREAK_STUN, () => { this.guard = BLOCK.GUARD_AFTER_BREAK; }); break;
      case 'ko': case 'cinematic': case 'victory':
        this.vel.multiplyScalar(Math.max(0, 1 - FIGHTER.FRICTION * dt));
        break;
    }

    // integrate
    this.pos.addScaledVector(this.vel, dt);

    // arena bounds
    const r = this.pos.length();
    if (r > ARENA.RADIUS) this.pos.multiplyScalar(ARENA.RADIUS / r);
  }

  _tickIdle(dt, intent, opp) {
    this.blocking = !!intent.block;

    // action priority: ult > dash > heavy > light
    if (intent.ult && this.ult >= FIGHTER.MAX_ULT) {
      // blue-shine charge delay — the opponent can dodge or block during it
      this.state = 'ultwind'; this.stateT = 0;
      this.blocking = false;
      this.anim.play('ultCharge', { duration: ULT.WINDUP, blend: 0.12 });
      this.emit('ultWindup');
      return;
    } else if (intent.dash && this.dashCooldown === 0) {
      if (this._startDash(intent)) return;
    } else if (intent.heavy) {
      if (this._startAttack('heavy')) return;
    } else if (intent.light) {
      if (this._startAttack('light')) return;
    }

    // movement (strafe-relative to the opponent)
    let ax = 0, az = 0;
    if (opp) {
      const f = new THREE.Vector2().subVectors(opp.pos, this.pos).normalize();
      const rgt = new THREE.Vector2(-f.y, f.x);    // character-right on XZ
      const fwdSpeed = intent.moveY > 0 ? FIGHTER.FORWARD_SPEED : FIGHTER.BACK_SPEED;
      const mult = this.blocking ? 0.42 : 1;
      ax = (f.x * intent.moveY * fwdSpeed + rgt.x * intent.moveX * FIGHTER.WALK_SPEED) * mult;
      az = (f.y * intent.moveY * fwdSpeed + rgt.y * intent.moveX * FIGHTER.WALK_SPEED) * mult;
    }
    const desired = new THREE.Vector2(ax, az);
    this.vel.x = approach(this.vel.x, desired.x, FIGHTER.ACCEL * dt);
    this.vel.y = approach(this.vel.y, desired.y, FIGHTER.ACCEL * dt);

    // anim: block / idle loop
    this.anim.play(this.blocking ? 'block' : 'idle', { duration: this.blocking ? 1.2 : 1, blend: 0.14, restart: false });
  }

  _startAttack(kind, blend = 0.1) {
    const C = ATTACKS[kind];
    if (!this._spendStamina(C.STAMINA)) return false;
    const side = kind === 'light' ? this._jabSide : 'R';
    if (kind === 'light') this._jabSide = this._jabSide === 'L' ? 'R' : 'L';
    this.state = 'attack'; this.stateT = 0;
    this.blocking = false;
    this.attack = { kind, side, phase: 'windup', t: 0, hasHit: false, feints: 0, windup: C.WINDUP };
    this._playAttackAnim(blend);
    this.emit('swing', { kind });
    return true;
  }

  _playAttackAnim(blend) {
    const a = this.attack;
    const C = ATTACKS[a.kind];
    const total = a.windup + C.ACTIVE + C.RECOVER;
    const clip = a.kind === 'light' ? 'jab' + a.side : 'heavy' + a.side;
    this.anim.play(clip, { duration: total, blend });
  }

  _tickAttack(dt, intent, opp) {
    const a = this.attack;
    const C = ATTACKS[a.kind];
    a.t += dt;

    // ---- feint switch: opposite button during windup cancels into the other ----
    if (a.phase === 'windup') {
      const wantSwitch = (a.kind === 'light' && intent.heavy) || (a.kind === 'heavy' && intent.light);
      if (wantSwitch && this._spendStamina(FEINT.STAMINA)) {
        const to = a.kind === 'light' ? 'heavy' : 'light';
        const NC = ATTACKS[to];
        a.kind = to;
        a.side = to === 'light' ? this._jabSide : 'R';
        if (to === 'light') this._jabSide = this._jabSide === 'L' ? 'R' : 'L';
        a.t = 0;
        a.feints++;
        a.windup = NC.WINDUP * FEINT.WINDUP_SCALE;
        a.hasHit = false;
        this._playAttackAnim(FEINT.BLEND);        // smooth switch motion
        this.emit('feint', { to });
        return;
      }
    }

    // glove charge glow + whole-body red telegraph through windup: the
    // pulsing red flash is the defender's "dodge or counter NOW" cue
    if (a.phase === 'windup') {
      const u = clamp01(a.t / a.windup);
      this.avatar.setGloveGlow(u * (a.kind === 'heavy' ? 1 : 0.55));
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(a.t * 18));
      this.avatar.setTelegraph(u * pulse * (a.kind === 'heavy' ? 0.5 : 0.34));
    }

    // lunge toward opponent during windup+active (gap closer). The lunge
    // disengages ONCE when close and never re-engages for this attack —
    // a hard on/off distance check toggles every tick at the boundary and
    // makes the fighters buzz against each other.
    if (a.lunging === undefined) a.lunging = true;
    if (opp && a.phase !== 'recover' && a.lunging && this.distanceTo(opp) > FIGHTER.LUNGE_STOP) {
      const f = new THREE.Vector2().subVectors(opp.pos, this.pos).normalize();
      this.vel.x = approach(this.vel.x, f.x * C.LUNGE, FIGHTER.ACCEL * 2.4 * dt);
      this.vel.y = approach(this.vel.y, f.y * C.LUNGE, FIGHTER.ACCEL * 2.4 * dt);
    } else {
      if (opp && this.distanceTo(opp) <= FIGHTER.LUNGE_STOP) a.lunging = false;
      this.vel.multiplyScalar(Math.max(0, 1 - FIGHTER.FRICTION * dt));
    }

    // phase progression
    if (a.phase === 'windup' && a.t >= a.windup) {
      a.phase = 'active'; a.t = 0;
      this.avatar.setTelegraph(0);              // flash ends as the strike fires
    }
    else if (a.phase === 'active') {
      if (!a.hasHit && opp && this.distanceTo(opp) <= C.RANGE) {
        a.hasHit = true;
        this.avatar.setGloveGlow(0);
        this.avatar.stretchPunch();               // lunge-stretch toward the blow
        opp.receiveHit(this, C, a.kind);
      }
      if (a.t >= C.ACTIVE) {
        a.phase = 'recover'; a.t = 0;
        this.avatar.setGloveGlow(0);
        if (!a.hasHit) this.emit('whiff', { kind: a.kind });
      }
    }
    else if (a.phase === 'recover') {
      // presses anywhere in recover are buffered, then released once the
      // chain window opens — punch strings flow without bouncing through
      // idle, and early presses are never dropped
      if (intent.light) a.buffered = 'light';
      else if (intent.heavy) a.buffered = 'heavy';
      else if (intent.dash) a.buffered = 'dash';

      if (a.buffered && a.t >= C.RECOVER * (1 - CHAIN_WINDOW)) {
        const want = a.buffered;
        a.buffered = null;
        this.attack = null;
        if (want === 'dash') {
          if (this.dashCooldown === 0 && this._startDash(intent)) return;
        } else if (this._startAttack(want, 0.13)) {
          return;
        }
        this.attack = a;                 // couldn't act (stamina/cooldown) — keep recovering
      }
      if (a.t >= C.RECOVER) {
        this.state = 'idle'; this.stateT = 0; this.attack = null;
        this.anim.play('idle', { duration: 1, blend: 0.22, restart: false });
      }
    }
  }

  _startDash(intent) {
    if (!this._spendStamina(DASH.STAMINA)) return false;
    // dash along movement input (relative to opponent), default backward
    let mx = intent.moveX, my = intent.moveY;
    if (Math.abs(mx) < 0.15 && Math.abs(my) < 0.15) { mx = 0; my = -1; }
    const opp = this.opponent;
    const f = opp ? new THREE.Vector2().subVectors(opp.pos, this.pos).normalize() : new THREE.Vector2(0, 1);
    const rgt = new THREE.Vector2(-f.y, f.x);
    const dir = new THREE.Vector2(f.x * my + rgt.x * mx, f.y * my + rgt.y * mx).normalize();

    this.state = 'dash'; this.stateT = 0;
    this.blocking = false;
    this.dashInfo = { x: dir.x, z: dir.y, t: 0 };
    this.dashCooldown = DASH.COOLDOWN + DASH.DURATION;
    this.avatar.stretchDash();                         // explosive streak-stretch

    // pick the directional dash clip (relative to facing)
    const fwdAmt = dir.dot(f), sideAmt = dir.dot(rgt);
    let clip = 'dashB';
    if (Math.abs(fwdAmt) >= Math.abs(sideAmt)) clip = fwdAmt > 0 ? 'dashF' : 'dashB';
    else clip = sideAmt > 0 ? 'dashR' : 'dashL';
    this.anim.play(clip, { duration: DASH.DURATION * 1.75, blend: 0.05 });
    this.emit('dash', { dir: clip });
    return true;
  }

  // ultimate charge: blue pulsing shine ramps toward release; the opponent
  // has this whole window to dash away or raise a block
  _tickUltWind(dt) {
    this.vel.multiplyScalar(Math.max(0, 1 - FIGHTER.FRICTION * dt));
    const u = clamp01(this.stateT / ULT.WINDUP);
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.stateT * 16));
    this.avatar.setTelegraph(u * pulse * 0.55, 0x49d8ff);
    this.avatar.setGloveGlow(u);
    if (this.stateT >= ULT.WINDUP) {
      this.avatar.setTelegraph(0);
      this.avatar.setGloveGlow(0);
      this.state = 'idle'; this.stateT = 0;
      this.emit('ultRelease');            // main resolves: whiff / dodged / blocked / cinematic
    }
  }

  _tickDash(dt) {
    const d = this.dashInfo;
    d.t += dt;
    const k = 1 - clamp01(d.t / DASH.DURATION);        // decaying burst
    this.vel.x = d.x * DASH.SPEED * (0.35 + 0.65 * k);
    this.vel.y = d.z * DASH.SPEED * (0.35 + 0.65 * k);
    this.avatar.setGhost(d.t < DASH.IFRAMES ? 1 : 0);
    if (d.t >= DASH.DURATION) {
      this.avatar.setGhost(0);
      this.avatar.squashLand();                        // absorb the stop
      this.state = 'idle'; this.stateT = 0; this.dashInfo = null;
      this.anim.play('idle', { duration: 1, blend: 0.18, restart: false });
    }
  }

  _tickSimple(dt, dur, onEnd) {
    this.vel.multiplyScalar(Math.max(0, 1 - FIGHTER.FRICTION * 0.6 * dt));
    if (this.stateT >= dur) {
      onEnd && onEnd();
      this.state = 'idle'; this.stateT = 0;
      this.anim.play('idle', { duration: 1, blend: 0.2, restart: false });
    }
  }

  // ---- receiving hits --------------------------------------------------------
  receiveHit(attacker, C, kind) {
    if (this.state === 'ko' || this.state === 'cinematic') return;

    // dash i-frames — dashing within the tight window right before the hit
    // would land counts as a PERFECT dodge (main may reward it)
    if (this.dashInvuln) {
      this.emit('dodge', { attacker, perfect: this.dashInfo.t < DASH.PERFECT_WINDOW });
      return;
    }

    const away = new THREE.Vector2().subVectors(this.pos, attacker.pos).normalize();

    // blocked?
    if (this.blocking && this.state === 'idle') {
      this.guard -= C.GUARD_DAMAGE;
      this.hp = Math.max(0.5, this.hp - C.CHIP);     // chip can't KO
      this._guardDelay = BLOCK.GUARD_REGEN_DELAY;
      this.vel.addScaledVector(away, C.KNOCKBACK * 0.5);
      if (this.guard <= 0) {
        this.guard = 0;
        this.state = 'guardbreak'; this.stateT = 0; this.blocking = false;
        this.anim.play('guardBreak', { duration: 0.5, blend: 0.08 });
        // dizzy loop takes over shortly after the pop
        this._queuedStun = true;
        this.emit('guardbreak', { attacker });
        attacker.ult = Math.min(FIGHTER.MAX_ULT, attacker.ult + C.ULT_GAIN_DEAL);
      } else {
        this.anim.play('blockHit', { duration: 0.32, blend: 0.08 });
        this.emit('blocked', { attacker, kind });
      }
      return;
    }

    // clean hit — interrupting a windup OR an ult charge counts as a counter
    let dmg = C.DAMAGE;
    const countered = (this.state === 'attack' && this.attack && this.attack.phase === 'windup')
      || this.state === 'ultwind';
    if (countered) dmg *= COUNTER.MULT;

    this.hp -= dmg;
    this.ult = Math.min(FIGHTER.MAX_ULT, this.ult + C.ULT_GAIN_TAKE);
    attacker.ult = Math.min(FIGHTER.MAX_ULT, attacker.ult + C.ULT_GAIN_DEAL);

    this.attack = null;
    this.avatar.setGloveGlow(0);
    this.avatar.setTelegraph(0);
    this.avatar.squashHit();                          // wide-short recoil pop
    this.vel.addScaledVector(away, C.KNOCKBACK);

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'ko'; this.stateT = 0; this.blocking = false;
      this.anim.play('ko', { duration: 1.25, blend: 0.06 });
      this.emit('ko', { attacker, countered });
      return;
    }

    // re-triggering the hit anim mid-hitstun (jab strings) uses a wider blend
    // so back-to-back hits roll into each other instead of vibrating
    const rehit = this.state === 'hitstun';
    this.state = 'hitstun'; this.stateT = 0; this.blocking = false;
    this._stunDur = C.HITSTUN * (countered ? 1.25 : 1);
    this.anim.play(kind === 'light' ? 'hitLight' : 'hitHeavy', {
      duration: this._stunDur * 1.7, blend: rehit ? 0.12 : 0.09,
    });
    this.emit(countered ? 'counter' : 'hit', { attacker, kind, dmg });
  }

  // guardbreak pop -> dizzy loop handoff (called from sim tick by main)
  maybeEnterStunLoop() {
    if (this.state === 'guardbreak' && this._queuedStun && this.stateT > 0.4) {
      this._queuedStun = false;
      this.anim.play('stunned', { duration: 0.9, blend: 0.25 });
    }
  }

  // ---- rendering -------------------------------------------------------------
  // Interpolate sim states into the visual transform; advance animation clock.
  syncVisual(alpha, rdt) {
    const g = this.avatar.group;
    g.position.set(
      this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha,
      0,
      this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha
    );
    let df = this.facing - this.prevFacing;
    if (df > Math.PI) df -= Math.PI * 2;
    if (df < -Math.PI) df += Math.PI * 2;
    g.rotation.y = this.prevFacing + df * alpha;

    // damp the locomotion drivers so leans and strides ramp instead of snap
    // (tight λ — the body lean tracks input crisply for a snappy feel)
    const speed01 = clamp01(this.vel.length() / FIGHTER.FORWARD_SPEED);
    this._speedSmooth = damp(this._speedSmooth, speed01, 14, rdt);
    this._moveSmooth.x = damp(this._moveSmooth.x, this.moveIntent.x, 14, rdt);
    this._moveSmooth.y = damp(this._moveSmooth.y, this.moveIntent.y, 14, rdt);
    this.anim.update(rdt, {
      dt: rdt,
      moveX: this._moveSmooth.x,
      moveZ: this._moveSmooth.y,
      speed01: this._speedSmooth,
    });
    this.avatar.updateStretch(rdt);      // squash & stretch spring
  }
}

function approach(cur, target, maxDelta) {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
}

// Keep the two fighters from overlapping (called once per sim tick).
// Soft resolution: only a fraction of the overlap is corrected per tick and
// inward velocity along the contact axis is cancelled — instant full
// correction fights the attack lunge and makes the pair visibly vibrate.
export function resolvePair(a, b) {
  const d = new THREE.Vector2().subVectors(b.pos, a.pos);
  let dist = d.length();
  if (dist < 1e-4) { d.set(0, 1); dist = 1e-4; }
  if (dist < FIGHTER.MIN_SEPARATION) {
    d.normalize();
    const push = (FIGHTER.MIN_SEPARATION - dist) * 0.4 * 0.5;
    if (a.state !== 'ko') {
      a.pos.addScaledVector(d, -push);
      const inward = a.vel.dot(d);                 // a moving toward b
      if (inward > 0) a.vel.addScaledVector(d, -inward);
    }
    if (b.state !== 'ko') {
      b.pos.addScaledVector(d, push);
      const inwardB = -b.vel.dot(d);               // b moving toward a
      if (inwardB > 0) b.vel.addScaledVector(d, inwardB);
    }
  }
}
