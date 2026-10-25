// The place generator: a set built from its kind (grammar.json "sets"), its time of day and colours, and
// the story's own set dressing (each a parts build from the design). Terrain, water, interiors, sky and
// ground cover are made here from seeded rules, so two forests in two stories are two different forests,
// and a story's pines, picnic tables or police cars stand among them.
import React, { useMemo } from "react";
import * as THREE from "three";
import { rng } from "../../world3d";
import { art, artRamp, artToon } from "./artstyle";
import { ReflectiveWater } from "./cinema";
import { rbcGeometry } from "./creatures";
import { Block, PartMesh, partsBounds } from "./parts";
import { Binned, type Bins, deal } from "./pieces";
import { Background, type Light, type Look, material } from "./style";
import { Layers, type ShotCam } from "./layers";
import type { Dressing, Recipe, SetSpec } from "./types";

type R = () => number;
const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

export const WATER = ["sea", "lake", "river", "beach", "swamp"];
export const INSIDE = ["room", "hall", "lab", "hospital", "cave", "factory", "shop", "station"];
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

function windowTexture(base: string, seed: number, lit: number, glowOnly = false) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = glowOnly ? "#000000" : base;
  g.fillRect(0, 0, 64, 128);
  if (!glowOnly) {
    // floor slabs and mullions so a facade has structure, not just a colour
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < 128; y += 14) g.fillRect(0, y + 12, 64, 2);
  }
  const r = rng(seed);
  for (let y = 4; y < 124; y += 14)
    for (let x = 4; x < 60; x += 14) {
      const on = r() < lit;
      const warm = r();
      g.fillStyle = on ? (warm > 0.3 ? "#ffd38a" : "#cfe4ff") : glowOnly ? "#000000" : "#26303d";
      g.fillRect(x, y, 9, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const texCache = new Map<string, THREE.Texture>();
const Building: React.FC<{ w: number; h: number; d: number; color: string; seed: number; lit: number; roof?: boolean; glow?: boolean; unit?: number; far?: boolean }> = ({ w, h, d, color, seed, lit, roof, glow, unit, far }) => {
  const unitHint = unit ?? 1;
  const mat = useMemo(() => {
    const get = (only: boolean) => {
      const key = `${color}|${seed % 7}|${lit}|${only}`;
      let t = texCache.get(key);
      if (!t) {
        t = windowTexture(color, seed % 7, lit, only);
        texCache.set(key, t);
      }
      const c = t.clone();
      c.repeat.set(Math.max(1, Math.round(w / (unitHint * 1.1))), Math.max(1, Math.round(h / (unitHint * 1.6))));
      c.needsUpdate = true;
      return c;
    };
    return new THREE.MeshLambertMaterial({ map: get(false), emissiveMap: glow ? get(true) : null, emissive: glow ? new THREE.Color("#ffffff") : new THREE.Color("#000000"), emissiveIntensity: glow ? 1.6 : 0 });
  }, [color, seed, lit, w, h, glow, unitHint]);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow={!far} receiveShadow={!far} material={mat}>
        <boxGeometry args={[w, h, d]} />
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

// Far ridgelines in two layers, so the ground meets the sky in a real horizon: a continuous ring of
// terrain whose height is layered noise round the circle, with rock showing on steep faces and snow on
// high peaks. Voxel looks keep stacked blocks.
const ridgeGeometry = (U: number, seed: number, height: number, radius: number, depth: number, base: string, snow: boolean) => {
  const seg = 220, rows = 10;
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const r = rng(seed);
  const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  const hAt = (a: number) => {
    let h = 0.55 + 0.45 * Math.sin(a * 3 + ph[0]);
    h += 0.5 * Math.abs(Math.sin(a * 7 + ph[1])) + 0.25 * Math.sin(a * 17 + ph[2]) + 0.12 * Math.sin(a * 41 + ph[3]) + 0.06 * Math.sin(a * 83 + ph[4]);
    return Math.max(0.05, h / 1.6);
  };
  const c0 = new THREE.Color(base), rock = new THREE.Color(base).lerp(new THREE.Color("#6d6a66"), 0.55), white = new THREE.Color("#eef2f6"), c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const peak = hAt(a) * height * U;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows; // 0 at the foot (near), 1 at the crest
      const d = radius * U + depth * U * (1 - v) * 0.5 - depth * U * v * 0.3;
      const y = peak * Math.sin((v * Math.PI) / 2) ** 1.4 - U * 0.5;
      pos.push(Math.cos(a) * d, y, Math.sin(a) * d);
      const steep = v > 0.45 ? (v - 0.45) / 0.55 : 0;
      c.copy(c0).lerp(rock, steep * 0.8);
      if (snow && y > height * U * 0.55) c.lerp(white, Math.min(1, (y - height * U * 0.55) / (height * U * 0.15)));
      c.multiplyScalar(0.92 + 0.12 * Math.sin(a * 29 + j));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rows; j++) {
      const q = i * (rows + 1) + j, n = q + rows + 1;
      idx.push(q, n, q + 1, n, n + 1, q + 1);
    }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

const Skyline: React.FC<{ U: number; seed: number; color: string; look: Look; height: number; far?: string; snow?: boolean }> = ({ U, seed, color, look, height, far, snow }) => {
  const near = useMemo(() => (look.blocky ? null : ridgeGeometry(U, seed ^ 0x4111, height * 0.6, 40, 10, color, Boolean(snow) && height > 10)), [U, seed, height, color, look.blocky, snow]);
  const back = useMemo(() => (look.blocky ? null : ridgeGeometry(U, seed ^ 0x9a3, height * 1.15, 60, 14, far ?? color, Boolean(snow) || height > 10)), [U, seed, height, color, far, look.blocky, snow]);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), []);
  const hills = useMemo(() => {
    const r = rng(seed ^ 0x4111);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + r() * 0.2;
      const d = U * (42 + r() * 14);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, w: U * (14 + r() * 14), h: U * height * (0.5 + r()) };
    });
  }, [U, seed, height]);
  if (look.blocky || !near || !back)
    return (
      <>
        {hills.map((h, i) => (
          <Block key={i} look={look} color={color} size={[h.w, h.h, h.w * 0.8]} at={[h.x, h.h / 2 - U * 0.4, h.z]} />
        ))}
      </>
    );
  return (
    <>
      <mesh geometry={back} material={mat} />
      <mesh geometry={near} material={mat} receiveShadow />
    </>
  );
};

