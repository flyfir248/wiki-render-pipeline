// Primitive parts: the building blocks of every generated thing. A design's parts (fyt/worldgen.py Part)
// are drawn here in metres, x forward, y up, z to the side, standing on y = 0. Unit geometries are
// shared and scaled per part, so a hundred trees cost a handful of buffers.
import React from "react";
import * as THREE from "three";
import { ink, type Look, material } from "./style";
import type { Part } from "./types";

const geos = new Map<string, THREE.BufferGeometry>();
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geos.get(key);
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
};

// A roof-shaped prism: a triangle in the y-z plane, ridge on top running along x, 1 x 1 x 1.
const wedge = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0, 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
};

// The unit geometry for a shape, smoother for glossy looks, faceted otherwise.
export const unitGeometry = (shape: Part["shape"], look: Look, tube = 0.2): THREE.BufferGeometry => {
  const smooth = look.gloss;
  const seg = smooth ? 24 : 8;
  switch (shape) {
    case "box":
      return geo("box", () => new THREE.BoxGeometry(1, 1, 1));
    case "cylinder":
      return geo(`cyl${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));
    case "cone":
      return geo(`cone${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg));
    case "sphere":
      return geo(`sph${smooth}`, () => (smooth ? new THREE.SphereGeometry(0.5, 24, 16) : new THREE.IcosahedronGeometry(0.5, 1)));
    case "capsule":
      return geo(`cap${seg}`, () => new THREE.CapsuleGeometry(0.5, 1, smooth ? 6 : 2, seg));
    case "torus": {
      const t = Math.round(Math.max(0.02, Math.min(0.45, tube)) * 40) / 40;
      return geo(`tor${t}${seg}`, () => new THREE.TorusGeometry(0.5 - t / 2, t / 2, smooth ? 12 : 5, smooth ? 32 : 12));
    }
    case "wedge":
      return geo("wedge", wedge);
  }
};

const D = Math.PI / 180;

// The scale that maps a unit geometry onto a part's size (a capsule's unit is 2 tall).
const scaleOf = (p: Part): [number, number, number] =>
  p.shape === "capsule" ? [p.size[0], p.size[1] / 2, p.size[2]] : p.shape === "torus" ? [(p.size[0] + p.size[1]) / 2, (p.size[0] + p.size[1]) / 2, (p.size[0] + p.size[1]) / 2] : p.size;

export const PartMesh: React.FC<{ part: Part; look: Look; spin?: number; tint?: string; shadows?: boolean }> = ({ part, look, spin = 0, tint, shadows = true }) => {
  const tube = part.shape === "torus" ? part.size[2] / Math.max(1e-3, (part.size[0] + part.size[1]) / 2) : 0.2;
  const g = unitGeometry(part.shape, look, tube);
  const m = material(look, tint ?? part.color, { glow: part.glow });
  const rot: [number, number, number] = [part.rot[0] * D, part.rot[1] * D, part.rot[2] * D];
  const s = scaleOf(part);
  const spinRot: [number, number, number] = part.spin === "x" ? [spin, 0, 0] : part.spin === "y" ? [0, spin, 0] : part.spin === "z" ? [0, 0, spin] : [0, 0, 0];
  return (
    <group position={part.at} rotation={rot}>
      <group rotation={spinRot}>
        <mesh geometry={g} material={m} scale={s} castShadow={shadows && !part.glow} receiveShadow={shadows} />
        {look.ink && !part.glow ? <mesh geometry={g} material={ink} scale={[s[0] * 1.06 + 0.01, s[1] * 1.06 + 0.01, s[2] * 1.06 + 0.01]} /> : null}
      </group>
    </group>
  );
};

// A whole thing built from parts (a vehicle, a bag, a tower), its spinning parts turned by `spin`.
export const PartsModel: React.FC<{ parts: Part[]; look: Look; spin?: number; tint?: (c: string) => string; bone?: Part["bone"] }> = ({
  parts,
  look,
  spin = 0,
  tint,
  bone = "body",
}) => (
  <group>
    {parts
      .filter((p) => (p.bone ?? "body") === bone)
      .map((p, i) => (
        <PartMesh key={i} part={p} look={look} spin={spin} tint={tint ? tint(p.color) : undefined} />
      ))}
  </group>
);

// The bounds of a set of parts: its size and its centre, for framing and placing it.
export const partsBounds = (parts: Part[]) => {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  if (!parts.length) return { size: new THREE.Vector3(1, 1, 1), center: new THREE.Vector3(0, 0.5, 0) };
  const e = new THREE.Euler();
  for (const p of parts) {
    // each part's corners as it is drawn, turned: a fuselage laid along x is long, not tall
    const h = new THREE.Vector3(...p.size).multiplyScalar(0.5);
    const r = p.rot ?? [0, 0, 0];
    e.set(r[0] * D, r[1] * D, r[2] * D);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      box.expandByPoint(v.set(sx * h.x, sy * h.y, sz * h.z).applyEuler(e).add(new THREE.Vector3(...p.at)));
  }
  return { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), min: box.min.clone() };
};

// A box that is a box in every style: a building block for the body generators.
export const Block: React.FC<{
  look: Look;
  color: string;
  size: [number, number, number];
  at?: [number, number, number];
  rot?: [number, number, number];
  shape?: Part["shape"];
  glow?: boolean;
  opacity?: number;
}> = ({ look, color, size, at = [0, 0, 0], rot = [0, 0, 0], shape = "box", glow, opacity }) => {
  const g = unitGeometry(shape, look);
  const s: [number, number, number] = shape === "capsule" ? [size[0], size[1] / 2, size[2]] : size;
  return (
    <group position={at} rotation={rot}>
      <mesh geometry={g} material={material(look, color, { glow, opacity })} scale={s} castShadow={!glow} receiveShadow />
      {look.ink && !glow ? <mesh geometry={g} material={ink} scale={[s[0] * 1.07 + 0.008, s[1] * 1.07 + 0.008, s[2] * 1.07 + 0.008]} /> : null}
    </group>
  );
};
