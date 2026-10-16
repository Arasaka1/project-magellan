// Arcade flight for the transforming ATLAS: deterministic fixed-step motion
// shared by the game and the tests, with no renderer required.
import { waterWave } from './lakes.mjs?v=physics-1';
import { controlAxis } from './controls.mjs?v=slider-1';
export const FLIGHT_TRANSFORM_SECONDS = 1.6;
export const TAKEOFF_SPEED = 32; // m/s, 115 km/h: the propeller lifts it off here
export const STALL_SPEED = 26; // m/s; level flight is impossible below this
export const MAX_AIRSPEED = 95; // m/s, about 340 km/h: full throttle in level flight
export const CEILING = 650; // metres above sea level: thin air above this
// Aerodynamics per unit mass (m/s²). Lift = LIFT·ρ·v²·CL(α) at right angles to
// the airflow, toward the plane's own "up"; drag = (DRAG + INDUCED·CL²)·ρ·v².
// Tuned so full throttle levels out near 95 m/s with thrust a little under
// the plane's weight, and the wing stalls past 16° (below ~26 m/s level).
const LIFT = .0085, CL0 = .25, CL_SLOPE = 5, STALL_ANGLE = .28, DRAG = .001, INDUCED = .0006, SIDE = .003;
const MAX_THRUST = 9, MAX_LOAD = 50, NEVER_EXCEED = 140;
export function liftCoefficient(alpha) {
  const peak = CL0 + CL_SLOPE * STALL_ANGLE, trough = CL0 - CL_SLOPE * STALL_ANGLE;
  if (alpha > STALL_ANGLE) return Math.max(.3, peak * (1 - (alpha - STALL_ANGLE) * 2.5));
  if (alpha < -STALL_ANGLE) return Math.min(-.3, trough * (1 - (-alpha - STALL_ANGLE) * 2.5));
  return CL0 + CL_SLOPE * alpha;
}
// Thinning air above 450 m weakens lift, thrust and control: the ceiling.
export const airDensity = y => 1 - .65 * smoothstep(450, 750, y) - .3 * smoothstep(650, 900, y);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const SAFE_ALTITUDE = 35; // hands-off climb-out height above the ground
const BOAT_TRANSFORM_SECONDS = 2.4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const PITCH_RATE = 1.1, ROLL_RATE = 2.2, YAW_RATE = .6; // rad/s at full authority

// F toggles the request; the transformation and lift follow in fixed steps.
export function toggleFlight(car) { car.flightMode = !car.flightMode; return car.flightMode; }

// Flight axes. The game supplies dedicated keys (W/S throttle, ↑↓ or
// Space/Shift pitch, A/D or ←→ roll, Q/E yaw); anything else falls back to
// the driving inputs, so tests and simple controllers still fly.
export function flightAxes(input) {
  return {
    throttle: controlAxis(input.throttle, input.throttleUp ?? input.up, input.throttleDown ?? input.down),
    pitch: Number(!!(input.pitchUp ?? input.jump)) - Number(!!(input.pitchDown ?? input.brake)), // + nose up
    roll: controlAxis(input.steer, input.rollLeft ?? input.left, input.rollRight ?? input.right), // + left wing down
    yaw: Number(!!input.yawLeft) - Number(!!input.yawRight), // + nose left
  };
}

