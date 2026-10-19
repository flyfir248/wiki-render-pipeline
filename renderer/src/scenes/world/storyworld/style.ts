// The five looks a story world can be built in (grammar.json "styles"). A style decides materials,
// light, fog, sky and how round or blocky bodies are; it never decides what is in the scene.
import React from "react";
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

// The sky's image-based light for the frame being drawn. Only glossy surfaces (paint, glass, polished
// look) sample it: on a CPU renderer a reflection lookup on every leaf and wall costs more than it shows.
export const env: { map: THREE.Texture | null; intensity: number } = { map: null, intensity: 1 };

// Set dressing (trees, rocks, walls, far buildings) draws with a cheaper diffuse-only material.
export const Background = React.createContext(false);

// One material per look, colour and finish, shared by every mesh that uses it.
export const material = (look: Look, color: string, opts: { glow?: boolean; opacity?: number; wire?: boolean; rough?: number; cheap?: boolean } = {}) => {
  const key = `${look.name}|${color}|${opts.glow ? 1 : 0}|${opts.opacity ?? 1}|${opts.wire ? 1 : 0}|${opts.rough ?? -1}|${opts.cheap ? 1 : 0}`;
  let m = cache.get(key);
  if (m) {
    if (look.gloss && m instanceof THREE.MeshStandardMaterial) {
      m.envMap = env.map;
      m.envMapIntensity = env.intensity * 1.3;
    }
    return m;
  }
  const c = new THREE.Color(color);
  const transparent = (opts.opacity ?? 1) < 1;
  const wireframe = Boolean(opts.wire);
  if (opts.glow) {
    m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), transparent, opacity: opts.opacity ?? 1, wireframe });
  } else if (opts.cheap && !look.toon && !look.gloss) {
    m = new THREE.MeshLambertMaterial({ color: c, flatShading: look.blocky, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else if (look.toon) {
    m = new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else if (look.gloss) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: opts.rough ?? 0.25, metalness: 0.08, envMapIntensity: 1.3, transparent, opacity: opts.opacity ?? 1, wireframe });
  } else {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: opts.rough ?? (look.blocky ? 0.85 : 0.62), metalness: 0, flatShading: look.blocky, transparent, opacity: opts.opacity ?? 1, wireframe });
  }
  cache.set(key, m);
  return m;
};

export const ink = new THREE.MeshBasicMaterial({ color: "#121522", side: THREE.BackSide });

// Sky, light, fog and finish for the set's time of day and the look. Each time of day is an art-directed
// rig: a key (sun or moon) low enough to throw long shadows, a rim from behind the subject, a soft sky
// fill, and a sky the reflections come from. Noir is a cold blue hour, not grey; clinical is high key.
export type Light = {
  top: string; horizon: string; below: string; sun: string; sunI: number; amb: string; ambI: number; ground: string;
  fog: [number, number]; fogDensity: number; sunDir: [number, number, number]; rim: string; rimI: number;
  night: number; clouds: number; envI: number; exposure: number; bloom: number; threshold: number; lift: string; gain: string; vignette: number;
};

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
const shade = (a: string, k: number) => "#" + new THREE.Color(a).multiplyScalar(k).getHexString();

