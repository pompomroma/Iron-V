import { EASE, clamp01, lerp, smoothstep, damp } from '../engine/utils.js?v=6';
import { LIGHT, HEAVY } from './constants.js?v=6';

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
  // Lead-hand (LEFT) STRAIGHT JAB, boxing-detailed: elbow tucks to the ribs
  // and the head slips behind the lead shoulder through a continuously
  // traveling windup; the arm then pistons dead-straight at shoulder height
  // with fist pronation, chest drive and a rear-foot ball pivot; the return
  // snaps back to guard faster than it went out.
  return bake([
    key(0, {}),
    key(w * 0.4, {                        // fast coil — elbow to the ribs
      chest: [0.1, -0.46, 0],
      torso: [0.12, -0.23, 0],
      hips: [0.06, -0.32, 0],
      hipsPos: [0, -0.065, -0.02],
      shoulderL: [-0.72, 0.52, 0.28],
      elbowL: [-2.42, 0, 0.1],
      gloveL: [-0.3, 0, 0.25],
      shoulderR: [-0.88, -0.46, -0.32],   // rear glove pinned at the chin
      elbowR: [-2.32, 0, -0.1],
      head: [-0.01, 0.3, 0.05],
      neck: [0, 0.36, 0],
      footL: [-0.12, 0.02, 0],            // lead foot plants
    }, 'outQuart'),
    key(w * 0.75, {                       // still traveling deeper
      chest: [0.115, -0.53, 0],
      torso: [0.135, -0.265, 0],
      hips: [0.065, -0.35, 0],
      hipsPos: [0, -0.082, -0.028],
      shoulderL: [-0.66, 0.55, 0.3],
      elbowL: [-2.5, 0, 0.11],
      gloveL: [-0.28, 0, 0.35],
      head: [-0.01, 0.34, 0.06],
      neck: [0, 0.4, 0],
    }, 'inOutCubic'),
    key(w, {                              // deepest — shoulder loads to fire
      chest: [0.13, -0.58, 0],
      torso: [0.15, -0.29, 0],
      hips: [0.07, -0.37, 0],
      hipsPos: [0, -0.095, -0.032],
      shoulderL: [-0.6, 0.57, 0.32],
      elbowL: [-2.56, 0, 0.12],
      gloveL: [-0.26, 0, 0.4],
      head: [-0.01, 0.36, 0.07],
      neck: [0, 0.42, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.45, {             // full extension — piston straight
      chest: [0.16, 0.3, -0.02],
      torso: [0.2, 0.14, 0],
      hips: [0.1, -0.02, 0],
      hipsPos: [0, -0.085, 0.1],
      shoulderL: [-1.62, 0.18, 0.02],     // protracted, level at the shoulder
      elbowL: [-0.04, 0, 0],
      gloveL: [-1.3, 0, 1.25],            // fist pronates through the punch
      shoulderR: [-0.76, -0.58, -0.36],   // rear guard stays home
      elbowR: [-2.55, 0, -0.1],
      head: [0.04, 0.08, -0.04],          // chin down, eyes on target
      neck: [0, 0.1, 0],
      kneeL: [0.42, 0, 0],                // front knee gives a touch
      footR: [-0.16, 0.32, 0],            // rear foot pivots on the ball
    }, 'outQuart'),
    key(a + 0.04, {                       // follow-through drift
      chest: [0.17, 0.34, -0.02],
      shoulderL: [-1.52, 0.22, 0.05],
      elbowL: [-0.26, 0, 0],
      gloveL: [-1.2, 0, 1.1],
      hipsPos: [0, -0.085, 0.08],
    }, 'outQuad'),
    key(a + (1 - a) * 0.42, {             // snap back to guard — faster than it went out
      chest: [0.1, -0.1, 0],
      torso: [0.11, -0.08, 0],
      shoulderL: [-1.0, 0.36, 0.3],
      elbowL: [-1.9, 0, 0.12],
      gloveL: [-0.3, 0, 0.2],
      footR: [-0.19, 0.06, 0],
      hipsPos: [0, -0.06, 0.02],
    }, 'outQuart'),
    key(1, {}, 'inOutCubic'),             // settle into stance
  ]);
}

function makeHeavy(C) {
  const T = C.WINDUP + C.ACTIVE + C.RECOVER;
  const w = C.WINDUP / T, a = (C.WINDUP + C.ACTIVE) / T;
  // Rear-hand (RIGHT) INTENSE HOOK: weight loads onto the rear leg while the
  // torso coils away and the elbow rises to horizontal (upper arm level,
  // elbow locked near 90°, glove by the ear); the strike is a flat explosive
  // arc driven by hips → chest → shoulder with a hard rear-foot pivot, the
  // arm staying bent all the way through; the follow-through wraps across
  // the body before recoiling to guard.
  return bake([
    key(0, {}),
    key(w * 0.4, {                        // coil away, weight sinking back
      chest: [0.1, -0.72, 0.06],
      torso: [0.13, -0.34, 0],
      hips: [0.07, -0.38, 0],
      hipsPos: [-0.03, -0.14, -0.06],
      shoulderR: [-1.08, -0.62, -0.45],   // elbow starts rising
      elbowR: [-1.72, 0, -0.15],
      gloveR: [-0.3, 0, -0.35],
      shoulderL: [-1.24, 0.5, 0.3],       // lead glove glued to the chin
      elbowL: [-2.45, 0, 0.12],
      head: [0.08, 0.38, 0.02],
      neck: [0, 0.42, 0],
      kneeL: [0.5, 0, 0],
      kneeR: [0.55, 0, 0],
      footR: [-0.2, -0.16, 0],
    }, 'outQuart'),
    key(w * 0.75, {                       // still loading through the dodge window
      chest: [0.11, -0.86, 0.07],
      torso: [0.15, -0.41, 0],
      hips: [0.08, -0.46, 0],
      hipsPos: [-0.045, -0.17, -0.068],
      shoulderR: [-1.24, -0.72, -0.5],
      elbowR: [-1.58, 0, -0.16],
      gloveR: [-0.24, 0, -0.45],
      head: [0.1, 0.44, 0.03],
      neck: [0, 0.46, 0],
      kneeL: [0.56, 0, 0],
      kneeR: [0.6, 0, 0],
      footR: [-0.2, -0.24, 0],
    }, 'inOutCubic'),
    key(w, {                              // deepest — elbow horizontal, glove by the ear
      chest: [0.12, -0.95, 0.08],
      torso: [0.16, -0.45, 0],
      hips: [0.09, -0.5, 0],
      hipsPos: [-0.06, -0.19, -0.072],
      shoulderR: [-1.38, -0.78, -0.52],
      elbowR: [-1.5, 0, -0.16],
      gloveR: [-0.2, 0, -0.5],
      head: [0.11, 0.47, 0.04],
      neck: [0, 0.48, 0],
      kneeL: [0.6, 0, 0],
      kneeR: [0.64, 0, 0],
      footR: [-0.2, -0.3, 0],
    }, 'outQuad'),
    key(w + (a - w) * 0.5, {              // the hook lands — flat horizontal arc
      chest: [0.14, 0.8, -0.05],
      torso: [0.2, 0.42, 0],
      hips: [0.1, 0.55, 0],
      hipsPos: [0.08, -0.125, 0.1],       // weight slams across to the lead side
      shoulderR: [-1.5, 0.55, 0.25],      // upper arm stays level through the swing
      elbowR: [-1.35, 0, -0.05],          // ARM STAYS BENT — that's the hook
      gloveR: [-0.35, 0, -1.1],           // palm rolls down
      shoulderL: [-1.05, 0.52, 0.35],
      elbowL: [-2.5, 0, 0.14],
      head: [0.06, -0.02, -0.04],         // chin tucked behind the lead shoulder
      neck: [0, 0.04, 0],
      kneeL: [0.46, 0, 0],
      kneeR: [0.36, 0, 0],
      footR: [-0.15, 0.9, 0],             // rear foot pivots hard on the ball
      footL: [-0.12, 0.2, 0],
    }, 'outQuart'),
    key(a + 0.06, {                       // wraps across the body
      chest: [0.16, 0.95, -0.07],
      torso: [0.22, 0.48, 0],
      shoulderR: [-1.42, 0.78, 0.3],
      elbowR: [-1.6, 0, -0.05],
      gloveR: [-0.4, 0, -1.0],
      hipsPos: [0.1, -0.135, 0.08],
      footR: [-0.15, 1.0, 0],
    }, 'outQuad'),
    key(a + (1 - a) * 0.45, {             // recoil toward guard
      chest: [0.1, -0.02, 0],
      torso: [0.12, -0.02, 0],
      hips: [0.07, -0.1, 0],
      shoulderR: [-1.05, -0.32, -0.28],
      elbowR: [-2.0, 0, -0.1],
      gloveR: [-0.3, 0, -0.2],
      footR: [-0.19, -0.06, 0],
      hipsPos: [0.02, -0.07, 0],
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
    key(0.14, {                            // sharp snap on impact
      head: [-0.46, 0.32, 0.12],
      chest: [-0.2, -0.32, 0.02],
      torso: [-0.07, -0.16, 0],
      hipsPos: [0, -0.05, -0.11],
      shoulderL: [-0.68, 0.42, 0.52],
      shoulderR: [-0.58, -0.52, -0.52],
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
    key(0.13, {                            // violent snap
      head: [-0.66, 0.42, 0.2],
      chest: [-0.38, -0.48, 0.07],
      torso: [-0.16, -0.22, 0],
      hips: [-0.07, -0.32, 0],
      hipsPos: [0, -0.09, -0.26],
      shoulderL: [-0.38, 0.56, 0.72],
      elbowL: [-1.38, 0, 0.2],
      shoulderR: [-0.28, -0.62, -0.72],
      elbowR: [-1.48, 0, -0.2],
      kneeL: [0.5, 0, 0], kneeR: [0.55, 0, 0],
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

  // Dashes: the fighter DIGS LOW — a deep half-crouch slide (hips drop nearly
  // half a meter, legs folded and tucked, torso pitched over the lead knee)
  // that holds low through the slide and springs back up with overshoot.
  dashF: bake([
    key(0, {}),
    key(0.18, {
      torso: [0.6, -0.1, 0], chest: [0.44, -0.15, 0], head: [-0.42, 0.14, 0],
      hipsPos: [0, -0.46, 0.14],
      shoulderL: [-1.4, 0.44, 0.3], elbowL: [-2.5, 0, 0.15],
      shoulderR: [-1.3, -0.54, -0.3], elbowR: [-2.6, 0, -0.15],
      thighL: [-0.62, 0.06, 0.03], thighR: [-0.5, -0.1, -0.03],
      kneeL: [1.28, 0, 0], kneeR: [1.28, 0, 0],
      footL: [-0.5, 0.06, 0], footR: [-0.55, -0.06, 0],
    }, 'outQuart'),
    key(0.52, {
      torso: [0.52, -0.1, 0], chest: [0.38, -0.15, 0], head: [-0.36, 0.14, 0],
      hipsPos: [0, -0.38, 0.12],
      thighL: [-0.52, 0.06, 0.03], thighR: [-0.42, -0.1, -0.03],
      kneeL: [1.1, 0, 0], kneeR: [1.1, 0, 0],
      footL: [-0.42, 0.06, 0], footR: [-0.46, -0.06, 0],
    }, 'inOutCubic'),
    key(1, {}, 'outBack'),
  ]),
  dashB: bake([
    key(0, {}),
    key(0.18, {
      torso: [-0.42, -0.1, 0], chest: [-0.3, -0.18, 0], head: [0.18, 0.14, 0],
      hipsPos: [0, -0.42, -0.12],
      shoulderL: [-1.5, 0.5, 0.44], elbowL: [-2.4, 0, 0.15],
      shoulderR: [-1.4, -0.54, -0.44], elbowR: [-2.5, 0, -0.15],
      thighL: [-0.55, 0.06, 0.03], thighR: [-0.45, -0.1, -0.03],
      kneeL: [1.15, 0, 0], kneeR: [1.15, 0, 0],
      footL: [-0.45, 0.06, 0], footR: [-0.5, -0.06, 0],
    }, 'outQuart'),
    key(0.52, {
      torso: [-0.32, -0.1, 0], chest: [-0.2, -0.18, 0], head: [0.12, 0.14, 0],
      hipsPos: [0, -0.34, -0.1],
      thighL: [-0.46, 0.06, 0.03], thighR: [-0.38, -0.1, -0.03],
      kneeL: [0.98, 0, 0], kneeR: [0.98, 0, 0],
      footL: [-0.38, 0.06, 0], footR: [-0.42, -0.06, 0],
    }, 'inOutCubic'),
    key(1, {}, 'outBack'),
  ]),
  dashL: bake([
    key(0, {}),
    key(0.18, {                            // low lateral slip — inside shoulder dips
      hips: [0.06, -0.28, 0.5], torso: [0.14, -0.1, 0.34], chest: [0.12, -0.16, 0.18],
      head: [-0.1, 0.14, -0.28],
      hipsPos: [0, -0.46, 0],
      thighL: [-0.66, 0.06, 0.08], thighR: [-0.36, -0.1, -0.05],
      kneeL: [1.32, 0, 0], kneeR: [0.85, 0, 0],
      footL: [-0.52, 0.06, 0], footR: [-0.4, -0.06, 0],
      shoulderL: [-1.3, 0.44, 0.72],       // inside arm digs toward the sand
      elbowL: [-2.2, 0, 0.2],
      shoulderR: [-1.0, -0.62, -0.2],      // outside arm sweeps for balance
      elbowR: [-1.9, 0, -0.15],
    }, 'outQuart'),
    key(0.52, {
      hips: [0.06, -0.28, 0.36], torso: [0.12, -0.1, 0.24], head: [-0.08, 0.14, -0.2],
      hipsPos: [0, -0.37, 0],
      thighL: [-0.55, 0.06, 0.08], thighR: [-0.3, -0.1, -0.05],
      kneeL: [1.12, 0, 0], kneeR: [0.7, 0, 0],
      footL: [-0.44, 0.06, 0], footR: [-0.34, -0.06, 0],
    }, 'inOutCubic'),
    key(1, {}, 'outBack'),
  ]),
  dashR: bake([
    key(0, {}),
    key(0.18, {
      hips: [0.06, -0.28, -0.5], torso: [0.14, -0.1, -0.34], chest: [0.12, -0.16, -0.18],
      head: [-0.1, 0.14, 0.28],
      hipsPos: [0, -0.46, 0],
      thighR: [-0.66, -0.1, -0.08], thighL: [-0.36, 0.06, 0.05],
      kneeR: [1.32, 0, 0], kneeL: [0.85, 0, 0],
      footR: [-0.52, -0.06, 0], footL: [-0.4, 0.06, 0],
      shoulderR: [-1.3, -0.44, -0.72],
      elbowR: [-2.2, 0, -0.2],
      shoulderL: [-1.0, 0.62, 0.2],
      elbowL: [-1.9, 0, 0.15],
    }, 'outQuart'),
    key(0.52, {
      hips: [0.06, -0.28, -0.36], torso: [0.12, -0.1, -0.24], head: [-0.08, 0.14, 0.2],
      hipsPos: [0, -0.37, 0],
      thighR: [-0.55, -0.1, -0.08], thighL: [-0.3, 0.06, 0.05],
      kneeR: [1.12, 0, 0], kneeL: [0.7, 0, 0],
      footR: [-0.44, -0.06, 0], footL: [-0.34, 0.06, 0],
    }, 'inOutCubic'),
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
  ultCharge: bake([
    key(0, {}),
    key(0.4, {
      hipsPos: [0, -0.26, 0],
      chest: [0.35, -0.1, 0], torso: [0.2, -0.05, 0], head: [-0.25, 0.1, 0],
      shoulderL: [-0.55, 0.65, 0.4], elbowL: [-2.5, 0, 0.2],
      shoulderR: [-0.5, -0.7, -0.4], elbowR: [-2.55, 0, -0.2],
      kneeL: [0.9, 0, 0], kneeR: [0.9, 0, 0],
    }, 'outCubic', ),
    key(1, {
      hipsPos: [0, -0.28, 0],
      chest: [0.38, -0.1, 0],
    }, 'inOutCubic'),
  ], true, { tremble: 0.02 }),

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

  // locomotion layer weight eases in/out (no snapping when actions start/end)
  const wantLoco = this.clip.locomotion && speed01 > 0.02 ? 1 : 0;
  this._locoW = damp(this._locoW, wantLoco, 10, dt);
  const w = this._locoW;

  // locomotion stride
  let strideL = 0, strideR = 0, bobY = 0, leanX = 0, leanZ = 0;
  this._phase += dt * (3.6 + speed01 * 7);
  if (w > 0.01) {
    const s = Math.sin(this._phase);
    strideL = s * 0.5 * speed01 * w;
    strideR = -s * 0.5 * speed01 * w;
    bobY = Math.abs(Math.cos(this._phase)) * 0.045 * speed01 * w;
    leanX = (ctx.moveZ || 0) * 0.11 * w;     // lean into approach/retreat
    leanZ = -(ctx.moveX || 0) * 0.09 * w;    // bank into strafe
  }
  // breathing / idle sway (always on — fighters never look frozen)
  const br = Math.sin(this._t * 2.1) * 0.024;
  const sway = Math.sin(this._t * 1.3) * 0.024;
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
    if (j === 'thighL') x += strideL;
    if (j === 'thighR') x += strideR;
    if (j === 'kneeL') x += Math.max(0, -strideL) * 0.9;
    if (j === 'kneeR') x += Math.max(0, -strideR) * 0.9;
    if (j === 'torso') { x += leanX + br * 0.4; z += leanZ; }
    if (j === 'chest') { x += br; y += sway * 0.5; }
    if (j === 'head') { y += sway; }

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
  const hy = J.hips.userData.baseY + hp[1] + bobY + br * 0.3;
  let hs = sm.hipsPos;
  if (!hs) hs = sm.hipsPos = [hp[0], hy, hp[2]];
  else {
    hs[0] += (hp[0] - hs[0]) * k;
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
  const span = b.t - a.t || 1;
  const t = (EASE[b.e] || EASE.inOutCubic)(clamp01((u - a.t) / span));
  const out = {};
  for (const j of clip.joints) {
    const va = a.pose[j], vb = b.pose[j];
    out[j] = lerp3(va, vb, t);
  }
  return out;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function snapshot(applied) {
  const s = {};
  for (const [k, v] of Object.entries(applied)) s[k] = [...v];
  return s;
}
