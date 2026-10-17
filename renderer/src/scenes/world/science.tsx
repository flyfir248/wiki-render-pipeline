// Science module: structures built from data, not drawn by eye. A molecule's atoms sit where its measured
// bond lengths and angles put them (fyt/assets.py passes them in, from molecules.json or PubChem), DNA
// is a B-form double helix (10.5 base pairs a turn, 3.38 Å rise, 20 Å across), a crystal is its lattice.
// An atom is the textbook picture of shells and is labelled an illustration. Actions: turning so the shape
// can be seen, atoms flying in to join, and DNA's strands separating as it is copied.
import React, { useEffect, useMemo } from "react";
import { Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { outlineMaterial, rng, toonRamp } from "../world3d";
import { aim, moduleScene, shotOf, useWorld, type WorldProps } from "./kit";

type Atom = [string, [number, number, number]];
type Bond = [number, number, number];

// Ball-and-stick colours and sizes (CPK colours; radii for reading, not to scale).
const COLOR: Record<string, string> = { H: "#f2f4f8", C: "#3c3f48", N: "#3b62db", O: "#e03a3a", Na: "#9c5bd6", Cl: "#3fb950", S: "#f0c419", P: "#f08c00", F: "#7ed957", Br: "#a33a2a", I: "#6b2fa0", Fe: "#d9822b", K: "#8f4fd1", Ca: "#7d8a99", Mg: "#5fbf5f", B: "#f2a7a7" };
const RADIUS: Record<string, number> = { H: 0.42, C: 0.66, N: 0.64, O: 0.62, Na: 0.95, Cl: 1.1, S: 0.82, P: 0.8 };
const ANGSTROM = 2; // world units per ångström

const ball = new THREE.IcosahedronGeometry(1, 3);
const stick = new THREE.CylinderGeometry(1, 1, 1, 10);
const ink = outlineMaterial(0.04);
const up = new THREE.Vector3(0, 1, 0);

const Ball: React.FC<{ at: THREE.Vector3; r: number; color: string }> = ({ at, r, color }) => (
  <group position={at} scale={r}>
    <mesh geometry={ball}>
      <meshToonMaterial color={color} gradientMap={toonRamp} />
    </mesh>
    <mesh geometry={ball} material={ink} />
  </group>
);

const Stick: React.FC<{ a: THREE.Vector3; b: THREE.Vector3; r: number; color?: string; offset?: THREE.Vector3 }> = ({ a, b, r, color = "#c9ced8", offset }) => {
  const mid = a.clone().add(b).multiplyScalar(0.5).add(offset ?? new THREE.Vector3());
  const dir = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
  return (
    <mesh geometry={stick} position={mid} quaternion={q} scale={[r, dir.length(), r]}>
      <meshToonMaterial color={color} gradientMap={toonRamp} />
    </mesh>
  );
};

// A bond of order 1, 1.5 (aromatic: a full stick and a thin one), 2 or 3, its sticks side by side.
const BondSticks: React.FC<{ a: THREE.Vector3; b: THREE.Vector3; order: number; grow: number }> = ({ a, b, order, grow }) => {
  if (grow <= 0) return null;
  const dir = b.clone().sub(a).normalize();
  const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
  const end = a.clone().lerp(b, grow);
  const n = order >= 3 ? 3 : order >= 2 ? 2 : order > 1 ? 2 : 1;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const k = n === 1 ? 0 : (i - (n - 1) / 2) * 0.42;
        const thin = order > 1 && order < 2 && i === 1;
        return <Stick key={i} a={a} b={end} r={thin ? 0.07 : n > 1 ? 0.11 : 0.16} offset={side.clone().multiplyScalar(k)} />;
      })}
    </>
  );
};

const Molecule: React.FC<{ atoms: Atom[]; bonds: Bond[]; lattice?: number | null; seed: number; assemble: number }> = ({ atoms, bonds, lattice, seed, assemble }) => {
  const pts = useMemo(() => {
    const c = atoms.reduce((s, [, p]) => s.add(new THREE.Vector3(...p)), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, atoms.length));
    return atoms.map(([, p]) => new THREE.Vector3(...p).sub(c).multiplyScalar(ANGSTROM));
  }, [atoms]);
  // Where each atom flies in from, when the action is atoms joining.
  const from = useMemo(() => {
    const r = rng(seed + 3);
    return pts.map((p) => p.clone().multiplyScalar(2.5).add(new THREE.Vector3((r() - 0.5) * 14, (r() - 0.5) * 10, (r() - 0.5) * 14)));
  }, [pts, seed]);
  const at = pts.map((p, i) => from[i].clone().lerp(p, assemble));
  const grow = Math.max(0, (assemble - 0.8) / 0.2);
  // A crystal's lattice: lines between nearest neighbours.
  const grid = useMemo(() => {
    if (!lattice) return [];
    const d = lattice * ANGSTROM;
    const out: [number, number][] = [];
    pts.forEach((p, i) => pts.forEach((q, j) => j > i && Math.abs(p.distanceTo(q) - d) < 0.05 && out.push([i, j])));
    return out;
  }, [pts, lattice]);
  return (
    <group>
      {at.map((p, i) => (
        <Ball key={i} at={p} r={(lattice ? (atoms[i][0] === "Cl" ? 1.25 : 0.8) : RADIUS[atoms[i][0]] ?? 0.72)} color={COLOR[atoms[i][0]] ?? "#c9a0dc"} />
      ))}
      {bonds.map(([a, b, o], i) => (at[a] && at[b] ? <BondSticks key={i} a={at[a]} b={at[b]} order={o} grow={grow} /> : null))}
      {grid.map(([a, b], i) => (grow > 0 ? <Stick key={`g${i}`} a={at[a]} b={at[b]} r={0.06} color="#8b93a3" /> : null))}
    </group>
  );
};

