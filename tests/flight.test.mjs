import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';
import { toggleFlight, rotate, attitudeFromEuler, liftCoefficient, airDensity, TAKEOFF_SPEED, STALL_SPEED, CEILING, FLIGHT_TRANSFORM_SECONDS } from '../flight-motion.mjs';

const world = createWorld(3);
function run(car, input, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) { stepVehicle(car, input, world, []); each?.(car); }
  return car;
}
const altitude = car => car.y - world.surface(car.x, car.z);
const q = car => [car.qx, car.qy, car.qz, car.qw];
const mastUp = car => rotate(q(car), [0, 1, 0])[1], noseUp = car => rotate(q(car), [0, 0, 1])[1];
// Climb to a comfortable height first: pitch up briefly, then fly on.
// Level flight 300 m above the ground at 80 m/s, well clear of the assists.
function high(car, speed = 80) {
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, 0, 0);
  Object.assign(car, { pitch: 0, roll: 0, climb: 0, airspeed: speed, y: world.surface(car.x, car.z) + 300,
    vx: Math.sin(car.heading) * speed, vy: 0, vz: Math.cos(car.heading) * speed });
  return car;
}
function airborne() {
  const car = createVehicle(world); toggleFlight(car);
  run(car, { up: true }, 8);
  assert.equal(car.flying, true);
  return car;
}

test('wings unfold while driving, then the car taxis, lifts off at speed and climbs', () => {
  const car = createVehicle(world);
  assert.equal(car.flight, 0); assert.equal(toggleFlight(car), true);
  run(car, { up: true }, FLIGHT_TRANSFORM_SECONDS * .5);
  assert.ok(car.flight > .4 && car.flight < .6); assert.equal(car.flying, false);
  let liftOff = null;
  run(car, { up: true }, 8, c => { if (c.flying && liftOff === null) liftOff = Math.abs(c.airspeed); });
  assert.equal(car.flight, 1); assert.equal(car.flying, true);
  // It was already past lift-off speed when the wings locked, so it rotated at once.
  assert.ok(liftOff >= TAKEOFF_SPEED - .5, `lift-off at ${liftOff}`);
  const start = altitude(car);
  run(car, { up: true, jump: true }, .6); run(car, { up: true }, 5.4);
  assert.ok(altitude(car) > start + 40, `climbed to ${altitude(car)} m`);
  assert.ok(car.flights === 1 && car.flightDistance > 100);
  assert.ok(car.alpha > -.2 && car.alpha < .28, `flying below the stall: ${car.alpha}`);
});

test('from a standstill the propeller taxis the car to lift-off speed, and hands-off it climbs out', () => {
  const car = createVehicle(world); toggleFlight(car);
  run(car, {}, FLIGHT_TRANSFORM_SECONDS + .1);
  assert.equal(car.flight, 1); assert.equal(car.flying, false); assert.ok(Math.abs(car.speed) < .5);
  let liftOff = null;
  run(car, { up: true }, 8, c => { if (c.flying && liftOff === null) liftOff = c.airspeed; });
  assert.ok(liftOff > TAKEOFF_SPEED - .5 && liftOff < TAKEOFF_SPEED + 1, `lift-off at ${liftOff}`);
  run(car, {}, 12);
  assert.equal(car.flying, true);
  assert.ok(altitude(car) > 20 && altitude(car) < 100, `levels out at ${altitude(car)} m`);
  assert.ok(Math.abs(car.climb) < .12, 'and flies level');
});

test('the wing makes lift from its angle of attack and stalls past 16°', () => {
  assert.ok(liftCoefficient(0) > 0 && liftCoefficient(.2) > liftCoefficient(.1));
  assert.ok(liftCoefficient(.4) < liftCoefficient(.28) * .8, 'stalled');
  assert.ok(liftCoefficient(-.2) < 0);
  assert.equal(airDensity(0), 1); assert.ok(airDensity(CEILING + 50) < .6);
});

test('upright and hands off it holds its height; upside down it falls', () => {
  const level = high(airborne()), start = level.y;
  run(level, {}, 6);
  assert.equal(level.flying, true); assert.ok(Math.abs(level.y - start) < 40, `held ${level.y - start}`);
  const flipped = high(airborne()), top = flipped.y;
  run(flipped, { rollLeft: true }, 1.43);
  assert.ok(mastUp(flipped) < -.8, `inverted ${mastUp(flipped)}`);
  run(flipped, {}, 3);
  assert.ok(top - flipped.y > 50, `fell ${top - flipped.y} m`); assert.ok(flipped.climb < -.3, 'nose dropping toward the ground');
});

test('there is no thrust unless W is held: hands off it glides and slows, and S brakes harder', () => {
  const coast = high(airborne(), 70), brake = high(airborne(), 70), power = high(airborne(), 70);
  let fastest = 0;
  run(coast, {}, 5, c => { fastest = Math.max(fastest, c.airspeed); });
  run(brake, { down: true }, 5); run(power, { up: true }, 5);
  assert.ok(fastest <= 70.5 && coast.airspeed < 66, `coasting ${coast.airspeed}, peak ${fastest}`);
  assert.ok(brake.airspeed < coast.airspeed - 3 && power.airspeed > 75, `brake ${brake.airspeed}, power ${power.airspeed}`);
});

test('a bank alone barely turns; banking and pulling turns hard', () => {
  const lazy = high(airborne()), h0 = lazy.heading;
  run(lazy, { rollLeft: true }, .5); run(lazy, {}, 3);
  const lazyTurn = lazy.heading - h0;
  assert.ok(Math.abs(lazy.roll) < .4, `wings drift back level: ${lazy.roll}`);
  const pulled = high(airborne()), h1 = pulled.heading;
  run(pulled, { rollLeft: true }, .5); run(pulled, { pitchUp: true }, 3);
  assert.ok(pulled.heading - h1 > .6 && pulled.heading - h1 > lazyTurn * 2, `pulled ${pulled.heading - h1} vs ${lazyTurn}`);
  assert.equal(pulled.flying, true);
});

