// Art-style profiles (fyt/director.py picks one per video): cinematic stylised 3D, inked graphic novel,
// and stencil / cutout. A profile is not a filter over a finished frame. It sets, together:
// - materials: smooth lit surfaces, or toon ramps with three or two hard bands;
// - light: how hard the key is, how much fill and rim, how soft the shadows are;
// - the set: how dense it is dressed and how much mist sits between its layers;
// - animation: smooth motion, or held drawings "on twos" like limited animation;
// - camera: the lens, how low it sits, a tilt on dramatic moves;
// - finishing: a film grade, or ink lines from the depth and edges with hatching in the shadows, or a
//   print pulled in four inks with misregistration and distressed paper.
// The story still decides what happens; the profile only decides how it looks and moves.
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Art, ArtProfile } from "./types";

export type Profile = {
  name: ArtProfile;
  toon: 0 | 2 | 3; // material bands (0: smooth physically lit)
  key: number; // key light scale
  fill: number; // ambient fill scale
  rim: number; // rim light scale
  shadowSoft: number; // shadow radius
  fog: number; // fog density scale
  mist: number; // mist layer scale
  detail: number; // set dressing density scale
  step: number; // animation held for this many frames (1: every frame)
  fov: number; // lens scale
  low: number; // camera height scale on dramatic moves
  dutch: number; // camera roll on low angles and reveals, radians
  mode: 0 | 1 | 2; // finishing pass: grade, ink, print
};

export const PROFILES: Record<ArtProfile, Profile> = {
  cinematic: { name: "cinematic", toon: 0, key: 1, fill: 1, rim: 1.15, shadowSoft: 4, fog: 1, mist: 1, detail: 1, step: 1, fov: 1, low: 1, dutch: 0, mode: 0 },
  ink: { name: "ink", toon: 3, key: 1.25, fill: 0.7, rim: 1.4, shadowSoft: 1, fog: 0.75, mist: 0.8, detail: 0.9, step: 1, fov: 1.12, low: 0.8, dutch: 0.07, mode: 1 },
  stencil: { name: "stencil", toon: 2, key: 1.35, fill: 0.55, rim: 1.2, shadowSoft: 0, fog: 0.6, mist: 0.7, detail: 0.75, step: 2, fov: 0.86, low: 1, dutch: 0.04, mode: 2 },
};

// The video's art, set by the scene before its children draw (one profile for the whole video).
export const art: { now: Art; profile: Profile } = { now: { profile: "cinematic", strength: 0.75, detail: 0.8, atmosphere: "natural" }, profile: PROFILES.cinematic };

export const useArt = (a: Art | undefined) => {
  const now = a ?? { profile: "cinematic", strength: 0.75, detail: 0.8, atmosphere: "natural" };
  art.now = now;
  art.profile = PROFILES[now.profile] ?? PROFILES.cinematic;
  return art.profile;
};

// Hard light bands for the toon profiles: three for ink (shadow, half tone, light), two for a stencil.
const ramp = (levels: number[]) => {
  const data = new Uint8Array(levels.flatMap((v) => [v, v, v, 255]));
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
};
export const RAMPS = { 3: ramp([70, 160, 255]), 2: ramp([95, 255]) };
export const artRamp = () => (art.profile.toon === 2 ? RAMPS[2] : RAMPS[3]);
export const artToon = () => art.profile.toon > 0;

// A lit material turned into the profile's toon material, keeping its colour, texture and skinning.
export const toToon = (old: THREE.Material): THREE.Material => {
  const s = old as THREE.MeshStandardMaterial;
  if (!artToon() || (old as THREE.MeshToonMaterial).isMeshToonMaterial || (old as THREE.MeshBasicMaterial).isMeshBasicMaterial) return old;
  return new THREE.MeshToonMaterial({
    name: s.name, color: s.color ?? new THREE.Color("#ffffff"), map: s.map ?? null, gradientMap: artRamp(), vertexColors: Boolean(s.vertexColors),
    transparent: s.transparent, opacity: s.opacity ?? 1, alphaTest: s.alphaTest ?? 0, side: s.side ?? THREE.FrontSide,
    emissive: s.emissive ?? new THREE.Color("#000000"), emissiveMap: s.emissiveMap ?? null, emissiveIntensity: s.emissiveIntensity ?? 1,
  });
};

