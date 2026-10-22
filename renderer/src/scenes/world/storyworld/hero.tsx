// Detailed vehicle models for the vehicles a story names (fyt/worldgen.py vehicle_form): a lathed
// airliner fuselage with cabin windows, swept wings and turning fans; a ferry's hull and decks; a car's
// body. Each is generated at the build's size in the build's own colours, so a white-and-blue Airbus and a
// red-and-gold ferry come from the same generator. They fill exactly the outline the build's parts give,
// so footprint, spacing and framing stay as the parts say.
import React, { useMemo } from "react";
import * as THREE from "three";
import { rng } from "../../world3d";
import { env, type Look } from "./style";
import type { Build } from "./types";

const col = (c: string) => new THREE.Color(c);
const tone = (c: string, k: number) => "#" + new THREE.Color(c).multiplyScalar(k).getHexString();

const mats = new Map<string, THREE.Material>();
// Painted metal, glass and rubber, lit by the scene's environment so they carry reflections.
export const paint = (c: string, opts: { gloss?: number; metal?: number; vertex?: boolean; emissive?: string } = {}) => {
  const key = `${c}|${opts.gloss ?? 0.5}|${opts.metal ?? 0.1}|${opts.vertex ? 1 : 0}|${opts.emissive ?? ""}`;
  let m = mats.get(key);
  if (!m) {
    const g = opts.gloss ?? 0.5;
    m = new THREE.MeshStandardMaterial({
      color: opts.vertex ? "#ffffff" : col(c), vertexColors: Boolean(opts.vertex), roughness: 0.5 - g * 0.38, metalness: opts.metal ?? 0.1, envMapIntensity: 1.2,
      emissive: col(opts.emissive ?? "#000000"), emissiveIntensity: opts.emissive ? 1.4 : 0,
    });
    mats.set(key, m);
  }
  (m as THREE.MeshStandardMaterial).envMap = env.map;
  (m as THREE.MeshStandardMaterial).envMapIntensity = env.intensity * 1.3;
  return m;
};
const glass = () => paint("#0d1620", { gloss: 1, metal: 0.6 });

// A planform (x along the chord, y along the span) extruded thin and laid flat: wings, tailplanes, fins.
export const panel = (pts: [number, number][], thick: number, vertical = false) => {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.45, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -thick / 2);
  if (!vertical) g.rotateX(Math.PI / 2); // span along +z, thickness along y
  g.computeVertexNormals();
  return g;
};

// --- airliner ---------------------------------------------------------------------------------------

// Fuselage radius and length profile, in fractions of the length: tail cone, barrel, rounded nose.
const BODY: [number, number][] = [
  [-0.475, 0.004], [-0.455, 0.012], [-0.42, 0.024], [-0.37, 0.037], [-0.31, 0.048], [-0.25, 0.054], [-0.2, 0.055],
  [0.33, 0.055], [0.375, 0.053], [0.41, 0.048], [0.435, 0.041], [0.453, 0.032], [0.466, 0.021], [0.473, 0.01], [0.475, 0],
];

const airlinerGeometry = (L: number, top: string, belly: string, line: string) => {
  const pts = BODY.map(([y, r]) => new THREE.Vector2(r * L, y * L));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(-Math.PI / 2); // its length along +x, nose forward
  const pos = g.attributes.position as THREE.BufferAttribute;
  const R = 0.055 * L;
  const colors = new Float32Array(pos.count * 3);
  const cTop = col(top), cBelly = col(belly), cLine = col(line), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    // the tail sweeps up and the nose drops a little, as an airliner's does
    if (x < -0.22 * L) y += ((-0.22 * L - x) / (0.255 * L)) ** 1.6 * 0.036 * L;
    if (x > 0.36 * L) y -= ((x - 0.36 * L) / (0.115 * L)) ** 2 * 0.01 * L;
    pos.setY(i, y);
    const v = pos.getY(i) / R - (x < -0.22 * L ? ((-0.22 * L - x) / (0.255 * L)) ** 1.6 * 0.65 : 0);
    // painted top, grey belly, and a thin cheat line under the windows
    if (v < -0.28) c.copy(cBelly);
    else if (v < -0.2) c.copy(cTop).lerp(cBelly, (-0.2 - v) / 0.08);
    else if (v > 0.06 && v < 0.12 && x > -0.32 * L && x < 0.36 * L) c.copy(cLine);
    else c.copy(cTop);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
};

const Windows: React.FC<{ L: number; y: number; from: number; to: number; z: number; size: [number, number]; color?: string }> = ({ L, y, from, to, z, size, color }) => {
  const n = Math.max(2, Math.floor(((to - from) * L) / (size[0] * 2.1)));
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.SphereGeometry(0.5, 10, 8), []);
  React.useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const x = from * L + ((to - from) * L * (i + 0.5)) / n;
      for (const s of [-1, 1]) {
        // a small rounded pane set into the skin: an ellipsoid half sunk into the fuselage
        m.compose(new THREE.Vector3(x, y, s * z), q, new THREE.Vector3(size[0], size[1], 0.012 * L));
        ref.current?.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m);
      }
    }
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [n, L, y, from, to, z, size]);
  return <instancedMesh ref={ref} args={[geom, color ? paint(color, { emissive: color }) : glass(), n * 2]} />;
};

