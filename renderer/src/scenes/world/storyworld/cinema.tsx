// The camera's side of a story world: the sky dome, the image-based light its reflections come from,
// soft contact shadows, reflective water, and the finishing passes (bloom, depth of field, grade). These
// are what make a generated set read as a lit, photographed place rather than shapes on a plane.
import React, { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { Water as MirrorWater } from "three/examples/jsm/objects/Water.js";
import { rng } from "../../world3d";
import { type Profile, stylePass, tuneStyle } from "./artstyle";
import { env } from "./style";
import type { Art } from "./types";

// --- sky --------------------------------------------------------------------------------------------

export type SkySpec = { top: string; horizon: string; below: string; sun: string; sunDir: THREE.Vector3; night: number; clouds: number; seed: number };

const SKY_VERT = "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }";
const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunCol; uniform vec3 sunDir;
uniform float night; uniform float clouds; uniform float seed; uniform float time;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + seed) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.65, h), 0.65));
  // below the horizon the sky holds the horizon (fog) colour a while, so a fogged ground meets it without a seam
  col = mix(col, below, smoothstep(-0.1, -0.45, h));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += sunCol * (pow(s, 900.0) * 6.0 * (1.0 - night) + (pow(s, 24.0) * 0.45 + pow(s, 4.0) * 0.16) * (1.0 - night * 0.7));
  if (night > 0.5) {
    // the moon, high behind the stage: a pale disc with darker seas and a wide soft halo
    vec3 md = normalize(vec3(-0.32, 0.36, -0.88));
    float m = dot(d, md);
    float disc = smoothstep(0.99955, 0.99965, m);
    vec2 mu = (d - md * m).xy * 900.0;
    float seas = 0.82 + 0.18 * noise(mu * 0.35 + 3.0);
    col = mix(col, vec3(1.0, 0.98, 0.92) * 1.6 * seas, disc);
    col += vec3(0.55, 0.65, 0.85) * (pow(max(m, 0.0), 400.0) * 0.5 + pow(max(m, 0.0), 30.0) * 0.12) * (1.0 - disc);
  }
  // a haze band at the horizon
  col = mix(col, horizon * 1.08, exp(-abs(h) * 14.0) * 0.5);
  if (h > 0.0 && clouds > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(time * 0.012, 0.0);
    float c = smoothstep(0.48, 0.82, fbm(uv + seed));
    float lit = 0.55 + 0.45 * pow(s, 3.0);
    vec3 cc = mix(mix(horizon, top, 0.25) * 1.15, sunCol, 0.25 * lit) * mix(1.0, 0.55, night);
    col = mix(col, cc * (0.75 + 0.35 * fbm(uv * 2.0)), c * clouds * smoothstep(0.0, 0.18, h));
  }
  if (night > 0.0 && h > 0.0) {
    vec2 g = floor(d.xz / (h + 0.4) * 260.0);
    float st = step(0.9965, hash(g));
    col += vec3(st * night * (0.6 + 0.4 * hash(g + 3.0))) * smoothstep(0.05, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export const skyMaterial = (sky: SkySpec, time = 0) =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(sky.top) }, horizon: { value: new THREE.Color(sky.horizon) }, below: { value: new THREE.Color(sky.below) },
      sunCol: { value: new THREE.Color(sky.sun) }, sunDir: { value: sky.sunDir.clone().normalize() }, night: { value: sky.night },
      clouds: { value: sky.clouds }, seed: { value: (sky.seed % 97) * 0.37 }, time: { value: time },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });

// The sky is drawn once into a cube map and shown as the scene background: per pixel it is then one
// texture lookup, not a cloud noise, which keeps a full-screen sky cheap to render frame after frame.
const skyCache = new Map<string, THREE.CubeTexture>();
export const SkyDome: React.FC<{ sky: SkySpec; t: number }> = ({ sky }) => {
  const { gl, scene } = useThree();
  const key = `${sky.top}${sky.horizon}${sky.below}${sky.sun}${sky.sunDir.toArray().map((x) => x.toFixed(2))}${sky.night}${sky.clouds}${sky.seed}`;
  const tex = useMemo(() => {
    let c = skyCache.get(key);
    if (!c) {
      const rt = new THREE.WebGLCubeRenderTarget(768, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cam = new THREE.CubeCamera(0.1, 2000, rt);
      const sc = new THREE.Scene();
      sc.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), skyMaterial(sky)));
      cam.update(gl, sc);
      c = rt.texture;
      skyCache.set(key, c);
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gl]);
  scene.background = tex;
  return null;
};

