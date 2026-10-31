// The stage: any story entity drawn from its own model (fyt/assetlib.py found or made it: a bear, a
// ferry, a heart, a lighthouse), doing what the narration says, in front of a painted plate of its
// place. Nothing here knows what the thing is: the model brings its shape, textures and animation
// clips, and the scene's action is one of a small motion grammar any model can perform (present, move,
// approach, depart, rise, fall, turn, shake). Its own clip is played when one fits the motion (a walk
// for move), else it moves as a whole. Materials go cel-shaded so it sits in the video's style.
import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Img, interpolate, staticFile, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Scene } from "../../types";
import { unit } from "../../theme";
import type { SceneProps } from "../shared";
import { clamp, ease, groundTexture, HeadingPlate, outlineMaterial, toonRamp, WeatherOverlay } from "../world3d";
import { aim, Atmosphere, Billow, Hills, shake, useWorld } from "./kit";

const SIZE = 4; // world units the model's largest side is scaled to
export type Loaded = { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
const loads = new Map<string, Promise<Loaded>>();
// models already loaded, for a scene that loads its models before it mounts its canvas
export const ready = new Map<string, Loaded>();
export const load = (src: string) => {
  let p = loads.get(src);
  if (!p) {
    p = new GLTFLoader().loadAsync(staticFile(src)).then((g) => ({ scene: g.scene, clips: g.animations ?? [] }));
    loads.set(src, p);
  }
  return p;
};

export const useModel = (src: string | undefined) => {
  const [state, setState] = useState<{ model: Loaded | null; failed: boolean }>({ model: null, failed: false });
  const [handle] = useState(() => (src ? delayRender(`loading model ${src}`, { timeoutInMilliseconds: 120000 }) : null));
  useEffect(() => {
    if (!src) return;
    load(src)
      .then((model) => setState({ model, failed: false }))
      .catch((e) => {
        console.error(`model ${src} failed to load: ${e}`);
        setState({ model: null, failed: true });
      })
      .finally(() => handle !== null && continueRender(handle));
  }, [src, handle]);
  return state;
};

// Which of the model's own clips fits the motion, by its name; none when nothing fits (a gallop is not
// shown for a bear standing still).
const CLIP_WORDS: Record<string, RegExp> = {
  move: /walk|run|gallop|trot|move|fly|swim|drive|crawl|loop|locomot/i,
  approach: /walk|run|gallop|trot|move|fly|swim|drive|crawl|loop/i,
  depart: /walk|run|gallop|trot|move|fly|swim|drive|crawl|loop/i,
  rise: /fly|jump|climb|take ?off|rise|flap/i,
  present: /idle|survey|stand|breath|look|rest|wait/i,
  turn: /idle|survey|look|turn/i,
  shake: /hit|react|shake|flinch/i,
  fall: /fall|tumble/i,
};
export const clipFor = (names: string[], motion: string): number => {
  const words = CLIP_WORDS[motion];
  return words ? names.findIndex((n) => words.test(n)) : -1;
};

const YAW: Record<string, number> = { "+x": 0, "-x": Math.PI, "+z": Math.PI / 2, "-z": -Math.PI / 2 };

// World matrices and skeletons brought up to date, and skinned bounds forgotten, so a bounding box of a
// rigged model is measured in its rest pose and not from bones that were never posed (a box hundreds of
// times too big shrinks the model to a speck).
const settle = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true);
  root.traverse((n) => {
    const sk = n as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      sk.skeleton.update();
      (sk as unknown as { boundingBox: THREE.Box3 | null }).boundingBox = null;
      (sk as unknown as { boundingSphere: THREE.Sphere | null }).boundingSphere = null;
    }
  });
};

