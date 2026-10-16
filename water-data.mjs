// Typed arrays cross the worker boundary by transfer, with no terrain sampling
// or large mesh-generation loops left on the animation thread.
import { lakeExtent, lakeRadius } from './lakes.mjs?v=flight-1';
export function buildWaterData(world, lake) {
  // Irregular sea coasts reach past the nominal radii; cover their full extent.
  const reach = lake.shape.length ? lakeExtent(lake) / Math.max(lake.rx, lake.rz) * 1.06 : 1.03;
  const hx = lake.rx * reach, hz = lake.rz * reach;
  // Large seas use a coarser grid, keeping one patch under 65,536 vertices.
  const step = Math.max(4, 4 * Math.ceil(Math.max(hx, hz) * 2 / 4 / 240));
  const x0 = Math.floor((lake.x - hx) / step) * step, z0 = Math.floor((lake.z - hz) / step) * step;
  const nx = Math.ceil(hx * 2 / step) + 1, nz = Math.ceil(hz * 2 / step) + 1;
  const count = (nx + 1) * (nz + 1);
  const position = new Float32Array(count * 3), bedDepth = new Float32Array(count), lakeUV = new Float32Array(count * 2);
  const indices = [];
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
    const i = iz * (nx + 1) + ix, x = x0 + ix * step, z = z0 + iz * step;
    position.set([x, lake.level + .012, z], i * 3);
    bedDepth[i] = lake.level - world.surface(x, z);
    // Scaled so that length(lakeUV) = 1 on the (irregular) shoreline.
    const u = (x - lake.x) / lake.rx, v = (z - lake.z) / lake.rz, k = lakeRadius(lake, x, z) / (Math.hypot(u, v) || 1);
    lakeUV.set([u * k, v * k], i * 2);
  }
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
    if (Math.max(bedDepth[a], bedDepth[b], bedDepth[c], bedDepth[d]) <= 0) continue;
    indices.push(a, c, b, b, c, d);
  }
  return { position, bedDepth, lakeUV, index: new Uint16Array(indices) };
}