const Nacelle: React.FC<{ L: number; color: string; lip: string; spin: number; smoke: number; t: number }> = ({ L, color, lip, spin, smoke, t }) => {
  const g = useMemo(() => {
    const p = [[0.0, -0.075], [0.028, -0.07], [0.033, -0.04], [0.034, 0.02], [0.033, 0.05], [0.03, 0.062], [0.026, 0.064]].map(([r, y]) => new THREE.Vector2(r * L, y * L));
    const lg = new THREE.LatheGeometry(p, 32);
    lg.rotateZ(-Math.PI / 2);
    lg.computeVertexNormals();
    return lg;
  }, [L]);
  return (
    <group>
      <mesh geometry={g} material={paint(color, { gloss: 0.7, metal: 0.25 })} castShadow />
      <mesh position={[0.062 * L, 0, 0]} rotation={[0, 0, -Math.PI / 2]} material={paint(lip, { gloss: 0.9, metal: 0.9 })}>
        <torusGeometry args={[0.028 * L, 0.003 * L, 8, 32]} />
      </mesh>
      <group position={[0.055 * L, 0, 0]} rotation={[spin, 0, 0]}>
        <mesh rotation={[0, 0, -Math.PI / 2]} material={paint("#1a1d22", { gloss: 0.4, metal: 0.8 })}>
          <cylinderGeometry args={[0.026 * L, 0.026 * L, 0.004 * L, 24]} />
        </mesh>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} rotation={[(i / 10) * Math.PI * 2, 0, 0]} position={[0.003 * L, 0, 0]} material={paint("#3a3f47", { gloss: 0.6, metal: 0.9 })}>
            <boxGeometry args={[0.002 * L, 0.05 * L, 0.006 * L]} />
          </mesh>
        ))}
        <mesh position={[0.006 * L, 0, 0]} rotation={[0, 0, -Math.PI / 2]} material={paint("#d8dadf", { gloss: 0.9, metal: 0.7 })}>
          <coneGeometry args={[0.009 * L, 0.016 * L, 16]} />
        </mesh>
      </group>
      {smoke > 0 ? <Smoke L={L} t={t} k={smoke} /> : null}
    </group>
  );
};

// Smoke streaming back from a damaged engine: puffs born at the exhaust, growing and thinning.
export const Smoke: React.FC<{ L: number; t: number; k: number; dark?: boolean }> = ({ L, t, k, dark = true }) => {
  const puffs = 16;
  const mats = useMemo(() => Array.from({ length: puffs }, () => new THREE.MeshStandardMaterial({ color: dark ? "#2e2e30" : "#d8d8d8", roughness: 1, transparent: true, depthWrite: false })), [dark]);
  return (
    <group position={[-0.07 * L, 0, 0]}>
      {Array.from({ length: puffs }, (_, i) => {
        const age = ((t * 1.6 + i / puffs) % 1);
        const r = (0.012 + age * 0.05) * L;
        const m = mats[i];
        m.opacity = (1 - age) * 0.55 * k;
        return <mesh key={i} position={[-age * 0.5 * L, age * 0.03 * L + Math.sin(i * 3.1) * age * 0.02 * L, Math.cos(i * 2.3) * age * 0.02 * L]} scale={r} material={m}><icosahedronGeometry args={[1, 1]} /></mesh>;
      })}
      {k > 0.5 ? (
        <mesh scale={0.02 * L * (1 + Math.sin(t * 30) * 0.2)} material={paint("#ff8a2a", { emissive: "#ff7a1a" })}>
          <icosahedronGeometry args={[1, 1]} />
        </mesh>
      ) : null}
    </group>
  );
};

