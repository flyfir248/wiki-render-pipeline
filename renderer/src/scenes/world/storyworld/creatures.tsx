// The creature generators: four-legged animals, birds, swimmers, insects, snakes and cells, each built
// from a design's proportions, coat and features (fyt/worldgen.py Body) and moved by verbs. Nothing here
// is a particular animal: a black bear, a deer and a fox are the same generator with different numbers.
// Facing +x, up +y; legs swing forward with +z rotation.
import React, { useMemo } from "react";
import * as THREE from "three";
import { Flames, Stars } from "./humanoid";
import { panel } from "./hero";
import { Block, PartMesh, PartsModel, partsBounds } from "./parts";
import { type Look, material } from "./style";
import type { Build, Part, State } from "./types";

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
const parts = (b: Build, bone: Part["bone"], look: Look) => b.parts.filter((p) => p.bone === bone).map((p, i) => <PartMesh key={`${bone}${i}`} part={p} look={look} />);

// --- four legs ----------------------------------------------------------------------------------

export type QuadDims = { L: number; len: number; h: number; w: number; leg: number; neck: number; head: number; snout: number; y: number };

export const quadDims = (b: Build): QuadDims => {
  const L = Math.max(0.2, b.size);
  const leg = L * (0.24 + 0.3 * b.body.legs);
  const h = L * (0.24 + 0.16 * b.body.build);
  return { L, len: L * 0.6, h, w: L * (0.19 + 0.13 * b.body.build), leg, neck: L * (0.06 + 0.42 * b.body.neck), head: L * (0.15 + 0.08 * b.body.head), snout: L * (0.04 + 0.16 * b.body.snout), y: leg + h * 0.3 };
};

type QPose = { y: number; pitch: number; roll: number; legs: [number, number][]; neck: number; headTilt: number; headYaw: number; jaw: number; tail: number; tailYaw: number };

export const quadPose = (verb: string, t: number, phase: number, k: number, d: QuadDims, state: State): QPose => {
  const p: QPose = { y: 0, pitch: 0, roll: 0, legs: [[0, 0], [0, 0], [0, 0], [0, 0]], neck: 0, headTilt: 0, headYaw: Math.sin(t * 0.6) * 0.15, jaw: 0, tail: 0, tailYaw: Math.sin(t * 2) * 0.25 };
  // legs: 0 left fore, 1 right fore, 2 left hind, 3 right hind; [swing, knee]
  const gait = (offsets: number[], amp: number, lift: number) => {
    offsets.forEach((o, i) => {
      const a = phase + o * Math.PI * 2;
      const fore = i < 2;
      p.legs[i] = [Math.sin(a) * amp, (fore ? -1 : 1) * Math.max(0, Math.cos(a)) * lift];
    });
  };
  switch (verb) {
    case "walk":
    case "climb":
      gait([0.25, 0.75, 0, 0.5], 0.38, 0.6);
      p.y = Math.abs(Math.sin(phase * 2)) * d.L * 0.01;
      p.neck = -0.05;
      if (verb === "climb") p.pitch = 0.9;
      break;
    case "run":
      gait([0.5, 0.62, 0, 0.12], 0.75, 1.1);
      p.pitch = Math.sin(phase) * 0.12;
      p.y = Math.max(0, Math.sin(phase)) * d.L * 0.06;
      p.neck = -0.2;
      p.tail = 0.4;
      break;
    case "sniff":
      p.neck = -0.75;
      p.headTilt = -0.4 + Math.sin(t * 9) * 0.06;
      p.headYaw = Math.sin(t * 1.4) * 0.35;
      gait([0.25, 0.75, 0, 0.5], 0.1, 0.2);
      break;
    case "eat":
      p.neck = -0.95;
      p.headTilt = -0.55;
      p.jaw = Math.max(0, Math.sin(t * 8)) * 0.35;
      p.headYaw = Math.sin(t * 1.9) * 0.18;
      p.legs[0] = [0.15, 0];
      p.legs[1] = [0.15, 0];
      break;
    case "sit":
      p.pitch = 0.55;
      p.y = -d.leg * 0.45;
      p.legs[2] = [1.2, 1.9];
      p.legs[3] = [1.2, 1.9];
      p.legs[0] = [-0.5, 0];
      p.legs[1] = [-0.5, 0];
      p.neck = 0.1;
      break;
    case "lie":
    case "sleep":
      p.y = -d.leg * 0.95;
      p.legs = [[1.35, -1.6], [1.35, -1.6], [-1.3, 1.7], [-1.3, 1.7]];
      p.neck = verb === "sleep" ? -0.55 : -0.25;
      p.headTilt = verb === "sleep" ? -0.3 : 0;
      p.y += Math.sin(t * 1.6) * d.L * 0.004;
      p.headYaw = verb === "sleep" ? 0.25 : p.headYaw;
      break;
    case "rear": {
      const r = ease((k + 0.5) / 0.6);
      p.pitch = 1.15 * r;
      p.legs[0] = [0.4 * r + Math.sin(t * 6) * 0.3 * r, -0.9 * r];
      p.legs[1] = [0.4 * r - Math.sin(t * 6) * 0.3 * r, -0.9 * r];
      p.legs[2] = [-0.6 * r, 0.3 * r];
      p.legs[3] = [-0.6 * r, 0.3 * r];
      p.jaw = 0.4 * r;
      p.neck = -0.4 * r;
      break;
    }
    case "roar": {
      const r = ease(1 - Math.abs(k) / 1.2);
      p.neck = 0.25 * r;
      p.headTilt = 0.35 * r;
      p.jaw = 0.6 * r + 0.05;
      p.pitch = -0.08 * r;
      p.legs[0] = [0.25 * r, 0];
      p.legs[1] = [0.25 * r, 0];
      break;
    }
    case "look_around":
      p.headYaw = Math.sin(t * 1.2) * 0.8;
      p.neck = 0.15;
      break;
    case "fall": {
      const f = ease((k + 0.1) / 0.5);
      p.roll = 1.45 * f;
      p.y = -d.leg * 0.7 * f;
      p.legs = [[0.3 * f, 0], [0.5 * f, 0], [-0.3 * f, 0], [-0.5 * f, 0]];
      break;
    }
    case "swim":
      gait([0, 0.5, 0.5, 0], 0.6, 0.5);
      p.y = -d.leg * 1.05;
      p.neck = 0.35;
      p.headTilt = 0.25;
      break;
    default: // idle
      p.neck = Math.sin(t * 0.8) * 0.05;
      p.y = Math.sin(t * 1.8) * d.L * 0.003;
  }
  if (state === "dazed") {
    p.roll += Math.sin(t * 1.9) * 0.14;
    p.headYaw += Math.sin(t * 2.7) * 0.35;
    p.headTilt += Math.sin(t * 2.2) * 0.15;
  }
  return p;
};

