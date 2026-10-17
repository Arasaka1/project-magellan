import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherAt, regionWeights, precipitationChance, PRECIPITATION, WEATHER_CELL, WEATHER_AREA } from '../weather.mjs';
import { createWorld } from '../world.mjs';

// A world that is one kind of region everywhere.
const region = ({ height = 40, desert = 0, woods = 0 }) => ({ seed: 3, height: () => height, desertAt: () => desert, woodlandAt: () => woods });
const regions = { snow: region({ height: 170 }), desert: region({ desert: 1 }), woods: region({ woods: 1 }), meadow: region({}) };
function share(world, samples = 6000) {
  const kinds = { clear: 0, rain: 0, snow: 0 };
  for (let i = 0; i < samples; i++) kinds[weatherAt(world, (i % 41) * WEATHER_AREA, Math.floor(i / 41) * WEATHER_AREA, i * WEATHER_CELL).kind]++;
  for (const k in kinds) kinds[k] /= samples;
  return kinds;
}

test('snowy regions almost always snow, and never rain', () => {
  const s = share(regions.snow);
  assert.ok(Math.abs(s.snow - .9) < .02, `snow ${s.snow}`); assert.equal(s.rain, 0);
});

test('deserts are almost always sunny, rain very rarely and never snow', () => {
  const s = share(regions.desert);
  assert.ok(s.clear > .95, `sunny ${s.clear}`); assert.ok(s.rain > 0 && s.rain < .06, `rain ${s.rain}`); assert.equal(s.snow, 0);
});

test('pine woods rain about 40% of the time and are sunny the rest', () => {
  const s = share(regions.woods);
  assert.ok(Math.abs(s.rain - .4) < .02, `rain ${s.rain}`); assert.ok(Math.abs(s.clear - .6) < .02); assert.equal(s.snow, 0);
});

test('open meadows rain sometimes', () => {
  const s = share(regions.meadow);
  assert.ok(Math.abs(s.rain - PRECIPITATION.meadow) < .02, `rain ${s.rain}`);
});

test('weather holds within an area for a couple of minutes, then moves on, and can be forced', () => {
  const world = regions.woods, at = t => weatherAt(world, 500, 700, t).kind;
  for (let cell = 0; cell < 50; cell++) assert.equal(at(cell * WEATHER_CELL + 1), at(cell * WEATHER_CELL + WEATHER_CELL - 1));
  assert.ok(new Set(Array.from({ length: 50 }, (_, cell) => at(cell * WEATHER_CELL))).size > 1);
  assert.deepEqual(weatherAt(regions.desert, 0, 0, 0, 'snow').kind, 'snow');
});

test('region weights in a real world sum to one and the chance blends between regions', () => {
  const world = createWorld(3);
  for (let i = 0; i < 200; i++) {
    const x = (i % 20) * 900 - 9000, z = Math.floor(i / 20) * 900 - 4500, w = regionWeights(world, x, z);
    assert.ok(Math.abs(w.snow + w.desert + w.woods + w.meadow - 1) < 1e-9);
    for (const v of Object.values(w)) assert.ok(v >= -1e-9 && v <= 1 + 1e-9);
    const { chance } = precipitationChance(w);
    assert.ok(chance >= PRECIPITATION.desert - 1e-9 && chance <= PRECIPITATION.snow + 1e-9);
  }
});
