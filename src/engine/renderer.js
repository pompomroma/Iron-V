import * as THREE from 'three';

export function createRenderer(canvas, tier) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier.antialias,
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
