// A 3D aircraft scene drawn like a flat illustration: a cel-shaded airliner with ink outlines flies
// through a sky of toon clouds over the ground, while a virtual camera tracks it. What the aircraft
// does (cruise, climb, descend, dive, turn, take off, land, go around) and where the camera sits
// (chase, side, front, below, orbit, wide) come from the script; an altitude readout counts to the
// figure as the narrator says it. Everything is a pure function of the frame, so renders repeat exactly.
//
// The aircraft is built from code (no model file to license): a lathed fuselage, swept extruded wings
// and tail, and nacelles, so it stays generic: no airline's real livery; its colours come from the video's seed.
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Scene, Theme } from "../types";
import { unit } from "../theme";
import { formatNumber, type SceneProps } from "./shared";
import {
  City, Cloud, clamp, ease, fogRange, flashOf, groundTexture, HeadingPlate, Inked, lightningFrames, liveryOf, paletteOf, rng, sceneSeed, identityOf, Sky, slab,
  toonRamp, WeatherOverlay, type Livery, type Weather,
} from "./world3d";
import { Modelled } from "./world/library";

export type Maneuver = "cruise" | "climb" | "descend" | "dive" | "turn" | "takeoff" | "land" | "go_around";
export type Shot = "chase" | "side" | "front" | "below" | "orbit" | "wide";

// ---------- the aircraft (nose toward +x, up +y, right wing toward +z) ----------

const fuselageGeometry = () => {
  // Radius along the length, from tail (0) to nose (10): a tapered tail cone, a long tube, a round nose.
  const pts: THREE.Vector2[] = [];
  const L = 10;
  const R = 0.55;
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * L;
    let r = R;
    if (x < 2.6) r = R * (0.12 + 0.88 * Math.sin(((x / 2.6) * Math.PI) / 2) ** 0.9);
    if (x > 8.9) r = R * Math.sqrt(Math.max(0, 1 - ((x - 8.9) / 1.1) ** 2));
    pts.push(new THREE.Vector2(i === 0 || i === 40 ? 0 : Math.max(r, 0.02), x));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(-Math.PI / 2); // lathe runs along y; turn it to run along x
  g.translate(-5, 0, 0); // centre the aircraft on the origin
  return g;
};

// A wing or stabiliser laid flat in the x-z plane, its span toward +z (right) or -z (left). The left
// one is drawn from mirrored points rather than a negative scale, which would turn its faces inside out.
const planform = (points: [number, number][], depth: number, side: 1 | -1) => {
  const g = slab(points.map(([x, z]) => [x, z * side] as [number, number]), depth);
  g.rotateX(Math.PI / 2); // the outline's second axis becomes z
  return g;
};

const wingGeometry = (side: 1 | -1) =>
  planform(
    [
      [0.9, 0],
      [-1.0, 0],
      [-2.7, 4.6],
      [-1.9, 4.6],
    ],
    0.12,
    side,
  );

const stabiliserGeometry = (side: 1 | -1) =>
  planform(
    [
      [0.3, 0],
      [-0.6, 0],
      [-1.4, 1.7],
      [-0.9, 1.7],
    ],
    0.08,
    side,
  );

const finGeometry = () =>
  slab(
    [
      [0.4, 0],
      [-1.0, 0],
      [-1.9, 2.0],
      [-1.2, 2.0],
    ],
    0.1,
  );

const nacelleGeometry = () => {
  const g = new THREE.CylinderGeometry(0.3, 0.26, 1.3, 20, 1, false);
  g.rotateZ(Math.PI / 2);
  return g;
};

// A spec (fyt/assets.py) shapes the airframe to the type the story names: two or four engines, the 747's
// hump or the A380's full double deck, a longer or shorter fuselage, the 777's big engines.
export type AirframeSpec = { engines?: number; hump?: boolean; doubleDeck?: boolean; stretch?: number; bigEngines?: boolean };

