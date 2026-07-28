import * as THREE from 'three';
import { canvasTexture, randRange, TAU, clamp01 } from '../engine/utils.js?v=15';

// ---------------------------------------------------------------------------
// All VFX: additive sprite pools (flashes, rings, sparks, smoke), glove energy
// trails, dash afterimage clones, the block shield + shatter, charge auras.
// Textures are generated on canvas — zero external assets.
// ---------------------------------------------------------------------------

function texDot() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { colorSpace: false });
}
function texRing() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 7;
    ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 14, 0, TAU); ctx.stroke();
  }, { colorSpace: false });
}
function texSpark() {
  return canvasTexture(64, 16, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.3, w, h * 0.4);
  }, { colorSpace: false });
}
function texSmoke() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + randRange(-26, 26), y = h / 2 + randRange(-26, 26), r = randRange(12, 30);
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }, { colorSpace: false });
}
function texShield(cracks) {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.translate(w / 2, h / 2);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, -66);
      ctx.bezierCurveTo(34, -58, 52, -50, 52, -28);
      ctx.bezierCurveTo(52, 22, 30, 52, 0, 70);
      ctx.bezierCurveTo(-30, 52, -52, 22, -52, -28);
      ctx.bezierCurveTo(-52, -50, -34, -58, 0, -66);
      ctx.closePath();
    };
    path();
    ctx.fillStyle = 'rgba(235,244,255,0.9)';
    ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,1)';
    path(); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(140,170,200,0.8)';
    ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 52); ctx.stroke();
    // crack lines
    ctx.strokeStyle = 'rgba(30,40,60,0.85)';
    ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    const crackDefs = [
      [[-8, -30], [10, -12], [2, 8]],
      [[26, 10], [8, 26], [14, 46]],
      [[-30, -2], [-14, 16], [-24, 34]],
      [[4, -52], [-12, -36]],
      [[30, -26], [18, -8]],
    ];
    for (let i = 0; i < cracks; i++) {
      const seg = crackDefs[i % crackDefs.length];
      ctx.beginPath();
      ctx.moveTo(seg[0][0], seg[0][1]);
      for (let j = 1; j < seg.length; j++) ctx.lineTo(seg[j][0], seg[j][1]);
      ctx.stroke();
    }
  }, { colorSpace: false });
}

// hot-path scratch vectors (per-frame paths must not allocate)
const _world = new THREE.Vector3();
const _scratch = new THREE.Vector3();

export class Effects {
  constructor(scene, tier) {
    this.scene = scene;
    this.tier = tier;
    this.k = tier.particles;      // particle budget multiplier
    this.tex = {
      dot: texDot(), ring: texRing(), spark: texSpark(), smoke: texSmoke(),
      shield: [texShield(0), texShield(2), texShield(5)],
    };
    this.pool = [];               // live sprites
    // hard ceiling on simultaneously-live sprites — high enough that normal
    // play and the full ultimate never reach it, but it caps pathological
    // overdraw so a runaway burst can't tank the frame budget
    this._maxLive = Math.round(280 + 140 * this.k);   // LOW~350 · MED~420 · HIGH~504
    this._free = [];              // recycled sprite records (no GC churn)
    this.ghosts = [];             // live dash afterimages
    this.ghostQueue = [];         // scheduled afterimage spawns
    this._ghostPool = new Map();  // fighter -> [{obj, srcNodes, dstNodes}]
    this.shields = new Map();     // fighter -> sprite
    this.auras = new Map();       // fighter -> {t}
    this.trailHeat = new Map();   // fighter -> emit accumulator

    if (tier.dust) this._makeDust();
  }

  // Pre-build pose-copy afterimages for a fighter (call once at setup).
  // Dashes then reuse these instead of deep-cloning the avatar mid-fight.
  registerFighter(fighter) {
    const rigs = [];
    for (let i = 0; i < 6; i++) {
      const obj = fighter.avatar.cloneGhost(0.5);
      rigs.push({
        obj,
        srcNodes: fighter.avatar.flatNodes(),
        dstNodes: fighter.avatar.flatNodes(obj),
      });
    }
    this._ghostPool.set(fighter, rigs);
  }

