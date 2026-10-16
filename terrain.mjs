import * as THREE from './vendor/three.module.js';
import { GRID, hash, smoothstep } from './world.mjs?v=physics-3';
import { lakeRadius } from './lakes.mjs?v=physics-3';
export function createTerrain(world) {
  const seed = world.seed;
  const groundColors = { grass: new THREE.Color('#7e9059'), sand: new THREE.Color('#d9b873'), lush: new THREE.Color('#536e48'), dry: new THREE.Color('#b2a477'), rock: new THREE.Color('#8e9385'), snow: new THREE.Color('#dddeda') };
  const tmpColor = new THREE.Color();
  // Far (24 m) and horizon (96 m) samples are revisited by neighbouring tiles.
  const sampleCaches = { 24: new Map(), 96: new Map() };
  function terrainSample(x, z, step) {
    const key = `${x},${z}`, cache = sampleCaches[step];
    if (cache?.has(key)) return cache.get(key);
    const h = world.height(x, z), delta = step / 2;
    const gx = (world.height(x + delta, z) - world.height(x - delta, z)) / step;
    const gz = (world.height(x, z + delta) - world.height(x, z - delta)) / step;
    const length = Math.hypot(gx, 1, gz);
    tmpColor.copy(groundColors.grass).lerp(groundColors.lush, smoothstep(.3, .8, world.woodlandAt(x, z)) * .65);
    tmpColor.lerp(groundColors.dry, smoothstep(.5, .85, hash(Math.floor(x / 36), Math.floor(z / 36), seed + 18)) * .11);
    tmpColor.lerp(groundColors.rock, smoothstep(.26, .65, Math.hypot(gx, gz)) * .65 + world.mountainAt(x, z) * .12);
    tmpColor.lerp(groundColors.sand, world.desertAt(x, z, h));
    tmpColor.lerp(groundColors.snow, smoothstep(117, 168, h) * .87);
    const lake = world.lakeAt?.(x, z);
    if (lake) tmpColor.lerp(groundColors.sand, (1 - smoothstep(.5, 3.8, h - lake.level)) * (1 - smoothstep(1.05, lake.sea ? 1.3 : 1.4, lakeRadius(lake, x, z))) * .84);
    const sample = { height: h, normal: [-gx / length, 1 / length, -gz / length], color: [tmpColor.r, tmpColor.g, tmpColor.b] };
    if (cache) {
      if (cache.size >= 30000) cache.delete(cache.keys().next().value);
      cache.set(key, sample);
    }
    return sample;
  }
  // The surface a coarser tier actually draws: its grid triangles, split the
  // same way as the rendered index buffers (u + v <= 1).
  function gridSample(x, z, step) {
    const ix = Math.floor(x / step) * step, iz = Math.floor(z / step) * step;
    const u = (x - ix) / step, v = (z - iz) / step;
    const corners = u + v <= 1 ? [[ix, iz, 1-u-v], [ix+step, iz, u], [ix, iz+step, v]]
      : [[ix+step, iz+step, u+v-1], [ix, iz+step, 1-u], [ix+step, iz, 1-v]];
    const result = { height: 0, normal: [0,0,0], color: [0,0,0] };
    for (const [px, pz, weight] of corners) {
      const sample = terrainSample(px, pz, step);
      result.height += sample.height * weight;
      for (let i=0; i<3; i++) { result.normal[i] += sample.normal[i]*weight; result.color[i] += sample.color[i]*weight; }
    }
    return result;
  }
  const coarseSample = (x, z) => gridSample(x, z, 24), ultraSample = (x, z) => gridSample(x, z, 96);
  function terrainGeometry(wx, wz, size, step, exclude = null) {
    const positions = [], colors = [], normals = [], indices = [], coarseHeights = [], coarseNormals = [], coarseColors = [], ultraHeights = [];
    const n = Math.round(size / step);
    for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) {
      const x = wx + ix * step, z = wz + iz * step, h = world.height(x, z);
      positions.push(ix * step, h, iz * step);
      const fine = terrainSample(x, z, step);
      normals.push(...fine.normal); colors.push(...fine.color);
      const distant = step === GRID ? coarseSample(x, z) : fine;
      coarseHeights.push(distant.height); coarseNormals.push(...distant.normal); coarseColors.push(...distant.color);
      // Far tiles blend toward the horizon tier's surface before meeting it.
      ultraHeights.push(step === 24 ? ultraSample(x, z).height : distant.height);
    }
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = wx + (ix + .5) * step, z = wz + (iz + .5) * step;
      if (exclude && x >= exclude.x0 && x < exclude.x1 && z >= exclude.z0 && z < exclude.z1) continue;
      const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    return { position: new Float32Array(positions), normal: new Float32Array(normals), color: new Float32Array(colors), index: new Uint32Array(indices), coarseHeight: new Float32Array(coarseHeights), coarseNormal: new Float32Array(coarseNormals), coarseColor: new Float32Array(coarseColors), ultraHeight: new Float32Array(ultraHeights) };
  }
  return { build: terrainGeometry, coarseSample, ultraSample };
}
