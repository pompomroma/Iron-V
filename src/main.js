import * as THREE from 'three';
import { detectTier, DynamicResolution } from './engine/quality.js?v=10';
import { createRenderer, resizeRendererToDisplay } from './engine/renderer.js?v=10';
import { GameLoop } from './engine/loop.js?v=10';
import { buildArena } from './game/arena.js?v=10';
import { buildBoxer } from './game/avatar.js?v=10';
import { Fighter, resolvePair } from './game/fighter.js?v=10';
import { HumanController, AIController } from './game/controller.js?v=10';
import { InputSystem } from './game/input.js?v=10';
import { FightCamera } from './game/camera.js?v=10';
import { Effects } from './game/effects.js?v=10';
import { AudioEngine } from './game/audio.js?v=10';
import { HUD } from './game/hud.js?v=10';
import { UltimateCinematic, PerfectDodgeCinematic } from './game/cinematic.js?v=10';
import { PALETTES, ROUNDS, ULT, COUNTER, PDODGE } from './game/constants.js?v=10';
import { clamp01, lerp, EASE, TAU } from './engine/utils.js?v=10';

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
const BUILD = 'v10';
document.getElementById('build-tag').textContent = 'IRON V · build ' + BUILD;

const canvas = document.getElementById('game-canvas');
const tier = detectTier();
const renderer = createRenderer(canvas, tier);
const dynres = new DynamicResolution(renderer, tier);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.08, 130);
buildArena(scene, tier);

const events = [];
const av1 = buildBoxer(PALETTES.P1, 0);
const av2 = buildBoxer(PALETTES.P2, 1);
scene.add(av1.group, av2.group);

const p1 = new Fighter({ id: 0, name: 'YOU', avatar: av1, events });
const p2 = new Fighter({ id: 1, name: 'IRON-BOT', avatar: av2, events });
p1.opponent = p2; p2.opponent = p1;

const input = new InputSystem();
const human = new HumanController(input);
const ai = new AIController('normal');

const fightCam = new FightCamera(camera);
fightCam.follow(p1, p2);
fightCam.setAspect(innerWidth / innerHeight);

const effects = new Effects(scene, tier);
effects.registerFighter(p1);
effects.registerFighter(p2);
const audio = new AudioEngine();
const hud = new HUD();
const cinematic = new UltimateCinematic({ fightCam, effects, audio, hud });
const pdodgeCine = new PerfectDodgeCinematic({ fightCam, effects, audio, hud });
let pdodgeReadyAt = 0;    // performance.now() gate so the cutscene stays special

hud.setNames('YOU', 'IRON-BOT');
hud.showTouch(input.isTouch);
input.onAnyInput = () => audio.unlock();

// ---------------------------------------------------------------------------
// game state
// ---------------------------------------------------------------------------
const G = {
  state: 'title',          // title | intro | fight | ult | ko | roundend | victory
  stateT: 0,               // real seconds in state
  round: 0,
  scores: [0, 0],
  difficulty: 'normal',
  introPhase: 0,
  koWinner: null,
  slowmoT: 0,
  debugHud: false,
};
const NEUTRAL = { moveX: 0, moveY: 0, light: false, heavy: false, block: false, dash: false, ult: false };

function setState(s) { G.state = s; G.stateT = 0; }

function startMatch() {
  G.scores = [0, 0];
  G.round = 0;
  p1.ult = 0; p2.ult = 0;
  ai.setLevel(G.difficulty, 0);
  hud.score(0, 0);
  hud.showTitle(false);
  hud.hideVictory();
  hud.showHud(true);
  audio.uiTick();
  startRound();
}

function startRound() {
  G.round++;
  effects.clearTransient();
  loop.timeScale = 1;
  p1.resetForRound(0, -3.1, { x: 0, y: 3.1 });
  p2.resetForRound(0, 3.1, { x: 0, y: -3.1 });
  ai.setLevel(G.difficulty, G.scores[0]);
  setState('intro');
  G.introPhase = 0;
  hud.roundCard(`ROUND ${G.round}`, `first to ${ROUNDS.TO_WIN}`, 1500);

  // intro sweep: glide from a side angle into the shoulder camera
  const introStart = performance.now();
  fightCam.override = (cam) => {
    const u = EASE.inOutCubic(clamp01((performance.now() - introStart) / 1900));
    const mid = new THREE.Vector3().addVectors(av1.group.position, av2.group.position).multiplyScalar(0.5);
    const ang = lerp(Math.PI * 0.55, Math.PI * 0.18, u);
    const r = lerp(7.5, 4.6, u);
    cam.position.set(mid.x + Math.sin(ang) * r, lerp(1.1, 2.3, u), mid.z - Math.cos(ang) * r);
    cam.up.set(0, 1, 0);
    cam.lookAt(mid.x, lerp(1.5, 1.35, u), mid.z);
  };
}

