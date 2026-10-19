// The story world: a stage scene whose cast, place and direction were generated for this story
// (fyt/worldgen.py). The blocking (where everyone is, which way they face, how far they have walked) and
// the camera are pure functions of the frame, so the 3D scene and the labels pinned over it agree.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { unit as unitOf } from "../../../theme";
import type { SceneProps } from "../../shared";
import { HeadingPlate, WeatherOverlay } from "../../world3d";
import { momentOf } from "../kit";
import { prepare, useModel } from "../stage";
import { Bird, Cell, Fish, Insect, Quadruped, quadDims, quadPose, Serpent } from "./creatures";
import { Environment, INSIDE, type KeepOut, VOID, waterBand } from "./environment";
import { dimsOf, Flames, humanPose, Humanoid } from "./humanoid";
import { PartMesh, partsBounds } from "./parts";
import { lightOf, type Look, lookOf, material } from "./style";
import type { Build, CastMember, Spot, World } from "./types";

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const MOVING = ["walk", "run", "carry", "drive", "fly", "swim", "move", "approach", "depart", "climb", "crash"];

// How much ground a thing takes up and how tall it stands, in metres, for spacing and framing.
export const footprint = (b: Build) => {
  const s = Math.max(0.05, b.size);
  switch (b.archetype) {
    case "humanoid":
      return { w: 0.9, h: s };
    case "quadruped":
      return { w: s * 0.9, h: quadDims(b).y + quadDims(b).h * 0.8 };
    case "vehicle":
    case "object": {
      const bb = partsBounds(b.parts);
      return { w: Math.max(bb.size.x, bb.size.z, s * 0.5), h: Math.max(bb.size.y, s * 0.15) };
    }
    case "structure":
    case "plant": {
      const bb = partsBounds(b.parts);
      return { w: Math.max(bb.size.x, bb.size.z, s * 0.4), h: Math.max(bb.size.y, s) };
    }
    case "cell":
      return { w: s * 1.2, h: s * 1.2 };
    case "fish":
      return { w: s, h: s * 0.6 };
    default:
      return { w: s, h: s * 0.6 };
  }
};

const SPOTS: Record<Spot, [number, number]> = { center: [0, 0], left: [-1.7, 0.25], right: [1.7, 0.25], back: [0.2, -2.4], front: [-0.2, 1.3], far: [0.4, -7] };

type Placed = { m: CastMember; pos: THREE.Vector3; yaw: number; phase: number; speed: number; h: number; w: number; w0: number; air: number };
export type Blocking = { actors: Placed[]; cam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }; U: number; t: number; k: number; u: number };

const flies = (m: CastMember) => m.verb === "fly" && ["vehicle", "bird", "insect"].includes(m.build.archetype);

