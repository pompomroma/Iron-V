import * as THREE from 'three';
import { roundedBoxGeometry, canvasTexture } from '../engine/utils.js';

// ---------------------------------------------------------------------------
// Original procedural boxer: soft-beveled blocky silhouette with real detail —
// laced gloves with glow accents, tank top with trim + emblem, taped wrists,
// shorts with waistband, boots, expressive face, distinct hair per fighter.
//
// Joint hierarchy (all pivots are THREE.Groups; meshes hang off them):
//   root
//    └ hips ── pelvis, thighL/R ─ kneeL/R ─ footL/R
//        └ torso ── waist mesh
//            └ chest ── chest mesh, emblem
//                ├ neck ─ head (face, hair, headband)
//                ├ shoulderL ─ armL, elbowL ─ forearmL, gloveL
//                └ shoulderR ─ armR, elbowR ─ forearmR, gloveR
// ---------------------------------------------------------------------------

const HIP_Y = 0.98;

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

function faceTexture(p) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = hex(p.skin);
    ctx.fillRect(0, 0, w, h);
    // subtle cheek shading
    const sh = ctx.createLinearGradient(0, 0, 0, h);
    sh.addColorStop(0, 'rgba(0,0,0,0.10)');
    sh.addColorStop(0.4, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);

    const ex = 62, ey = 112, ew = 30, eh = 40;
    for (const s of [-1, 1]) {
      const cx = w / 2 + s * ex;
      // angry brow
      ctx.strokeStyle = 'rgba(10,10,14,0.95)';
      ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - s * 26, ey - 40 + 14);
      ctx.lineTo(cx + s * 22, ey - 40 - 2);
      ctx.stroke();
      // eye
      ctx.fillStyle = '#f4f1ea';
      ctx.beginPath(); ctx.ellipse(cx, ey, ew / 2, eh / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101318';
      ctx.beginPath(); ctx.ellipse(cx + s * 4, ey + 2, 9, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hex(p.accent);
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(cx + s * 4, ey + 2, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(cx - 4 + s * 4, ey - 4, 3, 0, Math.PI * 2); ctx.fill();
    }
    // set jaw
    ctx.strokeStyle = 'rgba(25,18,16,0.9)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(w / 2 - 26, 196); ctx.lineTo(w / 2 + 20, 192); ctx.stroke();
    // nose hint
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(w / 2, 138); ctx.lineTo(w / 2 - 6, 162); ctx.stroke();
  });
}

