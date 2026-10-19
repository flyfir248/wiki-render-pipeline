// The person generator: a rigged body built from a design (fyt/worldgen.py Build with an Outfit) at its
// own height, build and age, dressed in its own top, bottom, hair and accessories, and posed by verbs.
// Facing +x, up +y, its right side +z. Joints swing forward with +z rotation; a raised right arm is -x.
import React from "react";
import * as THREE from "three";
import { Block, PartMesh, unitGeometry } from "./parts";
import { type Look, material } from "./style";
import type { Build, Part, State } from "./types";

export type Limb = [number, number, number]; // [abduct (x), twist (y), swing (z)]
export type Pose = {
  y: number; // hips height offset, metres
  pitch: number; // whole body about z: +90 deg lies on its back, head to -x
  roll: number; // whole body about x
  lean: number; // spine about z, negative leans forward
  twist: number;
  head: [number, number, number];
  armL: Limb;
  armR: Limb;
  elbowL: number;
  elbowR: number;
  legL: Limb;
  legR: Limb;
  kneeL: number;
  kneeR: number;
  jaw: number;
};

export const rest = (): Pose => ({
  y: 0, pitch: 0, roll: 0, lean: 0, twist: 0, head: [0, 0, 0], armL: [0.08, 0, 0], armR: [-0.08, 0, 0], elbowL: 0.12, elbowR: 0.12,
  legL: [0, 0, 0], legR: [0, 0, 0], kneeL: 0, kneeR: 0, jaw: 0,
});

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export type Dims = { H: number; thigh: number; shin: number; hip: number; torso: number; tw: number; td: number; head: number; upper: number; fore: number; shoulder: number; hipW: number };

export const dimsOf = (b: Build): Dims => {
  const H = Math.max(0.5, b.size);
  const child = b.body.age === "child";
  // heads a little larger than life, so faces read on a phone
  const head = H * (child ? 0.2 : 0.155) * (0.85 + 0.3 * b.body.head);
  const legs = H * (child ? 0.42 : 0.47) * (0.9 + 0.2 * b.body.legs);
  const torso = H * 0.3;
  const tw = H * (0.2 + 0.09 * b.body.build);
  return {
    H, head, thigh: legs * 0.52, shin: legs * 0.48, hip: legs, torso, tw, td: H * 0.115 * (1 + 0.6 * b.body.build),
    upper: H * 0.17, fore: H * 0.16, shoulder: tw / 2 + H * 0.03, hipW: tw * 0.27,
  };
};