export const Quadruped: React.FC<{ build: Build; look: Look; pose: QPose; t: number; state: State }> = ({ build, look, pose, t, state }) => {
  const d = quadDims(build);
  const B = build.body;
  const wet = state === "wet" ? 0.7 : 1;
  const fur = tone(build.primary, wet);
  const under = tone(build.secondary, wet);
  const dark = tone(build.accent, wet);
  const paw = tone(build.primary, 0.62 * wet);
  const blocky = look.blocky;
  const round: Part["shape"] = blocky ? "box" : "capsule";
  const blob: Part["shape"] = blocky ? "box" : "sphere";
  const lw = d.w * (0.3 + 0.18 * B.build);
  const hipX = -d.len * 0.36;
  const shX = d.len * 0.36;
  const legs = [
    [shX, -1],
    [shX, 1],
    [hipX, -1],
    [hipX, 1],
  ].map(([x, side], i) => {
    const [sw, knee] = pose.legs[i];
    const fore = i < 2;
    const upper = d.leg * 0.55;
    const lower = d.leg * 0.5;
    return (
      <group key={i} position={[x, d.h * 0.05, side * d.w * 0.3]} rotation={[0, 0, sw]}>
        <Block look={look} shape={round} color={fore ? fur : fur} size={[lw * (fore ? 1.1 : 1.35), upper, lw * 1.05]} at={[0, -upper / 2, 0]} />
        <group position={[0, -upper, 0]} rotation={[0, 0, knee]}>
          <Block look={look} shape={round} color={fur} size={[lw * 0.85, lower * 1.2, lw * 0.85]} at={[0, -lower * 0.5 + lower * 0.1, 0]} />
          <Block look={look} shape={blocky ? "box" : "sphere"} color={paw} size={[lw * 1.25, lw * 0.5, lw * 1.0]} at={[lw * 0.2, -lower + lw * 0.12, 0]} />
        </group>
      </group>
    );
  });
  // coat markings
  const marks: React.ReactNode[] = [];
  if (B.pattern === "belly") marks.push(<Block key="belly" look={look} shape={blob} color={"#" + new THREE.Color(fur).lerp(new THREE.Color(under), 0.45).getHexString()} size={[d.len * 0.8, d.h * 0.45, d.w * 0.85]} at={[0, -d.h * 0.3, 0]} />);
  if (B.pattern === "spots" || B.pattern === "patches") {
    const n = B.pattern === "spots" ? 14 : 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const r = B.pattern === "spots" ? d.h * 0.16 : d.h * 0.4;
      marks.push(<Block key={`s${i}`} look={look} shape={blob} color={dark} size={[r, r * 0.6, r]} at={[Math.sin(a * 1.7) * d.len * 0.4, d.h * (0.1 + 0.25 * Math.cos(a)), Math.sign(Math.sin(a)) * d.w * 0.47]} />);
    }
  }
  if (B.pattern === "stripes")
    for (let i = 0; i < 7; i++) marks.push(<Block key={`t${i}`} look={look} color={dark} size={[d.len * 0.045, d.h * 1.02, d.w * 1.03]} at={[-d.len * 0.42 + i * d.len * 0.14, d.h * 0.05, 0]} />);
  const hs = d.head;
  const ears = (() => {
    if (B.ears === "none") return null;
    return [-1, 1].map((z) => {
      const at: [number, number, number] = [-hs * 0.1, hs * 0.45, z * hs * 0.32];
      switch (B.ears) {
        case "pointed":
          return <Block key={z} look={look} shape={blocky ? "box" : "cone"} color={fur} size={[hs * 0.2, hs * 0.4, hs * 0.18]} at={at} rot={[z * 0.25, 0, 0]} />;
        case "long":
          return <Block key={z} look={look} shape={round} color={fur} size={[hs * 0.14, hs * 0.75, hs * 0.1]} at={[at[0], hs * 0.7, at[2]]} rot={[z * 0.2, 0, -0.2]} />;
        case "floppy":
          return <Block key={z} look={look} shape={round} color={dark} size={[hs * 0.12, hs * 0.5, hs * 0.22]} at={[-hs * 0.05, hs * 0.05, z * hs * 0.5]} rot={[z * -0.3, 0, 0]} />;
        default:
          return <Block key={z} look={look} shape={blob} color={fur} size={[hs * 0.26, hs * 0.26, hs * 0.12]} at={at} />;
      }
    });
  })();
  const horns = (() => {
    switch (B.horns) {
      case "antlers":
        return [-1, 1].map((z) => (
          <group key={z} position={[-hs * 0.05, hs * 0.45, z * hs * 0.2]} rotation={[z * 0.35, 0, 0.2]}>
            <Block look={look} shape="cylinder" color="#d8c49a" size={[hs * 0.06, hs * 0.9, hs * 0.06]} at={[0, hs * 0.45, 0]} />
            {[0.3, 0.55, 0.8].map((y, i) => (
              <Block key={i} look={look} shape="cylinder" color="#d8c49a" size={[hs * 0.045, hs * 0.38, hs * 0.045]} at={[hs * 0.12, hs * y * 0.9 + hs * 0.1, 0]} rot={[0, 0, -0.9]} />
            ))}
          </group>
        ));
      case "horns":
        return [-1, 1].map((z) => <Block key={z} look={look} shape="cone" color="#e6dcc4" size={[hs * 0.14, hs * 0.5, hs * 0.14]} at={[0, hs * 0.55, z * hs * 0.3]} rot={[z * 0.6, 0, -0.4]} />);
      case "tusks":
        return [-1, 1].map((z) => <Block key={z} look={look} shape="cone" color="#f2ecdc" size={[hs * 0.09, hs * 0.55, hs * 0.09]} at={[hs * 0.55, -hs * 0.3, z * hs * 0.18]} rot={[0, 0, -2.0]} />);
      case "crest":
        return <Block look={look} shape="wedge" color={build.accent} size={[hs * 0.7, hs * 0.35, hs * 0.08]} at={[0, hs * 0.55, 0]} />;
      default:
        return null;
    }
  })();
  const neckLen = d.neck;
  const neckAngle = 0.5 + B.neck * 0.6 + pose.neck;
  const tailShape = B.tail;
  return (
    <group position={[0, d.y + pose.y, 0]} rotation={[pose.roll, 0, pose.pitch]}>
      <group position={[hipX * 0.9, 0, 0]}>
        {/* the body pivots at the hips, so rearing and sitting stay on the hind feet */}
        <group position={[-hipX * 0.9, 0, 0]}>
          <Block look={look} shape={blob} color={fur} size={[d.len * 1.08, d.h, d.w]} at={[0, d.h * 0.15, 0]} />
          <Block look={look} shape={blob} color={fur} size={[d.len * 0.5, d.h * 1.08, d.w * 1.06]} at={[d.len * 0.26, d.h * 0.22, 0]} />
          {marks}
          {legs}
          {parts(build, "torso", look)}
          {parts(build, "back", look)}
          {B.horns === "mane" ? <Block look={look} shape={blob} color={dark} size={[d.len * 0.38, d.h * 1.3, d.w * 1.2]} at={[d.len * 0.42, d.h * 0.35, 0]} /> : null}
          {/* tail */}
          {tailShape !== "none" ? (
            <group position={[-d.len * 0.52, d.h * 0.3, 0]} rotation={[0, pose.tailYaw, 2.2 + pose.tail]}>
              <Block look={look} shape={round} color={tailShape === "bushy" ? fur : fur}
                size={tailShape === "short" ? [d.w * 0.22, d.w * 0.25, d.w * 0.22] : tailShape === "bushy" ? [d.w * 0.4, d.L * 0.38, d.w * 0.4] : [d.w * 0.12, d.L * 0.42, d.w * 0.12]}
                at={[0, tailShape === "short" ? d.w * 0.1 : d.L * 0.2, 0]} />
              {parts(build, "tail", look)}
            </group>
          ) : null}
          {/* neck and head */}
          <group position={[d.len * 0.45, d.h * 0.32, 0]} rotation={[0, pose.headYaw * 0.4, neckAngle - Math.PI / 2]}>
            <Block look={look} shape={round} color={fur} size={[d.w * 0.5, neckLen + d.w * 0.3, d.w * 0.48]} at={[0, neckLen / 2, 0]} />
            <group position={[0, neckLen + hs * 0.2, 0]} rotation={[0, pose.headYaw * 0.6, Math.PI / 2 - neckAngle + pose.headTilt - 0.15]}>
              <Block look={look} shape={blob} color={fur} size={[hs * 1.05, hs * 0.95, hs * 0.92]} />
              {/* muzzle with jaw, nose and eyes */}
              <Block look={look} shape={blocky ? "box" : "capsule"} color={under} size={[d.snout + hs * 0.25, hs * 0.42, hs * 0.48]} at={[hs * 0.42 + d.snout * 0.45, -hs * 0.08, 0]} rot={[0, 0, blocky ? 0 : Math.PI / 2]} />
              <group position={[hs * 0.3, -hs * 0.24, 0]} rotation={[0, 0, -pose.jaw]}>
                <Block look={look} color={under} size={[d.snout + hs * 0.2, hs * 0.12, hs * 0.36]} at={[(d.snout + hs * 0.2) / 2, 0, 0]} />
                {pose.jaw > 0.2 ? <Block look={look} color="#7a2a2a" size={[d.snout * 0.8, hs * 0.03, hs * 0.26]} at={[d.snout * 0.5, hs * 0.07, 0]} /> : null}
              </group>
              <Block look={look} shape={blob} color="#141414" size={[hs * 0.18, hs * 0.14, hs * 0.22]} at={[hs * 0.52 + d.snout * 0.92, -hs * 0.02, 0]} />
              {[-1, 1].map((z) => (
                <Block key={z} look={look} shape={blob} color="#111111" size={[hs * 0.12, hs * 0.14, hs * 0.1]} at={[hs * 0.38, hs * 0.14, z * hs * 0.3]} />
              ))}
              {ears}
              {horns}
              {state === "dazed" ? <Stars r={hs * 0.8} y={hs * 0.9} t={t} look={look} /> : null}
              {state === "injured" ? <Block look={look} shape="torus" color="#f4f4f0" size={[hs * 0.9, hs * 0.9, hs * 0.14]} at={[0, hs * 0.1, 0]} rot={[0, 0, 1.4]} /> : null}
              {parts(build, "head", look)}
            </group>
          </group>
        </group>
      </group>
      {state === "burning" ? <Flames size={d.L * 0.8} t={t} look={look} /> : null}
    </group>
  );
};

