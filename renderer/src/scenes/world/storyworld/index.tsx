// The story world: a stage scene whose cast, place and direction were generated for this story
// (fyt/worldgen.py). The blocking (where everyone is, which way they face, how far they have walked) and
// the camera are pure functions of the frame, so the 3D scene and the labels pinned over it agree.
import React from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { unit as unitOf } from "../../../theme";
import type { SceneProps } from "../../shared";
import { HeadingPlate, WeatherOverlay } from "../../world3d";
import { Billow, Fireball, momentOf } from "../kit";
import { load as loadModel, type Loaded, prepare, ready } from "../stage";
import { Bird, Cell, Fish, Insect, Quadruped, quadDims, quadPose, Serpent } from "./creatures";
import { Airliner, Boat, Car, heroOf, Iceberg, LightPlane, Liner, Spray } from "./hero";
import { ContactShadow, type Finish, GroundGlow, Post, type SkySpec, SkyDome, SkyLight } from "./cinema";
import { Environment, INSIDE, type KeepOut, VOID, waterBand } from "./environment";
import { dimsOf, Flames, humanPose, Humanoid } from "./humanoid";
import { PartMesh, partsBounds } from "./parts";
import { clipsFor, KitPerson } from "./kit";
import { env, lightOf, type Look, lookOf, material, rigged } from "./style";
import type { Act, Build, CastMember, Spot, World } from "./types";
import { art, artToon, useArt } from "./artstyle";
import { HeldProp, perform, resetRig, rigOf, paint, type ActState } from "./actions";
import type { ShotCam } from "./layers";

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

// ride: how it rides with another (attached, not yet released); drop: 0-1 through its fall from what
// released it, >1 once landed; boom: seconds since it detonated (negative before)
type Placed = { m: CastMember; pos: THREE.Vector3; yaw: number; phase: number; speed: number; h: number; w: number; w0: number; air: number;
  ride?: string; hidden?: boolean; drop?: number; boom?: number; blast?: number; start?: THREE.Vector3 };
// (gu, gt, gs: how far through the whole scene, in 0-1 and seconds, and its length: the director's shots
// and acts are timed on the scene, not on a beat)
export type Blocking = { actors: Placed[]; cam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; setup: number; roll: number }; U: number; t: number; k: number; u: number;
  gu: number; gt: number; gs: number };

const flies = (m: CastMember) => m.verb === "fly" && ["vehicle", "bird", "insect"].includes(m.build.archetype);

// A directed scene plays in beats (fyt/worldgen.py's director). At each beat's cue the actors it names
// take up a new verb, place or state, starting from where the last beat left them, and the camera cuts
// to the beat's move. Returns the world as it stands in this frame's beat, with the beat's own frame,
// length and key moment, so blocking and camera treat each beat as a shot of its own.
export const segmentOf = (world: World, frame: number, D: number, at: number) => {
  const beats = (world.beats ?? []).filter((x) => x.from > 0.05 && x.from < 0.95).sort((a, b) => a.from - b.from);
  if (!beats.length) return { world, frame, D, at, i: 0 };
  const u = frame / Math.max(1, D - 1);
  let i = 0;
  while (i < beats.length && u >= beats[i].from) i++;
  if (i === 0) {
    // the opening beat ends at the first cue
    const end = beats[0].from;
    return { world, frame, D: Math.max(2, Math.round(end * (D - 1)) + 1), at: at < end ? at / end : 0.5, i };
  }
  let cast = world.cast;
  let camera = world.camera;
  let on = world.on;
  for (const [j, bt] of beats.slice(0, i).entries()) {
    cast = cast.map((c) => {
      const o = bt.cast.find((x) => x.entity === c.entity);
      const from = (c.to || c.at) as Spot; // where the last beat left it
      // released at this beat: it leaves what it rode with and falls from it in this beat; in a later
      // beat it is where it landed
      const rel = o?.release && c.attached ? { attached: "", released: c.attached, dropNow: j === i - 1 } : { dropNow: false };
      return o ? { ...c, at: from, to: o.to ?? "", verb: o.verb || c.verb, state: o.state || c.state, face: o.face ?? c.face, ...rel }
        : { ...c, at: from, to: "", dropNow: false };
    });
    camera = bt.camera || camera;
    on = bt.on && cast.some((c) => c.entity === bt.on) ? bt.on : on;
  }
  const from = beats[i - 1].from;
  const to = i < beats.length ? beats[i].from : 1;
  const start = Math.round(from * (D - 1));
  const len = Math.max(2, Math.round(to * (D - 1)) - start + 1);
  const local = at >= from && at < to ? (at - from) / (to - from) : 0.3;
  // a mark plans the setup; once a beat plays the action itself, it would only cover it
  return { world: { ...world, cast, camera, on, marks: [] }, frame: frame - start, D: len, at: local, i };
};