// A light aircraft: a short fat fuselage, a high straight wing, a propeller on the nose.
export const LightPlane: React.FC<{ build: Build; t: number; spin: number; damaged: number }> = ({ build, t, spin, damaged }) => {
  const L = Math.max(0.5, build.size);
  const y0 = 0.12 * L;
  const R = 0.065 * L;
  const body = useMemo(() => {
    const prof: [number, number][] = [[-0.5, 0.01], [-0.42, 0.025], [-0.3, 0.045], [-0.15, 0.062], [0.05, 0.068], [0.25, 0.066], [0.36, 0.058], [0.43, 0.045], [0.46, 0.03], [0.47, 0]];
    const g = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r * L, y * L)), 36);
    g.rotateZ(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, [L]);
  const wing = useMemo(() => panel([[0.12, -0.52], [0.12, 0.52], [-0.05, 0.52], [-0.05, -0.52]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.014 * L), [L]);
  const tail = useMemo(() => panel([[-0.36, -0.16], [-0.36, 0.16], [-0.46, 0.16], [-0.46, -0.16]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.008 * L), [L]);
  const fin = useMemo(() => panel([[-0.33, 0], [-0.48, 0], [-0.49, 0.17], [-0.42, 0.17]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.008 * L, true), [L]);
  return (
    <group>
      <mesh geometry={body} position={[0, y0, 0]} material={paint(build.primary, { gloss: 0.8 })} castShadow receiveShadow />
      <mesh position={[0, y0 + R * 0.1, 0]} material={paint(build.accent, { gloss: 0.8 })} scale={[1, 0.18, 1.02]}>
        <cylinderGeometry args={[R * 1.01, R * 1.01, 0.8 * L, 24, 1, true]} />
      </mesh>
      <mesh position={[0.18 * L, y0 + R * 0.55, 0]} rotation={[0, 0, -0.35]} material={glass()}>
        <boxGeometry args={[0.12 * L, 0.05 * L, R * 1.7]} />
      </mesh>
      <mesh geometry={wing} position={[0.02 * L, y0 + R * 1.0, 0]} material={paint(build.primary, { gloss: 0.7 })} castShadow />
      {[-1, 1].map((s2) => (
        <mesh key={s2} position={[0.06 * L, y0 + R * 0.2, s2 * 0.13 * L]} rotation={[s2 * 0.75, 0, 0]} material={paint(build.secondary, { gloss: 0.6, metal: 0.4 })}>
          <cylinderGeometry args={[0.006 * L, 0.006 * L, 0.2 * L, 8]} />
        </mesh>
      ))}
      <mesh geometry={tail} position={[0, y0 + R * 0.3, 0]} material={paint(build.primary, { gloss: 0.7 })} castShadow />
      <mesh geometry={fin} position={[0, y0 + R * 0.4, 0]} material={paint(build.accent, { gloss: 0.8 })} castShadow />
      <group position={[0.475 * L, y0, 0]} rotation={[spin, 0, 0]}>
        <mesh rotation={[0, 0, -Math.PI / 2]} material={paint("#d8dadf", { gloss: 0.9, metal: 0.7 })}><coneGeometry args={[0.025 * L, 0.05 * L, 16]} /></mesh>
        {[0, 1].map((i) => (
          <mesh key={i} rotation={[(i * Math.PI) / 2, 0, 0]} material={paint("#202226", { gloss: 0.4, metal: 0.5 })}>
            <boxGeometry args={[0.006 * L, 0.3 * L, 0.02 * L]} />
          </mesh>
        ))}
      </group>
      {damaged > 0 ? <group position={[0.4 * L, y0, 0]}><Smoke L={L * 1.6} t={t} k={damaged} /></group> : null}
    </group>
  );
};

export const Airliner: React.FC<{ build: Build; t: number; spin: number; damaged: number; gearDown?: boolean }> = ({ build, t, spin, damaged }) => {
  const L = Math.max(0.5, build.size);
  const y0 = 0.13 * L;
  const R = 0.055 * L;
  const wing = build.secondary === build.primary ? tone(build.primary, 0.85) : build.secondary;
  const body = useMemo(() => airlinerGeometry(L, build.primary, build.secondary, build.accent), [L, build.primary, build.secondary, build.accent]);
  const wingR = useMemo(() => panel([[0.11, 0], [-0.105, 0.43], [-0.165, 0.43], [-0.13, 0]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.009 * L), [L]);
  const wingL = useMemo(() => panel([[0.11, 0], [-0.13, 0], [-0.165, -0.43], [-0.105, -0.43]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.009 * L), [L]);
  const tailR = useMemo(() => panel([[-0.36, 0], [-0.445, 0.165], [-0.475, 0.165], [-0.46, 0]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.006 * L), [L]);
  const tailL = useMemo(() => panel([[-0.36, 0], [-0.46, 0], [-0.475, -0.165], [-0.445, -0.165]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.006 * L), [L]);
  const fin = useMemo(() => panel([[-0.3, 0], [-0.455, 0], [-0.478, 0.19], [-0.43, 0.19]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.008 * L, true), [L]);
  const winglet = useMemo(() => panel([[0, 0], [-0.04, 0], [-0.05, 0.045], [-0.03, 0.045]].map(([x, y]) => [x * L, y * L] as [number, number]), 0.004 * L, true), [L]);
  const wingY = y0 - R * 0.55;
  const dihedral = 0.09;
  return (
    <group>
      <mesh geometry={body} position={[0, y0, 0]} material={paint("#ffffff", { gloss: 0.8, metal: 0.15, vertex: true })} castShadow receiveShadow />
      {/* cabin windows, doors and the cockpit glazing */}
      <group position={[0, y0, 0]}>
        <Windows L={L} y={R * 0.3} from={-0.29} to={0.34} z={R * 0.95} size={[0.0068 * L, 0.0095 * L]} />
        {/* the windscreen: a dark band wrapped over the nose */}
        <mesh position={[0.43 * L, R * 0.42, 0]} rotation={[0, 0, -0.45]} scale={[0.032 * L, 0.014 * L, 0.078 * L]} material={glass()}>
          <sphereGeometry args={[0.5, 24, 12]} />
        </mesh>
      </group>
      {/* low swept wings with a little dihedral, winglets, engines on pylons */}
      <group position={[0, wingY, R * 0.6]} rotation={[-dihedral, 0, 0]}>
        <mesh geometry={wingR} material={paint(wing, { gloss: 0.6, metal: 0.3 })} castShadow receiveShadow />
        <mesh geometry={winglet} position={[-0.105 * L, 0, 0.43 * L]} material={paint(build.accent, { gloss: 0.8 })} castShadow />
      </group>
      <group position={[0, wingY, -R * 0.6]} rotation={[dihedral, 0, 0]}>
        <mesh geometry={wingL} material={paint(wing, { gloss: 0.6, metal: 0.3 })} castShadow receiveShadow />
        <mesh geometry={winglet} position={[-0.105 * L, 0, -0.43 * L]} material={paint(build.accent, { gloss: 0.8 })} castShadow />
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[0.03 * L, wingY - 0.045 * L, s * 0.18 * L]}>
          <mesh position={[0.0, 0.026 * L, 0]} material={paint(wing, { gloss: 0.6, metal: 0.3 })}>
            <boxGeometry args={[0.07 * L, 0.03 * L, 0.006 * L]} />
          </mesh>
          <Nacelle L={L} color={build.primary} lip="#c9ced6" spin={spin} smoke={damaged} t={t + s * 0.31} />
        </group>
      ))}
      {/* tail: horizontal stabilisers and the fin in the livery colour */}
      <group position={[0, y0 + 0.02 * L, 0]}>
        <mesh geometry={tailR} position={[0, 0, R * 0.25]} material={paint(wing, { gloss: 0.6, metal: 0.3 })} castShadow />
        <mesh geometry={tailL} position={[0, 0, -R * 0.25]} material={paint(wing, { gloss: 0.6, metal: 0.3 })} castShadow />
      </group>
      <mesh geometry={fin} position={[0, y0 + 0.028 * L, 0]} material={paint(build.accent, { gloss: 0.8, metal: 0.1 })} castShadow />
      {/* navigation and strobe lights */}
      <mesh position={[-0.11 * L, wingY + 0.01 * L, 0.47 * L]} scale={0.004 * L} material={paint("#3dff7a", { emissive: "#3dff7a" })}><sphereGeometry args={[1, 8, 6]} /></mesh>
      <mesh position={[-0.11 * L, wingY + 0.01 * L, -0.47 * L]} scale={0.004 * L} material={paint("#ff3b3b", { emissive: "#ff3b3b" })}><sphereGeometry args={[1, 8, 6]} /></mesh>
      {Math.sin(t * 6) > 0.85 ? <mesh position={[-0.02 * L, y0 + R, 0]} scale={0.005 * L} material={paint("#ffffff", { emissive: "#ffffff" })}><sphereGeometry args={[1, 8, 6]} /></mesh> : null}
    </group>
  );
};

// --- ferry / boat -----------------------------------------------------------------------------------

export const Boat: React.FC<{ build: Build; t: number; moving: boolean; wet: boolean }> = ({ build, t, moving, wet }) => {
  const L = Math.max(0.5, build.size);
  const hull = useMemo(() => {
    const s = new THREE.Shape();
    const W = 0.15;
    s.moveTo(-0.5 * L, -W * L);
    s.lineTo(0.22 * L, -W * L);
    s.quadraticCurveTo(0.46 * L, -W * 0.7 * L, 0.5 * L, 0);
    s.quadraticCurveTo(0.46 * L, W * 0.7 * L, 0.22 * L, W * L);
    s.lineTo(-0.5 * L, W * L);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.11 * L, bevelEnabled: true, bevelThickness: 0.01 * L, bevelSize: 0.01 * L, bevelSegments: 3, curveSegments: 12 });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return { g, s };
  }, [L]);
  const deck = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(hull.s, { depth: 0.006 * L, bevelEnabled: false, curveSegments: 12 });
    g.rotateX(-Math.PI / 2);
    g.scale(0.97, 1, 0.94);
    return g;
  }, [hull, L]);
  const tiers = [
    { x: -0.06, w: 0.62, d: 0.25, h: 0.08 },
    { x: -0.02, w: 0.42, d: 0.22, h: 0.07 },
    { x: 0.06, w: 0.16, d: 0.16, h: 0.06 },
  ];
  let y = 0.11 * L;
  return (
    <group>
      <mesh geometry={hull.g} material={paint(build.primary, { gloss: 0.7 })} castShadow receiveShadow />
      <mesh position={[0, 0.02 * L, 0]} material={paint(build.secondary, { gloss: 0.7 })} scale={[1.002, 1, 1.01]}>
        <boxGeometry args={[0.72 * L, 0.025 * L, 0.305 * L]} />
      </mesh>
      <mesh geometry={deck} position={[0, 0.115 * L, 0]} material={paint("#6b6f75", { gloss: 0.2 })} receiveShadow />
      {tiers.map((tr, i) => {
        const at = y;
        y += tr.h * L;
        return (
          <group key={i} position={[tr.x * L, at + (tr.h * L) / 2, 0]}>
            <mesh material={paint(i === 2 ? "#f4f4f2" : build.primary, { gloss: 0.6 })} castShadow receiveShadow>
              <boxGeometry args={[tr.w * L, tr.h * L, tr.d * L]} />
            </mesh>
            {/* a band of windows round each deck */}
            <mesh material={glass()}>
              <boxGeometry args={[tr.w * L * 0.96, tr.h * L * 0.42, tr.d * L * 1.01]} />
            </mesh>
            <mesh position={[0, (tr.h * L) / 2, 0]} material={paint(build.accent, { gloss: 0.6 })}>
              <boxGeometry args={[tr.w * L * 1.04, 0.008 * L, tr.d * L * 1.06]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0.06 * L, y + 0.05 * L, 0]} material={paint("#dfe2e6", { gloss: 0.7, metal: 0.6 })} castShadow>
        <cylinderGeometry args={[0.004 * L, 0.006 * L, 0.1 * L, 8]} />
      </mesh>
      <mesh position={[-0.2 * L, y - 0.02 * L, 0]} material={paint(build.accent, { gloss: 0.6 })} castShadow>
        <cylinderGeometry args={[0.025 * L, 0.03 * L, 0.09 * L, 16]} />
      </mesh>
      {moving || wet ? <Wake L={L} t={t} /> : null}
    </group>
  );
};

// White water at the bow and a fan of foam behind the stern.
const Wake: React.FC<{ L: number; t: number }> = ({ L, t }) => {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f4f8fa", roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false }), []);
  const bits = useMemo(() => {
    const r = rng(11);
    return Array.from({ length: 26 }, () => ({ a: r(), z: r() - 0.5, s: 0.5 + r() }));
  }, []);
  return (
    <group position={[0, 0.01 * L, 0]}>
      {bits.map((b, i) => {
        const age = (b.a + t * 0.5) % 1;
        const x = -0.5 * L - age * 0.6 * L;
        const z = b.z * (0.25 + age * 0.5) * L;
        return <mesh key={i} position={[x, 0, z]} rotation={[-Math.PI / 2, 0, 0]} scale={[(0.05 + age * 0.06) * L * b.s, (0.03 + age * 0.03) * L * b.s, 1]} material={mat}><circleGeometry args={[1, 10]} /></mesh>;
      })}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.42 * L, 0, s * 0.08 * L]} rotation={[-Math.PI / 2, 0, s * 0.5]} scale={[0.12 * L, 0.025 * L, 1]} material={mat}><circleGeometry args={[1, 10]} /></mesh>
      ))}
    </group>
  );
};

