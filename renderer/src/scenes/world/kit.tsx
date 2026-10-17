// The kit every world module is built from: the scene clock (progress, key moment, frames since it),
// the camera rig, the sky and light for the place and weather, and reusable set pieces (hills, trees,
// dust and ash billows, fireballs, debris). A module only describes its subject and what it does.
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import type { Scene } from "../../types";
import { unit } from "../../theme";
import type { SceneProps } from "../shared";
import {
  fogRange, flashOf, HeadingPlate, identityOf, lightningFrames, paletteOf, rng, sceneSeed, Sky, Stars, toonRamp, WeatherOverlay,
  type Palette, type Weather,
} from "../world3d";
import catalog from "./catalog.json";

export type WorldProps = { scene: Scene; portrait: boolean };

type ActionInfo = { moment?: number };
const actionInfo = (scene: Scene): ActionInfo | undefined => {
  const s = (catalog.subjects as Record<string, { actions: Record<string, ActionInfo> }>)[scene.subject ?? ""];
  return s?.actions[scene.action ?? ""];
};

// When the scene's key moment happens, 0-1: the narration's cue (set by the pipeline as effectAt), else
// the catalog's moment for the action.
export const momentOf = (scene: Scene) => scene.effectAt ?? actionInfo(scene)?.moment ?? 0.45;

// Everything a module needs to know about time, place and weather at this frame.
export const useWorld = (scene: Scene) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps } = useVideoConfig();
  const u = Math.min(1, frame / Math.max(1, D - 1));
  const at = momentOf(scene);
  const weather = (scene.weather ?? "clear") as Weather;
  const seed = sceneSeed(scene);
  const night = scene.setting === "night";
  const lightning = weather === "storm" ? flashOf(lightningFrames(seed, D, fps), frame) : 0;
  return {
    frame, D, fps, u, at, weather, seed, night, lightning,
    id: identityOf(scene), // the same named subject looks the same in every scene
    since: (u - at) * D, // frames since the key moment (negative before it)
    pal: paletteOf(scene.setting === "space" ? "night" : scene.setting, weather),
  };
};

// Point the camera. Portrait frames are narrow, so they stand back and widen the lens.
export const aim = (camera: THREE.Camera, pos: THREE.Vector3, look: THREE.Vector3, fov: number, portrait: boolean, back = 1.35) => {
  const p = portrait ? look.clone().add(pos.clone().sub(look).multiplyScalar(back)) : pos;
  camera.position.copy(p);
  camera.lookAt(look);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = portrait ? fov * 1.45 : fov;
    camera.near = 0.1;
    camera.far = 3000;
    camera.updateProjectionMatrix();
  }
};

// A camera shot around a subject of size `size` at the origin, drifting over the scene.
export const shotOf = (shot: string | null | undefined, u: number, size: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } => {
  const d = (u - 0.5) * 2;
  const s = size;
  switch (shot) {
    case "side":
      return { pos: new THREE.Vector3(d * s * 0.15, s * 0.18, s * 1.25), look: new THREE.Vector3(0, s * 0.08, 0), fov: 34 };
    case "front":
      return { pos: new THREE.Vector3(s * 1.15, s * 0.2, s * 0.35 + d * s * 0.1), look: new THREE.Vector3(0, s * 0.08, 0), fov: 34 };
    case "below":
      return { pos: new THREE.Vector3(s * 0.5 + d * s * 0.1, s * 0.03, s * 0.7), look: new THREE.Vector3(0, s * 0.25, 0), fov: 40 };
    case "orbit": {
      const a = 0.4 + u * 1.5;
      return { pos: new THREE.Vector3(Math.cos(a) * s * 1.2, s * 0.32, Math.sin(a) * s * 1.2), look: new THREE.Vector3(0, s * 0.08, 0), fov: 34 };
    }
    case "wide":
      return { pos: new THREE.Vector3(-s * 0.4 + d * s * 0.15, s * 0.7, s * 2.2), look: new THREE.Vector3(s * 0.1, 0, 0), fov: 36 };
    default: // chase
      return { pos: new THREE.Vector3(-s * 1.1 + d * s * 0.08, s * 0.35, s * 0.55), look: new THREE.Vector3(s * 0.15, s * 0.05, 0), fov: 36 };
  }
};

// A camera shake that kicks at the key moment and dies away.
export const shake = (since: number, strength = 1, frame = 0) =>
  since < 0 ? new THREE.Vector3() : new THREE.Vector3(Math.sin(frame * 2.7), Math.sin(frame * 3.1 + 1), Math.sin(frame * 2.3 + 2)).multiplyScalar(0.25 * strength * Math.exp(-since / 16));

