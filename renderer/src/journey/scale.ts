// The journey's one number: L, the log10 of the measure in metres (how tall you are, how far you have
// gone), as a smooth function of time through the keys fyt/journey.py writes from the narration. The
// renderer draws everything from L: which world is on screen, where the camera is, the readout.
import type { Journey } from "../types";

export const LY = 9.4607e15; // metres in a light-year
export const AU = 1.496e11;

// Monotone cubic through the keys (Fritsch-Carlson), so L never overshoots a key or runs backwards, and
// its speed changes smoothly instead of lurching at every beat.
export const levelAt = (keys: Journey["keys"], t: number): number => {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].L;
  const n = keys.length;
  if (t >= keys[n - 1].t) return keys[n - 1].L;
  const xs = keys.map((k) => k.t);
  const ys = keys.map((k) => k.L);
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / Math.max(1e-6, x - xs[i]));
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  let i = 0;
  while (i < n - 2 && t > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i];
  const u = (t - xs[i]) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
};

// What the camera shows at time t: the cold open shows where the journey ends, then it starts again.
export const shownLevel = (j: Journey, t: number): number => {
  const cold = j.coldOpen ?? 0;
  if (t < cold) {
    const end = j.keys[j.keys.length - 1]?.L ?? 0;
    return end - 0.35 + (t / Math.max(0.1, cold)) * 0.25;
  }
  return levelAt(j.keys, t);
};

const sig = (x: number, digits = 3): string => {
  if (x >= 100) return Math.round(x).toLocaleString("en-US");
  const p = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.max(x, 1e-9))));
  return x.toFixed(Math.min(p, 2)).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
};

const big = (x: number): string => {
  if (x >= 1e12) return `${sig(x / 1e12)} trillion`;
  if (x >= 1e9) return `${sig(x / 1e9)} billion`;
  if (x >= 1e6) return `${sig(x / 1e6)} million`;
  return sig(x);
};

// A length in the unit a person would use for it: metres, kilometres, millions of kilometres, then
// light-years.
export const formatLength = (m: number): string => {
  if (m < 10) return `${sig(m, 2)} m`;
  if (m < 10000) return `${Math.round(m).toLocaleString("en-US")} m`;
  if (m < 1e9) return `${Math.round(m / 1000).toLocaleString("en-US")} km`;
  if (m < 0.05 * LY) return `${big(m / 1000)} km`;
  const ly = m / LY;
  return `${ly < 10 ? sig(ly, 3) : big(ly)} light-year${ly === 1 ? "" : "s"}`;
};

// 0 -> 1 smoothly across [a, b].
export const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