// --- cars and trucks --------------------------------------------------------------------------------

const extrudeSide = (pts: [number, number][], depth: number, bevel: number) => {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
};

export const Car: React.FC<{ build: Build; spin: number; truck: boolean; look: Look }> = ({ build, spin, truck }) => {
  const L = Math.max(0.5, build.size);
  const W = 0.36 * L;
  const body = useMemo(() => {
    const p: [number, number][] = truck
      ? [[-0.5, 0.06], [0.5, 0.06], [0.5, 0.2], [0.47, 0.25], [0.3, 0.27], [0.27, 0.42], [-0.5, 0.42]]
      : [[-0.5, 0.06], [0.5, 0.06], [0.5, 0.15], [0.44, 0.19], [0.2, 0.21], [0.08, 0.32], [-0.22, 0.33], [-0.38, 0.23], [-0.5, 0.21]];
    return extrudeSide(p.map(([x, y]) => [x * L, y * L]), W - 0.04 * L, 0.02 * L);
  }, [L, W, truck]);
  const win = useMemo(() => {
    const p: [number, number][] = truck
      ? [[0.29, 0.27], [0.27, 0.4], [0.12, 0.4], [0.12, 0.27]]
      : [[0.19, 0.215], [0.085, 0.322], [-0.215, 0.332], [-0.355, 0.23]];
    return extrudeSide(p.map(([x, y]) => [x * L, y * L]), W - 0.01 * L, 0.006 * L);
  }, [L, W, truck]);
  const wheels = truck ? [-0.32, 0.3] : [-0.31, 0.31];
  return (
    <group>
      <mesh geometry={body} material={paint(build.primary, { gloss: 0.9, metal: 0.35 })} castShadow receiveShadow />
      <mesh geometry={win} material={glass()} />
      <mesh position={[0, 0.09 * L, 0]} material={paint(build.secondary, { gloss: 0.4 })}>
        <boxGeometry args={[1.02 * L, 0.04 * L, W * 1.005]} />
      </mesh>
      {[-1, 1].map((s) => (
        <React.Fragment key={s}>
          <mesh position={[0.505 * L, 0.15 * L, s * W * 0.33]} material={paint("#fff3c4", { emissive: "#fff1c0" })}><boxGeometry args={[0.01 * L, 0.035 * L, 0.07 * L]} /></mesh>
          <mesh position={[-0.505 * L, 0.17 * L, s * W * 0.36]} material={paint("#ff2a2a", { emissive: "#c8141a" })}><boxGeometry args={[0.01 * L, 0.03 * L, 0.06 * L]} /></mesh>
        </React.Fragment>
      ))}
      {wheels.flatMap((x) => [-1, 1].map((s) => (
        <group key={`${x}${s}`} position={[x * L, 0.075 * L, s * (W / 2 - 0.005 * L)]} rotation={[Math.PI / 2, 0, 0]}>
          <group rotation={[0, spin, 0]}>
            <mesh material={paint("#141414", { gloss: 0.1 })} castShadow><cylinderGeometry args={[0.075 * L, 0.075 * L, 0.05 * L, 24]} /></mesh>
            <mesh position={[0, s * 0.026 * L, 0]} material={paint("#c4c8ce", { gloss: 0.9, metal: 0.9 })}><cylinderGeometry args={[0.045 * L, 0.045 * L, 0.004 * L, 12]} /></mesh>
          </group>
        </group>
      )))}
    </group>
  );
};

