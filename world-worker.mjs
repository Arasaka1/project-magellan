import { createWorld, CHUNK, GRID, ROAD_SPACING } from './world.mjs?v=physics-1';
import { createTerrain } from './terrain.mjs?v=physics-1';
import { buildGrass } from './grass-data.mjs?v=physics-1';
import { buildWaterData, buildDistantWater } from './water-data.mjs?v=physics-1';
import { FAR_SIZE, ULTRA_SIZE } from './streaming-layout.mjs?v=physics-1';
let world, terrain;
self.onmessage = ({ data: job }) => {
  try {
    if (!world || world.seed !== job.seed) { world = createWorld(job.seed); terrain = createTerrain(world); }
    const start = performance.now();
    if (job.kind === 'distant-water') {
      const water = buildDistantWater(world, terrain, job.x, job.z), { ranges, ...arrays } = water;
      self.postMessage({ ...job, ranges, water: arrays, workMs: performance.now() - start }, Object.values(arrays).map(array => array.buffer));
      return;
    }
    if (job.kind === 'water') {
      const water = buildWaterData(world, job.lake, terrain);
      self.postMessage({ ...job, water, workMs: performance.now() - start }, Object.values(water).map(array => array.buffer));
      return;
    }
    const size = job.kind === 'near' ? CHUNK : job.kind === 'ultra' ? ULTRA_SIZE : FAR_SIZE;
    const wx = job.cx * size, wz = job.cz * size;
    const ground = terrain.build(wx, wz, size, job.kind === 'near' ? GRID : job.kind === 'ultra' ? 96 : 24);
    const result = { ...job, ground };
    if (job.kind === 'near') {
      result.grass = buildGrass(world, job.cx, job.cz, ground);
      result.props = world.props(job.cx, job.cz);
      result.features = world.featuresNear(wx + CHUNK / 2, wz + CHUNK / 2, 100).filter(f => Math.floor(f.x / CHUNK) === job.cx && Math.floor(f.z / CHUNK) === job.cz);
      result.roadside = [];
      for (const dir of ['x', 'z']) {
        const origin = dir === 'x' ? wx : wz, centerBand = Math.round((dir === 'x' ? wz : wx) / ROAD_SPACING);
        for (let band = centerBand - 1; band <= centerBand + 1; band++) for (let s = Math.ceil(origin / 42) * 42; s < origin + CHUNK; s += 42) for (const side of [-1, 1]) {
          const center = world.roadCenter(s, band, dir), x = dir === 'x' ? s : center + side * 6.4, z = dir === 'x' ? center + side * 6.4 : s;
          if (Math.floor(x / CHUNK) !== job.cx || Math.floor(z / CHUNK) !== job.cz || world.roadAt(x, z).d < 5.8) continue;
          result.roadside.push({ type: 'post', x, z, y: world.surface(x, z), size: 1, turn: 0 });
        }
      }
    }
    if (job.kind === 'far') {
      // Distant forests: the same seeded trees the near chunks will place, so
      // stand-ins and real trees cross-fade without the forest changing shape.
      const trees = { id: [], x: [], z: [], size: [], turn: [], fineY: [], coarseY: [], ultraY: [] };
      for (let dz = 0; dz < 4; dz++) for (let dx = 0; dx < 4; dx++) {
        for (const p of world.props(job.cx * 4 + dx, job.cz * 4 + dz)) {
          if (p.type !== 'tree') continue;
          trees.id.push(p.id); trees.x.push(p.x); trees.z.push(p.z); trees.size.push(p.size); trees.turn.push(p.turn);
          trees.fineY.push(p.y); trees.coarseY.push(terrain.coarseSample(p.x, p.z).height); trees.ultraY.push(terrain.ultraSample(p.x, p.z).height);
        }
      }
      result.trees = trees;
    }
    result.workMs = performance.now() - start;
    self.postMessage(result, [...Object.values(ground), ...Object.values(result.grass || {})].map(array => array.buffer));
  } catch (error) { self.postMessage({ id: job.id, generation: job.generation, error: error.message }); }
};