// --- birds ----------------------------------------------------------------------------------------

export const birdLift = (verb: string, size: number) => (verb === "fly" ? size * 6 : 0);

// A bird's wing in two panels, arm and hand, with a feathered trailing edge. In flight the hand lags
// the arm, so the wing bends through the stroke like a real one instead of flipping like a plank.
const wingShapes = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
const wingGeometry = (L: number, side: number) => {
  const key = `${L.toFixed(3)}|${side}`;
  let g = wingShapes.get(key);
  if (!g) {
    const arm: [number, number][] = [[0.09, 0], [0.07, 0.36], [-0.11, 0.36], [-0.13, 0]];
    const hand: [number, number][] = [[0.07, 0], [0.0, 0.3], [-0.08, 0.42], [-0.15, 0.4], [-0.12, 0.34], [-0.16, 0.3], [-0.13, 0.24], [-0.16, 0.18], [-0.12, 0.12], [-0.15, 0.06], [-0.11, 0]];
    const f = (pts: [number, number][]) => pts.map(([x, y]) => [x * L, y * L * side] as [number, number]);
    g = [panel(f(arm), L * 0.018), panel(f(hand), L * 0.012)];
    wingShapes.set(key, g);
  }
  return g;
};

const Wing: React.FC<{ L: number; side: number; flap: number; folded: boolean; color: string; tip: string; look: Look }> = ({ L, side, flap, folded, color, tip, look }) => {
  const [arm, hand] = wingGeometry(L, side);
  const up = folded ? 0.15 : flap * 0.75 + 0.12;
  const bend = folded ? 0 : Math.sin(Math.asin(Math.max(-1, Math.min(1, flap))) - 0.7) * 0.45;
  if (folded) {
    return (
      <group position={[L * 0.02, L * 0.1, side * L * 0.1]} rotation={[0, side * 1.35, 0]}>
        <mesh geometry={arm} material={material(look, color)} scale={[0.9, 1, 0.8]} castShadow />
      </group>
    );
  }
  return (
    <group position={[L * 0.06, L * 0.08, side * L * 0.1]} rotation={[-side * up, 0, 0]}>
      <mesh geometry={arm} material={material(look, color)} castShadow />
      <group position={[0, 0, side * L * 0.355]} rotation={[-side * bend, side * 0.12, 0]}>
        <mesh geometry={hand} material={material(look, tip)} castShadow />
      </group>
    </group>
  );
};