// The sky as image-based light: every glossy surface (paint, glass, water) reflects the same sky the
// camera sees, and shadowed sides pick up its colour instead of going flat.
const envCache = new Map<string, THREE.Texture>();
export const SkyLight: React.FC<{ sky: SkySpec; intensity: number }> = ({ sky, intensity }) => {
  const { gl, scene } = useThree();
  const key = `${sky.top}${sky.horizon}${sky.below}${sky.sun}${sky.sunDir.toArray().map((x) => x.toFixed(2))}${sky.night}`;
  const tex = useMemo(() => {
    let t = envCache.get(key);
    if (!t) {
      const pm = new THREE.PMREMGenerator(gl);
      const sc = new THREE.Scene();
      sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial({ ...sky, clouds: 0 })));
      t = pm.fromScene(sc, 0.02, 0.1, 400).texture;
      pm.dispose();
      envCache.set(key, t);
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, gl]);
  scene.environment = null;
  env.map = tex;
  env.intensity = intensity;
  return null;
};

// --- contact shadows --------------------------------------------------------------------------------

let blobTex: THREE.Texture | null = null;
const blobTexture = () => {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, "rgba(0,0,0,0.85)");
  gr.addColorStop(0.45, "rgba(0,0,0,0.45)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
};

// A soft dark pool under something standing on the ground, so it sits on it instead of floating.
export const ContactShadow: React.FC<{ w: number; d?: number; strength?: number; y?: number }> = ({ w, d, strength = 0.55, y = 0.015 }) => {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: strength, toneMapped: false }), [strength]);
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[w * 1.25, (d ?? w) * 1.25, 1]} material={mat} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
};

let poolTex: THREE.Texture | null = null;
const poolTexture = () => {
  if (poolTex) return poolTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
};

// A soft pool of coloured light on the ground round something, fading out at its edge.
export const GroundGlow: React.FC<{ w: number; color: string; strength?: number; at: [number, number, number] }> = ({ w, color, strength = 0.6, at }) => {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: poolTexture(), color, transparent: true, depthWrite: false, opacity: strength, blending: THREE.AdditiveBlending, toneMapped: false }), [color, strength]);
  return (
    <mesh position={at} rotation={[-Math.PI / 2, 0, 0]} scale={[w, w, 1]} material={mat} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
};

// --- water ------------------------------------------------------------------------------------------