// Where everyone is and where the camera is at this frame.
export const block = (w0: World, frame: number, fps: number, D: number, at: number, portrait = false, g?: { u: number; t: number; s: number }): Blocking => {
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
  // what rides on something, or was let go from it, is placed from its carrier, not on the ground
  const carried = (m: CastMember) => Boolean(m.attached || m.released);
  const ground = world.cast.filter((m) => !flies(m) && !carried(m));
  const U = Math.max(1.1, ...ground.map((m) => footprint(m.build).w * 0.9), ...(ground.length ? [] : sizes.map((s) => s.w * 0.6)));
  const used = new Map<string, number>();
  const starts = world.cast.map((m, i) => {
    const { w } = sizes[i];
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
    return start;
  });
  const placed: Placed[] = world.cast.map((m, i) => {
    const { w, h } = sizes[i];
    const start = starts[i].clone();
    // what a crash runs into, wherever it was told to go: who it faces, else the first other thing on the ground
    const hit = m.verb === "crash" && !flies(m)
      ? world.cast.findIndex((c, j) => j !== i && !flies(c) && (m.face ? c.entity === m.face : true)) : -1;
    let end = start.clone();
    if (hit >= 0) {
      // up to it, bows touching: the gap between their centres closed to their two half-lengths
      const dir = starts[hit].clone().sub(start);
      const reach = Math.max(0, dir.length() - (w / 2 + sizes[hit].w / 2) * 0.85);
      end = start.clone().add(dir.normalize().multiplyScalar(reach));
    } else if (m.to && m.to !== m.at) {
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
    return { m, pos, yaw, phase, speed, h, w: w * (1 + 0.9 * Math.sqrt(many - 1)), w0: w, air, start: start.clone() };
  });
  carry(placed, D / fps, t, U);
  // on open water, people and animals stand on something afloat, never on the water: the ice floe at an
  // iceberg's foot, else the deck of a boat or a ditched airliner
  if (waterBand(world.set.kind) || world.set.kind === "sea") {
    const ice = placed.find((p) => p.m.build.form === "iceberg");
    const deck = placed.find((p) => p.m.build.archetype === "vehicle" && !flies(p.m) && p.m.verb !== "drive");
    const walkers = placed.filter((p) => ["humanoid", "quadruped"].includes(p.m.build.archetype) && !["swim", "fly"].includes(p.m.verb));
    const going = new Set<Placed>();
    walkers.forEach((p, n) => {
      const spread = (n - (walkers.length - 1) / 2);
      if (ice) {
        // the floe runs out in front of the berg (its own +z): side by side on it, a few paces apart,
        // walking along it
        const gap = Math.max(...walkers.map((q) => q.w0)) * 1.1 + 0.8;
        const fz = ice.w0 * 0.36, walked = (p.pos.x - starts[placed.indexOf(p)].x) * 0.5;
        const c = Math.cos(ice.yaw), s = Math.sin(ice.yaw);
        const lx = spread * gap + walked;
        p.pos.set(ice.pos.x + lx * c + fz * s, iceLedge(ice.h), ice.pos.z - lx * s + fz * c);
      } else if (deck) {
        const c = Math.cos(deck.yaw), s = Math.sin(deck.yaw);
        const liner = deck.m.build.form === "liner";
        // on a liner, the open foredeck ahead of the bridge, clear of the funnels and their smoke
        const gap = Math.max(...walkers.map((q) => q.w0)) * 0.9 + 0.6;
        // (in the liner's own length: its footprint w0 is wider than the hull, and the bow narrows)
        const L = deck.m.build.size;
        // one walking goes along the deck (forward, as far as the deck runs), not on the spot
        const walked = Math.abs(p.pos.x - starts[placed.indexOf(p)].x) * 0.5;
        const along = liner ? Math.max(0.2 * L, Math.min(0.43 * L, LINER_FOREDECK * L + spread * gap - Math.min(walked, 0.12 * L) + (walked > 0 ? 0.06 * L : 0))) : spread * 0.12 * deck.w0 + walked;
        if (walked > 0) {
          p.yaw = deck.yaw + (liner ? Math.PI : 0);
          going.add(p);
        }
        const across = (n % 2 ? 1 : -1) * (liner ? 0.008 * L : 0.02 * deck.w0);
        // (a hull afloat is drawn settled into the water by h * 0.18, see Scene; its deck with it)
        const up = (liner ? deck.m.build.size * 0.077 : deck.h * 0.28) - (world.set.kind === "sea" && deck.pos.y <= 0 ? deck.h * 0.18 : 0);
        p.pos.set(deck.pos.x + along * c + across * s, deck.pos.y + up, deck.pos.z - along * s + across * c);
      } else return;
      p.air = 0;
    });
    // aboard or on the floe, those standing their ground face one another, not out to sea
    walkers.forEach((p) => {
      if (going.has(p) || ["walk", "run", "flee", "chase"].includes(p.m.verb) || p.m.face) return;
      const o = walkers.filter((q) => q !== p).sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
      if (o) p.yaw = Math.atan2(-(o.pos.z - p.pos.z), o.pos.x - p.pos.x);
    });
  }
  const G = g ?? { u, t, s: D / fps };
  return { actors: placed, cam: direct(world, placed, u, t, U, D, fps, at, portrait, G.u), U, t, k, u, gu: G.u, gt: G.t, gs: G.s };
};

// The Animation Director's attachments (fyt/animation.py). A thing attached to another rides with it:
// under it (a bomb under its aircraft), inside it (unseen), on top, or held. Once a beat releases it, it
// falls from where its carrier was when the beat began, keeping the carrier's forward speed and
// accelerating down, so it traces an arc and lands ahead of where it was let go; an explosive detonates
// where it lands. In a later beat it is where it landed. `secs` is the beat's length, `t` the time in it.
const FALL_MIN = 1.4;
const FALL_MAX = 3.2;
export const carry = (placed: Placed[], secs: number, t: number, U: number) => {
  const by = new Map(placed.map((p) => [p.m.entity, p]));
  for (const p of placed) {
    const parent = by.get(p.m.attached || p.m.released || "");
    if (!parent || parent === p) continue;
    const fwd = new THREE.Vector3(Math.cos(parent.yaw), 0, -Math.sin(parent.yaw));
    if (p.m.attached) {
      p.ride = p.m.mount || "under";
      p.yaw = parent.yaw;
      p.hidden = p.ride === "inside";
      const bob = parent.m.verb === "fly" ? Math.sin(t * 1.1) * parent.h * 0.05 : 0;
      const y = p.ride === "on" ? parent.pos.y + parent.h * 0.62 : p.ride === "held" ? parent.pos.y + parent.h * 0.45 : parent.pos.y + parent.h * 0.02 - p.h;
      p.pos.set(parent.pos.x, y + bob, parent.pos.z);
      if (p.ride === "held") p.pos.add(new THREE.Vector3(Math.sin(parent.yaw), 0, Math.cos(parent.yaw)).multiplyScalar(parent.w0 * 0.25));
      p.air = Math.max(0, p.pos.y);
      continue;
    }
    // released: from under where the carrier was as the beat began, to the ground ahead of it
    const from = (parent.start ?? parent.pos).clone();
    from.y = parent.air ? parent.air + parent.h * 0.02 - p.h : parent.h * 0.5;
    const T = Math.min(FALL_MAX, Math.max(FALL_MIN, secs * 0.6));
    // (by the carrier's length, not its speed this frame, so the landing point holds still)
    const reach = parent.w0 * (parent.air ? 1.2 : 0.4);
    const land = from.clone().add(fwd.clone().multiplyScalar(reach)).setY(0);
    const s = p.m.dropNow ? Math.min(1, t / T) : 1;
    p.drop = p.m.dropNow ? t / T : 2;
    p.yaw = parent.yaw;
    p.pos.set(from.x + (land.x - from.x) * s, Math.max(0, from.y) * (1 - s * s), from.z + (land.z - from.z) * s);
    p.air = p.pos.y;
    if (p.m.impact === "explode" || p.m.verb === "explode") {
      const since = p.m.verb === "explode" && !p.m.dropNow ? t - 0.15 : t - T;
      p.boom = since;
      p.blast = Math.max(p.w0 * 1.6, U * 1.4);
      if (since > 0.08) {
        p.hidden = true;
        // framed as the blast it has become: the camera pulls back to take it in
        p.w = p.blast * 2.2;
        p.h = p.blast * 1.6;
      }
    }
  }
  // a thing told to explode where it stands (a building, a vehicle)
  for (const p of placed) {
    if (p.boom !== undefined || p.m.verb !== "explode") continue;
    p.boom = t - 0.15;
    p.blast = Math.max(p.w0 * 1.2, U * 1.2);
    if (p.boom > 0.08) {
      p.hidden = true;
      p.w = p.blast * 2.2;
      p.h = p.blast * 1.6;
    }
  }
};

// The height of the flat floe at an iceberg's foot (hero.tsx Iceberg), for an iceberg h tall.
export const iceLedge = (h: number) => h * 0.06;
// where along a liner (from its middle, in lengths) its open foredeck is (hero.tsx Liner)
const LINER_FOREDECK = 0.35;

// Portrait frames pull back a little and widen the lens to keep the subject in a tall frame.
const PORTRAIT_BACK = 1.0;
const PORTRAIT_FOV = 1.32;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const hashOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// The setups a shot is covered from. The asked-for move opens the shot; a long shot cuts once, on the
// beat, to a contrasting setup (wide answers close, low answers high), so a held scene never just sits
// under changing captions. Every setup moves (dolly, arc or crane), eased in and out.
const COVER: Record<string, string> = {
  establish: "hero", follow: "low_angle", orbit: "close", push_in: "reveal", low_angle: "close", over_shoulder: "close",
  top_down: "hero", reveal: "close", static: "close",
};

type Setup = { move: string; from: number; to: number; on?: string; from_?: string; prop?: string };
export const setupsOf = (world: World, D: number, fps: number, at: number): Setup[] => {
  // the scene director's shot list (fyt/director.py plan_camera), each held until the next one's cue
  const shots = world.direction?.shots ?? [];
  if (shots.length) return shots.map((sh, i) => ({ move: sh.move, from: i ? sh.from ?? 0 : 0, to: shots[i + 1]?.from ?? 1, on: sh.on, from_: sh.from_, prop: sh.prop }));
  const secs = D / fps;
  const first = world.camera || "static";
  if (secs < 4.2) return [{ move: first, from: 0, to: 1 }];
  const cut = Math.min(0.62, Math.max(0.42, at - 0.06));
  return [{ move: first, from: 0, to: cut }, { move: COVER[first] ?? "close", from: cut, to: 1 }];
};

const direct = (world: World, placed: Placed[], u: number, t: number, U0: number, D = 150, fps = 30, at = 0.5, portrait = false, gu = u) => {
  const setups = setupsOf(world, D, fps, at);
  const su = world.direction?.shots?.length ? gu : u;
  const k = Math.max(0, setups.findIndex((s) => su >= s.from && su <= s.to + 1e-6));
  const sh = setups[k];
  const on = placed.find((p) => p.m.entity === (sh.on || world.on)) ?? placed.find((p) => p.m.entity === world.on) ?? placed[0];
  // the stage's unit is set by its largest thing; a person beside an iceberg is framed at a person's scale
  const U = Math.min(U0, Math.max(on.w, on.h) * 2.5);
  // a subject lying down (asleep, fallen, dead) is low: aim at it there, not at where its head was standing
  const lying = LIES.test(on.m.verb ?? "") && on.m.build.archetype !== "vehicle";
  const look = on.pos.clone().add(new THREE.Vector3(0, on.h * (lying ? 0.22 : 0.55), 0));
  // fit the subject and whoever shares its frame, across and up, in the frame the viewer will see
  const own = Math.max(on.w, on.h) * 0.62 + U * 0.25;
  let Rw = on.w * 0.55 + U * 0.2;
  let Rh = on.h * 0.55 + U * 0.2;
  placed.forEach((p) => {
    if (p !== on && Math.abs(p.pos.y - on.pos.y) < U * 3) {
      Rw = Math.max(Rw, Math.hypot(p.pos.x - on.pos.x, p.pos.z - on.pos.z) * 0.8 + p.w * 0.5);
      Rh = Math.max(Rh, Math.abs(p.pos.y - on.pos.y) + p.h * 0.6);
    }
  });
  // others share the frame, but never shrink the subject to a speck; a tall frame keeps the subject
  // large and lets the rest run off its sides
  Rw = Math.min(Rw, portrait ? Math.max(on.w * 0.55 + U * 0.2, own * 1.15) : own * 1.7);
  // a long low subject (a ship, a train) in a tall frame is filmed from off its bow, where it has depth
  // and fills the frame, not side-on as a thin strip across the middle
  const long = portrait && on.w > on.h * 2.2 && !["humanoid", "quadruped"].includes(on.m.build.archetype);
  // (a crash keeps what it runs into in the frame)
  if (long && on.m.verb !== "crash") Rw = Math.min(Rw, on.w * 0.55 * 0.62 + U * 0.2);
  Rh = Math.min(Rh, own * 1.7);
  const fov = 36 * art.profile.fov;
  const tanV = Math.tan((((portrait ? fov * PORTRAIT_FOV : fov) / 2) * Math.PI) / 180);
  const tanH = tanV * (portrait ? 9 / 16 : 16 / 9);
  let d = Math.max(Rh / tanV, Rw / tanH) * (portrait ? 1.0 / PORTRAIT_BACK : 1) * 1.05;
  const inside = INSIDE.includes(world.set.kind) && world.set.kind !== "cave";
  // on its side, its legs reach out across the ground by its standing height: stand further back
  if (lying) d *= 1.25;
  if (inside) d = Math.min(d, U * 3.6);
  const lu = (su - sh.from) / Math.max(1e-3, sh.to - sh.from);
  const e = smooth(lu);
  // which side a scene is filmed from varies with the scene, so consecutive shots of one place differ
  const hand = (hashOf(`${world.on}|${world.camera}|${world.seed ?? 0}|${world.set.place ?? ""}`) & 1 ? 1 : -1) * (k % 2 === 1 ? -1 : 1);
  const fwd = new THREE.Vector3(Math.cos(on.yaw), 0, -Math.sin(on.yaw));
  const across = new THREE.Vector3(Math.sin(on.yaw), 0, Math.cos(on.yaw));
  const side = (a: number, dist: number, y: number) => {
    if (!long) return new THREE.Vector3(Math.sin(a * hand) * dist, y, Math.cos(a * hand) * dist);
    // in the subject's own frame: a quarter of the way round from its beam towards its bow, and low
    const b = 0.62 + a * 0.45;
    return fwd.clone().multiplyScalar(Math.sin(b) * dist).add(across.clone().multiplyScalar(Math.cos(b) * dist * hand)).setY(Math.min(y, on.h * 0.9 + dist * 0.12));
  };
  let off: THREE.Vector3;
  let target = look.clone();
  let f = fov;
  // a ground-level or close move on a subject lying down ran into its legs: look down on it from a
  // three-quarter view instead, drifting round it
  const move = lying && ["low_angle", "close", "hero", "follow"].includes(sh.move) ? "lying" : sh.move;
  switch (move) {
    case "lying":
      off = side(0.5 - 0.2 * e, d * (1.1 - 0.08 * e), on.h * 0.8 + d * 0.32);
      break;
    case "establish":
      off = side(0.55 - 0.25 * e, d * (1.45 - 0.5 * e) * (long ? 0.8 : 1), d * (0.6 - 0.38 * e) + on.h * 0.3);
      break;
    case "follow":
      off = side(0.2 + 0.15 * e, d * (1.0 - 0.1 * e), on.h * 0.35 + d * 0.1);
      target = look.clone().add(new THREE.Vector3(on.w * 0.15, 0, 0));
      break;
    case "orbit":
      off = side(-0.6 + e * 1.3, d * 1.0, on.h * 0.4 + d * 0.16);
      break;
    case "push_in":
      off = side(0.38 - 0.12 * e, d * (1.3 - 0.5 * e), on.h * 0.3 + d * 0.12 * (1 - e));
      break;
    case "low_angle":
      off = side(0.7 - 0.3 * e, d * (0.85 - 0.08 * e), Math.max(0.2, on.h * 0.06));
      target = look.clone().add(new THREE.Vector3(0, on.h * 0.25, 0));
      break;
    case "hero":
      // the subject large against the sky: low, slow crane up
      off = side(-0.35 + 0.2 * e, d * 0.9, on.h * (0.05 + 0.5 * e));
      target = look.clone().add(new THREE.Vector3(0, on.h * 0.15, 0));
      break;
    case "over_shoulder": {
      // over the shoulder of whoever the subject is dealing with: a living one before the ship or set
      // they are standing on, whose 'shoulder' is a hull's length away
      const near = placed.filter((p) => p !== on && Math.abs(p.pos.y - on.pos.y) < U * 3);
      const other = near.find((p) => p.m.entity === sh.from_) ?? near.find((p) => LIVING_ARCH.includes(p.m.build.archetype)) ?? near.find((p) => Math.max(p.w, p.h) < U * 2);
      if (other) {
        // just behind and beside their head, close enough that their shoulder frames the shot
        const back = other.pos.clone().sub(on.pos).setY(0).normalize();
        const beside = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(hand * other.w * (0.35 + 0.1 * e));
        const pos = other.pos.clone().add(back.multiplyScalar(other.w * 0.55 + U * (0.35 - 0.1 * e))).add(beside).add(new THREE.Vector3(0, other.h * 0.95, 0));
        return { pos, look, fov: fov - 6, setup: k, roll: 0 };
      }
      off = side(0.3 + 0.2 * e, d * (1 - 0.12 * e), on.h * 0.4);
      break;
    }
    case "track":
      // a dolly alongside the subject as it goes, a little ahead of it and level with it, so whichever
      // way it walks it is seen three-quarters from the front
      off = across.clone().multiplyScalar(hand * d * 0.85).add(fwd.clone().multiplyScalar(d * (0.45 - 0.1 * e))).setY(on.h * 0.4 + d * 0.06);
      target = look.clone().add(fwd.clone().multiplyScalar(on.w * 0.25));
      break;
    case "insert": {
      // close on the hands and what they hold (a camera at the eye), from in front and to the side
      const tgt = on.pos.clone().add(new THREE.Vector3(0, on.h * 0.84, 0)).add(fwd.clone().multiplyScalar(on.h * 0.08));
      const a = Math.atan2(fwd.x, fwd.z) + hand * (0.75 - 0.15 * e);
      const di = on.h * (0.95 - 0.12 * e);
      off = new THREE.Vector3(Math.sin(a) * di, -on.h * 0.04, Math.cos(a) * di);
      target = tgt;
      f = fov - 6;
      break;
    }
    case "reaction":
    case "close": {
      // on the side the subject faces, drifting across it: a person head and shoulders, anything else
      // its front half (a reaction: tighter, and pushing in)
      const tight = move === "reaction" ? 0.82 - 0.08 * e : 1.05 - 0.08 * e;
      const person = on.m.build.archetype === "humanoid";
      const front = Math.atan2(Math.cos(on.yaw), -Math.sin(on.yaw)) + hand * (0.5 - 0.3 * e);
      const span = person ? on.h * 0.48 : Math.max(on.h, on.w * 0.6) * 0.6;
      const dc = (span / tanV) * tight;
      off = new THREE.Vector3(Math.sin(front) * dc, person ? 0 : on.h * 0.15 + dc * 0.08, Math.cos(front) * dc);
      target = person ? on.pos.clone().add(new THREE.Vector3(0, on.h * 0.72, 0)) : look.clone().add(new THREE.Vector3(Math.cos(on.yaw) * on.w * 0.15, on.h * 0.05, -Math.sin(on.yaw) * on.w * 0.15));
      break;
    }
    case "top_down":
      off = new THREE.Vector3(d * 0.05, d * (1.55 - 0.25 * e), d * 0.35);
      break;
    case "aerial": {
      if (inside) {
        off = side(0.55 - 0.25 * e, d * (1.45 - 0.5 * e), d * (0.6 - 0.38 * e) + on.h * 0.3);
        break;
      }
      // a drone high over the whole place, a quarter turn round it as it sinks towards the subject, ending
      // near the usual framing so the subject is never left a speck in the middle of the place
      const far = d * (portrait ? 2.2 : 2.8) * (1 - 0.55 * e) * (long ? 0.85 : 1);
      off = side(-0.5 + 0.9 * e, far, far * (0.62 - 0.12 * e));
      f = fov + 6 * (1 - e);
      break;
    }
    case "reveal":
      off = side(-0.2 + 0.5 * e, d * (0.6 + 0.7 * e), on.h * (0.25 + 0.9 * e) + d * 0.25 * e);
      break;
    default:
      off = side(0.4 - 0.2 * e, d * (1.08 - 0.15 * e), on.h * 0.35 + d * 0.12);
  }
  const pos = target.clone().add(off);
  pos.y = Math.max(pos.y, 0.25);
  // a slow hand-held breath on top of the move
  pos.x += Math.sin(t * 0.5) * d * 0.01;
  pos.y += Math.sin(t * 0.37 + 1) * d * 0.006;
  // the profile's dutch angle on the dramatic setups
  const roll = ["low_angle", "reveal", "insert", "reaction"].includes(move) ? art.profile.dutch * hand : 0;
  return { pos, look: target, fov: f, setup: k, roll };
};

// The camera exactly as aim() in kit.tsx places it, for projecting labels.
export const finalCamera = (b: Blocking, portrait: boolean, aspect: number) => {
  const pos = portrait ? b.cam.look.clone().add(b.cam.pos.clone().sub(b.cam.look).multiplyScalar(PORTRAIT_BACK)) : b.cam.pos.clone();
  const cam = new THREE.PerspectiveCamera(portrait ? b.cam.fov * PORTRAIT_FOV : b.cam.fov, aspect, 0.1, 3000);
  cam.position.copy(pos);
  cam.lookAt(b.cam.look);
  cam.rotateZ(b.cam.roll);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
};

// --- actors -----------------------------------------------------------------------------------------

// How a rigid thing moves as a whole for its verb: offset, turn and scale (a ship listing as it sinks,
// a crate dropping, a craft shaking on impact). Shared by the generated builds and found models.
const rigidPose = (p: Placed, b: Blocking, vehicle: boolean) => {
  const verb = p.m.verb;
  const { t, k } = b;
  let rot: [number, number, number] = [0, 0, 0];
  const off = new THREE.Vector3();
  let scale = 1;
  // riding with its carrier it is held still in its frame; falling from it, its nose drops as it goes
  if (p.ride) return { rot, off, scale };
  if (p.drop !== undefined) return { rot: [0, 0, -Math.min(1, p.drop) * 0.9] as [number, number, number], off, scale };
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
      rot = vehicle ? [0.25 * ease((k + 1.2) / 1.2), 0, -0.35 * ease((k + 1.2) / 1.2)] : [ease((k + 0.4) / 0.5) * 1.2, 0, ease((k + 0.4) / 0.5) * 0.4];
      break;
    case "sink": {
      // bow first and listing, settling until the stern stands out of the water
      const s = ease((k + 0.6) / 3.2);
      rot = [0.12 * s, 0, -0.5 * s];
      off.y = -p.h * 0.7 * s;
      break;
    }
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
  return { rot, off, scale };
};

const Rigid: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = ({ p, look, b, world }) => {
  const { m } = p;
  const build = m.build;
  const bb = partsBounds(build.parts);
  const verb = m.verb;
  const { t, k } = b;
  const spin = (p.phase / Math.PI) * 2 + (verb === "fly" ? t * 40 : 0);
  const { rot, off, scale } = rigidPose(p, b, build.archetype === "vehicle");
  const opening = verb === "open" ? ease((k + 0.2) / 0.8) : 0;
  const splitting = verb === "split" ? ease((k + 0.2) / 0.9) : 0;
  const collapsing = verb === "collapse" ? ease((k + 0.1) / 1.2) : 0;
  const damaged = m.state === "damaged" ? (c: string) => "#" + new THREE.Color(c).multiplyScalar(0.55).getHexString() : undefined;
  const top = bb.center.y + bb.size.y * 0.25;
  const hero = heroOf(build);
  const wet = world.set.kind === "sea" || Boolean(waterBand(world.set.kind));
  const night = world.set.time === "night" ? 1 : world.set.time === "dusk" ? 0.6 : 0;
  // a hull striking something on the water throws up spray, it doesn't catch fire
  const impact = verb === "crash" && k > 0 && wet && m.state !== "burning";
  if (hero && !opening && !splitting && !collapsing) {
    const hurt = m.state === "damaged" || m.state === "burning" || verb === "fall" ? 1 : 0;
    if (hero === "iceberg")
      return (
        <group position={off.toArray()} rotation={rot} scale={scale}>
          <Iceberg w={bb.size.x} h={p.h} d={bb.size.z} seed={(p.phase * 1000) | 0} ledge={iceLedge(p.h)} />
        </group>
      );
    return (
      <group position={off.toArray()} rotation={rot} scale={scale}>
        {impact ? <Spray at={[p.w0 * 0.48, 0, 0]} size={Math.max(p.h, p.w0 * 0.25)} k={k} /> : null}
        <group position={[-bb.center.x, 0, -bb.center.z]}>
          {hero === "liner" ? <Liner build={build} t={t} moving={MOVING.includes(verb) || verb === "present"} wet={wet} night={night} /> : null}
          {hero === "plane" ? <LightPlane build={build} t={t} spin={verb === "fly" || verb === "fall" ? t * 45 : 0} damaged={hurt} /> : null}
          {hero === "airliner" ? <Airliner build={build} t={t} spin={verb === "fly" && !hurt ? t * 30 : t * 3} damaged={hurt} /> : null}
          {hero === "boat" ? <Boat build={build} t={t} moving={MOVING.includes(verb) || verb === "present"} wet={wet} /> : null}
          {hero === "car" || hero === "truck" ? <Car build={build} spin={spin} truck={hero === "truck"} look={look} /> : null}
        </group>
        {m.state === "burning" || (verb === "crash" && k > 0 && !impact) ? <Flames size={Math.max(p.h, p.w * 0.4)} t={t} look={look} /> : null}
      </group>
    );
  }
  return (
    <group position={off.toArray()} rotation={rot} scale={scale}>
      {impact ? <Spray at={[p.w0 * 0.48, 0, 0]} size={Math.max(p.h, p.w0 * 0.25)} k={k} /> : null}
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
      {m.state === "burning" || (verb === "crash" && k > 0 && !impact) ? <Flames size={Math.max(p.h, p.w * 0.4)} t={t} look={look} /> : null}
    </group>
  );
};

// The scene's found models, loaded before its canvas is drawn (useCastModels): a model whose loading
// finished inside the canvas would miss the frame being captured.

const kitSrcs = (world: World) =>
  world.kit && world.cast.some((c) => c.build.archetype === "humanoid") ? [world.kit.bodies.m, world.kit.bodies.f, ...world.kit.clips, ...Object.values(world.kit.hair ?? {})].filter((x): x is string => Boolean(x)) : [];

const useCastModels = (world: World) => {
  const pieces = lookOf(world.style).blocky ? [] : Object.values(world.set.pieces ?? {}).flat();
  const srcs = [...new Set([...world.cast.map((c) => c.model?.src), ...kitSrcs(world), ...pieces].filter((x): x is string => Boolean(x)))].sort();
  const key = srcs.join("|");
  const [done, setDone] = React.useState(() => srcs.every((s) => ready.has(s)));
  const [handle] = React.useState(() => (done ? null : delayRender(`loading models ${key}`, { timeoutInMilliseconds: 120000 })));
  React.useEffect(() => {
    if (done) return;
    Promise.allSettled(srcs.map((s) => loadModel(s).then((m) => ready.set(s, m)))).then((rs) => {
      rs.forEach((r, i) => r.status === "rejected" && console.error(`model ${srcs[i]} failed to load: ${r.reason}`));
      setDone(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  React.useEffect(() => {
    if (done && handle !== null) continueRender(handle);
  }, [done, handle]);
  return done;
};

const FoundModel: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = (props) => {
  const { p } = props;
  const model = p.m.model?.src ? ready.get(p.m.model.src) : undefined;
  if (!model) return <Rigid {...props} />;
  return <Prepared {...props} loaded={model} />;
};

// Which of a found model's own clips plays for a verb: the first whose name fits, in order of preference.
const CLIPS: [RegExp, RegExp[]][] = [
  [/^(run|charge|chase|flee|gallop)$/, [/run|gallop|sprint|charge/i, /trot|walk|move|locomot/i]],
  [/^(walk|carry|approach|depart|move|climb|wander|patrol|follow)$/, [/walk|trot|move|locomot/i, /run|gallop/i]],
  [/^swim$/, [/swim/i, /move|loop/i]],
  [/^fly$/, [/fly|flap|glide|hover/i]],
  [/^(attack|fight|bite|strike|pounce|hunt|roar|threaten)$/, [/attack|bite|swipe|hit|roar|punch|strike/i, /run|gallop/i]],
  [/^(eat|feed|graze|drink)$/, [/eat|graze|drink|feed/i, /idle/i]],
  [/^(sleep|rest|lie|sit|die|asleep)$/, [/sleep|rest|lie|sit|death|die/i, /idle/i]],
  [/^(wave|point|signal|call|shout|warn|cheer|greet)$/, [/wave|greet|cheer/i, /idle|stand/i]],
  [/^(work|fix|repair|build|pick_up|open|use)$/, [/interact|work|use/i, /idle|stand/i]],
  [/.*/, [/idle|stand|breath|look|wait|survey|rest/i]],
];
export const clipFor = (names: string[], verb: string) => {
  const ways = (CLIPS.find(([v]) => v.test(verb)) ?? CLIPS[CLIPS.length - 1])[1];
  for (const w of ways) {
    const i = names.findIndex((n) => w.test(n));
    if (i >= 0) return i;
  }
  return -1;
};

const Prepared: React.FC<{ p: Placed; look: Look; b: Blocking; world: World; loaded: Parameters<typeof prepare>[0] }> = ({ p, loaded, b, look, world }) => {
  const act = world.direction?.acts?.[p.m.entity];
  const made = React.useMemo(
    () => {
      // (an inked or printed profile draws found models in its own flat bands, with ink outlines)
      const it = prepare(loaded, p.m.model?.fit?.forward ?? "auto", p.m.model?.fit?.up ?? "+y", look.toon || artToon() ? null : { envMap: env.map, intensity: env.intensity * 1.2 });
      if (p.m.build.archetype === "humanoid") tone(it.root, p.m.build);
      if (act?.paint) paint(it.root, act.paint);
      return it;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, p.m.model, look.toon, art.profile.name, act?.paint],
  );
  const living = LIVING_ARCH.includes(p.m.build.archetype);
  const spinners = React.useMemo(() => (living ? [] : spinningParts(made.root)), [made, living]);
  // a living thing plays its own clip for what it is doing, in step with the frame
  const clip = living ? clipFor(loaded.clips.map((c) => c.name), p.m.verb) : -1;
  const mixer = React.useMemo(() => {
    if (clip < 0) return null;
    const mx = new THREE.AnimationMixer(made.animated);
    const a = mx.clipAction(loaded.clips[clip]);
    // a fall, a blow or a gesture happens once and holds, rather than repeating
    if (ONCE.test(loaded.clips[clip].name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.play();
    return mx;
  }, [made, loaded, clip]);
  // a rigged library animal (rig-model.mjs) records how much ground each of its gaits covers, as a share
  // of its largest side: its walk is played at the pace it actually moves, so its feet don't slide
  const gait = (loaded.scene.userData?.gait ?? {}) as Record<string, number>;
  const natural = clip >= 0 ? (gait[loaded.clips[clip].name] ?? 0) * Math.max(0.05, p.m.build.size) : 0;
  const pace = natural > 0 && p.speed > 0.05 ? Math.min(2, Math.max(0.5, p.speed / natural)) : 1;
  const time = (b.t + p.phase * 0.3) * pace;
  if (mixer) mixer.setTime(time);
  const spot = useActs(made.root, act, p, b, world, () => mixer?.setTime(time));
  // prepare() scales the largest side to 4 units; the design's size says how big it really is.
  const k = Math.max(0.05, p.m.build.size) / 4;
  // a still library animal is moved as a whole when it has no clip for the verb, and laid on its side
  // when it falls or sleeps (a rigged one breathing in its sleep clip as it lies there)
  const posed = living && Boolean(p.m.model?.posed) && (clip < 0 || LIES.test(p.m.verb) || p.m.state === "asleep");
  const { rot, off, scale } = posed
    ? stillPose(p, b, made.size.y * k, made.size.z * k)
    : living ? { rot: [0, 0, 0] as [number, number, number], off: new THREE.Vector3(), scale: 1 } : rigidPose(p, b, p.m.build.archetype === "vehicle");
  // wheels roll as far as the vehicle travels; propellers and rotors turn while it flies or moves
  const going = p.speed > 0.05 || /fly|drive|move|race|approach|depart|chase|flee/.test(p.m.verb);
  for (const sp of spinners) {
    // (a windmill's sails turn slowly while it just stands there)
    const angle = sp.wheel ? (p.speed * (b.t + p.phase)) / Math.max(1e-3, sp.radius * k) : (b.t + p.phase) * (going ? 38 : 1.6);
    sp.node.quaternion.copy(sp.base).multiply(new THREE.Quaternion().setFromAxisAngle(sp.axis, angle));
  }
  const wet = world.set.kind === "sea" || Boolean(waterBand(world.set.kind));
  const impact = p.m.verb === "crash" && b.k > 0 && wet;
  return (
    <group position={off.toArray()} rotation={rot} scale={scale}>
      {impact ? <Spray at={[p.w0 * 0.48, 0, 0]} size={Math.max(p.h, p.w0 * 0.25)} k={b.k} /> : null}
      <group scale={k}>
        <primitive object={made.root} />
      </group>
      {p.m.held && act ? <HeldProp build={p.m.held} look={look} size={p.h * 0.1} spot={spot} /> : null}
    </group>
  );
};

// A person's acts (actions.tsx) on the body their clip has posed, each frame: the clip is set again
// from the bind pose first, so the acts never pile up from one frame to the next.
const useActs = (root: THREE.Object3D, act: Act | undefined, p: Placed, b: Blocking, world: World, pose: () => void) => {
  const humanoid = p.m.build.archetype === "humanoid";
  const rig = React.useMemo(() => (humanoid && act ? rigOf(root) : null), [root, humanoid, Boolean(act)]);
  const spot = React.useRef<{ at: THREE.Vector3; fwd: THREE.Vector3 } | null>(null);
  const reveal = world.direction?.shots?.find((x) => ["reveal", "insert"].includes(x.move) && (x.from ?? 0) > 0)?.from;
  const other = act?.look ? b.actors.find((a) => a.m.entity === act.look) : undefined;
  const state: Omit<ActState, "act"> = {
    t: b.gt,
    since: b.gt - (act?.from ?? 0) * b.gs,
    reveal: reveal !== undefined ? b.gt - reveal * b.gs : -1e3,
    fwd: new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)),
    height: p.h,
    target: other ? other.pos.clone().add(new THREE.Vector3(0, other.h * 0.9, 0)) : undefined,
    phase: (hashOf(p.m.entity) % 100) / 16,
  };
  useFrame(() => {
    if (!rig || !act) return;
    resetRig(rig);
    pose();
    root.updateWorldMatrix(true, true);
    spot.current = perform(rig, { act, ...state });
  });
  return spot;
};

const LIVING_ARCH = ["humanoid", "quadruped", "bird", "fish", "insect", "serpent"];

// A model's parts that turn on their own, found by name (a pack's "wheel-front-left", "propeller"): each
// turns about its own thinnest side, the axle of a wheel or the shaft of a propeller. (radius: a
// wheel's, in the prepared model's units before the design's size is applied)
const WHEEL = /wheel|tire|tyre/i;
const SPINNER = /propel|rotor|(^|[^a-z])prop([^a-z]|$)|blade|fan/i;
type Spinner = { node: THREE.Object3D; base: THREE.Quaternion; axis: THREE.Vector3; radius: number; wheel: boolean };
const spinningParts = (root: THREE.Object3D): Spinner[] => {
  root.updateMatrixWorld(true);
  const out: Spinner[] = [];
  root.traverse((n) => {
    const wheel = WHEEL.test(n.name);
    if (!wheel && !SPINNER.test(n.name)) return;
    // nested parts (a wheel's hub and tyre) turn with the outermost one
    for (let up = n.parent; up; up = up.parent) if (WHEEL.test(up.name) || SPINNER.test(up.name)) return;
    const box = new THREE.Box3();
    n.traverse((c) => {
      const g = (c as THREE.Mesh).geometry;
      if (!g) return;
      g.computeBoundingBox();
      const m = new THREE.Matrix4().copy(n.matrixWorld).invert().multiply(c.matrixWorld);
      box.union(g.boundingBox!.clone().applyMatrix4(m));
    });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const thin = size.x <= size.y && size.x <= size.z ? 0 : size.y <= size.z ? 1 : 2;
    // a wheel is round across its axle; a set of them (a train's bogie) is not, and stays put
    const across = [size.x, size.y, size.z].filter((_, i) => i !== thin);
    if (wheel && Math.max(...across) > Math.min(...across) * 1.3) return;
    const axis = new THREE.Vector3().setComponent(thin, 1);
    // the pivot is the node's own origin; a part modelled off its origin would swing round it, not spin
    const centre = box.getCenter(new THREE.Vector3());
    if (centre.length() > Math.max(size.x, size.y, size.z) * 0.25) return;
    const scale = new THREE.Vector3();
    n.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const radius = (Math.max(size.x, size.y, size.z) / 2) * Math.max(scale.x, scale.y, scale.z);
    out.push({ node: n, base: n.quaternion.clone(), axis, radius, wheel });
  });
  return out;
};

// A still library animal (one mesh, no rig) moved as a whole for what it does: the rise and fall and
// rock of a gait as it travels, a flier's bob and bank, a swimmer's sway, a slow breath and a look round
// while it stands, and lying on its side when it falls, dies or sleeps. (h: its height, d: its depth
// across its body, in the stage's units.)
const STRIDES = /walk|run|move|approach|depart|climb|carry|panic|rear|crash/;
const LIES = /fall|collapse|lie|sleep/;
const stillPose = (p: Placed, b: Blocking, h: number, d: number) => {
  const verb = p.m.verb;
  const arche = p.m.build.archetype;
  const t = b.t + p.phase;
  const rot: [number, number, number] = [0, 0, 0];
  const off = new THREE.Vector3();
  let scale = 1;
  if (LIES.test(verb) || p.m.state === "asleep") {
    // over onto its side, settling where it stood
    const s = verb === "lie" || verb === "sleep" || p.m.state === "asleep" ? 1 : ease((b.k + 0.4) / 0.6);
    rot[0] = s * Math.PI * 0.5;
    off.y = s * d * 0.5;
    scale = 1 + Math.sin(t * 1.1) * 0.006 * s;
  } else if (arche === "bird" || arche === "insect" ? verb === "fly" || verb === "flap" || STRIDES.test(verb) : false) {
    off.y = Math.sin(t * (arche === "insect" ? 9 : 2.2)) * h * (arche === "insect" ? 0.12 : 0.18);
    rot[0] = Math.sin(t * 1.3) * 0.12;
    rot[2] = Math.sin(t * 2.2 + 1) * 0.06;
  } else if (arche === "fish" || arche === "serpent" || verb === "swim") {
    rot[1] = Math.sin(t * 3.2) * 0.14;
    off.y = Math.sin(t * 1.6) * h * 0.04;
  } else if (STRIDES.test(verb)) {
    // a step: up over each stride and a rock from front to back, faster at a run
    const step = t * (verb === "run" || verb === "panic" ? 11 : 6.5);
    off.y = Math.abs(Math.sin(step)) * h * (verb === "run" ? 0.07 : 0.035);
    rot[2] = Math.sin(step * 2) * 0.035;
    rot[0] = Math.sin(step) * 0.02;
  } else {
    // standing: breathing, and a slow look round (a head down to eat or sniff)
    scale = 1 + Math.sin(t * 1.7) * 0.01;
    rot[1] = Math.sin(t * 0.35) * 0.14;
    if (/eat|sniff|peck/.test(verb)) rot[2] = -0.06 - Math.max(0, Math.sin(t * 1.2)) * 0.05;
    if (verb === "roar" || verb === "shake") rot[2] = Math.sin(t * 9) * 0.03 + 0.05;
  }
  return { rot, off, scale };
};
const ONCE = /death|die|dead|hit|reci?eve|interact|punch|kick|jump/i;

// A library person in the build's own skin and hair colours (their outfit keeps its own).
const tone = (root: THREE.Object3D, build: Build) => {
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      if (build.skin && /^skin/i.test(m.name)) m.color = new THREE.Color(build.skin);
      else if (build.hair && /hair|eyebrow|beard/i.test(m.name)) m.color = new THREE.Color(build.hair);
    }
  });
};

// A found model draws a living thing only when it has a clip for what that thing is doing; a still mesh
// sliding across the ground is worse than the generated, posed body.
// (a still library animal is posed instead: see stillPose)
const animatedFor = (m: CastMember) => Boolean(m.model?.src && ready.has(m.model.src)) && (clipFor(m.model?.clips ?? [], m.verb) >= 0 || Boolean(m.model?.posed));

// A person drawn from the character kit, when the kit's body and clips have loaded.
const kitFor = (world: World, m: CastMember) => {
  if (!world.kit || m.build.archetype !== "humanoid") return null;
  const body = ready.get((m.build.sex === "f" ? world.kit.bodies.f ?? world.kit.bodies.m : world.kit.bodies.m ?? world.kit.bodies.f) ?? "");
  const library = body ? world.kit.clips.flatMap((c) => (ready.get(c) ? clipsFor(ready.get(c) as Loaded, body) : [])) : [];
  const hair = Object.fromEntries(Object.entries(world.kit.hair ?? {}).flatMap(([k, src]) => (ready.has(src) ? [[k, ready.get(src) as Loaded]] : [])));
  return body && library.length ? { body, library, hair } : null;
};

const Actor: React.FC<{ p: Placed; look: Look; b: Blocking; world: World }> = (props) => {
  const { p, look, b } = props;
  const { m } = p;
  if (p.hidden) return null; // inside its carrier, or blown apart
  const s = m.state;
  const one = (dt: number) => {
    const t = b.t + dt;
    const phase = p.phase + dt * 3.1;
    if (LIVING_ARCH.includes(m.build.archetype) && animatedFor(m) && !kitFor(props.world, m)) return <FoundModel {...props} />;
    switch (m.build.archetype) {
      case "humanoid": {
        const kit = kitFor(props.world, m);
        if (kit) return <KitPerson build={m.build} verb={m.verb} body={kit.body} hair={kit.hair} library={kit.library} t={t + p.phase * 0.4} speed={p.speed} envMap={look.toon ? null : env.map} />;
        return <Humanoid build={m.build} look={look} pose={humanPose(m.verb, t + p.yaw, phase, b.k, dimsOf(m.build), s)} t={t} state={s} held={dt ? undefined : m.held} />;
      }
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
            // between a ship and an iceberg (any hero-built thing) an arrow is a pipe hung in the sky;
            // the scene's own move shows where it is going
            if (mk.kind === "arrow" && (a.m.build.form || z.m.build.form)) return null;
            const end = z.pos.clone().add(new THREE.Vector3(0, z.h * (mk.kind === "beam" ? 0.9 : 0.5), 0));
            const from = mk.kind === "arrow" ? a.pos.clone().add(new THREE.Vector3(0, a.h * 0.5, 0)) : top;
            const dir = end.clone().sub(from);
            const len = dir.length() * grow;
            const mid = from.clone().add(dir.clone().normalize().multiplyScalar(len / 2));
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            const pulse = from.clone().lerp(end, (b.t * 0.6) % 1);
            // as thick as the smaller end can carry: scaled to a liner's scene it was a bar metres across
            const r = Math.min(b.U * (mk.kind === "beam" ? 0.035 : 0.05), Math.min(a.h, z.h, a.w, z.w) * 0.04 + 0.03);
            // at night a glowing arrow blooms into a glare that hides the scene, so it is only bright paint
            const lit = !(mk.kind === "arrow" && world.set.time === "night");
            return (
              <group key={i}>
                <mesh position={mid} quaternion={q} geometry={unit.cyl} material={material(look, color, { glow: lit, opacity: 0.9 })} scale={[r * 2, len, r * 2]} />
                {mk.kind === "beam" && grow >= 1 ? <mesh position={pulse} geometry={unit.sphere} material={material(look, "#ffffff", { glow: true })} scale={r * 5} /> : null}
                {mk.kind === "arrow" ? (
                  <mesh position={from.clone().add(dir.clone().normalize().multiplyScalar(len))} quaternion={q} geometry={unit.cone} material={material(look, color, { glow: lit })} scale={[r * 5, r * 7, r * 5]} />
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
            // a light on the subject and a pool of it on the ground: a bubble round it hid a lying animal
            // behind a pale ball the size of its body
            return (
              <group key={i}>
                <pointLight position={top.toArray()} intensity={8 * grow} distance={a.h * 4 + b.U * 2} color={color} />
                <GroundGlow at={[a.pos.x, 0.03, a.pos.z]} w={Math.max(a.w, b.U) * 2.4} color={color} strength={0.5 * grow} />
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
  const segs = [0, 0.25, 0.4, 0.6, 0.75, 1].map((u) => {
    const b = block(world, Math.round(u * (D - 1)), fps, D, at, portrait);
    const cam = finalCamera(b, portrait, 9 / 16);
    return { a: cam.position.clone(), b: b.cam.look.clone() };
  });
  const actors = block(world, Math.round(at * (D - 1)), fps, D, at, portrait).actors.map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.w * 0.6 + 0.6 }));
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

const World3D: React.FC<{ world: World; b: Blocking; ba: Blocking; portrait: boolean; seed: number; keep: KeepOut; frame: number; shotCam?: ShotCam }> = ({ world, b, ba, portrait, seed, keep, frame, shotCam }) => {
  const { camera, gl } = useThree();
  gl.shadowMap.enabled = !((world as unknown as { fx?: string }).fx ?? "").includes("shadow");
  gl.shadowMap.type = THREE.PCFShadowMap;
  const look = lookOf(world.style);
  const d = world.direction;
  const light = d ? rigged(lightOf(look, world.set, b.U), d.light, art.profile) : lightOf(look, world.set, b.U);
  // everything in the air over a town: the town drops below, so the aircraft fly over the roofs, not down
  // the street, and the haze thins so the town below keeps its shape
  const aloft = ["city", "town", "street"].includes(world.set.kind) && world.cast.length > 0 && world.cast.every(flies);
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = light.exposure;
  const p = portrait ? b.cam.look.clone().add(b.cam.pos.clone().sub(b.cam.look).multiplyScalar(PORTRAIT_BACK)) : b.cam.pos;
  camera.position.copy(p);
  camera.lookAt(b.cam.look);
  camera.rotateZ(b.cam.roll);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = portrait ? b.cam.fov * PORTRAIT_FOV : b.cam.fov;
    camera.near = Math.max(0.05, b.U * 0.03);
    camera.far = 4000;
    camera.updateProjectionMatrix();
  }
  const dist = p.distanceTo(b.cam.look);
  // the shadow map covers the subject and its neighbours tightly, so shadows are crisp, not smeared
  const S = Math.min(Math.max(b.U * 6, dist * 0.8), b.U * 34);
  const focus = b.cam.look.clone().setY(Math.min(b.cam.look.y, b.U * 2));
  const sunDir = new THREE.Vector3(...light.sunDir).normalize();
  const sun = sunDir.clone().multiplyScalar(S * 2).add(focus);
  // the rim light sits behind the subject as the camera sees it, high, to edge it against the set
  const away = b.cam.look.clone().sub(p).setY(0).normalize();
  const rim = b.cam.look.clone().add(away.multiplyScalar(dist * 1.2)).add(new THREE.Vector3(0, dist * 0.7 + b.U * 2, 0));
  const water = ["sea"].includes(world.set.kind);
  const sky: SkySpec = { top: light.top, horizon: light.horizon, below: light.below, sun: light.sun, sunDir, night: light.night, clouds: light.clouds, seed };
  const close = b.cam.setup === 1 || ["close", "low_angle", "over_shoulder", "push_in"].includes(world.camera);
  // by day only what glows on purpose (marks, lamps: twice white and more) blooms, not a sunlit white
  // patch on a model (an animal's pale eye ring flared into a halo)
  const finish: Finish = { samples: 0, bloom: light.bloom, threshold: world.set.time === "day" ? Math.max(light.threshold, 1.4) : light.threshold, focus: dist, aperture: 0,
    vignette: light.vignette, lift: light.lift, gain: light.gain, frame };
  const grounded = !VOID.includes(world.set.kind) && world.set.kind !== "underwater";
  // bloom only where something gives off light: night, lit windows, glowing marks, a glowing cell
  const glowing = light.night >= 0.7 || world.set.time === "dusk" || VOID.includes(world.set.kind) || world.marks.some((m) => ["glow", "beam", "ring", "dome"].includes(m.kind)) || world.cast.some((c) => c.verb === "glow" || c.state === "burning" || c.build.parts.some((q) => q.glow));
  const off = (f: string) => ((world as unknown as { fx?: string }).fx ?? "").includes(f); // dev: switch features off to profile
  return (
    <>
      {light.fogDensity > 0 ? <fogExp2 attach="fog" args={[light.horizon, light.fogDensity * Math.max(1, look.fogScale * 0.8) * (aloft ? 0.45 : 1)]} /> : null}
      {world.set.kind === "space" ? <color attach="background" args={["#03040c"]} /> : off("sky") ? null : <SkyDome sky={sky} t={b.t} />}
      {off("ibl") ? null : <SkyLight sky={sky} intensity={light.envI} />}
      <hemisphereLight args={[light.amb, light.ground, light.ambI]} />
      <directionalLight position={sun.toArray()} target-position={focus.toArray()} intensity={light.sunI} color={light.sun} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-S} shadow-camera-right={S} shadow-camera-top={S} shadow-camera-bottom={-S} shadow-camera-near={0.1} shadow-camera-far={S * 5}
        shadow-bias={-0.0003} shadow-normalBias={b.U * 0.01} shadow-radius={d ? art.profile.shadowSoft : 3} />
      <directionalLight position={rim.toArray()} target-position={b.cam.look.toArray()} intensity={light.rimI} color={light.rim} />
      {look.gloss ? <directionalLight position={[b.U * 6, b.U * 2, -b.U * 6]} intensity={1.0} color="#9ff0ff" /> : null}
      {off("env") ? null : (
        <group position={[0, aloft ? -b.U * 34 : 0, 0]}>
          <Environment set={world.set} look={look} light={light} unit={b.U} seed={seed} t={b.gt} keep={keep} fx={(world as unknown as { fx?: string }).fx}
            recipe={d?.recipe} cam={shotCam} shot={b.cam.setup} />
        </group>
      )}
      {ba.actors.map((a, i) => (
        <group key={i} position={[0, water && !flies(a.m) && a.pos.y <= 0 && a.m.build.form !== "iceberg" ? -a.h * 0.18 : 0, 0]}>
          {off("actors") ? null : <Actor p={a} look={look} b={ba} world={world} />}
          {grounded && a.air === 0 && a.pos.y >= 0 && !waterBand(world.set.kind)?.length ? (
            <group position={[a.pos.x, 0, a.pos.z]} rotation={[0, a.yaw, 0]}>
              <ContactShadow w={a.w * 0.95} d={a.m.build.archetype === "humanoid" ? a.w * 0.6 : a.w * 0.55} y={b.U * 0.012} />
            </group>
          ) : null}
        </group>
      ))}
      {ba.actors.map((a, i) => (a.boom !== undefined && a.blast ? <Blast key={`blast${i}`} at={[a.pos.x, 0, a.pos.z]} since={a.boom} size={a.blast} /> : null))}
      <Marks world={world} b={b} look={look} />
      {VOID.includes(world.set.kind) ? <ambientLight intensity={0.2} /> : null}
      {off("post") || (!glowing && !d) ? null : <Post finish={d ? { ...finish, art: d.art, profile: art.profile, contrast: d.light?.contrast ?? 1, glow: glowing } : finish} />}
    </>
  );
};

// A detonation where a thing lands or stands: a flash and fireball, a shock ring racing out over the
// ground, and a column of dust and smoke that rises and spreads. `since` in seconds, size in metres.
const Blast: React.FC<{ at: [number, number, number]; since: number; size: number }> = ({ at, since, size }) => {
  if (since < 0) return null;
  const f = since * 30;
  const ring = Math.min(1, since / 1.2);
  return (
    <group>
      <Fireball at={[at[0], size * 0.25, at[2]]} since={f} size={size * 0.32} />
      {ring < 1 ? (
        <mesh position={[at[0], size * 0.02, at[2]]} rotation={[-Math.PI / 2, 0, 0]} scale={size * (0.4 + 3.6 * ring)}>
          <ringGeometry args={[0.92, 1, 64]} />
          <meshBasicMaterial color="#fff2c8" transparent opacity={0.85 * (1 - ring)} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      <Fireball at={[at[0] + size * 0.15, size * 0.12, at[2] - size * 0.1]} since={f - 3} size={size * 0.22} />
      <Billow at={at} since={f - 4} count={30} spread={size * 0.22} rise={size * 0.3} size={size * 0.28} color="#6e6458" dark="#2e2924" life={240} />
      {since < 0.12 ? <pointLight position={[at[0], size * 0.5, at[2]]} intensity={40} distance={size * 12} color="#ffe2a0" /> : null}
    </group>
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
  const short = format === "short";
  useArt((scene.world as World).direction?.art);
  const blockAt = (f: number) => {
    const sg = segmentOf(scene.world as World, f, durationInFrames, momentOf(scene));
    return { sg, b: block(sg.world, sg.frame, fps, sg.D, sg.at, short, { u: f / Math.max(1, durationInFrames - 1), t: f / fps, s: durationInFrames / fps }) };
  };
  const { sg: seg, b } = blockAt(frame);
  const world = seg.world;
  // a printed profile's people move on twos, like drawn animation; the camera and the place stay smooth
  const step = art.profile.step;
  const ba = step > 1 ? blockAt(frame - (frame % step)).b : b;
  // the foreground of each shot is placed from where its camera stands half way through it
  const setups = setupsOf(world, seg.D, fps, seg.at);
  const directed = Boolean((scene.world as World).direction?.shots?.length);
  const sh = setups[b.cam.setup] ?? setups[0];
  const midFrame = directed ? Math.round(((sh.from + sh.to) / 2) * (durationInFrames - 1)) : -1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shotCam = React.useMemo<ShotCam | undefined>(() => {
    if (!directed) return undefined;
    const mb = blockAt(midFrame).b;
    const cam = finalCamera(mb, short, width / height);
    return { pos: cam.position.clone(), look: mb.cam.look.clone(), fov: cam.fov, aspect: width / height };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.world, midFrame, short, width, height]);
  const look = lookOf(world.style);
  const seed = (world.seed ?? 0) ^ [...(world.set.place || world.set.kind)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  const k = unitOf(format);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keep = React.useMemo(() => keepOutOf(world, fps, seg.D, seg.at, short), [scene.world, seg.i, fps, seg.D, seg.at, short]);
  const loaded = useCastModels(scene.world as World);
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      {loaded ? <ThreeCanvas width={width} height={height} camera={{ fov: 36, position: [8, 3, 8] }} gl={{ antialias: true }} shadows>
        <World3D world={world} b={b} ba={ba} portrait={short} seed={seed} keep={keep} frame={frame} shotCam={shotCam} />
      </ThreeCanvas> : null}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(ellipse 75% 65% at 50% 48%, transparent 55%, rgba(0,0,0,${lightOf(look, world.set, b.U).vignette}))` }} />
      <Callouts world={world} b={b} portrait={short} width={width} height={height} scale={k} font={theme.font} />
      <WeatherOverlay weather={scene.weather} seed={world.seed} night={world.set.time === "night"} />
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <HeadingPlate scene={scene} theme={theme} short={short} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * k, background: `linear-gradient(transparent, ${theme.background}88)` }} />
    </AbsoluteFill>
  );
};
