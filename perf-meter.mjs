// A debug overlay for frame rate and frame time (Settings → FPS meter).
// Frame intervals come from requestAnimationFrame timestamps, so they are
// what you actually see, vsync included; CPU is the main-thread work per
// frame. The text refreshes four times a second; the graph shows the last
// 120 frames against the 60 fps (16.7 ms) and 30 fps (33.3 ms) lines.
const HISTORY = 120, GRAPH_MS = 50;

export function createPerfMeter(parent) {
  const root = document.createElement('div');
  root.id = 'perfMeter'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  const text = document.createElement('pre'), graph = document.createElement('canvas');
  graph.width = HISTORY * 2; graph.height = 56;
  root.append(text, graph); parent.append(root);
  const ctx = graph.getContext('2d');
  const intervals = new Float32Array(HISTORY), cpu = new Float32Array(HISTORY);
  let head = 0, count = 0, textAt = 0, drawAt = 0, visible = false, last = null;

  function draw() {
    const w = graph.width, h = graph.height, y = ms => h - Math.min(1, ms / GRAPH_MS) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(14, 22, 18, .55)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const k = (head - count + i + HISTORY) % HISTORY, ms = intervals[k], x = (HISTORY - count + i) * 2;
      ctx.fillStyle = ms > 33.4 ? '#e8896a' : ms > 17.5 ? '#e9c98a' : '#9fd39a';
      ctx.fillRect(x, y(ms), 2, h - y(ms));
      ctx.fillStyle = 'rgba(246, 227, 183, .55)'; ctx.fillRect(x, y(cpu[k]), 2, 1.5);
    }
    ctx.fillStyle = 'rgba(246, 240, 220, .35)';
    for (const ms of [1000 / 60, 1000 / 30]) ctx.fillRect(0, Math.round(y(ms)), w, 1);
  }

  return {
    // Every drawn frame, with its rAF timestamp and the CPU time it took
    // (the interval is measured between drawn frames, so a paused game's slow
    // redraws show as such). info: { draws, triangles, level, pixelRatio, paused }.
    frame(cpuMs, now, info) {
      if (!visible) return;
      const intervalMs = last === null ? 0 : now - last; last = now;
      if (!(intervalMs > 0) || intervalMs > 1000) return; // first frame, or back from a hidden tab
      intervals[head] = intervalMs; cpu[head] = cpuMs; head = (head + 1) % HISTORY; count = Math.min(HISTORY, count + 1);
      if (now - drawAt > 60) { drawAt = now; draw(); }
      if (now - textAt < 250) return;
      textAt = now;
      // Statistics over about the last second.
      const recent = [], cpus = [];
      for (let i = 0, total = 0; i < count && total < 1000; i++) {
        const k = (head - 1 - i + HISTORY) % HISTORY; recent.push(intervals[k]); cpus.push(cpu[k]); total += intervals[k];
      }
      const mean = recent.reduce((s, v) => s + v, 0) / recent.length, sorted = [...recent].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max = sorted.at(-1);
      const cpuMean = cpus.reduce((s, v) => s + v, 0) / cpus.length;
      text.textContent = `${(1000 / mean).toFixed(0).padStart(3)} FPS  ${mean.toFixed(1)} ms${info.paused ? '  (paused)' : ''}\n`
        + `p95 ${p95.toFixed(1)}  max ${max.toFixed(1)} ms\n`
        + `CPU ${cpuMean.toFixed(1)} ms\n`
        + `${info.draws} draws  ${(info.triangles / 1000).toFixed(0)}k tris\n`
        + `${info.level} · ${info.pixelRatio.toFixed(2)}× res`;
    },
    setVisible(on) {
      visible = on; root.hidden = !on;
      if (on) { count = 0; textAt = drawAt = 0; last = null; text.textContent = 'measuring…'; ctx.clearRect(0, 0, graph.width, graph.height); }
    },
    get visible() { return visible; },
  };
}