function endRound(winner) {
  G.koWinner = winner;
  G.scores[winner.id] += 1;
  hud.score(G.scores[0], G.scores[1]);
  setState('roundend');
  winner.setVictory();
}

function finishMatch() {
  setState('victory');
  const win = G.scores[0] > G.scores[1];
  hud.showVictory(win, `${G.scores[0]} – ${G.scores[1]}`);
  win ? audio.win() : audio.lose();
}

function setSlowmo(scale, realDur) {
  loop.timeScale = scale;
  G.slowmoT = Math.max(G.slowmoT, realDur);
}

// ---------------------------------------------------------------------------
// gameplay event routing (combat → juice)
// ---------------------------------------------------------------------------
function chestOf(f) { return f.avatar.group.position.clone().setY(1.35); }

function handleEvents() {
  for (const e of events) {
    const f = e.fighter;
    switch (e.type) {
      case 'swing': audio.whoosh(e.kind === 'heavy'); break;
      case 'feint': audio.feint(); break;

      case 'hit': {
        const heavy = e.kind !== 'light';
        audio.hit(heavy);
        effects.impact(chestOf(f), e.attacker.avatar.palette.accent, heavy);
        effects.setAura(f, false);          // an interrupted ult charge loses its aura
        fightCam.addShake(heavy ? 0.55 : 0.28);
        fightCam.fovKick(heavy ? -5 : -2);  // punchy FOV snap on every hit
        if (f === p1) { hud.damageVignette(); input.clearAttackBuffer(); }
        break;
      }
      case 'counter': {
        audio.hit(e.kind === 'heavy', true);
        effects.impact(chestOf(f), 0xffd23e, true);
        fightCam.addShake(0.8);
        fightCam.fovKick(-7);
        hud.popupSide('COUNTER!', 'counter');
        setSlowmo(COUNTER.SLOWMO, COUNTER.SLOWMO_TIME);
        if (f === p1) { hud.damageVignette(); input.clearAttackBuffer(); }
        break;
      }
      case 'blocked': {
        audio.blocked();
        const g = f.avatar.group;
        const fwd = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
        effects.blockSpark(g.position.clone().add(fwd.multiplyScalar(0.75)).setY(1.3), f.guard / 100);
        fightCam.addShake(0.16);
        break;
      }
      case 'guardbreak': {
        audio.guardCrack();
        effects.shieldShatter(chestOf(f));
        hud.popupSide('GUARD BREAK!', 'break');
        fightCam.addShake(0.6);
        if (f === p1) input.clearAttackBuffer();
        break;
      }
      case 'dodge': {
        // a PERFECT player dodge (tight timing) triggers the reward cutscene
        if (e.perfect && f === p1 && G.state === 'fight' && performance.now() >= pdodgeReadyAt) {
          pdodgeReadyAt = performance.now() + PDODGE.COOLDOWN * 1000;
          setState('pdodge');
          pdodgeCine.start(p1, e.attacker, {
            onDone: () => {
              // the attacker comes to, stunned and facing the wrong way
              const a = e.attacker;
              a.setCinematic(false);
              p1.setCinematic(false);
              if (a.state !== 'ko') {
                a.state = 'hitstun'; a.stateT = 0; a._stunDur = PDODGE.STUN;
                a.anim.play('stunned', { duration: 1.0, blend: 0.15 });
              }
              if (G.state === 'pdodge') setState('fight');
            },
          });
          break;
        }
        audio.dodge();
        hud.popupSide('DODGE', 'dodge');
        break;
      }
      case 'dash': {
        audio.dash();
        effects.dashGhosts(f);
        effects.groundDust(f.avatar.group.position.clone(), 3);
        if (f === p1) {
          fightCam.fovKick(13);
          if (e.dir === 'dashL') fightCam.rollKick(-0.07);
          else if (e.dir === 'dashR') fightCam.rollKick(0.07);
        }
        break;
      }
      case 'noStamina': if (f === p1) audio.noStamina(); break;

      case 'ko': {
        audio.ko();
        effects.koBurst(chestOf(f));
        hud.popupCenter('K.O.!', 'ko', 1800);
        fightCam.addShake(1);
        hud.flash(0.6, 160);
        setSlowmo(ROUNDS.KO_SLOWMO, ROUNDS.KO_SLOWMO_TIME);
        G.koWinner = f.opponent;
        setState('ko');
        break;
      }

      case 'ultWindup': {
        // blue charge begins — visible, dodgeable, blockable
        effects.setAura(f, true);
        audio.ultCharge();
        break;
      }

      case 'ultRelease': {
        effects.setAura(f, false);
        if (G.state !== 'fight') { break; }
        const v = f.opponent;
        const dist = f.distanceTo(v);

        if (dist > ULT.RANGE) {
          f.ult = ULT.WHIFF_REFUND;                   // charged into empty air
          if (f === p1) { hud.popupSide('TOO FAR!', 'dodge'); audio.noStamina(); }
          break;
        }
        if (v.dashInvuln) {
          f.ult = ULT.WHIFF_REFUND;                   // read the blue flash and dodged
          audio.dodge();
          hud.popupSide('DODGE', 'dodge');
          break;
        }
        if (v.blocking && v.state === 'idle') {
          f.ult = 0;                                  // blocked — no cinematic,
          v.receiveHit(f, {                           // but the guard gets mauled
            DAMAGE: ULT.DAMAGE, GUARD_DAMAGE: ULT.GUARD_DAMAGE, CHIP: ULT.CHIP,
            HITSTUN: ULT.HITSTUN, KNOCKBACK: ULT.KNOCKBACK,
            ULT_GAIN_DEAL: 0, ULT_GAIN_TAKE: 0,
          }, 'ult');
          hud.popupSide('BLOCKED!', 'break');
          fightCam.addShake(0.5);
          break;
        }

        // clean connect — the cinematic plays
        f.ult = 0;
        setState('ult');
        cinematic.start(f, v, {
          onDamage: (amt) => { v.hp = Math.max(0, v.hp - amt); },
          onDone: () => {
            f.setCinematic(false);
            if (v.hp <= 0) {
              v.state = 'ko'; v.stateT = 0;           // already in the ko anim
              events.push({ type: 'ko', fighter: v, attacker: f });
            } else {
              v.state = 'hitstun'; v.stateT = 0; v._stunDur = 0.9;
              v.anim.play('stunned', { duration: 1.0, blend: 0.2 });
            }
            if (G.state === 'ult') setState('fight');
          },
        });
        break;
      }
    }
  }
  events.length = 0;
}