// Verbs: what each one does to the joints. `phase` is the gait cycle (radians, from distance walked),
// `t` seconds, `k` seconds since the scene's key moment (negative before it).
export const humanPose = (verb: string, t: number, phase: number, k: number, d: Dims, state: State): Pose => {
  const p = rest();
  const breathe = Math.sin(t * 2.1) * 0.02;
  p.lean = breathe;
  p.head = [0, Math.sin(t * 0.7) * 0.12, 0];
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  switch (verb) {
    case "walk":
    case "carry": {
      const sw = 0.48;
      p.legL[2] = s * sw;
      p.legR[2] = -s * sw;
      p.kneeL = -Math.max(0, -c) * 0.7 - 0.05;
      p.kneeR = -Math.max(0, c) * 0.7 - 0.05;
      p.armL[2] = -s * 0.42;
      p.armR[2] = s * 0.42;
      p.y = Math.abs(c) * d.H * 0.012 - d.H * 0.01;
      p.lean = -0.06;
      if (verb === "carry") {
        p.armL = [0.15, 0, 0.95];
        p.armR = [-0.15, 0, 0.95];
        p.elbowL = p.elbowR = 0.7;
      }
      break;
    }
    case "run": {
      const sw = 0.95;
      p.legL[2] = s * sw;
      p.legR[2] = -s * sw;
      p.kneeL = -(0.4 + Math.max(0, -c) * 1.3);
      p.kneeR = -(0.4 + Math.max(0, c) * 1.3);
      p.armL[2] = -s * 0.9;
      p.armR[2] = s * 0.9;
      p.elbowL = p.elbowR = 1.5;
      p.lean = -0.32;
      p.y = Math.abs(c) * d.H * 0.04;
      break;
    }
    case "sit":
    case "drive": {
      p.legL[2] = p.legR[2] = 1.45;
      p.kneeL = p.kneeR = -1.35;
      p.y = -(d.thigh + d.shin) + d.shin * 0.95;
      p.lean = 0.05 + breathe;
      if (verb === "drive") {
        p.armL = [0.2, 0, 1.1];
        p.armR = [-0.2, 0, 1.1];
        p.elbowL = p.elbowR = 0.5;
      } else {
        p.armL[2] = p.armR[2] = 0.45;
        p.elbowL = p.elbowR = 0.6;
      }
      break;
    }
    case "talk":
      p.armR = [-0.15, 0, 0.5 + Math.sin(t * 3.1) * 0.25];
      p.elbowR = 1.1 + Math.sin(t * 4.3) * 0.3;
      p.armL = [0.12, 0, 0.25 + Math.sin(t * 2.3 + 1) * 0.15];
      p.elbowL = 0.8;
      p.head = [Math.sin(t * 1.3) * 0.06, Math.sin(t * 0.9) * 0.15, Math.sin(t * 5) * 0.06];
      p.jaw = Math.max(0, Math.sin(t * 11)) * 0.25;
      break;
    case "point":
      p.armR = [-0.1, 0, 1.45 * ease((t - 0.2) * 2)];
      p.elbowR = 0.05;
      p.head = [0, 0, 0.05];
      break;
    case "wave":
      p.armR = [-2.5, 0, 0.25 + Math.sin(t * 8) * 0.35];
      p.elbowR = 0.35;
      break;
    case "look_around":
      p.head = [0, Math.sin(t * 1.1) * 0.9, -0.05];
      p.twist = Math.sin(t * 1.1) * 0.2;
      break;
    case "crouch":
      p.legL[2] = p.legR[2] = 1.1;
      p.kneeL = p.kneeR = -2.0;
      p.y = -d.hip * 0.42;
      p.lean = -0.45;
      p.armL[2] = p.armR[2] = 0.6;
      p.elbowL = p.elbowR = 0.9;
      break;
    case "pick_up": {
      const b = ease(1 - Math.abs(k) / 0.8);
      p.lean = -1.05 * b;
      p.legL[2] = p.legR[2] = 0.5 * b;
      p.kneeL = p.kneeR = -0.8 * b;
      p.y = -d.hip * 0.15 * b;
      p.armL[2] = p.armR[2] = 0.9 * b;
      p.elbowL = p.elbowR = 0.1;
      break;
    }
    case "panic":
      p.armL = [1.8 + Math.sin(t * 13) * 0.4, 0, 0.6];
      p.armR = [-1.8 - Math.sin(t * 13 + 1) * 0.4, 0, 0.6];
      p.elbowL = p.elbowR = 0.6;
      p.legL[2] = Math.sin(t * 14) * 0.25;
      p.legR[2] = -Math.sin(t * 14) * 0.25;
      p.head = [Math.sin(t * 9) * 0.2, Math.sin(t * 6) * 0.5, 0.15];
      p.y = Math.abs(Math.sin(t * 14)) * d.H * 0.02;
      p.jaw = 0.35;
      break;
    case "cheer":
      p.armL = [2.6, 0, 0.3];
      p.armR = [-2.6, 0, 0.3];
      p.elbowL = p.elbowR = 0.2;
      p.y = Math.max(0, Math.sin(t * 7)) * d.H * 0.08;
      p.jaw = 0.3;
      break;
    case "phone":
      p.armR = [-0.35, 0, 0.35];
      p.elbowR = 2.55;
      p.head = [0.12, 0, -0.08];
      break;
    case "eat":
      p.armR = [-0.2, 0, 0.6];
      p.elbowR = 1.7 + Math.sin(t * 3) * 0.35;
      p.head = [0, 0, -0.2];
      p.jaw = Math.max(0, Math.sin(t * 9)) * 0.3;
      break;
    case "work":
      p.armL = [0.15, 0, 0.75 + Math.sin(t * 6) * 0.12];
      p.armR = [-0.15, 0, 0.75 + Math.sin(t * 6 + 2) * 0.12];
      p.elbowL = p.elbowR = 0.9;
      p.lean = -0.25;
      p.head = [0, 0, -0.35];
      break;
    case "swim":
      p.pitch = -1.35;
      p.armL[2] = (t * 4) % (Math.PI * 2);
      p.armR[2] = (t * 4 + Math.PI) % (Math.PI * 2);
      p.legL[2] = Math.sin(t * 9) * 0.25;
      p.legR[2] = -Math.sin(t * 9) * 0.25;
      p.y = -d.hip * 0.95;
      break;
    case "fall": {
      const f = ease((k + 0.15) / 0.55);
      p.pitch = 1.5 * f;
      p.y = -d.hip * f + d.td * 0.5 * f;
      p.armL = [0.6 * f + 0.08, 0, 1.2 * f];
      p.armR = [-0.6 * f - 0.08, 0, 1.2 * f];
      p.legL[2] = 0.3 * (1 - f);
      p.kneeR = -0.4 * (1 - f);
      break;
    }
    case "lie":
    case "sleep":
      p.pitch = Math.PI / 2;
      p.y = -d.hip + d.td * 0.5;
      p.armL = [0.25, 0, 0.1];
      p.armR = [-0.25, 0, 0.1];
      p.legL[0] = 0.08;
      p.legR[0] = -0.08;
      p.head = [0, verb === "sleep" ? 0.5 : 0.25, 0];
      p.lean = breathe * 0.5;
      break;
    default: // idle
      p.armL[2] = Math.sin(t * 1.3) * 0.04;
      p.armR[2] = -Math.sin(t * 1.3) * 0.04;
  }
  if (state === "dazed") {
    p.roll += Math.sin(t * 2.3) * 0.12;
    p.head[0] += Math.sin(t * 3.1) * 0.25;
    p.lean += Math.sin(t * 1.7) * 0.08;
  }
  if (state === "injured" && (verb === "walk" || verb === "run")) {
    p.kneeR = Math.max(p.kneeR, -0.15);
    p.roll += Math.sin(phase) * 0.06;
  }
  return p;
};