// --- the finishing pass ------------------------------------------------------------------------------

const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

const FRAG = `
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 res; uniform float near; uniform float far;
uniform int mode; uniform float strength; uniform float seed; uniform vec3 ink; uniform vec3 paper;
uniform vec3 p0; uniform vec3 p1; uniform vec3 p2; uniform vec3 p3; uniform float contrast; uniform vec3 haze; uniform float focus;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float lin(vec2 uv){ float z = texture2D(tDepth, uv).x; float n = z * 2.0 - 1.0; return (2.0 * near * far) / (far + near - n * (far - near)); }
// how strongly a pixel sits on an edge: a jump in depth (a silhouette, a fold) or in brightness
float edgeAt(vec2 uv, float w){
  vec2 px = w / res;
  float d0 = lin(uv);
  float dd = 0.0;
  dd = max(dd, abs(lin(uv + vec2(px.x, 0.0)) - d0));
  dd = max(dd, abs(lin(uv - vec2(px.x, 0.0)) - d0));
  dd = max(dd, abs(lin(uv + vec2(0.0, px.y)) - d0));
  dd = max(dd, abs(lin(uv - vec2(0.0, px.y)) - d0));
  float de = smoothstep(0.035, 0.09, dd / max(d0, 0.001));
  float l = luma(texture2D(tDiffuse, uv).rgb);
  float gx = luma(texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb) - luma(texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb);
  float gy = luma(texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb) - luma(texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb);
  float ce = smoothstep(0.16, 0.34, length(vec2(gx, gy)));
  // far off, lines thin out into the air
  float fade = 1.0 - smoothstep(focus * 3.0, focus * 10.0, d0);
  return max(de, ce * 0.55) * fade;
}
void main(){
  vec2 uv = vUv;
  vec4 src = texture2D(tDiffuse, uv);
  vec3 c = src.rgb;
  vec2 fc = uv * res;
  float k = res.y / 1080.0;
  if (mode == 0) {
    // film grade: an S-curve, cool shadows and warm highlights, a touch of saturation, grain
    float l = luma(c);
    c = mix(vec3(l), c, 1.0 + 0.12 * strength);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.35 * strength * contrast);
    c += mix(vec3(-0.012, 0.0, 0.018), vec3(0.02, 0.008, -0.014), smoothstep(0.2, 0.8, l)) * strength;
    c += (hash(fc + seed) - 0.5) * 0.025;
    gl_FragColor = vec4(c, src.a);
    return;
  }
  // a hand-drawn line wobbles: the edge is found a little off where the pixel is
  vec2 wob = (vec2(noise(fc * 0.045 + seed), noise(fc * 0.045 + seed + 9.0)) - 0.5) * 2.2 / res;
  if (mode == 1) {
    float e = edgeAt(uv + wob, 1.4 * k);
    float l = luma(c) * contrast;
    // the page: colour pulled towards the paper, flatter, slightly desaturated
    vec3 base = mix(c, vec3(luma(c)), 0.28) * mix(vec3(1.0), paper, 0.35);
    // hatching in screen space, wobbling, denser in deeper shadow, crossed in the deepest
    float s = 7.0 * k;
    float jit = noise(fc * 0.02 + seed) * 2.0;
    float h1 = 1.0 - smoothstep(0.0, 1.2 * k, abs(mod(fc.x + fc.y + jit, s) - s * 0.5) - 0.5 * k);
    float h2 = 1.0 - smoothstep(0.0, 1.2 * k, abs(mod(fc.x - fc.y + jit, s * 1.1) - s * 0.55) - 0.4 * k);
    float hatch = h1 * (1.0 - smoothstep(0.30, 0.48, l)) + h2 * (1.0 - smoothstep(0.14, 0.27, l));
    // halftone dots in the mid tones
    vec2 cell = mod(fc, 6.0 * k) - 3.0 * k;
    float dot = 1.0 - smoothstep(0.0, 1.0, length(cell) - mix(0.0, 2.2 * k, 1.0 - smoothstep(0.35, 0.65, l)));
    float tone = clamp(hatch * 0.85 + dot * 0.35 * smoothstep(0.3, 0.45, l), 0.0, 1.0);
    vec3 col = mix(base, ink, tone * 0.8 * strength);
    col = mix(col, ink, (1.0 - smoothstep(0.06, 0.13, l)) * strength); // solid blacks
    col = mix(col, ink, e * (0.55 + 0.45 * strength));
    col *= 0.93 + 0.07 * noise(fc * 0.5 + seed); // paper grain
    col = mix(c, col, 0.55 + 0.45 * strength);
    gl_FragColor = vec4(col, src.a);
    return;
  }
  // mode 2, a stencil print: four inks over paper in hard-edged shapes
  float l = luma(c) * contrast;
  float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float grain = noise(fc * 0.08 + seed) * 0.04 - 0.02;
  vec3 col = p0; // paper
  float mid = step(0.58 + grain, 1.0 - l);
  float dark = step(0.80 + grain, 1.0 - l);
  // the dark plate is pulled a little out of register
  vec2 off = vec2(2.0, -1.5) * k / res;
  float darkOff = step(0.80 + grain, 1.0 - luma(texture2D(tDiffuse, uv + off).rgb) * contrast);
  col = mix(col, p1, mid);
  col = mix(col, p2, max(dark, darkOff * 0.9));
  // the story's accent where the picture is strongly red (the accent ink is red): a red dress or a
  // warning light, not skin, wood or a brown coat
  float red = step(0.4, sat) * step(0.3, c.r) * step(c.g * 2.1, c.r) * step(c.b * 1.7, c.r);
  col = mix(col, p3, red);
  // heavy cut silhouettes
  float e = edgeAt(uv + wob * 0.5, 2.4 * k);
  col = mix(col, p2, step(0.45, e));
  // worn screen: ink knocked out in specks, paper fibre showing
  float speck = step(0.86, noise(fc * 0.35 + seed * 3.0)) * (mid + dark) * 0.5;
  col = mix(col, p0, speck * 0.6);
  col *= 0.95 + 0.05 * noise(fc * 0.7 + seed);
  col = mix(c, col, 0.35 + 0.65 * strength);
  gl_FragColor = vec4(col, src.a);
}`;