export const Bird: React.FC<{ build: Build; look: Look; verb: string; t: number; k: number; state: State }> = ({ build, look, verb, t, k, state }) => {
  const L = Math.max(0.1, build.size);
  const B = build.body;
  const blob: Part["shape"] = look.blocky ? "box" : "sphere";
  const flying = verb === "fly" || verb === "flap";
  const flap = flying ? Math.sin(t * (verb === "fly" ? 9 : 14)) * 0.85 : 0;
  const fold = flying ? 0 : 1;
  const peck = verb === "peck" ? Math.max(0, Math.sin(t * 7)) * 0.9 : 0;
  const fall = verb === "fall" ? ease((k + 0.1) / 0.5) : 0;
  const neck = L * (0.12 + 0.45 * B.neck);
  const legH = flying ? 0 : L * 0.28;
  const step = verb === "walk" ? Math.sin(t * 8) * 0.4 : 0;
  return (
    <group position={[0, legH + (flying ? Math.sin(t * 9) * L * 0.04 : 0), 0]} rotation={[fall * 2.5, 0, (flying ? 0.05 : 0.25) - fall * 0.5]}>
      <Block look={look} shape={blob} color={build.primary} size={[L * 0.6, L * (0.28 + 0.12 * B.build), L * (0.26 + 0.1 * B.build)]} />
      {B.pattern === "belly" ? <Block look={look} shape={blob} color={build.secondary} size={[L * 0.5, L * 0.2, L * 0.24]} at={[L * 0.03, -L * 0.07, 0]} /> : null}
      <Block look={look} shape="wedge" color={tone(build.primary, 0.75)} size={[L * 0.32, L * 0.06, L * 0.2]} at={[-L * 0.38, L * 0.03, 0]} />
      {[-1, 1].map((z) =>
        look.blocky ? (
          <group key={z} position={[L * 0.06, L * 0.08, z * L * 0.12]} rotation={[z * flap - z * 0.1, 0, fold * -0.15]}>
            <Block look={look} color={tone(build.primary, 0.85)} size={[L * (fold ? 0.5 : 0.36), L * 0.03, L * (fold ? 0.16 : 0.75)]} at={[fold ? -L * 0.08 : 0, 0, z * L * (fold ? 0.06 : 0.37)]} />
          </group>
        ) : (
          <Wing key={z} L={L} side={z} flap={flying ? Math.sin(t * (verb === "fly" ? 9 : 14)) : 0} folded={!flying} color={tone(build.primary, 0.9)} tip={tone(build.accent, 0.9)} look={look} />
        ),
      )}
      <group position={[L * 0.26, L * 0.08, 0]} rotation={[0, 0, (flying ? -0.9 : 0.55 - B.neck * 0.1) - peck]}>
        <Block look={look} shape={look.blocky ? "box" : "capsule"} color={B.neck > 0.5 ? build.accent : build.primary} size={[L * 0.11, neck + L * 0.06, L * 0.11]} at={[0, neck / 2, 0]} />
        <group position={[0, neck, 0]} rotation={[0, 0, (flying ? 0.9 : -0.55 + B.neck * 0.1) + peck * 0.6]}>
          <Block look={look} shape={blob} color={B.neck > 0.5 ? build.accent : build.primary} size={[L * 0.18, L * 0.16, L * 0.15]} />
          <Block look={look} shape="cone" color={B.snout > 0.6 ? build.accent : "#e8a33a"} size={[L * 0.07, L * (0.08 + 0.14 * B.snout), L * 0.06]} at={[L * 0.12 + L * 0.05 * B.snout, -L * 0.01, 0]} rot={[0, 0, -Math.PI / 2]} />
          {[-1, 1].map((z) => (
            <Block key={z} look={look} shape={blob} color="#101010" size={[L * 0.035, L * 0.035, L * 0.02]} at={[L * 0.05, L * 0.03, z * L * 0.07]} />
          ))}
          {parts(build, "head", look)}
        </group>
      </group>
      {!flying
        ? [-1, 1].map((z) => (
            <group key={z} position={[0, -L * 0.1, z * L * 0.07]} rotation={[0, 0, z * step]}>
              <Block look={look} shape="cylinder" color="#d08a2a" size={[L * 0.03, legH, L * 0.03]} at={[0, -legH / 2, 0]} />
              <Block look={look} color="#d08a2a" size={[L * 0.1, L * 0.02, L * 0.08]} at={[L * 0.03, -legH, 0]} />
            </group>
          ))
        : null}
      {parts(build, "torso", look)}
      {state === "dazed" ? <Stars r={L * 0.25} y={L * 0.45} t={t} look={look} /> : null}
    </group>
  );
};