// A city against the sky in three layers of depth: a near row of mid-rise blocks just beyond the set,
// a middle band of towers with setbacks and spires, and a far ring. Windows light after dark.
const CitySkyline: React.FC<{ U: number; seed: number; color: string; look: Look; lit: boolean; near: number }> = ({ U, seed, color, look, lit, near }) => {
  const towers = useMemo(() => {
    const r = rng(seed ^ 0x2c17);
    const out: { x: number; z: number; w: number; d: number; h: number; shade: number; top: number; layer: number }[] = [];
    const row = (n: number, z0: number, z1: number, h0: number, h1: number, spanX: number, layer: number) => {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * spanX + (r() - 0.5) * U * 2;
        const z = -(z0 + r() * (z1 - z0));
        out.push({ x, z, w: U * (2.4 + r() * 2.6), d: U * (2.4 + r() * 2.2), h: U * (h0 + r() ** 1.6 * (h1 - h0)), shade: 0.75 + r() * 0.45, top: r(), layer });
      }
    };
    row(16, near, near + U * 6, 3, 8, U * 70, 0);
    row(22, near + U * 9, near + U * 20, 6, 22, U * 110, 1);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r() * 0.05;
      const d = U * (62 + r() * 14);
      out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, w: U * (3 + r() * 4), d: U * (3 + r() * 3), h: U * (5 + r() ** 2 * 16), shade: 0.7 + r() * 0.3, top: r(), layer: 2 });
    }
    return out;
  }, [U, seed, near]);
  return (
    <>
      {towers.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.layer === 2 ? -Math.atan2(b.z, b.x) : (b.top - 0.5) * 0.3, 0]}>
          {look.blocky ? (
            <Block look={look} color={tone(color, b.shade)} size={[b.w, b.h, b.d]} at={[0, b.h / 2 - U * 0.3, 0]} />
          ) : (
            <>
              <Building w={b.w} h={b.h} d={b.d} color={tone(color, b.shade)} seed={seed + (i % 7)} lit={lit ? 0.5 : 0.08} glow={lit} unit={U} far={b.layer > 0} />
              {b.layer < 2 && b.h > U * 9 ? (
                // a setback crown, and on some a spire
                <group position={[0, b.h, 0]}>
                  <Building w={b.w * 0.66} h={b.h * 0.14} d={b.d * 0.66} color={tone(color, b.shade * 0.95)} seed={seed + i} lit={lit ? 0.5 : 0.08} glow={lit} unit={U} far={b.layer > 0} />
                  {b.top > 0.6 ? (
                    <mesh position={[0, b.h * 0.14 + b.h * 0.08, 0]} material={material(look, "#c7ccd4")}>
                      <cylinderGeometry args={[U * 0.04, U * 0.12, b.h * 0.16, 8]} />
                    </mesh>
                  ) : null}
                  {lit && b.top > 0.6 ? (
                    <mesh position={[0, b.h * 0.14 + b.h * 0.17, 0]} scale={U * 0.12} material={material(look, "#ff4a3a", { glow: true })}>
                      <sphereGeometry args={[1, 8, 6]} />
                    </mesh>
                  ) : null}
                </group>
              ) : null}
            </>
          )}
        </group>
      ))}
    </>
  );
};

// A city river's near bank: a stone quay wall, a paved promenade, a railing and lamps along it.
const Quay: React.FC<{ U: number; z: number; look: Look; night: boolean; keep?: KeepOut }> = ({ U, z, look, night, keep }) => (
  <group>
    <Block look={look} color="#6f6a63" size={[U * 240, U * 0.24, U * 0.3]} at={[0, -U * 0.09, z + U * 0.15]} />
    <Block look={look} color="#8d877d" size={[U * 240, U * 0.01, U * 1.6]} at={[0, U * 0.025, z + U * 1.1]} />
    {Array.from({ length: 41 }, (_, i) => (i - 20) * U * 1.6).filter((x) => !(keep && keep(x, z + U * 0.35, U * 0.6, U * 0.6))).map((x) => (
      <Block key={x} look={look} color="#2a2d33" size={[U * 0.04, U * 0.4, U * 0.04]} at={[x, U * 0.3, z + U * 0.35]} />
    ))}
    {Array.from({ length: 9 }, (_, i) => (i - 4) * U * 7).filter((x) => !(keep && keep(x, z + U * 0.9, U * 0.3, U * 2))).map((x) => (
      <group key={`l${x}`} position={[x, 0, z + U * 0.9]}>
        <Block look={look} shape="cylinder" color="#23262b" size={[U * 0.07, U * 1.9, U * 0.07]} at={[0, U * 1.1, 0]} />
        <Block look={look} shape="sphere" color="#ffe3a8" glow={night} size={[U * 0.22, U * 0.22, U * 0.22]} at={[0, U * 2.1, 0]} />
      </group>
    ))}
  </group>
);

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

