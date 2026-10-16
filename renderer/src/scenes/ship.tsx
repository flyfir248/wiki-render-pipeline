// A 3D ship scene in the same flat-illustration look as the aircraft: a cel-shaded vessel with ink
// outlines rides a faceted low-poly sea that rolls under it, in the scene's weather, while a virtual
// camera watches. What the ship does (sail, turn, list, sink, capsize, collide, dive, surface), what it
// hits (an iceberg, another ship, rocks) and where the camera sits come from the script. The ship pitches
// and rolls with the actual waves under its bow, stern and sides, so a storm throws it about.
//
// Every vessel is built from code (no model file to license) and stays generic: colours come from a
// livery picked by the video's seed, never a real shipping line's.
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Scene, Setting, Theme } from "../types";
import { unit } from "../theme";
import type { SceneProps } from "./shared";
import {
  clamp, Cloud, ease, flashOf, Flash, fogRange, HeadingPlate, Inked, inkMaterial, InkedBox, lightningFrames, liveryOf, paletteOf, rng, sceneSeed, Sea,
  Sky, Smoke, Splash, swellOf, Toon, toonRamp, waveAt, WeatherOverlay, type Livery, type Palette, type Weather,
} from "./world3d";

export type Vessel = NonNullable<Scene["vessel"]>;
export type ShipAction = NonNullable<Scene["shipAction"]>;
type Shot = NonNullable<Scene["shot"]>;

// Length, beam, freeboard (hull above water) and draft (below), in world units.
type Dims = { L: number; B: number; F: number; T: number };
const DIMS: Record<Vessel, Dims> = {
  liner: { L: 26, B: 3.2, F: 2.2, T: 1.3 },
  cargo: { L: 24, B: 3.6, F: 1.7, T: 1.4 },
  tanker: { L: 26, B: 4, F: 1.5, T: 1.6 },
  sailing: { L: 12, B: 2.6, F: 1.2, T: 1 },
  warship: { L: 20, B: 2.6, F: 1.5, T: 1 },
  submarine: { L: 18, B: 2, F: 0.5, T: 1.5 },
};

// ---------- geometry ----------

// A mesh with an ink shell: a copy scaled up about its own centre by a fixed margin, drawn inside out.
// Works for the convex shapes here (hulls, decks, blocks), where pushing split face normals leaves gaps.
const Shelled: React.FC<{ geometry: THREE.BufferGeometry; color: string; outline?: number; position?: [number, number, number] }> = ({ geometry, color, outline = 0.06, position }) => {
  const { scale, offset } = useMemo(() => {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox!;
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    const s = new THREE.Vector3(1 + (2 * outline) / Math.max(size.x, 0.01), 1 + (2 * outline) / Math.max(size.y, 0.01), 1 + (2 * outline) / Math.max(size.z, 0.01));
    return { scale: s, offset: c.clone().multiply(new THREE.Vector3(1 - s.x, 1 - s.y, 1 - s.z)) };
  }, [geometry, outline]);
  return (
    <group position={position}>
      <mesh geometry={geometry}>
        <Toon color={color} />
      </mesh>
      <mesh geometry={geometry} material={inkMaterial} position={offset} scale={scale} />
    </group>
  );
};

// A hull's plan seen from above, extruded up `h`: a square stern with rounded corners and a pointed bow.
// The bow rakes forward as it rises, like a real stem. y runs from 0 to h.
const hullGeometry = (L: number, B: number, h: number, rake = 0.35, sternRound = 0.6) => {
  const hb = B / 2;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, -hb * (1 - sternRound * 0.4));
  s.quadraticCurveTo(-L / 2, -hb, -L / 2 + hb * sternRound, -hb);
  s.lineTo(L / 2 - L * 0.28, -hb);
  s.quadraticCurveTo(L / 2 - L * 0.06, -hb, L / 2, 0);
  s.quadraticCurveTo(L / 2 - L * 0.06, hb, L / 2 - L * 0.28, hb);
  s.lineTo(-L / 2 + hb * sternRound, hb);
  s.quadraticCurveTo(-L / 2, hb, -L / 2, hb * (1 - sternRound * 0.4));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); // the extrusion now rises along +y
  const pos = g.attributes.position as THREE.BufferAttribute;
  const bowStart = L / 2 - L * 0.3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x > bowStart) pos.setX(i, x + ((x - bowStart) / (L / 2 - bowStart)) * rake * pos.getY(i));
  }
  g.computeVertexNormals();
  return g;
};

// A submarine's pressure hull: a long cigar with a rounded bow and a tapering stern, nose toward +x.
const cigarGeometry = (L: number, R: number) => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * L;
    let r = R;
    if (x < L * 0.3) r = R * (0.15 + 0.85 * Math.sin(((x / (L * 0.3)) * Math.PI) / 2));
    if (x > L * 0.88) r = R * Math.sqrt(Math.max(0, 1 - ((x - L * 0.88) / (L * 0.12)) ** 2));
    pts.push(new THREE.Vector2(i === 0 || i === 40 ? 0 : Math.max(r, 0.02), x));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  g.rotateZ(-Math.PI / 2);
  g.translate(-L / 2, 0, 0);
  return g;
};

