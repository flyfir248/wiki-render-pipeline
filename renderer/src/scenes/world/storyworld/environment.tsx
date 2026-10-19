// The place generator: a set built from its kind (grammar.json "sets"), its time of day and colours, and
// the story's own set dressing (each a parts build from the design). Terrain, water, interiors, sky and
// ground cover are made here from seeded rules, so two forests in two stories are two different forests,
// and a story's pines, picnic tables or police cars stand among them.
import React, { useMemo } from "react";
import * as THREE from "three";
import { rng, Sky, type Palette } from "../../world3d";
import { Block, PartMesh, partsBounds } from "./parts";
import { type Light, type Look, material } from "./style";
import type { Dressing, SetSpec } from "./types";

type R = () => number;
const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

export const WATER = ["sea", "lake", "river", "beach", "swamp"];
export const INSIDE = ["room", "hall", "lab", "hospital", "cave"];
export const VOID = ["space", "micro", "sky"];

// The open water of a set as [near z, far z] in units: it begins just behind the centre spot, so
// boats and ditched aircraft sit on it while people stand on the near bank.
export const waterBand = (kind: string): [number, number] | null =>
  kind === "river" ? [-0.8, -15] : kind === "lake" ? [-1.2, -34] : kind === "beach" ? [-3, -55] : null;

// Spots round the stage, clear of the actors (radius `clear`) and thinner on the camera's side (+z).
export type KeepOut = (x: number, z: number, r: number, h: number) => boolean;
const scatter = (r: R, n: number, clear: number, spread: number, front = 0.35, keep?: KeepOut, size = 0, height = 0) => {
  const out: { x: number; z: number; s: number; a: number }[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const a = r() * Math.PI * 2;
    const d = clear + Math.sqrt(r()) * spread;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (z > 0 && r() > front) continue;
    if (keep && keep(x, z, size, height)) continue;
    out.push({ x, z, s: 0.75 + r() * 0.6, a: r() * Math.PI * 2 });
  }
  return out;
};

// --- ground cover ---------------------------------------------------------------------------------

const Pine: React.FC<{ look: Look; h: number; color: string; snow?: boolean }> = ({ look, h, color, snow }) => (
  <group>
    <Block look={look} shape={look.blocky ? "box" : "cylinder"} color="#5a3e28" size={[h * 0.07, h * 0.3, h * 0.07]} at={[0, h * 0.15, 0]} />
    {[0, 1, 2].map((i) => (
      <Block key={i} look={look} shape={look.blocky ? "box" : "cone"} color={snow && i === 2 ? "#eef3f6" : tone(color, 0.85 + i * 0.08)}
        size={[h * (0.5 - i * 0.12), h * 0.38, h * (0.5 - i * 0.12)]} at={[0, h * (0.36 + i * 0.22), 0]} />
    ))}
  </group>
);

const Broadleaf: React.FC<{ look: Look; h: number; color: string; r: number }> = ({ look, h, color, r }) => (
  <group>
    <Block look={look} shape={look.blocky ? "box" : "cylinder"} color="#6b4a2e" size={[h * 0.08, h * 0.5, h * 0.08]} at={[0, h * 0.25, 0]} />
    {[0, 1, 2].map((i) => (
      <Block key={i} look={look} shape={look.blocky ? "box" : "sphere"} color={tone(color, 0.85 + i * 0.1)}
        size={[h * (0.55 - i * 0.1), h * (0.42 - i * 0.06), h * (0.55 - i * 0.1)]} at={[(i - 1) * h * 0.12 * r, h * (0.6 + i * 0.12), (r - 0.5) * h * 0.15]} />
    ))}
  </group>
);