// --- swimmers, many-legged things and snakes -----------------------------------------------------

export const Fish: React.FC<{ build: Build; look: Look; t: number; speed: number }> = ({ build, look, t, speed }) => {
  const L = Math.max(0.1, build.size);
  const blob: Part["shape"] = look.blocky ? "box" : "sphere";
  const segs = 4;
  const w = 7 + speed * 3;
  const thick = 0.22 + 0.18 * build.body.build;
  const chain = (i: number): React.ReactNode => {
    if (i >= segs) {
      return (
        <group rotation={[0, Math.sin(t * w - i * 0.9) * 0.35, 0]}>
          <Block look={look} shape="wedge" color={tone(build.primary, 0.85)} size={[L * 0.06, L * 0.3, L * 0.2]} at={[-L * 0.08, 0, 0]} rot={[Math.PI / 2, 0, Math.PI / 2]} />
        </group>
      );
    }
    const seg = L / (segs + 0.5);
    const k = 1 - i / (segs + 1.5);
    return (
      <group rotation={[0, Math.sin(t * w - i * 0.9) * 0.12 * (i / segs + 0.3), 0]}>
        <Block look={look} shape={blob} color={build.primary} size={[seg * 1.35, L * thick * k, L * thick * 0.75 * k]} at={[-seg * 0.5, 0, 0]} />
        {build.body.pattern !== "plain" ? <Block look={look} shape={blob} color={build.secondary} size={[seg * 1.2, L * thick * k * 0.5, L * thick * 0.7 * k]} at={[-seg * 0.5, -L * thick * k * 0.22, 0]} /> : null}
        <group position={[-seg, 0, 0]}>{chain(i + 1)}</group>
      </group>
    );
  };
  return (
    <group position={[L * 0.45, L * 0.3, 0]}>
      <Block look={look} shape={blob} color={build.primary} size={[L * 0.3, L * thick * 1.05, L * thick * 0.8]} />
      <Block look={look} shape="wedge" color={tone(build.primary, 0.8)} size={[L * 0.18, L * 0.14, L * 0.02]} at={[-L * 0.25, L * thick * 0.6, 0]} />
      {[-1, 1].map((z) => (
        <Block key={z} look={look} shape={blob} color="#101010" size={[L * 0.03, L * 0.03, L * 0.02]} at={[L * 0.1, L * 0.03, z * L * thick * 0.38]} />
      ))}
      {[-1, 1].map((z) => (
        <Block key={`f${z}`} look={look} color={tone(build.primary, 0.8)} size={[L * 0.1, L * 0.01, L * 0.08]} at={[-L * 0.02, -L * 0.04, z * L * thick * 0.45]} rot={[z * (0.4 + Math.sin(t * 5) * 0.3), 0, 0]} />
      ))}
      {chain(0)}
      {parts(build, "head", look)}
    </group>
  );
};