let normals: THREE.DataTexture | null = null;
// A tiling normal map for ripples, from a few octaves of seeded noise (no image file to ship).
const waterNormals = () => {
  if (normals) return normals;
  const N = 256;
  const r = rng(91);
  const grid = 32;
  const lat = Array.from({ length: grid * grid }, () => r());
  const val = (x: number, y: number, f: number) => {
    const gx = (x / N) * f, gy = (y / N) * f;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const at = (i: number, j: number) => lat[(((j % f) + f) % f) * grid + (((i % f) + f) % f)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const h = (x: number, y: number) => val(x, y, 8) * 0.5 + val(x, y, 16) * 0.3 + val(x, y, 32) * 0.2;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 6, dy = (h(x, y + 1) - h(x, y - 1)) * 6;
      const v = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (v.x * 0.5 + 0.5) * 255;
      data[i + 1] = (v.y * 0.5 + 0.5) * 255;
      data[i + 2] = (v.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  normals = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  normals.needsUpdate = true;
  return normals;
};

// A mirror water surface: it reflects the sky, the far bank and whatever floats or flies over it.
export const ReflectiveWater: React.FC<{ w: number; d: number; at: [number, number, number]; color: string; sun: string; sunDir: THREE.Vector3; t: number; distortion?: number; fog: boolean }> = ({ w, d, at, color, sun, sunDir, t, distortion = 2.4, fog }) => {
  const water = useMemo(() => {
    const m = new MirrorWater(new THREE.PlaneGeometry(w, d), {
      textureWidth: 512, textureHeight: 512, waterNormals: waterNormals(), sunDirection: sunDir.clone().normalize(), sunColor: new THREE.Color(sun),
      waterColor: new THREE.Color(color), distortionScale: distortion, fog, alpha: 1,
    });
    m.rotation.x = -Math.PI / 2;
    (m.material as THREE.ShaderMaterial).uniforms.size.value = 6;
    return m;
  }, [w, d, color, sun, sunDir.x, sunDir.y, sunDir.z, distortion, fog]);
  (water.material as THREE.ShaderMaterial).uniforms.time.value = t * 0.6;
  return <primitive object={water} position={at} />;
};

// --- finishing --------------------------------------------------------------------------------------

const GRADE = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.35 }, grain: { value: 0.035 }, seed: { value: 0 }, lift: { value: new THREE.Color("#000000") }, gain: { value: new THREE.Color("#ffffff") } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform float grain; uniform float seed; uniform vec3 lift; uniform vec3 gain; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * gain + lift * (1.0 - c.rgb);
      vec2 q = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, length(q * vec2(1.0, 0.8)));
      col += (hash(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = vec4(col, c.a);
    }`,
};

export type Finish = { samples: number; bloom: number; threshold: number; focus: number; aperture: number; vignette: number; lift: string; gain: string; frame: number;
  // the art profile's finishing (artstyle.ts): grade, ink or print; glow: whether anything gives off light
  art?: Art; profile?: Profile; contrast?: number; glow?: boolean };

// The finishing passes, run in place of the plain render: the art profile's own pass first (a film
// grade, ink lines and hatching from the depth and edges, or a stencil print), bloom so lights and
// glows read as light, a shallow depth of field on close shots so the subject separates from the set.
export const Post: React.FC<{ finish: Finish }> = ({ finish }) => {
  const { gl, scene, camera, size } = useThree();
  const chain = useMemo(() => {
    const w = size.width * gl.getPixelRatio(), h = size.height * gl.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: finish.samples });
    // the scene's depth, for the ink and print passes' silhouettes
    target.depthTexture = new THREE.DepthTexture(w, h);
    target.depthTexture.type = THREE.UnsignedIntType;
    const composer = new EffectComposer(gl, target);
    // the scene is drawn into the composer's read buffer, whose depth the style pass reads after the
    // tone-mapping output pass, in display colours (nothing in between writes that buffer's depth)
    const style = stylePass();
    class DepthRenderPass extends RenderPass {
      render(r: THREE.WebGLRenderer, w: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, dt: number, mask: boolean) {
        style.uniforms.tDepth.value = read.depthTexture;
        super.render(r, w, read, dt, mask);
      }
    }
    composer.addPass(new DepthRenderPass(scene, camera));
    const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.0002, maxblur: 0.006 });
    if (finish.aperture > 0) composer.addPass(bokeh);
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width / 2, size.height / 2), 0.4, 0.55, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.addPass(style);
    const grade = new ShaderPass(GRADE);
    composer.addPass(grade);
    grade.enabled = false; // the vignette is drawn over the frame instead
    return { composer, bokeh, bloom, grade, style };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, size.width, size.height, finish.samples, finish.aperture > 0]);
  useEffect(() => () => chain.composer.dispose(), [chain]);
  useFrame(() => {
    const { composer, bokeh, bloom, grade, style } = chain;
    bloom.enabled = finish.glow !== false;
    bloom.strength = finish.bloom;
    bloom.threshold = finish.threshold;
    bokeh.enabled = finish.aperture > 0;
    const u = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    u.focus.value = finish.focus;
    u.aperture.value = finish.aperture;
    grade.uniforms.vignette.value = finish.vignette;
    grade.uniforms.seed.value = finish.frame * 0.618;
    grade.uniforms.lift.value.set(finish.lift);
    grade.uniforms.gain.value.set(finish.gain);
    style.enabled = Boolean(finish.art && finish.profile);
    if (finish.art && finish.profile) {
      tuneStyle(style, finish.art, finish.profile, finish.frame, camera, finish.contrast ?? 1, finish.focus);
      style.uniforms.res.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    }
    composer.render();
  }, 1);
  return null;
};
