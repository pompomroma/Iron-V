import { AI_LEVELS, AI_ROUND_RAMP, ULT, FIGHTER, ARENA } from './constants.js';
import { clamp, randRange } from '../engine/utils.js';

// ---------------------------------------------------------------------------
// Controllers produce one intent per sim tick:
//   { moveX, moveY, light, heavy, block, dash, ult }
// The Fighter doesn't know or care who is driving it — swap an AIController
// for a second HumanController (with its own key bindings) to get local 2P.
// ---------------------------------------------------------------------------

export class HumanController {
  constructor(input) { this.input = input; }
  getIntent() { return this.input.readIntent(); }
}

const NEUTRAL = { moveX: 0, moveY: 0, light: false, heavy: false, block: false, dash: false, ult: false };

export class AIController {
  constructor(levelName = 'normal') {
    this.setLevel(levelName, 0);
    this._think = 0;
    this._plan = { type: 'approach', dir: 1, until: 0 };
    this._queue = [];              // [{ at, action }]
    this._blockUntil = 0;
    this._lastAttackRef = null;
    this._t = 0;
    this._circleFlip = Math.random() < 0.5 ? 1 : -1;
  }

  setLevel(levelName, playerRoundWins) {
    const base = AI_LEVELS[levelName] || AI_LEVELS.normal;
    const r = playerRoundWins;
    this.L = {
      ...base,
      reaction: base.reaction * Math.pow(AI_ROUND_RAMP.reaction, r),
      blockProb: clamp(base.blockProb * Math.pow(AI_ROUND_RAMP.blockProb, r), 0, 0.9),
      aggression: clamp(base.aggression * Math.pow(AI_ROUND_RAMP.aggression, r), 0, 1),
    };
  }

  _schedule(delay, action) { this._queue.push({ at: this._t + delay, action }); }

  getIntent(me, opp, dt) {
    this._t += dt;
    const intent = { ...NEUTRAL };
    if (!opp || me.state === 'ko' || me.state === 'cinematic' || me.state === 'victory') return intent;

    const L = this.L;
    const d = me.distanceTo(opp);

    // ---- fire due scheduled actions ----------------------------------------
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this._queue[i].at <= this._t) {
        const a = this._queue[i].action;
        this._queue.splice(i, 1);
        if (a === 'light') intent.light = true;
        else if (a === 'heavy') intent.heavy = true;
        else if (a === 'dash') intent.dash = true;
        else if (a === 'dashSide') { intent.dash = true; intent.moveX = this._circleFlip; }
        else if (a === 'block') this._blockUntil = this._t + randRange(0.5, 1.0);
      }
    }
    intent.block = this._t < this._blockUntil;

    // ---- reactions: respond once per incoming attack ------------------------
    if (opp.state === 'attack' && opp.attack && opp.attack !== this._lastAttackRef) {
      this._lastAttackRef = opp.attack;
      if (d < 4.6 && me.canAct) {
        const roll = Math.random();
        const heavyIncoming = opp.attack.kind === 'heavy';
        const blockP = L.blockProb * (heavyIncoming ? 1.15 : 0.9);
        if (roll < blockP) this._schedule(L.reaction * randRange(0.8, 1.2), 'block');
        else if (roll < blockP + L.evadeProb) this._schedule(L.reaction * randRange(0.8, 1.15), heavyIncoming ? 'dash' : 'dashSide');
        // otherwise: eats it / trades
      }
    }

    // ---- punish stunned opponents immediately -------------------------------
    const oppHelpless = opp.state === 'guardbreak' || opp.state === 'hitstun';

    // ---- periodic planning ---------------------------------------------------
    this._think -= dt;
    if (this._think <= 0) {
      this._think = randRange(L.thinkMin, L.thinkMax);
      this._decide(me, opp, d, oppHelpless, intent);
    }

    // ---- ultimate when ready -------------------------------------------------
    if (me.ult >= FIGHTER.MAX_ULT && d < ULT.RANGE * 0.85 && me.canAct && Math.random() < 0.25) {
      intent.ult = true;
    }

    // ---- movement from current plan -------------------------------------------
    const plan = this._plan;
    if (this._t > plan.until) plan.type = 'hold';
    switch (plan.type) {
      case 'approach': intent.moveY = 1; intent.moveX = plan.dir * 0.35; break;
      case 'retreat':  intent.moveY = -1; intent.moveX = plan.dir * 0.3; break;
      case 'circle':   intent.moveX = plan.dir; intent.moveY = d > 3.4 ? 0.4 : d < 2.2 ? -0.35 : 0; break;
      case 'pressure': intent.moveY = d > 2.0 ? 1 : 0; break;
      case 'hold':     break;
    }

    // stay off the boundary: bias inward when near the edge
    if (me.pos.length() > ARENA.RADIUS * 0.82) {
      const inward = me.pos.clone().multiplyScalar(-1).normalize();
      // convert inward world dir to strafe space (fwd = toward opponent)
      const f = opp.pos.clone().sub(me.pos).normalize();
      const rgt = { x: -f.y, y: f.x };
      intent.moveY = clamp(intent.moveY + (inward.x * f.x + inward.y * f.y) * 0.8, -1, 1);
      intent.moveX = clamp(intent.moveX + (inward.x * rgt.x + inward.y * rgt.y) * 0.8, -1, 1);
    }

    // don't sit on block while far away
    if (d > 4.2) intent.block = false;

    return intent;
  }

  _decide(me, opp, d, oppHelpless, intent) {
    const L = this.L;
    const lowStamina = me.stamina < 26;
    const plan = this._plan;
    plan.until = this._t + randRange(0.5, 1.1);

    if (oppHelpless && !lowStamina) {
      // free punish: rush in and slam a heavy
      plan.type = 'pressure';
      if (d < 3.1) this._schedule(0.02, 'heavy');
      else if (d < 5) plan.type = 'approach';
      return;
    }

    if (lowStamina) {
      plan.type = Math.random() < 0.6 ? 'retreat' : 'circle';
      plan.dir = this._maybeFlip();
      return;
    }

    if (d > 5.2) {
      plan.type = 'approach';
      plan.dir = this._maybeFlip() * 0.6;
      return;
    }

    if (d > 3.2) {
      const r = Math.random();
      plan.type = r < 0.55 + L.aggression * 0.25 ? 'approach' : 'circle';
      plan.dir = this._maybeFlip();
      return;
    }

    // --- striking range -------------------------------------------------------
    const r = Math.random();
    if (r < L.aggression * 0.85) {
      const style = Math.random();
      if (style < L.feintProb) {
        // feint: start light, switch to heavy mid-windup (or the reverse)
        if (Math.random() < 0.7) {
          this._schedule(0, 'light');
          this._schedule(randRange(0.05, 0.11), 'heavy');
        } else {
          this._schedule(0, 'heavy');
          this._schedule(randRange(0.08, 0.2), 'light');
        }
      } else if (style < L.feintProb + 0.3) {
        this._schedule(0, 'heavy');
      } else {
        // jab string
        const n = 1 + (Math.random() * this.L.comboMax) | 0;
        for (let i = 0; i < n; i++) this._schedule(i * randRange(0.3, 0.4), 'light');
      }
      plan.type = 'pressure';
    } else if (r < L.aggression * 0.85 + 0.18) {
      // bait: back off a touch, then step back in
      plan.type = 'retreat';
      plan.until = this._t + randRange(0.25, 0.5);
    } else {
      plan.type = 'circle';
      plan.dir = this._maybeFlip();
    }
  }

  _maybeFlip() {
    if (Math.random() < 0.3) this._circleFlip *= -1;
    return this._circleFlip;
  }
}
