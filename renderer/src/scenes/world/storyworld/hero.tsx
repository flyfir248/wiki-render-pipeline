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
      emissive: opts.emissive ? col(opts.emissive) : undefined, emissiveIntensity: opts.emissive ? 1.4 : 0,
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

// The detailed model for a build's form, or null when it has none.
export const heroOf = (build: Build) => (["airliner", "plane", "boat", "car", "truck"].includes(build.form ?? "") ? build.form : null);
