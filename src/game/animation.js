import { EASE, clamp01, lerp, smoothstep, damp } from '../engine/utils.js?v=15';
import { LIGHT, HEAVY } from './constants.js?v=15';

// ---------------------------------------------------------------------------
// Pose-keyframe animation with universal crossfade blending.
//
// A pose maps joint name -> [rx, ry, rz] (radians), plus the special channel
// 'hipsPos' -> [x, y, z] offset of the hips from their rest height. Any joint
// a clip doesn't mention eases back to the guard STANCE. When a new clip is
// played, the CURRENT evaluated pose is snapshotted and blended into the new
// clip — this is what makes feint switches (light↔heavy mid-windup) read as
// one smooth motion instead of a pop.
//
// Attack clip keyframes are generated from combat constants so that the visual
// contact frame always matches the hitbox's active window exactly.
// ---------------------------------------------------------------------------

// Boxing guard stance — the resting pose everything returns to.
// (Character faces +Z; lead hand = LEFT.)
export const STANCE = {
  hipsPos: [0, -0.05, 0],
  hips: [0.06, -0.28, 0],
  torso: [0.1, -0.1, 0],
  chest: [0.08, -0.18, 0],
  neck: [0, 0.3, 0],
  head: [-0.06, 0.14, 0],
  shoulderL: [-1.06, 0.32, 0.32],
  elbowL: [-1.95, 0, 0.12],
  gloveL: [-0.3, 0, 0],
  shoulderR: [-0.92, -0.42, -0.3],
  elbowR: [-2.2, 0, -0.1],
  gloveR: [-0.3, 0, 0],
  thighL: [-0.3, 0.06, 0.03],
  kneeL: [0.35, 0, 0],
  footL: [-0.12, 0.06, 0],
  thighR: [0.02, -0.1, -0.03],
  kneeR: [0.3, 0, 0],
  footR: [-0.2, -0.06, 0],
};

const CENTER_JOINTS = ['hips', 'torso', 'chest', 'neck', 'head'];

// Mirror a pose across the character's sagittal plane (swap L/R, flip Y/Z rot).
export function mirrorPose(pose) {
  const out = {};
  for (const [k, v] of Object.entries(pose)) {
    if (k === 'hipsPos') { out[k] = [-v[0], v[1], v[2]]; continue; }
    let name = k;
    if (k.endsWith('L')) name = k.slice(0, -1) + 'R';
    else if (k.endsWith('R')) name = k.slice(0, -1) + 'L';
    out[name] = [v[0], -v[1], -v[2]];
  }
  return out;
}

function key(t, pose, e = 'inOutCubic') { return { t, pose, e }; }

// Forward-fill sparse keys so evaluation is a simple pair-lerp.
function bake(keys, loop = false, opts = {}) {
  const joints = new Set(['hipsPos']);
  keys.forEach((k) => Object.keys(k.pose).forEach((j) => joints.add(j)));
  let prev = {};
  for (const j of joints) prev[j] = STANCE[j] ? [...STANCE[j]] : [0, 0, 0];
  const baked = keys.map((k) => {
    const full = {};
    for (const j of joints) {
      full[j] = k.pose[j] ? [...k.pose[j]] : [...prev[j]];
    }
    prev = full;
    return { t: k.t, pose: full, e: k.e };
  });
  return { keys: baked, joints: [...joints], loop, ...opts };
}

// ============================================================================
// Attack clips generated from combat timing constants.
// ============================================================================

