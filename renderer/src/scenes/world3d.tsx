// The shared pieces of the 3D scenes (aircraft, ship): a cel-shaded look with ink outlines, toon skies,
// clouds, ground, an animated low-poly sea, weather, smoke and fire, and seeded randomness. Every piece is
// a pure function of the frame and the scene's seed, so renders repeat exactly. The seed mixes the scene's
// id with the video's own seed, so two videos never share a sky, a city or a livery.
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import * as THREE from "three";
import type { Scene, Setting, Theme } from "../types";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.inOut(Easing.cubic);

export type Weather = "clear" | "rain" | "storm" | "fog" | "snow";

// ---------- deterministic randomness ----------

export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
// The scene's own seed: its place in the video mixed with the video's seed (from its title).
export const sceneSeed = (scene: Scene) => seedOf(scene.id) ^ (scene.seed ?? 0);

// ---------- palette ----------

export type Palette = { top: string; horizon: string; ground: string; ground2: string; cloud: string; light: number };
const PALETTES: Partial<Record<Setting, Palette>> & { sky: Palette } = {
  sky: { top: "#3f8fd8", horizon: "#cfe9f7", ground: "#6fb36a", ground2: "#5a9d57", cloud: "#ffffff", light: 1 },
  sea: { top: "#3f8fd8", horizon: "#d8eef8", ground: "#2f7fb8", ground2: "#276ea3", cloud: "#ffffff", light: 1 },
  countryside: { top: "#4b9be0", horizon: "#e6f6ff", ground: "#86c66a", ground2: "#6cad55", cloud: "#ffffff", light: 1 },
  city: { top: "#4f93d4", horizon: "#dbe9f3", ground: "#8a93a3", ground2: "#767f90", cloud: "#ffffff", light: 1 },
  desert: { top: "#e9a258", horizon: "#fde4b8", ground: "#e2ad66", ground2: "#cf9850", cloud: "#fff6e8", light: 1 },
  snow: { top: "#7d9ab8", horizon: "#dfe8f0", ground: "#eef3f8", ground2: "#d9e3ec", cloud: "#f4f7fa", light: 0.95 },
  night: { top: "#070d26", horizon: "#27325e", ground: "#141b38", ground2: "#10162e", cloud: "#3a4570", light: 0.45 },
};

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// The palette for a place, greyed and darkened by its weather.
export const paletteOf = (s: Setting | null | undefined, weather?: Weather | null): Palette => {
  const p = (s && PALETTES[s]) || PALETTES.sky;
  const night = s === "night";
  switch (weather) {
    case "storm":
      return night
        ? { ...p, cloud: "#2a3150", light: p.light * 0.8 }
        : { top: "#39414f", horizon: "#848c99", ground: mix(p.ground, "#3a4250", 0.45), ground2: mix(p.ground2, "#323a47", 0.45), cloud: "#8e95a2", light: p.light * 0.62 };
    case "rain":
      return night
        ? { ...p, cloud: "#323a5c" }
        : { top: "#6c7c90", horizon: "#c0c9d3", ground: mix(p.ground, "#5d6876", 0.3), ground2: mix(p.ground2, "#56616f", 0.3), cloud: "#d3d8df", light: p.light * 0.8 };
    case "fog":
      return { ...p, top: mix(p.top, "#c9d0d8", 0.7), horizon: mix(p.horizon, "#dfe3e8", 0.8), cloud: mix(p.cloud, "#e6e9ed", 0.5), light: p.light * 0.88 };
    case "snow":
      return night ? p : { ...p, top: "#8ea3b8", horizon: "#e3e9ef", cloud: "#eef2f6", light: p.light * 0.9 };
    default:
      return p;
  }
};

// How far one can see: fog closes in for fog, rain and storms.
export const fogRange = (weather?: Weather | null): [number, number] =>
  weather === "fog" ? [15, 150] : weather === "storm" ? [40, 300] : weather === "rain" ? [50, 360] : weather === "snow" ? [50, 380] : [120, 620];