const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();
const LONG = ["shirt", "jacket", "coat", "uniform", "suit", "hoodie", "labcoat", "spacesuit", "armour", "robe", "dress"];

type BodyProps = { build: Build; look: Look; pose: Pose; t: number; state: State; held?: Build };

// A torso that tapers from the shoulders to the waist, rounded over the top: 1 x 1 x 1, base at y = 0.
let torsoGeo: THREE.BufferGeometry | null = null;
const torsoGeometry = () => {
  if (torsoGeo) return torsoGeo;
  const prof = [[0.0, 0], [0.4, 0], [0.42, 0.12], [0.44, 0.35], [0.5, 0.62], [0.52, 0.8], [0.48, 0.92], [0.36, 0.99], [0.0, 1.02]].map(([r, y]) => new THREE.Vector2(r, y));
  torsoGeo = new THREE.LatheGeometry(prof, 28);
  torsoGeo.computeVertexNormals();
  return torsoGeo;
};

export const Humanoid: React.FC<BodyProps> = ({ build, look, pose, t, state, held }) => {
  const d = dimsOf(build);
  const o = build.outfit ?? { top: "shirt", bottom: "trousers", hair: "short", beard: false, glasses: false };
  const wet = state === "wet" ? 0.72 : 1;
  const dim = (c: string) => (wet < 1 ? tone(c, wet) : c);
  const skin = dim(build.skin || "#e0ac84");
  const hairC = dim(build.body.age === "elder" && !build.hair ? "#b8b8b8" : build.hair || "#3a2a1c");
  const top = dim(o.top === "labcoat" ? "#f2f4f4" : o.top === "spacesuit" ? "#eef0f2" : build.primary);
  const bottom = dim(o.top === "spacesuit" ? "#e2e4e8" : build.secondary);
  const shoe = "#26262a";
  const blocky = look.blocky;
  const limb: Part["shape"] = blocky ? "box" : "capsule";
  const sleeve = LONG.includes(o.top) ? top : skin;
  const upperC = o.top === "vest" ? skin : top;
  const shinC = o.bottom === "trousers" ? bottom : skin;
  const thighC = o.bottom === "trousers" || o.bottom === "shorts" ? bottom : o.top === "dress" || o.top === "robe" ? top : skin;
  const lw = d.tw * 0.36; // limb width
  const arm = d.tw * 0.27;
  const parts = (bone: Part["bone"]) => build.parts.filter((p) => p.bone === bone).map((p, i) => <PartMesh key={`${bone}${i}`} part={p} look={look} />);
  const legs = ([1, -1] as const).map((side) => {
    const L = side > 0 ? pose.legR : pose.legL;
    const knee = side > 0 ? pose.kneeR : pose.kneeL;
    return (
      <group key={side} position={[0, 0, side * d.hipW]} rotation={[L[0], L[1], L[2]]}>
        <Block look={look} shape={limb} color={thighC} size={[lw, d.thigh * (blocky ? 1 : 0.95), lw]} at={[0, -d.thigh / 2, 0]} />
        <group position={[0, -d.thigh, 0]} rotation={[0, 0, knee]}>
          <Block look={look} shape={limb} color={shinC} size={[lw * 0.9, d.shin * (blocky ? 1 : 0.95), lw * 0.9]} at={[0, -d.shin / 2, 0]} />
          <Block look={look} shape={blocky ? "box" : "sphere"} color={shoe} size={[lw * 1.7, lw * 0.6, lw * 1.05]} at={[lw * 0.35, -d.shin + lw * 0.2, 0]} />
        </group>
      </group>
    );
  });
  const arms = ([1, -1] as const).map((side) => {
    const A = side > 0 ? pose.armR : pose.armL;
    const elbow = side > 0 ? pose.elbowR : pose.elbowL;
    return (
      <group key={side} position={[0, d.torso - arm * 0.5, side * d.shoulder]} rotation={[A[0], A[1], A[2]]}>
        <Block look={look} shape={limb} color={upperC} size={[arm, d.upper, arm]} at={[0, -d.upper / 2, 0]} />
        <group position={[0, -d.upper, 0]} rotation={[0, 0, elbow]}>
          <Block look={look} shape={limb} color={sleeve} size={[arm * 0.92, d.fore, arm * 0.92]} at={[0, -d.fore / 2, 0]} />
          <group position={[0, -d.fore - arm * 0.3, 0]}>
            <Block look={look} shape={blocky ? "box" : "sphere"} color={skin} size={[arm * 1.1, arm * 1.2, arm * 0.9]} />
            {parts(side > 0 ? "hand_r" : "hand_l")}
            {side > 0 && held ? <Held build={held} look={look} reach={d.H} /> : null}
            {side > 0 && pose.elbowR > 2.2 && !held && !build.parts.some((p) => p.bone === "hand_r") ? (
              // a raised hand at the ear holds a phone
              <Block look={look} color="#1d1f24" size={[arm * 0.35, arm * 2.2, arm * 1.1]} at={[arm * 0.35, arm * 0.6, 0]} />
            ) : null}
          </group>
        </group>
      </group>
    );
  });
  const hs = d.head;
  const face = hs * 0.5;
  const headShape: Part["shape"] = blocky ? "box" : "sphere";
  const hair = (() => {
    const out: React.ReactNode[] = [];
    const cap = (color: string, h = 0.32) => <Block key="cap" look={look} shape={blocky ? "box" : "sphere"} color={color} size={[hs * 1.04, hs * h * 2, hs * 1.04]} at={[-hs * 0.04, hs * (0.5 - h) + hs * 0.08, 0]} />;
    switch (o.hair) {
      case "bald":
        break;
      case "long":
        out.push(cap(hairC, 0.36), <Block key="back" look={look} color={hairC} size={[hs * 0.28, hs * 1.2, hs * 0.98]} at={[-hs * 0.42, -hs * 0.15, 0]} />);
        break;
      case "bun":
        out.push(cap(hairC), <Block key="bun" look={look} shape={blocky ? "box" : "sphere"} color={hairC} size={[hs * 0.42, hs * 0.42, hs * 0.42]} at={[-hs * 0.45, hs * 0.38, 0]} />);
        break;
      case "ponytail":
        out.push(cap(hairC), <Block key="tail" look={look} shape={limb} color={hairC} size={[hs * 0.2, hs * 0.75, hs * 0.2]} at={[-hs * 0.6, -hs * 0.12, 0]} rot={[0, 0, 0.35]} />);
        break;
      case "curly":
        out.push(<Block key="curl" look={look} shape={blocky ? "box" : "sphere"} color={hairC} size={[hs * 1.18, hs * 0.75, hs * 1.18]} at={[-hs * 0.06, hs * 0.3, 0]} />);
        break;
      case "cap":
        out.push(cap(hairC, 0.26), <Block key="crown" look={look} shape={blocky ? "box" : "sphere"} color={build.accent} size={[hs * 1.06, hs * 0.42, hs * 1.06]} at={[-hs * 0.02, hs * 0.36, 0]} />,
          <Block key="brim" look={look} color={build.accent} size={[hs * 0.55, hs * 0.05, hs * 0.8]} at={[hs * 0.5, hs * 0.22, 0]} />);
        break;
      case "hat":
        out.push(cap(hairC, 0.26), <Block key="brim" look={look} shape={blocky ? "box" : "cylinder"} color={build.accent} size={[hs * 1.75, hs * 0.05, hs * 1.75]} at={[0, hs * 0.3, 0]} />,
          <Block key="crown" look={look} shape={blocky ? "box" : "cylinder"} color={build.accent} size={[hs * 0.95, hs * 0.42, hs * 0.95]} at={[0, hs * 0.5, 0]} />);
        break;
      case "helmet":
        out.push(<Block key="helm" look={look} shape={blocky ? "box" : "sphere"} color={o.top === "spacesuit" ? "#f2f2f2" : build.accent} size={[hs * 1.3, hs * 1.25, hs * 1.3]} at={[-hs * 0.02, hs * 0.08, 0]} />);
        if (o.top === "spacesuit") out.push(<Block key="visor" look={look} shape={blocky ? "box" : "sphere"} color="#ffcf6a" size={[hs * 0.4, hs * 0.7, hs * 1.0]} at={[hs * 0.48, hs * 0.02, 0]} glow />);
        break;
      case "hood":
        out.push(<Block key="hood" look={look} shape={blocky ? "box" : "sphere"} color={top} size={[hs * 1.22, hs * 1.22, hs * 1.22]} at={[-hs * 0.12, hs * 0.08, 0]} />);
        break;
      case "scarf":
        out.push(cap(hairC), <Block key="scarf" look={look} shape="torus" color={build.accent} size={[hs * 0.9, hs * 0.9, hs * 0.25]} at={[0, -hs * 0.58, 0]} rot={[Math.PI / 2, 0, 0]} />);
        break;
      default:
        out.push(cap(hairC));
    }
    return out;
  })();
  const extras: React.ReactNode[] = [];
  if (o.top === "uniform") {
    extras.push(<Block key="belt" look={look} color={tone(build.secondary, 0.6)} size={[d.td * 1.04, d.H * 0.035, d.tw * 1.02]} at={[0, d.H * 0.02, 0]} />,
      <Block key="badge" look={look} color={build.accent} size={[d.td * 0.1, d.H * 0.04, d.H * 0.03]} at={[d.td * 0.52, d.torso * 0.72, -d.tw * 0.25]} />);
  }
  if (o.top === "suit") {
    extras.push(<Block key="collar" look={look} color="#f2f2f0" size={[d.td * 0.1, d.torso * 0.35, d.tw * 0.3]} at={[d.td * 0.5, d.torso * 0.8, 0]} />,
      <Block key="tie" look={look} color={build.accent} size={[d.td * 0.12, d.torso * 0.6, d.tw * 0.1]} at={[d.td * 0.53, d.torso * 0.62, 0]} />);
  }
  if (o.top === "hoodie") extras.push(<Block key="hood" look={look} shape={blocky ? "box" : "sphere"} color={top} size={[d.td * 0.7, d.torso * 0.35, d.tw * 0.7]} at={[-d.td * 0.45, d.torso * 0.92, 0]} />);
  if (o.top === "scrubs" || o.top === "labcoat") extras.push(<Block key="pocket" look={look} color={tone(top, 0.85)} size={[d.td * 0.08, d.torso * 0.16, d.tw * 0.22]} at={[d.td * 0.51, d.torso * 0.68, -d.tw * 0.25]} />);
  const skirtLen = o.top === "robe" ? d.hip * 0.95 : o.top === "labcoat" || o.top === "coat" ? d.hip * 0.72 : o.top === "dress" ? d.hip * 0.55 : o.bottom === "skirt" ? d.hip * 0.45 : 0;
  const skirtC = o.top === "robe" || o.top === "dress" || o.top === "labcoat" || o.top === "coat" ? top : bottom;
  return (
    <group position={[0, d.hip + pose.y, 0]} rotation={[pose.roll, 0, pose.pitch]}>
      {legs}
      {parts("hips")}
      {skirtLen ? (
        o.top === "labcoat" || o.top === "coat" ? (
          // a coat's tails hang straight from the waist, as wide as the torso
          <Block look={look} shape={blocky ? "box" : "cylinder"} color={skirtC} size={[d.td * 1.12, skirtLen, d.tw * 1.08]} at={[-d.td * 0.04, -skirtLen / 2 + d.H * 0.02, 0]} />
        ) : (
          <Block look={look} shape={blocky ? "box" : "cone"} color={skirtC} size={[d.td * 1.5, skirtLen, d.tw * 1.35]} at={[0, -skirtLen / 2 + d.H * 0.02, 0]} rot={blocky ? [0, 0, 0] : [Math.PI, 0, 0]} />
        )
      ) : null}
      <group rotation={[0, pose.twist, pose.lean]}>
        {blocky ? (
          <Block look={look} color={top} size={[d.td, d.torso, d.tw]} at={[0, d.torso / 2, 0]} />
        ) : (
          <mesh geometry={torsoGeometry()} material={material(look, top)} scale={[d.td, d.torso, d.tw]} castShadow receiveShadow />
        )}
        {!blocky ? <Block look={look} shape="sphere" color={top} size={[d.td * 1.02, d.td * 0.5, d.tw * 1.02]} at={[0, d.torso, 0]} /> : null}
        {extras}
        {arms}
        <group position={[0, d.torso / 2, 0]}>{parts("torso")}</group>
        <group position={[0, d.torso / 2, 0]}>{parts("back")}</group>
        <group position={[0, d.torso + hs * 0.7, 0]} rotation={pose.head}>
          <Block look={look} shape={blocky ? "box" : "cylinder"} color={skin} size={[hs * 0.35, hs * 0.3, hs * 0.35]} at={[0, -hs * 0.5, 0]} />
          <Block look={look} shape={headShape} color={skin} size={[hs * 0.92, hs * 1.02, hs * 0.86]} />
          {!blocky ? <Block look={look} shape="sphere" color={skin} size={[hs * 0.78, hs * 0.7, hs * 0.72]} at={[hs * 0.06, -hs * 0.2, 0]} /> : null}
          {/* face: eyes, brows, nose and mouth on the +x side, big enough to read on a phone */}
          {blocky ? (
            <>
              {[-1, 1].map((z) => (
                <React.Fragment key={z}>
                  <Block look={look} color="#15151a" size={[hs * 0.05, hs * 0.13, hs * 0.11]} at={[face * 0.86, hs * 0.08, z * hs * 0.19]} />
                  <Block look={look} color={tone(hairC, 0.9)} size={[hs * 0.05, hs * 0.04, hs * 0.17]} at={[face * 0.86, hs * 0.22, z * hs * 0.19]} />
                </React.Fragment>
              ))}
              <Block look={look} color={tone(skin, 0.86)} size={[hs * 0.14, hs * 0.14, hs * 0.1]} at={[face * 0.92, -hs * 0.02, 0]} />
              <group position={[face * 0.85, -hs * 0.2, 0]} rotation={[0, 0, -pose.jaw]}>
                <Block look={look} color="#5a2a28" size={[hs * 0.05, hs * 0.04 + pose.jaw * hs * 0.25, hs * 0.22]} />
              </group>
            </>
          ) : (
            <>
              {[-1, 1].map((z) => (
                <React.Fragment key={z}>
                  {/* an eye: white, a dark iris looking slightly toward the camera side, a lid shadow and a brow */}
                  <Block look={look} shape="sphere" color="#f4f1ec" size={[hs * 0.12, hs * 0.15, hs * 0.17]} at={[face * 0.8, hs * 0.07, z * hs * 0.19]} />
                  <Block look={look} shape="sphere" color="#231a14" size={[hs * 0.06, hs * 0.1, hs * 0.1]} at={[face * 0.88, hs * 0.065, z * hs * 0.19 + hs * 0.012]} />
                  <Block look={look} shape="sphere" color="#ffffff" glow size={[hs * 0.02, hs * 0.025, hs * 0.025]} at={[face * 0.91, hs * 0.095, z * hs * 0.19 + hs * 0.03]} />
                  <Block look={look} shape="capsule" color={tone(hairC, 0.9)} size={[hs * 0.045, hs * 0.16, hs * 0.045]} at={[face * 0.86, hs * 0.2, z * hs * 0.2]} rot={[Math.PI / 2 + z * 0.12, 0, 0]} />
                  {/* ears */}
                  <Block look={look} shape="sphere" color={tone(skin, 0.95)} size={[hs * 0.16, hs * 0.24, hs * 0.08]} at={[-hs * 0.02, hs * 0.0, z * hs * 0.45]} />
                </React.Fragment>
              ))}
              <Block look={look} shape="sphere" color={tone(skin, 0.95)} size={[hs * 0.16, hs * 0.2, hs * 0.13]} at={[face * 0.9, -hs * 0.03, 0]} />
              <group position={[face * 0.8, -hs * 0.21, 0]} rotation={[0, 0, -pose.jaw]}>
                <Block look={look} shape="capsule" color="#8a3b36" size={[hs * 0.05, hs * 0.2 + pose.jaw * hs * 0.1, hs * 0.05 + pose.jaw * hs * 0.2]} rot={[Math.PI / 2, 0, 0]} />
              </group>
              {/* cheeks, lightly flushed */}
              {[-1, 1].map((z) => <Block key={`c${z}`} look={look} shape="sphere" color={tone(skin, 1.04)} size={[hs * 0.1, hs * 0.12, hs * 0.14]} at={[face * 0.72, -hs * 0.08, z * hs * 0.24]} />)}
            </>
          )}
          {o.beard ? <Block look={look} color={hairC} size={[hs * 0.3, hs * 0.38, hs * 0.72]} at={[face * 0.72, -hs * 0.3, 0]} /> : null}
          {o.glasses
            ? [-1, 1].map((z) => <Block key={`g${z}`} look={look} shape="torus" color="#1a1a1e" size={[hs * 0.22, hs * 0.22, hs * 0.04]} at={[face * 0.95, hs * 0.08, z * hs * 0.19]} rot={[0, Math.PI / 2, 0]} />)
            : null}
          {hair}
          {state === "injured" ? <Block look={look} shape="torus" color="#f4f4f0" size={[hs * 0.95, hs * 0.95, hs * 0.14]} at={[0, hs * 0.18, 0]} rot={[Math.PI / 2, 0, 0.15]} /> : null}
          {state === "dazed" ? <Stars r={hs * 0.7} y={hs * 0.85} t={t} look={look} /> : null}
          {parts("head")}
        </group>
      </group>
      {state === "burning" ? <Flames size={d.H} t={t} look={look} /> : null}
    </group>
  );
};

