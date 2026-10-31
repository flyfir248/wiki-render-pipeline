// The worlds a scale journey passes through, each drawn at its own scale and handed L (log10 metres) to
// place its camera: the street and the city around it, the Earth from above, the solar system, the
// nearby stars, the galaxy, and the web of galaxies out to the edge of what can be seen. Neighbouring
// worlds overlap in L and cross-fade (Journey.tsx), so the camera never cuts.
import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { rng } from "../scenes/world3d";
import { AU, LY, smooth } from "./scale";

export type ZoneProps = { L: number; t: number; seed: number; portrait: boolean };

export type ZoneName = "ground" | "earth" | "solar" | "stars" | "galaxy" | "cosmic";
// Where each world is drawn, in L. The overlaps are the cross-fades.
export const ZONES: { name: ZoneName; from: number; to: number }[] = [
  { name: "ground", from: -2, to: 4.75 },
  { name: "earth", from: 4.45, to: 9.35 },
  { name: "solar", from: 9.05, to: 15.75 },
  { name: "stars", from: 15.45, to: 20.45 },
  { name: "galaxy", from: 20.15, to: 22.95 },
  { name: "cosmic", from: 22.65, to: 30 },
];
export const FADE = 0.3; // the width of a cross-fade, in L

const setCamera = (camera: THREE.Camera, pos: THREE.Vector3, look: THREE.Vector3, near: number, far: number, fov: number, up = new THREE.Vector3(0, 1, 0)) => {
  camera.position.copy(pos);
  camera.up.copy(up);
  camera.lookAt(look);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.near = near;
    camera.far = far;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
};

const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

// A soft round dot for point sprites, so stars and galaxies are glows rather than squares.
let glowTex: THREE.Texture | null = null;
const glow = () => {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,255,255,0.75)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  return glowTex;
};

// Value noise for the procedural maps.
const noise2 = (seed: number) => {
  const r = rng(seed);
  const N = 256;
  const v = Array.from({ length: N * N }, () => r());
  const at = (x: number, y: number) => v[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = (q: number) => q * q * (3 - 2 * q);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * s(xf);
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * s(xf);
    return a + (b - a) * s(yf);
  };
};
const fbm = (n: (x: number, y: number) => number, x: number, y: number, oct = 5) => {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f, y * f);
    a *= 0.5;
    f *= 2;
  }
  return s;
};

const mix = (a: string, b: string, k: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, k))).getHexString();

// ---------------------------------------------------------------- the street and the land around it

type Box = { x: number; z: number; w: number; d: number; h: number; color: string };

const PALETTE = ["#d9cbb3", "#c2b49a", "#b9c3cc", "#e2ddd2", "#a7b4bf", "#cfc2ad", "#8e9aa6", "#c9a68a"];

const cityBlocks = (seed: number): Box[] => {
  const r = rng(seed + 11);
  const out: Box[] = [];
  // houses along your street, then city blocks out to about 2.5 km, thinning toward the edge
  for (let i = -30; i <= 30; i++)
    for (const side of [-1, 1]) {
      if (r() < 0.15) continue;
      out.push({ x: side * (14 + r() * 4), z: i * 14 + r() * 3, w: 9 + r() * 3, d: 10 + r() * 3, h: 6 + r() * 6, color: PALETTE[Math.floor(r() * PALETTE.length)] });
    }
  const step = 90;
  for (let gx = -28; gx <= 28; gx++)
    for (let gz = -28; gz <= 28; gz++) {
      const x = gx * step;
      const z = gz * step;
      const dist = Math.hypot(x, z);
      if (dist < 450 || r() < dist / 2600) continue;
      const tall = Math.max(0, 1 - dist / 1600);
      const n = 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const w = 18 + r() * 22;
        out.push({
          x: x + (r() - 0.5) * 50, z: z + (r() - 0.5) * 50, w, d: 18 + r() * 22,
          h: 10 + r() * 25 + (r() < tall * 0.5 ? r() ** 2 * 220 * tall : 0),
          color: PALETTE[Math.floor(r() * PALETTE.length)],
        });
      }
    }
  return out;
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);