export const lightOf = (look: Look, set: SetSpec, unit: number): Light => {
  const sky = set.sky || "#a8cde8";
  const fogFar = unit * 26 * look.fogScale;
  const base = { fog: [unit * 6, fogFar] as [number, number], fogDensity: 0.016 / unit, lift: "#000000", gain: "#ffffff", vignette: 0.32, bloom: 0.3, threshold: 1.0 };
  let l: Light;
  switch (set.time) {
    case "night":
      l = { ...base, top: "#040915", horizon: mix(sky, "#24365a", 0.8), below: "#0b111c", sun: "#a9c4ff", sunI: 1.3, amb: "#5a73a6", ambI: 0.42, ground: shade(set.ground, 0.55),
        sunDir: [0.45, 0.55, -0.55], rim: "#9fc0ff", rimI: 1.6, night: 1, clouds: 0.25, envI: 0.45, exposure: 1.15, bloom: 0.7, threshold: 0.8, lift: "#03050b", gain: "#eef3ff", vignette: 0.42 };
      break;
    case "dusk":
      l = { ...base, top: mix(sky, "#26325f", 0.6), horizon: mix(sky, "#f5a066", 0.65), below: "#3a2e34", sun: "#ffad66", sunI: 3.4, amb: "#b8a2c4", ambI: 0.5, ground: set.ground,
        sunDir: [-0.85, 0.24, 0.3], rim: "#ffcc90", rimI: 1.8, night: 0.2, clouds: 0.6, envI: 0.6, exposure: 1.05, bloom: 0.45, threshold: 0.8, lift: "#0c0608", gain: "#fff1e2", vignette: 0.38 };
      break;
    case "dawn":
      l = { ...base, top: mix(sky, "#5878b8", 0.45), horizon: mix(sky, "#ffc4a0", 0.6), below: "#4a4048", sun: "#ffd0a8", sunI: 2.8, amb: "#aeb6dc", ambI: 0.55, ground: set.ground,
        sunDir: [0.85, 0.28, -0.3], rim: "#ffd8b8", rimI: 1.5, night: 0.1, clouds: 0.55, envI: 0.6, exposure: 1.05, bloom: 0.4, threshold: 0.82, lift: "#06060c", gain: "#fff4ec" };
      break;
    default:
      l = { ...base, top: mix(sky, "#3b6db8", 0.45), horizon: mix(sky, "#eef4f8", 0.5), below: shade(set.ground, 0.8), sun: "#fff0d8", sunI: 3.0, amb: mix(sky, "#ffffff", 0.35), ambI: 0.6, ground: set.ground,
        sunDir: [-0.55, 0.52, 0.5], rim: "#dbe8ff", rimI: 1.0, night: 0, clouds: 0.5, envI: 0.65, exposure: 1.0 };
  }
  if (look.dark > 0) {
    // noir: a cold blue hour with a hard key and a strong rim, deep but never grey
    l = { ...l, top: mix(l.top, "#081226", look.dark), horizon: mix(l.horizon, "#2d4466", look.dark * 0.85), below: mix(l.below, "#0a0f18", look.dark),
      sun: mix(l.sun, "#bcd0ff", look.dark), sunI: Math.max(1.6, l.sunI * 0.7), amb: mix(l.amb, "#4d6390", look.dark), ambI: l.ambI * 0.75,
      ground: shade(l.ground, 1 - look.dark * 0.4), rim: "#8fb6ff", rimI: 2.2, night: Math.max(l.night, 0.7), clouds: l.clouds * 0.5, envI: 0.45,
      fogDensity: l.fogDensity * 1.25, exposure: 1.05, bloom: 0.55, threshold: 0.95, lift: "#03060d", gain: "#e8efff", vignette: 0.45 };
  }
  if (["micro", "space", "underwater"].includes(set.kind)) {
    l = { ...l, top: shade(sky, 0.5), horizon: sky, below: shade(sky, 0.35), ambI: 0.55, night: set.kind === "space" ? 1 : 0, clouds: 0,
      fogDensity: set.kind === "space" ? 0 : (set.kind === "underwater" ? 0.05 : 0.026) / unit, rim: mix(sky, "#ffffff", 0.6), rimI: 2.0, bloom: 0.5, threshold: 0.9 };
  }
  if (look.name === "clinical" && ["lab", "hospital", "room", "hall"].includes(set.kind)) {
    l = { ...l, top: "#dfe7ee", horizon: "#f6f8fa", below: "#c9d1d8", sun: "#ffffff", sunI: 2.2, amb: "#e8f4ff", ambI: 0.85, rim: "#bfe8ff", rimI: 1.2, night: 0, clouds: 0,
      envI: 1.0, fogDensity: 0.008 / unit, lift: "#04080c", gain: "#f4fbff" };
  }
  if (INSIDE_KINDS.includes(set.kind)) l = { ...l, fogDensity: l.fogDensity * 0.5, clouds: 0 };
  return l;
};

const INSIDE_KINDS = ["room", "hall", "lab", "hospital", "cave"];