function makeJab(C) {
  const T = C.WINDUP + C.ACTIVE + C.RECOVER;
  const w = C.WINDUP / T, a = (C.WINDUP + C.ACTIVE) / T;
  // Lead-hand (LEFT) STRAIGHT PUNCH: a compact coil (chin slips behind the lead
  // shoulder, rear hand glued to the chin), then the fist PISTONS DEAD-STRAIGHT
  // at shoulder height — the shoulder protracts FORWARD (never swings up, which
  // was the old "kangaroo" look), the elbow snaps full behind the fist, the fist
  // pronates hard — all driven by an explosive hip+chest turn and a rear-foot
  // ball pivot. Wide, aggressive, anime-scale, but a clean straight line out
  // and a faster straight line back.
  return bake([
    key(0, {}),
    key(w * 0.55, {                       // fast compact coil — load the turn
      chest: [0.12, -0.5, 0.02],
      torso: [0.14, -0.26, 0],
      hips: [0.07, -0.34, 0],
      hipsPos: [0, -0.07, -0.03],
      shoulderL: [-0.86, 0.5, 0.3],       // lead arm cocks, elbow to the ribs
      elbowL: [-2.35, 0, 0.12],
      gloveL: [-0.3, 0, 0.22],
      shoulderR: [-0.9, -0.5, -0.34],     // rear glove pinned to the chin
      elbowR: [-2.34, 0, -0.1],
      head: [0.0, 0.34, 0.08],            // chin slips behind the lead shoulder
      neck: [0, 0.4, 0],
      footL: [-0.12, 0.02, 0],
      footR: [-0.18, 0.1, 0],
    }, 'outQuart'),
    key(w, {                              // deepest coil — shoulder loaded to fire
      chest: [0.14, -0.6, 0.02],
      torso: [0.16, -0.3, 0],
      hips: [0.08, -0.38, 0],
      hipsPos: [0, -0.1, -0.04],
      shoulderL: [-0.8, 0.54, 0.32],
      elbowL: [-2.5, 0, 0.12],
      gloveL: [-0.26, 0, 0.32],
      head: [0.0, 0.38, 0.09],
      neck: [0, 0.44, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.35, {             // KINETIC CHAIN: hips+chest whip open first,
      chest: [0.16, 0.16, -0.02],         // the fist just leaving the chin
      torso: [0.2, 0.16, 0],
      hips: [0.1, 0.06, 0],
      hipsPos: [0, -0.085, 0.12],
      shoulderL: [-1.16, 0.34, 0.24],     // protracting FORWARD, arm ~40% out
      elbowL: [-1.35, 0, 0.06],
      gloveL: [-0.5, 0, 0.7],
      shoulderR: [-0.82, -0.56, -0.36],
      elbowR: [-2.42, 0, -0.1],
      head: [0.03, 0.2, 0.0],
      neck: [0, 0.24, 0],
      kneeL: [0.46, 0, 0],
      footR: [-0.16, 0.28, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.62, {             // FULL EXTENSION — dead-straight, shoulder height
      chest: [0.18, 0.5, -0.03],          // big chest turn behind the fist
      torso: [0.24, 0.28, 0],
      hips: [0.13, 0.08, 0],
      hipsPos: [0, -0.07, 0.28],          // huge weight throw straight forward
      shoulderL: [-1.5, 0.12, 0.12],      // upper arm FORWARD-horizontal, not up
      elbowL: [0.0, 0, 0],                // elbow dead straight behind the fist
      gloveL: [-0.5, 0, 1.5],             // hard pronation snap
      shoulderR: [-0.72, -0.62, -0.4],    // rear guard stays home at the chin
      elbowR: [-2.5, 0, -0.1],
      head: [0.06, 0.02, -0.06],          // chin tucked behind the lead shoulder
      neck: [0.04, 0.04, 0],
      kneeL: [0.5, 0, 0],
      footR: [-0.12, 0.5, 0],             // rear foot snaps onto the ball
    }, 'outQuart'),
    key(a + 0.05, {                       // brief hold at the snap
      chest: [0.16, 0.42, -0.02],
      shoulderL: [-1.44, 0.14, 0.1],
      elbowL: [-0.16, 0, 0.02],
      gloveL: [-0.5, 0, 1.35],
      hipsPos: [0, -0.075, 0.16],
      head: [0.05, 0.06, -0.05],
    }, 'outQuad'),
    key(a + (1 - a) * 0.4, {              // retract STRAIGHT back — faster than it went out
      chest: [0.1, -0.12, 0],
      torso: [0.12, -0.08, 0],
      shoulderL: [-1.0, 0.34, 0.3],
      elbowL: [-1.9, 0, 0.12],
      gloveL: [-0.3, 0, 0.2],
      footR: [-0.19, 0.08, 0],
      hipsPos: [0, -0.06, 0.03],
    }, 'outQuart'),
    key(1, {}, 'inOutCubic'),             // settle into stance
  ]);
}

function makeHeavy(C) {
  const T = C.WINDUP + C.ACTIVE + C.RECOVER;
  const w = C.WINDUP / T, a = (C.WINDUP + C.ACTIVE) / T;
  // Rear-hand (RIGHT) DOWNWARD-STROKE HOOK / OVERHAND SMASH: the fist cocks
  // HIGH and back by the ear as the torso coils away and winds up; then the
  // rear shoulder comes OVER THE TOP and the fist smashes DOWN-AND-ACROSS on a
  // steep diagonal, the whole torso pitching forward and DOWN through the blow
  // (hips → chest → shoulder), the arm hooking bent, knees dropping the weight.
  // A wrecking, aggressive downward blow that folds past the target before
  // recoiling to guard.
  return bake([
    key(0, {}),
    key(w * 0.45, {                       // coil away + wind UP — cock the fist high
      chest: [-0.04, -0.66, 0.08],        // lean back a touch to load the drop
      torso: [0.04, -0.34, 0],
      hips: [0.07, -0.36, 0],
      hipsPos: [-0.04, -0.12, -0.05],
      shoulderR: [-1.9, -0.5, -0.5],      // rear elbow rises HIGH (cocked up-back)
      elbowR: [-1.7, 0, -0.2],
      gloveR: [-0.5, 0, -0.3],
      shoulderL: [-1.24, 0.5, 0.3],       // lead glove glued to the chin
      elbowL: [-2.45, 0, 0.12],
      head: [0.06, 0.4, 0.05],
      neck: [0, 0.44, 0],
      kneeL: [0.5, 0, 0], kneeR: [0.56, 0, 0],
      footR: [-0.22, -0.18, 0],
    }, 'outQuart'),
    key(w, {                              // fully cocked — fist high by the ear, coiled
      chest: [-0.08, -0.82, 0.1],
      torso: [0.02, -0.42, 0],
      hips: [0.08, -0.46, 0],
      hipsPos: [-0.06, -0.16, -0.07],
      shoulderR: [-2.15, -0.46, -0.56],   // arm cocked past vertical, up-and-back
      elbowR: [-1.55, 0, -0.22],
      gloveR: [-0.62, 0, -0.28],          // glove up behind the ear
      head: [0.08, 0.46, 0.06],
      neck: [0, 0.48, 0],
      kneeL: [0.58, 0, 0], kneeR: [0.64, 0, 0],
      footR: [-0.22, -0.3, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.28, {             // KINETIC CHAIN: hips wrench, shoulder comes over the top
      chest: [0.16, 0.02, 0.02],          // torso begins pitching forward + turning through
      torso: [0.24, 0.32, 0],
      hips: [0.11, 0.44, 0],
      hipsPos: [0.02, -0.13, 0.04],
      shoulderR: [-1.86, 0.06, -0.2],     // shoulder coming over the top, arm dropping
      elbowR: [-1.35, 0, -0.15],
      gloveR: [-0.5, 0, -0.5],
      shoulderL: [-1.12, 0.5, 0.33],
      elbowL: [-2.48, 0, 0.13],
      head: [0.14, 0.22, 0.02],           // head starts dropping with the smash
      neck: [0, 0.26, 0],
      kneeL: [0.52, 0, 0], kneeR: [0.5, 0, 0],
      footR: [-0.18, 0.42, 0], footL: [-0.12, 0.1, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.55, {             // the SMASH LANDS — steep downward diagonal
      chest: [0.62, 0.82, -0.08],         // torso PITCHES DOWN + across through the target
      torso: [0.46, 0.5, 0],
      hips: [0.12, 0.64, 0],
      hipsPos: [0.1, -0.16, 0.16],        // weight slams down + forward
      shoulderR: [-1.2, 0.66, 0.2],       // shoulder driven over-and-down
      elbowR: [-1.05, 0, -0.1],           // arm hooking bent through the drop
      gloveR: [-0.2, 0, -1.15],           // fist smashes down, palm rolls over
      shoulderL: [-0.86, 0.52, 0.34],
      elbowL: [-2.5, 0, 0.14],
      head: [0.4, -0.02, -0.04],          // head drops hard behind the blow
      neck: [0.1, 0.0, 0],
      kneeL: [0.36, 0, 0], kneeR: [0.28, 0, 0],   // knees bend, dropping the weight
      footR: [-0.1, 1.0, 0], footL: [-0.12, 0.24, 0],
    }, 'outQuart'),
    key(a + 0.06, {                       // folds over the blow — over-rotates down + across
      chest: [0.78, 1.02, -0.12],
      torso: [0.5, 0.56, 0],
      hips: [0.12, 0.72, 0],
      shoulderR: [-1.02, 0.9, 0.4],
      elbowR: [-1.3, 0, -0.08],
      gloveR: [-0.24, 0, -0.95],
      shoulderL: [-0.82, 0.5, 0.28],
      head: [0.5, -0.06, -0.05],
      hipsPos: [0.13, -0.2, 0.12],
      kneeL: [0.32, 0, 0], kneeR: [0.24, 0, 0],
      footR: [-0.12, 1.1, 0],
    }, 'outQuad'),
    key(a + (1 - a) * 0.5, {              // rise + recoil back toward guard
      chest: [0.16, 0.02, 0],
      torso: [0.16, 0.0, 0],
      hips: [0.07, -0.08, 0],
      shoulderR: [-1.05, -0.3, -0.28],
      elbowR: [-2.0, 0, -0.1],
      gloveR: [-0.3, 0, -0.2],
      head: [0.05, 0.04, 0],
      footR: [-0.19, -0.04, 0],
      hipsPos: [0.03, -0.08, 0.02],
      kneeL: [0.4, 0, 0], kneeR: [0.4, 0, 0],
    }, 'outQuart'),
    key(1, {}, 'inOutCubic'),
  ]);
}

// ============================================================================
// Static / reaction clips.
// ============================================================================

const CLIP_DEFS = {
  idle: bake([key(0, {}), key(1, {})], true, { locomotion: true }),

  block: bake([
    key(0, {
      hipsPos: [0, -0.1, 0],
      chest: [0.16, -0.1, 0],
      head: [0.1, 0.05, 0],
      shoulderL: [-1.32, 0.5, 0.3],
      elbowL: [-2.5, 0.15, 0.2],
      shoulderR: [-1.32, -0.55, -0.28],
      elbowR: [-2.55, -0.15, -0.2],
      kneeL: [0.45, 0, 0],
      kneeR: [0.42, 0, 0],
    }),
    key(0.33, {                            // guard shifts — never a statue
      hipsPos: [0, -0.115, 0.01],
      chest: [0.18, -0.14, 0.015],
      head: [0.12, 0.08, -0.02],
      shoulderL: [-1.36, 0.52, 0.31],
      elbowL: [-2.54, 0.15, 0.2],
      shoulderR: [-1.28, -0.53, -0.27],
      elbowR: [-2.5, -0.15, -0.2],
      kneeL: [0.48, 0, 0],
      kneeR: [0.44, 0, 0],
    }, 'inOutCubic'),
    key(0.66, {
      hipsPos: [0, -0.105, -0.008],
      chest: [0.15, -0.07, -0.015],
      head: [0.09, 0.03, 0.02],
      shoulderL: [-1.29, 0.49, 0.29],
      elbowL: [-2.47, 0.15, 0.2],
      shoulderR: [-1.35, -0.57, -0.29],
      elbowR: [-2.58, -0.15, -0.2],
      kneeL: [0.43, 0, 0],
      kneeR: [0.45, 0, 0],
    }, 'inOutCubic'),
    key(1, {
      hipsPos: [0, -0.1, 0],
      chest: [0.16, -0.1, 0],
      head: [0.1, 0.05, 0],
      shoulderL: [-1.32, 0.5, 0.3],
      elbowL: [-2.5, 0.15, 0.2],
      shoulderR: [-1.32, -0.55, -0.28],
      elbowR: [-2.55, -0.15, -0.2],
      kneeL: [0.45, 0, 0],
      kneeR: [0.42, 0, 0],
    }, 'inOutCubic'),
  ], true, { locomotion: true }),

  blockHit: bake([
    key(0, {
      hipsPos: [0, -0.1, 0],
      shoulderL: [-1.32, 0.5, 0.3], elbowL: [-2.5, 0.15, 0.2],
      shoulderR: [-1.32, -0.55, -0.28], elbowR: [-2.55, -0.15, -0.2],
    }),
    key(0.3, {
      hipsPos: [0, -0.14, -0.12],
      chest: [0.3, -0.1, 0],
      head: [0.16, 0.05, 0],
      shoulderL: [-1.45, 0.55, 0.3], elbowL: [-2.6, 0.15, 0.2],
      shoulderR: [-1.45, -0.6, -0.28], elbowR: [-2.65, -0.15, -0.2],
    }, 'outQuart'),
    key(1, {
      hipsPos: [0, -0.1, 0],
      shoulderL: [-1.32, 0.5, 0.3], elbowL: [-2.5, 0.15, 0.2],
      shoulderR: [-1.32, -0.55, -0.28], elbowR: [-2.55, -0.15, -0.2],
    }, 'outCubic'),
  ]),

  hitLight: bake([
    key(0, {}),
    key(0.14, {                            // sharp snap on impact — head whips hard
      head: [-0.64, 0.36, 0.16],
      chest: [-0.32, -0.36, 0.03],
      torso: [-0.13, -0.18, 0],
      hipsPos: [0, -0.06, -0.18],
      shoulderL: [-0.6, 0.46, 0.62],
      shoulderR: [-0.5, -0.56, -0.62],
    }, 'outQuart'),
    key(0.42, {                            // overshoot settle back through center
      head: [-0.18, 0.2, 0.04],
      chest: [-0.06, -0.22, 0],
      torso: [-0.02, -0.12, 0],
      hipsPos: [0, -0.06, -0.05],
      shoulderL: [-0.9, 0.38, 0.4],
      shoulderR: [-0.8, -0.46, -0.4],
    }, 'outBack'),
    key(1, {}, 'inOutCubic'),
  ]),

  hitHeavy: bake([
    key(0, {}),
    key(0.13, {                            // violent snap — whole body rocked
      head: [-0.9, 0.46, 0.26],
      chest: [-0.52, -0.52, 0.09],
      torso: [-0.24, -0.26, 0],
      hips: [-0.12, -0.36, 0],
      hipsPos: [0, -0.11, -0.36],
      shoulderL: [-0.3, 0.6, 0.84],
      elbowL: [-1.3, 0, 0.2],
      shoulderR: [-0.2, -0.66, -0.84],
      elbowR: [-1.4, 0, -0.2],
      kneeL: [0.52, 0, 0], kneeR: [0.58, 0, 0],
    }, 'outQuart'),
    key(0.4, {                             // reeling — weight drops back
      head: [-0.42, 0.3, 0.12],
      chest: [-0.26, -0.36, 0.04],
      hipsPos: [0, -0.16, -0.2],
      kneeL: [0.62, 0, 0], kneeR: [0.66, 0, 0],
    }, 'outBack'),
    key(0.66, {                            // staggered recovery beat
      head: [-0.2, 0.22, 0.06],
      chest: [-0.12, -0.25, 0],
      hipsPos: [0, -0.12, -0.12],
    }, 'inOutCubic'),
    key(1, {}, 'inOutCubic'),
  ], false, { tremble: 0.008 }),

  guardBreak: bake([
    key(0, {}),
    key(0.2, {                            // shield shattered — arms blown wide
      head: [-0.5, 0.2, 0],
      chest: [-0.3, -0.15, 0],
      hipsPos: [0, -0.08, -0.16],
      shoulderL: [-0.5, 1.15, 0.9], elbowL: [-0.7, 0, 0.3],
      shoulderR: [-0.4, -1.2, -0.9], elbowR: [-0.8, 0, -0.3],
    }, 'outQuart'),
    key(1, {
      head: [-0.35, 0.15, 0.05],
      chest: [-0.2, -0.1, 0],
      hipsPos: [0, -0.12, -0.1],
      shoulderL: [-0.4, 0.9, 0.8], elbowL: [-1.0, 0, 0.3],
      shoulderR: [-0.3, -0.95, -0.8], elbowR: [-1.1, 0, -0.3],
    }, 'outCubic'),
  ]),

  stunned: bake([                          // dizzy sway loop
    key(0, {
      head: [-0.3, 0.3, 0.12],
      chest: [-0.18, -0.2, 0.06],
      hipsPos: [0, -0.14, -0.06],
      shoulderL: [-0.35, 0.85, 0.75], elbowL: [-1.2, 0, 0.3],
      shoulderR: [-0.3, -0.9, -0.75], elbowR: [-1.3, 0, -0.3],
      kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0],
    }),
    key(0.5, {
      head: [-0.34, -0.25, -0.12],
      chest: [-0.14, 0.15, -0.06],
      hipsPos: [0, -0.17, -0.02],
    }, 'inOutCubic'),
    key(1, {
      head: [-0.3, 0.3, 0.12],
      chest: [-0.18, -0.2, 0.06],
      hipsPos: [0, -0.14, -0.06],
    }, 'inOutCubic'),
  ], true),

  // Dashes are BOXER SLIPS/ROLLS, not flat slides: the fighter digs low into a
  // half-crouch and the upper body ROLLS through a weaving arc — the head
  // traces a U, ducking under and rising on the far side, guard held high and
  // i-frames covering the dig. Forward = duck-under drive; back = lean-back
  // pull-counter; left/right = roll the head down-and-under to that side.
  dashF: bake([
    key(0, {}),
    key(0.16, {                            // DIG DEEP under the incoming punch — head near hip height
      torso: [1.0, -0.1, 0.18], chest: [0.78, -0.15, 0.22], head: [0.56, 0.14, 0.18],
      hipsPos: [0, -0.68, 0.2],
      shoulderL: [-1.72, 0.46, 0.36], elbowL: [-2.72, 0, 0.15],
      shoulderR: [-1.62, -0.56, -0.32], elbowR: [-2.8, 0, -0.15],
      thighL: [-0.84, 0.06, 0.03], thighR: [-0.7, -0.1, -0.03],
      kneeL: [1.52, 0, 0], kneeR: [1.52, 0, 0],
      footL: [-0.64, 0.06, 0], footR: [-0.68, -0.06, 0],
    }, 'outQuart'),
    key(0.5, {                             // weave up through to the far side (still low)
      torso: [0.5, -0.1, -0.14], chest: [0.36, -0.15, -0.16], head: [-0.26, 0.14, -0.14],
      hipsPos: [0, -0.4, 0.14],
      shoulderL: [-1.4, 0.44, 0.3], elbowL: [-2.48, 0, 0.15],
      shoulderR: [-1.3, -0.54, -0.3], elbowR: [-2.56, 0, -0.15],
      thighL: [-0.5, 0.06, 0.03], thighR: [-0.4, -0.1, -0.03],
      kneeL: [1.06, 0, 0], kneeR: [1.06, 0, 0],
      footL: [-0.4, 0.06, 0], footR: [-0.44, -0.06, 0],
    }, 'inOutCubic'),
    key(0.82, {                            // rise back to guard — lead foot catches
      torso: [0.2, -0.1, -0.03], chest: [0.14, -0.16, -0.03], head: [-0.1, 0.14, -0.02],
      hipsPos: [0, -0.13, 0.04],
      thighL: [-0.44, 0.06, 0.03], thighR: [0.0, -0.1, -0.03],
      kneeL: [0.6, 0, 0], kneeR: [0.42, 0, 0],
      footL: [-0.2, 0.06, 0], footR: [-0.28, -0.06, 0],
    }, 'outQuad'),
    key(1, {}, 'outBack'),
  ]),
  dashB: bake([
    key(0, {}),
    key(0.16, {                            // snap the weight back — pull off the line
      torso: [-0.5, -0.1, 0.12], chest: [-0.34, -0.17, 0.16], head: [0.12, 0.14, 0.1],
      hipsPos: [0.04, -0.4, -0.18],
      hips: [0.06, -0.28, 0.14],
      shoulderL: [-1.52, 0.5, 0.42], elbowL: [-2.6, 0, 0.15],
      shoulderR: [-1.44, -0.56, -0.4], elbowR: [-2.68, 0, -0.15],
      thighL: [-0.5, 0.06, 0.05], thighR: [-0.42, -0.1, -0.03],
      kneeL: [1.12, 0, 0], kneeR: [1.2, 0, 0],
      footL: [-0.42, 0.06, 0], footR: [-0.48, -0.06, 0],
    }, 'outQuart'),
    key(0.5, {                             // roll through center as the weight resets
      torso: [-0.34, -0.1, -0.06], chest: [-0.22, -0.17, -0.08], head: [0.06, 0.14, -0.05],
      hipsPos: [-0.02, -0.32, -0.1],
      hips: [0.06, -0.28, -0.05],
      thighL: [-0.4, 0.06, 0.03], thighR: [-0.34, -0.1, -0.03],
      kneeL: [0.9, 0, 0], kneeR: [0.96, 0, 0],
      footL: [-0.34, 0.06, 0], footR: [-0.4, -0.06, 0],
    }, 'inOutCubic'),
    key(0.82, {                            // roll back down into guard
      torso: [-0.12, -0.1, -0.02], chest: [-0.06, -0.18, -0.02], head: [0.0, 0.14, 0],
      hipsPos: [0, -0.14, -0.03],
      thighL: [-0.34, 0.06, 0.03], thighR: [0.0, -0.1, -0.03],
      kneeL: [0.5, 0, 0], kneeR: [0.4, 0, 0],
      footL: [-0.16, 0.06, 0], footR: [-0.24, -0.06, 0],
    }, 'outQuad'),
    key(1, {}, 'outBack'),
  ]),
  dashL: bake([
    key(0, {}),
    key(0.14, {                            // drop into the roll — duck down and in
      hips: [0.06, -0.28, 0.32], torso: [0.56, -0.1, 0.34], chest: [0.44, -0.16, 0.28],
      head: [0.42, 0.14, 0.16],
      hipsPos: [0.06, -0.54, 0.06],
      thighL: [-0.78, 0.06, 0.1], thighR: [-0.44, -0.1, -0.05],
      kneeL: [1.46, 0, 0], kneeR: [1.0, 0, 0],
      footL: [-0.6, 0.06, 0], footR: [-0.44, -0.06, 0],
      shoulderL: [-1.34, 0.44, 0.66],      // inside arm digs, glove stays high
      elbowL: [-2.3, 0, 0.2],
      shoulderR: [-1.05, -0.6, -0.22],     // outside arm sweeps for balance
      elbowR: [-2.0, 0, -0.15],
    }, 'outQuart'),
    key(0.46, {                            // sweep through the bottom of the U to the left
      hips: [0.06, -0.28, 0.5], torso: [0.2, -0.1, 0.46], chest: [0.16, -0.16, 0.4],
      head: [-0.02, 0.14, 0.02],
      hipsPos: [0.02, -0.4, 0.02],
      thighL: [-0.56, 0.06, 0.12], thighR: [-0.3, -0.1, -0.05],
      kneeL: [1.16, 0, 0], kneeR: [0.74, 0, 0],
      footL: [-0.46, 0.06, 0], footR: [-0.34, -0.06, 0],
    }, 'inOutCubic'),
    key(0.8, {                             // rise up on the left side back to guard
      hips: [0.06, -0.28, 0.22], torso: [0.14, -0.1, 0.16], chest: [0.1, -0.17, 0.12],
      head: [-0.1, 0.14, -0.06],
      hipsPos: [0, -0.16, 0],
      thighL: [-0.4, 0.06, 0.06], thighR: [-0.06, -0.1, -0.03],
      kneeL: [0.6, 0, 0], kneeR: [0.42, 0, 0],
      footL: [-0.2, 0.06, 0], footR: [-0.26, -0.06, 0],
    }, 'outQuad'),
    key(1, {}, 'outBack'),
  ]),
  dashR: bake([
    key(0, {}),
    key(0.14, {                            // drop into the roll — duck down and in
      hips: [0.06, -0.28, -0.32], torso: [0.56, -0.1, -0.34], chest: [0.44, -0.16, -0.28],
      head: [0.42, 0.14, -0.16],
      hipsPos: [-0.06, -0.54, 0.06],
      thighR: [-0.78, -0.1, -0.1], thighL: [-0.34, 0.06, 0.05],
      kneeR: [1.46, 0, 0], kneeL: [1.0, 0, 0],
      footR: [-0.6, -0.06, 0], footL: [-0.44, 0.06, 0],
      shoulderR: [-1.34, -0.44, -0.66],    // inside arm digs, glove stays high
      elbowR: [-2.3, 0, -0.2],
      shoulderL: [-1.05, 0.6, 0.22],       // outside arm sweeps for balance
      elbowL: [-2.0, 0, 0.15],
    }, 'outQuart'),
    key(0.46, {                            // sweep through the bottom of the U to the right
      hips: [0.06, -0.28, -0.5], torso: [0.2, -0.1, -0.46], chest: [0.16, -0.16, -0.4],
      head: [-0.02, 0.14, -0.02],
      hipsPos: [-0.02, -0.4, 0.02],
      thighR: [-0.56, -0.1, -0.12], thighL: [-0.3, 0.06, 0.05],
      kneeR: [1.16, 0, 0], kneeL: [0.74, 0, 0],
      footR: [-0.46, -0.06, 0], footL: [-0.34, 0.06, 0],
    }, 'inOutCubic'),
    key(0.8, {                             // rise up on the right side back to guard
      hips: [0.06, -0.28, -0.22], torso: [0.14, -0.1, -0.16], chest: [0.1, -0.17, -0.12],
      head: [-0.1, 0.14, 0.06],
      hipsPos: [0, -0.16, 0],
      thighR: [-0.4, -0.1, -0.06], thighL: [-0.06, 0.06, 0.03],
      kneeR: [0.6, 0, 0], kneeL: [0.42, 0, 0],
      footR: [-0.2, -0.06, 0], footL: [-0.26, 0.06, 0],
    }, 'outQuad'),
    key(1, {}, 'outBack'),
  ]),

  ko: bake([
    key(0, {}),
    key(0.16, {                            // the lights go out
      head: [-0.7, 0.3, 0.2],
      chest: [-0.4, -0.3, 0.05],
      hipsPos: [0, -0.05, -0.15],
      shoulderL: [-0.3, 0.5, 0.6], elbowL: [-0.6, 0, 0.2],
      shoulderR: [-0.2, -0.55, -0.6], elbowR: [-0.7, 0, -0.2],
    }, 'outQuad'),
    key(0.62, {                            // falling backward
      hips: [-1.2, -0.28, 0],
      hipsPos: [0, -0.55, -0.5],
      head: [-0.5, 0.2, 0.1],
      chest: [-0.25, -0.15, 0],
      torso: [-0.1, 0, 0],
      thighL: [0.5, 0.1, 0.05], kneeL: [0.4, 0, 0],
      thighR: [0.65, -0.15, -0.05], kneeR: [0.5, 0, 0],
      shoulderL: [-0.15, 0.8, 0.9], elbowL: [-0.4, 0, 0.2],
      shoulderR: [-0.1, -0.85, -0.9], elbowR: [-0.5, 0, -0.2],
    }, 'inQuad'),
    key(0.78, {                            // impact bounce
      hips: [-1.52, -0.28, 0],
      hipsPos: [0, -0.78, -0.62],
      head: [-0.2, 0.1, 0.05],
      thighL: [0.25, 0.12, 0.05], kneeL: [0.25, 0, 0],
      thighR: [0.4, -0.18, -0.05], kneeR: [0.3, 0, 0],
    }, 'outQuad'),
    key(1, {                               // sprawled flat
      hips: [-1.58, -0.28, 0],
      hipsPos: [0, -0.82, -0.66],
      head: [-0.15, 0.2, 0.1],
      chest: [-0.1, -0.1, 0],
      thighL: [0.18, 0.15, 0.06], kneeL: [0.2, 0, 0],
      thighR: [0.32, -0.2, -0.06], kneeR: [0.24, 0, 0],
      shoulderL: [-0.05, 1.0, 1.1], elbowL: [-0.3, 0, 0.2],
      shoulderR: [0, -1.05, -1.1], elbowR: [-0.35, 0, -0.2],
    }, 'outCubic'),
  ]),

  // --- ultimate ------------------------------------------------------------
  // Charge-up: a continuously sinking coil — crouch deepens, fists draw to
  // the hips, shoulders wind tighter, then the whole body rises a breath at
  // the moment of release. Blue telegraph shine rides on top.
  ultCharge: bake([
    key(0, {}),
    key(0.3, {
      hipsPos: [0, -0.2, 0],
      chest: [0.3, -0.1, 0], torso: [0.18, -0.05, 0], head: [-0.22, 0.1, 0],
      shoulderL: [-0.6, 0.6, 0.38], elbowL: [-2.45, 0, 0.2],
      shoulderR: [-0.55, -0.66, -0.38], elbowR: [-2.5, 0, -0.2],
      kneeL: [0.75, 0, 0], kneeR: [0.75, 0, 0],
      footL: [-0.2, 0.06, 0], footR: [-0.28, -0.06, 0],
    }, 'outCubic'),
    key(0.62, {
      hipsPos: [0, -0.27, -0.02],
      chest: [0.36, -0.12, 0], torso: [0.21, -0.06, 0], head: [-0.26, 0.1, 0],
      shoulderL: [-0.52, 0.66, 0.42], elbowL: [-2.54, 0, 0.2],
      shoulderR: [-0.47, -0.72, -0.42], elbowR: [-2.6, 0, -0.2],
      kneeL: [0.92, 0, 0], kneeR: [0.92, 0, 0],
    }, 'inOutCubic'),
    key(0.85, {
      hipsPos: [0, -0.31, -0.03],
      chest: [0.4, -0.13, 0], torso: [0.23, -0.07, 0], head: [-0.29, 0.1, 0],
      shoulderL: [-0.48, 0.7, 0.45], elbowL: [-2.58, 0, 0.2],
      shoulderR: [-0.43, -0.76, -0.45], elbowR: [-2.64, 0, -0.2],
      kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0],
    }, 'inOutCubic'),
    key(1, {
      hipsPos: [0, -0.24, 0.02],           // rises a breath — release imminent
      chest: [0.32, -0.1, 0], head: [-0.2, 0.1, 0],
      kneeL: [0.85, 0, 0], kneeR: [0.85, 0, 0],
    }, 'outQuad'),
  ], false, { tremble: 0.02 }),

  ultFlurryL: bake([
    key(0, { }),
    key(0.5, {
      chest: [0.2, 0.4, 0], torso: [0.22, 0.2, 0],
      hipsPos: [0, -0.1, 0.16],
      shoulderL: [-1.62, 0.1, 0], elbowL: [-0.05, 0, 0], gloveL: [-1.3, 0, 0],
      shoulderR: [-0.85, -0.5, -0.3], elbowR: [-2.5, 0, -0.1],
    }, 'outQuart'),
    key(1, {}, 'inQuad'),
  ]),

  ultFinal: bake([
    key(0, {}),
    key(0.35, {                            // deep crouch coil
      hipsPos: [0, -0.34, -0.05],
      chest: [0.4, -0.7, 0], torso: [0.25, -0.35, 0],
      shoulderR: [-0.2, -0.8, -0.7], elbowR: [-2.4, 0, -0.2],
      kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0],
      head: [0.1, 0.4, 0],
    }, 'outCubic'),
    key(0.62, {                            // rising uppercut
      hipsPos: [0, 0.12, 0.22],
      chest: [-0.15, 0.5, 0], torso: [-0.1, 0.3, 0],
      hips: [0.1, 0.1, 0],
      shoulderR: [-2.6, -0.1, 0.1], elbowR: [-0.3, 0, 0], gloveR: [-1.1, 0, 0],
      shoulderL: [-0.6, 0.5, 0.4], elbowL: [-2.2, 0, 0.15],
      head: [-0.3, 0.05, 0],
      kneeL: [0.15, 0, 0], kneeR: [0.2, 0, 0],
    }, 'outQuart'),
    key(1, {
      hipsPos: [0, 0.04, 0.2],
      shoulderR: [-2.4, -0.1, 0.1], elbowR: [-0.5, 0, 0],
      chest: [-0.1, 0.4, 0],
    }, 'outCubic'),
  ]),

  victory: bake([
    key(0, {}),
    key(0.3, {
      head: [-0.25, 0.1, 0],
      chest: [-0.12, -0.05, 0],
      shoulderL: [-2.7, 0.3, 0.25], elbowL: [-0.5, 0, 0.1],
      shoulderR: [-2.75, -0.3, -0.25], elbowR: [-0.4, 0, -0.1],
    }, 'outBack'),
    key(0.65, {
      hipsPos: [0, -0.02, 0],
      shoulderL: [-2.6, 0.35, 0.3], elbowL: [-0.6, 0, 0.1],
      shoulderR: [-2.65, -0.35, -0.3], elbowR: [-0.5, 0, -0.1],
    }, 'inOutCubic'),
    key(1, {
      shoulderL: [-2.7, 0.3, 0.25], elbowL: [-0.5, 0, 0.1],
      shoulderR: [-2.75, -0.3, -0.25], elbowR: [-0.4, 0, -0.1],
    }, 'inOutCubic'),
  ], true),
};

// Attack clips from combat constants (+ mirrored variants).
CLIP_DEFS.jabL = makeJab(LIGHT);
CLIP_DEFS.jabR = (() => {
  const c = CLIP_DEFS.jabL;
  return { ...c, keys: c.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })), joints: c.joints.map(mirrorName) };
})();
CLIP_DEFS.heavyR = makeHeavy(HEAVY);
CLIP_DEFS.heavyL = (() => {
  const c = CLIP_DEFS.heavyR;
  return { ...c, keys: c.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })), joints: c.joints.map(mirrorName) };
})();
CLIP_DEFS.ultFlurryR = (() => {
  const c = CLIP_DEFS.ultFlurryL;
  return { ...c, keys: c.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })), joints: c.joints.map(mirrorName) };
})();