// Attitude is a quaternion (x, y, z, w) in the model frame: +z nose, +y mast,
// +x left wing. Body-axis rates make loops and barrel rolls possible; the
// heading, pitch and roll angles are derived from it for rendering and HUD.
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function qAxis(x, y, z) {
  const angle = Math.hypot(x, y, z); if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / angle; return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
export function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
// Same convention as the renderer: Euler order YXZ (heading, pitch, roll), and
// a negative pitch raises the nose.
export function attitudeFromEuler(heading, pitch, roll) {
  const c1 = Math.cos(pitch / 2), c2 = Math.cos(heading / 2), c3 = Math.cos(roll / 2), s1 = Math.sin(pitch / 2), s2 = Math.sin(heading / 2), s3 = Math.sin(roll / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
export function eulerFromAttitude([x, y, z, w]) {
  const m13 = 2 * (x * z + w * y), m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
  const m11 = 1 - 2 * (y * y + z * z), m31 = 2 * (x * z - w * y);
  const pitch = Math.asin(-clamp(m23, -1, 1));
  return Math.abs(m23) < .9999999 ? { heading: Math.atan2(m13, m33), pitch, roll: Math.atan2(m21, m22) } : { heading: Math.atan2(-m31, m11), pitch, roll: 0 };
}
function setAttitude(car, q) {
  const n = Math.hypot(...q); [car.qx, car.qy, car.qz, car.qw] = q.map(v => v / n);
  Object.assign(car, eulerFromAttitude([car.qx, car.qy, car.qz, car.qw]));
}

function startFlying(car, climb) {
  const horizontal = Math.hypot(car.vx, car.vz);
  car.flying = true; car.grounded = false; car.floating = false; car.boatMode = false;
  car.airspeed = Math.hypot(horizontal, car.vy);
  const angle = climb ?? clamp(Math.atan2(car.vy, Math.max(horizontal, 1)), -.5, .5);
  setAttitude(car, attitudeFromEuler(car.heading, -angle, car.roll));
  car.climb = angle; car.alpha = 0;
  car.sink = 0; car.coyote = 0; car.jumpBuffer = 0; car.airtime = 0; car.airDistance = 0; car.climbOut = false;
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
  const axes = flightAxes(input), throttle = axes.throttle, turn = clamp(axes.roll + axes.yaw, -1, 1), climbInput = axes.pitch;
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
  // Rotate at lift-off speed (holding Climb a little sooner): the nose comes
  // up to a flying angle of attack, and the wings take the weight.
  if (speed > TAKEOFF_SPEED - (climbInput > 0 ? 4 : 0)) { startFlying(car, .03); car.vy = 1; rotateNose(car, -.16); }
  return true;
}

function rotateNose(car, angle) { setAttitude(car, qMul([car.qx, car.qy, car.qz, car.qw], qAxis(angle, 0, 0))); }

// Touching down with the wings still out and a gentle arrival rolls on as a
// taxiing plane (it can take off again). A hard, steep or rolled arrival, or
// one after LAND, becomes the car (or boat) at once.
function touchdown(car, ground, water) {
  const mast = rotate([car.qx, car.qy, car.qz, car.qw], [0, 1, 0]);
  const hard = -car.vy > 7 || mast[1] < .7 || car.climb < -.35;
  if (car.flightMode && !hard) {
    car.flying = false; car.y = ground; car.vy = 0; car.sink = 0; car.airtime = 0; car.airDistance = 0;
    car.grounded = !water; car.floating = Boolean(water);
    car.impact = Math.max(car.impact, .05);
    return;
  }
  land(car, ground, water);
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
  const { throttle, pitch, roll, yaw } = flightAxes(input);
  const wings = car.flight, oldX = car.x, oldZ = car.z;
  const below = groundAt(world, car.x, car.z, car.heading).y;
  let q = [car.qx, car.qy, car.qz, car.qw];
  const nose = rotate(q, [0, 0, 1]), mast = rotate(q, [0, 1, 0]), wing = rotate(q, [1, 0, 0]);
  const v = [car.vx, car.vy, car.vz], speed = Math.hypot(...v), dir = speed > 1e-3 ? v.map(c => c / speed) : nose;
  // Airflow in the plane's frame: angle of attack (nose above the flight path
  // is positive) and sideslip.
  const along = Math.max(dot(v, nose), 1e-3), alpha = Math.atan2(-dot(v, mast), along), beta = Math.atan2(dot(v, wing), along);
  const rho = airDensity(car.y), pressure = rho * speed * speed;
  const cl = liftCoefficient(alpha) * wings; // folded wings give no lift
  // Lift at right angles to the airflow, toward the plane's "up": upside down
  // it pulls toward the ground. Loads are limited to about 5 g.
  const across = mast.map((c, k) => c - dir[k] * dot(mast, dir)), length = Math.hypot(...across) || 1;
  const lift = clamp(LIFT * pressure * cl, -MAX_LOAD, MAX_LOAD);
  // Thrust only while W is held; S opens air brakes. Hands off, it glides.
  const thrust = MAX_THRUST * Math.max(0, throttle) * rho * (.4 + .6 * wings);
  const drag = (DRAG * (1 + 2.5 * Math.max(0, -throttle)) + INDUCED * cl * cl) * pressure, slip = SIDE * pressure * beta;
  for (let k = 0; k < 3; k++) v[k] += (nose[k] * thrust + across[k] / length * lift - dir[k] * drag - wing[k] * slip + (k === 1 ? -9.8 : 0)) * dt;
  const fast = Math.hypot(...v); if (fast > NEVER_EXCEED) for (let k = 0; k < 3; k++) v[k] *= NEVER_EXCEED / fast;
  // Controls: body-axis rates. Their bite grows with airspeed and air density.
  const authority = (.35 + .65 * wings) * clamp(speed / 30, .3, 1) * Math.sqrt(rho);
  const bank = Math.atan2(wing[1], mast[1]); // 0 level, + right wing down, ±π inverted
  let pitchRate = pitch * PITCH_RATE, rollRate = -roll * ROLL_RATE, yawRate = yaw * YAW_RATE;
  // Dihedral: released, slightly banked wings drift back level. Not once
  // steeply banked or inverted, and not during a pull.
  if (!roll && !pitch && Math.abs(bank) < 1.2) rollRate = -clamp(bank, -1, 1) * .5 * wings;
  // Take-off climb-out: hands off and close to the ground the nose comes up
  // to climb away; it levels off again only a climb it started itself.
  const height = car.y - below, pathAngle = Math.asin(clamp(dir[1], -1, 1));
  if (pitch) car.climbOut = false;
  else if (mast[1] > .5 && car.flightMode && height < SAFE_ALTITUDE) {
    const target = .22 * clamp((SAFE_ALTITUDE - height) / SAFE_ALTITUDE, 0, 1);
    if (target > pathAngle) { pitchRate = (target - pathAngle) * 2.5 + .3; car.climbOut = true; }
  } else if (mast[1] > .5 && car.climbOut && height < SAFE_ALTITUDE * 2) {
    pitchRate = -pathAngle * 1.5;
    if (Math.abs(pathAngle) < .02) car.climbOut = false;
  }
  q = qMul(q, qAxis(-pitchRate * authority * dt, yawRate * authority * dt, rollRate * authority * dt));
  // Stability and trim: the tail swings the nose back toward the angle of
  // attack at which lift balances weight on the current flight path (and,
  // upright, in the current bank). Hands off, the plane holds its path; slow,
  // the trim angle passes the stall and the nose drops; upside down, the same
  // trimmed lift points at the ground, so it dives unless pushed.
  const turn = [0, 0, 0];
  if (speed > 1) {
    const upright = Math.cos(bank) > 0, unitAcross = across.map(c => c / length);
    const needed = 9.8 * Math.cos(pathAngle) / (upright ? Math.max(Math.cos(bank), .5) : 1);
    const trim = clamp((needed / Math.max(LIFT * pressure * wings, 1e-3) - CL0) / CL_SLOPE, -.15, STALL_ANGLE - .03);
    const target = dir.map((c, k) => c * Math.cos(trim) + unitAcross[k] * Math.sin(trim));
    const axis = cross(nose, target), sine = Math.hypot(...axis);
    if (sine > 1e-6) {
      const angle = Math.atan2(sine, dot(nose, target)), stability = 2.2 * clamp(speed / 30, .3, 2) * (.5 + .5 * wings) * rho;
      const step = angle * Math.min(1, stability * dt) / sine;
      q = qMul(qAxis(axis[0] * step, axis[1] * step, axis[2] * step), q);
    }
  }
  setAttitude(car, q);
  [car.vx, car.vy, car.vz] = v;
  car.x += v[0] * dt; car.y += v[1] * dt; car.z += v[2] * dt;
  car.airspeed = Math.hypot(...v); car.speed = Math.hypot(v[0], v[2]); car.alpha = alpha;
  car.climb = Math.asin(clamp(v[1] / (car.airspeed || 1), -1, 1));
  car.steer += (0 - car.steer) * (1 - Math.exp(-8 * dt)); car.time += dt;
  const travelled = Math.hypot(car.x - oldX, car.z - oldZ);
  car.distance += travelled; car.flightDistance += travelled; car.airtime += dt;
  retractHulls(car, dt);
  const water = world.waterAt?.(car.x, car.z), deep = water && water.depth > .9 ? water : null;
  const g = groundAt(world, car.x, car.z, car.heading);
  const ground = deep ? Math.max(g.y, water.level - .52) : g.y;
  car.groundY = g.y; car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null;
  car.maxAltitude = Math.max(car.maxAltitude, car.y - g.y);
  if (car.y <= ground) touchdown(car, ground, deep);
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
