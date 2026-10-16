// Shared by the car and boat physics: an analog axis combined with the digital
// keys and buttons. Digital-only input gives exactly -1, 0 or 1 as before.
export function controlAxis(analog, positive, negative) {
  const value = (Number.isFinite(analog) ? analog : 0) + Number(!!positive) - Number(!!negative);
  return Math.min(1, Math.max(-1, value));
}

const STEER_DEAD_ZONE = .08;
// Joystick deflection (x right, y up, both -1..1) to driving axes. Sensitivity
// changes the response near the center; full deflection is always full lock.
// Above 1 small movements turn sooner, below 1 they give finer control.
export function stickAxes(x, y, sensitivity = 1) {
  const magnitude = Math.min(1, Math.max(0, (Math.abs(x) - STEER_DEAD_ZONE) / (1 - STEER_DEAD_ZONE)));
  const steer = -Math.sign(x) * Math.pow(magnitude, 1 / Math.min(2, Math.max(.5, sensitivity)));
  // A shallow upward push accelerates fully, so a hard turn keeps its power.
  const gas = Math.min(1, Math.max(0, (y - .15) / .35));
  const brake = Math.min(1, Math.max(0, (-y - .3) / .4));
  return { steer: steer || 0, throttle: gas - brake };
}