const Aircraft: React.FC<{ livery: Livery; gear: number; spec?: AirframeSpec }> = ({ livery, gear, spec = {} }) => {
  const parts = useMemo(
    () => ({
      body: fuselageGeometry(),
      wingL: wingGeometry(-1),
      wingR: wingGeometry(1),
      stabL: stabiliserGeometry(-1),
      stabR: stabiliserGeometry(1),
      fin: finGeometry(),
      nacelle: nacelleGeometry(),
      hump: new THREE.SphereGeometry(1, 20, 12),
      intake: new THREE.CircleGeometry(0.24, 20),
      wheel: new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12),
      strut: new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6),
    }),
    [],
  );
  const white = "#f4f6fa";
  const grey = "#b8c0cf";
  const stretch = spec.stretch ?? 1;
  const tall = spec.doubleDeck ? 1.32 : 1;
  const nacelle = spec.bigEngines ? 1.35 : 1;
  // Engines under each wing, outward along its sweep: the inner pair, then the outer pair of a four-engine type.
  const engines: [number, number][] = spec.engines === 4 ? [[0.55, 1.9], [-0.55, 3.3]] : [[0.55, 1.9]];
  return (
    <group>
      <group scale={[stretch, tall, tall]} position={[0, (tall - 1) * 0.3, 0]}>
      <Inked geometry={parts.body} color={white} outline={0.03} />
      {spec.hump ? <Inked geometry={parts.hump} color={white} outline={0.03} position={[3.15, 0.34, 0]} scale={[1.3, 0.4, 0.4]} /> : null}
      {spec.doubleDeck
        ? [1, -1].map((sd) => (
            <group key={sd}>
              {Array.from({ length: 16 }, (_, i) => (
                <mesh key={i} position={[-2.1 + i * 0.38, 0.36, sd * 0.47]}>
                  <boxGeometry args={[0.14, 0.1, 0.04]} />
                  <meshBasicMaterial color="#1b2340" />
                </mesh>
              ))}
            </group>
          ))
        : null}
      {/* Dark cockpit windows and cabin windows, and a cheatline in the theme colour below them. */}
      <mesh position={[4.45, 0.2, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.32, 0.12, 0.62]} />
        <meshBasicMaterial color="#1b2340" />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} position={[-2.1 + i * 0.38, 0.14, 0.54]}>
          <boxGeometry args={[0.14, 0.12, 0.04]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      ))}
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={`r${i}`} position={[-2.1 + i * 0.38, 0.14, -0.54]}>
          <boxGeometry args={[0.14, 0.12, 0.04]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      ))}
      <mesh position={[0.3, -0.1, 0]}>
        <boxGeometry args={[6.4, 0.07, 1.115]} />
        <meshToonMaterial color={livery.accent} gradientMap={toonRamp} />
      </mesh>
      </group>
      <Inked geometry={parts.wingL} color={grey} position={[0.6, -0.25, 0]} rotation={[0.05, 0, 0]} />
      <Inked geometry={parts.wingR} color={grey} position={[0.6, -0.25, 0]} rotation={[-0.05, 0, 0]} />
      <Inked geometry={parts.stabL} color={grey} position={[-3.9, 0.15, 0]} />
      <Inked geometry={parts.stabR} color={grey} position={[-3.9, 0.15, 0]} />
      <Inked geometry={parts.fin} color={livery.accent} position={[-3.6, 0.35, 0]} />
      {engines.flatMap(([x, z]) => [-1, 1].map((s) => (
        <group key={`${x}${s}`} position={[x, -0.62, s * z]} scale={nacelle}>
          <Inked geometry={parts.nacelle} color={white} outline={0.03} />
          <mesh geometry={parts.intake} position={[0.66, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <meshBasicMaterial color="#2a3150" />
          </mesh>
        </group>
      )))}
      {gear > 0.01
        ? [
            [3.4, 0],
            [0.1, 0.9],
            [0.1, -0.9],
          ].map(([x, z], i) => (
            <group key={i} position={[x, -0.55 - 0.25 * gear, z]} scale={gear}>
              <mesh geometry={parts.strut} position={[0, 0.2, 0]}>
                <meshBasicMaterial color="#555c6e" />
              </mesh>
              <mesh geometry={parts.wheel} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
                <meshBasicMaterial color="#20232c" />
              </mesh>
            </group>
          ))
        : null}
    </group>
  );
};