// B-form DNA: two backbones winding round one axis, base pairs (A-T, G-C) across between them.
const BASES = { A: "#e03a3a", T: "#f0c419", G: "#3fb950", C: "#3b62db" } as const;
const PAIR = { A: "T", T: "A", G: "C", C: "G" } as const;

const Dna: React.FC<{ seed: number; open: number; pairs?: number; frame: number }> = ({ seed, open, pairs = 22, frame }) => {
  const R = 10 * 0.6; // 10 Å radius at 0.6 units per Å
  const rise = 3.38 * 0.6;
  const turn = (Math.PI * 2) / 10.5;
  const groove = (150 / 180) * Math.PI; // the second backbone's offset round the axis (minor groove side)
  const seq = useMemo(() => {
    const r = rng(seed + 5);
    return Array.from({ length: pairs }, () => (["A", "T", "G", "C"] as const)[Math.floor(r() * 4)]);
  }, [seed, pairs]);
  const h0 = (pairs * rise) / 2;
  // How far apart the strands have come at each base pair: the copy opens from the top down.
  const apart = (j: number) => Easing.inOut(Easing.cubic)(Math.max(0, Math.min(1, (open * 1.3 - j / pairs) * 3)));
  const point = (j: number, strand: 0 | 1) => {
    const a = j * turn + (strand ? groove : 0);
    const s = apart(j) * 11 * (strand ? 1 : -1);
    const mid = j * turn + groove / 2;
    return new THREE.Vector3(Math.cos(a) * R + Math.cos(mid) * s, h0 - j * rise, Math.sin(a) * R + Math.sin(mid) * s);
  };
  const tubes = useMemo(
    () =>
      [0, 1].map((strand) => {
        const curve = new THREE.CatmullRomCurve3(seq.map((_, j) => point(j, strand as 0 | 1)));
        return new THREE.TubeGeometry(curve, pairs * 6, 0.55, 8, false);
      }),
    [seq, open], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => tubes.forEach((g) => g.dispose()), [tubes]);
  return (
    <group rotation={[0, frame * 0.004, 0]}>
      {tubes.map((g, i) => (
        <group key={i}>
          <mesh geometry={g}>
            <meshToonMaterial color={i ? "#3b8ee6" : "#f08c00"} gradientMap={toonRamp} />
          </mesh>
          <mesh geometry={g} material={ink} />
        </group>
      ))}
      {seq.map((b, j) => {
        const p = point(j, 0);
        const q = point(j, 1);
        const m = p.clone().lerp(q, 0.5);
        const gap = apart(j) > 0.05 ? 0.25 + apart(j) * 0.5 : 0; // the pair splits down the middle as the strands part
        return (
          <group key={j}>
            <Stick a={p} b={p.clone().lerp(m, 1 - gap)} r={0.32} color={BASES[b]} />
            <Stick a={q} b={q.clone().lerp(m, 1 - gap)} r={0.32} color={BASES[PAIR[b]]} />
          </group>
        );
      })}
    </group>
  );
};

// The textbook atom: a nucleus of protons and neutrons, electrons on tilted rings. Not to scale.
const AtomModel: React.FC<{ seed: number; frame: number }> = ({ seed, frame }) => {
  const nucleons = useMemo(() => {
    const r = rng(seed + 7);
    return Array.from({ length: 14 }, (_, i) => ({ p: new THREE.Vector3((r() - 0.5) * 1.6, (r() - 0.5) * 1.6, (r() - 0.5) * 1.6), proton: i % 2 === 0 }));
  }, [seed]);
  const rings = [0, 1, 2].map((k) => ({ tilt: new THREE.Euler(0.4 + k * 1.05, k * 0.9, 0), r: 6 + k * 0.6 }));
  return (
    <group>
      {nucleons.map((n, i) => <Ball key={i} at={n.p} r={0.62} color={n.proton ? "#e03a3a" : "#9aa3b2"} />)}
      {rings.map((g, k) => {
        const a = frame * (0.05 + k * 0.012) + k * 2;
        return (
          <group key={k} rotation={g.tilt}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[g.r, 0.05, 6, 80]} />
              <meshBasicMaterial color="#8fb8ff" />
            </mesh>
            <Ball at={new THREE.Vector3(Math.cos(a) * g.r, 0, Math.sin(a) * g.r)} r={0.4} color="#4dd6ff" />
          </group>
        );
      })}
    </group>
  );
};