export const Insect: React.FC<{ build: Build; look: Look; verb: string; t: number; phase: number }> = ({ build, look, verb, t, phase }) => {
  const L = Math.max(0.01, build.size);
  const blob: Part["shape"] = look.blocky ? "box" : "sphere";
  const flying = verb === "fly";
  const legs = build.body.legs > 0.8 ? 4 : 3;
  return (
    <group position={[0, flying ? L * 3 : L * 0.22, 0]}>
      <Block look={look} shape={blob} color={build.primary} size={[L * 0.5, L * 0.3, L * 0.32]} at={[-L * 0.3, L * 0.02, 0]} />
      <Block look={look} shape={blob} color={build.secondary} size={[L * 0.25, L * 0.22, L * 0.22]} />
      <Block look={look} shape={blob} color={build.primary} size={[L * 0.18, L * 0.16, L * 0.18]} at={[L * 0.2, L * 0.02, 0]} />
      {[-1, 1].map((z) => (
        <group key={z}>
          <Block look={look} shape="cylinder" color={build.accent} size={[L * 0.012, L * 0.3, L * 0.012]} at={[L * 0.34, L * 0.14, z * L * 0.06]} rot={[z * 0.4, 0, -0.7]} />
          <Block look={look} shape={blob} color="#101010" size={[L * 0.05, L * 0.05, L * 0.04]} at={[L * 0.26, L * 0.05, z * L * 0.07]} />
          {Array.from({ length: legs }, (_, i) => {
            const a = Math.sin(phase + i * 2.1 + (z > 0 ? Math.PI : 0)) * 0.4;
            return (
              <group key={i} position={[L * (0.08 - i * 0.1), 0, z * L * 0.1]} rotation={[z * 1.0, a, 0]}>
                <Block look={look} shape="cylinder" color={build.accent} size={[L * 0.02, L * 0.3, L * 0.02]} at={[0, -L * 0.15, 0]} />
              </group>
            );
          })}
          {flying ? (
            <Block look={look} color="#e8f2ff" opacity={0.55} size={[L * 0.35, L * 0.01, L * 0.42]} at={[-L * 0.05, L * 0.18, z * L * 0.24]} rot={[z * Math.sin(t * 40) * 0.6, 0, 0]} />
          ) : null}
        </group>
      ))}
      {parts(build, "head", look)}
    </group>
  );
};

