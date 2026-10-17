// Weather by region: pure logic, no renderer, so the odds are unit-tested.
// Every WEATHER_AREA square and WEATHER_CELL seconds draws one seeded roll,
// and it rains (or snows) when the roll falls under the region's chance. So
// weather is the same for everyone in an area for a couple of minutes, then
// moves on; the game eases between states, so nothing switches abruptly.
import { hash } from './world.mjs?v=physics-13';

export const WEATHER_CELL = 120; // seconds
export const WEATHER_AREA = 2000; // metres
// Chance of precipitation in each kind of region. Snowfields almost always
// snow; deserts are almost always sunny, rain very rarely and never snow;
// pine woods rain 40% of the time; open meadows somewhere in between.
export const PRECIPITATION = { snow: .9, desert: .03, woods: .4, meadow: .2 };

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// How much of each region a point belongs to (the weights sum to 1). The snow
// line matches the terrain colouring; sand never lies above it.
export function regionWeights(world, x, z) {
  const snow = smoothstep(125, 150, world.height(Math.round(x), Math.round(z)));
  const desert = (1 - snow) * world.desertAt(x, z);
  const woods = (1 - snow - desert) * smoothstep(.45, .65, world.woodlandAt(x, z));
  return { snow, desert, woods, meadow: 1 - snow - desert - woods };
}

// The chance of precipitation here, and whether it would fall as snow.
export function precipitationChance(weights) {
  let chance = 0;
  for (const region in PRECIPITATION) chance += PRECIPITATION[region] * (weights[region] ?? 0);
  return { chance, kind: weights.snow > .5 ? 'snow' : 'rain' };
}

// The seeded roll for an area and time cell: uniform in [0, 1), plus how heavy
// any precipitation is.
export function weatherRoll(seed, x, z, time) {
  const ax = Math.floor(x / WEATHER_AREA), az = Math.floor(z / WEATHER_AREA), cell = Math.floor(time / WEATHER_CELL);
  return { roll: hash(ax * 7919 + cell, az * 104729 - cell, seed + 7307), heaviness: .55 + .45 * hash(ax + cell * 31, az - cell * 17, seed + 7311) };
}

// What the weather should be at a point: 'clear', 'rain' or 'snow', with a
// strength from 0 to 1. A forced kind (?weather=…) skips the roll.
export function weatherAt(world, x, z, time, forced = null) {
  const weights = regionWeights(world, x, z), { chance, kind } = precipitationChance(weights);
  const region = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  if (forced) return { kind: forced, strength: forced === 'clear' ? 0 : 1, chance, region };
  const { roll, heaviness } = weatherRoll(world.seed, x, z, time);
  return roll < chance ? { kind, strength: heaviness, chance, region } : { kind: 'clear', strength: 0, chance, region };
}
