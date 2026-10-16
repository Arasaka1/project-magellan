import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';
import { toggleFlight, TAKEOFF_SPEED, STALL_SPEED, CEILING, FLIGHT_TRANSFORM_SECONDS } from '../flight-motion.mjs';

const world = createWorld(3);
function run(car, input, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) { stepVehicle(car, input, world, []); each?.(car); }
  return car;
}
const altitude = car => car.y - world.surface(car.x, car.z);
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
  run(car, { up: true, jump: true }, 6);
  assert.ok(altitude(car) > start + 40, `climbed to ${altitude(car)} m`);
  assert.ok(car.flights === 1 && car.flightDistance > 100);
  assert.ok(Math.abs(car.pitch + car.climb) < 1e-9, 'the nose follows the climb');
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

test('banking turns the plane, and it levels out when the input is released', () => {
  const car = airborne(), heading = car.heading;
  run(car, { left: true }, 3);
  assert.ok(car.roll < -.5, `bank ${car.roll}`); assert.ok(car.heading > heading + .5);
  run(car, { right: true }, 6);
  assert.ok(car.roll > .5);
  run(car, {}, 4);
  assert.ok(Math.abs(car.roll) < .05 && Math.abs(car.climb) < .05);
  assert.ok(car.airspeed < 75 && car.airspeed > 40, `drifts back toward cruise speed: ${car.airspeed}`);
});

test('slowing below stall speed drops the nose and loses height; the ceiling holds', () => {
  const car = airborne();
  run(car, { up: true, jump: true }, 4);
  const high = car.y;
  run(car, { down: true, jump: true }, 10);
  assert.ok(car.airspeed < STALL_SPEED + 2, `airspeed ${car.airspeed}`);
  assert.ok(car.climb < .2 && car.y < high + 60);
  const climber = airborne();
  let peak = 0;
  run(climber, { up: true, jump: true }, 60, c => { peak = Math.max(peak, c.y); });
  assert.ok(peak > CEILING - 40 && peak < CEILING + 25, `peak ${peak}`);
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
  car.flightMode = true; car.flight = 1; car.flying = true; car.airspeed = 40; car.climb = -.1;
  car.y = lake.level + 6; car.grounded = false; car.floating = false;
  run(car, {}, 4, c => { if (c.flying) c.climb = -.1; });
  assert.equal(car.flying, false); assert.equal(car.floating, true);
  run(car, {}, 3);
  assert.ok(car.transform > .9, 'the hulls deploy again on the water');
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
