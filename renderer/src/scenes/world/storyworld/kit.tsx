// A person from the character kit (fyt/kit.py): a ready-made rigged body with motion-captured clips
// from a library on the same skeleton, dressed by painting its regions (skin, top, trousers, shoes)
// from the build's colours, with hair or a hat on its head bone. Smooth, real motion in place of the
// generated jointed figure.
import React from "react";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Loaded } from "../stage";
import type { Build } from "./types";

export type Kit = { bodies: { m?: string; f?: string }; clips: string[] };

// The clip each verb plays, in order of preference, by the library's own names (UAL 1 and 2).
const KIT_CLIPS: [RegExp, string[]][] = [
  [/^(run|charge|chase|flee|panic|rush)$/, ["Sprint_Loop", "Jog_Fwd_Loop"]],
  [/^(walk|approach|depart|move|wander|patrol|follow|look_around)$/, ["Walk_Loop", "Walk_Formal_Loop"]],
  [/^carry$/, ["Walk_Carry_Loop", "Walk_Loop"]],
  [/^swim$/, ["Swim_Fwd_Loop", "Swim_Idle_Loop"]],
  [/^sit$/, ["Sitting_Idle_Loop", "Sitting_Talking_Loop"]],
  [/^talk$/, ["Idle_Talking_Loop", "Sitting_Talking_Loop"]],
  [/^(lie|die|dead|sleep|collapse)$/, ["Death01"]],
  [/^(fight|attack|punch|strike|roar|rear)$/, ["Punch_Cross", "Punch_Jab", "Melee_Hook"]],
  [/^(work|fix|repair|build|pick_up)$/, ["Fixing_Kneeling", "PickUp_Table", "Interact"]],
  [/^(wave|point|signal|call|shout|warn)$/, ["Idle_Rail_Call", "Interact"]],
  [/^phone$/, ["Idle_TalkingPhone_Loop"]],
  [/^drive$/, ["Driving_Loop"]],
  [/^crouch$/, ["Crouch_Idle_Loop", "Crouch_Fwd_Loop"]],
  [/^(fall|crash|shake|hit)$/, ["Hit_Knockback", "Hit_Chest"]],
  [/^cheer$/, ["Dance_Loop", "Yes"]],
  [/^climb$/, ["ClimbUp_1m_RM"]],
  [/^eat$/, ["Consume"]],
  [/.*/, ["Idle_Loop", "Idle_FoldArms_Loop", "Idle_Lantern_Loop"]],
];
const LOCOMOTION = /Walk|Jog|Sprint|Swim_Fwd|Crouch_Fwd/;

export const kitClip = (clips: THREE.AnimationClip[], verb: string) => {
  const ways = (KIT_CLIPS.find(([v]) => v.test(verb)) ?? KIT_CLIPS[KIT_CLIPS.length - 1])[1];
  for (const w of [...ways, "Idle_Loop"]) {
    const c = clips.find((x) => x.name === w || x.name.endsWith(`|${w}`));
    if (c) return c;
  }
  return clips.find((c) => /idle/i.test(c.name)) ?? null;
};

// Which part of the outfit a joint's skin belongs to.
const region = (joint: string) => {
  const j = joint.toLowerCase();
  if (/head|neck/.test(j)) return "skin";
  if (/hand|index|middle|pinky|ring|thumb/.test(j)) return "skin";
  if (/foot|ball|toe/.test(j)) return "shoe";
  if (/thigh|calf|shin|pelvis|hips/.test(j)) return "legs";
  return "top";
};

// Paints the mesh's regions; returns the box (in the mesh's own space) of the skin on its head bone.
const paint = (mesh: THREE.SkinnedMesh, colours: Record<string, THREE.Color>) => {
  const skull = new THREE.Box3();
  const v = new THREE.Vector3();
  const g = mesh.geometry.clone();
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) {
      const x = sw.getComponent(i, k);
      if (x > w) {
        w = x;
        best = si.getComponent(i, k);
      }
    }
    const c = colours[region(names[best] ?? "")];
    col.set([c.r, c.g, c.b], i * 3);
    if (/^head$/i.test(names[best] ?? "")) skull.expandByPoint(v.fromBufferAttribute(g.attributes.position, i));
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  mesh.geometry = g;
  return skull;
};

type Made = { root: THREE.Object3D; height: number; head: THREE.Object3D | null };