const Buildings: React.FC<{ boxes: Box[] }> = ({ boxes }) => {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), boxes.length);
    const o = new THREE.Object3D();
    boxes.forEach((b, i) => {
      o.position.set(b.x, 0, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new THREE.Color(b.color));
    });
    return m;
  }, [boxes]);
  return <primitive object={mesh} />;
};

const Trees: React.FC<{ seed: number }> = ({ seed }) => {
  const mesh = useMemo(() => {
    const r = rng(seed + 21);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    geo.translate(0, 1.6, 0);
    const n = 160;
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true, color: "#5f8f4e" }), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const side = r() < 0.5 ? -1 : 1;
      o.position.set(side * (8.5 + r() * 1.2), 0, (i - n / 2) * 5.3 + r() * 2);
      const s = 2 + r() * 1.4;
      o.scale.set(s, s * 1.3, s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new THREE.Color(mix("#4f7f43", "#7aa35a", r())));
    }
    return m;
  }, [seed]);
  return <primitive object={mesh} />;
};

// The people on your street, who look up as you grow.
const People: React.FC<{ seed: number }> = ({ seed }) => {
  const mesh = useMemo(() => {
    const r = rng(seed + 31);
    const geo = new THREE.CapsuleGeometry(0.25, 1.1, 3, 6);
    geo.translate(0, 0.8, 0);
    const n = 70;
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true }), n);
    const o = new THREE.Object3D();
    const cloth = ["#c0392b", "#2c3e50", "#e67e22", "#16a085", "#8e44ad", "#f1c40f", "#34495e", "#ecf0f1"];
    for (let i = 0; i < n; i++) {
      const side = r() < 0.5 ? -1 : 1;
      o.position.set(side * (6 + r() * 1.5), 0, -4 - r() * 220);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new THREE.Color(cloth[Math.floor(r() * cloth.length)]));
    }
    return m;
  }, [seed]);
  return <primitive object={mesh} />;
};

const Cars: React.FC<{ seed: number; t: number }> = ({ seed, t }) => {
  const r = useMemo(() => {
    const q = rng(seed + 41);
    return Array.from({ length: 16 }, () => ({ lane: q() < 0.5 ? -1 : 1, z0: (q() - 0.5) * 800, v: 8 + q() * 6, color: ["#c0392b", "#2980b9", "#ecf0f1", "#2c3e50", "#f39c12"][Math.floor(q() * 5)] }));
  }, [seed]);
  return (
    <>
      {r.map((c, i) => {
        const z = ((c.z0 - c.lane * c.v * t + 400) % 800 + 800) % 800 - 400;
        return (
          <mesh key={i} geometry={unitBox} position={[c.lane * 2.2, 0, z]} scale={[1.8, 1.4, 4.2]}>
            <meshStandardMaterial color={c.color} flatShading />
          </mesh>
        );
      })}
    </>
  );
};