// --- ocean liners -----------------------------------------------------------------------------------

// A deck plan (x along the length, bow at +x, z across): a fine bow, parallel sides and a rounded stern.
const linerPlan = (L: number, B: number, inset = 0) => {
  const s = new THREE.Shape();
  const h = B / 2 - inset;
  const bow = 0.5 * L - inset * 2;
  s.moveTo(-0.47 * L + inset, -h * 0.82);
  s.lineTo(0.18 * L, -h);
  s.bezierCurveTo(0.36 * L, -h, 0.47 * L, -h * 0.45, bow, 0);
  s.bezierCurveTo(0.47 * L, h * 0.45, 0.36 * L, h, 0.18 * L, h);
  s.lineTo(-0.47 * L + inset, h * 0.82);
  s.bezierCurveTo(-0.5 * L + inset, h * 0.6, -0.5 * L + inset, -h * 0.6, -0.47 * L + inset, -h * 0.82);
  return s;
};

// A plan extruded from y0 to y1, with the deck line lifted towards bow and stern (the sheer).
const linerSlab = (shape: THREE.Shape, y0: number, y1: number, L: number, sheer: number) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 18, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (0.5 * L);
    const lift = sheer * (x > 0 ? x * x * 1.3 : x * x * 0.6);
    pos.setY(i, pos.getY(i) + lift * ((pos.getY(i) - y0) / Math.max(1e-6, y1 - y0)));
  }
  g.computeVertexNormals();
  return g;
};