// ---------- the world ----------

// White spray thrown up as an aircraft touches down on water.
const Spray: React.FC<{ u: number; D: number; height: number }> = ({ u, D, height }) => {
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const touch = 0.8;
  if (u < touch - 0.02) return null;
  const since = (u - touch) * D;
  return (
    <group position={[0, -height, 0]}>
      {Array.from({ length: 26 }, (_, i) => {
        const r = rng(i * 5 + 1);
        const age = Math.max(0, since - i * 0.6);
        if (age <= 0) return null;
        const side = i % 2 ? 1 : -1;
        return (
          <mesh key={i} geometry={geo} position={[-1 - age * 0.12 - r() * 4, Math.min(2.4, age * 0.08) * (0.5 + r()), side * (0.8 + age * 0.06 + r())]} scale={0.25 + Math.min(1, age / 30) * (0.5 + r() * 0.6)}>
            <meshToonMaterial color="#ffffff" emissive="#dfefff" emissiveIntensity={0.5} gradientMap={toonRamp} />
          </mesh>
        );
      })}
    </group>
  );
};

// ---------- motion ----------

const UP = new THREE.Vector3(0, 1, 0);
const CLOUD_BASE = 34; // clouds float in a band around cruising height, not around the aircraft

type Pose = { height: number; pitch: number; roll: number; yaw: number; gear: number; travel: number };

// Where the aircraft is and how it is tilted at progress u (0-1) through the scene. Height is in world
// units above the ground; the world moves past the aircraft, which stays near the origin.
const poseOf = (m: Maneuver, u: number, frame: number): Pose => {
  const bob = Math.sin(frame / 22) * 0.06;
  const k = ease(u);
  switch (m) {
    case "climb":
      return { height: 30 + 22 * k, pitch: 0.16 * Math.min(1, u * 4), roll: bob * 0.3, yaw: 0, gear: 0, travel: u };
    case "descend":
      return { height: 52 - 22 * k, pitch: -0.1 * Math.min(1, u * 4), roll: bob * 0.3, yaw: 0, gear: 0, travel: u };
    case "dive": {
      const d = Easing.in(Easing.quad)(u);
      return { height: 60 - 42 * d, pitch: -0.1 - 0.42 * d, roll: Math.sin(frame / 9) * 0.05 * d, yaw: 0, gear: 0, travel: u * 1.3 };
    }
    case "turn":
      return { height: 40, pitch: 0.02, roll: -0.45 * Math.sin(Math.PI * Math.min(1, u * 1.1)), yaw: 1.6 * k, gear: 0, travel: u };
    case "takeoff": {
      const lift = interpolate(u, [0.35, 1], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
      return { height: 0.9 + 14 * lift, pitch: interpolate(u, [0.3, 0.45], [0, 0.22], clamp), roll: 0, yaw: 0, gear: 1 - interpolate(u, [0.7, 0.9], [0, 1], clamp), travel: u * 0.9 };
    }
    case "land": {
      const h = interpolate(u, [0, 0.8], [14, 0.9], { ...clamp, easing: Easing.out(Easing.quad) });
      return { height: h, pitch: interpolate(u, [0, 0.65, 0.8, 1], [-0.05, -0.04, 0.1, 0], clamp), roll: bob * 0.2 * (1 - u), yaw: 0, gear: 1, travel: u * 0.8 };
    }
    case "go_around": {
      const h = u < 0.5 ? interpolate(u, [0, 0.5], [16, 4], { easing: Easing.out(Easing.quad) }) : interpolate(u, [0.5, 1], [4, 18], { easing: Easing.in(Easing.quad) });
      return { height: h, pitch: u < 0.45 ? -0.05 : interpolate(u, [0.45, 0.6], [-0.05, 0.2], clamp), roll: 0, yaw: 0, gear: u < 0.6 ? 1 : 1 - interpolate(u, [0.6, 0.8], [0, 1], clamp), travel: u };
    }
    default:
      return { height: 40 + bob * 4, pitch: 0.01, roll: bob * 0.4, yaw: 0, gear: 0, travel: u };
  }
};

// Camera position relative to the aircraft, and where it looks, per shot, drifting over the scene.
const cameraOf = (shot: Shot, u: number, portrait: boolean): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } => {
  // A portrait frame is narrow: side-on and orbiting shots stand further back to keep the whole airliner in.
  const back = !portrait ? 1 : shot === "side" || shot === "front" || shot === "orbit" ? 1.85 : shot === "wide" ? 1.2 : 1.4;
  const drift = (u - 0.5) * 2;
  switch (shot) {
    case "side":
      return { pos: new THREE.Vector3(1.5 + drift * 1.2, 0.6, 15 * back), look: new THREE.Vector3(0, 0, 0), fov: 32 };
    case "front":
      return { pos: new THREE.Vector3(14 * back, 1.6, 4 + drift * 1.5), look: new THREE.Vector3(0, 0, 0), fov: 34 };
    case "below":
      return { pos: new THREE.Vector3(5, -7 * back, 8 + drift), look: new THREE.Vector3(0, 0.5, 0), fov: 40 };
    case "orbit": {
      const a = -0.9 + u * 2.2;
      return { pos: new THREE.Vector3(Math.cos(a) * 15 * back, 3.5, Math.sin(a) * 15 * back), look: new THREE.Vector3(0, 0, 0), fov: 34 };
    }
    case "wide":
      return { pos: new THREE.Vector3(-6 + drift * 3, 10, 42 * back), look: new THREE.Vector3(2, -2, 0), fov: 36 };
    default: // chase
      return { pos: new THREE.Vector3(-15 * back + drift, 4.2, 6.5 * back), look: new THREE.Vector3(1.5, 0, 0), fov: 36 };
  }
};

