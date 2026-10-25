// The place in layers (fyt/director.py recipe_for): what the camera looks through at the edges of the
// frame, what clusters round the action, what makes the horizon, the mist between them, wind in the
// vegetation, drifting particles and life in the background. environment.tsx builds the kind of place;
// this dresses it so every shot has a foreground, a middle and a distance that move.
//
// Vegetation is thousands of instanced blades whose tips sway in a shared wind (a vertex shader, so a
// reed bed costs one draw call), pools and creeks reflect the sky, and the foreground is placed for
// each shot from where its camera stands, off to the sides, so it frames the subject and slides past
// as the camera moves rather than hiding it.
import React, { useMemo } from "react";
import * as THREE from "three";
import { rng } from "../../world3d";
import { art, artRamp, artToon } from "./artstyle";
import { type Light } from "./style";
import { env } from "./style";
import type { Recipe } from "./types";

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();

export type KeepOut = (x: number, z: number, r: number, h: number) => boolean;
export type ShotCam = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; aspect: number };

// --- blades -----------------------------------------------------------------------------------------

// One blade, a metre tall: a tapering strip in four segments with a slight curve, standing on y = 0.
const bladeGeometry = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const pos: number[] = [];
    const idx: number[] = [];
    const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const v = i / segs;
      const w = 0.5 * (1 - v) ** 0.9;
      const bend = v * v * 0.25;
      pos.push(-w, v, bend, w, v, bend);
    }
    for (let i = 0; i < segs; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
})();

// The wind: tips sway with the blade's height squared, in gusts that roll across the set.
const windy = (m: THREE.Material, time: { value: number }, wind: { value: number }) => {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWind;")
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 ip = instanceMatrix[3].xyz;
          float tall = length(instanceMatrix[1].xyz);
          float hgt = clamp(transformed.y, 0.0, 1.0);
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + ip.x * 0.08);
          float sw = sin(uTime * 1.7 + ip.x * 0.37 + ip.z * 0.23) + 0.45 * sin(uTime * 3.3 + ip.x * 0.9 - ip.z * 0.5);
          mvPosition.x += sw * gust * uWind * hgt * hgt * tall * 0.16;
          mvPosition.z += sw * gust * uWind * hgt * hgt * tall * 0.06;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  m.customProgramCacheKey = () => `windy-${art.profile.name}`;
  return m;
};

type Blade = { x: number; z: number; h: number; w: number; a: number; lean: number; c: THREE.Color };

const Blades: React.FC<{ blades: Blade[]; time: number; wind: number }> = ({ blades, time, wind }) => {
  const uni = useMemo(() => ({ time: { value: 0 }, wind: { value: 0 } }), []);
  const mesh = useMemo(() => {
    if (!blades.length) return null;
    const mat = windy(
      artToon()
        ? new THREE.MeshToonMaterial({ side: THREE.DoubleSide, gradientMap: artRamp() })
        : new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
      uni.time,
      uni.wind,
    );
    const inst = new THREE.InstancedMesh(bladeGeometry(), mat, blades.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    blades.forEach((b, i) => {
      e.set(b.lean, b.a, b.lean * 0.6);
      m.compose(new THREE.Vector3(b.x, 0, b.z), q.setFromEuler(e), new THREE.Vector3(b.w, b.h, b.w));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, b.c);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    return inst;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blades, art.profile.name]);
  uni.time.value = time;
  uni.wind.value = wind;
  return mesh ? <primitive object={mesh} /> : null;
};

// The colours a kind of vegetation is drawn in, by place: straw and olive reeds, green grass.
const VEG: Record<string, string[]> = {
  reeds: ["#b59a5c", "#8f8a4e", "#a68f58", "#6f7442", "#c4ad73"],
  grass: ["#7d8a46", "#6a7c3e", "#91944f", "#5f7038"],
  ferns: ["#4f7a38", "#5f8a40", "#3f6a30"],
  flowers: ["#7d8a46", "#6a7c3e", "#d8c35a", "#e8e0d0", "#b05a7a"],
  scrub: ["#8a7a4e", "#7a6a42", "#9a8a5a"],
  weed: ["#3a7a5a", "#2f6a4a", "#4a8a6a"],
  snow_drift: ["#e8eef2"],
};

// A clump of blades round a point: reeds tall and close, grass short and spread.
const clump = (out: Blade[], r: () => number, kind: string, x: number, z: number, U: number, scale: number, n: number, palette: string[]) => {
  const reed = kind === "reeds";
  const H = U * (reed ? 1.05 : kind === "ferns" ? 0.55 : 0.42) * scale;
  const R = U * (reed ? 0.55 : 0.75) * scale;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
    const c = new THREE.Color(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.82 + r() * 0.3);
    out.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, h: H * (0.55 + r() * 0.65) * (1 - (d / R) * 0.35), w: U * (reed ? 0.035 : 0.05) * (0.7 + r() * 0.6),
      a: r() * Math.PI * 2, lean: (r() - 0.5) * (reed ? 0.25 : 0.5), c });
  }
};