function mirrorName(j) {
  if (j === 'hipsPos') return j;
  if (j.endsWith('L')) return j.slice(0, -1) + 'R';
  if (j.endsWith('R')) return j.slice(0, -1) + 'L';
  return j;
}

export const CLIPS = CLIP_DEFS;

// ============================================================================
// Player
// ============================================================================

const ALL_JOINTS = Object.keys(STANCE).filter((j) => j !== 'hipsPos');

export class AnimPlayer {
  constructor(avatar) {
    this.avatar = avatar;
    this.clip = CLIPS.idle;
    this.clipName = 'idle';
    this.time = 0;
    this.duration = 1;
    this.speed = 1;
    this._blendT = 1;
    this._blendDur = 0.12;
    this._from = null;              // snapshot pose blended out of
    this._applied = {};             // last pose actually written to joints
    for (const j of ALL_JOINTS) this._applied[j] = [...(STANCE[j] || [0, 0, 0])];
    this._applied.hipsPos = [...STANCE.hipsPos];
    this._phase = Math.random() * 10; // locomotion stride phase
    this._locoW = 0;                  // smoothed locomotion layer weight
    this._t = Math.random() * 10;     // breathing clock
  }

  play(name, { duration = 1, blend = 0.12, speed = 1, restart = true } = {}) {
    if (!restart && this.clipName === name) return;
    this._from = snapshot(this._applied);
    this._blendT = 0;
    this._blendDur = Math.max(blend, 0.0001);
    this.clip = CLIPS[name] || CLIPS.idle;
    this.clipName = name;
    this.duration = duration;
    this.speed = speed;
    this.time = 0;
  }