// A jagged lump (iceberg or rock): a sphere with its points pushed in and out, shared corners kept
// together so the ink stays closed. Flattened underneath, where it meets the water.
const lumpGeometry = (seed: number, radius: number, detail: number, squash: [number, number, number]) => {
  const base = new THREE.IcosahedronGeometry(radius, detail);
  base.deleteAttribute("normal");
  base.deleteAttribute("uv");
  const g = mergeVertices(base);
  const r = rng(seed);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + r() * 0.5;
    pos.setXYZ(i, pos.getX(i) * k * squash[0], Math.max(-radius * 0.3, pos.getY(i) * k * squash[1]), pos.getZ(i) * k * squash[2]);
  }
  g.computeVertexNormals();
  return g;
};

// ---------- the vessels (bow toward +x, up +y, starboard toward +z, waterline at y = 0) ----------

const Funnel: React.FC<{ at: [number, number, number]; color: string; r?: number; h?: number }> = ({ at, color, r = 0.55, h = 2.4 }) => {
  const body = useMemo(() => new THREE.CylinderGeometry(r, r * 1.05, h, 18), [r, h]);
  const band = useMemo(() => new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.18, 18), [r, h]);
  return (
    <group position={at} rotation={[0, 0, 0.1]}>
      <Inked geometry={body} color={color} outline={0.05} position={[0, h / 2, 0]} />
      <mesh geometry={band} position={[0, h * 0.92, 0]}>
        <meshBasicMaterial color="#14161d" />
      </mesh>
    </group>
  );
};

const Mast: React.FC<{ at: [number, number, number]; h: number; r?: number; color?: string }> = ({ at, h, r = 0.08, color = "#3a3226" }) => (
  <mesh position={[at[0], at[1] + h / 2, at[2]]}>
    <cylinderGeometry args={[r * 0.7, r, h, 8]} />
    <meshBasicMaterial color={color} />
  </mesh>
);

// The hull: antifouling red below the waterline, the livery's hull colour above, and a deck on top.
const Hull: React.FC<{ d: Dims; color: string; deck: string; rake?: number; stripe?: string }> = ({ d, color, deck, rake = 0.35, stripe }) => {
  const g = useMemo(
    () => ({
      below: hullGeometry(d.L * 0.985, d.B * 0.94, d.T, rake * 0.5),
      above: hullGeometry(d.L, d.B, d.F, rake),
      deck: hullGeometry(d.L * 0.95, d.B * 0.9, 0.06, 0),
    }),
    [d, rake],
  );
  return (
    <group>
      <Shelled geometry={g.below} color="#a8322d" position={[0, -d.T, 0]} />
      <Shelled geometry={g.above} color={color} />
      {stripe ? (
        <mesh position={[-d.L * 0.06, d.F * 0.82, 0]}>
          <boxGeometry args={[d.L * 0.74, 0.12, d.B * 1.005]} />
          <meshBasicMaterial color={stripe} />
        </mesh>
      ) : null}
      <mesh geometry={g.deck} position={[0, d.F, 0]}>
        <Toon color={deck} />
      </mesh>
    </group>
  );
};

