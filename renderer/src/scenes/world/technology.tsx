// Technology module: diagrams of ideas drawn in 3D, always labelled illustrations (the catalog marks the
// subject conceptual). A neural network is layers of nodes with signals running through them; training
// sends corrections back and its connections strengthen. A chip sits on a circuit board with data racing
// along its traces. Neither is a picture of any real system.
import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { InkedBox, outlineMaterial, rng, toonRamp } from "../world3d";
import { aim, moduleScene, shotOf, useWorld, type WorldProps } from "./kit";

const ball = new THREE.IcosahedronGeometry(1, 2);
const ink = outlineMaterial(0.05);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

const LAYERS = [4, 6, 6, 3];

const Network: React.FC<{ frame: number; since: number; action: string; seed: number }> = ({ frame, since, action, seed }) => {
  const nodes = useMemo(
    () =>
      LAYERS.map((n, l) =>
        Array.from({ length: n }, (_, i) => new THREE.Vector3((l - (LAYERS.length - 1) / 2) * 9, (i - (n - 1) / 2) * 3.4, Math.sin(i * 1.7 + l) * 1.2)),
      ),
    [],
  );
  const links = useMemo(() => {
    const out: { a: THREE.Vector3; b: THREE.Vector3; l: number; w: number }[] = [];
    const r = rng(seed + 2);
    nodes.slice(0, -1).forEach((layer, l) => layer.forEach((a) => nodes[l + 1].forEach((b) => out.push({ a, b, l, w: 0.25 + r() * 0.5 }))));
    return out;
  }, [nodes, seed]);
  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(links.flatMap(({ a, b }) => [a.x, a.y, a.z, b.x, b.y, b.z]), 3));
    return g;
  }, [links]);
  // A forward wave crosses the layers again and again; training adds a backward wave after the key moment.
  const fast = action === "compute" && since > 0 ? 2.2 : 1;
  const wave = ((frame * 0.035 * fast) % (LAYERS.length + 1)) - 0.5;
  const back = action === "train" && since > 0 ? LAYERS.length - 0.5 - ((since * 0.05) % (LAYERS.length + 1)) : null;
  const strength = action === "train" ? Math.min(1, Math.max(0, since / 120)) : 0;
  const glow = (l: number) => Math.max(0, 1 - Math.abs(l - wave) * 1.6);
  const correction = (l: number) => (back == null ? 0 : Math.max(0, 1 - Math.abs(l - back) * 1.6));
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#5f8fc9" transparent opacity={0.25 + strength * 0.5} />
      </lineSegments>
      {links.filter((_, i) => i % 3 === 0).map((k, i) => {
        // Signals ride the connections between the layers the wave is crossing.
        const t = wave - k.l - 0.5;
        if (t < 0 || t > 1) return null;
        const p = k.a.clone().lerp(k.b, t);
        return (
          <mesh key={i} geometry={ball} position={p} scale={0.28}>
            <meshBasicMaterial color="#9fe8ff" />
          </mesh>
        );
      })}
      {back != null
        ? links.filter((_, i) => i % 3 === 1).map((k, i) => {
            const t = 1 - (back - k.l - 0.5);
            if (t < 0 || t > 1) return null;
            return (
              <mesh key={`b${i}`} geometry={ball} position={k.a.clone().lerp(k.b, t)} scale={0.26}>
                <meshBasicMaterial color="#ff9f43" />
              </mesh>
            );
          })
        : null}
      {nodes.map((layer, l) =>
        layer.map((p, i) => {
          const c = new THREE.Color("#2b4c7e").lerp(new THREE.Color("#9fe8ff"), glow(l)).lerp(new THREE.Color("#ff9f43"), correction(l));
          return (
            <group key={`${l}-${i}`} position={p} scale={0.95 + glow(l) * 0.25}>
              <mesh geometry={ball}>
                <meshToonMaterial color={c} gradientMap={toonRamp} />
              </mesh>
              <mesh geometry={ball} material={ink} />
            </group>
          );
        }),
      )}
    </group>
  );
};