// ---------------------------------------------------------------------------
// fixed-step simulation
// ---------------------------------------------------------------------------
function update(dt) {
  switch (G.state) {
    case 'title': {
      p1.update(dt, NEUTRAL); p2.update(dt, NEUTRAL);
      events.length = 0;
      break;
    }
    case 'intro': {
      p1.update(dt, NEUTRAL); p2.update(dt, NEUTRAL);
      events.length = 0;
      break;
    }
    case 'fight': {
      const i1 = human.getIntent(p1, p2, dt);
      const i2 = ai.getIntent(p2, p1, dt);
      p1.update(dt, i1);
      p2.update(dt, i2);
      resolvePair(p1, p2);
      p1.maybeEnterStunLoop(); p2.maybeEnterStunLoop();
      handleEvents();
      break;
    }
    case 'ult': case 'pdodge': {
      // fighters are in cinematic state; keep ticking for interpolation bookkeeping
      p1.update(dt, NEUTRAL); p2.update(dt, NEUTRAL);
      handleEvents();
      break;
    }
    case 'ko': case 'roundend': case 'victory': {
      p1.update(dt, NEUTRAL); p2.update(dt, NEUTRAL);
      events.length = 0;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// render (every display frame)
// ---------------------------------------------------------------------------
let rawDt = 0.016;
let fpsTimer = 0;

function render(vdt, alpha, renderDt) {
  rawDt = renderDt;
  G.stateT += rawDt;

  // real-time state transitions
  if (G.state === 'intro') {
    if (G.introPhase === 0 && G.stateT > 1.55) {
      G.introPhase = 1;
      hud.roundCard('FIGHT!', '', 700);
      audio.bell(1);
    }
    if (G.stateT > 2.0) {
      fightCam.override = null;
      setState('fight');
    }
  } else if (G.state === 'ko') {
    if (G.stateT > ROUNDS.KO_SLOWMO_TIME) {
      loop.timeScale = 1;
      endRound(G.koWinner);
    }
  } else if (G.state === 'roundend') {
    if (G.stateT > 2.4) {
      if (G.scores[0] >= ROUNDS.TO_WIN || G.scores[1] >= ROUNDS.TO_WIN) finishMatch();
      else startRound();
    }
  } else if (G.state === 'title') {
    // slow orbit showcase
    if (!fightCam.override || fightCam.override.name !== 'titleOrbit') {
      const orbit = function titleOrbit(cam, rdt, t) {
        const a = t * 0.14;
        cam.position.set(Math.sin(a) * 7.6, 2.4 + Math.sin(t * 0.4) * 0.4, Math.cos(a) * 7.6);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 1.5, 0);
      };
      Object.defineProperty(orbit, 'name', { value: 'titleOrbit' });
      fightCam.override = orbit;
    }
  }

  // slow-mo bookkeeping (real time)
  if (G.slowmoT > 0) {
    G.slowmoT -= rawDt;
    if (G.slowmoT <= 0 && G.state !== 'ko') loop.timeScale = 1;
  }

  // visuals
  p1.syncVisual(alpha, vdt);
  p2.syncVisual(alpha, vdt);
  if (cinematic.active) cinematic.update(rawDt);
  if (pdodgeCine.active) pdodgeCine.update(rawDt);
  effects.update(vdt);
  effects.updateTrails([p1, p2], vdt);
  effects.updateShields([p1, p2], rawDt);
  fightCam.update(rawDt);
  hud.bars(p1, p2, rawDt);

  // debug overlay
  fpsTimer += rawDt;
  if (G.debugHud && fpsTimer > 0.25) {
    fpsTimer = 0;
    const gov = loop.renderTargetFps ? ` · locked ${loop.renderTargetFps}fps` : '';
    hud.fps(`${dynres.fps} fps · ${(dynres.scale * 100) | 0}% res · ${tier.name} · ${dynres.refresh}Hz${gov}`);
  }

  renderer.render(scene, camera);
}

const loop = new GameLoop({
  update,
  render,
  frameRendered: (renderMs) => dynres.frame(renderMs),
  governor: {
    getRefresh: () => dynres.refresh,
    onGovern: (fps) => { dynres.targetFps = fps; },
  },
});

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
addEventListener('resize', () => {
  resizeRendererToDisplay(renderer, camera);
  fightCam.setAspect(innerWidth / innerHeight);
});

addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    G.debugHud = !G.debugHud;
    hud.fpsVisible(G.debugHud);
  }
  if (e.code === 'Enter' && G.state === 'title') startBtn.click();
});