export const Serpent: React.FC<{ build: Build; look: Look; verb: string; t: number; phase: number }> = ({ build, look, verb, t, phase }) => {
  const L = Math.max(0.1, build.size);
  const n = 14;
  const blob: Part["shape"] = look.blocky ? "box" : "sphere";
  const rear = verb === "rear" ? 1 : 0;
  const thick = L * (0.05 + 0.04 * build.body.build);
  return (
    <group>
      {Array.from({ length: n }, (_, i) => {
        const x = L * 0.5 - (i / n) * L;
        const z = Math.sin(phase * 1.5 + i * 0.6) * L * 0.08 * (verb === "idle" ? 0.3 : 1);
        const lift = rear ? Math.max(0, 4 - i) * thick * 0.9 : 0;
        const r = thick * (i === 0 ? 1.25 : 1 - (i / n) * 0.6);
        return <Block key={i} look={look} shape={blob} color={i % 3 === 0 && build.body.pattern !== "plain" ? build.secondary : build.primary} size={[r * 2.2, r * 1.6, r * 1.8]} at={[x, r * 0.8 + lift, z]} />;
      })}
      {[-1, 1].map((zz) => (
        <Block key={zz} look={look} shape={blob} color="#101010" size={[thick * 0.3, thick * 0.3, thick * 0.2]} at={[L * 0.5 + thick * 0.6, thick * 1.2 + rear * thick * 3.6, zz * thick * 0.55]} />
      ))}
      {rear ? <Block look={look} color="#c02a3a" size={[thick * 1.2, thick * 0.08, thick * 0.12]} at={[L * 0.5 + thick * 1.8, thick * 0.9 + thick * 3.6, 0]} rot={[0, 0, Math.sin(t * 20) * 0.2]} /> : null}
    </group>
  );
};

// --- cells and other things seen as models -------------------------------------------------------

const blobGeometry = new THREE.IcosahedronGeometry(0.5, 3);
const blobBase = (blobGeometry.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array;

// A red blood cell's biconcave disc (the Evans-Fung profile), diameter 1, lying in the x-y plane.
let rbcGeo: THREE.BufferGeometry | null = null;
export const rbcGeometry = () => {
  if (rbcGeo) return rbcGeo;
  const n = 40;
  const pts: THREE.Vector2[] = [];
  const half = (r: number) => 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) * (0.207 + 2.003 * r * r - 1.123 * r ** 4);
  for (let i = 0; i <= n; i++) {
    const r = Math.sin((i / n) * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r * 0.5, half(r) * 0.55));
  }
  for (let i = n - 1; i >= 0; i--) {
    const r = Math.sin((i / n) * Math.PI * 0.5);
    pts.push(new THREE.Vector2(r * 0.5, -half(r) * 0.55));
  }
  rbcGeo = new THREE.LatheGeometry(pts, 48);
  rbcGeo.rotateX(Math.PI / 2);
  rbcGeo.computeVertexNormals();
  return rbcGeo;
};

