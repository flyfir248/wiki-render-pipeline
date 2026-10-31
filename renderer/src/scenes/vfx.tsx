// Soft particle effects: smoke, ash, dust, flame and blasts drawn as camera-facing sprites with soft,
// ragged edges, in place of lit polyhedra. Every particle's state is worked out from `since` (frames
// since the effect began) and its own seeded random numbers, so frame 200 drawn before frame 100 comes
// out the same.
//
// Smoke is drawn with normal blending, lighter as it ages and thins; flame and blasts add light
// (additive blending), so where flames overlap they burn brighter, as real fire does. Sprites never
// write depth, so overlapping puffs blend instead of cutting each other off.
import React from "react";
import * as THREE from "three";

const rand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) | 0;
  return ((seed >>> 0) % 100000) / 100000;
};

// A soft blob with a ragged, cloudy edge: a radial falloff broken up by a few octaves of value noise.
// Four variants, so neighbouring puffs never look stamped from one shape. Made once per page.
const textures: Partial<Record<string, THREE.Texture>> = {};
export const puffTexture = (variant: number, kind: "smoke" | "flame" = "smoke"): THREE.Texture => {
  const key = `${kind}${variant % 4}`;
  const cached = textures[key];
  if (cached) return cached;
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  const img = g.createImageData(N, N);
  const r = rand(97 + variant * 31);
  const grid = (n: number) => Array.from({ length: (n + 1) * (n + 1) }, () => r());
  const octaves = [4, 8, 16].map((n) => ({ n, v: grid(n) }));
  const noise = (x: number, y: number) =>
    octaves.reduce((sum, { n, v }, k) => {
      const fx = x * n, fy = y * n;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => v[Math.min(n, j) * (n + 1) + Math.min(n, i)];
      const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
      const bot = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
      return sum + (top * (1 - sy) + bot * sy) / 2 ** k;
    }, 0) / 1.75;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / (N - 1), v = y / (N - 1);
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = noise(u, v);
      // the edge eats inwards where the noise is low: a cloud, not a disc
      const a = Math.max(0, Math.min(1, (1 - d * (kind === "flame" ? 1.15 : 1.0)) * 1.6 - (1 - n) * 0.9));
      const shade = kind === "flame" ? 1 : 0.78 + 0.22 * n; // smoke keeps a little inner texture
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * shade);
      img.data[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures[key] = tex;
  return tex;
};

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));

type Puff = { pos: [number, number, number]; size: number; color: THREE.Color; opacity: number; spin: number; variant: number; add?: boolean };

// One particle as a sprite. Fog still applies, so far smoke fades into the haze like everything else.
export const Sprite: React.FC<{ p: Puff }> = ({ p }) => (
  <sprite position={p.pos} scale={[p.size, p.size, 1]}>
    <spriteMaterial
      map={puffTexture(p.variant, p.add ? "flame" : "smoke")}
      color={p.color}
      opacity={p.opacity}
      rotation={p.spin}
      transparent
      depthWrite={false}
      blending={p.add ? THREE.AdditiveBlending : THREE.NormalBlending}
      toneMapped={!p.add}
    />
  </sprite>
);

// A column of smoke rising from `at` and drifting with the wind; with `fire`, flames lick at its foot.
export const SmokeColumn: React.FC<{
  at: [number, number, number]; since: number; wind: [number, number, number]; fire?: boolean; scale?: number; seed?: number;
  dark?: string; light?: string;
}> = ({ at, since, wind, fire = false, scale = 1, seed = 3, dark = "#3d3f45", light = "#9a9ca3" }) => {
  if (since < 0) return null;
  const puffs: Puff[] = [];
  const life = 80; // frames a puff lives
  const every = 1.6; // a new puff this often
  const born = Math.floor(since / every);
  for (let n = Math.max(0, born - Math.ceil(life / every)); n <= born; n++) {
    const age = since - n * every;
    if (age < 0 || age > life) continue;
    const r = rand(n * 7919 + seed * 104729);
    const k = age / life;
    // rises fast and slows, spreads as it climbs, wanders a little
    const climb = 1 - Math.exp(-age / 30);
    const spread = 0.25 + k * 1.6;
    const wob = (r() - 0.5) * 2;
    puffs.push({
      pos: [wind[0] * age + wob * spread * 0.6, wind[1] * age * (0.6 + 0.4 * climb) + r() * 0.3, wind[2] * age + (r() - 0.5) * spread * 0.6],
      size: 1.0 + age * 0.085 * (0.8 + r() * 0.5),
      color: mix(fire && age < 8 ? "#2a2522" : dark, light, k * 1.3),
      opacity: Math.min(1, age / 6) * (1 - k) ** 1.2 * 0.95,
      spin: r() * 6.28 + age * (r() - 0.5) * 0.02,
      variant: n,
    });
  }
  if (fire) puffs.push(...flames(since, 14, 1.1, seed));
  return (
    <group position={at} scale={scale}>
      {puffs.map((p, i) => <Sprite key={i} p={p} />)}
    </group>
  );
};