// --- water ------------------------------------------------------------------------------------------

// Still water that shows the sky: a smooth reflective surface (the sky's light map), or flat pale paint
// in an inked or printed look, where a reflection would only read as noise.
const waterMaterial = (light: Light) => {
  if (artToon()) return new THREE.MeshBasicMaterial({ color: mix(light.horizon, "#ffffff", 0.25), fog: true });
  return new THREE.MeshStandardMaterial({ color: mix(light.horizon, "#16242c", 0.55), roughness: 0.06, metalness: 0.0, envMap: env.map, envMapIntensity: 1.25 });
};

// A pool: a flat blob with a wobbling edge.
const poolGeometry = (seed: number) => {
  const r = rng(seed);
  const n = 28;
  const ph = [r() * 6, r() * 6, r() * 6];
  const shape = new THREE.Shape();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.18 * Math.sin(a * 2 + ph[0]) + 0.1 * Math.sin(a * 3 + ph[1]) + 0.06 * Math.sin(a * 5 + ph[2]);
    const p = [Math.cos(a) * k, Math.sin(a) * k * 0.6];
    if (i === 0) shape.moveTo(p[0], p[1]);
    else shape.lineTo(p[0], p[1]);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
};

// A creek: a ribbon of water meandering across the set at depth z.
const creekGeometry = (U: number, z: number, width: number, seed: number) => {
  const r = rng(seed);
  const ph = r() * 6, amp = U * (1.2 + r() * 1.5);
  const pts: number[] = [], idx: number[] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const x = -U * 60 + (i / n) * U * 120;
    const zc = z + Math.sin(x / (U * 6) + ph) * amp + Math.sin(x / (U * 2.3) + ph * 2) * amp * 0.25;
    const w = width * (0.75 + 0.25 * Math.sin(i * 0.7 + ph));
    pts.push(x, 0, zc - w / 2, x, 0, zc + w / 2);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

// --- mist -------------------------------------------------------------------------------------------

let mistTex: THREE.Texture | null = null;
// A soft band of low mist, thickest near the ground, broken into drifts.
const mistTexture = () => {
  if (mistTex) return mistTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(77);
  for (let i = 0; i < 60; i++) {
    const x = r() * 512, y = 70 + r() * 50, rad = 30 + r() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,0.22)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 512, 128);
  }
  const fade = g.createLinearGradient(0, 0, 0, 128);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(0.45, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = fade;
  g.fillRect(0, 0, 512, 128);
  mistTex = new THREE.CanvasTexture(c);
  mistTex.colorSpace = THREE.SRGBColorSpace;
  mistTex.wrapS = THREE.RepeatWrapping;
  return mistTex;
};

const Mist: React.FC<{ U: number; amount: number; color: string; t: number; cam: ShotCam }> = ({ U, amount, color, t, cam }) => {
  const mats = useMemo(
    () => [0.55, 0.75, 1].map((k) => new THREE.MeshBasicMaterial({ map: mistTexture().clone(), color: mix(color, "#ffffff", 0.2), transparent: true, opacity: Math.min(1, amount * k), depthWrite: false, fog: true })),
    [amount, color],
  );
  // banks at three depths beyond the subject, turned to face the shot's camera
  const dir = cam.look.clone().sub(cam.pos).setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z) + Math.PI;
  const d0 = cam.look.distanceTo(cam.pos);
  return (
    <group>
      {[1.4, 3, 6].map((k, i) => {
        const at = cam.look.clone().add(dir.clone().multiplyScalar(d0 * (k - 1) + U * 4 * (i + 1)));
        const m = mats[i];
        if (m.map) m.map.offset.x = (t * (0.004 + i * 0.002)) % 1;
        return (
          <mesh key={i} position={[at.x, U * (0.7 + i * 0.9), at.z]} rotation={[0, yaw, 0]} material={m} renderOrder={2}>
            <planeGeometry args={[U * (40 + i * 40), U * (3 + i * 2.5)]} />
          </mesh>
        );
      })}
    </group>
  );
};