// Generic liveries: colour pairs that belong to no real airline or shipping line, picked by the video seed.
export type Livery = { accent: string; accent2: string; hull: string };
const LIVERIES: Livery[] = [
  { accent: "#d63a3a", accent2: "#1f3c88", hull: "#1d2a44" },
  { accent: "#2b6fd6", accent2: "#0f2f6b", hull: "#16284a" },
  { accent: "#e38b20", accent2: "#2b3a55", hull: "#2b3a55" },
  { accent: "#1f9e74", accent2: "#0f4d3c", hull: "#123c32" },
  { accent: "#7b3fc4", accent2: "#2a1a52", hull: "#241a3e" },
  { accent: "#c8303f", accent2: "#5a1220", hull: "#3a1018" },
  { accent: "#0e8fb0", accent2: "#f2b632", hull: "#0d3a4a" },
  { accent: "#3a3f4b", accent2: "#d9a12b", hull: "#22252c" },
];
export const liveryOf = (seed: number): Livery => LIVERIES[Math.floor(rng(seed ^ 0x51a7)() * LIVERIES.length)];

// ---------- materials ----------

// Three tones and hard steps between them: the cel look of a flat illustration.
export const toonRamp = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

export const Toon: React.FC<{ color: string }> = ({ color }) => <meshToonMaterial color={color} gradientMap={toonRamp} />;

// Ink outline: the back faces pushed out along their normals and drawn flat dark ("inverted hull").
export const outlineMaterial = (width: number) =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { width: { value: width } },
    vertexShader: "uniform float width; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * width, 1.0); }",
    fragmentShader: "void main(){ gl_FragColor = vec4(0.06, 0.07, 0.12, 1.0); }",
  });

type Placed = { position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number] };

export const Inked: React.FC<{ geometry: THREE.BufferGeometry; color: string; outline?: number } & Placed> = ({ geometry, color, outline = 0.035, ...rest }) => {
  const ink = useMemo(() => outlineMaterial(outline), [outline]);
  return (
    <group {...rest}>
      <mesh geometry={geometry}>
        <Toon color={color} />
      </mesh>
      <mesh geometry={geometry} material={ink} />
    </group>
  );
};

// An inked box, the building block of decks, bridges, containers and towers. Its ink is a slightly bigger
// box drawn inside out, which outlines a box cleanly where pushing split face normals would leave gaps.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
export const inkMaterial = new THREE.MeshBasicMaterial({ color: "#0f1220", side: THREE.BackSide });
export const InkedBox: React.FC<{ size: [number, number, number]; color: string; at: [number, number, number]; outline?: number; rotation?: [number, number, number] }> = ({
  size,
  color,
  at,
  outline = 0.05,
  rotation,
}) => (
  <group position={at} rotation={rotation}>
    <mesh geometry={unitBox} scale={size}>
      <Toon color={color} />
    </mesh>
    <mesh geometry={unitBox} material={inkMaterial} scale={[size[0] + 2 * outline, size[1] + 2 * outline, size[2] + 2 * outline]} />
  </group>
);

// A flat outline extruded into a thin slab. Points are (x, z) for wings, (x, y) for fins and sails.
export const slab = (points: [number, number][], depth: number) => {
  const shape = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
};

// ---------- sky, clouds, ground ----------

export const Sky: React.FC<{ pal: Palette }> = ({ pal }) => {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(pal.top) }, horizon: { value: new THREE.Color(pal.horizon) } },
        vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; varying vec3 p; void main(){ float h = clamp((p.y + 0.12) * 1.4, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, smoothstep(0.0, 1.0, h)), 1.0); }",
      }),
    [pal.top, pal.horizon],
  );
  return (
    <mesh material={mat}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
};

// A cloud: a cluster of flat-shaded puffs.
export const Cloud: React.FC<{ seed: number; color: string }> = ({ seed, color }) => {
  const puffs = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: 5 + Math.floor(r() * 4) }, () => ({
      x: (r() - 0.5) * 9,
      y: r() * 1.4,
      z: (r() - 0.5) * 4,
      s: 1.2 + r() * 1.6,
    }));
  }, [seed]);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  return (
    <group>
      {puffs.map((p, i) => (
        <mesh key={i} geometry={geo} position={[p.x, p.y, p.z]} scale={[p.s * 1.3, p.s, p.s]}>
          <meshToonMaterial color={color} gradientMap={toonRamp} emissive={color} emissiveIntensity={0.45} />
        </mesh>
      ))}
    </group>
  );
};