function torsoTexture(p) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = hex(p.top); ctx.fillRect(0, 0, w, h);
    // side cuts showing skin
    ctx.fillStyle = hex(p.skin);
    ctx.fillRect(0, 0, 26, h); ctx.fillRect(w - 26, 0, 26, h);
    // trim piping
    ctx.strokeStyle = hex(p.topTrim); ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(30, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w - 30, 0); ctx.lineTo(w - 30, h); ctx.stroke();
    // "V" emblem
    ctx.strokeStyle = hex(p.topTrim); ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 34, 74); ctx.lineTo(w / 2, 148); ctx.lineTo(w / 2 + 34, 74);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // fabric weave noise
    for (let i = 0; i < 1400; i++) {
      const g = Math.random() * 30;
      ctx.fillStyle = `rgba(${g},${g},${g},0.12)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

export function buildBoxer(p /* palette */, variant = 0) {
  const root = new THREE.Group();
  const J = {};   // joints
  const M = {};   // notable meshes

  const skinMat = std(p.skin, { roughness: 0.7 });
  const clothMat = std(p.shorts, { roughness: 0.95 });
  const bootMat = std(p.boots, { roughness: 0.6, metalness: 0.08 });
  const hairMat = std(p.hair, { roughness: 0.9 });
  const trimMat = std(p.shortsTrim, { emissive: p.shortsTrim, emissiveIntensity: 0.25, roughness: 0.6 });
  const gloveMat = std(p.gloves, {
    roughness: 0.45, metalness: 0.1,
    emissive: p.gloveGlow, emissiveIntensity: 0.28,
  });

  // --- hips / legs ---------------------------------------------------------
  J.hips = joint(root, 0, HIP_Y, 0);
  J.hips.userData.baseY = HIP_Y;
  mesh(roundedBoxGeometry(0.56, 0.3, 0.4, 0.09), clothMat, J.hips, 0, 0.02, 0);           // shorts
  mesh(roundedBoxGeometry(0.58, 0.075, 0.42, 0.03), trimMat, J.hips, 0, 0.16, 0);         // waistband

  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    const thigh = J['thigh' + side] = joint(J.hips, sx * 0.165, -0.08, 0);
    mesh(roundedBoxGeometry(0.24, 0.46, 0.27, 0.08), clothMat, thigh, 0, -0.2, 0);
    const knee = J['knee' + side] = joint(thigh, 0, -0.44, 0);
    mesh(roundedBoxGeometry(0.2, 0.42, 0.22, 0.07), skinMat, knee, 0, -0.18, 0);
    // boot
    const foot = J['foot' + side] = joint(knee, 0, -0.4, 0);
    mesh(roundedBoxGeometry(0.22, 0.16, 0.26, 0.05), bootMat, foot, 0, -0.05, 0.01);
    mesh(roundedBoxGeometry(0.22, 0.1, 0.34, 0.04), bootMat, foot, 0, -0.09, 0.06);
    mesh(roundedBoxGeometry(0.24, 0.045, 0.36, 0.02), std(0x2a2d33, { roughness: 0.5 }), foot, 0, -0.125, 0.06); // sole
  }

  // --- torso / chest --------------------------------------------------------
  J.torso = joint(J.hips, 0, 0.10, 0);
  const torsoTex = torsoTexture(p);
  const torsoMat = new THREE.MeshStandardMaterial({ map: torsoTex, roughness: 0.9 });
  mesh(roundedBoxGeometry(0.6, 0.34, 0.4, 0.09), torsoMat, J.torso, 0, 0.16, 0);          // waist
  J.chest = joint(J.torso, 0, 0.34, 0);
  M.chest = mesh(roundedBoxGeometry(0.7, 0.42, 0.44, 0.1), torsoMat, J.chest, 0, 0.12, 0);

  // --- head ------------------------------------------------------------------
  J.neck = joint(J.chest, 0, 0.34, 0);
  mesh(roundedBoxGeometry(0.18, 0.12, 0.18, 0.05), skinMat, J.neck, 0, 0.0, 0);
  J.head = joint(J.neck, 0, 0.08, 0);
  const faceTex = faceTexture(p);
  const headMats = [
    skinMat, skinMat, skinMat, skinMat,
    new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.7 }),                     // +z face
    skinMat,
  ];
  const headGeo = roundedBoxGeometry(0.42, 0.42, 0.4, 0.1);
  headGeo.clearGroups();
  // rounded box loses box groups; use single face-projected texture instead:
  M.head = mesh(headGeo, new THREE.MeshStandardMaterial({ map: null, roughness: 0.7, color: p.skin }), J.head, 0, 0.21, 0);
  // face plane sits just in front of the head for crisp features
  const facePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.36),
    new THREE.MeshStandardMaterial({ map: faceTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 })
  );
  facePlane.position.set(0, 0.2, 0.203);
  J.head.add(facePlane);

  // headband
  mesh(roundedBoxGeometry(0.44, 0.09, 0.42, 0.04),
    std(p.accent, { emissive: p.accent, emissiveIntensity: 0.5, roughness: 0.5 }),
    J.head, 0, 0.34, 0);

  // hair — two distinct original styles
  if (variant === 0) {
    // swept spikes
    for (let i = 0; i < 5; i++) {
      const s = mesh(roundedBoxGeometry(0.13, 0.22, 0.13, 0.04), hairMat, J.head,
        -0.14 + i * 0.07, 0.45 + (i % 2) * 0.03, -0.02 + (i % 3) * 0.02);
      s.rotation.z = -0.5 + i * 0.22;
      s.rotation.x = -0.15 + (i % 2) * 0.2;
    }
    mesh(roundedBoxGeometry(0.4, 0.14, 0.38, 0.05), hairMat, J.head, 0, 0.42, -0.03);
  } else {
    // crest / mohawk
    for (let i = 0; i < 4; i++) {
      const s = mesh(roundedBoxGeometry(0.1, 0.26 - i * 0.03, 0.16, 0.03), hairMat, J.head,
        0, 0.46, 0.12 - i * 0.1);
      s.rotation.x = -0.2 + i * 0.12;
    }
    mesh(roundedBoxGeometry(0.4, 0.12, 0.38, 0.05), hairMat, J.head, 0, 0.41, -0.02);
  }

  // --- arms -------------------------------------------------------------------
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    const sh = J['shoulder' + side] = joint(J.chest, sx * 0.44, 0.22, 0);
    mesh(roundedBoxGeometry(0.22, 0.2, 0.24, 0.07), std(p.top, { roughness: 0.9 }), sh, 0, 0.01, 0); // shoulder pad
    mesh(roundedBoxGeometry(0.18, 0.34, 0.2, 0.06), skinMat, sh, 0, -0.17, 0);
    const el = J['elbow' + side] = joint(sh, 0, -0.34, 0);
    mesh(roundedBoxGeometry(0.16, 0.3, 0.17, 0.055), skinMat, el, 0, -0.12, 0);
    // wrist tape
    mesh(roundedBoxGeometry(0.17, 0.09, 0.18, 0.04), std(0xd8d6cf, { roughness: 0.9 }), el, 0, -0.26, 0);
    // glove: fist + thumb + cuff
    const glove = J['glove' + side] = joint(el, 0, -0.33, 0);
    M['glove' + side] = mesh(roundedBoxGeometry(0.26, 0.24, 0.28, 0.1), gloveMat, glove, 0, -0.08, 0.02);
    mesh(roundedBoxGeometry(0.1, 0.12, 0.14, 0.045), gloveMat, glove, sx * -0.1, -0.06, 0.06);
    mesh(roundedBoxGeometry(0.2, 0.08, 0.2, 0.03),
      std(p.accent, { emissive: p.accent, emissiveIntensity: 0.4, roughness: 0.5 }), glove, 0, 0.04, 0);
  }

  // ---------------------------------------------------------------------------
  const gloveMats = [M.gloveL.material, M.gloveR.material]; // shared instance
  const api = {
    group: root,
    joints: J,
    meshes: M,
    palette: p,
    height: 2.06,

    // punch charge glow (0..1) — brightens gloves + accent
    setGloveGlow(intensity) {
      const e = 0.28 + intensity * 2.6;
      gloveMats.forEach((m) => (m.emissiveIntensity = e));
    },

    // dash "ghost" flash (0..1): body flashes toward pure white
    _ghosted: false,
    setGhost(v) {
      if (v > 0.01 && !this._ghosted) {
        this._ghosted = true;
        root.traverse((o) => {
          if (o.isMesh) {
            o.userData._mat = o.material;
            o.material = ghostMaterial(p);
          }
        });
      } else if (v <= 0.01 && this._ghosted) {
        this._ghosted = false;
        root.traverse((o) => {
          if (o.isMesh && o.userData._mat) { o.material = o.userData._mat; o.userData._mat = null; }
        });
      }
    },

    // afterimage clone for dash trails (basic white/accent, no shadows)
    cloneGhost(opacity = 0.5) {
      const clone = root.clone(true);
      const mat = new THREE.MeshBasicMaterial({
        color: p.accent, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      clone.traverse((o) => {
        if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; }
      });
      clone.userData.fadeMat = mat;
      return clone;
    },
  };
  return api;
}

let _ghostMats = new Map();
function ghostMaterial(p) {
  if (!_ghostMats.has(p)) {
    _ghostMats.set(p, new THREE.MeshBasicMaterial({ color: 0xf8fdff }));
  }
  return _ghostMats.get(p);
}