  get progress() { return clamp01(this.time / this.duration); }

  // ctx: { moveX, moveZ, speed01 } for the locomotion layer
  update(dt, ctx = {}) {
    this.time += dt * this.speed;
    this._t += dt;
    this._blendT = Math.min(1, this._blendT + dt / this._blendDur);

    let u = this.duration > 0 ? this.time / this.duration : 1;
    u = this.clip.loop ? u % 1 : clamp01(u);

    const pose = evalClip(this.clip, u);

    // resolve every joint: clip value or stance fallback
    const out = {};
    for (const j of ALL_JOINTS) out[j] = pose[j] || STANCE[j] || [0, 0, 0];
    out.hipsPos = pose.hipsPos || STANCE.hipsPos;

    // blend from snapshot
    if (this._from && this._blendT < 1) {
      const b = smoothstep(this._blendT);
      const mixed = {};
      for (const j of ALL_JOINTS) mixed[j] = lerp3(this._from[j], out[j], b);
      mixed.hipsPos = lerp3(this._from.hipsPos, out.hipsPos, b);
      apply.call(this, mixed, ctx);
      return;
    }
    apply.call(this, out, ctx);
  }
}

function apply(pose, ctx) {
  const J = this.avatar.joints;
  const speed01 = ctx.speed01 || 0;
  const dt = ctx.dt || 0.016;

  // locomotion layer weight eases in/out (no snapping when actions start/end;
  // tight λ so the walk engages/disengages crisply on key press/release)
  const wantLoco = this.clip.locomotion && speed01 > 0.02 ? 1 : 0;
  this._locoW = damp(this._locoW, wantLoco, 13, dt);
  const w = this._locoW;

  // ---- full walking gait ----------------------------------------------------
  // Driven by stride phase φ, the (already damped) move direction and speed.
  // Forward gait: thigh swing, swing-leg knee fold (stance leg near-straight),
  // heel-to-toe foot roll, pelvis yaw + weight-shift roll, chest counter-yaw,
  // guarded arm counter-swing, head stabilized on the opponent.
  // Strafe gait: scissoring side-steps with body bank.
  this._phase += dt * (3.6 + speed01 * 7);
  let thighLx = 0, thighRx = 0, thighLz = 0, thighRz = 0;
  let kneeL = 0, kneeR = 0, footLx = 0, footRx = 0, footYaw = 0;
  let hipsYaw = 0, hipsRoll = 0, chestYaw = 0, chestRoll = 0, headYaw = 0;
  let shL = 0, shR = 0, elL = 0, elR = 0;
  let bobY = 0, hipShift = 0, leanX = 0, leanZ = 0;
  if (w > 0.01) {
    const sp = speed01;
    const fwd = Math.max(-1, Math.min(1, ctx.moveZ || 0));
    const side = Math.max(-1, Math.min(1, ctx.moveX || 0));
    const s = Math.sin(this._phase);
    const c = Math.cos(this._phase);
    const swing = Math.sin(this._phase - 0.5);

    // legs — stride opens up hard at speed for a committed, explosive run
    const drive = 1 + sp * 0.5;
    thighLx = s * 0.6 * drive * fwd * w;
    thighRx = -s * 0.6 * drive * fwd * w;
    thighLz = s * 0.28 * side * w;                       // side-step scissor
    thighRz = -s * 0.28 * side * w;
    kneeL = Math.pow(Math.max(0, swing), 1.2) * 0.66 * sp * w;  // swing-leg folds,
    kneeR = Math.pow(Math.max(0, -swing), 1.2) * 0.66 * sp * w; // stance leg stays long
    footLx = c * 0.22 * fwd * w;                         // heel-strike → toe-off roll
    footRx = -c * 0.22 * fwd * w;
    footYaw = side * 0.12 * w;                           // toe-out into the strafe

    // pelvis drives, torso counters, head stays on target
    hipsYaw = s * 0.08 * fwd * w;
    hipsRoll = s * 0.062 * sp * w;                       // weight shifts over the stance foot
    chestYaw = -s * 0.062 * fwd * w;
    chestRoll = -s * 0.034 * sp * w;
    headYaw = -chestYaw * 0.6;                           // gaze pinned on the opponent

    // guarded arm counter-swing — fuller drive, opens up at speed
    shL = -s * 0.19 * drive * fwd * w;
    shR = s * 0.19 * drive * fwd * w;
    elL = -s * 0.14 * fwd * w;
    elR = s * 0.14 * fwd * w;

    bobY = Math.abs(c) * 0.072 * sp * w;                 // stronger vertical drive
    hipShift = s * 0.034 * sp * w;                       // lateral sway with the weight
    leanX = fwd * (0.12 + sp * 0.2) * w;                 // steep committed lean at a sprint
    leanZ = -side * (0.1 + sp * 0.08) * w;               // hard bank into strafe runs
  }

  // ---- U-line bob-and-weave groove --------------------------------------------
  // The whole body continuously traces a smooth "U": hips and head sweep side
  // to side (sin φ) while dipping through the center crossing (vertical at
  // DOUBLE frequency, cos 2φ) — the rhythmic weave real boxers never stop.
  // Always on: full at a standstill, still clearly visible while moving, and
  // attenuated (but never zero) during attacks/dashes so the body keeps waving
  // instead of freezing into a stiff straight pose mid-action.
  let bnHipY = 0, bnHipRoll = 0, bnHipX = 0, bnKneeL = 0, bnKneeR = 0;
  let bnChestRoll = 0, bnChestX = 0, bnTorsoZ = 0, bnShL = 0, bnShR = 0;
  let bnHeadY = 0, bnHeadX = 0, bnHeadZ = 0;
  {
    const sp = speed01;
    const bw = this.clip.locomotion
      ? 1 - w * 0.55                                     // idle 100% → full stride 45%
      : (this.clipName === 'ko' ? 0 : 0.28);             // actions keep a live 28% (never on the KO sprawl)
    this._weave = (this._weave || 0) + dt * (1.2 + sp * 0.4) * Math.PI * 2;
    const s1 = Math.sin(this._weave);                    // lateral sweep of the U
    const dip = (1 + Math.cos(this._weave * 2)) * 0.5;   // 1 at center crossing, 0 at the sides
    bnHipX = s1 * 0.06 * bw;                             // hips sweep across
    bnHipY = -dip * 0.065 * bw;                          // sink through the bottom of the U
    bnHipRoll = s1 * 0.06 * bw;                          // pelvis rolls with the sway
    bnKneeL = dip * 0.18 * (0.5 + 0.5 * s1) * bw;        // loaded-side knee gives in the dip
    bnKneeR = dip * 0.18 * (0.5 - 0.5 * s1) * bw;
    bnTorsoZ = s1 * 0.028 * bw;                          // torso follows the sway
    bnChestRoll = -s1 * 0.042 * bw;                      // chest counters for balance
    bnChestX = dip * 0.055 * bw;                         // chest pitches forward through the valley
    bnShL = s1 * 0.038 * bw;                             // shoulders roll through the wave
    bnShR = -s1 * 0.038 * bw;
    bnHeadY = s1 * 0.028 * bw;                           // head leads the sweep a touch
    bnHeadZ = -s1 * 0.045 * bw;                          // head counter-rolls to stay level — realistic
    bnHeadX = dip * 0.05 * bw;                           // head dips through the U
  }

  // breathing (always on — fighters never look frozen), now on top of the groove
  const br = Math.sin(this._t * 2.1) * 0.02;
  const sway = Math.sin(this._t * 1.3) * 0.02;
  // stun tremble (added after the low-pass so it isn't filtered away)
  const tr = this.clip.tremble
    ? () => (Math.random() - 0.5) * 2 * this.clip.tremble
    : () => 0;

  // Final low-pass: every joint value passes through a fast damped filter
  // (λ=40 settles in ~75ms — punches still reach ~98% extension by contact).
  // This erases any residual 1–2 frame discontinuity from layer composition,
  // feint switches or sim corrections that per-clip blending can't catch.
  if (!this._smooth) this._smooth = null;   // lazily seeded below
  const sm = this._smooth || (this._smooth = {});
  const k = 1 - Math.exp(-40 * dt);

  for (const j of ALL_JOINTS) {
    const g = J[j];
    if (!g) continue;
    let [x, y, z] = pose[j];
    if (j === 'thighL') { x += thighLx; z += thighLz; }
    if (j === 'thighR') { x += thighRx; z += thighRz; }
    if (j === 'kneeL') x += kneeL + bnKneeL;
    if (j === 'kneeR') x += kneeR + bnKneeR;
    if (j === 'footL') { x += footLx; y += footYaw; }
    if (j === 'footR') { x += footRx; y += footYaw; }
    if (j === 'hips') { y += hipsYaw; z += hipsRoll + bnHipRoll; }
    if (j === 'shoulderL') x += shL + bnShL;
    if (j === 'shoulderR') x += shR + bnShR;
    if (j === 'elbowL') x += elL;
    if (j === 'elbowR') x += elR;
    if (j === 'torso') { x += leanX + br * 0.4; z += leanZ + bnTorsoZ; }
    if (j === 'chest') { x += br + bnChestX; y += sway * 0.5 + chestYaw; z += chestRoll + bnChestRoll; }
    if (j === 'head') { x += bnHeadX; y += sway + headYaw + bnHeadY; z += bnHeadZ; }

    let s = sm[j];
    if (!s) s = sm[j] = [x, y, z];
    else {
      s[0] += (x - s[0]) * k;
      s[1] += (y - s[1]) * k;
      s[2] += (z - s[2]) * k;
    }
    let fx = s[0], fy = s[1], fz = s[2];
    if (j === 'torso') fx += tr();
    if (j === 'chest') fx += tr();
    if (j === 'head') { fx += tr() * 1.5; fy += tr(); }
    g.rotation.set(fx, fy, fz);
  }

  const hp = pose.hipsPos;
  const hx = hp[0] + hipShift + bnHipX;
  const hy = J.hips.userData.baseY + hp[1] + bobY + bnHipY + br * 0.3;
  let hs = sm.hipsPos;
  if (!hs) hs = sm.hipsPos = [hx, hy, hp[2]];
  else {
    hs[0] += (hx - hs[0]) * k;
    hs[1] += (hy - hs[1]) * k;
    hs[2] += (hp[2] - hs[2]) * k;
  }
  J.hips.position.set(hs[0], hs[1], hs[2]);

  this._applied = pose;
}