// Ground texture: patches of two tones (fields, sea swells, city blocks), drawn once per setting.
export const groundTexture = (pal: Palette, setting: Setting | null | undefined, seed: number) => {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = pal.ground;
  g.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  if (setting === "sea") {
    g.strokeStyle = pal.ground2;
    g.lineWidth = 6;
    for (let i = 0; i < 40; i++) {
      const x = r() * 512;
      const y = r() * 512;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 18, y - 8, x + 36, y);
      g.stroke();
    }
  } else if (setting === "city") {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() > 0.5 ? pal.ground2 : "rgba(255,255,255,0.08)";
      g.fillRect(Math.floor(r() * 16) * 32 + 4, Math.floor(r() * 16) * 32 + 4, 24, 24);
    }
  } else {
    // Fields: soft-edged rounded patches in the second tone, and a couple of pale roads.
    for (let i = 0; i < 18; i++) {
      g.fillStyle = pal.ground2;
      const x = r() * 512;
      const y = r() * 512;
      const w = 60 + r() * 110;
      const h = 50 + r() * 90;
      for (const [dx, dy] of [[0, 0], [-512, 0], [0, -512], [-512, -512]]) {
        g.beginPath();
        g.roundRect(x + dx, y + dy, w, h, 18);
        g.fill();
      }
    }
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 5;
    for (let i = 0; i < 2; i++) {
      const y = r() * 512;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(170, y + 60, 340, y - 60, 512, y);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

// City blocks: toon boxes in two tones on a street grid, streaming past with the ground.
export const City: React.FC<{ seed: number; distance: number }> = ({ seed, distance }) => {
  const blocks = useMemo(() => {
    const r = rng(seed + 5);
    const out: { x: number; z: number; w: number; d: number; h: number; tone: number }[] = [];
    for (let gx = 0; gx < 26; gx++)
      for (let gz = -9; gz <= 9; gz++) {
        if (r() < 0.35) continue;
        out.push({ x: gx * 12, z: gz * 12, w: 5 + r() * 5, d: 5 + r() * 5, h: 2 + r() ** 2 * 16, tone: Math.floor(r() * 3) });
      }
    return out;
  }, [seed]);
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const tones = ["#c9ced8", "#a9b1c0", "#e2d6c3"];
  return (
    <group>
      {blocks.map((b, i) => {
        const x = ((((b.x - distance) % 312) + 312) % 312) - 80;
        return (
          <mesh key={i} geometry={box} position={[x, b.h / 2, b.z]} scale={[b.w, b.h, b.d]}>
            <meshToonMaterial color={tones[b.tone]} gradientMap={toonRamp} />
          </mesh>
        );
      })}
    </group>
  );
};

// ---------- the sea ----------

// Height of the water at (x, z) at time t (frames): a few long swells and a short chop, taller in a storm.
export const waveAt = (x: number, z: number, t: number, amp: number) =>
  amp *
  (0.55 * Math.sin(x * 0.11 + t * 0.05) +
    0.35 * Math.sin(z * 0.17 - t * 0.04 + x * 0.05) +
    0.25 * Math.sin((x + z) * 0.31 + t * 0.09) +
    0.12 * Math.sin((x - z) * 0.6 - t * 0.13));

export const swellOf = (weather?: Weather | null) => (weather === "storm" ? 1.5 : weather === "rain" ? 0.75 : 0.45);

// A faceted low-poly sea around the camera: every triangle its own flat tone, moving with the swell.
// `travel` slides the swell past a ship that holds its place, so it reads as sailing.
export const Sea: React.FC<{ pal: Palette; frame: number; travel: number; amp: number; size?: number }> = ({ pal, frame, travel, amp, size = 520 }) => {
  const seg = 72;
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, seg, seg).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    return g;
  }, [size]);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Swells fade toward the edge, so the patch meets the flat far sea without a seam.
    const fade = Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(z)) / (size / 2));
    pos.setY(i, waveAt(x + travel, z, frame, amp) * Math.min(1, fade * 3));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return (
    <group>
      <mesh geometry={geo}>
        <meshToonMaterial color={pal.ground} gradientMap={toonRamp} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[5000, 5000]} />
        <meshToonMaterial color={pal.ground2} gradientMap={toonRamp} />
      </mesh>
    </group>
  );
};

// ---------- smoke, fire, flashes, splashes ----------