const groundTexture = (seed: number) =>
  canvasTexture(2048, 2048, (g) => {
    // fields and woods out to the horizon, the city grey in the middle
    const n = noise2(seed + 51);
    const img = g.createImageData(2048, 2048);
    const cols = ["#8aa65a", "#a7b968", "#6f9150", "#b9a76a", "#93ad62", "#5f7f45"].map((c) => new THREE.Color(c));
    for (let y = 0; y < 2048; y++)
      for (let x = 0; x < 2048; x++) {
        const fx = Math.floor(x / 24);
        const fy = Math.floor(y / 24);
        const pick = Math.floor(n(fx * 7.3, fy * 3.1) * cols.length * 1.3) % cols.length;
        const c = cols[pick].clone().multiplyScalar(0.85 + 0.3 * fbm(n, x / 90, y / 90, 3));
        const dx = (x - 1024) / 1024;
        const dy = (y - 1024) / 1024;
        const city = smooth(0.09, 0.03, Math.hypot(dx, dy) + 0.02 * n(x / 30, y / 30));
        c.lerp(new THREE.Color("#8d9198"), city);
        const i = (y * 2048 + x) * 4;
        img.data[i] = c.r * 255;
        img.data[i + 1] = c.g * 255;
        img.data[i + 2] = c.b * 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });

const streetTexture = () =>
  canvasTexture(256, 1024, (g) => {
    g.fillStyle = "#3d4046";
    g.fillRect(0, 0, 256, 1024);
    g.fillStyle = "#e3b23c";
    g.fillRect(122, 0, 4, 1024);
    g.fillRect(130, 0, 4, 1024);
    g.fillStyle = "#e9e6dc";
    for (let y = 0; y < 1024; y += 64) {
      g.fillRect(56, y, 4, 34);
      g.fillRect(196, y, 4, 34);
    }
  });

const Clouds: React.FC<{ seed: number }> = ({ seed }) => {
  const mesh = useMemo(() => {
    const r = rng(seed + 61);
    const n = 260;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: "#ffffff", flatShading: true, roughness: 1, transparent: true, opacity: 0.92 }), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = 600 + r() ** 0.7 * 45000;
      o.position.set(Math.cos(a) * d, 2200 + r() * 1400, Math.sin(a) * d);
      const s = 500 + r() * 1400;
      o.scale.set(s * (1.5 + r()), s * 0.45, s * (1.2 + r()));
      o.rotation.y = r() * 3;
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    return m;
  }, [seed]);
  return <primitive object={mesh} />;
};

const Mountains: React.FC<{ seed: number }> = ({ seed }) => {
  const mesh = useMemo(() => {
    const r = rng(seed + 71);
    const n = 46;
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true }), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 90000;
      const z = -38000 - r() * 30000;
      const h = i === 0 ? 8849 : 2500 + r() * 5000;
      o.position.set(i === 0 ? 3000 : x, 0, i === 0 ? -42000 : z);
      o.scale.set(h * 1.6, h, h * 1.4);
      o.rotation.y = r() * 3;
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new THREE.Color(mix("#7c7468", "#a69a8a", r())));
    }
    return m;
  }, [seed]);
  const caps = useMemo(() => {
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, -0.5, 0);
    return geo;
  }, []);
  return (
    <>
      <primitive object={mesh} />
      <mesh geometry={caps} position={[3000, 8849, -42000]} scale={[1600 * 1.6 * 0.28, 8849 * 0.28, 1600 * 1.4 * 0.28 * (8849 / 1600)]}>
        <meshStandardMaterial color="#f4f6f8" flatShading />
      </mesh>
    </>
  );
};

// The tallest tower, ahead of you in the city.
const Tower: React.FC = () => (
  <group position={[260, 0, -1500]}>
    {[0, 1, 2, 3, 4, 5].map((k) => (
      <mesh key={k} geometry={unitBox} position={[0, k * 115, 0]} scale={[60 - k * 9, 120, 60 - k * 9]}>
        <meshStandardMaterial color="#b9c7d4" metalness={0.3} roughness={0.4} flatShading />
      </mesh>
    ))}
    <mesh position={[0, 690 + 70, 0]}>
      <coneGeometry args={[6, 140, 6]} />
      <meshStandardMaterial color="#d4dde5" flatShading />
    </mesh>
  </group>
);

const Airliner: React.FC<{ t: number }> = ({ t }) => (
  <group position={[-3000 + ((t * 240) % 9000), 11000, -2600]} rotation={[0, Math.PI / 2, 0]}>
    <mesh scale={[4, 4, 60]}>
      <cylinderGeometry args={[1, 1, 1, 10]} />
      <meshStandardMaterial color="#f2f2f2" />
    </mesh>
    <mesh scale={[60, 1, 8]}>
      <boxGeometry />
      <meshStandardMaterial color="#e0e0e0" />
    </mesh>
  </group>
);