// Where everyone is and where the camera is at this frame.
export const block = (w0: World, frame: number, fps: number, D: number, at: number): Blocking => {
  // birds flying with an aircraft are drawn larger than life, or a flock beside an airliner is specks
  const jet = w0.cast.find((c) => flies(c) && c.build.archetype === "vehicle");
  const world = jet
    ? { ...w0, cast: w0.cast.map((c) => (flies(c) && (c.build.archetype === "bird" || c.build.archetype === "insect") && c.build.size < jet.build.size * 0.2
        ? { ...c, build: { ...c.build, size: jet.build.size * 0.2 } } : c)) }
    : w0;
  const u = Math.min(1, frame / Math.max(1, D - 1));
  const t = frame / fps;
  const k = (u - at) * (D / fps);
  const sizes = world.cast.map((m) => footprint(m.build));
  const ground = world.cast.filter((m) => !flies(m));
  const U = Math.max(1.1, ...ground.map((m) => footprint(m.build).w * 0.9), ...(ground.length ? [] : sizes.map((s) => s.w * 0.6)));
  const used = new Map<string, number>();
  const placed: Placed[] = world.cast.map((m, i) => {
    const { w, h } = sizes[i];
    const n = used.get(m.at) ?? 0;
    used.set(m.at, n + 1);
    const [sx, sz] = SPOTS[m.at] ?? SPOTS.center;
    const start = new THREE.Vector3(sx * U + n * U * 1.3, 0, sz * U + n * U * 0.4);
    if (i > 0 && !flies(m) && !flies(world.cast[0])) {
      // beside the lead, not inside it: clear of both bodies whatever their size
      const gap = sizes[0].w / 2 + w / 2 + U * 0.35;
      if (sx !== 0 && Math.abs(start.x) < gap) start.x = Math.sign(sx) * gap;
      if (m.at === "back" && start.z > -gap) start.z = -gap;
    }
    let end = start.clone();
    if (m.to && m.to !== m.at) {
      const [ex, ez] = SPOTS[m.to] ?? SPOTS.center;
      end = new THREE.Vector3(ex * U, 0, ez * U);
    } else if (MOVING.includes(m.verb)) {
      // moving with nowhere named: across its spot, a few of its own lengths, faster for a vehicle
      const reach = m.build.archetype === "vehicle" ? w * 2.2 : m.verb === "run" ? U * 3 : U * 1.6;
      start.x -= reach / 2;
      end = start.clone().add(new THREE.Vector3(reach, 0, 0));
    }
    const go = m.verb === "crash" ? ease(Math.min(1, u / Math.max(0.1, at))) : m.verb === "approach" || m.verb === "depart" ? ease(u) : u;
    // in a set with open water, what floats (boats, a ditched aircraft, swimmers) is out on it
    const band = waterBand(world.set.kind);
    const floats = band && (m.build.archetype === "fish" || m.verb === "swim" || (m.build.archetype === "vehicle" && !flies(m) && m.verb !== "drive"));
    if (floats && band) {
      const dz = band[0] * U - w * 0.4 - Math.max(start.z, end.z);
      if (dz < 0) {
        start.z += dz;
        end.z += dz;
      }
    }
    const pos = start.clone().lerp(end, go);
    const dist = start.distanceTo(end) * go;
    const stride = m.build.archetype === "humanoid" ? dimsOf(m.build).hip * 1.5 : m.build.archetype === "quadruped" ? quadDims(m.build).leg * 2.4 : Math.max(0.2, w * 0.5);
    const inPlace = start.distanceTo(end) < 0.01 && ["walk", "run", "swim", "climb"].includes(m.verb);
    const phase = inPlace ? t * (m.verb === "run" ? 10 : 6) : (dist / stride) * Math.PI * 2 + t * 0.2;
    // facing: where it goes, else who it looks at, else the lead, else three-quarters to camera
    // alone: three-quarters to camera, and a person standing or talking turns to face it
    let yaw = world.cast.length === 1 ? (m.build.archetype === "humanoid" && ["idle", "talk", "work"].includes(m.verb) ? -Math.PI / 2 + 0.45 : -1.0) : -0.55;
    const dir = end.clone().sub(start);
    if (dir.lengthSq() > 1e-4) yaw = Math.atan2(-dir.z, dir.x);
    else if (m.face === "camera") yaw = -Math.PI / 2 + (m.build.archetype === "humanoid" ? 0.35 : 0.9); // an animal head-on is a block: three-quarters
    else {
      const target = m.face ? world.cast.findIndex((c) => c.entity === m.face) : i > 0 ? 0 : -1;
      if (target >= 0 && target !== i) {
        const [tx, tz] = SPOTS[world.cast[target].at] ?? SPOTS.center;
        yaw = Math.atan2(-(tz * U - pos.z), tx * U - pos.x);
      }
    }
    let air = 0;
    const aircraft = world.cast.filter((c, j) => flies(c) && c.build.archetype === "vehicle" && j !== i);
    if (flies(m)) air = m.build.archetype === "vehicle" ? U * 2.6 + h : aircraft.length ? U * 2.6 + footprint(aircraft[0].build).h * 1.2 : ground.length ? U * 1.8 : U * 1.2;
    if (m.verb === "fall" && m.build.archetype === "vehicle") air = (U * 2.6 + h) * (1 - ease((k + 1.2) / 1.2));
    if (m.verb === "rise") air = h * 1.4 * ease((k + 0.6) / 1.6);
    if (m.verb === "fall" && m.build.archetype !== "vehicle" && m.build.archetype !== "humanoid" && m.build.archetype !== "quadruped") {
      // dropped: from whatever flies in the shot, else from a few times its own height
      const from = world.cast.some((c) => flies(c)) ? U * 2.6 + Math.max(...world.cast.filter(flies).map((c) => footprint(c.build).h)) : h * 4;
      air = from * (1 - Math.min(1, Math.max(0, (k + 1.2) / 1.2)) ** 2);
    }
    pos.y = air || (floats ? -h * 0.12 : 0);
    const speed = dist / Math.max(0.1, t);
    const many = Math.max(1, Math.min(9, m.count ?? 1));
    return { m, pos, yaw, phase, speed, h, w: w * (1 + 0.9 * Math.sqrt(many - 1)), w0: w, air };
  });
  // people beside something afloat (a ditched airliner, a boat) stand on it, not on the water
  const lead = placed[0];
  if (lead && waterBand(world.set.kind) && lead.m.build.archetype === "vehicle" && !flies(lead.m) && lead.m.verb !== "drive") {
    const c = Math.cos(lead.yaw), s = Math.sin(lead.yaw);
    placed.forEach((p, i) => {
      if (i === 0 || p.m.build.archetype !== "humanoid") return;
      const along = (i % 2 ? -0.08 : 0.08) * lead.w0, across = (i % 2 ? 1 : -1) * 0.22 * lead.w0;
      p.pos.set(lead.pos.x + along * c + across * s, lead.pos.y + lead.h * 0.3, lead.pos.z - along * s + across * c);
      p.air = 0;
    });
  }
  return { actors: placed, cam: direct(world, placed, u, t, U), U, t, k, u };
};