// Rows of small lit openings along both sides: portholes on the hull, windows on the decks.
const Openings: React.FC<{ rows: { y: number; x0: number; x1: number; z: number; n: number; s: number }[]; lit: number }> = ({ rows, lit }) => {
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd998").multiplyScalar(0.6 + 1.8 * lit), toneMapped: true }), [lit]);
  const mesh = useMemo(() => {
    const total = rows.reduce((a, r) => a + r.n * 2, 0);
    const m = new THREE.InstancedMesh(geo, mat, total);
    const o = new THREE.Object3D();
    const r0 = rng(23);
    let i = 0;
    for (const r of rows) {
      for (let k = 0; k < r.n; k++) {
        const x = r.x0 + ((r.x1 - r.x0) * (k + 0.5)) / r.n;
        for (const side of [-1, 1]) {
          o.position.set(x, r.y, side * r.z);
          o.rotation.set(0, side > 0 ? 0 : Math.PI, 0);
          const dark = r0() < 0.18 ? 0.001 : 1; // some cabins are dark
          o.scale.set(r.s * dark, r.s * dark, 1);
          o.updateMatrix();
          m.setMatrixAt(i++, o.matrix);
        }
      }
    }
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [rows, geo, mat]);
  return <primitive object={mesh} />;
};

// An ocean liner of the steam age: a black hull over red boot-topping, white decks, raked buff funnels
// with black tops, two masts with the wire between them, lifeboats along the boat deck and lit
// portholes. Bow along +x; the hull draws down below the waterline (y = 0).
export const Liner: React.FC<{ build: Build; t: number; moving: boolean; wet: boolean; night: number; funnels?: number }> = ({ build, t, moving, wet, night, funnels = 4 }) => {
  const L = Math.max(0.5, build.size);
  const B = 0.11 * L;
  const H = 0.075 * L; // waterline to the top of the hull
  const sheer = 0.012 * L;
  const g = useMemo(() => {
    const hull = linerPlan(L, B);
    return {
      boot: linerSlab(linerPlan(L, B * 0.97), -0.035 * L, 0.004 * L, L, 0),
      hull: linerSlab(hull, 0.004 * L, H, L, sheer),
      band: linerSlab(linerPlan(L, B * 1.004), H - 0.006 * L, H - 0.0035 * L, L, sheer),
      deck: linerSlab(linerPlan(L, B * 0.985, 0.002 * L), H, H + 0.002 * L, L, sheer),
    };
  }, [L, B, H, sheer]);
  const deckY = H + 0.002 * L;
  const tiers = [
    { x0: -0.33, x1: 0.26, w: 0.86, h: 0.026 },
    { x0: -0.27, x1: 0.21, w: 0.74, h: 0.021 },
    { x0: 0.14, x1: 0.21, w: 0.5, h: 0.016 }, // the bridge house
  ];
  let y = deckY;
  const houses = tiers.slice(0, 2).map((tr) => {
    const at = y;
    y += tr.h * L;
    return { ...tr, y: at };
  });
  const top = y;
  const bridge = { ...tiers[2], y: top };
  const rows = useMemo(() => [
    { y: H * 0.45, x0: -0.42 * L, x1: 0.36 * L, z: B * 0.5 + 0.0006 * L, n: 70, s: 0.0035 * L },
    { y: H * 0.7, x0: -0.4 * L, x1: 0.33 * L, z: B * 0.5 + 0.0006 * L, n: 64, s: 0.0035 * L },
    { y: H * 0.9, x0: -0.36 * L, x1: 0.3 * L, z: B * 0.5 + 0.0006 * L, n: 52, s: 0.004 * L },
    { y: houses[0].y + houses[0].h * L * 0.55, x0: -0.32 * L, x1: 0.25 * L, z: (B * houses[0].w) / 2 + 0.0006 * L, n: 46, s: 0.006 * L },
    { y: houses[1].y + houses[1].h * L * 0.55, x0: -0.26 * L, x1: 0.2 * L, z: (B * houses[1].w) / 2 + 0.0006 * L, n: 34, s: 0.006 * L },
  ], [L, B, H, houses]);
  const n = Math.max(1, Math.min(5, funnels));
  const fx = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : 0.17 - (0.33 * i) / (n - 1)) * L);
  const fr = 0.017 * L, fh = 0.085 * L, rake = 0.13;
  const mastTop = top + 0.13 * L;
  const masts = [0.37 * L, -0.4 * L];
  const wire = useMemo(() => {
    const a = new THREE.Vector3(masts[0], mastTop, 0), b = new THREE.Vector3(masts[1], mastTop - 0.01 * L, 0);
    return { mid: a.clone().add(b).multiplyScalar(0.5), len: a.distanceTo(b), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, mastTop]);
  const hullC = "#16171b", boot = "#7a1f1a", white = "#efede6", buff = "#d39a45";
  return (
    <group>
      <mesh geometry={g.boot} material={paint(boot, { gloss: 0.3 })} />
      <mesh geometry={g.hull} material={paint(hullC, { gloss: 0.75, metal: 0.15 })} castShadow receiveShadow />
      <mesh geometry={g.band} material={paint("#d8c27a", { gloss: 0.6 })} />
      <mesh geometry={g.deck} material={paint("#9c8a6a", { gloss: 0.15 })} receiveShadow />
      {houses.map((h, i) => (
        <mesh key={i} position={[((h.x0 + h.x1) / 2) * L, h.y + (h.h * L) / 2, 0]} material={paint(white, { gloss: 0.55 })} castShadow receiveShadow>
          <boxGeometry args={[(h.x1 - h.x0) * L, h.h * L, B * h.w]} />
        </mesh>
      ))}
      <mesh position={[((bridge.x0 + bridge.x1) / 2) * L, bridge.y + (bridge.h * L) / 2, 0]} material={paint(white, { gloss: 0.55 })} castShadow>
        <boxGeometry args={[(bridge.x1 - bridge.x0) * L, bridge.h * L, B * 0.9]} />
      </mesh>
      <mesh position={[(bridge.x1 - 0.004) * L, bridge.y + bridge.h * L * 0.6, 0]} material={paint("#ffe2a8", { emissive: night > 0.5 ? "#ffcf80" : undefined })}>
        <boxGeometry args={[0.002 * L, bridge.h * L * 0.35, B * 0.8]} />
      </mesh>
      <Openings rows={rows} lit={night} />
      {fx.map((x, i) => (
        <group key={i} position={[x, top, 0]} rotation={[0, 0, rake]}>
          <mesh position={[0, fh * 0.42, 0]} scale={[1, 1, 0.8]} material={paint(buff, { gloss: 0.5 })} castShadow>
            <cylinderGeometry args={[fr, fr * 1.04, fh * 0.84, 28]} />
          </mesh>
          <mesh position={[0, fh * 0.92, 0]} scale={[1, 1, 0.8]} material={paint("#121214", { gloss: 0.3 })} castShadow>
            <cylinderGeometry args={[fr * 1.01, fr, fh * 0.16, 28]} />
          </mesh>
          <mesh position={[0, fh * 0.6, 0]} scale={[1, 1, 0.8]} material={paint("#121214", { gloss: 0.3 })}>
            <cylinderGeometry args={[fr * 1.02, fr * 1.02, fh * 0.015, 28]} />
          </mesh>
        </group>
      ))}
      {moving ? fx.slice(0, Math.max(1, n - 1)).map((x, i) => <FunnelSmoke key={i} at={[x - Math.sin(rake) * fh, top + fh, 0]} r={fr} t={t + i * 1.7} night={night} />) : null}
      {masts.map((x, i) => (
        <mesh key={i} position={[x, (deckY + mastTop) / 2, 0]} rotation={[0, 0, 0.08]} material={paint("#3a2c20", { gloss: 0.3 })} castShadow>
          <cylinderGeometry args={[0.0012 * L, 0.0028 * L, mastTop - deckY, 8]} />
        </mesh>
      ))}
      <mesh position={wire.mid.toArray()} rotation={[0, 0, wire.ang]} material={paint("#222222")}>
        <boxGeometry args={[wire.len, 0.0007 * L, 0.0007 * L]} />
      </mesh>
      {[-1, 1].map((side) =>
        Array.from({ length: 8 }, (_, i) => {
          const x = (-0.24 + (i < 4 ? i * 0.035 : 0.09 + i * 0.035)) * L;
          return (
            <mesh key={`${side}${i}`} position={[x, houses[1].y + houses[1].h * L + 0.006 * L, side * B * 0.42]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.75]} material={paint(white, { gloss: 0.4 })}>
              <capsuleGeometry args={[0.0045 * L, 0.018 * L, 4, 8]} />
            </mesh>
          );
        }),
      )}
      {night > 0.5 ? <pointLight position={[0.05 * L, top + 0.02 * L, B * 1.2]} intensity={L * 0.4} distance={L * 0.6} color="#ffcf80" /> : null}
      {/* the foredeck's lamps, where anyone aboard stands (index.tsx LINER_FOREDECK) */}
      {night > 0.5 ? <pointLight position={[0.33 * L, deckY + 0.12 * L, 0]} intensity={L * 0.12} distance={L * 0.35} color="#ffd8a0" /> : null}
      {moving || wet ? <Wake L={L * 0.45} t={t} /> : null}
    </group>
  );
};