export const Environment: React.FC<{ set: SetSpec; look: Look; light: Light; unit: number; seed: number; t: number; keep?: KeepOut; fx?: string; recipe?: Recipe; cam?: ShotCam; shot?: number }> = ({ set, look, light, unit: U, seed, t, keep, fx = "", recipe, cam, shot = 0 }) => {
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
  // the pack pieces this place has by role (none in the voxel look, whose world is all boxes)
  const P: Record<string, string[]> = look.blocky ? {} : set.pieces ?? {};
  const [items, bins] = useMemo(() => {
    const rr = rng(seed ^ 0x77);
    const out: React.ReactNode[] = [];
    const bins: Bins = new Map();
    const add = (n: number, spread: number, make: (s: { x: number; z: number; s: number; a: number }, i: number) => React.ReactNode, front = 0.3, near = clear) =>
      scatter(rr, n, near, spread, front, dry, U * 1.2, U * 3).forEach((s, i) => out.push(<group key={`${out.length}`} position={[s.x, 0, s.z]} rotation={[0, s.a, 0]}>{make(s, i)}</group>));
    // a role's pieces scattered at a height, else the drawn stand-in
    // (only the trees near the action cast shadows: on a CPU the shadow pass of a whole forest costs as
    // much as drawing it)
    const put = (role: string, n: number, spread: number, h: number, make: Parameters<typeof add>[2], front = 0.3, near = clear) => {
      if (!P[role]?.length) return add(n, spread, make, front, near);
      const spots = scatter(rr, n, near, spread, front, dry, U * 1.2, U * 3).map((s) => ({ x: s.x, z: s.z, a: s.a, s: h * s.s }));
      const close = (s: { x: number; z: number }) => role === "tree" && Math.hypot(s.x, s.z) < U * 12;
      deal(bins, P[role], spots.filter(close), rr, role === "tree" ? "h" : "m", true);
      deal(bins, P[role], spots.filter((s) => !close(s)), rr, role === "tree" ? "h" : "m", false);
    };
    // the ground cover a camera sees from close (grass, flowers), and the land beyond the set that an
    // aerial shot looks down on: more of the place's own trees, out to the fog
    const cover = (n: number) => P.grass?.length && deal(bins, P.grass, scatter(rr, n, U * 1.6, U * 16, 0.6, dry).map((s) => ({ x: s.x, z: s.z, a: s.a, s: U * 0.4 * s.s })), rr, "m", false);
    // (far off, the lightest of the place's trees will do: pines where it has them)
    const far = P.tree?.filter((x) => x.includes("pine")).length ? P.tree.filter((x) => x.includes("pine")).slice(0, 2) : P.tree?.slice(0, 2);
    const beyond = (n: number) => far?.length && deal(bins, far, scatter(rr, n, U * 30, U * 60, 0.9, dry).map((s) => ({ x: s.x, z: s.z, a: s.a, s: U * 3.8 * s.s })), rr, "h", false);
    // a road or a railway in tiles along x at depth z, each tile `w` across (a road tile runs along x as
    // it comes, a rail tile along z)
    const lay = (role: string, z: number, w: number) => {
      if (!P[role]?.length) return;
      deal(bins, [P[role][0]], Array.from({ length: Math.ceil((U * 120) / w) }, (_, i) => ({ x: -U * 60 + (i + 0.5) * w, z, a: role === "rail" ? Math.PI / 2 : 0, s: w })), rr, "w", false);
    };
    switch (kind) {
      case "forest":
        put("tree", 80, U * 26, U * 3.8, (s, i) => (i % 3 ? <Pine look={look} h={U * 3.4 * s.s} color={leaf} /> : <Broadleaf look={look} h={U * 3 * s.s} color={mix(leaf, "#b5872a", set.time === "dusk" ? 0.25 : 0.1)} r={s.s} />));
        put("bush", 30, U * 10, U * 0.8, (s) => <Bush look={look} s={U * 0.45 * s.s} color={tone(leaf, 1.1)} />, 0.5, U * 2.2);
        put("rock", 10, U * 9, U * 0.5, (s) => <Rock look={look} s={U * 0.35 * s.s} color="#7a7a72" />, 0.5, U * 2);
        cover(170);
        beyond(110);
        break;
      case "grassland":
      case "farm":
        put("tree", 9, U * 24, U * 3.4, (s) => <Broadleaf look={look} h={U * 2.6 * s.s} color={leaf} r={s.s} />, 0.2, U * 6);
        put("bush", 18, U * 12, U * 0.7, (s) => <Bush look={look} s={U * 0.4 * s.s} color={tone(leaf, 1.15)} />, 0.4, U * 2.5);
        put("rock", 8, U * 12, U * 0.45, (s) => <Rock look={look} s={U * 0.3 * s.s} color="#8a867a" />, 0.4, U * 2.5);
        cover(200);
        beyond(40);
        if (P.prop?.length) deal(bins, P.prop, scatter(rr, 6, U * 5, U * 8, 0.2, dry, U, U).map((s) => ({ x: s.x, z: s.z, a: s.a, s: U * 0.9 })), rr);
        if (kind === "farm") {
          for (let i = 0; i < 14; i++) out.push(<Block key={`f${i}`} look={look} color="#7a5a3a" size={[U * 0.08, U * 0.6, U * 0.08]} at={[-U * 9 + i * U * 1.4, U * 0.3, -U * 3.5]} />);
          out.push(<Block key="rail" look={look} color="#8a6a4a" size={[U * 18.5, U * 0.06, U * 0.05]} at={[0, U * 0.45, -U * 3.5]} />);
          out.push(<group key="barn" position={[-U * 7, 0, -U * 9]}><Building w={U * 4} h={U * 2.6} d={U * 3} color="#a33a2a" seed={seed} lit={0} roof unit={U} /></group>);
        }
        break;
      case "mountain":
        put("tree", 30, U * 20, U * 3.6, (s) => <Pine look={look} h={U * 3 * s.s} color={leaf} />, 0.25, U * 4);
        put("rock", 16, U * 12, U * 1.1, (s) => <Rock look={look} s={U * 0.7 * s.s} color="#7f8078" />, 0.4, U * 2.5);
        cover(100);
        beyond(80);
        break;
      case "snow":
        put("tree", 30, U * 20, U * 3.4, (s) => <Pine look={look} h={U * 3 * s.s} color="#3c5e4a" snow />, 0.25, U * 4);
        put("rock", 8, U * 10, U * 0.6, (s) => <Rock look={look} s={U * 0.4 * s.s} color="#c9d4dc" />, 0.4, U * 2.5);
        cover(30);
        beyond(120);
        break;
      case "desert":
        add(10, U * 18, (s) => <Cactus look={look} h={U * 1.4 * s.s} />, 0.3, U * 3);
        put("rock", 18, U * 16, U * 0.9, (s) => <Rock look={look} s={U * 0.6 * s.s} color="#b07a4a" />, 0.4, U * 2.5);
        put("tree", 4, U * 16, U * 2.4, () => null, 0.3, U * 5);
        break;
      case "beach":
        put("tree", 10, U * 10, U * 3.4, (s) => <Palm look={look} h={U * 3 * s.s} color={leaf} />, 0.2, U * 3.5);
        put("rock", 8, U * 9, U * 0.6, () => null, 0.4, U * 2.5);
        cover(40);
        // a jetty out into the water and a rowing boat drawn up on the sand, off to one side
        if (P.prop?.length && band) {
          const dock = P.prop.find((x) => x.includes("dock")), boat = P.prop.find((x) => x.includes("boat"));
          const side = rr() > 0.5 ? 1 : -1;
          if (dock) deal(bins, [dock], [0, 1, 2, 3].map((i) => ({ x: side * U * 7, z: (band[0] - 0.4 - i * 1.6) * U, a: 0, s: U * 1.7 })), rr, "w");
          if (boat) deal(bins, [boat], [{ x: -side * U * 6, z: (band[0] + 0.6) * U, a: 0.6, s: U * 1.8 }], rr, "w");
        }
        break;
      case "marsh":
        // open salt marsh: flat to the horizon, a few low bushes and stones; its reeds, grass, pools and
        // creeks are the place's layers (layers.tsx)
        put("bush", 10, U * 14, U * 0.6, (s) => <Bush look={look} s={U * 0.35 * s.s} color={tone(leaf, 0.9)} />, 0.4, U * 3);
        put("rock", 6, U * 12, U * 0.35, (s) => <Rock look={look} s={U * 0.25 * s.s} color="#77756a" />, 0.4, U * 3);
        cover(90);
        break;
      case "swamp":
        put("tree", 18, U * 16, U * 3.2, (s) => <DeadTree look={look} h={U * 2.8 * s.s} />, 0.3, U * 3);
        if (P.grass?.length) cover(200);
        else add(40, U * 10, (s) => <Block look={look} color="#5a7a3a" size={[U * 0.04, U * 0.8 * s.s, U * 0.04]} at={[0, U * 0.4 * s.s, 0]} rot={[0.1 * s.s, 0, 0.15]} />, 0.6, U * 1.5);
        put("bush", 12, U * 8, U * 0.7, () => null, 0.5, U * 2);
        break;
      case "river":
      case "lake":
        put("tree", kind === "river" ? 60 : 34, U * 28, U * 3.6, (s, i) => (i % 2 ? <Pine look={look} h={U * 3 * s.s} color={leaf} /> : <Broadleaf look={look} h={U * 2.6 * s.s} color={leaf} r={s.s} />), 0.15, U * 5);
        put("rock", 14, U * 8, U * 0.45, (s) => <Rock look={look} s={U * 0.3 * s.s} color="#7f7d74" />, 0.5, U * 1.6);
        put("bush", 14, U * 8, U * 0.7, () => null, 0.5, U * 2);
        cover(130);
        beyond(90);
        break;
      case "road":
      case "railway":
      case "airfield":
        // the road or the line laid in tiles across the set, under the action, with poles along the far side
        lay("street", 0, U * 3.2);
        lay("rail", 0, U * 2.4);
        if (kind !== "airfield" && P.prop?.length) {
          const pole = P.prop.find((x) => x.includes("pole")) ?? P.prop[0];
          deal(bins, [pole], Array.from({ length: 17 }, (_, i) => ({ x: (i - 8) * U * 6, z: -U * 2.6, a: Math.PI, s: U * 3 })).filter((s) => !(keep && keep(s.x, s.z, U * 0.3, U * 3))), rr);
          const signs = P.prop.filter((x) => x !== pole);
          if (signs.length) deal(bins, signs, [{ x: U * 9, z: U * 2.2, a: 0, s: U * 1.6 }, { x: -U * 14, z: -U * 2.4, a: Math.PI, s: U * 1.8 }].filter((s) => !(keep && keep(s.x, s.z, U * 0.5, U * 2))), rr);
        } else if (kind !== "airfield") {
          for (let i = -8; i <= 8; i++) out.push(<Block key={`p${i}`} look={look} color="#6a5a4a" size={[U * 0.1, U * 2.4, U * 0.1]} at={[i * U * 3, U * 1.2, -U * 3]} />);
        } else {
          // runway edge lights, and a low hangar well back from the runway
          for (let i = -12; i <= 12; i++) for (const z of [-1, 1]) out.push(<Block key={`l${i}${z}`} look={look} color={set.time === "night" ? "#ffd27a" : "#e8e2c8"} glow={set.time === "night"} size={[U * 0.12, U * 0.08, U * 0.12]} at={[i * U * 4, U * 0.04, z * U * 2.8]} />);
          out.push(<Block key="hangar" look={look} color="#9aa3ad" size={[U * 5, U * 1.6, U * 3.4]} at={[-U * 9, U * 0.8, -U * 15]} />);
          out.push(<Block key="hangar-roof" look={look} color="#7d8691" size={[U * 5.2, U * 0.25, U * 3.6]} at={[-U * 9, U * 1.7, -U * 15]} />);
        }
        put("tree", 14, U * 20, U * 3.2, (s) => <Broadleaf look={look} h={U * 2.4 * s.s} color={leaf} r={s.s} />, 0.1, U * 6);
        cover(140);
        beyond(80);
        break;
      case "town":
      case "village":
      case "castle":
      case "city": {
        // (a village's cottages and a castle's walls and towers line the street as a town's houses do)
        const tall = kind === "city";
        const cols = ["#c98e6b", "#e1d3b8", "#9fa7b5", "#b9705a", "#d8c08f", "#8e9bb0"];
        const lit = set.time === "night" || set.time === "dusk" ? 0.55 : 0.2;
        // blocks of buildings in rows going back, and down both sides, so the street is a canyon
        const rows: [number, number, number][] = tall ? [[-5.5, 6, 1], [-12, 9, 1.5], [-19, 12, 2]] : [[-5.5, 2, 1], [-11, 2.6, 1.2]];
        // the pack's own houses and towers, facing the street, when the place has them
        const own = (ri: number) => (tall && ri > 0 && P.tall?.length ? P.tall : P.building);
        rows.forEach(([z, hBase, hk], ri) => {
          for (let i = -7; i <= 7; i++) {
            const h = U * (hBase + rr() * (tall ? 10 : 1.8) * hk);
            const w = U * (2.6 + rr() * 1.2);
            if (keep && keep(i * U * 3.6, z * U - U * 1.5, w / 2, h)) continue;
            const x = i * U * 3.6 + (ri % 2) * U * 1.8, bz = z * U - rr() * U;
            if (own(ri)?.length) deal(bins, own(ri)!, [{ x, z: bz, a: 0, s: w * (tall ? 1 : 0.9) }], rr, "w");
            else out.push(<group key={`b${ri}${i}`} position={[x, 0, bz]}><Building w={w} h={h} d={U * 3} color={cols[(i + ri * 3 + 12) % cols.length]} seed={seed + i + ri * 17} lit={lit} roof={!tall && rr() > 0.4} unit={U} glow={lit > 0.3} /></group>);
          }
        });
        for (const sx of [-1, 1])
          for (let j = 0; j < 5; j++) {
            const h = U * (tall ? 5 + rr() * 9 : 2 + rr() * 1.4);
            const x = sx * U * (9 + rr() * 2), z = -U * 2 + j * U * 4;
            if (keep && keep(x, z, U * 1.5, h)) continue;
            if (P.building?.length) deal(bins, P.building, [{ x, z, a: -sx * Math.PI / 2, s: U * 3.2 }], rr, "w");
            else out.push(<group key={`s${sx}${j}`} position={[x, 0, z]}><Building w={U * 3} h={h} d={U * 3.4} color={cols[(j * 2 + (sx > 0 ? 1 : 0)) % cols.length]} seed={seed + j * 5 + sx} lit={lit} roof={!tall && rr() > 0.5} unit={U} glow={lit > 0.3} /></group>);
          }
        lay("street", U * 1.6, U * 3.2);
        if (P.tree?.length) deal(bins, P.tree, [-3, -1, 1, 3].map((i) => ({ x: i * U * 4.5 + U * 1.2, z: -U * 2.9, a: rr() * 6, s: U * 2.4 })).filter((s) => !(keep && keep(s.x, s.z, U * 0.6, U * 2.4))), rr);
        const lamp = P.prop?.find((x) => x.includes("light-")) ?? P.prop?.find((x) => x.includes("light"));
        if (lamp) deal(bins, [lamp], [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ x: i * U * 5, z: -U * 2.6, a: Math.PI, s: U * 2.2 })).filter((s) => !(keep && keep(s.x, s.z, U * 0.3, U * 2.2))), rr);
        else if (kind === "town" || kind === "city")
          for (let i = -3; i <= 3; i++) out.push(<Block key={`lamp${i}`} look={look} color="#3a3d44" size={[U * 0.07, U * 1.8, U * 0.07]} at={[i * U * 5, U * 0.9, -U * 2.6]} />,
            <Block key={`lt${i}`} look={look} color="#ffe2a0" glow={set.time !== "day"} size={[U * 0.25, U * 0.12, U * 0.25]} at={[i * U * 5, U * 1.82, -U * 2.6]} />);
        const extra = P.prop?.filter((x) => x !== lamp) ?? [];
        if (extra.length) deal(bins, extra, [{ x: U * 7.5, z: -U * 2.5, a: Math.PI, s: U * 1.2 }, { x: -U * 11, z: U * 4.6, a: 0, s: U * 1.1 }].filter((s) => !(keep && keep(s.x, s.z, U * 0.5, U * 2))), rr, "m");
        break;
      }
      case "room":
      case "shop":
      case "station":
      case "hall":
      case "lab":
      case "hospital":
      case "factory": {
        const big = kind === "hall" || kind === "factory" || kind === "station";
        const W = U * (big ? 9 : 4.2);
        const H = U * (big ? 5 : 2.2);
        const wall = kind === "lab" || kind === "hospital" || kind === "shop" ? "#e3e8ea" : kind === "factory" || kind === "station" ? "#8e9296" : mix(set.sky, "#e8dccb", 0.5);
        // the place's own furniture or machines along the back and sides, clear of the action
        if (P.prop?.length) {
          const n = big ? 9 : 5;
          deal(bins, P.prop, Array.from({ length: n }, (_, i) => {
            const f = (i + 0.5) / n;
            const x = (f * 2 - 1) * W * 0.8, z = -W * (0.45 + 0.15 * Math.abs(f * 2 - 1)) + (i % 2) * U * 0.6;
            return { x, z, a: (rr() - 0.5) * 0.4, s: U * (big ? 2.4 : 1.1) * (0.85 + rr() * 0.3) };
          }).filter((s) => !(keep && keep(s.x, s.z, U * 0.8, U * 2))), rr, "w");
        }
        out.push(<Block key="back" look={look} color={wall} size={[W * 2, H, U * 0.2]} at={[0, H / 2, -W * 0.75]} />);
        out.push(<Block key="l" look={look} color={tone(wall, 0.92)} size={[U * 0.2, H, W * 1.6]} at={[-W, H / 2, 0]} />);
        out.push(<Block key="r" look={look} color={tone(wall, 0.92)} size={[U * 0.2, H, W * 1.6]} at={[W, H / 2, 0]} />);
        out.push(<Block key="win" look={look} color={set.time === "night" ? "#1a2a4a" : mix(set.sky, "#ffffff", 0.3)} glow size={[W * 0.5, H * 0.4, U * 0.05]} at={[W * 0.35, H * 0.58, -W * 0.74]} />);
        if (kind === "hall") for (let i = -3; i <= 3; i++) out.push(<Block key={`c${i}`} look={look} shape="cylinder" color="#d8d0c0" size={[U * 0.5, H, U * 0.5]} at={[i * U * 2.4, H / 2, -W * 0.5]} />);
        if (kind === "factory")
          for (let i = -2; i <= 2; i++) out.push(<Block key={`fl${i}`} look={look} color="#fff2c8" glow size={[U * 2.4, U * 0.08, U * 0.3]} at={[i * U * 3.4, H * 0.97, -W * 0.2]} />);
        if (kind === "room" && !P.prop?.length) {
          out.push(<group key="table" position={[-W * 0.45, 0, -W * 0.35]}><Block look={look} color="#8a5a3a" size={[U * 1.4, U * 0.08, U * 0.8]} at={[0, U * 0.75, 0]} /><Block look={look} color="#6a4a30" size={[U * 0.1, U * 0.75, U * 0.1]} at={[0, U * 0.37, 0]} /></group>);
          out.push(<group key="shelf" position={[W * 0.7, 0, -W * 0.66]}><Block look={look} color="#7a5a3a" size={[U * 1.2, U * 1.8, U * 0.4]} at={[0, U * 0.9, 0]} /></group>);
        }
        if (kind === "lab" && !P.prop?.length)
          for (let i = -1; i <= 1; i++) {
            out.push(<Block key={`bench${i}`} look={look} color="#cfd6da" size={[U * 2.2, U * 0.9, U * 0.8]} at={[i * U * 2.8, U * 0.45, -W * 0.5]} />);
            for (let j = 0; j < 3; j++) out.push(<Block key={`gl${i}${j}`} look={look} shape="cylinder" color={set.accent} glow size={[U * 0.15, U * 0.35, U * 0.15]} at={[i * U * 2.8 + (j - 1) * U * 0.5, U * 1.08, -W * 0.5]} />);
            out.push(<Block key={`scr${i}`} look={look} color={set.accent} glow size={[U * 0.8, U * 0.5, U * 0.04]} at={[i * U * 2.8, U * 1.6, -W * 0.7]} />);
          }
        if (kind === "hospital" && !P.prop?.length) {
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
    return [out, bins] as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, U, seed, look.name, set.time, leaf, dry, JSON.stringify(P)]);

  const groundSize = U * 120;
  const bump = kind === "mountain" ? U * 2.2 : ["forest", "grassland", "snow", "desert"].includes(kind) ? U * 0.6 : kind === "underwater" ? U * 0.4 : kind === "marsh" ? U * 0.15 : 0;
  const floorColor = INSIDE.includes(kind) ? (kind === "cave" ? "#3a322a" : kind === "lab" || kind === "hospital" ? "#c8cdd0" : tone(set.ground, 1)) : ground;
  const gGeom = useMemo(() => groundGeometry(groundSize, bump, seed, U * 4, floorColor, U), [groundSize, bump, seed, U, floorColor]);
  const gMat = useMemo(() => (artToon() ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: artRamp() }) : look.toon ? new THREE.MeshToonMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: look.blocky })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [look, art.profile.name]);
  const water = mix(set.sky, "#1d4a6a", 0.55);
  const mirror = !look.toon && !look.blocky && !fx.includes("water");
  const sunDir = new THREE.Vector3(...light.sunDir);

  const showGround = !VOID.includes(kind) && kind !== "sea";
  const backdrop = set.backdrop ?? (kind === "mountain" || kind === "snow" ? "mountains" : kind === "city" ? "city" : "hills");
  return (
    <Background.Provider value>
    <group>
      {kind === "space" ? <SpaceBits seed={seed} U={U} accent={set.accent} look={look} /> : null}
      {kind === "micro" ? <MicroBits seed={seed} U={U} set={set} t={t} look={look} /> : null}
      {kind === "sky" ? <SkyBits seed={seed} U={U} ground={set.ground} look={look} light={light} t={t} /> : null}
      {showGround ? (
        <mesh geometry={gGeom} receiveShadow material={gMat} />
      ) : null}
      {kind === "sea" ? (mirror ? <ReflectiveWater w={groundSize * 4} d={groundSize * 4} at={[0, 0, 0]} color={tone(water, 0.55)} sun={light.sun} sunDir={sunDir} t={t} fog /> : <Water size={groundSize} color={water} t={t} amp={U * 0.06} />) : null}
      {band ? (
        mirror ? (
          <ReflectiveWater w={U * (kind === "lake" ? 60 : 240)} d={U * (band[0] - band[1])} at={[0, U * (kind === "beach" ? 0.09 : 0.07), U * (band[0] + band[1]) / 2]} color={tone(water, 0.55)} sun={light.sun} sunDir={sunDir} t={t} distortion={1.6} fog />
        ) : (
          <Water size={U * 30} shape={[U * (kind === "lake" ? 60 : 120), U * (band[0] - band[1])]} color={water} t={t} amp={U * (kind === "beach" ? 0.03 : 0.02)} at={[0, U * (kind === "beach" ? 0.09 : 0.07), U * (band[0] + band[1]) / 2]} />
        )
      ) : null}
      {band && backdrop === "city" ? <Quay U={U} z={band[0] * U} look={look} night={set.time === "night" || set.time === "dusk"} keep={keep} /> : null}
      {kind === "swamp" ? <Water size={U * 40} color={tone(water, 0.6)} t={t} amp={U * 0.005} at={[0, U * 0.03, -U * 6]} /> : null}
      {(kind === "road" || kind === "airfield" || kind === "town" || kind === "city") && !P.street?.length ? (
        <group>
          <Block look={look} color={kind === "airfield" ? "#5a5e64" : "#3e4148"} size={[U * 120, U * 0.02, U * (kind === "airfield" ? 5 : 3.2)]} at={[0, U * 0.01, kind === "town" || kind === "city" ? U * 1.6 : 0]} />
          {Array.from({ length: 24 }, (_, i) => (
            <Block key={i} look={look} color="#e8e2c8" size={[U * 1.2, U * 0.025, U * 0.1]} at={[-U * 60 + i * U * 5, U * 0.02, kind === "town" || kind === "city" ? U * 1.6 : 0]} />
          ))}
        </group>
      ) : null}
      {!INSIDE.includes(kind) && kind !== "space" && kind !== "micro" && backdrop === "city" && !fx.includes("city") ? (
        <group position={[0, kind === "sky" ? -U * 36 : 0, 0]}>
          <CitySkyline U={U} seed={seed} look={look} color={mix("#6a7587", light.horizon, 0.25)} lit={set.time === "night" || set.time === "dusk"} near={band ? -band[1] * U + U * 1.5 : U * 16} />
        </group>
      ) : null}
      {!INSIDE.includes(kind) && !VOID.includes(kind) && (backdrop === "hills" || backdrop === "mountains") ? (
        <Skyline U={U} seed={seed} look={look} color={mix(kind === "snow" ? "#dfe8ee" : kind === "desert" ? "#c8a070" : tone(leaf, 0.8), light.horizon, 0.3)}
          far={mix(kind === "desert" ? "#b89070" : "#6f7f8a", light.horizon, 0.55)} snow={kind === "snow" || backdrop === "mountains"}
          height={backdrop === "mountains" ? 16 : kind === "sea" || kind === "beach" ? 3 : kind === "marsh" ? 2.5 : 8} />
      ) : null}
      {!INSIDE.includes(kind) && !VOID.includes(kind) && kind !== "underwater" && set.time !== "night" ? <Birds U={U} seed={seed} t={t} color={tone(light.horizon, 0.35)} /> : null}
      {fx.includes("items") ? null : items}
      {fx.includes("items") ? null : <Binned bins={bins} look={look} />}
      {recipe && cam && !fx.includes("layers") ? <Layers recipe={recipe} kind={kind} light={light} U={U} seed={seed} t={t} keep={dry} cam={cam} shot={shot} /> : null}
      {set.dressing.filter((d) => !(recipe && LAYERED.test(d.name))).map((d, i) => (
        <Dressed key={i} d={d} look={look} seed={seed + i * 101} clear={clear * 0.8} keep={dry} />
      ))}
    </group>
    </Background.Provider>
  );
};