const Chip: React.FC<{ frame: number; since: number; action: string; seed: number }> = ({ frame, since, action, seed }) => {
  // Traces run out from the chip's pins to the board's edge, turning once at a right angle.
  const traces = useMemo(() => {
    const r = rng(seed + 4);
    return Array.from({ length: 28 }, (_, i) => {
      const side = i % 4;
      const k = (Math.floor(i / 4) - 3) * 1.1;
      const start = [new THREE.Vector3(5, 0, k), new THREE.Vector3(-5, 0, k), new THREE.Vector3(k, 0, 5), new THREE.Vector3(k, 0, -5)][side];
      const out = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)][side];
      const bend = start.clone().add(out.clone().multiplyScalar(3 + r() * 6));
      const turn = new THREE.Vector3(out.z, 0, out.x).multiplyScalar((r() - 0.5) * 16);
      return [start, bend, bend.clone().add(turn), bend.clone().add(turn).add(out.clone().multiplyScalar(8 + r() * 8))];
    });
  }, [seed]);
  const busy = action === "compute" && since > 0 ? 2.5 : 1;
  return (
    <group>
      <mesh geometry={unitBox} position={[0, -0.3, 0]} scale={[60, 0.6, 60]}>
        <meshToonMaterial color="#1f5f3a" gradientMap={toonRamp} />
      </mesh>
      {traces.map((pts, i) => (
        <group key={i}>
          {pts.slice(0, -1).map((a, j) => {
            const b = pts[j + 1];
            const mid = a.clone().add(b).multiplyScalar(0.5);
            const len = a.distanceTo(b);
            const along = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
            return (
              <mesh key={j} geometry={unitBox} position={[mid.x, 0.03, mid.z]} scale={along ? [len + 0.2, 0.05, 0.2] : [0.2, 0.05, len + 0.2]}>
                <meshBasicMaterial color="#d9a441" />
              </mesh>
            );
          })}
          {(() => {
            // A pulse of data running along the trace.
            const t = ((frame * 0.012 * busy + i * 0.137) % 1) * (pts.length - 1);
            const j = Math.min(pts.length - 2, Math.floor(t));
            const p = pts[j].clone().lerp(pts[j + 1], t - j);
            return (
              <mesh geometry={ball} position={[p.x, 0.25, p.z]} scale={0.32}>
                <meshBasicMaterial color="#9fe8ff" />
              </mesh>
            );
          })()}
        </group>
      ))}
      <InkedBox size={[10, 1.2, 10]} color="#22252c" at={[0, 0.6, 0]} />
      <InkedBox size={[5.5, 0.3, 5.5]} color="#c9a227" at={[0, 1.35, 0]} outline={0.03} />
      {Array.from({ length: 28 }, (_, i) => {
        const side = i % 4;
        const k = (Math.floor(i / 4) - 3) * 1.1;
        const at: [number, number, number] = [[5.3, 0.3, k], [-5.3, 0.3, k], [k, 0.3, 5.3], [k, 0.3, -5.3]][side] as [number, number, number];
        return (
          <mesh key={i} geometry={unitBox} position={at} scale={side < 2 ? [0.7, 0.15, 0.35] : [0.35, 0.15, 0.7]}>
            <meshBasicMaterial color="#c9ced8" />
          </mesh>
        );
      })}
    </group>
  );
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, u, since, id } = w;
  const { camera } = useThree();
  const variant = scene.variant ?? "network";
  const action = scene.action ?? "idle";
  const size = variant === "chip" ? 34 : 30;
  const cam = shotOf(scene.shot ?? "orbit", u, size);
  aim(camera, cam.pos, cam.look, cam.fov, portrait, 1.25);
  return (
    <>
      <color attach="background" args={["#0a1022"]} />
      <fog attach="fog" args={["#0a1022", size * 2.5, size * 7]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[20, 40, 25]} intensity={1.5} />
      {variant === "chip" ? <Chip frame={frame} since={since} action={action} seed={id} /> : <Network frame={frame} since={since} action={action} seed={id} />}
    </>
  );
};

export const TechnologyScene = moduleScene(World);
