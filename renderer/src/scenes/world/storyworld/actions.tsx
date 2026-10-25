// What a person does on top of the clip they play (fyt/director.py plan_actions): turning their head to
// whoever matters, raising a camera to their eye, pointing, talking with their hands, waving, holding
// a prop, a shift of weight while they stand and a start when something is revealed. The clip plays as
// before; these act on its bones afterwards, in world space, so the same acts drive any rigged body
// (a library outfit, the character kit) whatever its bones are called or which way they point.
import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PartMesh } from "./parts";
import type { Look } from "./style";
import type { Act, Build } from "./types";

type Arm = { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone };
export type Rig = { head?: THREE.Bone; neck?: THREE.Bone; spine?: THREE.Bone; r?: Arm; l?: Arm; rest: Map<THREE.Bone, THREE.Quaternion>; headScale?: THREE.Vector3 };

// Bone names across the rigs in use: the library outfits (UpperArm.R, LowerArm.R, Palm.R), the kit
// (upperarm_r, lowerarm_r, hand_r), Mixamo (mixamorigRightArm, RightForeArm, RightHand); GLTFLoader
// drops the dots.
const SIDE = { r: "(r|right)", l: "(l|left)" };
const find = (bones: THREE.Bone[], ...res: RegExp[]) => {
  for (const re of res) {
    const b = bones.find((x) => re.test(x.name.replace(/^mixamorig[:_]?/i, "")));
    if (b) return b;
  }
  return undefined;
};
const armOf = (bones: THREE.Bone[], s: "r" | "l"): Arm | undefined => {
  const S = SIDE[s];
  const upper = find(bones, new RegExp(`^upper_?arm[._]?${S}$`, "i"), new RegExp(`^${S}_?arm$`, "i"), new RegExp(`^arm[._]?${S}$`, "i"));
  const lower = find(bones, new RegExp(`^(lower_?arm|fore_?arm)[._]?${S}$`, "i"), new RegExp(`^${S}_?fore_?arm$`, "i"));
  const hand = find(bones, new RegExp(`^(palm|hand|wrist)[._]?${S}$`, "i"), new RegExp(`^${S}_?hand$`, "i"));
  return upper && lower && hand ? { upper, lower, hand } : undefined;
};

export const rigOf = (root: THREE.Object3D): Rig | null => {
  const bones: THREE.Bone[] = [];
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) bones.push(n as THREE.Bone);
  });
  if (!bones.length) return null;
  const head = find(bones, /^head$/i, /^head[._]?(jnt|bone)?$/i);
  const neck = find(bones, /^neck$/i, /^neck_?0?1$/i);
  const spine = find(bones, /^(torso|chest|spine_?0?2|spine2|upper_?chest)$/i, /^spine_?0?1$|^spine1$/i, /^spine$/i, /^abdomen$/i);
  const rig: Rig = { head, neck, spine, r: armOf(bones, "r"), l: armOf(bones, "l"), rest: new Map() };
  for (const b of [head, neck, spine, rig.r?.upper, rig.r?.lower, rig.r?.hand, rig.l?.upper, rig.l?.lower, rig.l?.hand]) if (b) rig.rest.set(b, b.quaternion.clone());
  if (head) rig.headScale = head.scale.clone();
  return rig;
};

// Back to the bind pose before the clip is applied, so a bone the clip leaves alone doesn't keep last
// frame's act on top of this one's.
export const resetRig = (rig: Rig | null) => {
  if (!rig) return;
  rig.rest.forEach((q, b) => b.quaternion.copy(q));
  if (rig.head && rig.headScale) rig.head.scale.copy(rig.headScale);
};

const _q = new THREE.Quaternion();
const _p = new THREE.Quaternion();
// Turn a bone by a rotation given in world space.
const turnWorld = (bone: THREE.Object3D, q: THREE.Quaternion) => {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_p);
  _q.copy(_p).invert();
  bone.quaternion.premultiply(_p).premultiply(q).premultiply(_q);
  bone.updateMatrixWorld(true);
};
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