const Palm: React.FC<{ look: Look; h: number; color: string }> = ({ look, h, color }) => (
  <group>
    {[0, 1, 2, 3].map((i) => (
      <Block key={i} look={look} shape="cylinder" color="#8a6a42" size={[h * 0.06, h * 0.26, h * 0.06]} at={[i * h * 0.03, h * (0.13 + i * 0.24), 0]} rot={[0, 0, -0.08]} />
    ))}
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <Block key={`l${i}`} look={look} color={color} size={[h * 0.45, h * 0.02, h * 0.1]} at={[h * 0.12 + Math.cos(i) * h * 0.18, h * 0.95, Math.sin(i) * h * 0.18]} rot={[0, -i, -0.35]} />
    ))}
  </group>
);

const DeadTree: React.FC<{ look: Look; h: number }> = ({ look, h }) => (
  <group>
    <Block look={look} shape="cylinder" color="#4a3e34" size={[h * 0.07, h, h * 0.07]} at={[0, h * 0.5, 0]} />
    {[0.5, 0.7, 0.85].map((y, i) => (
      <Block key={i} look={look} shape="cylinder" color="#4a3e34" size={[h * 0.03, h * 0.35, h * 0.03]} at={[0, h * y, 0]} rot={[i * 1.4, 0, 0.9 * (i % 2 ? 1 : -1)]} />
    ))}
  </group>
);

const Rock: React.FC<{ look: Look; s: number; color: string }> = ({ look, s, color }) => (
  <Block look={look} shape={look.blocky ? "box" : "sphere"} color={color} size={[s, s * 0.6, s * 0.8]} at={[0, s * 0.2, 0]} rot={[0.2, s, 0.1]} />
);

const Bush: React.FC<{ look: Look; s: number; color: string }> = ({ look, s, color }) => (
  <group>
    <Block look={look} shape={look.blocky ? "box" : "sphere"} color={color} size={[s, s * 0.7, s]} at={[0, s * 0.3, 0]} />
    <Block look={look} shape={look.blocky ? "box" : "sphere"} color={tone(color, 1.12)} size={[s * 0.6, s * 0.5, s * 0.6]} at={[s * 0.25, s * 0.5, s * 0.1]} />
  </group>
);

const Cactus: React.FC<{ look: Look; h: number }> = ({ look, h }) => (
  <group>
    <Block look={look} shape="capsule" color="#4f8a45" size={[h * 0.16, h, h * 0.16]} at={[0, h * 0.5, 0]} />
    <Block look={look} shape="capsule" color="#4f8a45" size={[h * 0.1, h * 0.35, h * 0.1]} at={[h * 0.14, h * 0.55, 0]} />
  </group>
);

function windowTexture(base: string, seed: number, lit: number) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 128);
  const r = rng(seed);
  for (let y = 6; y < 124; y += 14)
    for (let x = 5; x < 60; x += 14) {
      g.fillStyle = r() < lit ? "#ffd98a" : "#2b3442";
      g.fillRect(x, y, 8, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const Building: React.FC<{ w: number; h: number; d: number; color: string; seed: number; lit: number; roof?: boolean }> = ({ w, h, d, color, seed, lit, roof }) => {
  const tex = useMemo(() => {
    const t = windowTexture(color, seed, lit);
    t.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 7)));
    return t;
  }, [color, seed, lit, w, h]);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {roof ? (
        <mesh position={[0, h + w * 0.18, 0]} rotation={[0, 0, 0]} castShadow>
          <coneGeometry args={[Math.max(w, d) * 0.72, w * 0.36, 4]} />
          <meshStandardMaterial color={tone(color, 0.6)} flatShading roughness={0.9} />
        </mesh>
      ) : null}
    </group>
  );
};

// --- water ----------------------------------------------------------------------------------------

const Water: React.FC<{ size: number; color: string; t: number; amp: number; at?: [number, number, number]; shape?: [number, number] }> = ({ size, color, t, amp, at = [0, 0, 0], shape }) => {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(shape ? shape[0] : size, shape ? shape[1] : size, 48, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [size, shape]);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, Math.sin(x * 0.35 + t * 1.3) * amp + Math.cos(z * 0.27 - t * 1.1) * amp * 0.8);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return (
    <mesh geometry={geom} position={at} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.5} metalness={0} flatShading transparent opacity={0.92} />
    </mesh>
  );
};