// --- particles --------------------------------------------------------------------------------------

const PARTICLES: Record<string, { color: string; size: number; fall: number; rise: number; n: number }> = {
  pollen: { color: "#fff4cf", size: 0.035, fall: 0.02, rise: 0, n: 220 },
  dust: { color: "#e8dcc0", size: 0.03, fall: 0.01, rise: 0, n: 260 },
  spores: { color: "#dbe8c0", size: 0.03, fall: 0.0, rise: 0.02, n: 220 },
  snow: { color: "#ffffff", size: 0.05, fall: 0.6, rise: 0, n: 500 },
  spray: { color: "#f2f8ff", size: 0.04, fall: 0.0, rise: 0.08, n: 200 },
  bubbles: { color: "#cfefff", size: 0.05, fall: 0, rise: 0.5, n: 160 },
  embers: { color: "#ffb04a", size: 0.04, fall: 0, rise: 0.6, n: 160 },
};

const Particles: React.FC<{ kind: string; U: number; t: number; centre: THREE.Vector3; seed: number; wind: number }> = ({ kind, U, t, centre, seed, wind }) => {
  const spec = PARTICLES[kind];
  const base = useMemo(() => {
    if (!spec) return null;
    const r = rng(seed ^ 0x9a1);
    return Array.from({ length: spec.n }, () => [(r() - 0.5) * U * 14, r() * U * 4, (r() - 0.5) * U * 14, r() * 6.28]);
  }, [spec, U, seed]);
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  const mat = useMemo(() => (spec ? new THREE.PointsMaterial({ color: spec.color, size: spec.size * U, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false, fog: true }) : null), [spec, U]);
  if (!spec || !base || !mat) return null;
  const H = U * 4;
  const p = new Float32Array(base.length * 3);
  base.forEach(([x, y, z, ph], i) => {
    const drift = t * (0.3 + wind) * U * 0.25;
    const yy = ((((y - t * spec.fall * U + t * spec.rise * U + Math.sin(t * 0.6 + ph) * U * 0.1) % H) + H) % H);
    const xx = ((((x + drift + Math.sin(t * 0.4 + ph) * U * 0.2 + U * 7) % (U * 14)) + U * 14) % (U * 14)) - U * 7;
    p.set([centre.x + xx, yy, centre.z + z + Math.cos(t * 0.5 + ph) * U * 0.15], i * 3);
  });
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  return <points geometry={geo} material={mat} />;
};

// --- gulls ------------------------------------------------------------------------------------------

// Seabirds wheeling over the far water: white, gliding with an occasional beat of the wings.
const Gulls: React.FC<{ U: number; seed: number; t: number; color: string }> = ({ U, seed, t, color }) => {
  const birds = useMemo(() => {
    const r = rng(seed ^ 0x6011);
    return Array.from({ length: 5 }, () => ({ cx: (r() - 0.5) * U * 30, cz: -U * (14 + r() * 20), y: U * (4 + r() * 4), rad: U * (3 + r() * 5), sp: 0.15 + r() * 0.2, ph: r() * 6.28 }));
  }, [U, seed]);
  const wing = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.1, 0, 0, 0.1, 1, 0.05, 0.02], 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }), [color]);
  return (
    <group>
      {birds.map((b, i) => {
        const a = t * b.sp + b.ph;
        const flap = Math.max(0, Math.sin(t * 6 + b.ph)) ** 3 * 0.8 + 0.12;
        const k = U * 0.7;
        return (
          <group key={i} position={[b.cx + Math.cos(a) * b.rad, b.y + Math.sin(a * 2) * U * 0.4, b.cz + Math.sin(a) * b.rad]} rotation={[0, -a, Math.sin(a) * 0.25]} scale={[k, k, k]}>
            <mesh geometry={wing} material={mat} rotation={[flap, Math.PI / 2, 0]} />
            <mesh geometry={wing} material={mat} rotation={[-flap, -Math.PI / 2, 0]} />
          </group>
        );
      })}
    </group>
  );
};