// Something held in the right hand, scaled to what a hand can hold, hanging from the palm.
export const Held: React.FC<{ build: Build; look: Look; reach: number }> = ({ build, look, reach }) => {
  const box = new THREE.Box3();
  build.parts.forEach((p) => {
    box.expandByPoint(new THREE.Vector3(p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2, p.at[2] - p.size[2] / 2));
    box.expandByPoint(new THREE.Vector3(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2, p.at[2] + p.size[2] / 2));
  });
  const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
  const k = Math.min(1, (reach * 0.42) / Math.max(1e-3, size.x, size.y, size.z));
  const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return (
    <group scale={k} position={[0, -size.y * k * 0.5, 0]}>
      <group position={[-c.x, -c.y, -c.z]}>
        {build.parts.map((p, i) => (
          <PartMesh key={i} part={p} look={look} />
        ))}
      </group>
    </group>
  );
};

// Little stars circling a dazed head.
export const Stars: React.FC<{ r: number; y: number; t: number; look: Look }> = ({ r, y, t, look }) => (
  <group position={[0, y, 0]} rotation={[0, t * 3, 0]}>
    {[0, 1, 2].map((i) => (
      <Block key={i} look={look} shape="sphere" color="#ffd84a" glow size={[r * 0.16, r * 0.16, r * 0.16]} at={[Math.cos((i * Math.PI * 2) / 3) * r, Math.sin(t * 4 + i) * r * 0.1, Math.sin((i * Math.PI * 2) / 3) * r]} />
    ))}
  </group>
);

// Flickering flames over something burning.
export const Flames: React.FC<{ size: number; t: number; look: Look }> = ({ size, t, look }) => (
  <group>
    {[0, 1, 2, 3, 4].map((i) => {
      const f = 0.7 + 0.3 * Math.sin(t * 11 + i * 2.1);
      return (
        <mesh key={i} geometry={unitGeometry("cone", look)} material={material(look, i % 2 ? "#ffb02e" : "#ff5a1f", { glow: true, opacity: 0.85 })}
          position={[Math.sin(i * 2.4) * size * 0.12, size * (0.05 + 0.08 * i), Math.cos(i * 2.4) * size * 0.12]} scale={[size * 0.12 * f, size * 0.32 * f, size * 0.12 * f]} />
      );
    })}
  </group>
);