// --- the set ----------------------------------------------------------------------------------------

const groundGeometry = (size: number, bump: number, seed: number, flat: number, color: string, unit: number) => {
  const g = new THREE.PlaneGeometry(size, size, 96, 96);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const r = rng(seed);
  const a = r() * 10, b = r() * 10;
  const base = new THREE.Color(color);
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const f = 1 / Math.max(0.5, unit);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const k = Math.min(1, Math.max(0, (d - flat) / (flat * 2 + 1)));
    pos.setY(i, (Math.sin(x * 0.09 * f + a) * Math.cos(z * 0.08 * f + b) * bump + Math.sin(x * 0.31 * f + z * 0.23 * f) * bump * 0.25) * k);
    // patches of lighter and darker ground so it reads as terrain, not a sheet
    const n = Math.sin(x * 0.21 * f + a) * Math.cos(z * 0.17 * f + b) * 0.5 + Math.sin(x * 0.07 * f - z * 0.05 * f) * 0.5;
    c.copy(base).multiplyScalar(0.86 + 0.16 * n + (r() - 0.5) * 0.05);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
};

// A ring of far hills, so the ground meets the sky in a skyline rather than a hard edge.
const Skyline: React.FC<{ U: number; seed: number; color: string; look: Look; height: number }> = ({ U, seed, color, look, height }) => {
  const hills = useMemo(() => {
    const r = rng(seed ^ 0x4111);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      const d = U * (42 + r() * 14);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, w: U * (14 + r() * 14), h: U * height * (0.5 + r()) };
    });
  }, [U, seed, height]);
  return (
    <>
      {hills.map((h, i) => (
        <Block key={i} look={look} shape={look.blocky ? "box" : "cone"} color={color} size={[h.w, h.h, h.w * 0.8]} at={[h.x, h.h / 2 - U * 0.4, h.z]} />
      ))}
    </>
  );
};

// A far ring of towers, for a story told against a city: lit windows after dark.
const CitySkyline: React.FC<{ U: number; seed: number; color: string; look: Look; lit: boolean }> = ({ U, seed, color, look, lit }) => {
  const towers = useMemo(() => {
    const r = rng(seed ^ 0x2c17);
    return Array.from({ length: 70 }, (_, i) => {
      const a = (i / 70) * Math.PI * 2 + r() * 0.05;
      const d = U * (46 + r() * 12);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, w: U * (2.5 + r() * 3), h: U * (3 + r() ** 2 * 9), shade: 0.8 + r() * 0.35 };
    });
  }, [U, seed]);
  return (
    <>
      {towers.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, -Math.atan2(b.z, b.x), 0]}>
          {look.blocky ? (
            <Block look={look} color={tone(color, b.shade)} size={[b.w, b.h, b.w]} at={[0, b.h / 2 - U * 0.3, 0]} />
          ) : (
            <Building w={b.w} h={b.h} d={b.w} color={tone(color, b.shade)} seed={seed + (i % 5)} lit={lit ? 0.45 : 0.05} />
          )}
        </group>
      ))}
    </>
  );
};

const Dressed: React.FC<{ d: Dressing; look: Look; seed: number; clear: number; keep?: KeepOut }> = ({ d, look, seed, clear, keep }) => {
  const bb = partsBounds(d.build.parts);
  const spots = useMemo(() => scatter(rng(seed), d.count, Math.max(clear, Math.max(bb.size.x, bb.size.z) * 0.6 + clear * 0.6), d.spread, 0.25, keep, Math.max(bb.size.x, bb.size.z) * 0.6, bb.size.y),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, d.count, clear, d.spread, keep]);
  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.a, 0]} scale={0.85 + (s.s - 0.75) * 0.5}>
          {d.build.parts.map((p, j) => (
            <PartMesh key={j} part={p} look={look} />
          ))}
        </group>
      ))}
    </>
  );
};