// Two-bone reach: the elbow bends until shoulder to hand spans the distance to the target, the arm
// swings to it, and turns about that line so the elbow points at the pole (down and out). Blended
// with the clip's own pose by w.
const reach = (arm: Arm, target: THREE.Vector3, pole: THREE.Vector3, w: number) => {
  if (w <= 0) return;
  const q0u = arm.upper.quaternion.clone(), q0l = arm.lower.quaternion.clone();
  const S = at(arm.upper), E = at(arm.lower), H = at(arm.hand);
  const a = S.distanceTo(E), b = E.distanceTo(H);
  if (a < 1e-5 || b < 1e-5) return;
  const c = Math.min(a + b - 1e-4 * (a + b), Math.max(Math.abs(a - b) + 1e-4, S.distanceTo(target)));
  const se = E.clone().sub(S), eh = H.clone().sub(E);
  const cur = Math.PI - se.angleTo(eh);
  const want = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b))));
  let axis = se.clone().cross(eh);
  if (axis.lengthSq() < 1e-10) axis = se.clone().cross(pole);
  if (axis.lengthSq() < 1e-10) axis = se.clone().cross(new THREE.Vector3(0, 0, 1));
  axis.normalize();
  turnWorld(arm.lower, new THREE.Quaternion().setFromAxisAngle(axis, cur - want));
  const H1 = at(arm.hand);
  turnWorld(arm.upper, new THREE.Quaternion().setFromUnitVectors(H1.sub(S).normalize(), target.clone().sub(S).normalize()));
  // the elbow towards the pole, about the shoulder-to-hand line
  const n = target.clone().sub(S).normalize();
  const e = at(arm.lower).sub(S);
  e.sub(n.clone().multiplyScalar(e.dot(n)));
  const p = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n)));
  if (e.lengthSq() > 1e-10 && p.lengthSq() > 1e-10) {
    const ang = Math.atan2(e.clone().cross(p).dot(n), e.dot(p));
    turnWorld(arm.upper, new THREE.Quaternion().setFromAxisAngle(n, ang));
  }
  if (w < 1) {
    arm.upper.quaternion.copy(q0u.slerp(arm.upper.quaternion.clone(), w));
    arm.lower.quaternion.copy(q0l.slerp(arm.lower.quaternion.clone(), w));
    arm.upper.updateMatrixWorld(true);
  }
};

// The head (and with less of it, the neck) turned to look at a point, no further than a person turns
// without moving their feet.
const lookAt = (rig: Rig, target: THREE.Vector3, fwd: THREE.Vector3, w: number) => {
  const head = rig.head;
  if (!head || w <= 0) return;
  const d = target.clone().sub(at(head));
  const flat = Math.hypot(d.x, d.z);
  if (flat < 1e-4) return;
  let yaw = Math.atan2(fwd.z * d.x - fwd.x * d.z, fwd.x * d.x + fwd.z * d.z);
  yaw = Math.max(-1.15, Math.min(1.15, -yaw));
  const pitch = Math.max(-0.45, Math.min(0.4, Math.atan2(d.y, flat)));
  const parts: [THREE.Bone | undefined, number][] = rig.neck ? [[rig.neck, 0.4], [head, 0.6]] : [[head, 1]];
  for (const [b, k] of parts) {
    if (!b) continue;
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * k * w);
    const right = side.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(right, pitch * k * w));
    turnWorld(b, q);
  }
};

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export type ActState = {
  act: Act;
  // seconds into the scene, and since the act's cue (negative before it)
  t: number;
  since: number;
  // when the scene's reveal comes, seconds since it (negative before it)
  reveal: number;
  fwd: THREE.Vector3;
  height: number;
  target?: THREE.Vector3; // the face of whoever they look at or act on
  phase: number;
};

