import * as THREE from 'three';
import { hash } from './world.mjs?v=physics-10';

// Soft, seeded cloud banks at 230–350 m, high enough to fly through. One
// instanced draw of camera-facing puffs; they fade near the camera (no hard
// clipping while flying through) and into the fog at distance.
export const CLOUD_CELL = 520;
const RANGE = 2, PUFFS = 7;

function puffTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  // Overlapping soft lobes make an irregular, fluffy silhouette.
  for (const [x, y, r, a] of [[64, 70, 46, .9], [40, 74, 30, .7], [88, 72, 32, .7], [56, 52, 30, .65], [78, 50, 26, .6]]) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`); grad.addColorStop(.6, `rgba(244,247,247,${a * .55})`); grad.addColorStop(1, 'rgba(240,244,245,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createClouds(scene, seed) {
  const capacity = (RANGE * 2 + 1) ** 2 * PUFFS;
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index; geometry.setAttribute('position', base.getAttribute('position')); geometry.setAttribute('uv', base.getAttribute('uv'));
  const offsets = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity);
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('size', new THREE.InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.InstancedBufferAttribute(alphas, 1));
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute vec3 offset; attribute float size; attribute float alpha;
      varying vec2 vUv; varying float vAlpha;
      void main(){
        vUv = uv;
        vec4 mvPosition = viewMatrix * vec4(offset, 1.0);
        mvPosition.xy += position.xy * size;
        vAlpha = alpha * smoothstep(18.0, 75.0, length(mvPosition.xyz));
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map; varying vec2 vUv; varying float vAlpha;
      void main(){
        vec4 t = texture2D(map, vUv);
        if (t.a * vAlpha < .01) discard;
        gl_FragColor = vec4(mix(vec3(.78,.83,.85), vec3(1.0), smoothstep(.2, .9, vUv.y)) * t.rgb, t.a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms.map.value = puffTexture();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'Clouds';
  scene.add(mesh);
  let cellX = Infinity, cellZ = Infinity;
  function rebuild(camera) {
    const puffs = [];
    for (let dx = -RANGE; dx <= RANGE; dx++) for (let dz = -RANGE; dz <= RANGE; dz++) {
      const cx = cellX + dx, cz = cellZ + dz;
      if (hash(cx, cz, seed + 4401) > .55) continue;
      const x = (cx + .2 + hash(cx, cz, seed + 4402) * .6) * CLOUD_CELL, z = (cz + .2 + hash(cx, cz, seed + 4403) * .6) * CLOUD_CELL;
      const y = 230 + hash(cx, cz, seed + 4404) * 120;
      for (let i = 0; i < PUFFS; i++) {
        const r = (k) => hash(cx * 31 + i, cz * 17 + k, seed + 4410);
        puffs.push({ x: x + (r(1) - .5) * 150, y: y + (r(2) - .5) * 30, z: z + (r(3) - .5) * 150, size: 45 + r(4) * 55, alpha: .55 + r(5) * .3 });
      }
    }
    // Back to front from the current camera, so overlapping puffs blend well.
    puffs.sort((a, b) => Math.hypot(b.x - camera.position.x, b.z - camera.position.z) - Math.hypot(a.x - camera.position.x, a.z - camera.position.z));
    puffs.forEach((p, i) => { offsets.set([p.x, p.y, p.z], i * 3); sizes[i] = p.size; alphas[i] = p.alpha; });
    geometry.instanceCount = puffs.length;
    for (const name of ['offset', 'size', 'alpha']) geometry.getAttribute(name).needsUpdate = true;
  }
  return {
    mesh,
    update(camera) {
      const cx = Math.floor(camera.position.x / CLOUD_CELL), cz = Math.floor(camera.position.z / CLOUD_CELL);
      if (cx !== cellX || cz !== cellZ) { cellX = cx; cellZ = cz; rebuild(camera); }
    },
    reset(nextSeed) { seed = nextSeed; cellX = cellZ = Infinity; },
    get count() { return geometry.instanceCount; },
  };
}