// --- the layers -------------------------------------------------------------------------------------

const VEG_KINDS = ["reeds", "grass", "ferns", "flowers", "scrub", "weed", "snow_drift"];

export const Layers: React.FC<{ recipe: Recipe; kind: string; light: Light; U: number; seed: number; t: number; keep?: KeepOut; cam: ShotCam; shot: number }> = ({
  recipe, kind, light, U, seed, t, keep, cam, shot,
}) => {
  const density = Math.max(0.2, Math.min(1.2, (recipe.density ?? 0.8) * art.profile.detail));
  // the stage's own layers: mid-ground clumps and pools round the action, far fill out to the haze
  const { blades, pools, posts, creek } = useMemo(() => {
    const r = rng(seed ^ 0x1a7e);
    const out: Blade[] = [];
    const pools: { x: number; z: number; s: number; a: number; seed: number }[] = [];
    const posts: { x: number; z: number; h: number; lean: number }[] = [];
    const veg = recipe.mid.filter((m) => VEG_KINDS.includes(m));
    const fore = recipe.fore.filter((m) => VEG_KINDS.includes(m));
    const kinds = veg.length ? veg : fore;
    const clear = (x: number, z: number, rr: number) => !(keep && keep(x, z, rr, U * 1.4));
    if (kinds.length) {
      const n = Math.round(70 * density);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = U * (2.6 + Math.sqrt(r()) * 22);
        const x = Math.cos(a) * d, z = Math.sin(a) * d * 1.2 - U * 2;
        if (!clear(x, z, U * 0.6)) continue;
        const k = kinds[i % kinds.length];
        clump(out, r, k, x, z, U, 0.8 + r() * 0.7, Math.round((k === "reeds" ? 36 : 22) * (0.6 + density * 0.5)), VEG[k] ?? VEG.grass);
      }
      // a carpet of short grass between the clumps, so no ground reads as a bare sheet
      const carpet = fore.includes("grass") || veg.includes("grass") ? "grass" : kinds[0];
      if (carpet !== "snow_drift")
        for (let i = 0; i < Math.round(160 * density); i++) {
          const a = r() * Math.PI * 2, d = U * (1.3 + Math.sqrt(r()) * 26);
          const x = Math.cos(a) * d, z = Math.sin(a) * d - U * 2;
          if (!clear(x, z, U * 0.2)) continue;
          clump(out, r, "grass", x, z, U, 0.5 + r() * 0.4, 7, VEG[carpet === "reeds" ? "grass" : carpet] ?? VEG.grass);
        }
    }
    if (recipe.mid.includes("pools") && recipe.wet > 0) {
      for (let i = 0; i < Math.round(9 * recipe.wet * density); i++) {
        const a = r() * Math.PI * 2, d = U * (3 + r() * 16);
        const x = Math.cos(a) * d, z = Math.sin(a) * d - U * 3;
        if (clear(x, z, U * 1.5)) pools.push({ x, z, s: U * (0.9 + r() * 2.2), a: r() * 6, seed: (seed + i * 31) | 0 });
      }
    }
    if (recipe.mid.includes("posts")) {
      // an old fence line running away across the set, some posts leaning, a few missing
      const side = r() > 0.5 ? 1 : -1;
      for (let i = 0; i < 12; i++) {
        if (r() < 0.15) continue;
        const x = side * U * (4.5 + i * 0.35), z = -U * (1 + i * 2.1);
        if (clear(x, z, U * 0.3)) posts.push({ x, z, h: U * (0.9 + r() * 0.4), lean: (r() - 0.5) * 0.35 });
      }
    }
    const creek = recipe.mid.includes("pools") && recipe.wet > 0.5 ? { z: -U * (8 + r() * 4), w: U * (0.8 + r() * 0.8), seed: (seed ^ 0x3c) | 0 } : null;
    return { blades: out, pools, posts, creek };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, U, seed, keep, density]);
  // this shot's foreground: clumps off to the sides of the frame, between the camera and the subject
  const fore = useMemo(() => {
    const kinds = recipe.fore.filter((m) => VEG_KINDS.includes(m) && m !== "snow_drift");
    const out: Blade[] = [];
    const span = cam.look.distanceTo(cam.pos);
    const height = cam.pos.y - cam.look.y;
    // looking down from the air, or close on a face, there is no foreground
    if (!kinds.length || height > span * 0.7 || span < U * 2.4) return out;
    const r = rng((seed ^ 0x5f0) + shot * 977);
    const fwd = cam.look.clone().sub(cam.pos).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const tanH = Math.tan(((cam.fov / 2) * Math.PI) / 180) * cam.aspect;
    for (const side of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        if (r() > 0.55 + density * 0.4) continue;
        const d = span * (0.22 + r() * 0.2 + j * 0.12);
        const lat = d * tanH * (0.85 + r() * 0.4) * side;
        const p = cam.pos.clone().add(fwd.clone().multiplyScalar(d)).add(right.clone().multiplyScalar(lat));
        const k = kinds[(j + (side > 0 ? 1 : 0)) % kinds.length];
        // no taller than the line from the camera to the subject there, so it frames the lower corners
        const line = cam.pos.y + (cam.look.y - cam.pos.y) * (d / span);
        const tall = U * (k === "reeds" ? 1.05 : k === "ferns" ? 0.55 : 0.42) * 1.2;
        clump(out, r, k, p.x, p.z, U, Math.min(0.9 + r() * 0.5, (line * 0.75) / tall), k === "reeds" ? 30 : 24, VEG[k] ?? VEG.grass);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, U, seed, shot, density]);
  const water = useMemo(() => waterMaterial(light),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [light.horizon, art.profile.name, env.map]);
  const wood = useMemo(() => (artToon() ? new THREE.MeshToonMaterial({ color: "#5a4a3a", gradientMap: artRamp() }) : new THREE.MeshLambertMaterial({ color: "#5a4a3a" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [art.profile.name]);
  const poolGeo = useMemo(() => pools.map((p) => poolGeometry(p.seed)), [pools]);
  const creekGeo = useMemo(() => (creek ? creekGeometry(U, creek.z, creek.w, creek.seed) : null), [creek, U]);
  const farWater = recipe.far.includes("water") && kind !== "sea" && kind !== "beach";
  const wind = recipe.wind ?? 0.3;
  const mist = (recipe.mist ?? 0) * art.profile.mist;
  return (
    <group>
      <Blades blades={blades} time={t} wind={wind} />
      <Blades blades={fore} time={t} wind={wind} />
      {pools.map((p, i) => (
        <mesh key={`p${i}`} geometry={poolGeo[i]} material={water} position={[p.x, U * 0.02, p.z]} rotation={[0, p.a, 0]} scale={[p.s, 1, p.s]} receiveShadow />
      ))}
      {creekGeo ? <mesh geometry={creekGeo} material={water} position={[0, U * 0.025, 0]} receiveShadow /> : null}
      {posts.map((p, i) => (
        <mesh key={`f${i}`} material={wood} position={[p.x, p.h / 2, p.z]} rotation={[p.lean, 0, p.lean * 0.5]} castShadow>
          <cylinderGeometry args={[U * 0.06, U * 0.08, p.h, 6]} />
        </mesh>
      ))}
      {farWater ? (
        // an estuary or a broad river beyond the set, meeting the far hills
        <mesh material={water} position={[0, U * 0.01, -U * 62]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[U * 400, U * 60]} />
        </mesh>
      ) : null}
      {mist > 0.05 ? <Mist U={U} amount={mist * 0.85} color={light.horizon} t={t} cam={cam} /> : null}
      {recipe.particles && recipe.particles !== "none" ? <Particles kind={recipe.particles} U={U} t={t} centre={cam.look} seed={seed} wind={wind} /> : null}
      {recipe.life.includes("gulls") && light.night < 0.5 ? <Gulls U={U} seed={seed} t={t} color={tone(mix(light.horizon, "#ffffff", 0.7), 1.05)} /> : null}
    </group>
  );
};
