// Set pieces from the packs (fyt/sets.py: trees, rocks, plants, houses, towers, road and rail tiles,
// machines), each drawn as one instanced mesh per part however many times it stands in the set, so a
// forest of a few hundred trees costs a draw call per kind of tree. A piece is scaled so its height (h),
// width (w) or largest side (m: a flat rock or a clump of grass) is what its spot asks for, and stands on
// the ground at its spot.
import React, { useMemo } from "react";
import * as THREE from "three";
import { toonRamp } from "../../world3d";
import { ready } from "../stage";
import type { Look } from "./style";

export type Spot = { x: number; z: number; a: number; s: number; y?: number };

const tone = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);

// The piece's own colours and texture, in the set's look: cel-shaded for a diorama, otherwise a cheap
// diffuse material (a set holds thousands of leaves; none of them is ever close enough to need more).
const dressed = (old: THREE.Material, look: Look) => {
  const s = old as THREE.MeshStandardMaterial;
  const color = tone(s.color ?? new THREE.Color("#ffffff"), 1 - look.dark * 0.45);
  const cut = s.alphaTest > 0 || (s.transparent && Boolean(s.map));
  const opts = { name: s.name, color, map: s.map ?? null, vertexColors: Boolean(s.vertexColors), alphaTest: cut ? Math.max(0.4, s.alphaTest) : 0, side: cut ? THREE.DoubleSide : s.side };
  return look.toon ? new THREE.MeshToonMaterial({ ...opts, gradientMap: toonRamp }) : new THREE.MeshLambertMaterial(opts);
};

export type Fit = "h" | "w" | "m";
export const Pieces: React.FC<{ src: string; spots: Spot[]; look: Look; fit?: Fit; shadows?: boolean }> = ({ src, spots, look, fit = "h", shadows = true }) => {
  // loaded with the cast before the canvas mounts (index.tsx useCastModels)
  const model = ready.get(src);
  const meshes = useMemo(() => {
    if (!model || !spots.length) return [];

    const scene = model.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const base = 1 / Math.max(1e-6, fit === "h" ? size.y : fit === "w" ? Math.max(size.x, size.z) : Math.max(size.x, size.y, size.z));
    const centre = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const parts: THREE.Mesh[] = [];
    scene.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) parts.push(n as THREE.Mesh);
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    return parts.map((part) => {
      const mat = Array.isArray(part.material) ? part.material.map((x) => dressed(x, look)) : dressed(part.material, look);
      const inst = new THREE.InstancedMesh(part.geometry, mat, spots.length);
      const local = new THREE.Matrix4().multiplyMatrices(centre, part.matrixWorld);
      spots.forEach((p, i) => {
        const k = base * p.s;
        m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q.setFromAxisAngle(up, p.a), new THREE.Vector3(k, k, k)).multiply(local);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = shadows;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      return inst;
    });
  }, [model, spots, look, fit, shadows]);
  return (
    <group>
      {meshes.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </group>
  );
};

// Spots shared out among a role's pieces, so a forest mixes its kinds of tree.
export type Bins = Map<string, { src: string; spots: Spot[]; fit: Fit; shadows: boolean }>;
export const deal = (bins: Bins, srcs: string[], spots: Spot[], r: () => number, fit: Fit = "h", shadows = true) => {
  spots.forEach((s) => {
    const src = srcs[Math.floor(r() * srcs.length) % srcs.length];
    const key = `${src}|${fit}|${shadows ? 1 : 0}`;
    const bin = bins.get(key) ?? { src, spots: [], fit, shadows };
    bin.spots.push(s);
    bins.set(key, bin);
  });
};

export const Binned: React.FC<{ bins: Bins; look: Look }> = ({ bins, look }) => (
  <group>
    {[...bins.entries()].map(([key, b]) => (
      <Pieces key={key} src={b.src} spots={b.spots} fit={b.fit} shadows={b.shadows} look={look} />
    ))}
  </group>
);