// ---------- the 3D stage ----------

const World: React.FC<{ scene: Scene; theme: Theme; portrait: boolean }> = ({ scene, theme, portrait }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D } = useVideoConfig();
  const { camera } = useThree();
  const u = Math.min(1, frame / Math.max(1, D - 1));
  const maneuver = (scene.maneuver ?? "cruise") as Maneuver;
  const shot = (scene.shot ?? (maneuver === "turn" ? "chase" : maneuver === "takeoff" || maneuver === "land" ? "side" : "chase")) as Shot;
  const weather = (scene.weather ?? "clear") as Weather;
  const pal = paletteOf(scene.setting, weather);
  const seed = sceneSeed(scene);
  const lightning = weather === "storm" ? flashOf(lightningFrames(seed, D), frame) : 0;
  const pose = poseOf(maneuver, u, frame);
  const ground = useMemo(() => groundTexture(pal, scene.setting, seed), [pal, scene.setting, seed]);

  // The world streams past: ground texture and clouds move back along x as the aircraft flies.
  const speed = maneuver === "takeoff" || maneuver === "land" ? 0.7 : 1;
  const distance = pose.travel * 160 * speed;
  ground.offset.set(distance / (4000 / 14), 0);

  const clouds = useMemo(() => {
    const r = rng(seed + 1);
    return Array.from({ length: 22 }, (_, i) => ({ x: r() * 260 - 60, y: (r() - 0.45) * 50, z: (r() - 0.5) * 160, seed: seed + i * 13, s: 0.7 + r() * 1.1 }));
  }, [seed]);

  const cam = cameraOf(shot, u, portrait);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = portrait ? cam.fov * 1.55 : cam.fov;
    camera.near = 0.1;
    camera.far = 2000;
    camera.updateProjectionMatrix();
  }

  // A runway under take-offs and landings, except on water (a ditching lands on the sea itself).
  const runway = (maneuver === "takeoff" || maneuver === "land" || maneuver === "go_around") && scene.setting !== "sea";
  return (
    <>
      <Sky pal={pal} />
      <fog attach="fog" args={[pal.horizon, ...fogRange(weather)]} />
      <ambientLight intensity={0.75 * pal.light + 0.9 * lightning} />
      <directionalLight position={[20, 40, 25]} intensity={1.6 * pal.light} />
      {/* The world turns under a banking aircraft and drops away as it climbs. */}
      <group rotation={[0, -pose.yaw, 0]} position={[0, -pose.height, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4000, 4000]} />
          <meshToonMaterial map={ground} gradientMap={toonRamp} />
        </mesh>
        {runway ? (
          <group position={[60 - distance, 0.02, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[260, 7]} />
              <meshBasicMaterial color="#3b3f4a" />
            </mesh>
            {Array.from({ length: 24 }, (_, i) => (
              <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-120 + i * 10.5, 0.01, 0]}>
                <planeGeometry args={[5, 0.35]} />
                <meshBasicMaterial color="#e9edf3" />
              </mesh>
            ))}
          </group>
        ) : null}
        {scene.setting === "city" ? <City seed={seed} distance={distance} /> : null}
        {clouds.map((c, i) => {
          const x = ((((c.x - distance * 0.9) % 260) + 260) % 260) - 60;
          const y = CLOUD_BASE + c.y;
          // Where the cloud sits relative to the aircraft, as the camera sees it: one too near the lens
          // would fill the frame with white, so it is left out.
          const rel = new THREE.Vector3(x, y - pose.height, c.z).applyAxisAngle(UP, -pose.yaw);
          if (rel.distanceTo(cam.pos) < 18 * c.s || rel.length() < 20 * c.s) return null;
          return (
            <group key={i} position={[x, y, c.z]} scale={c.s}>
              <Cloud seed={c.seed} color={pal.cloud} />
            </group>
          );
        })}
      </group>
      {maneuver === "land" && scene.setting === "sea" ? <Spray u={u} D={D} height={pose.height} /> : null}
      <group rotation={[pose.roll, 0, pose.pitch]}>
        {/* A ditching is flown with the gear up. */}
        <Modelled model={scene.model} length={10}>
          <Aircraft livery={liveryOf(identityOf(scene))} gear={scene.setting === "sea" ? 0 : pose.gear} spec={scene.model?.params as AirframeSpec | undefined} />
        </Modelled>
        {scene.effect
          ? enginesOf(scene.effectX).map((side) => <EngineTrouble key={side} side={side} effect={scene.effect!} at={scene.effectAt ?? 0.25} u={u} frame={frame} />)
          : null}
      </group>
    </>
  );
};