// A made-up molecule when the story names none we have data for: labelled an illustration.
const generic = (seed: number): { atoms: Atom[]; bonds: Bond[] } => {
  const r = rng(seed + 11);
  const atoms: Atom[] = [["C", [0, 0, 0]]];
  const bonds: Bond[] = [];
  for (let i = 1; i < 9; i++) {
    const parent = Math.floor(r() * i);
    const p = atoms[parent][1];
    const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(1.45);
    atoms.push([["C", "O", "N", "H", "H"][Math.floor(r() * 5)], [p[0] + d.x, p[1] + d.y, p[2] + d.z]]);
    bonds.push([parent, i, 1]);
  }
  return { atoms, bonds };
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, u, since, seed, id } = w;
  const { camera } = useThree();
  const variant = scene.variant ?? "molecule";
  const action = scene.action ?? "rotate";
  const params = scene.model?.params ?? {};
  const data = useMemo(() => (params.atoms ? { atoms: params.atoms as Atom[], bonds: (params.bonds ?? []) as Bond[] } : generic(id)), [params.atoms, params.bonds, id]);
  const size = useMemo(() => {
    if (variant === "dna") return 58;
    if (variant === "atom") return 24;
    const r = Math.max(...data.atoms.map(([, p]) => Math.hypot(...p))) * ANGSTROM;
    return Math.max(9, r * 3.2);
  }, [variant, data]);
  const ease = Easing.out(Easing.cubic);
  const assemble = action === "assemble" ? (since < 0 ? 0 : ease(Math.min(1, since / 36))) : 1;
  const open = variant === "dna" && action === "unzip" && since > 0 ? Math.min(1, since / 90) : 0;
  // DNA and molecules are filmed from the front while they turn, so a flat ring or the helix's grooves
  // face the camera; an atom's rings read best from a moving camera.
  // The shot only changes how near and from how high: close in along the strands, pulled back, from below,
  // or swinging round the front.
  const front = variant !== "atom";
  const far = size * (variant === "dna" ? 1.75 : 1.3);
  const shot = scene.shot ?? "orbit";
  const framing: Record<string, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
    orbit: { pos: new THREE.Vector3(Math.sin(u * 0.6 - 0.3) * size * 0.25, size * 0.12, far), look: new THREE.Vector3(0, 0, 0) },
    front: { pos: new THREE.Vector3(Math.sin(u * 0.6 - 0.3) * size * 0.25, size * 0.12, far), look: new THREE.Vector3(0, 0, 0) },
    chase: { pos: new THREE.Vector3(size * 0.18, size * (0.3 - u * 0.5), far * 0.55), look: new THREE.Vector3(0, size * (0.22 - u * 0.5), 0) },
    side: { pos: new THREE.Vector3(Math.sin(u * 1.4 - 0.7) * far * 0.6, 0, Math.cos(u * 1.4 - 0.7) * far * 0.6), look: new THREE.Vector3(0, 0, 0) },
    wide: { pos: new THREE.Vector3(0, size * 0.1, far * (1.45 - u * 0.25)), look: new THREE.Vector3(0, 0, 0) },
    below: { pos: new THREE.Vector3(size * 0.15, -size * 0.65, far * 0.8), look: new THREE.Vector3(0, size * 0.15, 0) },
  };
  const cam = front ? { ...(framing[shot] ?? framing.orbit), fov: 34 } : shotOf(shot, u, size);
  aim(camera, cam.pos, cam.look, cam.fov, portrait, 1.25);
  const spin = variant === "dna" ? 0 : -0.6 + u * 1.2;
  const dust = useMemo(() => {
    const r = rng(seed + 1);
    return Array.from({ length: 60 }, () => new THREE.Vector3((r() - 0.5) * 160, (r() - 0.5) * 100, -40 - r() * 80));
  }, [seed]);
  return (
    <>
      <color attach="background" args={["#0b1b29"]} />
      <fog attach="fog" args={["#0b1b29", size * 3, size * 9]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[20, 30, 25]} intensity={1.6} />
      <directionalLight position={[-25, -10, -20]} intensity={0.5} color="#7fb6ff" />
      {dust.map((p, i) => (
        <mesh key={i} position={[p.x, p.y + Math.sin(frame / 40 + i) * 0.8, p.z]}>
          <sphereGeometry args={[0.25, 6, 4]} />
          <meshBasicMaterial color="#3d6b8f" />
        </mesh>
      ))}
      {/* Tipped toward the camera so a flat molecule (benzene, water) shows its face, not its edge. */}
      <group rotation={variant === "dna" ? [0.12, 0, 0] : [0.35, spin, 0]}>
        {variant === "dna" ? (
          <Dna seed={id} open={open} frame={frame} />
        ) : variant === "atom" ? (
          <AtomModel seed={id} frame={frame} />
        ) : (
          <Molecule atoms={data.atoms} bonds={data.bonds} lattice={params.lattice as number | undefined} seed={id} assemble={assemble} />
        )}
      </group>
    </>
  );
};

export const ScienceScene = moduleScene(World);
