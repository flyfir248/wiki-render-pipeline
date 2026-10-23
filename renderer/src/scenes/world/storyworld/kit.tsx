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

// Paints the mesh's regions; returns the boxes (in the mesh's own space) of the skin on its head bone
// and of the hips and thighs. Each vertex's colour is the cloth over it, and a `cloth` attribute says how
// far it is clothed: where it is not, the skin (a textured body's own skin texture) shows instead.
const paint = (mesh: THREE.SkinnedMesh, colours: Record<string, THREE.Color>) => {
  const skull = new THREE.Box3();
  const hips = new THREE.Box3();
  const v = new THREE.Vector3();
  const g = mesh.geometry.clone();
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const names = mesh.skeleton.bones.map((b) => b.name);
  const col = new Float32Array(g.attributes.position.count * 3);
  const cloth = new Float32Array(g.attributes.position.count);
  const c = new THREE.Color();
  for (let i = 0; i < g.attributes.position.count; i++) {
    let best = 0, w = -1, bare = 0, legs = 0;
    for (let k = 0; k < 4; k++) {
      const x = sw.getComponent(i, k);
      const b = si.getComponent(i, k);
      const at = region(names[b] ?? "");
      if (at === "skin") bare += x;
      if (at === "legs") legs += x;
      if (x > w) {
        w = x;
        best = b;
      }
    }
    // a vertex shared between skin and cloth bones (the neckline, the cuffs) blends the two, so the
    // edge of the cloth is a smooth line rather than a jagged run of triangles
    const r = region(names[best] ?? "");
    const k = THREE.MathUtils.smoothstep(bare, 0.4, 0.6);
    c.copy(colours[r === "skin" ? "top" : r]);
    // and the waist, where the top meets the trousers
    if (r === "top" || r === "legs") c.copy(colours.top).lerp(colours.legs, THREE.MathUtils.smoothstep(legs, 0.4, 0.6));
    col.set([c.r, c.g, c.b], i * 3);
    cloth[i] = 1 - k;
    if (/^head$/i.test(names[best] ?? "")) skull.expandByPoint(v.fromBufferAttribute(g.attributes.position, i));
    if (/^(pelvis|thigh)/i.test(names[best] ?? "")) hips.expandByPoint(v.fromBufferAttribute(g.attributes.position, i));
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("cloth", new THREE.BufferAttribute(cloth, 1));
  mesh.geometry = g;
  return { skull, hips };
};

// The body's skin texture where it shows (face, neck, hands), tinted to the build's skin tone; plain
// cloth colour everywhere else, keeping only a little of the texture's shading for the folds.
const clothed = (m: THREE.MeshStandardMaterial, skin: THREE.Color) => {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.skinTint = { value: skin };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float cloth;\nvarying float vCloth;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCloth = cloth;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCloth;\nuniform vec3 skinTint;")
      .replace("#include <color_fragment>", "")
      .replace(
        "#include <map_fragment>",
        `vec3 bare = skinTint;
        float shade = 1.0;
        #ifdef USE_MAP
          vec4 texelColor = texture2D( map, vMapUv );
          bare *= texelColor.rgb;
          shade = clamp( dot( texelColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) / 0.62, 0.88, 1.05 );
        #endif
        diffuseColor.rgb *= mix( bare, vColor.rgb * shade, vCloth );`,
      );
  };
  m.customProgramCacheKey = () => "kit-clothed";
  return m;
};

// The body textures' own skin tone, which the build's skin colour is measured against.
const TEXTURE_SKIN = new THREE.Color("#d39672");
const HAIR_STYLE = (build: Build) => {
  const h = build.outfit?.hair ?? "short";
  const f = build.sex === "f";
  if (h === "bald") return null;
  if (/hat|cap|helmet|hood/.test(h)) return f ? "buzzedf" : "buzzed";
  if (h === "bun" || h === "ponytail") return "buns";
  if (h === "long" || (f && (h === "curly" || h === "scarf"))) return "long";
  return f ? "buns" : h === "curly" ? "buzzed" : "parted";
};

type Made = { root: THREE.Object3D; height: number; head: THREE.Object3D | null };

