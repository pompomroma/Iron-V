import * as THREE from 'three';

export function createRenderer(canvas, tier) {
  // At a high device-pixel-ratio the panel density already resolves edges, so
  // MSAA is largely redundant — skipping it there frees a chunk of GPU budget
  // for framerate while edges stay clean from the dense backing store.
  const dpr = window.devicePixelRatio || 1;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier.antialias && dpr < 2,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = tier.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  return renderer;
}

export function resizeRendererToDisplay(renderer, camera) {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