// Where an aircraft's tail is: a plane's tail fin stands higher than anything else on it, so the middle
// of its topmost points lies well towards the tail along its length, and on the middle line across its
// wings (they are the same on both sides). For x and for z, how far off the middle those points lie, as a
// share of the model's extent that way (-0.5 .. 0.5).
export const tailOffset = (root: THREE.Object3D): { x: number; z: number } => {
  const pts: number[] = [];
  const v = new THREE.Vector3();
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry?.attributes?.position : undefined;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
  });
  if (pts.length < 24) return { x: 0, z: 0 };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], pts[i]);
    hi[i % 3] = Math.max(hi[i % 3], pts[i]);
  }
  const band = hi[1] - (hi[1] - lo[1]) * 0.06;
  let sx = 0, sz = 0, count = 0;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] >= band) {
    sx += pts[i];
    sz += pts[i + 2];
    count++;
  }
  const off = (sum: number, a: number) => (hi[a] - lo[a] < 1e-6 ? 0 : (sum / count - (lo[a] + hi[a]) / 2) / (hi[a] - lo[a]));
  return count ? { x: off(sx, 0), z: off(sz, 2) } : { x: 0, z: 0 };
};

// The model cel-shaded, turned to face +x (by its record's `forward`, else its long side; see below),
// scaled so its largest side is SIZE and stood on y = 0.
// `own`: keep the model's own (physically based) materials, lit by the scene's sky (`envMap`), as a
// story world in a realistic look does; otherwise they go cel-shaded with an ink outline.
export const prepare = (m: Loaded, forward: string, up: string, own: { envMap: THREE.Texture | null; intensity: number } | null = null) => {
  const o = SkeletonUtils.clone(m.scene);
  const ink = outlineMaterial(0.012);
  const meshes: THREE.Mesh[] = [];
  o.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) meshes.push(n as THREE.Mesh);
  });
  // Collected first: the outlines added below are meshes too, and must not be visited again.
  meshes.forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = Boolean(own);
    mesh.frustumCulled = false; // skinned bounds lag the pose
    if (own) {
      const lit = (old: THREE.Material) => {
        const c = old.clone() as THREE.MeshStandardMaterial;
        if ("envMap" in c) {
          c.envMap = own.envMap;
          c.envMapIntensity = own.intensity;
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lit) : lit(mesh.material);
      return;
    }
    const colours = Boolean(mesh.geometry.attributes.color);
    const toon = (old: THREE.Material) => {
      const s = old as THREE.MeshStandardMaterial;
      return new THREE.MeshToonMaterial({
        name: s?.name ?? "",
        color: s?.color ?? new THREE.Color(colours ? "#ffffff" : "#d9dde3"), map: s?.map ?? null, gradientMap: toonRamp, vertexColors: colours,
        transparent: s?.transparent, opacity: s?.opacity ?? 1, alphaTest: s?.alphaTest ?? 0, side: s?.side ?? THREE.FrontSide,
      });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toon) : toon(mesh.material);
    // An ink outline, for rigid meshes only: a copy of a skinned or morphing mesh would not follow the pose.
    if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh && !mesh.morphTargetInfluences && mesh.geometry.attributes.normal)
      mesh.add(new THREE.Mesh(mesh.geometry, ink));
  });
  const turn = new THREE.Group();
  turn.add(o);
  if (up === "+z") o.rotation.x = -Math.PI / 2;
  if (forward === "auto" || forward === "short") {
    // No record of which way it faces: a ship or an animal is longest from front to back, so its long
    // horizontal side is taken as its length ("auto"); a winged thing is wider than it is long ("short").
    // Seen side-on, never head-on; which end is the front is a guess, except for an aircraft (by its tail fin).
    settle(turn);
    const raw = new THREE.Box3().setFromObject(turn).getSize(new THREE.Vector3());
    let alongX = forward === "auto" ? raw.x > raw.z * 1.15 : raw.x * 1.15 < raw.z;
    let tail = 0;
    if (forward === "short") {
      // an aircraft: its length is the way its tail fin lies off the middle (a fighter can be longer than
      // its wingspan), and its front is the end away from the fin, whichever way its maker built it
      const off = tailOffset(turn);
      const [ax, az] = [Math.abs(off.x), Math.abs(off.z)];
      if (Math.max(ax, az) > 0.18 && Math.min(ax, az) < Math.max(ax, az) * 0.5) alongX = ax > az;
      const along = alongX ? off.x : off.z;
      tail = along > 0.18 ? 1 : along < -0.18 ? -1 : 0;
    }
    forward = (tail > 0 ? "-" : "+") + (alongX ? "x" : "z");
  }
  turn.rotation.y = YAW[forward] ?? YAW["+z"];
  const outer = new THREE.Group();
  outer.add(turn);
  settle(outer);
  const box = new THREE.Box3().setFromObject(outer);
  const size = box.getSize(new THREE.Vector3());
  const k = SIZE / Math.max(1e-6, size.x, size.y, size.z);
  outer.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  outer.position.set(-c.x, -box.min.y * k, -c.z);
  const root = new THREE.Group();
  root.add(outer);
  return { root, animated: o, size: size.multiplyScalar(k) };
};