// A sickled cell: a stiff, tapered crescent, length 1 along x.
let sickleGeo: THREE.BufferGeometry | null = null;
const sickleGeometry = () => {
  if (sickleGeo) return sickleGeo;
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI * (1.15 + (i / 8) * 0.7);
    return new THREE.Vector3(Math.cos(a) * 0.55, Math.sin(a) * 0.55 + 0.42, 0);
  }));
  const g = new THREE.TubeGeometry(curve, 48, 1, 16, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // taper: shrink each ring toward the curve by how near the ends it is
  const center = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    curve.getPointAt(u, center);
    const r = 0.03 + 0.15 * Math.sin(Math.PI * u) ** 0.8;
    for (let j = 0; j <= 16; j++) {
      const idx = i * 17 + j;
      p.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, p.x, p.y, p.z * 0.75);
    }
  }
  g.computeVertexNormals();
  sickleGeo = g;
  return g;
};

export const Cell: React.FC<{ build: Build; look: Look; verb: string; t: number; k: number }> = ({ build, look, verb, t, k }) => {
  const L = Math.max(0.01, build.size);
  if ((build.form === "rbc" || build.form === "sickle") && !look.blocky) {
    const sick = build.form === "sickle";
    const turn = verb === "spin" ? t * 1.2 : Math.sin(t * 0.4) * 0.5;
    const squeeze = verb === "squeeze" || verb === "move" ? 1 + Math.sin(t * 2.2) * 0.04 : 1;
    return (
      <group position={[0, L * 0.6, 0]} rotation={[Math.sin(t * 0.3) * 0.2 + (sick ? 0 : 0.25), turn + (sick ? 0 : 0.55), sick ? 0 : 0.15]} scale={[L * squeeze, L / squeeze, L]}>
        <mesh geometry={sick ? sickleGeometry() : rbcGeometry()} material={material(look, build.primary, { rough: sick ? 0.45 : 0.3 })} castShadow receiveShadow />
      </group>
    );
  }
  const geom = useMemo(() => blobGeometry.clone(), []);
  // A soft membrane that wobbles: the unit icosphere pushed in and out by slow waves.
  const pos = geom.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = blobBase[i * 3], y = blobBase[i * 3 + 1], z = blobBase[i * 3 + 2];
    const w = 1 + 0.07 * Math.sin(x * 9 + t * 2.1) * Math.cos(y * 7 - t * 1.7) + 0.05 * Math.sin(z * 11 + t * 2.9);
    pos.setXYZ(i, x * w, y * w, z * w);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  const pulse = verb === "pulse" ? 1 + Math.sin(t * 5) * 0.06 : 1;
  const grow = verb === "grow" ? 0.45 + 0.55 * ease((k + 1.5) / 2) : 1;
  if (build.parts.length >= 2) {
    // a cell with an outline of its own (a disc, a crescent, a virus): turned slowly about its centre
    const c = partsBounds(build.parts).center;
    const turn = verb === "spin" ? t * 1.2 : Math.sin(t * 0.4) * 0.5;
    return (
      <group position={[c.x, c.y, c.z]} scale={pulse * grow} rotation={[Math.sin(t * 0.3) * 0.15, turn, 0]}>
        <group position={[-c.x, -c.y, -c.z]}>
          <PartsModel parts={build.parts} look={look} spin={t * 2} />
        </group>
      </group>
    );
  }
  const split = verb === "split" ? ease((k + 0.3) / 1.0) : 0;
  const one = (dx: number, key: string) => (
    <group key={key} position={[dx, 0, 0]} scale={[1 - split * 0.18, 1, 1]}>
      <mesh geometry={geom} material={material(look, build.primary, { opacity: 0.82, rough: 0.35 })} scale={L} castShadow />
      <mesh geometry={blobGeometry} material={material(look, build.secondary, { rough: 0.4 })} scale={L * 0.38} position={[L * 0.05, L * 0.05, 0]} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Block key={i} look={look} shape="sphere" color={build.accent} size={[L * 0.08, L * 0.05, L * 0.08]} at={[Math.cos(i * 1.7 + t * 0.3) * L * 0.28, Math.sin(i * 2.3) * L * 0.18, Math.sin(i * 1.7 + t * 0.3) * L * 0.28]} />
      ))}
    </group>
  );
  return (
    <group position={[0, L * 0.6, 0]} scale={pulse * grow} rotation={[0, verb === "spin" ? t * 1.2 : t * 0.15, 0]}>
      {split > 0 ? [one(-split * L * 0.55, "a"), one(split * L * 0.55, "b")] : one(0, "a")}
    </group>
  );
};