const dress = (body: Loaded, build: Build, envMap: THREE.Texture | null, hairs: Record<string, Loaded>): Made => {
  const root = SkeletonUtils.clone(body.scene);
  const o = build.outfit;
  const coat = o?.top === "dress" || o?.top === "robe";
  // the body with the most vertices is the one dressed; a textured kit's eyes and brows keep their own
  let main: THREE.SkinnedMesh | null = null;
  root.traverse((n) => {
    const m = n as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!main || m.geometry.attributes.position.count > main.geometry.attributes.position.count)) main = m;
  });
  const map = ((main as THREE.SkinnedMesh | null)?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
  const skin = new THREE.Color(build.skin || "#d9a77f");
  // over a skin texture the skin colour is a tint: the build's tone against the texture's own
  const tint = map ? new THREE.Color(Math.min(1.25, skin.r / TEXTURE_SKIN.r), Math.min(1.25, skin.g / TEXTURE_SKIN.g), Math.min(1.25, skin.b / TEXTURE_SKIN.b)) : skin;
  const colours = {
    skin: tint,
    top: new THREE.Color(build.primary),
    legs: new THREE.Color(coat ? build.primary : build.secondary),
    shoe: new THREE.Color("#2a2522"),
  };
  const cloth = clothed(new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.78, metalness: 0, envMap, envMapIntensity: 0.6 }), tint);
  const hairColour = new THREE.Color(build.hair || "#3a2a1c");
  let head: THREE.Object3D | null = null;
  const boxes: [{ skull: THREE.Box3; hips: THREE.Box3 }, THREE.Object3D][] = [];
  let pelvis: THREE.Object3D | null = null;
  root.traverse((n) => {
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = n as THREE.SkinnedMesh;
      if (m === main || !map) {
        boxes.push([paint(m, colours), m]);
        m.material = cloth;
      } else {
        // eyes as they are; brows in the hair's colour
        const own = (m.material as THREE.MeshStandardMaterial).clone();
        own.envMap = envMap;
        if (/hair|brow/i.test(own.name + m.name)) own.color = hairColour;
        m.material = own;
      }
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
    if (!head && /^head$/i.test(n.name)) head = n;
    if (!pelvis && /^pelvis$/i.test(n.name)) pelvis = n;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const height = Math.max(0.1, box.max.y - box.min.y);
  // the kit's own hair (and beard), skinned to the head bone of this body's skeleton
  const style = HAIR_STYLE(build);
  const worn = [style && hairs[style], o?.beard && hairs.beard].filter((x): x is Loaded => Boolean(x));
  if (main) worn.forEach((h) => wear(h, main as THREE.SkinnedMesh, hairColour, envMap));
  // the skull, where the body stands at rest (in the body's frame)
  const skull = new THREE.Box3(), hips = new THREE.Box3();
  boxes.forEach(([b, m]) => {
    if (!b.skull.isEmpty()) skull.union(b.skull.clone().applyMatrix4(m.matrixWorld));
    if (!b.hips.isEmpty()) hips.union(b.hips.clone().applyMatrix4(m.matrixWorld));
  });
  if (head && !skull.isEmpty()) headwear(build, head, root, skull, worn.length > 0 || !style);
  if (pelvis && !hips.isEmpty() && (coat || o?.bottom === "skirt")) skirt(build, pelvis, root, hips, box.min.y, coat);
  return { root, height, head };
};

// A skinned piece from the kit (hair, a beard) bound to the body's own bones by name, so it follows them.
const wear = (piece: Loaded, body: THREE.SkinnedMesh, colour: THREE.Color, envMap: THREE.Texture | null) => {
  const bones = new Map(body.skeleton.bones.map((b) => [b.name, b]));
  piece.scene.traverse((n) => {
    const m = n as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const mine = m.skeleton.bones.map((b) => bones.get(b.name));
    if (mine.some((b) => !b)) return;
    const mesh = new THREE.SkinnedMesh(m.geometry, (m.material as THREE.MeshStandardMaterial).clone());
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color = colour.clone().multiplyScalar(1.6);
    mat.envMap = envMap;
    mat.envMapIntensity = 0.4;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    body.parent?.add(mesh);
    mesh.bind(new THREE.Skeleton(mine as THREE.Bone[], m.skeleton.boneInverses), body.bindMatrix);
  });
};

// Hair, a hat or a beard, made in the body's own upright frame and carried by the head bone.
const headwear = (build: Build, head: THREE.Object3D, root: THREE.Object3D, skull: THREE.Box3, haired: boolean) => {
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
  } else if (!haired && o?.hair !== "bald") {
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
  if (o?.beard && !haired) {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), hair);
    beard.position.set(0, -top * 0.6, r * 0.55);
    beard.scale.set(r * 0.7, top * 0.4, r * 0.45);
    g.add(beard);
  }
  g.traverse((n) => ((n as THREE.Mesh).castShadow = true));
  carry(g, head, root, skull.getCenter(new THREE.Vector3()));
};

// A skirt, or a dress's or robe's hem, flaring from the hips to the knees (a skirt) or near the ankles.
const skirt = (build: Build, pelvis: THREE.Object3D, root: THREE.Object3D, hips: THREE.Box3, floor: number, long: boolean) => {
  const size = hips.getSize(new THREE.Vector3());
  const top = hips.max.y - size.y * 0.08; // at the waist
  const hem = long ? floor + (top - floor) * 0.12 : top - (top - floor) * 0.42;
  const r = Math.max(size.x, size.z) * 0.5 * 1.08;
  const cloth = new THREE.MeshStandardMaterial({ color: build.primary, roughness: 0.82, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * (long ? 1.5 : 1.3), top - hem, 40, 1, true), cloth);
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  carry(g, pelvis, root, new THREE.Vector3((hips.min.x + hips.max.x) / 2, (top + hem) / 2, (hips.min.z + hips.max.z) / 2));
};

// A piece made in the body's upright frame, centred at `at` (in that frame), carried by a bone.
const carry = (g: THREE.Object3D, bone: THREE.Object3D, root: THREE.Object3D, at: THREE.Vector3) => {
  root.updateMatrixWorld(true);
  const rel = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(root.matrixWorld);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  rel.decompose(pos, quat, scl);
  const holder = new THREE.Group();
  holder.position.copy(pos);
  holder.quaternion.copy(quat);
  holder.scale.copy(scl);
  g.position.copy(at.clone().applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert()));
  holder.add(g);
  bone.add(holder);
};

export const KitPerson: React.FC<{ build: Build; verb: string; body: Loaded; hair: Record<string, Loaded>; library: THREE.AnimationClip[]; t: number; speed: number; envMap: THREE.Texture | null }> = ({
  build,
  verb,
  body,
  hair,
  library,
  t,
  speed,
  envMap,
}) => {
  // the hair styles come as a fresh object each frame; the loaded models in it are the same
  const styles = Object.keys(hair).sort().join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const made = React.useMemo(() => dress(body, build, envMap, hair), [body, build, envMap, styles]);
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