  _makeDust() {
    const n = Math.floor(110 * this.k);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    this._dustData = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = randRange(2, 18);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = randRange(0.1, 4.5);
      pos[i * 3 + 2] = Math.sin(a) * r;
      this._dustData.push({ vx: randRange(-0.14, 0.14), vy: randRange(0.015, 0.06), vz: randRange(-0.14, 0.14) });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: this.tex.dot, size: 0.05, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(this.dust);
  }

  // ---- sprite pool (recycled — spawning effects never allocates mid-fight) --
  spawn({ tex, color = 0xffffff, pos, vel = null, life = 0.3, size = 1, grow = 0,
          fade = true, gravity = 0, spin = 0, opacity = 1, rotation = 0, blending = THREE.AdditiveBlending }) {
    if (this.pool.length >= this._maxLive) return null;   // overdraw guard (see _maxLive)
    let rec = this._free.pop();
    if (!rec) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
      });
      rec = { s: new THREE.Sprite(mat), mat };
    }
    const { s, mat } = rec;
    mat.map = tex;
    mat.color.set(color);
    mat.opacity = opacity;
    mat.blending = blending;
    mat.rotation = rotation;
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.pool.push({ rec, s, mat, vel, life, maxLife: life, grow, fade, gravity, spin, o0: opacity });
    return s;
  }

  _kill(p) {
    this.scene.remove(p.s);
    if (this._free.length < 240) this._free.push(p.rec);
    else p.mat.dispose();
  }

  update(rdt) {
    // pooled sprites
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= rdt;
      if (p.life <= 0) {
        this._kill(p);
        this.pool.splice(i, 1);
        continue;
      }
      const u = 1 - p.life / p.maxLife;
      if (p.vel) {
        p.s.position.addScaledVector(p.vel, rdt);
        p.vel.y -= p.gravity * rdt;
      }
      if (p.grow) p.s.scale.setScalar(p.s.scale.x + p.grow * rdt);
      if (p.spin) p.mat.rotation += p.spin * rdt;
      if (p.fade) p.mat.opacity = p.o0 * (1 - u) * (1 - u);
    }

    // scheduled dash afterimages
    for (let i = this.ghostQueue.length - 1; i >= 0; i--) {
      const q = this.ghostQueue[i];
      q.t -= rdt;
      if (q.t <= 0) {
        this.ghostQueue.splice(i, 1);
        this._spawnGhostNow(q.fighter);
      }
    }
    // fading afterimages (returned to their fighter's pool when spent)
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= rdt;
      if (g.life <= 0) {
        this.scene.remove(g.obj);
        if (g.rig) this._ghostPool.get(g.fighter).push(g.rig);
        else g.obj.userData.fadeMat.dispose();
        this.ghosts.splice(i, 1);
      } else {
        g.obj.userData.fadeMat.opacity = 0.5 * (g.life / g.maxLife);
      }
    }

    // charge auras — emission rate and updraft scale with the ramping power
    for (const [fighter, a] of this.auras) {
      a.t += rdt;
      const pw = a.power || 1;
      a.emit += rdt * 30 * pw;
      const base = fighter.avatar.group.position;
      while (a.emit > 1) {
        a.emit -= 1;
        const ang = Math.random() * TAU, r = randRange(0.5, 1.1);
        this.spawn({
          tex: this.tex.dot, color: fighter.avatar.palette.accent,
          pos: new THREE.Vector3(base.x + Math.cos(ang) * r, randRange(0.1, 0.4), base.z + Math.sin(ang) * r),
          vel: new THREE.Vector3(randRange(-0.2, 0.2), randRange(2.2, 4) * (0.7 + pw * 0.35), randRange(-0.2, 0.2)),
          life: randRange(0.35, 0.6), size: randRange(0.1, 0.22) * (0.85 + pw * 0.22),
        });
      }
    }

    // ambient dust drift
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < this._dustData.length; i++) {
        const d = this._dustData[i];
        let x = pos.getX(i) + d.vx * rdt;
        let y = pos.getY(i) + d.vy * rdt;
        let z = pos.getZ(i) + d.vz * rdt;
        if (y > 5) y = 0.1;
        if (Math.hypot(x, z) > 20) { x *= -0.98; z *= -0.98; }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  // ---- glove trails + dash dust (call every render frame) --------------------
  updateTrails(fighters, rdt) {
    // dug-in dashes spray sand from the feet AND streak speed-lines behind
    if (!this._dashDust) this._dashDust = new Map();
    if (!this._dashLine) this._dashLine = new Map();
    for (const f of fighters) {
      if (f.state !== 'dash') { this._dashDust.set(f, 0); this._dashLine.set(f, 0); continue; }
      const g = f.avatar.group.position;
      const dir = f.dashInfo || { x: 0, z: 0 };
      let heat = (this._dashDust.get(f) || 0) + rdt * 14 * this.k;
      while (heat > 1) {
        heat -= 1;
        _scratch.set(g.x + randRange(-0.3, 0.3), 0.12, g.z + randRange(-0.3, 0.3));
        this.spawn({
          tex: this.tex.smoke, color: 0x9a9a96,
          pos: _scratch,
          vel: new THREE.Vector3(randRange(-0.8, 0.8), randRange(0.5, 1.4), randRange(-0.8, 0.8)),
          life: randRange(0.35, 0.6), size: randRange(0.5, 0.9), grow: 1.4,
          blending: THREE.NormalBlending, opacity: 0.42, spin: randRange(-2, 2),
        });
      }
      this._dashDust.set(f, heat);

      // speed lines: bright streaks trailing along the travel axis
      let lh = (this._dashLine.get(f) || 0) + rdt * 40 * this.k;
      const ang = Math.atan2(dir.x, dir.z);
      while (lh > 1) {
        lh -= 1;
        const back = randRange(0.1, 0.6);
        _scratch.set(
          g.x - dir.x * back + randRange(-0.35, 0.35),
          randRange(0.5, 1.7),
          g.z - dir.z * back + randRange(-0.35, 0.35)
        );
        this.spawn({
          tex: this.tex.spark, color: f.avatar.palette.trail,
          pos: _scratch,
          vel: new THREE.Vector3(-dir.x * randRange(6, 11), 0, -dir.z * randRange(6, 11)),
          life: randRange(0.1, 0.2), size: randRange(0.6, 1.1), rotation: -ang,
        });
      }
      this._dashLine.set(f, lh);
    }

    for (const f of fighters) {
      const attacking = f.state === 'attack';
      const flurry = f.state === 'cinematic' && f._cineTrails;
      if (!attacking && !flurry) continue;
      let heat = this.trailHeat.get(f) || 0;
      heat += rdt * 90;
      const side = attacking ? f.attack.side : (Math.random() < 0.5 ? 'L' : 'R');
      const glove = f.avatar.meshes['glove' + side];
      glove.getWorldPosition(_world);
      const phase = attacking ? f.attack.phase : 'active';
      const strong = (attacking ? f.attack.kind === 'heavy' : true);
      while (heat > 1) {
        heat -= 1;
        _scratch.set(
          _world.x + randRange(-0.05, 0.05),
          _world.y + randRange(-0.05, 0.05),
          _world.z + randRange(-0.05, 0.05)
        );
        this.spawn({
          tex: this.tex.dot,
          color: strong ? 0xffc465 : f.avatar.palette.trail,
          pos: _scratch,     // spawn copies the position — scratch reuse is safe
          life: phase === 'active' ? 0.22 : 0.13,
          size: (phase === 'active' ? randRange(0.34, 0.5) : randRange(0.16, 0.26)) * (strong ? 1.35 : 1),
        });
      }
      this.trailHeat.set(f, heat);
    }
  }

  // ---- discrete events --------------------------------------------------------
  impact(pos, color, heavy = false) {
    const k = this.k;
    // bright core
    this.spawn({ tex: this.tex.dot, color: 0xffffff, pos, life: 0.13, size: heavy ? 3.2 : 2.0, grow: 8, opacity: 1 });
    this.spawn({ tex: this.tex.dot, color, pos, life: 0.24, size: heavy ? 2.2 : 1.4, grow: 4 });
    // impact ring
    this.spawn({ tex: this.tex.ring, color, pos, life: heavy ? 0.36 : 0.26, size: 0.5, grow: heavy ? 15 : 10, opacity: 0.95 });
    // fast-expanding shockwave ring — the "extreme" pop
    this.spawn({ tex: this.tex.ring, color: 0xffffff, pos, life: heavy ? 0.3 : 0.22, size: 0.4,
      grow: heavy ? 34 : 22, opacity: 0.85 });
    const n = Math.round((heavy ? 24 : 13) * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = randRange(4, heavy ? 13 : 8);
      this.spawn({
        tex: this.tex.spark, color: Math.random() < 0.5 ? color : 0xffffff,
        pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * sp, randRange(0.5, 4.2), Math.sin(a) * sp),
        life: randRange(0.25, 0.55), size: randRange(0.35, 0.85),
        gravity: 12, rotation: -a,
      });
    }
    if (heavy) {
      this.groundDust(new THREE.Vector3(pos.x, 0.05, pos.z), 6);
    }
  }

  blockSpark(pos, guardFrac) {
    this.spawn({ tex: this.tex.dot, color: 0xdfefff, pos, life: 0.14, size: 1.2, grow: 3.5 });
    const n = Math.round(6 * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      this.spawn({
        tex: this.tex.spark, color: 0xcfe6ff, pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * randRange(2, 5), randRange(1, 3), Math.sin(a) * randRange(2, 5)),
        life: randRange(0.18, 0.34), size: randRange(0.25, 0.45), gravity: 10, rotation: -a,
      });
    }
  }

  shieldShatter(pos) {
    this.spawn({ tex: this.tex.dot, color: 0xffffff, pos, life: 0.2, size: 2.2, grow: 6 });
    this.spawn({ tex: this.tex.ring, color: 0xbfdcff, pos, life: 0.4, size: 0.6, grow: 11 });
    const n = Math.round(10 * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      this.spawn({
        tex: this.tex.shield[2], color: 0xdfeaff, pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * randRange(1.5, 4.5), randRange(2, 5), Math.sin(a) * randRange(1.5, 4.5)),
        life: randRange(0.4, 0.7), size: randRange(0.12, 0.3),
        gravity: 14, spin: randRange(-9, 9), blending: THREE.NormalBlending, opacity: 0.9,
      });
    }
  }

  groundDust(pos, spread = 3) {
    const n = Math.round(6 * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      this.spawn({
        tex: this.tex.smoke, color: 0x9a9a96,
        pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.3, 0.15, pos.z + Math.sin(a) * 0.3),
        vel: new THREE.Vector3(Math.cos(a) * randRange(1, spread * 0.6), randRange(0.4, 1.2), Math.sin(a) * randRange(1, spread * 0.6)),
        life: randRange(0.5, 0.9), size: randRange(0.7, 1.3), grow: 1.6,
        blending: THREE.NormalBlending, opacity: 0.5, spin: randRange(-2, 2),
      });
    }
  }

  koBurst(pos) {
    this.spawn({ tex: this.tex.dot, color: 0xffffff, pos, life: 0.3, size: 4, grow: 12, opacity: 1 });
    this.spawn({ tex: this.tex.ring, color: 0xfff2c0, pos, life: 0.55, size: 1, grow: 22 });
    const n = Math.round(22 * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = randRange(4, 12);
      this.spawn({
        tex: this.tex.spark, color: Math.random() < 0.4 ? 0xfff2c0 : 0xffffff,
        pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * sp, randRange(1, 6), Math.sin(a) * sp),
        life: randRange(0.4, 0.8), size: randRange(0.4, 0.9), gravity: 10, rotation: -a,
      });
    }
    this.groundDust(new THREE.Vector3(pos.x, 0, pos.z), 6);
  }

  dashGhosts(fighter) {
    this.ghostQueue.push(
      { fighter, t: 0 }, { fighter, t: 0.04 }, { fighter, t: 0.08 },
      { fighter, t: 0.12 }, { fighter, t: 0.16 }, { fighter, t: 0.2 }
    );
  }
  _spawnGhostNow(fighter) {
    const rigs = this._ghostPool.get(fighter);
    if (!rigs || !rigs.length) return;         // all afterimages in flight
    const rig = rigs.pop();
    // copy the avatar's exact current pose into the pooled ghost
    const { obj, srcNodes, dstNodes } = rig;
    for (let i = 0; i < srcNodes.length; i++) {
      const s = srcNodes[i], d = dstNodes[i];
      d.position.copy(s.position);
      d.quaternion.copy(s.quaternion);
      d.scale.copy(s.scale);
    }
    obj.userData.fadeMat.opacity = 0.5;
    this.scene.add(obj);
    this.ghosts.push({ obj, rig, fighter, life: 0.24, maxLife: 0.24 });
  }

  // ---- shield icon (call every render frame) -----------------------------------
  updateShields(fighters, rdt) {
    for (const f of fighters) {
      const want = f.blocking && f.state === 'idle';
      let s = this.shields.get(f);
      if (want && !s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.tex.shield[0], transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.NormalBlending,
        }));
        s.scale.set(0.85, 1.06, 1);
        this.scene.add(s);
        this.shields.set(f, s);
      }
      if (s) {
        const frac = f.guard / 100;
        const stage = frac > 0.6 ? 0 : frac > 0.28 ? 1 : 2;
        s.material.map = this.tex.shield[stage];
        s.material.color.setHex(frac > 0.35 ? 0xffffff : 0xffb0a2);
        const g = f.avatar.group;
        const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y);
        s.position.set(g.position.x + fx * 0.72, 1.28, g.position.z + fz * 0.72);
        const target = want ? 0.66 + 0.25 * frac : 0;
        s.material.opacity += (target - s.material.opacity) * Math.min(1, rdt * 18);
        if (!want && s.material.opacity < 0.03) {
          this.scene.remove(s); s.material.dispose();
          this.shields.delete(f);
        }
      }
    }
  }

  setAura(fighter, on, power = 1) {
    if (on) {
      const a = this.auras.get(fighter) || { t: 0, emit: 0 };
      a.power = power;
      this.auras.set(fighter, a);
    } else this.auras.delete(fighter);
  }

  // A big layered shockwave — bright core + stacked expanding rings + a spray
  // of radial sparks. `scale` drives the whole thing (final blow uses ~1.5).
  shockwave(pos, color, scale = 1) {
    this.spawn({ tex: this.tex.dot, color: 0xffffff, pos, life: 0.16, size: 3 * scale, grow: 14 * scale, opacity: 1 });
    this.spawn({ tex: this.tex.ring, color: 0xffffff, pos, life: 0.34, size: 0.5, grow: 46 * scale, opacity: 0.9 });
    this.spawn({ tex: this.tex.ring, color, pos, life: 0.5, size: 0.4, grow: 30 * scale, opacity: 0.95 });
    this.spawn({ tex: this.tex.ring, color, pos, life: 0.66, size: 0.3, grow: 18 * scale, opacity: 0.65 });
    const n = Math.round(30 * this.k * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = randRange(6, 18) * scale;
      this.spawn({
        tex: this.tex.spark, color: Math.random() < 0.5 ? color : 0xffffff,
        pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * sp, randRange(0.5, 6), Math.sin(a) * sp),
        life: randRange(0.3, 0.7), size: randRange(0.4, 1.0), gravity: 12, rotation: -a,
      });
    }
  }

  // Energy converging inward on the charging fighter (charge-beat pulses).
  chargeBurst(pos, color) {
    this.spawn({ tex: this.tex.ring, color, pos, life: 0.4, size: 2.6, grow: -4.5, opacity: 0.9 });
    const n = Math.round(16 * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = randRange(1.5, 2.6);
      this.spawn({
        tex: this.tex.spark, color,
        pos: new THREE.Vector3(pos.x + Math.cos(a) * r, randRange(0.1, 0.6), pos.z + Math.sin(a) * r),
        vel: new THREE.Vector3(-Math.cos(a) * randRange(3, 6), randRange(2, 5), -Math.sin(a) * randRange(3, 6)),
        life: randRange(0.25, 0.5), size: randRange(0.3, 0.62), rotation: a,
      });
    }
  }

  clearTransient() {
    for (const p of this.pool) this._kill(p);
    this.pool.length = 0;
    for (const g of this.ghosts) {
      this.scene.remove(g.obj);
      if (g.rig) this._ghostPool.get(g.fighter).push(g.rig);
      else g.obj.userData.fadeMat.dispose();
    }
    this.ghosts.length = 0;
    this.ghostQueue.length = 0;
    for (const [f, s] of this.shields) { this.scene.remove(s); s.material.dispose(); }
    this.shields.clear();
    this.auras.clear();
  }
}