// ---------- engine trouble ----------

// Which engines are in trouble: effect_x under 40 the left, over 60 the right, otherwise both.
const enginesOf = (x: number | null | undefined): (1 | -1)[] => (x == null || (x >= 40 && x <= 60) ? [-1, 1] : x < 40 ? [-1] : [1]);

// A struck or failed engine: a flash as it happens, then a trail of smoke puffs streaming back, with
// flickering flame for fire. `at` is when it happens, 0-1 through the scene.
const EngineTrouble: React.FC<{ side: 1 | -1; effect: string; at: number; u: number; frame: number }> = ({ side, effect, at, u, frame }) => {
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const { durationInFrames: D } = useVideoConfig();
  const since = (u - at) * D; // frames since it happened
  if (since < 0) return null;
  const engine = new THREE.Vector3(-0.2, -0.62, 1.9 * side);
  const flash = Math.max(0, 1 - since / 8);
  const smoky = effect === "smoke" || effect === "fire" || effect === "explosion";
  const puffs = smoky ? Math.min(28, Math.floor(since / 2)) : 0;
  return (
    <group>
      {flash > 0 ? (
        <mesh geometry={geo} position={engine} scale={0.6 + 2.2 * (1 - flash)}>
          <meshBasicMaterial color="#fff1b0" transparent opacity={flash} />
        </mesh>
      ) : null}
      {Array.from({ length: puffs }, (_, i) => {
        const age = i * 2 + (since % 2); // older puffs are further back and bigger
        const r = rng(i * 7 + (side > 0 ? 11 : 3));
        return (
          <mesh key={i} geometry={geo} position={[engine.x - 0.5 - age * 0.32, engine.y + (r() - 0.5) * 0.3 * (age / 10), engine.z + (r() - 0.5) * 0.4 * (age / 10)]} scale={Math.max(0, (0.18 + age * 0.03) * (1 - Math.max(0, age - 40) / 20))}>
            <meshToonMaterial color={i < 3 && effect === "fire" ? "#ff9a3c" : age < 12 ? "#5d6270" : "#8d929e"} emissive="#4a4f5c" emissiveIntensity={0.35} gradientMap={toonRamp} />
          </mesh>
        );
      })}
      {effect === "fire"
        ? [0, 1, 2].map((k) => (
            <mesh key={k} position={[engine.x - 0.75 - k * 0.25, engine.y, engine.z]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1 + 0.3 * Math.sin(frame / 2 + k), 1]}>
              <coneGeometry args={[0.22 - k * 0.05, 0.6, 8]} />
              <meshBasicMaterial color={k ? "#ffcf4a" : "#ff6a2a"} />
            </mesh>
          ))
        : null}
    </group>
  );
};