// A row of dark windows along both sides of a deckhouse.
const Windows: React.FC<{ x0: number; x1: number; y: number; halfBeam: number; step?: number }> = ({ x0, x1, y, halfBeam, step = 0.55 }) => (
  <>
    {Array.from({ length: Math.max(1, Math.floor((x1 - x0) / step)) }, (_, i) =>
      [1, -1].map((s) => (
        <mesh key={`${i}${s}`} position={[x0 + (i + 0.5) * step, y, s * (halfBeam + 0.01)]}>
          <boxGeometry args={[step * 0.45, 0.18, 0.04]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      )),
    )}
  </>
);

const Liner: React.FC<{ d: Dims; livery: Livery }> = ({ d, livery }) => {
  const top = d.F;
  return (
    <group>
      <Hull d={d} color={livery.hull} deck="#c9a77a" stripe="#f2efe6" />
      <InkedBox size={[d.L * 0.62, 0.9, d.B * 0.82]} color="#f4f2ec" at={[-d.L * 0.04, top + 0.45, 0]} />
      <InkedBox size={[d.L * 0.48, 0.8, d.B * 0.7]} color="#f4f2ec" at={[-d.L * 0.06, top + 1.3, 0]} />
      <InkedBox size={[2, 0.7, d.B * 0.6]} color="#f4f2ec" at={[d.L * 0.2, top + 2.0, 0]} />
      <Windows x0={-d.L * 0.34} x1={d.L * 0.26} y={top + 0.45} halfBeam={d.B * 0.41} />
      <Windows x0={-d.L * 0.29} x1={d.L * 0.17} y={top + 1.3} halfBeam={d.B * 0.35} />
      {[0.12, -0.04, -0.2].map((k, i) => (
        <Funnel key={i} at={[d.L * k, top + 1.7, 0]} color={livery.accent} />
      ))}
      <Mast at={[d.L * 0.36, top, 0]} h={5.5} />
      <Mast at={[-d.L * 0.38, top, 0]} h={5} />
      {/* Lifeboats along the boat deck. */}
      {Array.from({ length: 6 }, (_, i) =>
        [1, -1].map((s) => <InkedBox key={`${i}${s}`} size={[0.9, 0.3, 0.35]} color="#f7f4ea" at={[-d.L * 0.24 + i * 1.6, top + 1.85, s * d.B * 0.33]} outline={0.03} />),
      )}
    </group>
  );
};

const CONTAINERS = ["#c8452d", "#2d6cc8", "#e2a52b", "#3a9b5c", "#8a8f99", "#a8329a", "#1f7f8f"];

const Cargo: React.FC<{ d: Dims; livery: Livery; seed: number }> = ({ d, livery, seed }) => {
  const boxes = useMemo(() => {
    const r = rng(seed + 31);
    const out: { x: number; y: number; z: number; c: string }[] = [];
    for (let bay = 0; bay < 11; bay++)
      for (let row = -2; row <= 2; row++) {
        const tiers = 1 + Math.floor(r() * 3);
        for (let t = 0; t < tiers; t++) out.push({ x: -d.L * 0.22 + bay * 1.4, y: d.F + 0.3 + t * 0.6, z: row * 0.62, c: CONTAINERS[Math.floor(r() * CONTAINERS.length)] });
      }
    return out;
  }, [seed, d]);
  return (
    <group>
      <Hull d={d} color={livery.hull} deck="#7b828d" rake={0.4} />
      {boxes.map((b, i) => (
        <InkedBox key={i} size={[1.3, 0.56, 0.58]} color={b.c} at={[b.x, b.y, b.z]} outline={0.025} />
      ))}
      <InkedBox size={[2.2, 2.6, d.B * 0.86]} color="#f2f0ea" at={[-d.L * 0.38, d.F + 1.3, 0]} />
      <InkedBox size={[1.2, 0.5, d.B * 1.25]} color="#f2f0ea" at={[-d.L * 0.36, d.F + 2.85, 0]} />
      <Windows x0={-d.L * 0.38 - 0.8} x1={-d.L * 0.38 + 1.1} y={d.F + 2.1} halfBeam={d.B * 0.43} step={0.45} />
      <Funnel at={[-d.L * 0.44, d.F + 2.2, 0]} color={livery.accent} r={0.45} h={1.6} />
    </group>
  );
};

const Tanker: React.FC<{ d: Dims; livery: Livery }> = ({ d, livery }) => (
  <group>
    <Hull d={d} color={livery.hull} deck="#9a5a4a" rake={0.3} />
    <mesh position={[0, d.F + 0.25, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.18, 0.18, d.L * 0.62, 10]} />
      <meshToonMaterial color="#d9d4c8" gradientMap={toonRamp} />
    </mesh>
    {Array.from({ length: 6 }, (_, i) => (
      <InkedBox key={i} size={[0.5, 0.35, d.B * 0.7]} color="#d9d4c8" at={[-d.L * 0.25 + i * 2.6, d.F + 0.18, 0]} outline={0.03} />
    ))}
    <InkedBox size={[2.4, 2.8, d.B * 0.82]} color="#f2f0ea" at={[-d.L * 0.39, d.F + 1.4, 0]} />
    <Windows x0={-d.L * 0.39 - 0.9} x1={-d.L * 0.39 + 1.2} y={d.F + 2.3} halfBeam={d.B * 0.41} step={0.45} />
    <Funnel at={[-d.L * 0.45, d.F + 2.4, 0]} color={livery.accent} r={0.5} h={1.6} />
  </group>
);

const Sailing: React.FC<{ d: Dims; livery: Livery; frame: number }> = ({ d, livery, frame }) => {
  const masts = [d.L * 0.22, -d.L * 0.02, -d.L * 0.25];
  const billow = 0.1 + 0.03 * Math.sin(frame / 20);
  return (
    <group>
      <Hull d={d} color="#7a4b2a" deck="#c9a77a" rake={0.6} stripe={livery.accent} />
      <InkedBox size={[2.2, 0.7, d.B * 0.86]} color="#8a5a35" at={[-d.L * 0.38, d.F + 0.35, 0]} outline={0.04} />
      <mesh position={[d.L / 2 + 1.2, d.F + 0.6, 0]} rotation={[0, 0, -1.05]}>
        <cylinderGeometry args={[0.05, 0.08, 3, 6]} />
        <meshBasicMaterial color="#3a3226" />
      </mesh>
      {masts.map((x, i) => {
        const h = i === 1 ? 8.5 : 7.5;
        return (
          <group key={i}>
            <Mast at={[x, d.F, 0]} h={h} r={0.1} />
            {[0.28, 0.55, 0.8].map((k, j) => (
              <InkedBox key={j} size={[0.08, h * 0.22, d.B * (1.6 - j * 0.3)]} color="#f3ead6" at={[x + 0.25, d.F + h * k, 0]} rotation={[0, 0.55, -billow]} outline={0.04} />
            ))}
          </group>
        );
      })}
    </group>
  );
};

const Warship: React.FC<{ d: Dims }> = ({ d }) => {
  const grey = "#8a94a1";
  const barrel = useMemo(() => new THREE.CylinderGeometry(0.07, 0.08, 2.2, 8), []);
  const turret = (x: number, dir: 1 | -1) => (
    <group position={[x, d.F + 0.3, 0]} rotation={[0, dir < 0 ? Math.PI : 0, 0]}>
      <InkedBox size={[1.4, 0.6, 1.2]} color={grey} at={[0, 0, 0]} />
      <mesh geometry={barrel} position={[1.5, 0.1, 0]} rotation={[0, 0, Math.PI / 2 - 0.05]}>
        <meshToonMaterial color="#5b6370" gradientMap={toonRamp} />
      </mesh>
    </group>
  );
  return (
    <group>
      <Hull d={d} color={grey} deck="#6f7884" rake={0.55} />
      {turret(d.L * 0.27, 1)}
      {turret(-d.L * 0.33, -1)}
      <InkedBox size={[4.2, 1.2, d.B * 0.7]} color={grey} at={[d.L * 0.02, d.F + 0.6, 0]} />
      <InkedBox size={[2.2, 1, d.B * 0.55]} color={grey} at={[d.L * 0.06, d.F + 1.7, 0]} />
      <Windows x0={d.L * 0.06 + 0.2} x1={d.L * 0.06 + 1.1} y={d.F + 1.85} halfBeam={d.B * 0.275} step={0.3} />
      <Mast at={[d.L * 0.0, d.F + 2.2, 0]} h={3.5} r={0.1} color="#4b525d" />
      <InkedBox size={[0.2, 0.2, 1.6]} color="#5b6370" at={[d.L * 0.0, d.F + 5, 0]} outline={0.03} />
      <InkedBox size={[1.2, 1.2, 0.9]} color={grey} at={[-d.L * 0.14, d.F + 0.6, 0]} />
    </group>
  );
};

const Submarine: React.FC<{ d: Dims }> = ({ d }) => {
  const g = useMemo(
    () => ({
      hull: cigarGeometry(d.L, d.B / 2),
      fin: (() => {
        const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-1.2, 0), new THREE.Vector2(-1.4, 1.1), new THREE.Vector2(-0.6, 1.1)]);
        const e = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
        e.translate(0, 0, -0.05);
        return e;
      })(),
    }),
    [d],
  );
  const dark = "#4a5262";
  return (
    <group position={[0, -0.55, 0]}>
      <Inked geometry={g.hull} color={dark} outline={0.05} />
      <InkedBox size={[2.6, 1.7, 0.8]} color={dark} at={[d.L * 0.12, d.B / 2 + 0.75, 0]} />
      <InkedBox size={[1.8, 0.08, 2]} color={dark} at={[d.L * 0.12 + 0.2, d.B / 2 + 1.1, 0]} outline={0.03} />
      <Mast at={[d.L * 0.12 - 0.5, d.B / 2 + 1.6, 0]} h={1.1} r={0.06} color="#1d2027" />
      <mesh geometry={g.fin} position={[-d.L / 2 + 1.6, 0.2, 0]}>
        <Toon color={dark} />
      </mesh>
      <mesh geometry={g.fin} position={[-d.L / 2 + 1.6, -0.2, 0]} rotation={[Math.PI, 0, 0]}>
        <Toon color={dark} />
      </mesh>
      <mesh geometry={g.fin} position={[-d.L / 2 + 1.6, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <Toon color={dark} />
      </mesh>
      <mesh geometry={g.fin} position={[-d.L / 2 + 1.6, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <Toon color={dark} />
      </mesh>
    </group>
  );
};

const Vessel3D: React.FC<{ vessel: Vessel; livery: Livery; seed: number; frame: number }> = ({ vessel, livery, seed, frame }) => {
  const d = DIMS[vessel];
  switch (vessel) {
    case "cargo":
      return <Cargo d={d} livery={livery} seed={seed} />;
    case "tanker":
      return <Tanker d={d} livery={livery} />;
    case "sailing":
      return <Sailing d={d} livery={livery} frame={frame} />;
    case "warship":
      return <Warship d={d} />;
    case "submarine":
      return <Submarine d={d} />;
    default:
      return <Liner d={d} livery={livery} />;
  }
};

// ---------- what the ship hits ----------

const Iceberg: React.FC<{ seed: number }> = ({ seed }) => {
  const g = useMemo(() => ({ main: lumpGeometry(seed, 3.2, 1, [1.3, 1.4, 1]), cap: lumpGeometry(seed + 1, 1.8, 1, [1, 1.6, 0.9]) }), [seed]);
  return (
    <group>
      <Inked geometry={g.main} color="#eef8fd" outline={0.08} />
      <Inked geometry={g.cap} color="#d6eef8" outline={0.08} position={[-0.8, 3.2, 0.3]} />
    </group>
  );
};

const Rocks: React.FC<{ seed: number }> = ({ seed }) => {
  const g = useMemo(() => [0, 1, 2, 3].map((i) => lumpGeometry(seed + i * 5, 1.4 + i * 0.3, 1, [1.4, 0.7, 1.1])), [seed]);
  return (
    <group>
      {g.map((geo, i) => (
        <Inked key={i} geometry={geo} color={i % 2 ? "#5d5a55" : "#6f6a62"} outline={0.06} position={[i * 1.8 - 2.5, -0.3, (i % 2 ? 1 : -1) * 1.2]} />
      ))}
    </group>
  );
};

// ---------- motion ----------

// Where the ship sits at progress u through the scene: how far down it has gone, its pitch (bow up
// positive), roll (starboard down positive), yaw, and how fast the sea runs past it (1 = cruising).
type Pose = { sink: number; pitch: number; roll: number; yaw: number; speed: number; jolt: number };

const poseOf = (a: ShipAction, u: number, frame: number, at: number, d: Dims, D: number): Pose => {
  const base: Pose = { sink: 0, pitch: 0, roll: 0, yaw: 0, speed: 1, jolt: 0 };
  switch (a) {
    case "turn":
      return { ...base, yaw: 1.1 * ease(u), roll: -0.09 * Math.sin(Math.PI * Math.min(1, u * 1.1)) };
    case "list": {
      const k = ease(Math.min(1, u / 0.9));
      return { ...base, roll: 0.36 * k, sink: 0.5 * k, speed: 1 - 0.8 * k };
    }
    case "sink": {
      // The bow settles, the stern lifts clear of the water as the hull tips, then it slides under.
      const s1 = interpolate(u, [0, 0.35], [0, 1], { ...clamp, easing: ease });
      const tilt = interpolate(u, [0.3, 0.75], [0, 1], { ...clamp, easing: ease });
      const plunge = interpolate(u, [0.7, 1], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
      return { ...base, pitch: -0.06 * s1 - 0.42 * tilt, roll: 0.05 * s1, sink: 0.6 * s1 + 1.6 * tilt + (d.L * 0.5 + d.F) * plunge, speed: 0.3 * (1 - s1) };
    }
    case "capsize": {
      const k = interpolate(u, [0.15, 0.85], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
      return { ...base, roll: 1.95 * k, sink: (d.F + d.T * 0.4) * k, speed: 0.4 * (1 - k) };
    }
    case "collide": {
      // A shudder as it strikes, a lurch to port, and the way coming off it.
      const since = (u - at) * D;
      if (since < 0) return base;
      const shake = Math.exp(-since / 14);
      return { ...base, jolt: shake, roll: -0.07 * shake * Math.cos(since / 3) + 0.06 * Math.min(1, since / 60), pitch: 0.02 * shake * Math.sin(since / 2), speed: 0.25 + 0.75 * Math.exp(-since / 10) };
    }
    case "dive": {
      const k = interpolate(u, [0.15, 0.85], [0, 1], { ...clamp, easing: ease });
      return { ...base, sink: 4.2 * k, pitch: -0.1 * Math.sin(Math.PI * k) };
    }
    case "surface": {
      const k = interpolate(u, [0.1, 0.6], [1, 0], { ...clamp, easing: Easing.out(Easing.quad) });
      return { ...base, sink: 4.2 * k, pitch: 0.14 * Math.sin(Math.PI * (1 - k)) };
    }
    default:
      return base;
  }
};

// How far the sea has run past the ship by frame f: the pose's speed integrated over the scene.
const travelAt = (a: ShipAction, f: number, at: number, d: Dims, D: number) => {
  let x = 0;
  for (let i = 0; i < f; i += 2) x += poseOf(a, i / Math.max(1, D - 1), i, at, d, D).speed * 0.32;
  return x;
};

// Camera position relative to the ship, per shot, scaled to its length and drifting over the scene.
const cameraOf = (shot: Shot, u: number, portrait: boolean, L: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } => {
  const s = L / 24;
  const back = (!portrait ? 1 : shot === "side" || shot === "front" || shot === "orbit" ? 1.45 : shot === "wide" ? 1 : 1.2) * s;
  const drift = (u - 0.5) * 2;
  switch (shot) {
    case "side":
      return { pos: new THREE.Vector3(2 + drift * 2, 3, 34 * back), look: new THREE.Vector3(0, 2, 0), fov: 34 };
    case "front":
      return { pos: new THREE.Vector3(30 * back, 4.5, 9 * back + drift * 2), look: new THREE.Vector3(0, 2, 0), fov: 34 };
    case "below": // down at the waterline, looking up at the hull
      return { pos: new THREE.Vector3(14 * back + drift * 2, 0.9, 16 * back), look: new THREE.Vector3(0, 3.2, 0), fov: 40 };
    case "orbit": {
      const a = 0.3 + u * 1.6;
      return { pos: new THREE.Vector3(Math.cos(a) * 34 * back, 7, Math.sin(a) * 34 * back), look: new THREE.Vector3(0, 2, 0), fov: 34 };
    }
    case "wide":
      return { pos: new THREE.Vector3(-12 + drift * 4, 20 * back, 64 * back), look: new THREE.Vector3(4, 0, 0), fov: 36 };
    default: // chase: behind and above the starboard quarter
      return { pos: new THREE.Vector3(-30 * back + drift * 2, 9 * s, 15 * back), look: new THREE.Vector3(3, 1.5, 0), fov: 36 };
  }
};

// Sea colours: always water, whatever the place and weather.
const seaOf = (setting: Setting | null | undefined, weather: Weather, pal: Palette): Palette => {
  const night = setting === "night";
  const water = night ? ["#1f3a6e", "#193260"] : setting === "snow" ? ["#3b6c8f", "#315d7c"] : setting === "desert" ? ["#2a9fb5", "#238aa0"] : ["#2f7fb8", "#276ea3"];
  const grey = weather === "storm" ? 0.45 : weather === "rain" || weather === "fog" ? 0.25 : 0;
  const tint = (c: string) => "#" + new THREE.Color(c).lerp(new THREE.Color(night ? "#0b1020" : "#4c5866"), grey).getHexString();
  return { ...pal, ground: tint(water[0]), ground2: tint(water[1]) };
};

// ---------- the 3D stage ----------

const World: React.FC<{ scene: Scene; portrait: boolean }> = ({ scene, portrait }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D } = useVideoConfig();
  const { camera } = useThree();
  const u = Math.min(1, frame / Math.max(1, D - 1));
  const vessel = (scene.vessel ?? "liner") as Vessel;
  const d = DIMS[vessel];
  const action = (scene.shipAction ?? "sail") as ShipAction;
  const weather = (scene.weather ?? "clear") as Weather;
  const seed = sceneSeed(scene);
  const livery = liveryOf(scene.seed ?? 0); // one livery for the whole video, so the ship stays the same ship
  const pal = paletteOf(scene.setting === "sea" ? null : scene.setting, weather);
  const sea = seaOf(scene.setting, weather, pal);
  const amp = swellOf(weather);
  const at = scene.effectAt ?? (action === "collide" ? 0.45 : 0.3);
  const shot = (scene.shot ?? (action === "sink" || action === "capsize" || action === "list" ? "side" : action === "collide" ? "wide" : "chase")) as Shot;
  const lightning = weather === "storm" ? flashOf(lightningFrames(seed, D), frame) : 0;
  const night = scene.setting === "night";

  const pose = poseOf(action, u, frame, at, d, D);
  const travel = useMemo(() => Array.from({ length: D }, (_, f) => travelAt(action, f, at, d, D)), [action, at, d, D]);
  const run = travel[Math.min(frame, D - 1)];

  // Ride the real waves: height at the middle, pitch from bow against stern, roll from side against side.
  const w = (x: number, z: number) => waveAt(x + run, z, frame, amp);
  const ride = Math.max(0, 1 - pose.sink / 2); // a ship going under stops riding the swell
  const heave = w(0, 0) * ride;
  const wavePitch = Math.atan2(w(d.L * 0.45, 0) - w(-d.L * 0.45, 0), d.L * 0.9) * 0.8 * ride;
  const waveRoll = Math.atan2(w(0, d.B * 2) - w(0, -d.B * 2), d.B * 4) * 0.9 * ride;
  const shake = pose.jolt * 0.12 * Math.sin(frame * 2.3);

  const cam = cameraOf(shot, u, portrait, d.L);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = portrait ? cam.fov * 1.55 : cam.fov;
    camera.near = 0.1;
    camera.far = 2400;
    camera.updateProjectionMatrix();
  }

  const clouds = useMemo(() => {
    const r = rng(seed + 1);
    return Array.from({ length: 16 }, (_, i) => ({ a: r() * Math.PI * 2, dist: 220 + r() * 260, y: 40 + r() * 70, seed: seed + i * 13, s: 2 + r() * 2.5 }));
  }, [seed]);
  // Land on the horizon for a coast (any setting but open sea and night), ice floes in the Arctic.
  const coast = scene.setting && !["sea", "night", "sky", "space"].includes(scene.setting);
  const hills = useMemo(() => {
    const r = rng(seed + 9);
    return Array.from({ length: 9 }, (_, i) => ({ x: -500 + i * 130 + r() * 60, s: 50 + r() * 70, h: 0.25 + r() * 0.35 }));
  }, [seed]);
  const hillGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const floes = useMemo(() => {
    const r = rng(seed + 17);
    return Array.from({ length: 30 }, () => ({ x: r() * 300 - 120, z: (r() - 0.5) * 160, s: 1 + r() * 3, rot: r() * 6 }));
  }, [seed]);
  const hillColor = scene.setting === "snow" ? "#eef3f8" : scene.setting === "desert" ? "#d9a565" : scene.setting === "city" ? "#8a93a3" : "#5f9e5a";

  // The obstacle: rides toward the ship with the sea and meets the starboard bow at `at`.
  const contactRun = travel[Math.min(D - 1, Math.round(at * (D - 1)))];
  const obstacleX = d.L * 0.36 + (contactRun - run);
  const obstacle = action === "collide" ? scene.obstacle ?? "iceberg" : null;
  const since = (u - at) * D;

  const sternWake = pose.speed > 0.15 && pose.sink < 1.5 && vessel !== "submarine";
  const funnelSmoke = (vessel === "liner" || vessel === "cargo" || vessel === "tanker") && pose.sink < d.F;

  return (
    <>
      <Sky pal={pal} />
      <fog attach="fog" args={[pal.horizon, ...fogRange(weather).map((v) => v * 1.4) as [number, number]]} />
      {/* At night, starlight: bright enough to read the ship, with stars and no moon (moonless nights happen). */}
      <ambientLight intensity={0.78 * Math.max(pal.light, night ? 0.8 : 0) + 0.9 * lightning} />
      <directionalLight position={[20, 40, 25]} intensity={1.55 * Math.max(pal.light, night ? 0.6 : 0)} color={night ? "#c9d6ff" : "#ffffff"} />
      {night && weather === "clear" ? <Stars seed={seed} /> : null}
      <Sea pal={sea} frame={frame} travel={run} amp={amp} />
      {(night && weather === "clear" ? [] : clouds).map((c, i) => (
        <group key={i} position={[Math.cos(c.a) * c.dist, c.y, Math.sin(c.a) * c.dist]} scale={c.s}>
          <Cloud seed={c.seed} color={pal.cloud} />
        </group>
      ))}
      {coast
        ? hills.map((h, i) => (
            <mesh key={i} geometry={hillGeo} position={[h.x, 0, -420]} scale={[h.s * 1.6, h.s * h.h, h.s]}>
              <meshToonMaterial color={hillColor} gradientMap={toonRamp} />
            </mesh>
          ))
        : null}
      {scene.setting === "snow"
        ? floes.map((f, i) => {
            const x = ((((f.x - run) % 300) + 300) % 300) - 120;
            if (Math.abs(f.z) < d.B * 2 + f.s && Math.abs(x) < d.L * 0.7) return null; // never through the hull
            return (
              <mesh key={i} position={[x, w(x, f.z) + 0.05, f.z]} rotation={[0, f.rot, 0]} scale={[f.s, 1, f.s * 0.7]}>
                <cylinderGeometry args={[1, 1, 0.25, 6]} />
                <meshToonMaterial color="#f2f8fc" gradientMap={toonRamp} />
              </mesh>
            );
          })
        : null}
      {obstacle === "iceberg" ? (
        <group position={[obstacleX, w(obstacleX, d.B / 2 + 3) * 0.3, d.B / 2 + 2.6]}>
          <Iceberg seed={seed} />
        </group>
      ) : null}
      {obstacle === "rocks" ? (
        <group position={[obstacleX + 1, 0, 0.6]}>
          <Rocks seed={seed} />
        </group>
      ) : null}
      {obstacle === "ship" ? (
        // The other ship comes in from starboard, bow first, and stops in the hull.
        <group position={[d.L * 0.05, w(d.L * 0.05, 12) * 0.6, d.B / 2 + DIMS.cargo.L / 2 - 0.6 + Math.max(0, -since) * 0.09]} rotation={[0, Math.PI / 2, 0]}>
          <Cargo d={DIMS.cargo} livery={liveryOf(seed + 77)} seed={seed + 77} />
        </group>
      ) : null}
      {obstacle ? <Splash at={[obstacle === "ship" ? d.L * 0.05 : d.L * 0.36, 0.2, d.B / 2]} since={since} size={1.4} seed={seed} /> : null}

      {/* The ship: heaving and tilting on the swell, going down by `sink`. */}
      <group position={[0, heave - pose.sink + shake, 0]} rotation={[pose.roll + waveRoll, pose.yaw, pose.pitch + wavePitch]}>
        <Vessel3D vessel={vessel} livery={livery} seed={seed} frame={frame} />
        {funnelSmoke ? <Smoke at={[vessel === "liner" ? d.L * 0.12 : -d.L * 0.44, d.F + (vessel === "liner" ? 4.3 : 3.9), 0]} since={frame + 40} wind={[-0.12, 0.05, 0.01]} scale={0.38} seed={seed} /> : null}
        {scene.effect ? <DeckEffect effect={scene.effect} x={scene.effectX} d={d} since={since} seed={seed} /> : null}
      </group>
      {sternWake ? <Wake d={d} frame={frame} speed={pose.speed} w={w} /> : null}
      {action === "dive" && u > 0.35 ? <Splash at={[d.L * 0.12, 0.1, 0]} since={(u - 0.35) * D * 0.6} size={0.8} seed={seed + 3} /> : null}
      {action === "surface" ? <Splash at={[d.L * 0.15, 0.1, 0]} since={(u - 0.45) * D} size={1.8} seed={seed + 4} /> : null}
      {action === "sink" && u > 0.8 ? <Splash at={[-d.L * 0.2, 0.1, 0]} since={(u - 0.8) * D * 0.6} size={1.1} seed={seed + 5} /> : null}
    </>
  );
};

// Stars scattered over the upper sky.
const Stars: React.FC<{ seed: number }> = ({ seed }) => {
  const geo = useMemo(() => {
    const r = rng(seed + 41);
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2;
      const el = 0.04 + r() ** 0.7 * 1.3;
      pts.push(Math.cos(a) * Math.cos(el) * 850, Math.sin(el) * 850, Math.sin(a) * Math.cos(el) * 850);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [seed]);
  return (
    <points geometry={geo}>
      <pointsMaterial color="#f4f1e0" size={2.4} sizeAttenuation={false} fog={false} />
    </points>
  );
};

// Smoke, fire or an explosion on deck: effect_x runs from the stern (0) to the bow (100).
const DeckEffect: React.FC<{ effect: string; x?: number | null; d: Dims; since: number; seed: number }> = ({ effect, x, d, since, seed }) => {
  if (!["smoke", "fire", "explosion"].includes(effect)) return null;
  const at: [number, number, number] = [((x ?? 50) / 100 - 0.5) * d.L * 0.85, d.F + 0.3, 0];
  return (
    <group>
      {effect === "explosion" ? <Flash at={[at[0], at[1] + 0.5, at[2]]} since={since} size={2.2} /> : null}
      <Smoke at={at} since={since} wind={[-0.06, 0.12, 0.02]} fire={effect !== "smoke"} scale={1.6} seed={seed + 2} />
    </group>
  );
};

// White water: a V of foam spreading behind the stern and a curl at the bow, riding the swell.
const Wake: React.FC<{ d: Dims; frame: number; speed: number; w: (x: number, z: number) => number }> = ({ d, frame, speed, w }) => {
  const geo = useMemo(() => new THREE.CircleGeometry(1, 7), []);
  const n = 44;
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const k = (i + ((frame * 0.3) % 1)) / n;
        const x = -d.L / 2 + 0.5 - k * 36;
        return [1, -1, 0].map((s) => {
          if (s === 0 && i % 2) return null; // the churned water straight behind the screws
          const z = s * (d.B * 0.3 + k * 8);
          return (
            <mesh key={`${i}${s}`} geometry={geo} position={[x, w(x, z) + 0.06, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[(0.9 + k * 2.2) * speed, (0.5 + k * 1.2) * speed, 1]}>
              <meshBasicMaterial color="#f4fbff" transparent opacity={0.8 * (1 - k)} />
            </mesh>
          );
        });
      })}
      {[1, -1].map((s) =>
        [0, 1, 2].map((j) => (
          <mesh key={`b${s}${j}`} geometry={geo} position={[d.L / 2 - 1 - j * 1.4, w(d.L / 2 - j, s * d.B * 0.6) + 0.08, s * (d.B * 0.55 + j * 0.35)]} rotation={[-Math.PI / 2, 0, j]} scale={(0.7 - j * 0.15) * speed}>
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        )),
      )}
    </group>
  );
};

export const ShipScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const { width, height } = useVideoConfig();
  const short = format === "short";
  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height} camera={{ fov: 36, position: [-30, 9, 15] }} gl={{ antialias: true }}>
        <World scene={scene} portrait={short} />
      </ThreeCanvas>
      <WeatherOverlay weather={scene.weather} seed={sceneSeed(scene)} night={scene.setting === "night"} />
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <HeadingPlate scene={scene} theme={theme as Theme} short={short} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * unit(format), background: `linear-gradient(transparent, ${theme.background}88)` }} />
    </AbsoluteFill>
  );
};