export const Environment: React.FC<{ set: SetSpec; look: Look; light: Light; unit: number; seed: number; t: number; keep?: KeepOut }> = ({ set, look, light, unit: U, seed, t, keep }) => {
  const kind = set.kind;
  const r = useMemo(() => rng(seed ^ 0x5e7), [seed]);
  const ground = light.ground;
  const green = mix(set.ground, "#3f7a3a", 0.5);
  const leaf = look.dark > 0.5 ? tone(green, 0.7) : green;
  const clear = U * 3.2;
  const band = waterBand(kind);
  // nothing grows in the water, and nothing stands in front of the camera
  const dry: KeepOut | undefined = useMemo(
    () => (band ? (x: number, z: number, size: number, height: number) => (z < (band[0] + 0.3) * U && z > (band[1] - 0.3) * U) || Boolean(keep && keep(x, z, size, height)) : keep),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, U, keep],
  );
  const items = useMemo(() => {
    const rr = rng(seed ^ 0x77);
    const out: React.ReactNode[] = [];
    const add = (n: number, spread: number, make: (s: { x: number; z: number; s: number; a: number }, i: number) => React.ReactNode, front = 0.3, near = clear) =>
      scatter(rr, n, near, spread, front, dry, U * 1.2, U * 3).forEach((s, i) => out.push(<group key={`${out.length}`} position={[s.x, 0, s.z]} rotation={[0, s.a, 0]}>{make(s, i)}</group>));
    switch (kind) {
      case "forest":
        add(110, U * 26, (s, i) => (i % 3 ? <Pine look={look} h={U * 3.4 * s.s} color={leaf} /> : <Broadleaf look={look} h={U * 3 * s.s} color={mix(leaf, "#b5872a", set.time === "dusk" ? 0.25 : 0.1)} r={s.s} />));
        add(26, U * 10, (s) => <Bush look={look} s={U * 0.45 * s.s} color={tone(leaf, 1.1)} />, 0.5, U * 2.2);
        add(10, U * 9, (s) => <Rock look={look} s={U * 0.35 * s.s} color="#7a7a72" />, 0.5, U * 2);
        break;
      case "grassland":
      case "farm":
        add(9, U * 24, (s) => <Broadleaf look={look} h={U * 2.6 * s.s} color={leaf} r={s.s} />, 0.2, U * 6);
        add(18, U * 12, (s) => <Bush look={look} s={U * 0.4 * s.s} color={tone(leaf, 1.15)} />, 0.4, U * 2.5);
        add(8, U * 12, (s) => <Rock look={look} s={U * 0.3 * s.s} color="#8a867a" />, 0.4, U * 2.5);
        if (kind === "farm") {
          for (let i = 0; i < 14; i++) out.push(<Block key={`f${i}`} look={look} color="#7a5a3a" size={[U * 0.08, U * 0.6, U * 0.08]} at={[-U * 9 + i * U * 1.4, U * 0.3, -U * 3.5]} />);
          out.push(<Block key="rail" look={look} color="#8a6a4a" size={[U * 18.5, U * 0.06, U * 0.05]} at={[0, U * 0.45, -U * 3.5]} />);
          out.push(<group key="barn" position={[-U * 7, 0, -U * 9]}><Building w={U * 4} h={U * 2.6} d={U * 3} color="#a33a2a" seed={seed} lit={0} roof /></group>);
        }
        break;
      case "mountain":
        add(24, U * 20, (s) => <Pine look={look} h={U * 3 * s.s} color={leaf} />, 0.25, U * 4);
        add(16, U * 12, (s) => <Rock look={look} s={U * 0.7 * s.s} color="#7f8078" />, 0.4, U * 2.5);
        break;
      case "snow":
        add(26, U * 20, (s) => <Pine look={look} h={U * 3 * s.s} color="#3c5e4a" snow />, 0.25, U * 4);
        add(8, U * 10, (s) => <Rock look={look} s={U * 0.4 * s.s} color="#c9d4dc" />, 0.4, U * 2.5);
        break;
      case "desert":
        add(10, U * 18, (s) => <Cactus look={look} h={U * 1.4 * s.s} />, 0.3, U * 3);
        add(14, U * 16, (s) => <Rock look={look} s={U * 0.6 * s.s} color="#b07a4a" />, 0.4, U * 2.5);
        break;
      case "beach":
        add(8, U * 10, (s) => <Palm look={look} h={U * 3 * s.s} color={leaf} />, 0.2, U * 3.5);
        break;
      case "swamp":
        add(16, U * 16, (s) => <DeadTree look={look} h={U * 2.8 * s.s} />, 0.3, U * 3);
        add(40, U * 10, (s) => <Block look={look} color="#5a7a3a" size={[U * 0.04, U * 0.8 * s.s, U * 0.04]} at={[0, U * 0.4 * s.s, 0]} rot={[0.1 * s.s, 0, 0.15]} />, 0.6, U * 1.5);
        break;
      case "river":
      case "lake":
        add(kind === "river" ? 60 : 30, U * 28, (s, i) => (i % 2 ? <Pine look={look} h={U * 3 * s.s} color={leaf} /> : <Broadleaf look={look} h={U * 2.6 * s.s} color={leaf} r={s.s} />), 0.15, U * 5);
        add(14, U * 8, (s) => <Rock look={look} s={U * 0.3 * s.s} color="#7f7d74" />, 0.5, U * 1.6);
        break;
      case "road":
      case "airfield":
        if (kind === "road") {
          for (let i = -8; i <= 8; i++) out.push(<Block key={`p${i}`} look={look} color="#6a5a4a" size={[U * 0.1, U * 2.4, U * 0.1]} at={[i * U * 3, U * 1.2, -U * 3]} />);
        } else {
          // runway edge lights, and a low hangar well back from the runway
          for (let i = -12; i <= 12; i++) for (const z of [-1, 1]) out.push(<Block key={`l${i}${z}`} look={look} color={set.time === "night" ? "#ffd27a" : "#e8e2c8"} glow={set.time === "night"} size={[U * 0.12, U * 0.08, U * 0.12]} at={[i * U * 4, U * 0.04, z * U * 2.8]} />);
          out.push(<Block key="hangar" look={look} color="#9aa3ad" size={[U * 5, U * 1.6, U * 3.4]} at={[-U * 9, U * 0.8, -U * 15]} />);
          out.push(<Block key="hangar-roof" look={look} color="#7d8691" size={[U * 5.2, U * 0.25, U * 3.6]} at={[-U * 9, U * 1.7, -U * 15]} />);
        }
        add(14, U * 20, (s) => <Broadleaf look={look} h={U * 2.4 * s.s} color={leaf} r={s.s} />, 0.1, U * 6);
        break;
      case "town":
      case "city": {
        const tall = kind === "city";
        const cols = ["#c98e6b", "#e1d3b8", "#9fa7b5", "#b9705a", "#d8c08f", "#8e9bb0"];
        const lit = set.time === "night" || set.time === "dusk" ? 0.55 : 0.2;
        for (let i = -6; i <= 6; i++) {
          const h = U * (tall ? 6 + rr() * 10 : 2 + rr() * 1.6);
          const w = U * (2.6 + rr() * 1.2);
          out.push(<group key={`b${i}`} position={[i * U * 3.6, 0, -U * 5.5 - rr() * U]}><Building w={w} h={h} d={U * 3} color={cols[(i + 12) % cols.length]} seed={seed + i} lit={lit} roof={!tall && rr() > 0.4} /></group>);
        }
        for (let i = -3; i <= 3; i++) out.push(<Block key={`lamp${i}`} look={look} color="#3a3d44" size={[U * 0.07, U * 1.8, U * 0.07]} at={[i * U * 5, U * 0.9, -U * 2.6]} />,
          <Block key={`lt${i}`} look={look} color="#ffe2a0" glow={set.time !== "day"} size={[U * 0.25, U * 0.12, U * 0.25]} at={[i * U * 5, U * 1.82, -U * 2.6]} />);
        break;
      }
      case "room":
      case "hall":
      case "lab":
      case "hospital": {
        const W = U * (kind === "hall" ? 9 : 4.2);
        const H = U * (kind === "hall" ? 5 : 2.2);
        const wall = kind === "lab" || kind === "hospital" ? "#e3e8ea" : mix(set.sky, "#e8dccb", 0.5);
        out.push(<Block key="back" look={look} color={wall} size={[W * 2, H, U * 0.2]} at={[0, H / 2, -W * 0.75]} />);
        out.push(<Block key="l" look={look} color={tone(wall, 0.92)} size={[U * 0.2, H, W * 1.6]} at={[-W, H / 2, 0]} />);
        out.push(<Block key="r" look={look} color={tone(wall, 0.92)} size={[U * 0.2, H, W * 1.6]} at={[W, H / 2, 0]} />);
        out.push(<Block key="win" look={look} color={set.time === "night" ? "#1a2a4a" : mix(set.sky, "#ffffff", 0.3)} glow size={[W * 0.5, H * 0.4, U * 0.05]} at={[W * 0.35, H * 0.58, -W * 0.74]} />);
        if (kind === "hall") for (let i = -3; i <= 3; i++) out.push(<Block key={`c${i}`} look={look} shape="cylinder" color="#d8d0c0" size={[U * 0.5, H, U * 0.5]} at={[i * U * 2.4, H / 2, -W * 0.5]} />);
        if (kind === "room") {
          out.push(<group key="table" position={[-W * 0.45, 0, -W * 0.35]}><Block look={look} color="#8a5a3a" size={[U * 1.4, U * 0.08, U * 0.8]} at={[0, U * 0.75, 0]} /><Block look={look} color="#6a4a30" size={[U * 0.1, U * 0.75, U * 0.1]} at={[0, U * 0.37, 0]} /></group>);
          out.push(<group key="shelf" position={[W * 0.7, 0, -W * 0.66]}><Block look={look} color="#7a5a3a" size={[U * 1.2, U * 1.8, U * 0.4]} at={[0, U * 0.9, 0]} /></group>);
        }
        if (kind === "lab")
          for (let i = -1; i <= 1; i++) {
            out.push(<Block key={`bench${i}`} look={look} color="#cfd6da" size={[U * 2.2, U * 0.9, U * 0.8]} at={[i * U * 2.8, U * 0.45, -W * 0.5]} />);
            for (let j = 0; j < 3; j++) out.push(<Block key={`gl${i}${j}`} look={look} shape="cylinder" color={set.accent} glow size={[U * 0.15, U * 0.35, U * 0.15]} at={[i * U * 2.8 + (j - 1) * U * 0.5, U * 1.08, -W * 0.5]} />);
            out.push(<Block key={`scr${i}`} look={look} color={set.accent} glow size={[U * 0.8, U * 0.5, U * 0.04]} at={[i * U * 2.8, U * 1.6, -W * 0.7]} />);
          }
        if (kind === "hospital") {
          out.push(<group key="bed" position={[W * 0.45, 0, -W * 0.3]}><Block look={look} color="#f2f4f4" size={[U * 2, U * 0.25, U * 0.9]} at={[0, U * 0.6, 0]} /><Block look={look} color="#9aa3ad" size={[U * 2, U * 0.5, U * 0.9]} at={[0, U * 0.25, 0]} /></group>);
          out.push(<Block key="mon" look={look} color="#40ff9a" glow size={[U * 0.5, U * 0.35, U * 0.04]} at={[W * 0.9, U * 1.5, -W * 0.45]} />);
          out.push(<Block key="lamp" look={look} shape="cylinder" color="#fffbe8" glow size={[U * 1.0, U * 0.1, U * 1.0]} at={[0, H * 0.95, -W * 0.1]} />);
        }
        break;
      }
      case "cave":
        add(26, U * 6, (s) => <Rock look={look} s={U * 2.4 * s.s} color="#4a4038" />, 0.15, U * 4.5);
        break;
      case "underwater":
        add(30, U * 12, (s, i) => (i % 3 ? <Block look={look} color="#3a8a5a" size={[U * 0.12, U * 2.2 * s.s, U * 0.05]} at={[0, U * 1.1 * s.s, 0]} rot={[0, 0, Math.sin(t + i) * 0.15]} /> : <Rock look={look} s={U * 0.8 * s.s} color={i % 2 ? "#d8705a" : "#8a7a9a"} />), 0.4, U * 2.5);
        break;
      default:
        break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, U, seed, look.name, set.time, leaf, dry]);

  const groundSize = U * 120;
  const bump = kind === "mountain" ? U * 2.2 : ["forest", "grassland", "snow", "desert"].includes(kind) ? U * 0.6 : kind === "underwater" ? U * 0.4 : 0;
  const floorColor = INSIDE.includes(kind) ? (kind === "cave" ? "#3a322a" : kind === "lab" || kind === "hospital" ? "#c8cdd0" : tone(set.ground, 1)) : ground;
  const gGeom = useMemo(() => groundGeometry(groundSize, bump, seed, U * 4, floorColor, U), [groundSize, bump, seed, U, floorColor]);
  const gMat = useMemo(() => (look.toon ? new THREE.MeshToonMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: !look.gloss })), [look]);
  const water = mix(set.sky, "#1d4a6a", 0.55);
  const pal: Palette = { top: light.top, horizon: light.horizon, ground: ground, ground2: ground, cloud: "#ffffff", light: 1 };

  const showGround = !VOID.includes(kind) && kind !== "sea";
  const backdrop = set.backdrop ?? (kind === "mountain" || kind === "snow" ? "mountains" : kind === "city" ? "city" : "hills");
  return (
    <group>
      {kind === "space" ? <color attach="background" args={["#03040c"]} /> : <Sky pal={pal} />}
      {kind === "space" ? <SpaceBits seed={seed} U={U} accent={set.accent} look={look} /> : null}
      {kind === "micro" ? <MicroBits seed={seed} U={U} set={set} t={t} look={look} /> : null}
      {kind === "sky" ? <SkyBits seed={seed} U={U} ground={set.ground} look={look} /> : null}
      {showGround ? (
        <mesh geometry={gGeom} receiveShadow material={gMat} />
      ) : null}
      {kind === "sea" ? <Water size={groundSize} color={water} t={t} amp={U * 0.06} /> : null}
      {band ? (
        <Water size={U * 30} shape={[U * (kind === "lake" ? 60 : 120), U * (band[0] - band[1])]} color={water} t={t} amp={U * (kind === "beach" ? 0.03 : 0.02)} at={[0, U * (kind === "beach" ? 0.09 : 0.07), U * (band[0] + band[1]) / 2]} />
      ) : null}
      {kind === "swamp" ? <Water size={U * 40} color={tone(water, 0.6)} t={t} amp={U * 0.005} at={[0, U * 0.03, -U * 6]} /> : null}
      {kind === "road" || kind === "airfield" || kind === "town" || kind === "city" ? (
        <group>
          <Block look={look} color={kind === "airfield" ? "#5a5e64" : "#3e4148"} size={[U * 120, U * 0.02, U * (kind === "airfield" ? 5 : 3.2)]} at={[0, U * 0.01, kind === "town" || kind === "city" ? U * 1.6 : 0]} />
          {Array.from({ length: 24 }, (_, i) => (
            <Block key={i} look={look} color="#e8e2c8" size={[U * 1.2, U * 0.025, U * 0.1]} at={[-U * 60 + i * U * 5, U * 0.02, kind === "town" || kind === "city" ? U * 1.6 : 0]} />
          ))}
        </group>
      ) : null}
      {!INSIDE.includes(kind) && kind !== "space" && kind !== "micro" && backdrop === "city" ? (
        <CitySkyline U={U} seed={seed} look={look} color={mix("#5a6577", light.horizon, 0.35)} lit={set.time === "night" || set.time === "dusk" || look.dark > 0.5} />
      ) : null}
      {!INSIDE.includes(kind) && !VOID.includes(kind) && (backdrop === "hills" || backdrop === "mountains") ? (
        <Skyline U={U} seed={seed} look={look} color={mix(kind === "snow" ? "#dfe8ee" : kind === "desert" ? "#c8a070" : tone(leaf, 0.8), light.horizon, 0.45)}
          height={backdrop === "mountains" ? 16 : kind === "sea" || kind === "beach" ? 3 : 7} />
      ) : null}
      {items}
      {set.dressing.map((d, i) => (
        <Dressed key={i} d={d} look={look} seed={seed + i * 101} clear={clear * 0.8} keep={dry} />
      ))}
    </group>
  );
};

