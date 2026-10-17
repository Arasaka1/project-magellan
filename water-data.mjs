// Typed arrays cross the worker boundary by transfer, with no terrain sampling
// or large mesh-generation loops left on the animation thread.
import { lakeExtent, lakeRadius } from './lakes.mjs?v=physics-16';
export function buildWaterData(world, lake, terrain = null) {
  // Irregular sea coasts reach past the nominal radii; cover their full extent.
  const reach = lake.shape.length ? lakeExtent(lake) / Math.max(lake.rx, lake.rz) * 1.06 : 1.03;
  const hx = lake.rx * reach, hz = lake.rz * reach;
  // Large seas use a coarser grid, keeping one patch under 65,536 vertices.
  const step = Math.max(4, 4 * Math.ceil(Math.max(hx, hz) * 2 / 4 / 240));
  const x0 = Math.floor((lake.x - hx) / step) * step, z0 = Math.floor((lake.z - hz) / step) * step;
  const nx = Math.ceil(hx * 2 / step) + 1, nz = Math.ceil(hz * 2 / step) + 1;
  const count = (nx + 1) * (nz + 1);
  const position = new Float32Array(count * 3), bedDepth = new Float32Array(count), lakeUV = new Float32Array(count * 2), groundY = new Float32Array(count * 2);
  const indices = [];
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const i = iz * (nx + 1) + ix, x = x0 + ix * step, z = z0 + iz * step;
    position.set([x, lake.level + .012, z], i * 3);
    bedDepth[i] = lake.level - world.surface(x, z);
    // Scaled so that length(lakeUV) = 1 on the (irregular) shoreline.
    const u = (x - lake.x) / lake.rx, v = (z - lake.z) / lake.rz, k = lakeRadius(lake, x, z) / (Math.hypot(u, v) || 1);
    lakeUV.set([u * k, v * k], i * 2);
    // Coarse terrain tiers under this vertex (see buildDistantWater).
    groundY.set(terrain ? [terrain.coarseSample(x, z).height, terrain.ultraSample(x, z).height] : [lake.level - 1, lake.level - 1], i * 2);
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
    if (Math.max(bedDepth[a], bedDepth[b], bedDepth[c], bedDepth[d]) <= 0) continue;
    indices.push(a, c, b, b, c, d);
  }
  return { position, bedDepth, lakeUV, groundY, index: new Uint16Array(indices) };
}

// Every lake and sea out to the far horizon, built in the worker: concentric
// rings with depth sampled from the real bed (so colours match the detailed
// patches) and the heights of the coarse terrain tiers under each vertex, so
// distant water can ride just above whichever tier is drawn there.
export const DISTANT_WATER_RADIUS = 4600;
export function buildDistantWater(world, terrain, x, z) {
  const RIM = 40, RINGS = [.35, .65, .85, .97];
  const lakes = world.lakesNear(x, z, DISTANT_WATER_RADIUS);
  const position = [], bedDepth = [], lakeUV = [], groundY = [], index = [], ranges = [];
  for (const lake of lakes) {
    const base = position.length / 3, start = index.length;
    const vertex = (px, pz, u, v) => {
      position.push(px, lake.level + .012, pz);
      bedDepth.push(Math.max(.3, lake.level - world.surface(px, pz))); lakeUV.push(u, v);
      groundY.push(terrain.coarseSample(px, pz).height, terrain.ultraSample(px, pz).height);
    };
    vertex(lake.x, lake.z, 0, 0);
    for (const r of RINGS) for (let i = 0; i < RIM; i++) {
      const a = i / RIM * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
      const shape = 1 / lakeRadius(lake, lake.x + ux * lake.rx, lake.z + uz * lake.rz);
      vertex(lake.x + ux * lake.rx * r * shape, lake.z + uz * lake.rz * r * shape, ux * r, uz * r);
    }
    // Counter-clockwise seen from above, so the triangles face up: the water
    // material draws front faces only, and from the air every distant lake
    // was culled until its detailed patch replaced it about 1 km away.
    for (let i = 0; i < RIM; i++) index.push(base, base + 1 + i, base + 1 + (i + 1) % RIM);
    for (let k = 0; k < RINGS.length - 1; k++) for (let i = 0; i < RIM; i++) {
      const a = base + 1 + k * RIM + i, b = base + 1 + k * RIM + (i + 1) % RIM, c = a + RIM, d = b + RIM;
      index.push(a, d, b, a, c, d);
    }
    ranges.push({ id: lake.id, start, count: index.length - start });
  }
  return { ranges, position: new Float32Array(position), bedDepth: new Float32Array(bedDepth), lakeUV: new Float32Array(lakeUV), groundY: new Float32Array(groundY), index: new Uint32Array(index) };
}