const puff = new THREE.IcosahedronGeometry(1, 0);

// A column of smoke from `at`: puffs born every two frames that rise and drift with the wind, darker
// near the source, with flickering flame at its foot for fire. `since` is frames since it started.
export const Smoke: React.FC<{ at: [number, number, number]; since: number; wind: [number, number, number]; fire?: boolean; scale?: number; seed?: number }> = ({
  at,
  since,
  wind,
  fire = false,
  scale = 1,
  seed = 3,
}) => {
  if (since < 0) return null;
  const count = Math.min(32, Math.floor(since / 2));
  return (
    <group position={at} scale={scale}>
      {Array.from({ length: count }, (_, i) => {
        const age = i * 2 + (since % 2);
        const r = rng(i * 7 + seed);
        const k = age / 10;
        const fadeOut = 1 - Math.max(0, age - 46) / 18;
        return (
          <mesh
            key={i}
            geometry={puff}
            position={[wind[0] * age + (r() - 0.5) * 0.5 * k, wind[1] * age + (r() - 0.5) * 0.3 * k, wind[2] * age + (r() - 0.5) * 0.5 * k]}
            scale={Math.max(0, (0.25 + age * 0.035) * fadeOut)}
          >
            <meshToonMaterial color={i < 3 && fire ? "#ff9a3c" : age < 12 ? "#4f5461" : "#868b97"} emissive="#454a56" emissiveIntensity={0.35} gradientMap={toonRamp} />
          </mesh>
        );
      })}
      {fire
        ? [0, 1, 2].map((k) => (
            <mesh key={k} position={[(k - 1) * 0.3, 0.3 + 0.1 * Math.sin(since / 2 + k), 0]} scale={[1, 1 + 0.35 * Math.sin(since / 2 + k * 2), 1]}>
              <coneGeometry args={[0.32 - k * 0.04, 1.1, 8]} />
              <meshBasicMaterial color={k === 1 ? "#ffcf4a" : "#ff6a2a"} />
            </mesh>
          ))
        : null}
    </group>
  );
};

// A bright burst that swells and fades over a few frames.
export const Flash: React.FC<{ at: [number, number, number]; since: number; size?: number }> = ({ at, since, size = 1 }) => {
  const f = since < 0 ? 0 : Math.max(0, 1 - since / 10);
  if (f <= 0) return null;
  return (
    <mesh geometry={puff} position={at} scale={size * (0.6 + 2.6 * (1 - f))}>
      <meshBasicMaterial color="#fff1b0" transparent opacity={f} />
    </mesh>
  );
};

// White water thrown up at `at`, `since` frames ago: puffs flung outward that fall back.
export const Splash: React.FC<{ at: [number, number, number]; since: number; size?: number; seed?: number }> = ({ at, since, size = 1, seed = 1 }) => {
  if (since < 0 || since > 60) return null;
  return (
    <group position={at} scale={size}>
      {Array.from({ length: 18 }, (_, i) => {
        const r = rng(i * 11 + seed);
        const a = r() * Math.PI * 2;
        const v = 0.06 + r() * 0.08;
        const up = 0.12 + r() * 0.12;
        const y = Math.max(0, up * since - 0.004 * since * since);
        const s = (0.25 + r() * 0.35) * (1 - since / 60);
        return (
          <mesh key={i} geometry={puff} position={[Math.cos(a) * v * since, y, Math.sin(a) * v * since]} scale={s}>
            <meshToonMaterial color="#ffffff" emissive="#dfefff" emissiveIntensity={0.5} gradientMap={toonRamp} />
          </mesh>
        );
      })}
    </group>
  );
};

// ---------- weather ----------

// When lightning strikes in a storm, in frames from the scene's start: one every three seconds or so.
export const lightningFrames = (seed: number, D: number, fps = 30): number[] => {
  const r = rng(seed ^ 0x7177);
  const count = Math.max(1, Math.floor(D / (fps * 3)));
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.2 + r() * 0.5) / count) * D));
};

// How bright a lightning flash is now: a strike, a dip, a second flicker, then dark.
export const flashOf = (frames: number[], frame: number) =>
  frames.reduce((m, f) => {
    const t = frame - f;
    if (t < 0 || t > 9) return m;
    return Math.max(m, t < 2 ? 1 : t < 4 ? 0.35 : t < 5 ? 0.8 : 0.8 * (1 - (t - 5) / 4));
  }, 0);

