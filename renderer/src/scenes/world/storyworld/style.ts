// The five looks a story world can be built in (grammar.json "styles"). A style decides materials,
// light, fog, sky and how round or blocky bodies are; it never decides what is in the scene.
import * as THREE from "three";
import { toonRamp } from "../../world3d";
import type { SetSpec, StyleName } from "./types";

export type Look = {
  name: StyleName;
  blocky: boolean; // bodies and trees from boxes (voxel)
  toon: boolean; // cel-shaded with the house ramp (diorama)
  gloss: boolean; // smooth glossy surfaces (clinical)
  ink: boolean; // ink outlines on generated meshes
  dark: number; // 0 normal, 1 very dark (noir)
  fogScale: number;
  tiltShift: boolean;
};

export const LOOKS: Record<StyleName, Look> = {
  lowpoly: { name: "lowpoly", blocky: false, toon: false, gloss: false, ink: false, dark: 0, fogScale: 1, tiltShift: false },
  voxel: { name: "voxel", blocky: true, toon: false, gloss: false, ink: false, dark: 0, fogScale: 1.2, tiltShift: false },
  noir: { name: "noir", blocky: false, toon: false, gloss: false, ink: false, dark: 0.75, fogScale: 0.55, tiltShift: false },
  diorama: { name: "diorama", blocky: false, toon: true, gloss: false, ink: true, dark: 0, fogScale: 1.6, tiltShift: true },
  clinical: { name: "clinical", blocky: false, toon: false, gloss: true, ink: false, dark: 0.2, fogScale: 1, tiltShift: false },
};

export const lookOf = (s: string | undefined): Look => LOOKS[(s as StyleName) ?? "lowpoly"] ?? LOOKS.lowpoly;

const cache = new Map<string, THREE.Material>();

// One material per look, colour and finish, shared by every mesh that uses it.
export const material = (look: Look, color: string, opts: { glow?: boolean; opacity?: number; wire?: boolean; rough?: number } = {}) => {
  const key = `${look.name}|${color}|${opts.glow ? 1 : 0}|${opts.opacity ?? 1}|${opts.wire ? 1 : 0}|${opts.rough ?? -1}`;
  let m = cache.get(key);
  if (m) return m;
  const c = new THREE.Color(color);
  const transparent = (opts.opacity ?? 1) < 1;
  const wireframe = Boolean(opts.wire);
  if (opts.glow) {
    m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6), toneMapped: false, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else if (look.toon) {
    m = new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else if (look.gloss) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: opts.rough ?? 0.32, metalness: 0.05, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: opts.rough ?? 0.88, metalness: 0, flatShading: true, transparent, opacity: opts.opacity ?? 1, wireframe });
  }
  cache.set(key, m);
  return m;
};

export const ink = new THREE.MeshBasicMaterial({ color: "#121522", side: THREE.BackSide });

// Sky, light and fog for the set's time of day, pushed darker for noir and into a void for clinical.
export type Light = { top: string; horizon: string; sun: string; sunI: number; amb: string; ambI: number; ground: string; fog: [number, number]; sunDir: [number, number, number] };

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const shade = (a: string, k: number) => "#" + new THREE.Color(a).multiplyScalar(k).getHexString();

export const lightOf = (look: Look, set: SetSpec, unit: number): Light => {
  const sky = set.sky || "#a8cde8";
  const fogFar = unit * 26 * look.fogScale;
  let l: Light;
  switch (set.time) {
    case "night":
      l = { top: "#070b16", horizon: mix(sky, "#1a2438", 0.82), sun: "#9fb6e8", sunI: 0.9, amb: "#6a7ba0", ambI: 0.85, ground: shade(set.ground, 0.45), fog: [unit * 4, fogFar * 0.8], sunDir: [-0.4, 0.8, -0.5] };
      break;
    case "dusk":
      l = { top: mix(sky, "#3a3f6a", 0.5), horizon: mix(sky, "#f2a46a", 0.55), sun: "#ffc08a", sunI: 2.4, amb: "#e0c0b8", ambI: 1.35, ground: set.ground, fog: [unit * 6, fogFar], sunDir: [-0.8, 0.6, 0.3] };
      break;
    case "dawn":
      l = { top: mix(sky, "#6a8ac8", 0.3), horizon: mix(sky, "#ffd2b0", 0.55), sun: "#ffd6a8", sunI: 1.9, amb: "#b0b8d8", ambI: 0.85, ground: set.ground, fog: [unit * 6, fogFar], sunDir: [0.9, 0.4, -0.3] };
      break;
    default:
      l = { top: mix(sky, "#4a7ac0", 0.35), horizon: mix(sky, "#ffffff", 0.35), sun: "#fff4e0", sunI: 2.5, amb: "#dfe8f4", ambI: 1.15, ground: set.ground, fog: [unit * 8, fogFar * 1.2], sunDir: [-0.5, 0.85, 0.35] };
  }
  if (look.dark > 0) {
    const k = 1 - look.dark * 0.6;
    l = { ...l, top: shade(mix(l.top, "#1a2030", look.dark), k), horizon: shade(mix(l.horizon, "#3a4558", look.dark * 0.8), Math.max(0.55, k)),
      sunI: l.sunI * (1 - look.dark * 0.55), ambI: l.ambI * (1 - look.dark * 0.35), sun: mix(l.sun, "#9fb3d9", look.dark), amb: mix(l.amb, "#7a8cb0", look.dark),
      ground: shade(l.ground, 1 - look.dark * 0.35), fog: [l.fog[0] * 0.7, l.fog[1] * 0.75] };
  }
  if (["micro", "space", "underwater"].includes(set.kind)) {
    l = { ...l, top: shade(sky, 0.6), horizon: sky, ambI: l.ambI * 0.9 };
  }
  if (look.name === "clinical" && !["micro", "space", "underwater"].includes(set.kind) && ["lab", "hospital", "room", "hall"].includes(set.kind)) {
    l = { ...l, top: "#e9eef2", horizon: "#f6f8fa", sun: "#ffffff", sunI: 1.8, amb: "#e8f4ff", ambI: 1.1 };
  }
  return l;
};