// Flames: short-lived additive sprites born at the base, rising and shrinking, yellow to red.
const flames = (since: number, count: number, size: number, seed: number): Puff[] => {
  const life = 14;
  return Array.from({ length: count }, (_, i) => {
    const r = rand(i * 131 + seed * 7);
    const phase = r() * life;
    const age = (since + phase) % life;
    const k = age / life;
    const cycle = Math.floor((since + phase) / life);
    const q = rand(cycle * 977 + i * 53 + seed);
    return {
      pos: [(q() - 0.5) * 0.9 * size, k * 1.6 * size + q() * 0.2, (q() - 0.5) * 0.9 * size] as [number, number, number],
      size: size * (1.1 - k * 0.7) * (0.7 + q() * 0.6),
      color: mix("#ffe08a", "#ff3d12", k * 1.2),
      opacity: Math.min(1, age / 2) * (1 - k) * 0.9,
      spin: q() * 6.28,
      variant: i,
      add: true,
    };
  });
};

// A billowing cloud thrown out from a point: ash from a volcano, dust from a collapse, smoke after a
// blast. Puffs are flung out and up, grow and slow, the core darker than the rim.
export const BillowCloud: React.FC<{
  at: [number, number, number]; since: number; count?: number; spread?: number; rise?: number; size?: number;
  color?: string; dark?: string; seed?: number; life?: number;
}> = ({ at, since, count = 24, spread = 1, rise = 1, size = 1, color = "#9a948c", dark = "#6f6a64", seed = 5, life = 200 }) => {
  if (since < 0) return null;
  const t = Math.min(since, life);
  const fade = since > life ? Math.max(0, 1 - (since - life) / 60) : 1;
  const puffs: Puff[] = [];
  // twice the puffs the old billow had, smaller, so the cloud has texture instead of a few lumps
  const total = count * 2;
  for (let i = 0; i < total; i++) {
    const r = rand(i * 13 + seed * 7);
    const a = r() * Math.PI * 2;
    const born = r() * 16;
    const age = t - born;
    if (age <= 0) continue;
    const out = (1 - Math.exp(-age / 30)) * spread * (2 + r() * 5);
    const up = (1 - Math.exp(-age / 45)) * rise * (1 + r() * 7);
    const core = 1 - Math.min(1, out / (spread * 6));
    puffs.push({
      pos: [Math.cos(a) * out, up + r() * 0.5, Math.sin(a) * out],
      size: size * (0.9 + r() * 1.4) * (0.4 + Math.min(1.6, age / 22)) * 1.6,
      color: mix(color, dark, core * 0.8 + (i % 3 === 0 ? 0.2 : 0)),
      opacity: Math.min(1, age / 5) * 0.8 * fade,
      spin: r() * 6.28 + age * 0.004,
      variant: i,
    });
  }
  return (
    <group position={at}>
      {puffs.map((p, i) => <Sprite key={i} p={p} />)}
    </group>
  );
};

// A blast: a white-hot core that swells into an orange fireball and burns out into dark smoke.
export const Blast: React.FC<{ at: [number, number, number]; since: number; size?: number; seed?: number }> = ({ at, since, size = 1, seed = 9 }) => {
  if (since < 0 || since > 70) return null;
  const puffs: Puff[] = [];
  for (let i = 0; i < 26; i++) {
    const r = rand(i * 211 + seed);
    const dir = new THREE.Vector3(r() - 0.5, r() * 0.8, r() - 0.5).normalize();
    const reach = size * (1.2 + r() * 2.2) * (1 - Math.exp(-since / 9));
    const k = Math.min(1, since / 40);
    puffs.push({
      pos: [dir.x * reach, dir.y * reach + since * 0.02 * size, dir.z * reach],
      size: size * (1.4 + r() * 1.6) * (0.5 + Math.sqrt(k) * 1.2),
      color: mix(k < 0.25 ? "#fff3c4" : "#ffb347", "#ff4a14", k * 1.3),
      opacity: Math.max(0, 1 - k) * 0.95,
      spin: r() * 6.28,
      variant: i,
      add: true,
    });
    // the smoke that the fire leaves behind, darkening as the flame dies
    if (since > 10)
      puffs.push({
        pos: [dir.x * reach * 1.05, dir.y * reach * 1.05 + (since - 10) * 0.035 * size, dir.z * reach * 1.05],
        size: size * (1.6 + r() * 1.6) * (0.6 + (since - 10) / 40),
        color: mix("#2c2724", "#6b655f", (since - 10) / 60),
        opacity: Math.min(0.75, (since - 10) / 18) * (1 - Math.max(0, since - 50) / 20),
        spin: r() * 6.28,
        variant: i + 3,
      });
  }
  return (
    <group position={at}>
      {puffs.map((p, i) => <Sprite key={i} p={p} />)}
    </group>
  );
};

// A bright flash that swells and fades over a few frames: a soft glow, not a hard-edged ball.
export const Glow: React.FC<{ at: [number, number, number]; since: number; size?: number }> = ({ at, since, size = 1 }) => {
  const f = since < 0 ? 0 : Math.max(0, 1 - since / 10);
  if (f <= 0) return null;
  return <Sprite p={{ pos: at, size: size * (3 + 6 * (1 - f)), color: new THREE.Color("#fff1b0"), opacity: f, spin: 0, variant: 1, add: true }} />;
};
