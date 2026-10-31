// Surface detail for open ground: a tiling greyscale texture of clumps, blades and flecks that is
// multiplied over the ground's own colours, so terrain seen from close reads as grass, soil or sand
// instead of a smooth painted sheet. Drawn once per kind per page; seeded, so it never changes between
// frames.
import * as THREE from "three";

const rand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) | 0;
  return ((seed >>> 0) % 100000) / 100000;
};

export type Surface = "grass" | "soil" | "sand" | "snow" | "rock";

export const surfaceOf = (kind: string): Surface =>
  ["desert", "beach"].includes(kind) ? "sand" : kind === "snow" ? "snow" : ["mountain", "cave", "quarry"].includes(kind) ? "rock"
    : ["forest", "grassland", "field", "farm", "park", "marsh", "garden", "meadow", "airfield", "river", "lake"].includes(kind) ? "grass" : "soil";

// Tiling value noise: the lattice wraps, so the texture repeats without a seam.
const tilingNoise = (r: () => number, n: number) => {
  const v = Array.from({ length: n * n }, () => r());
  return (x: number, y: number) => {
    const fx = x * n, fy = y * n;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => v[((j % n) + n) % n * n + (((i % n) + n) % n)];
    return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  };
};

const cache = new Map<string, HTMLCanvasElement>();

// The detail as a canvas (for drawing into another texture) ...
export const surfaceCanvas = (surface: Surface, seed = 1): HTMLCanvasElement => {
  const key = `${surface}${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 512;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const r = rand(seed * 7717 + surface.length * 131);
  const octaves = [6, 16, 48].map((n) => tilingNoise(r, n));
  const img = g.createImageData(N, N);
  const depth = surface === "snow" ? 0.06 : surface === "sand" ? 0.1 : 0.2; // how much the clumps darken
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const n = octaves[0](u, v) * 0.5 + octaves[1](u, v) * 0.32 + octaves[2](u, v) * 0.18;
      const k = Math.round(255 * (1 - depth + depth * n));
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // small marks, wrapped at the edges so the tile stays seamless
  const mark = (draw: (dx: number, dy: number) => void) => [[0, 0], [-N, 0], [0, -N], [-N, -N]].forEach(([dx, dy]) => draw(dx, dy));
  if (surface === "grass") {
    g.lineCap = "round";
    for (let i = 0; i < 2600; i++) {
      const x = r() * N, y = r() * N, h = 3 + r() * 7, lean = (r() - 0.5) * 4, dark = r() < 0.55;
      g.strokeStyle = dark ? `rgba(0,0,0,${0.1 + r() * 0.14})` : `rgba(255,255,255,${0.06 + r() * 0.08})`;
      g.lineWidth = 0.8 + r() * 0.9;
      mark((dx, dy) => { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + lean, y + dy - h); g.stroke(); });
    }
  } else {
    const flecks = surface === "rock" ? 900 : surface === "snow" ? 300 : 1800;
    for (let i = 0; i < flecks; i++) {
      const x = r() * N, y = r() * N, s = surface === "rock" ? 1.5 + r() * 5 : 0.6 + r() * 2.2;
      g.fillStyle = r() < 0.6 ? `rgba(0,0,0,${0.08 + r() * 0.16})` : `rgba(255,255,255,${0.05 + r() * 0.1})`;
      mark((dx, dy) => { g.beginPath(); g.ellipse(x + dx, y + dy, s, s * (0.5 + r() * 0.5), r() * 3.14, 0, 6.283); g.fill(); });
    }
  }
  cache.set(key, c);
  return c;
};

// ... or as a repeating texture to multiply over a surface's colours.
const textures = new Map<string, THREE.Texture>();
export const surfaceTexture = (surface: Surface, repeat: number, seed = 1): THREE.Texture => {
  const key = `${surface}${seed}${repeat}`;
  let t = textures.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(surfaceCanvas(surface, seed));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
};