// Where the thing is and how it is turned at scene progress u (0-1), its key moment at `at`.
const pose = (motion: string, u: number, at: number, since: number, frame: number, size: THREE.Vector3) => {
  const L = Math.max(size.x, size.z);
  const p = new THREE.Vector3();
  const rot = new THREE.Euler();
  switch (motion) {
    case "move":
      p.x = interpolate(u, [0, 1], [-L * 0.8, L * 0.8]);
      break;
    case "approach":
      p.x = interpolate(u, [0, at, 1], [-L * 1.6, -L * 0.5, -L * 0.3], { ...clamp, easing: ease });
      break;
    case "depart":
      p.x = interpolate(u, [0, at, 1], [0, L * 0.9, L * 2.4], { ...clamp, easing: ease });
      break;
    case "rise":
      p.y = interpolate(u, [0, at, 1], [0, size.y * 0.4, size.y * 2.2], { ...clamp, easing: ease });
      rot.z = interpolate(u, [0, at, 1], [0, 0.12, 0.2], clamp);
      break;
    case "fall": {
      const k = interpolate(u, [0, at], [0, 1], { ...clamp, easing: (t) => t * t });
      p.y = (1 - k) * size.y * 3.2;
      rot.z = since < 0 ? (1 - k) * 1.1 : 0;
      rot.x = since < 0 ? (1 - k) * 0.6 : 0;
      break;
    }
    case "turn":
      rot.y = interpolate(u, [0, 1], [0, Math.PI * 0.85], { ...clamp, easing: ease });
      break;
    case "shake":
      if (since > 0) p.add(shake(since, L * 0.25, frame));
      break;
    default: // present: a slow quarter turn so its shape reads
      rot.y = interpolate(u, [0, 1], [-0.25, 0.25]);
  }
  return { p, rot };
};

// The camera for each shot, around the thing's centre, pushing in a little over the scene.
const view = (shot: string | null | undefined, motion: string, u: number, target: THREE.Vector3, size: THREE.Vector3, fov: number) => {
  const r = size.length() / 2;
  const d = (r / Math.tan(((fov / 2) * Math.PI) / 180)) * 1.0 * (1.08 - 0.1 * u);
  const h = size.y;
  const which = motion === "approach" ? "front" : motion === "depart" ? "chase" : shot;
  let off: THREE.Vector3;
  switch (which) {
    case "front":
      off = new THREE.Vector3(d * 0.8, h * 0.25, d * 0.55);
      break;
    case "orbit": {
      const a = 0.9 + u * 1.1;
      off = new THREE.Vector3(Math.cos(a) * d, h * 0.35, Math.sin(a) * d);
      break;
    }
    case "wide":
      off = new THREE.Vector3(d * 0.35, h * 0.9, d * 1.9);
      break;
    case "below":
      off = new THREE.Vector3(d * 0.55, -h * 0.1, d * 0.6);
      break;
    case "chase":
      off = new THREE.Vector3(-d * 0.85, h * 0.4, d * 0.45);
      break;
    default: // side
      off = new THREE.Vector3(d * 0.2, h * 0.3, d);
  }
  return { pos: target.clone().add(off), look: target };
};

const shadowCatcher = new THREE.ShadowMaterial({ opacity: 0.32 });