// The camera move the direction asked for, framing its actor and whoever is near it.
const direct = (world: World, placed: Placed[], u: number, t: number, U: number) => {
  const on = placed.find((p) => p.m.entity === world.on) ?? placed[0];
  const look = on.pos.clone().add(new THREE.Vector3(0, on.h * 0.55, 0));
  let R = Math.max(on.w, on.h) * 0.7 + U * 0.3;
  placed.forEach((p) => {
    if (p !== on && Math.abs(p.pos.y - on.pos.y) < U * 3) R = Math.max(R, p.pos.distanceTo(on.pos) * 0.55 + Math.max(p.w, p.h) * 0.5);
  });
  const fov = 36;
  let d = (R / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.05;
  const inside = INSIDE.includes(world.set.kind) && world.set.kind !== "cave";
  if (inside) d = Math.min(d, U * 3.6);
  const e = ease(u);
  const side = (a: number, dist: number, y: number) => new THREE.Vector3(Math.sin(a) * dist, y, Math.cos(a) * dist);
  let off: THREE.Vector3;
  let target = look.clone();
  switch (world.camera) {
    case "establish":
      off = side(0.5 - 0.15 * e, d * (1.3 - 0.45 * e), d * (0.72 - 0.45 * e) + on.h * 0.3);
      break;
    case "follow":
      off = side(0.12, d * 1.0, on.h * 0.35 + d * 0.12);
      target = look.clone().add(new THREE.Vector3(on.w * 0.2, 0, 0));
      break;
    case "orbit":
      off = side(-0.7 + u * 1.5, d * 1.05, on.h * 0.4 + d * 0.18);
      break;
    case "push_in":
      off = side(0.35, d * (1.35 - 0.55 * e), on.h * 0.25 + d * 0.12 * (1 - e));
      break;
    case "low_angle":
      off = side(0.55 - 0.15 * u, d * 0.82, Math.max(0.25, on.h * 0.08));
      target = look.clone().add(new THREE.Vector3(0, on.h * 0.2, 0));
      break;
    case "over_shoulder": {
      const other = placed.find((p) => p !== on && Math.abs(p.pos.y - on.pos.y) < U * 3);
      if (other) {
        const back = other.pos.clone().sub(on.pos).setY(0).normalize();
        const pos = other.pos.clone().add(back.multiplyScalar(other.w * 0.9 + U * 0.6)).add(new THREE.Vector3(0, other.h * 1.0, 0)).add(new THREE.Vector3(0, 0, U * 0.5));
        return { pos, look, fov: fov - 4 };
      }
      off = side(0.3, d, on.h * 0.4);
      break;
    }
    case "top_down":
      off = new THREE.Vector3(d * 0.05, d * (1.55 - 0.2 * e), d * 0.35);
      break;
    case "reveal":
      off = side(-0.2 + 0.5 * e, d * (0.55 + 0.75 * e), on.h * (0.25 + 0.9 * e) + d * 0.25 * e);
      break;
    default:
      off = side(0.4, d, on.h * 0.35 + d * 0.15);
  }
  const pos = target.clone().add(off);
  pos.y = Math.max(pos.y, 0.25 + (on.air > 0 ? 0 : 0));
  pos.x += Math.sin(t * 0.5) * d * 0.012; // a hand-held drift so a held shot still breathes
  return { pos, look: target, fov };
};

// The camera exactly as aim() in kit.tsx places it, for projecting labels.
export const finalCamera = (b: Blocking, portrait: boolean, aspect: number) => {
  const back = 1.25;
  const pos = portrait ? b.cam.look.clone().add(b.cam.pos.clone().sub(b.cam.look).multiplyScalar(back)) : b.cam.pos.clone();
  const cam = new THREE.PerspectiveCamera(portrait ? b.cam.fov * 1.45 : b.cam.fov, aspect, 0.1, 3000);
  cam.position.copy(pos);
  cam.lookAt(b.cam.look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
};

// --- actors -----------------------------------------------------------------------------------------

const Rigid: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = ({ p, look, b }) => {
  const { m } = p;
  const build = m.build;
  const bb = partsBounds(build.parts);
  const verb = m.verb;
  const { t, k } = b;
  const spin = (p.phase / Math.PI) * 2 + (verb === "fly" ? t * 40 : 0);
  let rot: [number, number, number] = [0, 0, 0];
  const off = new THREE.Vector3();
  let scale = 1;
  switch (verb) {
    case "present":
      rot = [0, Math.sin(t * 0.4) * 0.12, 0];
      break;
    case "turn":
      rot = [0, interpolate(b.u, [0, 1], [0, Math.PI * 0.9]), 0];
      break;
    case "spin":
      rot = [0, t * 1.4, 0];
      break;
    case "fly":
      rot = [Math.sin(t * 0.9) * 0.06, 0, Math.sin(t * 0.6) * 0.03];
      off.y = Math.sin(t * 1.1) * p.h * 0.05;
      break;
    case "fall":
      rot = build.archetype === "vehicle" ? [0.25 * ease((k + 1.2) / 1.2), 0, -0.35 * ease((k + 1.2) / 1.2)] : [ease((k + 0.4) / 0.5) * 1.2, 0, ease((k + 0.4) / 0.5) * 0.4];
      break;
    case "crash":
    case "shake": {
      const hit = k > 0 ? Math.exp(-k * 3) : 0;
      off.set(Math.sin(t * 40) * p.w * 0.04 * hit, 0, Math.cos(t * 37) * p.w * 0.03 * hit);
      if (verb === "crash" && k > 0) rot = [0.15 * ease(k * 3), 0, -0.12 * ease(k * 3)];
      break;
    }
    case "sway":
      rot = [0, 0, Math.sin(t * 1.3) * 0.06];
      break;
    case "grow":
      scale = 0.3 + 0.7 * ease((k + 1.5) / 2);
      break;
    case "glow":
      scale = 1 + Math.sin(t * 4) * 0.03;
      break;
  }
  const opening = verb === "open" ? ease((k + 0.2) / 0.8) : 0;
  const splitting = verb === "split" ? ease((k + 0.2) / 0.9) : 0;
  const collapsing = verb === "collapse" ? ease((k + 0.1) / 1.2) : 0;
  const damaged = m.state === "damaged" ? (c: string) => "#" + new THREE.Color(c).multiplyScalar(0.55).getHexString() : undefined;
  const top = bb.center.y + bb.size.y * 0.25;
  return (
    <group position={off.toArray()} rotation={rot} scale={scale}>
      <group position={[-bb.center.x, 0, -bb.center.z]}>
        {build.parts.map((part, i) => {
          const pa = { ...part };
          let extra: [number, number, number] = [0, 0, 0];
          let r: [number, number, number] = [0, 0, 0];
          if (opening && part.at[1] > top) {
            extra = [-bb.size.x * 0.15 * opening, bb.size.y * 0.35 * opening, 0];
            r = [0, 0, 0.9 * opening];
          }
          if (splitting) extra = [0, 0, Math.sign(part.at[2] - bb.center.z || (i % 2 ? 1 : -1)) * bb.size.z * 0.6 * splitting];
          if (collapsing) {
            const delay = (i % 5) * 0.08;
            const f = ease((collapsing - delay) / (1 - delay));
            extra = [Math.sin(i * 2.3) * bb.size.x * 0.3 * f, -part.at[1] * 0.85 * f, Math.cos(i * 1.7) * bb.size.z * 0.3 * f];
            r = [Math.sin(i) * f, 0, Math.cos(i) * 1.2 * f];
          }
          return (
            <group key={i} position={extra} rotation={r}>
              <PartMesh part={pa} look={look} spin={spin} tint={damaged ? damaged(part.color) : undefined} />
            </group>
          );
        })}
        {verb === "glow" ? <pointLight position={[bb.center.x, bb.center.y, bb.center.z]} intensity={6 + Math.sin(t * 4) * 3} distance={p.w * 6} color={build.accent} /> : null}
      </group>
      {m.state === "burning" || (verb === "crash" && k > 0) ? <Flames size={Math.max(p.h, p.w * 0.4)} t={t} look={look} /> : null}
    </group>
  );
};

const FoundModel: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = (props) => {
  const { p } = props;
  const { model } = useModel(p.m.model?.src);
  if (!model) return <Rigid {...props} />;
  return <Prepared {...props} loaded={model} />;
};

const Prepared: React.FC<{ p: Placed; look: Look; b: Blocking; world: World; loaded: Parameters<typeof prepare>[0] }> = ({ p, loaded, b }) => {
  const made = React.useMemo(() => prepare(loaded, p.m.model?.fit?.forward ?? "auto", p.m.model?.fit?.up ?? "+y"), [loaded, p.m.model]);
  // prepare() scales the largest side to 4 units; the design's size says how big it really is.
  const k = Math.max(0.05, p.m.build.size) / 4;
  const rot = p.m.verb === "fly" ? [Math.sin(b.t * 0.9) * 0.06, 0, 0] : [0, Math.sin(b.t * 0.4) * 0.1, 0];
  return (
    <group scale={k} rotation={rot as [number, number, number]}>
      <primitive object={made.root} />
    </group>
  );
};

const Actor: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = (props) => {
  const { p, look, b } = props;
  const { m } = p;
  const s = m.state;
  const one = (dt: number) => {
    const t = b.t + dt;
    const phase = p.phase + dt * 3.1;
    switch (m.build.archetype) {
      case "humanoid":
        return <Humanoid build={m.build} look={look} pose={humanPose(m.verb, t + p.yaw, phase, b.k, dimsOf(m.build), s)} t={t} state={s} held={dt ? undefined : m.held} />;
      case "quadruped":
        return <Quadruped build={m.build} look={look} pose={quadPose(m.verb, t + p.yaw, phase, b.k, quadDims(m.build), s)} t={t} state={s} />;
      case "bird":
        return <Bird build={m.build} look={look} verb={m.verb} t={t + p.yaw * 3} k={b.k} state={s} />;
      case "fish":
        return <Fish build={m.build} look={look} t={t} speed={p.speed} />;
      case "insect":
        return <Insect build={m.build} look={look} verb={m.verb} t={t} phase={phase} />;
      case "serpent":
        return <Serpent build={m.build} look={look} verb={m.verb} t={t} phase={phase + t * 2} />;
      case "cell":
        return <Cell build={m.build} look={look} verb={m.verb} t={t} k={b.k} />;
      default:
        return m.model?.src ? <FoundModel {...props} /> : <Rigid {...props} />;
    }
  };
  return (
    <group position={p.pos.toArray()} rotation={[0, p.yaw, 0]}>
      {groupOffsets(m, p.w0).map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          {one(i * 0.37)}
        </group>
      ))}
    </group>
  );
};