// Coal smoke streaming back from a funnel.
const FunnelSmoke: React.FC<{ at: [number, number, number]; r: number; t: number; night: number }> = ({ at, r, t, night }) => {
  const mats = useMemo(() => Array.from({ length: 4 }, (_, i) => new THREE.MeshStandardMaterial({ color: night > 0.5 ? "#3a3d44" : "#6a665e", roughness: 1, transparent: true, opacity: 0.32 - i * 0.07, depthWrite: false })), [night]);
  return (
    <group position={at}>
      {Array.from({ length: 16 }, (_, i) => {
        const age = (i / 16 + t * 0.12) % 1;
        const s = r * (0.7 + age * 2.2);
        return <mesh key={i} position={[-age * r * 22, age * r * 4.5 + Math.sin(i * 1.3) * r * 0.3, Math.sin(i * 2.1) * age * r * 1.5]} scale={s} material={mats[Math.min(3, Math.floor(age * 4))]}>
          <icosahedronGeometry args={[1, 2]} />
        </mesh>;
      })}
    </group>
  );
};

// --- icebergs ---------------------------------------------------------------------------------------

// A jagged mass of ice filling a w x h x d box: an icosphere pushed out by layered noise into a tall
// peak and broken shoulders, flat-shaded so it reads as fractured faces, sitting on the waterline.
export const Iceberg: React.FC<{ w: number; h: number; d: number; seed: number; ledge: number }> = ({ w, h, d, seed, ledge }) => {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 5);
    const r = rng(seed);
    const peaks = Array.from({ length: 5 }, () => ({ x: r() * 1.4 - 0.7, z: r() * 1.2 - 0.6, k: 0.45 + r() * 0.9 }));
    peaks[0] = { x: 0.15, z: 0, k: 1.5 };
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 5.1 + seed) * Math.sin(v.y * 4.3 + 1.3) * Math.sin(v.z * 6.7 + 2.1) * 0.22
        + Math.sin(v.x * 11.3 + 2) * Math.sin(v.z * 9.1 + seed) * 0.08;
      let lift = 0;
      for (const p of peaks) lift = Math.max(lift, p.k * Math.exp(-((v.x - p.x) ** 2 + (v.z - p.z) ** 2) * 3.2));
      const y = v.y > 0 ? v.y * (0.35 + lift) : v.y * 0.6;
      v.set(v.x * (1 + n), y + n * 0.3, v.z * (1 + n * 0.8));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const sx = w / (bb.max.x - bb.min.x), sy = h / Math.max(1e-3, bb.max.y), sz = d / (bb.max.z - bb.min.z);
    g.scale(sx, sy, sz);
    g.translate(0, -h * 0.1, 0); // a tenth of what shows rides below the waterline
    g.computeVertexNormals();
    return g;
  }, [w, h, d, seed]);
  // the floe at its foot, running out in front (+z): flat on top, broken at the edge
  const floe = useMemo(() => {
    const s = new THREE.Shape();
    const r = rng(seed + 5);
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.75 + r() * 0.35;
      const x = Math.cos(a) * w * 0.55 * k, z = Math.sin(a) * d * 0.42 * k + d * 0.38;
      if (i === 0) s.moveTo(x, z);
      else s.lineTo(x, z);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: ledge + h * 0.05, bevelEnabled: true, bevelThickness: h * 0.01, bevelSize: h * 0.02, bevelSegments: 1 });
    g.rotateX(Math.PI / 2);
    g.translate(0, ledge, 0);
    g.computeVertexNormals();
    return g;
  }, [w, d, h, ledge, seed]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#eef6fb", roughness: 0.38, metalness: 0, flatShading: true, emissive: new THREE.Color("#4d7fa8"), emissiveIntensity: 0.14 }), []);
  mat.envMap = env.map;
  mat.envMapIntensity = env.intensity * 1.4;
  return (
    <group>
      <mesh geometry={geo} material={mat} castShadow receiveShadow />
      <mesh geometry={floe} material={mat} receiveShadow />
    </group>
  );
};