export const GroundZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const boxes = useMemo(() => cityBlocks(seed), [seed]);
  const land = useMemo(() => groundTexture(seed), [seed]);
  const street = useMemo(() => {
    const s = streetTexture();
    s.wrapS = s.wrapT = THREE.RepeatWrapping;
    s.repeat.set(1, 60);
    return s;
  }, []);
  const h = Math.max(1.5, 10 ** L);
  // eye height = your height; looking along the street, tipping down as the ground falls away
  const pitch = 0.04 + 0.62 * smooth(0.4, 4.3, L);
  const yaw = -0.18 + t * 0.006;
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const pos = new THREE.Vector3(0, h, h * 0.25);
  const look = pos.clone().add(fwd.clone().multiplyScalar(Math.cos(pitch) * 10 * h)).add(new THREE.Vector3(0, -Math.sin(pitch) * 10 * h, 0));
  setCamera(camera, pos, look, Math.max(0.05, h * 0.02), Math.max(4000, h * 400), portrait ? 72 : 58);
  // the sky darkens as you leave the air
  const sky = mix(mix("#a9c9e6", "#5b8fd0", smooth(2.5, 4.0, L)), "#0b1830", smooth(4.0, 4.8, L));
  const haze = mix("#cfe0ee", "#7aa2d6", smooth(2.5, 4.4, L));
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(haze, h * 8, Math.max(2500, h * 60));
  return (
    <>
      <hemisphereLight args={["#dfeeff", "#6b6250", 0.9]} />
      <directionalLight position={[-0.6, 1, 0.4]} intensity={2.2} color="#fff1d8" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[200000, 200000]} />
        <meshStandardMaterial map={land} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[11, 900]} />
        <meshStandardMaterial map={street} roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[20, 900]} />
        <meshStandardMaterial color="#a7a49d" roughness={1} />
      </mesh>
      <Buildings boxes={boxes} />
      <Trees seed={seed} />
      {L < 2.6 ? <People seed={seed} /> : null}
      {L < 2.8 ? <Cars seed={seed} t={t} /> : null}
      <Tower />
      <Clouds seed={seed} />
      <Mountains seed={seed} />
      {L > 3.6 && L < 4.5 ? <Airliner t={t} /> : null}
    </>
  );
};

// ---------------------------------------------------------------- the Earth from above (km)

const R_EARTH = 6371;

const earthTexture = (seed: number) =>
  canvasTexture(2048, 1024, (g) => {
    const n = noise2(seed + 81);
    const img = g.createImageData(2048, 1024);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 2048; x++) {
        const lat = Math.abs(y / 1024 - 0.5) * 2;
        const e = fbm(n, x / 180, y / 180, 6) - 0.5 + 0.12 * Math.sin(x / 320) ;
        let c: THREE.Color;
        if (lat > 0.88) c = new THREE.Color("#eef3f7");
        else if (e > 0.02) {
          const dry = fbm(n, x / 60 + 40, y / 60, 3);
          c = new THREE.Color(mix(mix("#4f7d3a", "#9b8a55", dry * 1.4 - 0.2), "#7a6f5c", smooth(0.15, 0.3, e)));
          if (lat > 0.75) c.lerp(new THREE.Color("#e8eef2"), smooth(0.75, 0.88, lat));
        } else c = new THREE.Color(mix("#1d4f8a", "#2f72b0", smooth(-0.15, 0.02, e)));
        const i = (y * 2048 + x) * 4;
        img.data[i] = c.r * 255;
        img.data[i + 1] = c.g * 255;
        img.data[i + 2] = c.b * 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });

const cloudTexture = (seed: number) =>
  canvasTexture(2048, 1024, (g) => {
    const n = noise2(seed + 91);
    const img = g.createImageData(2048, 1024);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 2048; x++) {
        const v = smooth(0.52, 0.72, fbm(n, x / 70, y / 50, 5));
        const i = (y * 2048 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = v * 235;
      }
    g.putImageData(img, 0, 0);
  });

const atmosphereMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color("#5aa8ff") } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(color, f*1.2); }",
  });

const Starfield: React.FC<{ seed: number; radius: number; count?: number; size?: number }> = ({ seed, radius, count = 3000, size = 2 }) => {
  const geo = useMemo(() => {
    const r = rng(seed + 101);
    const p = new Float32Array(count * 3);
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(radius);
      p.set([v.x, v.y, v.z], i * 3);
      const col = new THREE.Color(mix("#bcd2ff", "#ffe2b8", r())).multiplyScalar(0.4 + r() * 0.6);
      c.set([col.r, col.g, col.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }, [seed, radius, count]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={size} sizeAttenuation={false} vertexColors map={glow()} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

const SUN_DIR = new THREE.Vector3(-1, 0.35, 0.55).normalize();
// your street, on the globe
const HOME = new THREE.Vector3(0.25, 0.62, 0.74).normalize();

export const EarthZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const tex = useMemo(() => earthTexture(seed), [seed]);
  const clouds = useMemo(() => cloudTexture(seed), [seed]);
  const atmo = useMemo(atmosphereMaterial, []);
  const hKm = 10 ** L / 1000;
  const d = R_EARTH + hKm;
  // first looking along the horizon, then straight down at the whole Earth as it shrinks
  const side = new THREE.Vector3().crossVectors(HOME, new THREE.Vector3(0, 1, 0)).normalize();
  const along = new THREE.Vector3().crossVectors(side, HOME).normalize();
  const pos = HOME.clone().multiplyScalar(d);
  const down = smooth(4.6, 7.0, L);
  const horizon = pos.clone().add(along.clone().multiplyScalar(d * 2)).add(HOME.clone().multiplyScalar(-hKm * 0.9));
  const look = horizon.lerp(new THREE.Vector3(0, 0, 0), down);
  const tilt = side.clone().multiplyScalar(0.25 * down).add(along.clone().multiplyScalar(-0.2 * down));
  pos.add(tilt.multiplyScalar(d));
  setCamera(camera, pos, look, Math.max(0.01, hKm * 0.05), d * 40 + 1e6, portrait ? 70 : 55, HOME.clone().lerp(along, down));
  scene.background = new THREE.Color("#02040a");
  scene.fog = null;
  const spin = t * 0.004;
  const moon = HOME.clone().multiplyScalar(Math.cos(0.45)).add(side.clone().multiplyScalar(Math.sin(0.45))).multiplyScalar(384400);
  return (
    <>
      <ambientLight intensity={0.08} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(1e6).toArray()} intensity={3} color="#fff4e2" />
      <group rotation={[0, spin, 0]}>
        <mesh>
          <sphereGeometry args={[R_EARTH, 96, 64]} />
          <meshStandardMaterial map={tex} roughness={0.9} />
        </mesh>
        <mesh rotation={[0, spin * 0.6, 0]}>
          <sphereGeometry args={[R_EARTH * 1.006, 96, 64]} />
          <meshStandardMaterial map={clouds} transparent depthWrite={false} />
        </mesh>
      </group>
      <mesh material={atmo}>
        <sphereGeometry args={[R_EARTH * 1.035, 64, 48]} />
      </mesh>
      <mesh position={moon.toArray()}>
        <sphereGeometry args={[1737, 48, 32]} />
        <meshStandardMaterial color="#b9b6ae" roughness={1} />
      </mesh>
      <Starfield seed={seed} radius={1e7} count={2500} />
    </>
  );
};

// ---------------------------------------------------------------- the solar system (AU)

const PLANETS = [
  { a: 0.39, c: "#b5aca0", s: 1.6 }, { a: 0.72, c: "#e8d7a8", s: 2.2 }, { a: 1, c: "#5aa0e6", s: 2.4 },
  { a: 1.52, c: "#d0704a", s: 1.9 }, { a: 5.2, c: "#d8b98c", s: 4 }, { a: 9.54, c: "#e6d39a", s: 3.6 },
  { a: 19.2, c: "#9fd9e0", s: 3 }, { a: 30.1, c: "#5f7fe0", s: 3 },
];

const Ring: React.FC<{ r: number; color: string; opacity: number }> = ({ r, color, opacity }) => {
  const geo = useMemo(() => {
    const pts = Array.from({ length: 257 }, (_, i) => new THREE.Vector3(Math.cos((i / 256) * Math.PI * 2) * r, 0, Math.sin((i / 256) * Math.PI * 2) * r));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [r]);
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineLoop>
  );
};

const SunGlow: React.FC<{ scale: number }> = ({ scale }) => (
  <sprite scale={[scale, scale, scale]}>
    <spriteMaterial map={glow()} color="#ffd890" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
  </sprite>
);

const Belt: React.FC<{ seed: number; from: number; to: number; count: number; flat: number; color: string; size: number }> = ({ seed, from, to, count, flat, color, size }) => {
  const geo = useMemo(() => {
    const r = rng(seed);
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const rad = from * (to / from) ** r();
      const a = r() * Math.PI * 2;
      const el = (r() - 0.5) * Math.PI * flat;
      p.set([Math.cos(a) * Math.cos(el) * rad, Math.sin(el) * rad, Math.sin(a) * Math.cos(el) * rad], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [seed, from, to, count, flat]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={size} sizeAttenuation={false} color={color} map={glow()} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

export const SolarZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const d = 10 ** L / AU; // AU
  const a = 0.9 + t * 0.01;
  const incl = 0.35 + 0.6 * smooth(10, 13, L);
  // Earth sits where the camera started, then the view centres on the Sun
  const earth = new THREE.Vector3(Math.cos(2.2), 0, Math.sin(2.2));
  const target = earth.clone().multiplyScalar(1 - smooth(9.2, 11.6, L));
  const pos = target.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(incl), Math.sin(incl), Math.sin(a) * Math.cos(incl)).multiplyScalar(d * 1.1));
  setCamera(camera, pos, target, d * 0.01, d * 100 + 1e6, portrait ? 70 : 55);
  scene.background = new THREE.Color("#02030a");
  scene.fog = null;
  const r = rng(seed + 111);
  return (
    <>
      <SunGlow scale={Math.max(0.05, d * 0.06)} />
      <mesh>
        <sphereGeometry args={[0.00465, 32, 16]} />
        <meshBasicMaterial color="#fff2c0" />
      </mesh>
      {PLANETS.map((p, i) => {
        const ang = i === 2 ? 2.2 : r() * Math.PI * 2;
        return (
          <group key={i}>
            <Ring r={p.a} color="#7f9bd0" opacity={0.55 * (1 - smooth(13.2, 14.6, L))} />
            <mesh position={[Math.cos(ang) * p.a, 0, Math.sin(ang) * p.a]} scale={Math.max(d * 0.004 * p.s, 0.00004)}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshBasicMaterial color={p.c} />
            </mesh>
          </group>
        );
      })}
      <Belt seed={seed + 1} from={2.2} to={3.3} count={1500} flat={0.03} color="#a89f90" size={1.4} />
      <Belt seed={seed + 2} from={30} to={50} count={3000} flat={0.12} color="#9fb6d9" size={1.4} />
      <Belt seed={seed + 3} from={2000} to={100000} count={9000} flat={1} color="#9fb6d9" size={1.2} />
      <Starfield seed={seed} radius={1e8} count={3000} />
    </>
  );
};

// ---------------------------------------------------------------- the nearby stars (light-years)

export const StarsZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const d = 10 ** L / LY;
  const a = 0.4 + t * 0.008;
  const incl = 0.32 + 0.25 * smooth(18, 20.3, L);
  const pos = new THREE.Vector3(Math.cos(a) * Math.cos(incl), Math.sin(incl), Math.sin(a) * Math.cos(incl)).multiplyScalar(d * 1.15);
  setCamera(camera, pos, new THREE.Vector3(), d * 0.001, d * 200 + 1e5, portrait ? 70 : 55);
  scene.background = new THREE.Color("#010208");
  scene.fog = null;
  const geo = useMemo(() => {
    const r = rng(seed + 121);
    const n = 24000;
    const p = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const rad = 10 ** (0.4 + r() * 4.3);
      const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * Math.min(1, 900 / rad), r() - 0.5).normalize();
      const v = dir.multiplyScalar(rad);
      p.set([v.x, v.y * Math.min(1, 700 / rad), v.z], i * 3);
      const col = new THREE.Color(mix(mix("#9fbfff", "#ffffff", r()), "#ffc78a", r() * r())).multiplyScalar(0.5 + r() * 0.5);
      c.set([col.r, col.g, col.b], i * 3);
    }
    p.set([-1.55, -1.2, -3.7], 0); // Proxima Centauri, 4.24 ly
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }, [seed]);
  return (
    <>
      <points geometry={geo}>
        <pointsMaterial size={portrait ? 4 : 3} sizeAttenuation={false} vertexColors map={glow()} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <sprite scale={[d * 0.05, d * 0.05, d * 0.05]}>
        <spriteMaterial map={glow()} color="#ffe08a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
};

// ---------------------------------------------------------------- the galaxy (thousands of light-years)

const spiral = (seed: number, n: number, radius: number, arms = 2) => {
  const r = rng(seed);
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const bulge = r() < 0.18;
    let x: number, y: number, z: number;
    let col: THREE.Color;
    if (bulge) {
      const rad = radius * 0.12 * Math.pow(r(), 1.6);
      const v = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize().multiplyScalar(rad);
      [x, y, z] = [v.x, v.y, v.z];
      col = new THREE.Color("#ffe3b0");
    } else {
      const rad = radius * (0.08 + 0.92 * Math.pow(r(), 0.85));
      const arm = Math.floor(r() * arms);
      const theta = Math.log(rad / (radius * 0.05)) / 0.26 + (arm * Math.PI * 2) / arms + (r() - 0.5) * 0.7;
      x = Math.cos(theta) * rad + (r() - 0.5) * radius * 0.05;
      z = Math.sin(theta) * rad + (r() - 0.5) * radius * 0.05;
      y = (r() - 0.5) * radius * 0.02;
      col = new THREE.Color(mix("#9cc0ff", "#ffd6f0", r() * 0.6)).lerp(new THREE.Color("#ffe3b0"), 1 - rad / radius);
    }
    col.multiplyScalar(0.5 + r() * 0.5);
    p.set([x, y, z], i * 3);
    c.set([col.r, col.g, col.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
};

const SUN_IN_GALAXY = new THREE.Vector3(26 * Math.cos(1.1), 0, 26 * Math.sin(1.1));

export const GalaxyZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const d = 10 ** L / LY / 1000; // thousands of light-years
  const milky = useMemo(() => spiral(seed + 131, 90000, 50), [seed]);
  const andromeda = useMemo(() => spiral(seed + 141, 30000, 75), [seed]);
  const u = smooth(20.2, 21.4, L);
  const target = SUN_IN_GALAXY.clone().multiplyScalar(1 - u);
  const a = 2.4 + t * 0.006;
  const incl = 0.25 + 0.75 * smooth(20.3, 21.6, L);
  const dir = new THREE.Vector3(Math.cos(a) * Math.cos(incl), Math.sin(incl), Math.sin(a) * Math.cos(incl));
  const pos = target.clone().add(dir.clone().multiplyScalar(d * 1.1));
  setCamera(camera, pos, target, d * 0.001, d * 50 + 1e4, portrait ? 70 : 55);
  scene.background = new THREE.Color("#010106");
  scene.fog = null;
  const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const andro = perp.clone().multiplyScalar(900).add(dir.clone().multiplyScalar(-2350));
  return (
    <>
      <points geometry={milky}>
        <pointsMaterial size={portrait ? 2.6 : 2} sizeAttenuation={false} vertexColors map={glow()} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <group position={andro.toArray()} rotation={[0.9, 0.3, 0.2]}>
        <points geometry={andromeda}>
          <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors map={glow()} transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      </group>
      <Starfield seed={seed + 5} radius={1e6} count={1500} size={1.4} />
    </>
  );
};

// ---------------------------------------------------------------- the web of galaxies (millions of light-years)

const web = (seed: number, n: number, radius: number, nodes: number) => {
  const r = rng(seed);
  const knots = Array.from({ length: nodes }, () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(radius * Math.cbrt(r())));
  knots[0].set(0, 0, 0);
  const links: [number, number][] = [];
  knots.forEach((k, i) => {
    const near = knots.map((q, j) => [q.distanceTo(k), j] as [number, number]).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]).slice(0, 3);
    near.forEach(([, j]) => links.push([i, j]));
  });
  const p = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let v: THREE.Vector3;
    if (r() < 0.35) {
      const k = knots[Math.floor(r() * nodes)];
      v = k.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar((radius / Math.cbrt(nodes)) * 0.18 * r()));
    } else {
      const [a, b] = links[Math.floor(r() * links.length)];
      v = knots[a].clone().lerp(knots[b], r()).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar((radius / Math.cbrt(nodes)) * 0.08));
    }
    p.set([v.x, v.y, v.z], i * 3);
    const col = new THREE.Color(mix("#a9c4ff", "#ffd9b0", r())).multiplyScalar(0.45 + r() * 0.55);
    c.set([col.r, col.g, col.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
};

const edgeMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color("#ff9a4a") } },
    vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
    fragmentShader: "uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(color, f*0.9); }",
  });