// Where each member of a flock, crowd or fleet stands relative to the first, in its own frame (x
// forward): a V behind the leader for things that fly or swim, a loose cluster for the rest.
const groupOffsets = (m: CastMember, w: number): [number, number, number][] => {
  const n = Math.max(1, Math.min(9, m.count ?? 1));
  const out: [number, number, number][] = [[0, 0, 0]];
  const flock = ["bird", "insect", "fish"].includes(m.build.archetype) || m.verb === "fly";
  for (let i = 1; i < n; i++) {
    const row = Math.ceil(i / 2);
    const side = i % 2 ? 1 : -1;
    if (flock) out.push([-row * w * 0.9, Math.sin(i * 1.7) * w * 0.25, side * row * w * 0.9]);
    else {
      const a = i * 2.4;
      const r = w * (1.1 + 0.35 * Math.sqrt(i));
      out.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
    }
  }
  return out;
};

// --- marks ------------------------------------------------------------------------------------------

const markColor = (world: World, c: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : world.style === "noir" ? "#ff4a3d" : world.set.accent || "#ffb02e");

const Marks: React.FC<{ world: World; b: Blocking; look: Look }> = ({ world, b, look }) => {
  const find = (id: string) => b.actors.find((p) => p.m.entity === id);
  return (
    <>
      {world.marks.map((mk, i) => {
        const a = find(mk.on);
        if (!a) return null;
        const color = markColor(world, mk.color);
        const grow = ease((b.u - 0.15 - i * 0.08) / 0.3);
        if (grow <= 0) return null;
        const top = a.pos.clone().add(new THREE.Vector3(0, a.h * 0.8, 0));
        switch (mk.kind) {
          case "beam":
          case "arrow": {
            const z = find(mk.to);
            if (!z) return null;
            const end = z.pos.clone().add(new THREE.Vector3(0, z.h * (mk.kind === "beam" ? 0.9 : 0.5), 0));
            const from = mk.kind === "arrow" ? a.pos.clone().add(new THREE.Vector3(0, a.h * 0.5, 0)) : top;
            const dir = end.clone().sub(from);
            const len = dir.length() * grow;
            const mid = from.clone().add(dir.clone().normalize().multiplyScalar(len / 2));
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            const pulse = from.clone().lerp(end, (b.t * 0.6) % 1);
            const r = b.U * (mk.kind === "beam" ? 0.035 : 0.05);
            return (
              <group key={i}>
                <mesh position={mid} quaternion={q} geometry={unit.cyl} material={material(look, color, { glow: true, opacity: 0.9 })} scale={[r * 2, len, r * 2]} />
                {mk.kind === "beam" && grow >= 1 ? <mesh position={pulse} geometry={unit.sphere} material={material(look, "#ffffff", { glow: true })} scale={r * 5} /> : null}
                {mk.kind === "arrow" ? (
                  <mesh position={from.clone().add(dir.clone().normalize().multiplyScalar(len))} quaternion={q} geometry={unit.cone} material={material(look, color, { glow: true })} scale={[r * 5, r * 7, r * 5]} />
                ) : null}
              </group>
            );
          }
          case "path": {
            const dots = 14;
            const start = world.cast.findIndex((c) => c.entity === mk.on);
            const pts = Array.from({ length: dots }, (_, j) => j / (dots - 1));
            const s0 = block(world, 0, 30, 2, 0.5).actors[start]?.pos ?? a.pos;
            const s1 = block(world, 1, 30, 2, 0.5).actors[start]?.pos ?? a.pos;
            return (
              <group key={i}>
                {pts.filter((f) => f <= grow).map((f, j) => (
                  <mesh key={j} position={[s0.x + (s1.x - s0.x) * f, 0.04, s0.z + (s1.z - s0.z) * f]} rotation={[-Math.PI / 2, 0, 0]} geometry={unit.disc} material={material(look, color, { glow: true, opacity: 0.85 })} scale={b.U * 0.12} />
                ))}
              </group>
            );
          }
          case "ring": {
            const k = 1 + ((b.t * 0.8) % 1) * 0.6;
            return <mesh key={i} position={[a.pos.x, 0.05, a.pos.z]} rotation={[-Math.PI / 2, 0, 0]} geometry={unit.ring} material={material(look, color, { glow: true, opacity: 0.8 })} scale={Math.max(a.w, b.U) * 0.8 * k * grow} />;
          }
          case "dome":
            return <mesh key={i} position={[a.pos.x, 0, a.pos.z]} geometry={unit.dome} material={material(look, color, { glow: true, wire: true, opacity: 0.55 })} scale={b.U * 3.2 * ease((b.u - 0.25) / 0.45)} />;
          case "glow":
            return (
              <group key={i} position={top.toArray()}>
                <pointLight intensity={8 * grow} distance={a.h * 4 + b.U * 2} color={color} />
                <mesh geometry={unit.sphere} material={material(look, color, { glow: true, opacity: 0.18 })} scale={Math.max(a.w, a.h) * 1.3} />
              </group>
            );
          default:
            return null;
        }
      })}
    </>
  );
};