// set dressing the place's layers draw better (a reed bed of a thousand swaying blades, not a few rods)
const LAYERED = /reed|rush|sedge|grass|weed|fern/i;

// Life in the sky over an outdoor place: a loose flock crossing far off, wings beating, so the place
// itself moves while the story happens in front of it (seeded, so the same in every render of a frame).
const Birds: React.FC<{ U: number; seed: number; t: number; color: string }> = ({ U, seed, t, color }) => {
  const flock = useMemo(() => {
    const r = rng(seed ^ 0xb12d);
    const dir = r() < 0.5 ? 1 : -1;
    const n = 4 + Math.floor(r() * 4);
    return { dir, x0: (r() - 0.5) * U * 60, y: U * (9 + r() * 5), z: -U * (24 + r() * 14), speed: U * (1.6 + r() * 0.8),
      birds: Array.from({ length: n }, (_, i) => ({ dx: -i * U * 1.4 * (0.7 + r() * 0.6), dy: (r() - 0.5) * U * 1.6, dz: (r() - 0.5) * U * 3, ph: r() * 6.28, s: 0.8 + r() * 0.4 })) };
  }, [U, seed]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }), [color]);
  const wing = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.12, 1, 0, 0.05], 3));
    return g;
  }, []);
  const span = U * 120;
  return (
    <group>
      {flock.birds.map((b, i) => {
        const x = ((((flock.x0 + flock.dir * flock.speed * t + b.dx * flock.dir + span / 2) % span) + span) % span) - span / 2;
        const flap = Math.sin(t * 7 + b.ph) * 0.7;
        const k = U * 0.55 * b.s;
        return (
          <group key={i} position={[x, flock.y + b.dy + Math.sin(t * 0.9 + b.ph) * U * 0.25, flock.z + b.dz]} rotation={[0, flock.dir > 0 ? 0 : Math.PI, 0]} scale={[k, k, k]}>
            <mesh geometry={wing} material={mat} rotation={[flap, Math.PI / 2, 0]} />
            <mesh geometry={wing} material={mat} rotation={[-flap, -Math.PI / 2, 0]} />
          </group>
        );
      })}
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
  const vessel = set.backdrop === "vessel";
  const R = U * 4.5; // a blood vessel's radius, round the stage along x
  const bits = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: vessel ? 34 : 40 }, () => {
      if (!vessel) return { x: (r() - 0.5) * U * 16, y: r() * U * 6 - U, z: -r() * U * 14 + U * 2, s: 0.3 + r() * 0.6, a: r() * 6 };
      // behind and around the stage, never between it and the camera
      return { x: (r() - 0.5) * U * 24, y: U * 1.2 + (r() - 0.5) * R * 1.4, z: -(U * 1.6 + r() * R * 0.6), s: 0.45 + r() * 0.45, a: r() * 6 };
    });
  }, [seed, U, vessel, R]);
  // in a vessel the cells stream past along it, wrapping round
  const flow = (x: number) => (vessel ? ((((x + t * U * 1.4 + U * 12) % (U * 24)) + U * 24) % (U * 24)) - U * 12 : x);
  return (
    <group>
      {bits.map((b, i) => (
        <group key={i} position={[flow(b.x) + Math.sin(t * 0.4 + b.a) * U * 0.3, b.y + Math.cos(t * 0.3 + b.a) * U * 0.2, b.z]} rotation={[b.a + t * 0.2, b.a, 0]}>
          {look.blocky ? (
            <Block look={look} shape="torus" color={i % 4 ? tone(set.ground, 1.6) : set.accent} size={[U * b.s, U * b.s, U * b.s * 0.45]} />
          ) : (
            <mesh geometry={rbcGeometry()} material={material(look, i % 4 ? tone(set.ground, 1.6) : set.accent, { rough: 0.35 })} scale={U * b.s} />
          )}
        </group>
      ))}
      {vessel ? (
        <group position={[0, U * 1.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          {/* the wall, seen from inside: the near side never hides the stage */}
          <mesh>
            <cylinderGeometry args={[R, R, U * 90, 40, 1, true]} />
            <meshStandardMaterial color={tone(set.ground, 1.45)} side={THREE.BackSide} roughness={0.55} flatShading={look.blocky} />
          </mesh>
        </group>
      ) : null}
      <mesh>
        <sphereGeometry args={[U * 30, 24, 16]} />
        <meshStandardMaterial color={set.ground} side={THREE.BackSide} roughness={1} flatShading />
      </mesh>
    </group>
  );
};

let cloudTex: THREE.Texture | null = null;
// A soft cumulus puff: overlapping blurred discs, brighter on top, for sprites that read as vapour.
const cloudTexture = () => {
  if (cloudTex) return cloudTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const x = 50 + r() * 156, y = 90 + r() * 90, rad = 28 + r() * 46;
    const gr = g.createRadialGradient(x, y - rad * 0.2, 0, x, y, rad);
    const top = y < 130 ? 1 : 0.86;
    gr.addColorStop(0, `rgba(${255 * top},${255 * top},${255 * top},0.55)`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  cloudTex = new THREE.CanvasTexture(c);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  return cloudTex;
};

const SkyBits: React.FC<{ seed: number; U: number; ground: string; look: Look; light: Light; t: number }> = ({ seed, U, ground, look, light, t }) => {
  const clouds = useMemo(() => {
    const r = rng(seed);
    // a broken deck of cloud well below, a few banks at the aircraft's height far off, and wisps that
    // stream past close by so the shot reads as speed
    return Array.from({ length: 64 }, (_, i) => {
      const far = r();
      const kind = i < 40 ? "deck" : i < 52 ? "bank" : "wisp";
      if (kind === "deck") return { x: (r() - 0.5) * U * (60 + far * 160), y: -U * (8 + far * 14), z: -U * (2 + far * 80) + U * 6, s: U * (6 + r() * 10) * (0.7 + far), o: 0.5, sp: 1 + r() };
      if (kind === "bank") return { x: (r() - 0.5) * U * 160, y: -U * 2 + r() * U * 6, z: -U * (50 + r() * 40), s: U * (10 + r() * 12), o: 0.6, sp: 0.3 };
      return { x: (r() - 0.5) * U * 60, y: (r() - 0.7) * U * 4, z: U * (r() * 4 - 6), s: U * (1.5 + r() * 2.5), o: 0.35, sp: 6 + r() * 4 };
    });
  }, [seed, U]);
  const mats = useMemo(() => {
    const lit = mix(light.horizon, "#ffffff", 0.55);
    return [0.75, 0.9, 1].map((k) => new THREE.SpriteMaterial({ map: cloudTexture(), color: new THREE.Color(tone(lit, k)), transparent: true, depthWrite: false, fog: true }));
  }, [light.horizon]);
  return (
    <group>
      {clouds.map((c, i) => (
        <sprite key={i} material={mats[i % 3]} position={[(((c.x - t * U * 0.8 * c.sp + U * 90) % (U * 180)) + U * 180) % (U * 180) - U * 90, c.y, c.z]} scale={[c.s * 1.8, c.s, 1]} />
      ))}
      <Block look={look} color={ground} size={[U * 3000, U * 0.1, U * 3000]} at={[0, -U * 36, 0]} />
    </group>
  );
};