// The sky, fog, light and stars for the place and weather. In space, a black sky, stars and a hard sun.
export const Atmosphere: React.FC<{ pal: Palette; weather: Weather; lightning: number; night: boolean; seed: number; space?: boolean; fog?: number }> = ({
  pal,
  weather,
  lightning,
  night,
  seed,
  space = false,
  fog = 1,
}) => {
  if (space)
    return (
      <>
        <color attach="background" args={["#03040c"]} />
        <Stars seed={seed} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[-60, 30, 40]} intensity={2.4} />
      </>
    );
  const [near, far] = fogRange(weather);
  return (
    <>
      <Sky pal={pal} />
      <fog attach="fog" args={[pal.horizon, near * fog, far * fog]} />
      <ambientLight intensity={0.78 * Math.max(pal.light, night ? 0.75 : 0) + 0.9 * lightning} />
      <directionalLight position={[30, 50, 30]} intensity={1.55 * Math.max(pal.light, night ? 0.55 : 0)} color={night ? "#c9d6ff" : "#ffffff"} />
      {night && weather === "clear" ? <Stars seed={seed} /> : null}
    </>
  );
};

const puff = new THREE.IcosahedronGeometry(1, 0);
const ball = new THREE.IcosahedronGeometry(1, 3);
const cone = new THREE.ConeGeometry(1, 1, 7);
const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1, 5);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// Low-poly hills on the horizon, in a ring, tinted by the place.
export const Hills: React.FC<{ seed: number; color: string; radius?: number; count?: number; height?: number }> = ({ seed, color, radius = 700, count = 14, height = 1 }) => {
  const hills = useMemo(() => {
    const r = rng(seed + 9);
    return Array.from({ length: count }, (_, i) => ({ a: (i / count) * Math.PI * 2 + r() * 0.3, s: 80 + r() * 120, h: (0.25 + r() * 0.45) * height }));
  }, [seed, count, height]);
  return (
    <group>
      {hills.map((h, i) => (
        <mesh key={i} geometry={puff} position={[Math.cos(h.a) * radius, 0, Math.sin(h.a) * radius]} scale={[h.s * 1.5, h.s * h.h, h.s]}>
          <meshToonMaterial color={color} gradientMap={toonRamp} />
        </mesh>
      ))}
    </group>
  );
};

export type TreeSpot = { x: number; z: number; s: number; tone: number };

// Trees scattered over an area, avoiding a strip along x (a road or a track) when `clear` is set.
export const treeSpots = (seed: number, count: number, area: [number, number, number, number], clear = 0): TreeSpot[] => {
  const r = rng(seed + 23);
  const out: TreeSpot[] = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const x = area[0] + r() * (area[1] - area[0]);
    const z = area[2] + r() * (area[3] - area[2]);
    if (Math.abs(z) < clear) continue;
    out.push({ x, z, s: 0.7 + r() * 0.9, tone: Math.floor(r() * 3) });
  }
  return out;
};

const GREENS = ["#3f8f4f", "#4f9f55", "#2f7a45"];

// A low-poly tree; `burn` 0-1 chars it, and flames flicker on it while it burns.
export const Tree: React.FC<{ spot: TreeSpot; x?: number; snow?: boolean; burn?: number; frame?: number; palm?: boolean }> = ({ spot, x, snow, burn = 0, frame = 0 }) => {
  const color = burn > 0.6 ? "#2a2522" : snow ? "#dfe9f0" : GREENS[spot.tone];
  const s = spot.s;
  return (
    <group position={[x ?? spot.x, 0, spot.z]} scale={s}>
      <mesh geometry={trunk} position={[0, 0.5, 0]}>
        <meshToonMaterial color="#6b4a2f" gradientMap={toonRamp} />
      </mesh>
      <mesh geometry={cone} position={[0, 1.9, 0]} scale={[1.1, 2.4 * (1 - burn * 0.25), 1.1]}>
        <meshToonMaterial color={color} gradientMap={toonRamp} />
      </mesh>
      {burn > 0.05 && burn < 0.95 ? (
        <mesh geometry={cone} position={[0, 2.4, 0]} scale={[0.8, 2 + 0.6 * Math.sin(frame / 2 + spot.x), 0.8]}>
          <meshBasicMaterial color={(frame + spot.tone) % 4 < 2 ? "#ff7a2a" : "#ffc23a"} />
        </mesh>
      ) : null}
    </group>
  );
};