export const CosmicZone: React.FC<ZoneProps> = ({ L, t, seed, portrait }) => {
  const { camera, scene } = useThree();
  const d = 10 ** L / LY / 1e6; // millions of light-years
  const near = useMemo(() => web(seed + 151, 40000, 700, 90), [seed]);
  const far = useMemo(() => web(seed + 161, 60000, 46500, 700), [seed]);
  const edge = useMemo(edgeMaterial, []);
  const a = 0.7 + t * 0.006;
  const incl = 0.4;
  const pos = new THREE.Vector3(Math.cos(a) * Math.cos(incl), Math.sin(incl), Math.sin(a) * Math.cos(incl)).multiplyScalar(d * 1.2);
  setCamera(camera, pos, new THREE.Vector3(), d * 0.001, d * 50 + 1e6, portrait ? 70 : 55);
  scene.background = new THREE.Color("#010105");
  scene.fog = null;
  return (
    <>
      <points geometry={near}>
        <pointsMaterial size={portrait ? 2.4 : 1.8} sizeAttenuation={false} vertexColors map={glow()} transparent opacity={1 - smooth(25.2, 26.2, L) * 0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points geometry={far}>
        <pointsMaterial size={portrait ? 2 : 1.5} sizeAttenuation={false} vertexColors map={glow()} transparent opacity={smooth(24.6, 25.8, L)} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <mesh material={edge}>
        <sphereGeometry args={[46500, 96, 64]} />
      </mesh>
      <sprite scale={[d * 0.02, d * 0.02, d * 0.02]}>
        <spriteMaterial map={glow()} color="#ffffff" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </>
  );
};

export const ZONE_VIEWS: Record<ZoneName, React.FC<ZoneProps>> = {
  ground: GroundZone,
  earth: EarthZone,
  solar: SolarZone,
  stars: StarsZone,
  galaxy: GalaxyZone,
  cosmic: CosmicZone,
};