// Apply the acts to a posed body. Returns where a held prop goes (world position and facing), if any.
export const perform = (rig: Rig | null, s: ActState): { at: THREE.Vector3; fwd: THREE.Vector3 } | null => {
  if (!rig) return null;
  const { act, height: h } = s;
  const up = new THREE.Vector3(0, 1, 0);
  // which way the body faces, from its own shoulders (a model's forward axis is its own business)
  const fwd = s.fwd.clone();
  if (rig.r && rig.l) {
    const across = at(rig.r.upper).sub(at(rig.l.upper)).setY(0);
    if (across.lengthSq() > 1e-8) fwd.copy(up.clone().cross(across).normalize());
  }
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  // a child's head is larger for its body than an adult's
  if (act.child && rig.head) rig.head.scale.multiplyScalar(1.14);
  // standing: the weight moves from foot to foot, the shoulders breathe
  if (rig.spine && (act.secondary === "idle_shift" || act.secondary === "react")) {
    const q = new THREE.Quaternion().setFromAxisAngle(up, Math.sin(s.t * 0.45 + s.phase) * 0.07);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(fwd, Math.sin(s.t * 0.31 + s.phase * 2) * 0.035));
    turnWorld(rig.spine, q);
  }
  // a start at the reveal: a lean back that settles
  if (rig.spine && act.secondary === "react" && s.reveal > 0) {
    const jolt = Math.exp(-s.reveal * 2.2) * ease(s.reveal / 0.18);
    turnWorld(rig.spine, new THREE.Quaternion().setFromAxisAngle(right, -0.16 * jolt));
  }
  const on = act.gesture ? ease(s.since / 0.5) : 0;
  const g = act.gesture;
  const head = rig.head ? at(rig.head) : null;
  let prop: { at: THREE.Vector3; fwd: THREE.Vector3 } | null = null;
  // down and out behind: where elbows point
  const pole = (side: number) => fwd.clone().multiplyScalar(-0.4).add(up.clone().multiplyScalar(-1)).add(right.clone().multiplyScalar(0.5 * side)).normalize();
  if (head && rig.r) {
    const chest = head.clone().add(up.clone().multiplyScalar(-0.3 * h * 0.57));
    if ((g === "aim" || g === "hold" || act.prop) && rig.l) {
      // a prop carried at the chest, raised to the eye on the cue
      const raise = g === "aim" ? on : 0;
      const eye = head.clone().add(fwd.clone().multiplyScalar(0.11 * h)).add(up.clone().multiplyScalar(-0.015 * h));
      const low = chest.clone().add(fwd.clone().multiplyScalar(0.2 * h)).add(up.clone().multiplyScalar(-0.07 * h));
      const c = low.lerp(eye, raise);
      const hold = act.prop ? 1 : on;
      reach(rig.r, c.clone().add(right.clone().multiplyScalar(0.05 * h)), pole(1), hold);
      reach(rig.l, c.clone().add(right.clone().multiplyScalar(-0.05 * h)), pole(-1), hold);
      prop = { at: c, fwd };
    } else if (g === "point" && s.target) {
      const S = at(rig.r.upper);
      const dir = s.target.clone().sub(S).normalize();
      reach(rig.r, S.clone().add(dir.multiplyScalar(0.36 * h)), pole(1), on);
    } else if (g === "talk") {
      const beat = Math.sin(s.t * 2.6 + s.phase) * 0.5 + 0.5;
      const T = chest.clone().add(fwd.clone().multiplyScalar(0.17 * h)).add(right.clone().multiplyScalar((0.1 + 0.04 * Math.sin(s.t * 1.7)) * h)).add(up.clone().multiplyScalar(0.03 * h * beat));
      reach(rig.r, T, pole(1), on * (0.55 + 0.45 * beat));
    } else if (g === "wave") {
      const S = at(rig.r.upper);
      const T = S.clone().add(up.clone().multiplyScalar(0.3 * h)).add(right.clone().multiplyScalar((0.1 + 0.06 * Math.sin(s.t * 8)) * h)).add(fwd.clone().multiplyScalar(0.05 * h));
      reach(rig.r, T, pole(1).add(up.clone().multiplyScalar(1.4)).normalize(), on);
    }
  }
  // eyes on whoever they act on or watch: through the viewfinder when aiming
  if (s.target) {
    const w = act.secondary === "react" && s.reveal > -0.2 ? Math.max(0.6, ease((s.reveal + 0.2) / 0.3)) : g === "aim" ? 1 : 0.75;
    lookAt(rig, s.target, fwd, w);
  }
  return prop;
};

// A held prop drawn where perform() put it: a hand-sized copy of its build, facing the way they face.
export const HeldProp: React.FC<{ build: Build; look: Look; size: number; spot: React.MutableRefObject<{ at: THREE.Vector3; fwd: THREE.Vector3 } | null> }> = ({ build, look, size, spot }) => {
  const ref = useRef<THREE.Group>(null);
  const fit = useMemo(() => {
    const box = new THREE.Box3();
    build.parts.forEach((p) => {
      box.expandByPoint(new THREE.Vector3(p.at[0] - p.size[0] / 2, p.at[1] - p.size[1] / 2, p.at[2] - p.size[2] / 2));
      box.expandByPoint(new THREE.Vector3(p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2, p.at[2] + p.size[2] / 2));
    });
    const sz = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    return { k: size / Math.max(1e-3, sz.x, sz.y, sz.z), c: box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()) };
  }, [build, size]);
  useFrame(() => {
    const g = ref.current;
    if (!g || !g.parent) return;
    const s = spot.current;
    g.visible = Boolean(s);
    if (!s) return;
    g.parent.updateWorldMatrix(true, false);
    g.position.copy(g.parent.worldToLocal(s.at.clone()));
    const yaw = Math.atan2(-s.fwd.z, s.fwd.x);
    const pq = g.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    g.quaternion.copy(pq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)));
  });
  return (
    <group ref={ref} visible={false}>
      <group scale={fit.k}>
        <group position={[-fit.c.x, -fit.c.y, -fit.c.z]}>
          {build.parts.map((p, i) => (
            <PartMesh key={i} part={p} look={look} />
          ))}
        </group>
      </group>
    </group>
  );
};

// An outfit painted in the build's colour (a blue dress where the library's is red): its clothing
// materials, never skin, hair, eyes or shoes.
const CLOTH = /dress|shirt|top|jacket|coat|cloth|outfit|suit|body_?mat/i;
const NOT_CLOTH = /skin|hair|eye|brow|lash|teeth|tongue|shoe|boot|beard/i;
export const paint = (root: THREE.Object3D, color: string) => {
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    mats.forEach((m) => {
      if (m.color && CLOTH.test(m.name) && !NOT_CLOTH.test(m.name)) m.color = new THREE.Color(color);
    });
  });
};
