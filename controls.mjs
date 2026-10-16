// Shared by the car and boat physics: an analog axis combined with the digital
// keys and buttons. Digital-only input gives exactly -1, 0 or 1 as before.
export function controlAxis(analog, positive, negative) {
  const value = (Number.isFinite(analog) ? analog : 0) + Number(!!positive) - Number(!!negative);
  return Math.min(1, Math.max(-1, value));
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SPEED_DEAD_ZONE = .12, STEER_DEAD_ZONE = .08;

// Left stick, vertical deflection (-1 back .. 1 forward) to throttle. Full
// power arrives just before the rim so a relaxed thumb still drives flat out.
export function speedAxis(y) {
  const magnitude = clamp((Math.abs(y) - SPEED_DEAD_ZONE) / (.85 - SPEED_DEAD_ZONE), 0, 1);
  return Math.sign(y) * magnitude || 0;
}

// Right stick, horizontal deflection (-1 left .. 1 right) to steering.
// Sensitivity changes the response near the center; full deflection is
// always full lock. Above 1 small movements turn sooner, below 1 they give
// finer control.
export function steerAxis(x, sensitivity = 1) {
  const magnitude = clamp((Math.abs(x) - STEER_DEAD_ZONE) / (1 - STEER_DEAD_ZONE), 0, 1);
  return -Math.sign(x) * Math.pow(magnitude, 1 / clamp(sensitivity, .5, 2)) || 0;
}