// White water thrown up where a hull strikes something: a burst of spray at the bow and foam spreading
// on the water, for `k` seconds after the impact.
export const Spray: React.FC<{ at: [number, number, number]; size: number; k: number }> = ({ at, size, k }) => {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f2f7fa", roughness: 0.5, transparent: true, depthWrite: false }), []);
  const drops = useMemo(() => {
    const r = rng(41);
    return Array.from({ length: 140 }, () => ({ a: r() * Math.PI * 2, up: 0.5 + r() * 1.2, out: 0.2 + r() * 1.0, s: 0.3 + r() * 0.9, d: r() * 0.35 }));
  }, []);
  if (k <= 0 || k > 3.5) return null;
  mat.opacity = Math.max(0, 0.9 * (1 - k / 3.5));
  return (
    <group position={at}>
      {drops.map((p, i) => {
        const tt = Math.max(0, k - p.d);
        const y = size * (p.up * tt * 1.6 - 1.6 * tt * tt);
        if (y < -size * 0.05) return null;
        const r = size * p.out * tt * 0.9;
        return <mesh key={i} position={[Math.cos(p.a) * r * 0.6, y, Math.sin(p.a) * r]} scale={size * 0.018 * p.s * (1 + tt * 1.5)} material={mat}><icosahedronGeometry args={[1, 1]} /></mesh>;
      })}
      <mesh position={[0, size * 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={size * (0.3 + k * 0.5)} material={mat}><ringGeometry args={[0.6, 1, 32]} /></mesh>
    </group>
  );
};

// The detailed model for a build's form, or null when it has none.
export const heroOf = (build: Build) => (["airliner", "plane", "boat", "liner", "car", "truck", "iceberg"].includes(build.form ?? "") ? build.form : null);