const Stage: React.FC<{ scene: Scene; portrait: boolean; model: Loaded; plate: boolean }> = ({ scene, portrait, model, plate }) => {
  const { camera, gl } = useThree();
  const w = useWorld(scene);
  const motion = scene.action ?? "present";
  const fit = (scene.model?.fit ?? {}) as { forward?: string; up?: string };
  const made = useMemo(() => prepare(model, fit.forward ?? "auto", fit.up ?? "+y"), [model, fit.forward, fit.up]);
  const names = useMemo(() => model.clips.map((c) => c.name), [model]);
  const mixer = useMemo(() => {
    const i = clipFor(names, motion);
    if (i < 0) return null;
    const mx = new THREE.AnimationMixer(made.animated);
    mx.clipAction(model.clips[i]).play();
    return mx;
  }, [made, names, motion, model]);
  mixer?.setTime(w.frame / w.fps);
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;

  const { p, rot } = pose(motion, w.u, w.at, w.since, w.frame, made.size);
  const target = new THREE.Vector3(motion === "move" ? p.x * 0.6 : motion === "approach" || motion === "depart" ? p.x : p.x * 0.5, made.size.y * 0.45 + (motion === "rise" ? p.y * 0.7 : 0), 0);
  const fov = 32;
  const v = view(scene.shot, motion, w.u, target, made.size, fov);
  if (motion === "fall" || motion === "shake") v.pos.add(shake(w.since, made.size.y * 0.3, w.frame));
  aim(camera, v.pos, v.look, fov, portrait, 1.25);

  const groundTex = useMemo(() => (plate ? null : groundTexture(w.pal, scene.setting, w.seed)), [plate, w.pal, scene.setting, w.seed]);
  return (
    <>
      {plate ? (
        <>
          <ambientLight intensity={0.9} />
          <directionalLight position={[6, 12, 8]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
        </>
      ) : (
        <>
          <Atmosphere pal={w.pal} weather={w.weather} lightning={w.lightning} night={w.night} seed={w.seed} fog={2} />
          <directionalLight position={[6, 12, 8]} intensity={0.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
          <Hills seed={w.seed} color={w.pal.ground2} radius={260} count={12} height={0.5} />
        </>
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={plate ? shadowCatcher : undefined}>
        <planeGeometry args={[plate ? 60 : 1400, plate ? 60 : 1400]} />
        {plate ? null : <meshToonMaterial map={groundTex} gradientMap={toonRamp} />}
      </mesh>
      <group position={p} rotation={rot}>
        <primitive object={made.root} />
      </group>
      {motion === "fall" ? <Billow at={[p.x, 0, 0]} since={w.since} count={18} spread={0.5} rise={0.3} size={0.5} color="#a89a86" dark="#7d725f" /> : null}
    </>
  );
};

export const StageScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const { width, height } = useVideoConfig();
  const short = format === "short";
  const { model, failed } = useModel(scene.model?.src);
  const w = useWorld(scene);
  const plate = Boolean(scene.backdropSrc);
  if (failed || !scene.model?.src) return <AbsoluteFill style={{ background: theme.background }} />;
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      {plate ? (
        // The painted place, drifting slowly against the camera so the model sits in it with some depth.
        <Img
          src={staticFile(scene.backdropSrc!)}
          style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.12 - 0.06 * w.u}) translateX(${(w.u - 0.5) * -2}%)` }}
        />
      ) : null}
      {model ? (
        <ThreeCanvas width={width} height={height} camera={{ fov: 32, position: [8, 3, 8] }} gl={{ antialias: true, alpha: true }} shadows>
          <Stage scene={scene} portrait={short} model={model} plate={plate} />
        </ThreeCanvas>
      ) : null}
      <WeatherOverlay weather={scene.weather} seed={w.seed} night={scene.setting === "night"} />
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <HeadingPlate scene={scene} theme={theme} short={short} />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.12 * unit(format), background: `linear-gradient(transparent, ${theme.background}88)` }} />
    </AbsoluteFill>
  );
};
