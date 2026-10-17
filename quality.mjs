// Graphics presets and the Auto controller. Pure logic: no renderer or DOM, so
// level selection is unit-tested independently of real frame timing.
export const QUALITY_PRESETS = ['auto', 'low', 'medium', 'high'];

// farShadow is the wide second sun shadow map (0 turns it off); see
// shadow-fade.mjs. Low and Medium grass use the cheap five-triangle tufts at a
// lower density, keeping phones near their earlier grass cost. Phones have small CSS viewports, so High may use a denser 2× buffer there and
// still draw fewer pixels than the 1.7× desktop cap on a larger window.
export function qualityLevels(coarse) {
  const high = coarse ? 2 : 1.7;
  return [
    { name: 'low', pixelRatio: 1, shadow: 512, farShadow: 0, grass: { density: .1, range: 36, fade: 16, blades: 'simple' } },
    { name: 'medium', pixelRatio: 1.35, shadow: 1024, farShadow: 1024, grass: { density: .2, range: 48, fade: 22, blades: 'simple' } },
    { name: 'medium+', pixelRatio: (1.35 + high) / 2, shadow: 2048, farShadow: 1024, grass: { density: .75, range: 62, fade: 30, blades: 'full' } },
    { name: 'high', pixelRatio: high, shadow: 2048, farShadow: 2048, grass: { density: 1, range: 78, fade: 38, blades: 'full' } },
  ];
}
export const presetLevel = preset => ({ low: 0, medium: 1, high: 3 })[preset];
// Auto starts phones at the previous fixed mobile settings and desktop at the
// previous fixed desktop settings; it climbs only after proving smooth frames.
export const autoStartLevel = coarse => coarse ? 1 : 3;

const SLOW_MS = 1000 / 48, SMOOTH_MS = 1000 / 57;
// Step down after 2 s of sustained slow frames. Step up after 6 s of smooth
// frames, unless that level recently failed. A level that fails twice is
// not retried during this visit, so Auto never oscillates.
export function createAutoQuality({ start, max, settleMs = 1500, downMs = 2000, upMs = 6000, retryMs = 30000 }) {
  let level = start, settledAt = 0, slowSince = null, smoothSince = null;
  const intervals = [], failures = new Map();
  function reset(now) { intervals.length = 0; slowSince = smoothSince = null; settledAt = now + settleMs; }
  function change(next, now) { level = next; reset(now); return level; }
  return {
    get level() { return level; },
    reset,
    // Returns the new level when it changes, otherwise null.
    sample(intervalMs, now) {
      // Long gaps are a tab switch, a pause or a debugger, not rendering cost.
      if (intervalMs > 250 || now < settledAt) return null;
      intervals.push([now, intervalMs]);
      while (intervals.length && intervals[0][0] < now - downMs) intervals.shift();
      // Judge once the window covers most of its time span, not a frame count:
      // a machine at 8 fps never fits 20 frames into 2 s, yet needs Low most.
      if (intervals.length < 5 || now - intervals[0][0] + intervals[0][1] < downMs * .75) return null;
      const mean = intervals.reduce((sum, [, ms]) => sum + ms, 0) / intervals.length;
      if (mean > SLOW_MS) {
        smoothSince = null; slowSince ??= now;
        if (now - slowSince >= downMs && level > 0) {
          const failed = failures.get(level) ?? { count: 0 };
          failures.set(level, { count: failed.count + 1, until: now + retryMs });
          return change(level - 1, now);
        }
      } else if (mean < SMOOTH_MS) {
        slowSince = null; smoothSince ??= now;
        const next = failures.get(level + 1);
        const allowed = !next || (next.count < 2 && now >= next.until);
        if (now - smoothSince >= upMs && level < max && allowed) return change(level + 1, now);
      } else slowSince = smoothSince = null;
      return null;
    },
  };
}
