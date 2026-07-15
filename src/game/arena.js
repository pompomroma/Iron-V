import * as THREE from 'three';
import { ARENA } from './constants.js?v=10';
import { canvasTexture, mulberry32, randRange, TAU, mergeGeometries } from '../engine/utils.js?v=10';

// Original noir arena: wind-rippled monochrome sand, a ring of dark shattered
// rock slabs, a huge pale moon low on the horizon, heavy fog. High contrast so
// the fighters' colored glows pop.

export function buildArena(scene, tier) {
  scene.background = new THREE.Color(0x07080a);
  scene.fog = new THREE.Fog(0x0a0b0e, 26, 78);

  // --- Sand floor -----------------------------------------------------------
  const sandTex = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#9a9a98';
    ctx.fillRect(0, 0, w, h);
    // wind ripple bands (soft)
    const rand = mulberry32(7);
    for (let y = 0; y < h; y += 3) {
      const wave = Math.sin(y * 0.045) * 14 + Math.sin(y * 0.011) * 30;
      const l = 138 + Math.sin(y * 0.07 + wave * 0.02) * 16 + (rand() - 0.5) * 8;
      ctx.fillStyle = `rgb(${l | 0},${l | 0},${(l - 3) | 0})`;
      ctx.fillRect(0, y, w, 3);
    }
    // grain speckle
    for (let i = 0; i < 14000; i++) {
      const g = 100 + rand() * 110;
      ctx.fillStyle = `rgba(${g},${g},${g},0.22)`;
      ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
  });
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(5, 5);
  sandTex.anisotropy = tier.name === 'LOW' ? 2 : 8;

  // gently duned displacement
  const seg = tier.floorSeg || 96;
  const floorGeo = new THREE.PlaneGeometry(ARENA.FLOOR_SIZE, ARENA.FLOOR_SIZE, seg, seg);
  const pos = floorGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    const inside = Math.max(0, 1 - r / (ARENA.RADIUS + 2));
    const dune =
      Math.sin(x * 0.16 + y * 0.1) * 0.45 +
      Math.sin(x * 0.05 - y * 0.13) * 0.8 +
      Math.sin(y * 0.3) * 0.12;
    pos.setZ(i, dune * (1 - inside));  // flat where the fight happens
  }
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.96, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // --- Rock ring boundary -----------------------------------------------------
  // All rocks are static, so their transforms are baked into merged geometry:
  // the whole ring renders in 2 draw calls instead of ~50.
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.9, metalness: 0.05, flatShading: true });
  const rand = mulberry32(42);
  const slabGeo = new THREE.DodecahedronGeometry(1, 0);
  const bake = (px, py, pz, sx, sy, sz, rx, ry, rz) => {
    const g = slabGeo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz)
    );
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
  };
  const ringGeos = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * TAU + rand() * 0.12;
    const dist = ARENA.RADIUS + 3.2 + rand() * 7;
    const s = 1.2 + rand() * 3.4;
    ringGeos.push(bake(
      Math.cos(a) * dist, s * randRange(0.15, 0.5), Math.sin(a) * dist,
      s * randRange(0.7, 1.6), s * randRange(0.5, 1.8), s * randRange(0.7, 1.6),
      rand() * TAU, rand() * TAU, rand() * TAU
    ));
  }
  const ringRocks = new THREE.Mesh(mergeGeometries(ringGeos), rockMat);
  ringRocks.castShadow = tier.name !== 'LOW';
  ringRocks.receiveShadow = true;
  scene.add(ringRocks);

  // a few big monoliths for silhouette drama
  const monoGeos = [];
  for (let i = 0; i < 7; i++) {
    const a = rand() * TAU;
    const dist = ARENA.RADIUS + 10 + rand() * 14;
    monoGeos.push(bake(
      Math.cos(a) * dist, randRange(2, 5), Math.sin(a) * dist,
      randRange(2, 4), randRange(6, 12), randRange(2, 4),
      0, rand() * TAU, randRange(-0.15, 0.15)
    ));
  }
  const monoliths = new THREE.Mesh(mergeGeometries(monoGeos), rockMat);
  monoliths.receiveShadow = true;
  scene.add(monoliths);
  const rocks = ringRocks;

  // faint boundary ring on the sand so the play space reads
  const ringTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 5;
    ctx.setLineDash([26, 18]);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 6, 0, TAU);
    ctx.stroke();
  });
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.RADIUS * 2 + 1, ARENA.RADIUS * 2 + 1),
    new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, opacity: 0.16, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // --- Moon -----------------------------------------------------------------
  const moonTex = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,252,1)');
    g.addColorStop(0.45, 'rgba(235,238,245,0.95)');
    g.addColorStop(0.72, 'rgba(180,190,205,0.28)');
    g.addColorStop(1, 'rgba(150,160,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }));
  moon.scale.set(26, 26, 1);
  moon.position.set(-34, 20, -58);
  scene.add(moon);

  // --- Lights ---------------------------------------------------------------
  scene.add(new THREE.AmbientLight(0x3a4150, 0.55));
  const hemi = new THREE.HemisphereLight(0x9aa5b8, 0x14161a, 0.5);
  scene.add(hemi);

  // key "moonlight" — the single shadow caster
  const key = new THREE.DirectionalLight(0xf2f4ff, 2.1);
  key.position.set(-22, 26, -30);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(tier.shadow);
  key.shadow.camera.left = -18; key.shadow.camera.right = 18;
  key.shadow.camera.top = 18; key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 5; key.shadow.camera.far = 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // cool rim from the opposite side so silhouettes never go flat black
  const rim = new THREE.DirectionalLight(0x5a7086, 0.85);
  rim.position.set(18, 12, 24);
  scene.add(rim);

  return { floor, rocks, moon, key };
}