// Rain, snow, fog haze and lightning drawn flat over the 3D picture, like the top layer of an illustration.
export const WeatherOverlay: React.FC<{ weather?: Weather | null; seed: number; night?: boolean }> = ({ weather, seed, night }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  if (!weather || weather === "clear") return null;
  const r = rng(seed ^ 0x3a1);
  const wet = weather === "rain" || weather === "storm";
  const drops = wet ? (weather === "storm" ? 220 : 140) : weather === "snow" ? 130 : 0;
  const flash = weather === "storm" ? flashOf(lightningFrames(seed, D, fps), frame) : 0;
  const bolt = weather === "storm" ? lightningFrames(seed, D, fps).find((f) => frame - f >= 0 && frame - f < 5) : undefined;
  const slant = weather === "storm" ? 0.32 : 0.18;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {weather === "fog" ? (
        <AbsoluteFill style={{ background: "linear-gradient(rgba(225,229,234,0.2), rgba(225,229,234,0.55) 70%, rgba(225,229,234,0.7))" }} />
      ) : null}
      {wet ? <AbsoluteFill style={{ background: night ? "rgba(10,14,30,0.18)" : "rgba(40,50,64,0.14)" }} /> : null}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {bolt !== undefined
          ? (() => {
              const br = rng(seed + bolt);
              let x = width * (0.2 + br() * 0.6);
              const pts = [`${x},0`];
              for (let y = height * 0.08; y < height * 0.62; y += height * 0.07) {
                x += (br() - 0.5) * width * 0.08;
                pts.push(`${x},${y}`);
              }
              return <polyline points={pts.join(" ")} fill="none" stroke="#f4f7ff" strokeWidth={Math.max(4, width / 260)} strokeLinejoin="bevel" />;
            })()
          : null}
        {Array.from({ length: drops }, (_, i) => {
          const near = i % 3 === 0;
          const x0 = r();
          const phase = r();
          const speed = wet ? (near ? 0.055 : 0.038) : near ? 0.006 : 0.004;
          const p = (phase + frame * speed) % 1.15;
          const y = (p - 0.08) * height;
          if (wet) {
            const len = (near ? 0.07 : 0.045) * height;
            const x = ((x0 + p * slant) % 1.1) * width - width * 0.05;
            return <line key={i} x1={x} y1={y} x2={x - len * slant} y2={y - len} stroke={night ? "#9fb0d8" : "#e6eef8"} strokeOpacity={near ? 0.55 : 0.35} strokeWidth={near ? 3 : 2} strokeLinecap="round" />;
          }
          const x = (x0 + 0.02 * Math.sin(frame / 18 + i)) * width;
          return <circle key={i} cx={x} cy={y} r={(near ? 7 : 4) * (width / 1920 + 0.3)} fill="#ffffff" fillOpacity={near ? 0.9 : 0.65} />;
        })}
      </svg>
      {flash > 0 ? <AbsoluteFill style={{ background: "#eef3ff", opacity: flash * 0.55 }} /> : null}
    </AbsoluteFill>
  );
};

// ---------- the heading plate ----------

// The scene's heading and line under it, sliding in at the top left.
export const HeadingPlate: React.FC<{ scene: Scene; theme: Theme; short: boolean }> = ({ scene, theme, short }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!scene.heading) return null;
  const p = spring({ frame: frame - 6, fps, config: { damping: 16 } });
  const k = short ? 1.35 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: short ? 70 : 90,
        top: short ? 200 : 70,
        maxWidth: short ? undefined : 1100,
        padding: `${14 * k}px ${26 * k}px`,
        background: `${theme.background}d9`,
        borderLeft: `${8 * k}px solid ${theme.accent}`,
        borderRadius: 10,
        fontFamily: theme.font,
        fontWeight: 800,
        fontSize: 42 * k,
        color: theme.text,
        opacity: p,
        transform: `translateX(${interpolate(p, [0, 1], [-60, 0])}px)`,
      }}
    >
      {scene.heading}
      {scene.text ? <div style={{ fontSize: 26 * k, fontWeight: 600, color: theme.muted, marginTop: 4 }}>{scene.text}</div> : null}
    </div>
  );
};
