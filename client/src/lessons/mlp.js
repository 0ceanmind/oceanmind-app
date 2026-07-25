/**
 * Tiny multi-layer perceptron for the Neural Networks lesson.
 * Pure JS, no dependencies — runs in the browser and in node:test.
 * Binary classifier: 2 inputs → hidden layers (tanh) → 1 output (sigmoid).
 */

function randn(rand) {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createMLP(hiddenSizes, seedRand = Math.random) {
  const sizes = [2, ...hiddenSizes, 1];
  const layers = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l];
    const nOut = sizes[l + 1];
    const scale = Math.sqrt(2 / nIn);
    layers.push({
      w: Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => randn(seedRand) * scale)),
      b: Array.from({ length: nOut }, () => 0),
    });
  }
  return { sizes, layers };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Forward pass. Returns activations per layer (a[0] = input). */
function forwardAll(net, x) {
  const acts = [x];
  let a = x;
  for (let l = 0; l < net.layers.length; l++) {
    const { w, b } = net.layers[l];
    const last = l === net.layers.length - 1;
    const out = new Array(w.length);
    for (let j = 0; j < w.length; j++) {
      let z = b[j];
      const wj = w[j];
      for (let i = 0; i < wj.length; i++) z += wj[i] * a[i];
      out[j] = last ? sigmoid(z) : Math.tanh(z);
    }
    acts.push(out);
    a = out;
  }
  return acts;
}

export function predict(net, x) {
  const acts = forwardAll(net, x);
  return acts[acts.length - 1][0];
}

/**
 * One SGD epoch over the dataset (shuffled). Binary cross-entropy loss.
 * @returns average loss over the epoch
 */
export function trainEpoch(net, data, lr, rand = Math.random) {
  const idx = data.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  let totalLoss = 0;
  for (const k of idx) {
    const { x, y } = data[k];
    const acts = forwardAll(net, x);
    const out = acts[acts.length - 1][0];
    const p = Math.min(1 - 1e-7, Math.max(1e-7, out));
    totalLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));

    // backward — delta for sigmoid + BCE is (out - y)
    let delta = [out - y];
    for (let l = net.layers.length - 1; l >= 0; l--) {
      const { w, b } = net.layers[l];
      const aPrev = acts[l];
      const newDelta = new Array(aPrev.length).fill(0);
      for (let j = 0; j < w.length; j++) {
        const d = delta[j];
        const wj = w[j];
        for (let i = 0; i < wj.length; i++) {
          newDelta[i] += wj[i] * d;
          wj[i] -= lr * d * aPrev[i];
        }
        b[j] -= lr * d;
      }
      if (l > 0) {
        // through tanh of previous layer's output
        for (let i = 0; i < newDelta.length; i++) {
          const a = acts[l][i];
          newDelta[i] *= 1 - a * a;
        }
      }
      delta = newDelta;
    }
  }
  return totalLoss / data.length;
}

export function accuracy(net, data) {
  let ok = 0;
  for (const { x, y } of data) {
    if ((predict(net, x) >= 0.5 ? 1 : 0) === y) ok++;
  }
  return ok / data.length;
}

/* ---------------- datasets (coords in [-1, 1]) ---------------- */

export function makeDataset(kind, n = 120, rand = Math.random) {
  const pts = [];
  if (kind === 'blobs') {
    for (let i = 0; i < n; i++) {
      const y = i % 2;
      const cx = y === 0 ? -0.45 : 0.45;
      const cy = y === 0 ? -0.35 : 0.35;
      pts.push({ x: [cx + randn(rand) * 0.16, cy + randn(rand) * 0.16], y });
    }
  } else if (kind === 'circle') {
    for (let i = 0; i < n; i++) {
      const y = i % 2;
      const r = y === 0 ? rand() * 0.3 : 0.55 + rand() * 0.28;
      const t = rand() * Math.PI * 2;
      pts.push({ x: [r * Math.cos(t), r * Math.sin(t)], y });
    }
  } else {
    // spiral
    for (let i = 0; i < n; i++) {
      const y = i % 2;
      const t = (i / n) * 3.2 * Math.PI + (y === 0 ? 0 : Math.PI);
      const r = 0.08 + (i / n) * 0.82;
      pts.push({
        x: [r * Math.cos(t) + randn(rand) * 0.03, r * Math.sin(t) + randn(rand) * 0.03],
        y,
      });
    }
  }
  return pts;
}