export const stylePass = () =>
  new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1080, 1920) }, near: { value: 0.1 }, far: { value: 4000 },
      mode: { value: 0 }, strength: { value: 0.75 }, seed: { value: 0 }, ink: { value: new THREE.Color("#1d1a17") }, paper: { value: new THREE.Color("#f2e8d2") },
      p0: { value: new THREE.Color("#efe4cc") }, p1: { value: new THREE.Color("#8a5a3a") }, p2: { value: new THREE.Color("#1b1612") }, p3: { value: new THREE.Color("#d23a2c") },
      contrast: { value: 1 }, focus: { value: 10 }, haze: { value: new THREE.Color("#ffffff") },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

// The pass's settings for this frame and this video's art.
export const tuneStyle = (pass: ShaderPass, a: Art, p: Profile, frame: number, cam: THREE.Camera, contrast: number, focus: number) => {
  const u = pass.uniforms;
  u.focus.value = focus;
  u.mode.value = p.mode;
  u.strength.value = a.strength;
  // a print's grain and a line's wobble hold for as long as a drawing does, then change
  u.seed.value = (Math.floor(frame / Math.max(1, p.step)) % 7) * 1.7;
  u.contrast.value = contrast;
  const pal = a.palette && a.palette.length >= 4 ? a.palette : ["#efe4cc", "#8a5a3a", "#1b1612", "#d23a2c"];
  u.p0.value.set(pal[0]);
  u.p1.value.set(pal[1]);
  u.p2.value.set(pal[2]);
  u.p3.value.set(pal[3]);
  if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
    u.near.value = (cam as THREE.PerspectiveCamera).near;
    u.far.value = (cam as THREE.PerspectiveCamera).far;
  }
};