const unit = {
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  sphere: new THREE.SphereGeometry(0.5, 12, 10),
  disc: new THREE.CircleGeometry(0.5, 12),
  ring: new THREE.RingGeometry(0.85, 1, 48),
  dome: new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
};

// --- the scene --------------------------------------------------------------------------------------

// Set dressing never stands between the camera and what it films: anything whose footprint comes near
// the line from the camera to its target, at the start, middle or end of the shot, is left out.
const keepOutOf = (world: World, fps: number, D: number, at: number, portrait: boolean): KeepOut => {
  const segs = [0, 0.5, 1].map((u) => {
    const b = block(world, Math.round(u * (D - 1)), fps, D, at);
    const cam = finalCamera(b, portrait, 9 / 16);
    return { a: cam.position.clone(), b: b.cam.look.clone() };
  });
  const actors = block(world, Math.round(at * (D - 1)), fps, D, at).actors.map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.w * 0.6 + 0.6 }));
  return (x, z, r, h) => {
    const pt = new THREE.Vector3(x, Math.min(h, 3) * 0.5, z);
    for (const s of segs) {
      const line = new THREE.Line3(s.a, s.b);
      const c = line.closestPointToPoint(pt, true, new THREE.Vector3());
      if (Math.hypot(c.x - x, c.z - z) < r + 1.2 && c.y < h + 1) return true;
    }
    return actors.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + r);
  };
};