// ---------- readouts ----------

const altitudeAt = (scene: Scene, frame: number, D: number, fps: number) => {
  const from = scene.altitudeFrom;
  const to = scene.altitudeTo;
  if (from == null && to == null) return null;
  const a = from ?? to ?? 0;
  const b = to ?? from ?? 0;
  const lands = scene.landTimes?.length ? Math.round(scene.landTimes[0] * fps) : Math.round(D * 0.8);
  const start = Math.max(6, Math.min(lands - 30, Math.round(D * 0.15)));
  return { value: interpolate(frame, [start, Math.max(start + 1, lands)], [a, b], { ...clamp, easing: ease }), falling: b < a, rising: b > a };
};

const Readout: React.FC<{ scene: Scene; theme: Theme; short: boolean }> = ({ scene, theme, short }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps } = useVideoConfig();
  const alt = altitudeAt(scene, frame, D, fps);
  const p = spring({ frame: frame - 6, fps, config: { damping: 16 } });
  const k = short ? 1.35 : 1;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <HeadingPlate scene={scene} theme={theme} short={short} />
      {alt ? (
        <div
          style={{
            position: "absolute",
            // In a Short the readout sits under the heading, so the two never collide in the narrow frame.
            ...(short ? { left: 70, top: scene.heading ? (scene.text ? 380 : 330) : 200 } : { right: 90, top: 70 }),
            padding: `${12 * k}px ${22 * k}px`,
            background: `${theme.background}e6`,
            borderRadius: 12,
            border: `2px solid ${alt.falling ? "#ff6b5b" : theme.accent2}`,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            color: theme.text,
            textAlign: short ? "left" : "right",
            opacity: p,
          }}
        >
          <div style={{ fontSize: 20 * k, letterSpacing: 3, color: theme.muted }}>ALTITUDE</div>
          <div style={{ fontSize: 50 * k, fontWeight: 800, color: alt.falling ? "#ff8a7a" : theme.text }}>
            {alt.rising ? "▲ " : alt.falling ? "▼ " : ""}
            {formatNumber(Math.round(alt.value / 10) * 10)} ft
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const AircraftScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const { width, height } = useVideoConfig();
  const short = format === "short";
  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height} camera={{ fov: 36, position: [-15, 4, 6] }} gl={{ antialias: true }}>
        <World scene={scene} theme={theme} portrait={short} />
      </ThreeCanvas>
      <WeatherOverlay weather={scene.weather} seed={sceneSeed(scene)} night={scene.setting === "night"} />
      <Readout scene={scene} theme={theme} short={short} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * unit(format), background: `linear-gradient(transparent, ${theme.background}88)` }} />
    </AbsoluteFill>
  );
};