const dress = (body: Loaded, build: Build, envMap: THREE.Texture | null): Made => {
  const root = SkeletonUtils.clone(body.scene);
  const o = build.outfit;
  const coat = o?.top === "dress" || o?.top === "robe";
  const colours = {
    skin: new THREE.Color(build.skin || "#d9a77f"),
    top: new THREE.Color(build.primary),
    legs: new THREE.Color(coat ? build.primary : build.secondary),
    shoe: new THREE.Color("#2a2522"),
  };
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, envMap, envMapIntensity: 0.6 });
  let head: THREE.Object3D | null = null;
  const skulls: [THREE.Box3, THREE.Object3D][] = [];
  root.traverse((n) => {
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = n as THREE.SkinnedMesh;
      skulls.push([paint(m, colours), m]);
      m.material = cloth;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
    if (!head && /^head$/i.test(n.name)) head = n;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const height = Math.max(0.1, box.max.y - box.min.y);
  // the skull, where the body stands at rest (in the body's frame)
  const skull = new THREE.Box3();
  skulls.forEach(([b, m]) => !b.isEmpty() && skull.union(b.clone().applyMatrix4(m.matrixWorld)));
  if (head && !skull.isEmpty()) headwear(build, head, root, skull);
  return { root, height, head };
};

// Hair, a hat or a beard, made in the body's own upright frame and carried by the head bone.
const headwear = (build: Build, head: THREE.Object3D, root: THREE.Object3D, skull: THREE.Box3) => {
  const g = new THREE.Group();
  const o = build.outfit;
  const hair = new THREE.MeshStandardMaterial({ color: build.hair || "#3a2a1c", roughness: 0.9 });
  const size = skull.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z) * 0.5; // the skull's half-width
  const top = size.y * 0.5; // from its middle to its crown
  if (o?.hair === "hat") {
    const felt = new THREE.MeshStandardMaterial({ color: build.accent && build.accent !== build.skin ? build.accent : "#2b2420", roughness: 0.85 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.02, top * 0.75, 24), felt);
    crown.position.y = top * 0.6;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.65, r * 1.65, top * 0.07, 32), felt);
    brim.position.y = top * 0.24;
    g.add(crown, brim);
  } else if (o?.hair !== "bald") {
    const long = o?.hair === "long";
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, long ? Math.PI * 0.62 : Math.PI * 0.5), hair);
    cap.position.set(0, top * 0.12, -r * 0.06);
    cap.scale.set(r * 1.06, top * 0.95, r * 1.1);
    cap.rotation.x = -0.25; // lower at the back of the head than over the brow
    g.add(cap);
    if (long) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, top * 1.6, r * 0.5), hair);
      back.position.set(0, -top * 0.4, -r * 0.8);
      g.add(back);
    }
  }
  if (o?.beard) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), hair);
    beard.position.set(0, -top * 0.6, r * 0.55);
    beard.scale.set(r * 0.7, top * 0.4, r * 0.45);
    g.add(beard);
  }
  g.traverse((n) => ((n as THREE.Mesh).castShadow = true));
  // made in the body's upright frame at the skull's middle, then carried by the head bone
  root.updateMatrixWorld(true);
  const rel = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(root.matrixWorld);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  rel.decompose(pos, quat, scl);
  const holder = new THREE.Group();
  holder.position.copy(pos);
  holder.quaternion.copy(quat);
  holder.scale.copy(scl);
  g.position.copy(skull.getCenter(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert()));
  holder.add(g);
  head.add(holder);
};

export const KitPerson: React.FC<{ build: Build; verb: string; body: Loaded; library: THREE.AnimationClip[]; t: number; speed: number; envMap: THREE.Texture | null }> = ({
  build,
  verb,
  body,
  library,
  t,
  speed,
  envMap,
}) => {
  const made = React.useMemo(() => dress(body, build, envMap), [body, build, envMap]);
  // a walk with nowhere to go would tread on the spot: standing, it idles instead
  const still = speed < 0.05;
  const clip = React.useMemo(() => {
    const c = kitClip(library, verb);
    return c && still && LOCOMOTION.test(c.name) && verb !== "swim" ? kitClip(library, "idle") : c;
  }, [library, verb, still]);
  const mixer = React.useMemo(() => {
    const mx = new THREE.AnimationMixer(made.root);
    if (clip) {
      const a = mx.clipAction(clip);
      if (!/_Loop$/.test(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.play();
    }
    return mx;
  }, [made, clip]);
  const k = Math.max(0.3, build.size) / made.height;
  // a walk cycle played at the pace the body actually covers ground, so the feet don't slide
  const natural = (clip && /Sprint/.test(clip.name) ? 5.2 : clip && /Jog/.test(clip.name) ? 3.2 : 1.35) * (build.size / 1.8);
  const pace = clip && LOCOMOTION.test(clip.name) && speed > 0.05 ? Math.min(1.6, Math.max(0.6, speed / natural)) : 1;
  mixer.setTime(t * pace);
  return (
    <group scale={k} rotation={[0, Math.PI / 2, 0]}>
      <primitive object={made.root} />
    </group>
  );
};

// A clip library's clips made to play on a kit body: only the hips move the body through space (other
// bones keep the body's own proportions), scaled from the library's units to the body's (UAL1's Unreal
// export is in centimetres); scale keys dropped.
const tuned = new WeakMap<THREE.AnimationClip[], Map<Loaded, THREE.AnimationClip[]>>();
const pelvisRest = (o: THREE.Object3D) => {
  let p: THREE.Object3D | undefined;
  o.traverse((n) => {
    if (!p && n.name === "pelvis") p = n;
  });
  return p ? p.position.length() : 0;
};
export const clipsFor = (lib: Loaded, body: Loaded) => {
  let byBody = tuned.get(lib.clips);
  if (!byBody) tuned.set(lib.clips, (byBody = new Map()));
  const hit = byBody.get(body);
  if (hit) return hit;
  const a = pelvisRest(lib.scene), b = pelvisRest(body.scene);
  const k = a > 0 && b > 0 ? b / a : 1;
  const out = lib.clips.map((c) => {
    const tracks = c.tracks
      .filter((t) => !t.name.endsWith(".scale") && (!t.name.endsWith(".position") || t.name.startsWith("pelvis.")) && !t.name.startsWith("root."))
      .map((t) => {
        if (!t.name.endsWith(".position") || Math.abs(k - 1) < 0.01) return t;
        const u = t.clone();
        u.values = u.values.map((v) => v * k);
        return u;
      });
    return new THREE.AnimationClip(c.name.replace(/^.*\|/, ""), c.duration, tracks);
  });
  byBody.set(body, out);
  return out;
};