const World3D: React.FC<{ world: World; b: Blocking; portrait: boolean; seed: number; keep: KeepOut }> = ({ world, b, portrait, seed, keep }) => {
  const { camera, gl } = useThree();
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  const look = lookOf(world.style);
  const light = lightOf(look, world.set, b.U);
  const back = 1.25;
  const p = portrait ? b.cam.look.clone().add(b.cam.pos.clone().sub(b.cam.look).multiplyScalar(back)) : b.cam.pos;
  camera.position.copy(p);
  camera.lookAt(b.cam.look);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = portrait ? b.cam.fov * 1.45 : b.cam.fov;
    camera.near = 0.05;
    camera.far = 4000;
    camera.updateProjectionMatrix();
  }
  const dist = p.distanceTo(b.cam.look);
  const S = Math.max(b.U * 14, dist * 1.2);
  const sun = new THREE.Vector3(...light.sunDir).normalize().multiplyScalar(S * 1.5).add(b.cam.look.clone().setY(0));
  const water = ["sea"].includes(world.set.kind);
  return (
    <>
      <fog attach="fog" args={[light.horizon, Math.max(light.fog[0], dist * 1.1 * look.fogScale), Math.max(light.fog[1], (dist * 4.5 + b.U * 14) * look.fogScale)]} />
      <hemisphereLight args={[light.amb, light.ground, light.ambI]} />
      <directionalLight position={sun.toArray()} target-position={b.cam.look.clone().setY(0).toArray()} intensity={light.sunI} color={light.sun} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-S} shadow-camera-right={S} shadow-camera-top={S} shadow-camera-bottom={-S} shadow-camera-far={S * 4} shadow-bias={-0.0004} />
      {look.dark > 0.5 || world.set.time === "night" ? <directionalLight position={[-b.U * 4, b.U * 3, -b.U * 10]} intensity={1.2} color="#9fc0ff" /> : null}
      {look.gloss ? <directionalLight position={[b.U * 6, b.U * 2, -b.U * 6]} intensity={1.4} color="#9ff0ff" /> : null}
      <Environment set={world.set} look={look} light={light} unit={b.U} seed={seed} t={b.t} keep={keep} />
      {b.actors.map((p, i) => (
        <group key={i} position={[0, water && !flies(p.m) ? -p.h * 0.18 : 0, 0]}>
          <Actor p={p} look={look} b={b} world={world} />
        </group>
      ))}
      <Marks world={world} b={b} look={look} />
      {VOID.includes(world.set.kind) ? <ambientLight intensity={0.25} /> : null}
    </>
  );
};