function evalClip(clip, u) {
  const keys = clip.keys;
  if (u <= keys[0].t) return keys[0].pose;
  if (u >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < u) i++;
  const a = keys[i], b = keys[i + 1];
  const p0 = keys[i - 1] || a;                 // neighbours give the spline its tangents;
  const p3 = keys[i + 2] || b;                 // endpoints are duplicated at the clip ends
  const span = b.t - a.t || 1;
  // per-key easing still shapes the SPEED (keeps punches snappy), the spline
  // shapes the PATH — so joints flow through each key on a continuous arc
  // instead of a straight line that corners at every keyframe.
  const t = (EASE[b.e] || EASE.inOutCubic)(clamp01((u - a.t) / span));
  const out = {};
  for (const j of clip.joints) {
    out[j] = catmull3(p0.pose[j], a.pose[j], b.pose[j], p3.pose[j], t);
  }
  return out;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Catmull-Rom through p1→p2 with p0/p3 as the neighbouring keys (C1-continuous
// across keyframes = smooth, organic motion). Overshoot is bounded to a small
// band beyond the segment so it adds life/anticipation without letting a tight
// pose (e.g. full punch extension) hyperextend into an artifact.
function catmull3(p0, p1, p2, p3, t) {
  return [
    catmull1(p0[0], p1[0], p2[0], p3[0], t),
    catmull1(p0[1], p1[1], p2[1], p3[1], t),
    catmull1(p0[2], p1[2], p2[2], p3[2], t),
  ];
}
function catmull1(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const v = 0.5 * (2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  const lo = p1 < p2 ? p1 : p2, hi = p1 < p2 ? p2 : p1;
  const m = (hi - lo) * 0.12 + 1e-4;   // tight overshoot — natural follow-through, never rubber-limbed
  return v < lo - m ? lo - m : (v > hi + m ? hi + m : v);
}

function snapshot(applied) {
  const s = {};
  for (const [k, v] of Object.entries(applied)) s[k] = [...v];
  return s;
}
