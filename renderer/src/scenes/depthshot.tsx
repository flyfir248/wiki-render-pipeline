// A storyboard picture shot like a camera moving through it (fyt/depth.py gives each picture a depth map).
//
// Every pixel is shifted by how near it is as the camera moves: the foreground slides past the
// background, a push-in grows what is near faster than what is far. The shift is solved a few times per
// pixel (each step reads the depth where the last one landed), so edges hold instead of smearing. Over
// it go the shot's weather or air (rain, snow, fog, smoke, embers, dust) and, on an impact, a jolt.
import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import type { Atmosphere, ShotMove } from "../types";

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D img;
uniform sampler2D dep;
uniform vec2 cover;   // screen uv -> picture uv scale, so the picture covers the frame
uniform vec2 origin;  // where a zoom or cut-in is centred, in picture uv
uniform float zoom;
uniform vec2 shift;   // camera travel: how far the nearest pixels move
uniform float dolly;  // camera push: how much more the nearest pixels grow than the farthest
uniform float pivot;  // the depth that stays put
void main() {
  vec2 base = origin + ((vUv - 0.5) * cover + 0.5 - origin) / zoom;
  vec2 p = base;
  for (int i = 0; i < 6; i++) {
    float d = texture2D(dep, clamp(p, 0.0, 1.0)).r - pivot;
    p = base - shift * d - (base - origin) * dolly * d;
  }
  gl_FragColor = texture2D(img, clamp(p, 0.001, 0.999));
}`;

const load = (src: string) =>
  new Promise<THREE.Texture>((resolve, reject) => new THREE.TextureLoader().load(staticFile(src), resolve, undefined, reject));

// The move over the shot, k = 0..1 (eased). Pivot: the depth that stays still while the rest moves.
const moveAt = (move: ShotMove, k: number) => {
  const m = { zoom: 1.08, shift: [0, 0] as [number, number], dolly: 0, pivot: 0.5 };
  switch (move) {
    case "push_in":
      return { ...m, zoom: 1.06 + 0.1 * k, dolly: 0.16 * k, pivot: 0.1 };
    case "pull_out":
      return { ...m, zoom: 1.16 - 0.1 * k, dolly: 0.16 * (1 - k), pivot: 0.1 };
    case "truck_left":
      return { ...m, zoom: 1.1, shift: [0.05 * (k - 0.5), 0] as [number, number] };
    case "truck_right":
      return { ...m, zoom: 1.1, shift: [-0.05 * (k - 0.5), 0] as [number, number] };
    case "rise":
      return { ...m, zoom: 1.1, shift: [0, 0.045 * (k - 0.5)] as [number, number] };
    case "orbit":
      return { ...m, zoom: 1.1 + 0.03 * k, shift: [0.045 * Math.sin((k - 0.5) * Math.PI), 0.01 * k] as [number, number], dolly: 0.05 * k };
  }
};

const Plane: React.FC<{ img: THREE.Texture; dep: THREE.Texture; uniforms: Record<string, unknown> }> = ({ img, dep, uniforms }) => {
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false,
      uniforms: { img: { value: img }, dep: { value: dep }, cover: { value: new THREE.Vector2(1, 1) }, origin: { value: new THREE.Vector2(0.5, 0.5) },
        zoom: { value: 1 }, shift: { value: new THREE.Vector2() }, dolly: { value: 0 }, pivot: { value: 0.5 } } }),
    [img, dep],
  );
  for (const [k, v] of Object.entries(uniforms)) {
    const u = material.uniforms[k];
    if (Array.isArray(v)) (u.value as THREE.Vector2).set(v[0], v[1]);
    else u.value = v;
  }
  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

export const DepthShot: React.FC<{
  src: string;
  depth: string;
  move: ShotMove;
  aspect: number; // the picture's width / height
  crop?: { zoom: number; at: [number, number] } | null; // a cut-in: tighter, centred on the subject
  effect?: Atmosphere;
  kick?: boolean; // cuts in with a short zoom punch
}> = ({ src, depth, move, aspect, crop, effect, kick }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const [tex, setTex] = useState<[THREE.Texture, THREE.Texture] | null>(null);
  const [handle] = useState(() => delayRender(`loading ${src} and its depth`, { timeoutInMilliseconds: 60000 }));
  useEffect(() => {
    Promise.all([load(src), load(depth)])
      .then(([a, b]) => {
        for (const t of [a, b]) {
          t.minFilter = THREE.LinearFilter;
          t.generateMipmaps = false;
        }
        setTex([a, b]);
      })
      .catch(() => setTex(null))
      .finally(() => continueRender(handle));
  }, [src, depth, handle]);
  const k = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const m = moveAt(move, k);
  const punch = kick ? interpolate(frame, [0, 7], [1.07, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
  const jolt = effect === "shake" && frame < 18 ? Math.exp(-frame / 5) : 0;
  const screen = width / height;
  // picture uv per screen uv: the picture covers the frame, cropped on its longer side
  const cover: [number, number] = aspect > screen ? [screen / aspect, 1] : [1, aspect / screen];
  const at = crop?.at ?? [0.5, 0.5];
  const uniforms = {
    cover,
    origin: [at[0], 1 - at[1]] as [number, number], // textures run bottom-up
    zoom: m.zoom * (crop?.zoom ?? 1) * punch,
    shift: [m.shift[0] + jolt * 0.012 * Math.sin(frame * 2.7), m.shift[1] + jolt * 0.012 * Math.cos(frame * 3.3)] as [number, number],
    dolly: m.dolly,
    pivot: m.pivot,
  };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {tex ? (
        <ThreeCanvas width={width} height={height} linear flat gl={{ antialias: false }}>
          <Plane img={tex[0]} dep={tex[1]} uniforms={uniforms} />
        </ThreeCanvas>
      ) : null}
      {effect && effect !== "shake" ? <Air kind={effect} /> : null}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.42) 100%)" }} />
    </AbsoluteFill>
  );
};

// A stable pseudo-random number in 0..1 for particle i of a kind.
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Weather and air over a shot: drawn in screen space, nearer particles bigger, faster and sharper.
export const Air: React.FC<{ kind: Exclude<Atmosphere, "" | "shake"> }> = ({ kind }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  if (kind === "fog" || kind === "smoke") {
    const dark = kind === "smoke";
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {[0, 1, 2].map((i) => {
          const x = ((t * (12 + i * 7) + i * 40) % 140) - 70;
          return (
            <AbsoluteFill
              key={i}
              style={{
                transform: `translate(${x}%, ${dark ? -t * (4 + i) : 0}%) scale(${1.4 + i * 0.2})`,
                background: dark
                  ? `radial-gradient(ellipse 60% 35% at ${30 + i * 20}% ${85 - i * 8}%, rgba(30,28,26,${0.55 - i * 0.12}), transparent 70%)`
                  : `radial-gradient(ellipse 70% 25% at ${40 + i * 15}% ${70 - i * 12}%, rgba(220,226,232,${0.32 - i * 0.07}), transparent 72%)`,
                filter: "blur(18px)",
              }}
            />
          );
        })}
      </AbsoluteFill>
    );
  }
  const n = kind === "rain" ? 140 : kind === "snow" ? 110 : kind === "embers" ? 60 : 50;
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {kind === "embers" ? (
        <defs>
          <radialGradient id="ember">
            <stop offset="0%" stopColor="#ffe2a0" />
            <stop offset="45%" stopColor="#ff8a2a" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#ff5a00" stopOpacity={0} />
          </radialGradient>
        </defs>
      ) : null}
      {Array.from({ length: n }, (_, i) => {
        const near = 0.35 + 0.65 * rnd(i, 1); // 1: close to the lens
        const x0 = rnd(i, 2) * width;
        if (kind === "rain") {
          const v = height * (1.6 + near * 1.4);
          const y = ((rnd(i, 3) * height + t * v) % (height * 1.2)) - height * 0.1;
          const len = 30 + 60 * near;
          return <line key={i} x1={x0 + y * 0.12} y1={y} x2={x0 + (y + len) * 0.12} y2={y + len} stroke="rgba(210,225,240,0.5)" strokeWidth={1 + 1.6 * near} opacity={0.25 + 0.45 * near} />;
        }
        if (kind === "snow") {
          const v = height * (0.06 + 0.12 * near);
          const y = (rnd(i, 3) * height + t * v) % height;
          const x = x0 + Math.sin(t * (0.8 + near) + i) * 18 * near;
          return <circle key={i} cx={x} cy={y} r={1.5 + 4.5 * near} fill="#fff" opacity={0.35 + 0.5 * near} />;
        }
        if (kind === "embers") {
          const v = height * (0.08 + 0.14 * near);
          const y = height - ((rnd(i, 3) * height + t * v) % height);
          const x = x0 + Math.sin(t * 1.7 + i) * 22 * near;
          const flick = 0.55 + 0.45 * Math.sin(t * 9 + i * 3);
          return <circle key={i} cx={x} cy={y} r={2 + 5 * near} fill="url(#ember)" opacity={flick * (0.5 + 0.5 * near)} />;
        }
        // dust: slow motes catching the light
        const y = (rnd(i, 3) * height + Math.sin(t * 0.3 + i) * 30) % height;
        const x = x0 + t * 8 * (rnd(i, 4) - 0.5) * 4;
        return <circle key={i} cx={x} cy={y} r={1 + 2.5 * near} fill="#fff4d8" opacity={0.15 + 0.35 * near * (0.6 + 0.4 * Math.sin(t * 2 + i))} />;
      })}
    </svg>
  );
};