const Callouts: React.FC<{ world: World; b: Blocking; portrait: boolean; width: number; height: number; scale: number; font: string }> = ({ world, b, portrait, width, height, scale, font }) => {
  if (!world.callouts.length) return null;
  const cam = finalCamera(b, portrait, width / height);
  return (
    <>
      {world.callouts.map((c, i) => {
        const a = b.actors.find((p) => p.m.entity === c.on);
        if (!a) return null;
        const v = a.pos.clone().add(new THREE.Vector3(0, a.h * 1.12, 0)).project(cam);
        if (v.z > 1) return null;
        const x = Math.max(width * 0.22, Math.min(width * 0.78, ((v.x + 1) / 2) * width));
        const y = Math.max(height * 0.12, Math.min(height * 0.8, ((1 - v.y) / 2) * height));
        const o = ease((b.u - 0.12 - i * 0.12) / 0.08);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -100%) translateY(${(1 - o) * 14}px)`, opacity: o,
            display: "flex", alignItems: "center", gap: 10 * scale, background: "rgba(10,12,18,.82)", color: "#fff", padding: `${7 * scale}px ${15 * scale}px`,
            borderRadius: 40, fontFamily: font, fontWeight: 800, fontSize: 19 * scale, letterSpacing: 2, textTransform: "uppercase", whiteSpace: "nowrap" }}>
            <span style={{ width: 11 * scale, height: 11 * scale, borderRadius: 6 * scale, background: markColor(world, "") }} />
            {c.text}
          </div>
        );
      })}
    </>
  );
};

export const StoryWorldScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const world = scene.world as World;
  const short = format === "short";
  const at = momentOf(scene);
  const b = block(world, frame, fps, durationInFrames, at);
  const look = lookOf(world.style);
  const seed = (world.seed ?? 0) ^ [...(world.set.place || world.set.kind)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  const k = unitOf(format);
  const keep = React.useMemo(() => keepOutOf(world, fps, durationInFrames, at, short), [world, fps, durationInFrames, at, short]);
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      <ThreeCanvas width={width} height={height} camera={{ fov: 36, position: [8, 3, 8] }} gl={{ antialias: true }} shadows>
        <World3D world={world} b={b} portrait={short} seed={seed} keep={keep} />
      </ThreeCanvas>
      {look.tiltShift ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: height * 0.22, backdropFilter: "blur(5px)", WebkitMaskImage: "linear-gradient(black, transparent)", maskImage: "linear-gradient(black, transparent)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.22, backdropFilter: "blur(5px)", WebkitMaskImage: "linear-gradient(transparent, black)", maskImage: "linear-gradient(transparent, black)" }} />
        </>
      ) : null}
      {look.dark > 0.5 ? <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.45))" }} /> : null}
      <Callouts world={world} b={b} portrait={short} width={width} height={height} scale={k} font={theme.font} />
      <WeatherOverlay weather={scene.weather} seed={world.seed} night={world.set.time === "night"} />
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <HeadingPlate scene={scene} theme={theme} short={short} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * k, background: `linear-gradient(transparent, ${theme.background}88)` }} />
    </AbsoluteFill>
  );
};