// A billowing cloud from a point: dust from a collapse, ash from a volcano, smoke from a crash.
// Puffs are flung out and up, grow and settle; `since` is frames since it began.
export const Billow: React.FC<{
  at: [number, number, number];
  since: number;
  count?: number;
  spread?: number;
  rise?: number;
  size?: number;
  color?: string;
  dark?: string;
  seed?: number;
  life?: number;
}> = ({ at, since, count = 24, spread = 1, rise = 1, size = 1, color = "#9a948c", dark = "#6f6a64", seed = 5, life = 200 }) => {
  if (since < 0) return null;
  const t = Math.min(since, life);
  return (
    <group position={at}>
      {Array.from({ length: count }, (_, i) => {
        const r = rng(i * 13 + seed);
        const a = r() * Math.PI * 2;
        const born = r() * 14;
        const age = t - born;
        if (age <= 0) return null;
        const out = (1 - Math.exp(-age / 30)) * spread * (2 + r() * 5);
        const up = (1 - Math.exp(-age / 45)) * rise * (1 + r() * 7);
        const sc = size * (0.6 + r() * 1.2) * (0.3 + Math.min(1.4, age / 25));
        return (
          <mesh key={i} geometry={puff} position={[Math.cos(a) * out, up + r() * 0.5, Math.sin(a) * out]} scale={sc}>
            <meshToonMaterial color={i % 3 ? color : dark} emissive={color} emissiveIntensity={0.25} gradientMap={toonRamp} />
          </mesh>
        );
      })}
    </group>
  );
};

// A fireball that swells and burns out into smoke.
export const Fireball: React.FC<{ at: [number, number, number]; since: number; size?: number }> = ({ at, since, size = 1 }) => {
  if (since < 0 || since > 40) return null;
  const k = since / 40;
  return (
    <group position={at}>
      <mesh geometry={ball} scale={size * (0.8 + 3.2 * Math.sqrt(k))}>
        <meshBasicMaterial color={k < 0.3 ? "#fff1b0" : k < 0.6 ? "#ffb347" : "#ff6a2a"} transparent opacity={1 - k * 0.8} />
      </mesh>
      <mesh geometry={ball} scale={size * (0.5 + 2.2 * Math.sqrt(k))} position={[0.4 * size, 0.6 * size * k, 0]}>
        <meshBasicMaterial color="#ffd36a" transparent opacity={1 - k} />
      </mesh>
    </group>
  );
};

// Pieces thrown out of an impact, tumbling as they fly and fall.
export const Debris: React.FC<{ at: [number, number, number]; since: number; count?: number; speed?: number; color?: string; seed?: number; gravity?: number; floor?: number }> = ({
  at,
  since,
  count = 16,
  speed = 0.3,
  color = "#5d5a55",
  seed = 7,
  gravity = 0.006,
  floor = -Infinity,
}) => {
  if (since < 0) return null;
  return (
    <group position={at}>
      {Array.from({ length: count }, (_, i) => {
        const r = rng(i * 17 + seed);
        const a = r() * Math.PI * 2;
        const v = speed * (0.4 + r());
        const up = speed * (0.6 + r() * 1.2);
        const t = since;
        const y = Math.max(floor - at[1], up * t - gravity * t * t);
        return (
          <mesh key={i} geometry={unitBox} position={[Math.cos(a) * v * t, y, Math.sin(a) * v * t]} rotation={[t * 0.2 * r(), t * 0.15, t * 0.1]} scale={0.15 + r() * 0.35}>
            <meshToonMaterial color={color} gradientMap={toonRamp} />
          </mesh>
        );
      })}
    </group>
  );
};

// A world module as a full scene: its 3D stage, then weather drawn over it, the heading plate and a soft
// foot so the captions read.
export const moduleScene = (World: React.FC<WorldProps>): React.FC<SceneProps> => {
  const Scene3D: React.FC<SceneProps> = ({ scene, theme, format }) => {
    const { width, height } = useVideoConfig();
    const short = format === "short";
    return (
      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} camera={{ fov: 36, position: [-20, 8, 12] }} gl={{ antialias: true }}>
          <World scene={scene} portrait={short} />
        </ThreeCanvas>
        <WeatherOverlay weather={scene.weather} seed={sceneSeed(scene)} night={scene.setting === "night"} />
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <HeadingPlate scene={scene} theme={theme} short={short} />
        </AbsoluteFill>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * unit(format), background: `linear-gradient(transparent, ${theme.background}88)` }} />
      </AbsoluteFill>
    );
  };
  return Scene3D;
};
