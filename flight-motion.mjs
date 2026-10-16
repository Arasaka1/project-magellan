// Arcade flight for the transforming ATLAS: deterministic fixed-step motion
// shared by the game and the tests, with no renderer required.
import { waterWave } from './lakes.mjs?v=amphibious-1';
import { controlAxis } from './controls.mjs?v=slider-1';
export const FLIGHT_TRANSFORM_SECONDS = 1.6;
export const TAKEOFF_SPEED = 30; // m/s, 108 km/h
export const STALL_SPEED = 22; // m/s; slower than this the wings lose lift
export const CRUISE_SPEED = 48;
export const MAX_AIRSPEED = 95; // m/s, about 340 km/h
export const CEILING = 650; // metres above sea level
export const SAFE_ALTITUDE = 35; // hands-off climb-out height above the ground
const BOAT_TRANSFORM_SECONDS = 2.4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// F toggles the request; the transformation and lift follow in fixed steps.
export function toggleFlight(car) { car.flightMode = !car.flightMode; return car.flightMode; }

function startFlying(car, climb) {
  const horizontal = Math.hypot(car.vx, car.vz);
  car.flying = true; car.grounded = false; car.floating = false; car.boatMode = false;
  car.airspeed = Math.hypot(horizontal, car.vy);
  car.climb = climb ?? clamp(Math.atan2(car.vy, Math.max(horizontal, 1)), -.5, .5);
  car.sink = 0; car.coyote = 0; car.jumpBuffer = 0; car.airtime = 0; car.airDistance = 0;
  car.flights++;
}

function retractHulls(car, dt) {
  car.transform = Math.max(0, car.transform - dt / BOAT_TRANSFORM_SECONDS);
  car.boatMode = false;
}

// Fully winged on the ground or the water: the propeller drives the car or the
// floating hull until it reaches lift-off speed.
function taxi(car, input, world, dt, groundAt) {
  const water = world.waterAt?.(car.x, car.z);
  const onWater = Boolean(water && water.depth > .55 && car.y < water.level + .3);
  const throttle = controlAxis(input.throttle, input.up, input.down);
  const turn = controlAxis(input.steer, input.left, input.right);
  const climbInput = Number(!!input.jump) - Number(!!input.brake);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const oldX = car.x, oldZ = car.z;
  let speed = car.vx * fx + car.vz * fz;
  speed += (throttle > 0 ? 16 * throttle : throttle < 0 ? 20 * throttle : 0) * dt;
  speed = clamp(speed * Math.exp(-(onWater ? .14 : .05) * dt), -6, MAX_AIRSPEED);
  car.steer += (turn - car.steer) * (1 - Math.exp(-8 * dt));
  car.heading += car.steer * .9 * Math.min(Math.abs(speed) / 6, 1) / (1 + Math.abs(speed) * .02) * Math.sign(speed || 1) * dt;
  const hx = Math.sin(car.heading), hz = Math.cos(car.heading);
  car.vx = hx * speed; car.vz = hz * speed; car.vy = 0;
  car.x += car.vx * dt; car.z += car.vz * dt;
  const g = groundAt(world, car.x, car.z, car.heading);
  const level = water?.level ?? 0;
  car.y = onWater ? Math.max(g.y, level - .52 + waterWave(car.x, car.z, car.time)) : g.y;
  car.groundY = g.y; car.grounded = !onWater; car.floating = onWater; car.onRoad = false;
  car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  car.pitch += ((onWater ? 0 : g.pitch) - car.pitch) * (1 - Math.exp(-10 * dt));
  car.roll += ((onWater ? 0 : g.roll) - car.roll) * (1 - Math.exp(-10 * dt));
  car.speed = speed; car.airspeed = Math.abs(speed); car.time += dt;
  car.distance += Math.hypot(car.x - oldX, car.z - oldZ);
  retractHulls(car, dt);
  // Rotate at lift-off speed; holding Climb lifts off a little sooner.
  if (speed > TAKEOFF_SPEED - (climbInput > 0 ? 4 : 0)) startFlying(car, .1 + Math.max(0, climbInput) * .08);
  return true;
}

function land(car, ground, water) {
  const descent = -car.vy;
  car.flying = false; car.flightMode = false; car.sink = 0; car.climb = 0;
  car.y = ground; car.vy = 0; car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0;
  car.impact = Math.max(car.impact, clamp(descent * .02, 0, .3));
  // A steep or fast arrival scrubs speed, but the car always lands drivable.
  if (descent > 9) { car.vx *= .55; car.vz *= .55; }
  car.roll = Math.atan2(Math.sin(car.roll), Math.cos(car.roll));
  if (water) {
    car.floating = true; car.grounded = false; car.waterDepth = water.depth; car.waterLevel = water.level;
  } else { car.grounded = true; car.landLock = .1; car.coyote = .1; }
}

