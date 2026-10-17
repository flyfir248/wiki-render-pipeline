// Road vehicle module: a car, truck or bus on a road through the city, the country, the desert or the
// snow, and what happens to it: driving on, braking into a skid, crashing into a wall or another car, or
// being chased. Liveries come from the vehicle's name and the video's seed; no real make or logo.
import React, { useMemo } from "react";
import { Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Flash, groundTexture, InkedBox, liveryOf, rng, Smoke, Toon, toonRamp, type Livery } from "../world3d";
import { aim, Atmosphere, Billow, Debris, Hills, moduleScene, shake, shotOf, Tree, treeSpots, useWorld, type WorldProps } from "./kit";

const V = 0.8; // world units per frame on the open road
const LANE = 1.9;
const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

const Wheels: React.FC<{ xs: number[]; half: number; spin: number }> = ({ xs, half, spin }) => (
  <>
    {xs.map((x) =>
      [1, -1].map((s) => (
        <mesh key={`${x}${s}`} geometry={wheel} position={[x, 0.42, s * half]} rotation={[Math.PI / 2, spin, 0]}>
          <meshToonMaterial color="#1e2026" gradientMap={toonRamp} />
        </mesh>
      )),
    )}
  </>
);

// One vehicle, nose toward +x, its front at about x = +2.1 (car), +4 (truck) or +5 (bus).
const Vehicle: React.FC<{ variant: string; livery: Livery; spin: number; crumple?: number; lights?: boolean }> = ({ variant, livery, spin, crumple = 0, lights }) => {
  const front = (
    <mesh position={[variant === "car" ? 2.12 - crumple : variant === "truck" ? 4.02 : 5.02, variant === "car" ? 0.8 : 1, 0]}>
      <boxGeometry args={[0.05, 0.2, variant === "car" ? 1.5 : 1.9]} />
      <meshBasicMaterial color={lights ? "#fff6c8" : "#d9dde3"} />
    </mesh>
  );
  if (variant === "truck")
    return (
      <group>
        <InkedBox size={[2.2, 2.3, 2.3]} color={livery.accent} at={[2.9, 1.65, 0]} />
        <mesh position={[3.9, 2.2, 0]}>
          <boxGeometry args={[0.25, 0.8, 2]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
        <InkedBox size={[7.2, 2.8, 2.4]} color="#e9ecf1" at={[-2.1, 2, 0]} />
        <mesh position={[-2.1, 1.1, 0]}>
          <boxGeometry args={[7.22, 0.3, 2.42]} />
          <meshBasicMaterial color={livery.accent2} />
        </mesh>
        {front}
        <Wheels xs={[3.2, -1, -4.4]} half={1.1} spin={spin} />
      </group>
    );
  if (variant === "bus")
    return (
      <group>
        <InkedBox size={[10, 2.8, 2.4]} color={livery.accent} at={[0, 1.9, 0]} />
        <mesh position={[0, 2.3, 0]}>
          <boxGeometry args={[9.4, 0.8, 2.42]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
        <mesh position={[4.98, 2.3, 0]}>
          <boxGeometry args={[0.1, 1.1, 2]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
        {front}
        <Wheels xs={[3.4, -3.2]} half={1.1} spin={spin} />
      </group>
    );
  return (
    <group>
      <group scale={[1 - crumple * 0.12, 1, 1]} position={[-crumple * 0.25, 0, 0]}>
        <InkedBox size={[4.3, 0.85, 1.9]} color={livery.accent} at={[0, 0.85, 0]} />
        <InkedBox size={[2.2, 0.75, 1.7]} color={livery.accent} at={[-0.3, 1.62, 0]} />
        <mesh position={[-0.3, 1.64, 0]}>
          <boxGeometry args={[2.25, 0.5, 1.72]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      </group>
      {front}
      <Wheels xs={[1.4, -1.4]} half={0.9} spin={spin} />
    </group>
  );
};

const lengthOf = (variant: string) => (variant === "car" ? 4.3 : variant === "truck" ? 9 : 10);

const distanceAt = (action: string, u: number, at: number, D: number) => {
  const tau = action === "brake" ? 30 : action === "crash" ? 4 : 0;
  const f = u * D;
  const f0 = at * D;
  if (!tau || f <= f0) return V * f;
  return V * (f0 + tau * (1 - Math.exp(-(f - f0) / tau)));
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, D, u, at, since, pal, night, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "drive";
  const variant = scene.variant ?? "car";
  const livery = liveryOf(id);
  const setting = scene.setting ?? "road";
  const dist = distanceAt(action, u, at, D);
  const spin = dist / 0.42;
  const front = variant === "car" ? 2.15 : variant === "truck" ? 4 : 5;
  const tex = useMemo(
    () => groundTexture(pal, setting === "city" ? "city" : setting === "desert" ? "desert" : "countryside", id),
    [pal.ground, pal.ground2, setting, id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  tex.offset.set(dist / (4000 / 14), 0);
  const trees = useMemo(() => treeSpots(id, 80, [-160, 160, -80, 80], 9), [id]);
  const blocks = useMemo(() => {
    const r = rng(id + 4);
    return Array.from({ length: 40 }, (_, i) => ({ x: i * 9, side: i % 2 ? 1 : -1, h: 6 + r() * 26, w: 6 + r() * 3, c: ["#c9d3df", "#9fb3c8", "#e2d6c3", "#b8c0cc"][Math.floor(r() * 4)] }));
  }, [id]);

  const crash = action === "crash";
  const k = since > 0 ? Easing.out(Easing.cubic)(Math.min(1, since / 24)) : 0;
  const quake = crash ? shake(since, 1.2, frame) : new THREE.Vector3();
  const cam = shotOf(scene.shot ?? (crash ? "side" : "chase"), u, 22 + lengthOf(variant));
  aim(camera, cam.pos.clone().add(quake), cam.look, cam.fov, portrait, 1.3);
  const wobble = action === "brake" && since > 0 ? 0.18 * Math.sin(since / 6) * Math.exp(-since / 40) : 0;
  const hitCar = crash && scene.obstacle === "car";
  const spinOut = crash ? (hitCar ? 0.9 : 0.35) * k : 0;
  // A wall stands across the lane ahead; it meets the front of the vehicle at the key moment.
  const wallX = front + 0.6 + (distanceAt(action, at, at, D) - dist);

  return (
    <>
      <Atmosphere pal={pal} weather={w.weather} lightning={w.lightning} night={night} seed={w.seed} fog={1.4} />
      <Hills seed={id} color={setting === "snow" ? "#e6edf3" : night ? "#1a2448" : pal.ground2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4000, 4000]} />
        <meshToonMaterial map={tex} gradientMap={toonRamp} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <planeGeometry args={[4000, 8.4]} />
        <Toon color={night ? "#2a2e38" : "#4a4f5a"} />
      </mesh>
      {Array.from({ length: 60 }, (_, i) => {
        const x = ((((i * 6 - dist) % 360) + 360) % 360) - 160;
        return (
          <mesh key={i} geometry={unitBox} position={[x, 0.06, 0]} scale={[2.6, 0.02, 0.18]}>
            <meshBasicMaterial color="#f2efe6" />
          </mesh>
        );
      })}
      {[4.05, -4.05].map((z) => (
        <mesh key={z} geometry={unitBox} position={[0, 0.06, z]} scale={[4000, 0.02, 0.14]}>
          <meshBasicMaterial color="#e8e4da" />
        </mesh>
      ))}
      {setting === "city"
        ? blocks.map((b, i) => {
            const x = ((((b.x - dist) % 360) + 360) % 360) - 160;
            return (
              <mesh key={i} geometry={unitBox} position={[x, b.h / 2, b.side * (9 + b.w / 2)]} scale={[7, b.h, b.w]}>
                <meshToonMaterial color={b.c} gradientMap={toonRamp} />
              </mesh>
            );
          })
        : trees.map((t, i) => {
            const x = ((((t.x - dist) % 320) + 320) % 320) - 160;
            return <Tree key={i} spot={t} x={x} snow={setting === "snow"} />;
          })}

      <group position={[0, 0, LANE + (hitCar ? 1.6 * k : 0)]} rotation={[0, wobble + spinOut, 0]}>
        <Vehicle variant={variant} livery={livery} spin={spin} crumple={crash ? 0.9 * k : 0} lights={night} />
      </group>

      {action === "brake" && since > 0 ? (
        <group>
          {[0.9, -0.9].map((z) => (
            <mesh key={z} geometry={unitBox} position={[-Math.min(40, since * 0.5) / 2 - 1.4, 0.05, LANE + z]} scale={[Math.min(40, since * 0.5), 0.02, 0.3]}>
              <meshBasicMaterial color="#1e2026" />
            </mesh>
          ))}
          <Smoke at={[-1.6, 0.4, LANE]} since={since} wind={[-0.12, 0.04, 0.02]} scale={0.8} seed={id} />
        </group>
      ) : null}

      {action === "chase" ? (
        <group position={[-12 - 2 * Math.sin(frame / 25), 0, -LANE + 1.2 * Math.sin(frame / 18)]} rotation={[0, 0.08 * Math.cos(frame / 18), 0]}>
          <Vehicle variant="car" livery={liveryOf(id + 31)} spin={spin} lights />
          <mesh position={[-0.3, 2.1, 0]}>
            <boxGeometry args={[0.5, 0.18, 1.2]} />
            <meshBasicMaterial color={frame % 10 < 5 ? "#ff3b3b" : "#3b7bff"} />
          </mesh>
        </group>
      ) : null}

      {crash && !hitCar ? <InkedBox size={[1.2, 1.6, 9]} color="#b9b4aa" at={[wallX + 0.6, 0.8, 0]} /> : null}
      {hitCar ? (
        // The other car crosses from the side and meets ours at the key moment.
        <group position={[front - 1, 0, LANE + 2.4 + Math.max(0, -since) * 0.5 + 1.6 * k]} rotation={[0, -Math.PI / 2 + 0.5 * k, 0]}>
          <Vehicle variant="car" livery={liveryOf(id + 13)} spin={spin} crumple={0.6 * k} />
        </group>
      ) : null}
      {crash ? (
        <group>
          <Flash at={[front, 1, LANE]} since={since} size={1.6} />
          <Billow at={[front, 0.8, LANE]} since={since} count={16} spread={0.8} rise={0.8} size={1.2} color="#8f8a84" dark="#6a6560" seed={id} />
          <Debris at={[front, 1, LANE]} since={since} count={14} speed={0.18} color="#c9ced8" seed={id} floor={0} gravity={0.01} />
        </group>
      ) : null}
    </>
  );
};

export const VehicleScene = moduleScene(World);