const SpaceBits: React.FC<{ seed: number; U: number; accent: string; look: Look }> = ({ seed, U, accent, look }) => {
  const stars = useMemo(() => {
    const r = rng(seed);
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1), d = 400;
      p.set([Math.sin(b) * Math.cos(a) * d, Math.cos(b) * d, Math.sin(b) * Math.sin(a) * d], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [seed]);
  return (
    <group>
      <points geometry={stars}>
        <pointsMaterial color="#ffffff" size={1.6} sizeAttenuation={false} />
      </points>
      <Block look={look} shape="sphere" color={mix(accent, "#3a6ac2", 0.5)} size={[U * 40, U * 40, U * 40]} at={[-U * 25, -U * 28, -U * 40]} />
    </group>
  );
};

const MicroBits: React.FC<{ seed: number; U: number; set: SetSpec; t: number; look: Look }> = ({ seed, U, set, t, look }) => {
  const bits = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: 40 }, () => ({ x: (r() - 0.5) * U * 16, y: r() * U * 6 - U, z: -r() * U * 14 + U * 2, s: 0.3 + r() * 0.6, a: r() * 6 }));
  }, [seed, U]);
  return (
    <group>
      {bits.map((b, i) => (
        <group key={i} position={[b.x + Math.sin(t * 0.4 + b.a) * U * 0.3, b.y + Math.cos(t * 0.3 + b.a) * U * 0.2, b.z]} rotation={[b.a + t * 0.2, b.a, 0]}>
          <Block look={look} shape="torus" color={i % 4 ? tone(set.ground, 1.6) : set.accent} size={[U * b.s, U * b.s, U * b.s * 0.45]} />
        </group>
      ))}
      <mesh>
        <sphereGeometry args={[U * 30, 24, 16]} />
        <meshStandardMaterial color={set.ground} side={THREE.BackSide} roughness={1} flatShading />
      </mesh>
    </group>
  );
};

const SkyBits: React.FC<{ seed: number; U: number; ground: string; look: Look }> = ({ seed, U, ground, look }) => {
  const clouds = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: 16 }, () => ({ x: (r() - 0.5) * U * 60, y: (r() - 0.6) * U * 8, z: -r() * U * 50 + U * 4, s: 1 + r() * 2 }));
  }, [seed, U]);
  return (
    <group>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          {[0, 1, 2].map((j) => (
            <Block key={j} look={look} shape="sphere" color="#f4f6f8" size={[U * c.s * 2, U * c.s, U * c.s * 1.4]} at={[(j - 1) * U * c.s * 0.9, j === 1 ? U * c.s * 0.3 : 0, 0]} />
          ))}
        </group>
      ))}
      <Block look={look} color={ground} size={[U * 600, U * 0.1, U * 600]} at={[0, -U * 40, 0]} />
    </group>
  );
};
