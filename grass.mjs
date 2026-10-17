import * as THREE from 'three';
import { CHUNK } from './world.mjs?v=physics-15';

// Quality presets change density, fade and range live: the worker always
// supplies the full shuffled set, and lower densities draw a prefix of it.
export function createGrass(center, quality = { density: 1, range: 78, fade: 38 }) {
  const fadeUniform = { value: 0 }, rangeUniform = { value: 0 };
  let density = 1, range = 78;
  function setQuality(next) {
    density = next.density; range = next.range;
    fadeUniform.value = next.fade; rangeUniform.value = next.range;
  }
  setQuality(quality);
  // Three tapered, bent blades per tuft. Opaque triangles avoid transparent
  // overdraw and sorting; grass never participates in shadow casting or physics.
  const positions = [];
  for (let blade = 0; blade < 3; blade++) {
    const angle = blade * Math.PI * 2 / 3, c = Math.cos(angle), s = Math.sin(angle);
    for (const [x, y, z] of [[-.16, 0, 0], [.16, 0, 0], [.13, 1 - blade * .13, .2]]) positions.push(x * c - z * s, y, x * s + z * c);
  }
  const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  base.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  const material = new THREE.MeshStandardMaterial({ color: '#7e9059', roughness: 1, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uGrassCenter: center, uGrassFade: fadeUniform, uGrassRange: rangeUniform });
    shader.vertexShader = `attribute vec3 grassRoot; attribute vec3 grassShape;
      uniform vec2 uGrassCenter; uniform float uGrassFade; uniform float uGrassRange; varying float vGrassHeight; varying float vGrassTint;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      float c = cos(grassShape.y), s = sin(grassShape.y);
      objectNormal.xz = mat2(c, s, -s, c) * objectNormal.xz;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      vec2 rootXZ = (modelMatrix * vec4(grassRoot, 1.0)).xz;
      float coverage = 1.0 - smoothstep(uGrassFade, uGrassRange, distance(rootXZ, uGrassCenter));
      vec3 transformed = position;
      transformed.xz = mat2(c, s, -s, c) * transformed.xz;
      transformed *= grassShape.x * coverage;
      transformed += grassRoot;
      vGrassHeight = position.y; vGrassTint = grassShape.z;
    `);
    shader.fragmentShader = 'varying float vGrassHeight; varying float vGrassTint;\n' + shader.fragmentShader;
    // Treat thin blades as a soft canopy: both sides use an upward lighting
    // normal instead of alternating between bright faces and black slivers.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(.68, 1.15, vGrassHeight) * vGrassTint;');
  };
  material.customProgramCacheKey = () => 'grass-v2';
  function build(data) {
    const total = data.roots.length / 3;
    if (!total) return null;
    const geometry = new THREE.InstancedBufferGeometry();
    // Attribute ownership prevents chunk disposal invalidating another mesh.
    geometry.setAttribute('position', base.getAttribute('position').clone()); geometry.setAttribute('normal', base.getAttribute('normal').clone());
    geometry.setAttribute('grassRoot', new THREE.InstancedBufferAttribute(data.roots, 3));
    geometry.setAttribute('grassShape', new THREE.InstancedBufferAttribute(data.shapes, 3));
    geometry.userData.total = total;
    geometry.instanceCount = Math.floor(total * density);
    let low = Infinity, high = -Infinity;
    for (let i = 1; i < data.roots.length; i += 3) { low = Math.min(low, data.roots[i]); high = Math.max(high, data.roots[i]); }
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, low, 0), new THREE.Vector3(CHUNK, high + 1, CHUNK));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.userData.owned = true;
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true;
    return mesh;
  }
  function update(mesh, cx, cz, x, z) {
    if (!mesh) return;
    const dx = Math.max(cx * CHUNK - x, 0, x - (cx + 1) * CHUNK);
    const dz = Math.max(cz * CHUNK - z, 0, z - (cz + 1) * CHUNK);
    mesh.geometry.instanceCount = Math.floor(mesh.geometry.userData.total * density);
    mesh.visible = mesh.geometry.instanceCount > 0 && dx * dx + dz * dz < range * range;
  }
  return { build, update, setQuality, get range() { return range; }, get fadeStart() { return fadeUniform.value; }, get density() { return density; } };
}