test('holding roll performs a full barrel roll and the plane flies on', () => {
  const car = high(airborne()), start = car.y;
  let lowest = 1;
  run(car, { rollRight: true }, 2.9, c => { lowest = Math.min(lowest, mastUp(c)); });
  assert.ok(lowest < -.9, `rolled inverted: ${lowest}`);
  run(car, {}, 3);
  assert.equal(car.flying, true); assert.ok(mastUp(car) > .9 && Math.abs(car.y - start) < 150);
});

test('a pull climbs and the path then holds; holding it at full power flies a loop', () => {
  const car = high(airborne(), 90);
  run(car, { pitchUp: true, up: true }, 1);
  const path = car.climb;
  assert.ok(path > .2, `climbing at ${path}`);
  run(car, { up: true }, 1.5);
  assert.ok(Math.abs(car.climb - path) < .2, `holds ${car.climb} near ${path}`);
  const loop = high(airborne(), 92); let inverted = false;
  run(loop, { up: true, pitchUp: true }, 9, c => { if (mastUp(c) < -.8) inverted = true; });
  assert.ok(inverted, 'went over the top of the loop'); assert.equal(loop.flying, true);
});

test('yaw swings the nose without much bank', () => {
  const car = high(airborne()), heading = car.heading;
  run(car, { yawLeft: true }, 2);
  assert.ok(car.heading > heading + .1, `yawed ${car.heading - heading}`);
  assert.ok(Math.abs(car.roll) < .5);
});

test('idle power and a pull stall the wing; the nose drops and power recovers it; thin air caps the climb', () => {
  const car = high(airborne(), 60);
  let peakAlpha = 0, lowestPath = 1;
  run(car, { down: true, pitchUp: true }, 6, c => { peakAlpha = Math.max(peakAlpha, c.alpha); });
  run(car, { down: true }, 6, c => { lowestPath = Math.min(lowestPath, c.climb); });
  assert.ok(peakAlpha > .26, `stalled at ${peakAlpha}`); assert.ok(lowestPath < -.3, `nose dropped: ${lowestPath}`);
  // Recovery is the pilot's job now: power on, let it build speed, ease out.
  run(car, { up: true }, 1.5); run(car, { up: true, pitchUp: true }, 2.5);
  assert.ok(car.flying && car.airspeed > STALL_SPEED + 15, `recovered to ${car.airspeed}, flying ${car.flying}`);
  const climber = airborne(); let peak = 0;
  run(climber, { up: true, pitchUp: true }, .8);
  run(climber, { up: true }, 60, c => { peak = Math.max(peak, c.y); });
  // It can zoom a little above the ceiling on its speed, then the thin air wins.
  assert.ok(peak > CEILING - 100 && peak < CEILING + 250, `peak ${peak}`);
});

test('touching down gently with the wings out rolls on as a plane, not a car', () => {
  const car = airborne(); car.vy = -1; car.y = world.surface(car.x, car.z) + .2;
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(car.heading, -.05, 0);
  run(car, {}, .1);
  assert.equal(car.flying, false); assert.equal(car.flightMode, true); assert.equal(car.flight, 1);
  run(car, { up: true }, 4);
  assert.equal(car.flying, true, 'and takes off again');
});

test('folding the wings in the air glides down to a drivable landing', () => {
  const car = airborne();
  run(car, { up: true, jump: true }, 3);
  toggleFlight(car);
  let landed = false;
  run(car, {}, 40, c => { if (!landed && !c.flying && c.grounded) landed = true; });
  assert.ok(landed); assert.equal(car.flightMode, false); assert.equal(car.flight, 0);
  assert.ok(altitude(car) < 1 && car.grounded);
  assert.ok(car.bestJump < 25, 'a flight is not recorded as a jump');
  const x = car.x; run(car, { up: true }, 2); assert.ok(Math.abs(car.x - x) + Math.abs(car.speed) > 1, 'drives on');
});

test('touching down on deep water lands as a boat, and a boat can take off again', () => {
  const lake = world.starterLake;
  const car = createVehicle(world, lake.x, lake.z, 0);
  assert.equal(car.floating, true);
  car.flightMode = false; car.flight = 1; car.flying = true; car.airspeed = 40; car.climb = -.1;
  car.y = lake.level + 6; car.grounded = false; car.floating = false;
  [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(0, .1, 0); car.vz = 40; car.vx = 0; car.vy = -3;
  run(car, {}, 4);
  assert.equal(car.flying, false); assert.equal(car.floating, true);
  let hulls = 0;
  run(car, {}, 3, c => { hulls = Math.max(hulls, c.transform); });
  assert.ok(hulls > .9, 'the hulls deploy again on the water');
  Object.assign(car, { x: lake.x, z: lake.z, vx: 0, vz: 0, y: lake.level - .52 }); run(car, {}, .5);
  // From the water: wings out, the floats retract, and it lifts off.
  toggleFlight(car);
  let lifted = false;
  run(car, { up: true }, 12, c => { if (c.flying) lifted = true; });
  assert.ok(lifted); assert.ok(car.transform < .2);
});

test('a jumping car with its wings half out starts to glide', () => {
  const car = createVehicle(world); car.vx = 0; car.vz = 32; car.speed = 32;
  car.grounded = false; car.vy = 6; car.y += 3;
  toggleFlight(car);
  run(car, {}, FLIGHT_TRANSFORM_SECONDS * .4);
  assert.equal(car.flying, true);
});