function fly(car, input, world, dt, groundAt) {
  const throttle = controlAxis(input.throttle, input.up, input.down);
  const turn = controlAxis(input.steer, input.left, input.right); // positive turns left
  const climbInput = Number(!!input.jump) - Number(!!input.brake);
  const lift = car.flight;
  const oldX = car.x, oldZ = car.z;
  const below = groundAt(world, car.x, car.z, car.heading).y;
  // Obstacle impacts slow the horizontal velocity; carry that into airspeed.
  const horizontal = Math.hypot(car.vx, car.vz), expected = car.airspeed * Math.cos(car.climb);
  let speed = expected > 1 && horizontal < expected * .999 ? car.airspeed * horizontal / expected : car.airspeed;
  speed += (throttle > 0 ? 18 * throttle : throttle < 0 ? 16 * throttle : (CRUISE_SPEED - speed) * .15) * (.4 + .6 * lift) * dt;
  speed = clamp(speed - 9.8 * Math.sin(car.climb) * dt, 0, MAX_AIRSPEED);
  // Full lift above stall speed with the wings fully out; none when folded.
  const support = clamp((speed - STALL_SPEED * .6) / (STALL_SPEED * .4), 0, 1) * lift;
  // Hands off, the plane climbs out to a safe height and then levels; diving
  // or folding the wings to land switches the assist off.
  const assist = car.flightMode ? clamp((SAFE_ALTITUDE - (car.y - below)) / SAFE_ALTITUDE, 0, 1) : 0;
  car.climb += (climbInput ? (climbInput * .55 - car.climb) * 2.2 : (.22 * assist - car.climb) * .9) * dt;
  car.climb -= (1 - support) * .9 * dt; // a stall drops the nose
  if (car.y > CEILING) car.climb = Math.min(car.climb, -(car.y - CEILING) * .004);
  car.climb = clamp(car.climb, -.7, .6);
  // Bank to turn: the roll sets the yaw rate, like a coordinated turn.
  car.roll += (-turn * .75 * lift - car.roll) * (1 - Math.exp(-3.2 * dt));
  car.heading += -car.roll * .85 * dt;
  car.steer += (0 - car.steer) * (1 - Math.exp(-8 * dt));
  car.sink = support >= 1 ? Math.max(0, car.sink - 12 * dt) : car.sink + 12 * (1 - support) * dt;
  const cp = Math.cos(car.climb), sp = Math.sin(car.climb);
  car.vx = Math.sin(car.heading) * cp * speed; car.vz = Math.cos(car.heading) * cp * speed;
  car.vy = sp * speed - car.sink;
  car.x += car.vx * dt; car.z += car.vz * dt; car.y += car.vy * dt;
  car.airspeed = speed; car.speed = speed * cp; car.pitch = -car.climb; car.time += dt;
  const travelled = Math.hypot(car.x - oldX, car.z - oldZ);
  car.distance += travelled; car.flightDistance += travelled; car.airtime += dt;
  retractHulls(car, dt);
  const water = world.waterAt?.(car.x, car.z), deep = water && water.depth > .9 ? water : null;
  const g = groundAt(world, car.x, car.z, car.heading);
  const ground = deep ? Math.max(g.y, water.level - .52) : g.y;
  car.groundY = g.y; car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  car.maxAltitude = Math.max(car.maxAltitude, car.y - g.y);
  if (car.y <= ground) land(car, ground, deep);
  return true;
}

// Returns true when it moved the car this tick. Otherwise the car or boat
// physics run as usual (while the wings unfold on the ground, or fold away).
export function stepFlight(car, input, world, dt, groundAt) {
  car.flight = clamp(car.flight + (car.flightMode ? dt : -dt) / FLIGHT_TRANSFORM_SECONDS, 0, 1);
  if (!car.flying) {
    // A jumping car with its wings half out starts to glide.
    if (car.flightMode && car.flight >= .35 && !car.grounded && !car.floating) startFlying(car);
    else if (car.flightMode && car.flight === 1) return taxi(car, input, world, dt, groundAt);
    else return false;
  }
  return fly(car, input, world, dt, groundAt);
}