const startBtn = document.getElementById('start-btn');
const diffBtns = [...document.querySelectorAll('.diff-btn')];
diffBtns.forEach((b) => {
  b.addEventListener('click', () => {
    diffBtns.forEach((x) => x.classList.toggle('sel', x === b));
    G.difficulty = b.dataset.diff;
    audio.unlock(); audio.uiTick();
  });
});
startBtn.addEventListener('click', () => {
  audio.unlock();
  if (G.state === 'title') startMatch();
});
document.getElementById('rematch-btn').addEventListener('click', () => {
  audio.unlock();
  if (G.state === 'victory') startMatch();
});
document.getElementById('menu-btn').addEventListener('click', () => {
  if (G.state !== 'victory') return;
  hud.hideVictory();
  hud.showHud(false);
  hud.showTitle(true);
  fightCam.override = null;
  setState('title');
  p1.resetForRound(0, -3.1, { x: 0, y: 3.1 });
  p2.resetForRound(0, 3.1, { x: 0, y: -3.1 });
  audio.uiTick();
});

input.bindTouch({
  zone: document.getElementById('joy-zone'),
  base: document.getElementById('joy-base'),
  knob: document.getElementById('joy-knob'),
  btnLight: document.getElementById('btn-light'),
  btnHeavy: document.getElementById('btn-heavy'),
  btnBlock: document.getElementById('btn-block'),
  btnDash: document.getElementById('btn-dash'),
  btnUlt: document.getElementById('btn-ult'),
});

// initial placement for the title showcase
p1.resetForRound(0, -3.1, { x: 0, y: 3.1 });
p2.resetForRound(0, 3.1, { x: 0, y: -3.1 });
hud.showHud(false);
hud.showTitle(true);

// ---------------------------------------------------------------------------
// Warm-up: force-compile every shader program and upload every texture once,
// out of sight, so the first dash / hit / block of a real fight never hitches
// on lazy compilation.
// ---------------------------------------------------------------------------
{
  const deep = new THREE.Vector3(0, -60, 0);
  effects.impact(deep.clone(), 0xffffff, true);
  effects.blockSpark(deep.clone(), 1);
  effects.shieldShatter(deep.clone());
  effects.groundDust(deep.clone(), 3);
  effects.koBurst(deep.clone());
  effects.setAura(p1, true);
  effects._spawnGhostNow(p1);
  effects._spawnGhostNow(p2);
  av1.setGhost(1); av2.setGhost(1);
  p1.blocking = true; p2.blocking = true;
  effects.updateShields([p1, p2], 0.016);
  effects.update(0.016);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  av1.setGhost(0); av2.setGhost(0);
  p1.blocking = false; p2.blocking = false;
  effects.setAura(p1, false);
  effects.clearTransient();
}

document.getElementById('loading').remove();
loop.start();

// small debug/testing handle (also used by automated checks)
window.__IRONV__ = { G, p1, p2, ai, input, loop, tier, dynres, effects, startMatch };
