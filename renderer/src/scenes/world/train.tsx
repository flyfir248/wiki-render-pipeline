// Train module: a steam, diesel or high-speed train (locomotive and carriages) on a track through the
// landscape, and what happens to it: running along the line, braking in a shower of sparks, derailing
// with the carriages jackknifing, meeting another train head-on, crossing a bridge, or a bridge giving
// way beneath it. Liveries come from the train's name and the video's seed; nothing is a real company's.
import React, { useMemo } from "react";
import { Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Flash, groundTexture, InkedBox, liveryOf, rng, Smoke, Splash, Toon, toonRamp, type Livery } from "../world3d";
import { aim, Atmosphere, Billow, Debris, Fireball, Hills, moduleScene, shake, shotOf, Tree, treeSpots, useWorld, type WorldProps } from "./kit";

const CAR = 7.2; // carriage length plus coupling
const V = 0.55; // world units per frame at line speed

const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 12);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

const Wheels: React.FC<{ xs: number[]; r?: number; color?: string; spin: number }> = ({ xs, r = 0.42, color = "#2a2c33", spin }) => (
  <>
    {xs.map((x) =>
      [1, -1].map((s) => (
        <mesh key={`${x}${s}`} geometry={wheel} position={[x, r, s * 0.95]} rotation={[Math.PI / 2, spin, 0]} scale={[r / 0.42, 1, r / 0.42]}>
          <meshToonMaterial color={color} gradientMap={toonRamp} />
        </mesh>
      )),
    )}
  </>
);

const Windows: React.FC<{ x0: number; x1: number; y: number; z: number; step?: number }> = ({ x0, x1, y, z, step = 1 }) => (
  <>
    {Array.from({ length: Math.floor((x1 - x0) / step) }, (_, i) =>
      [1, -1].map((s) => (
        <mesh key={`${i}${s}`} position={[x0 + (i + 0.5) * step, y, s * z]}>
          <boxGeometry args={[step * 0.6, 0.55, 0.04]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      )),
    )}
  </>
);

// One locomotive, its front at x = +4.
const boiler = new THREE.CylinderGeometry(0.9, 0.9, 5.2, 16);
const nose = (() => {
  const pts = Array.from({ length: 12 }, (_, i) => new THREE.Vector2(Math.max(0.02, 1.15 * Math.sqrt(1 - (i / 11) ** 2)), (i / 11) * 4.2));
  const g = new THREE.LatheGeometry(pts, 16);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, 1.05, 1);
  return g;
})();

const Loco: React.FC<{ variant: string; livery: Livery; spin: number; frame: number; moving: boolean }> = ({ variant, livery, spin, frame, moving }) => {
  if (variant === "steam") {
    return (
      <group>
        <InkedBox size={[8, 0.35, 2.1]} color="#2a2c33" at={[0, 0.95, 0]} />
        <mesh geometry={boiler} position={[1.1, 2.1, 0]} rotation={[0, 0, Math.PI / 2]}>
          <Toon color="#1f3b2f" />
        </mesh>
        <mesh position={[1.1, 2.1, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.93, 0.93, 0.25, 16]} />
          <meshBasicMaterial color={livery.accent} />
        </mesh>
        <mesh position={[3.1, 3.3, 0]}>
          <cylinderGeometry args={[0.32, 0.25, 1.3, 10]} />
          <Toon color="#1b1c22" />
        </mesh>
        <InkedBox size={[2.2, 2.4, 2.2]} color="#1f3b2f" at={[-2.6, 2.3, 0]} />
        <InkedBox size={[2.4, 0.2, 2.4]} color="#14161d" at={[-2.6, 3.55, 0]} />
        <mesh position={[4.2, 0.6, 0]} rotation={[0, 0, -0.6]}>
          <boxGeometry args={[0.9, 0.5, 2]} />
          <Toon color="#8a2f2a" />
        </mesh>
        <Wheels xs={[-1.6, 0.2, 2]} r={0.62} color="#8a2f2a" spin={spin} />
        {moving ? <Smoke at={[3.1, 4, 0]} since={frame + 40} wind={[-0.16, 0.06, 0.01]} scale={0.6} seed={9} /> : null}
      </group>
    );
  }
  if (variant === "highspeed") {
    return (
      <group>
        <InkedBox size={[5, 2.3, 2.3]} color="#f4f6f9" at={[-1.5, 2, 0]} />
        <mesh geometry={nose} position={[1, 2, 0]}>
          <Toon color="#f4f6f9" />
        </mesh>
        <mesh position={[3.4, 2.5, 0]} rotation={[0, 0, -0.45]}>
          <boxGeometry args={[1.2, 0.45, 1.6]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
        <mesh position={[0.2, 1.55, 0]}>
          <boxGeometry args={[7.6, 0.28, 2.34]} />
          <meshBasicMaterial color={livery.accent} />
        </mesh>
        <Wheels xs={[-3, -0.5]} spin={spin} />
      </group>
    );
  }
  return (
    <group>
      <InkedBox size={[8, 2.6, 2.3]} color={livery.accent} at={[0, 2.1, 0]} />
      <InkedBox size={[8.05, 0.5, 2.35]} color={livery.accent2} at={[0, 1.6, 0]} outline={0.02} />
      <mesh position={[3.95, 2.8, 0]}>
        <boxGeometry args={[0.1, 0.7, 1.7]} />
        <meshBasicMaterial color="#1b2340" />
      </mesh>
      <Windows x0={2.6} x1={3.8} y={2.8} z={1.16} step={1.2} />
      <mesh position={[4.02, 1.4, 0]}>
        <boxGeometry args={[0.06, 0.25, 0.6]} />
        <meshBasicMaterial color="#fff6c8" />
      </mesh>
      <Wheels xs={[-2.6, -1.6, 1.6, 2.6]} spin={spin} />
    </group>
  );
};

const Carriage: React.FC<{ variant: string; livery: Livery; spin: number }> = ({ variant, livery, spin }) => {
  const body = variant === "steam" ? "#6b2e2a" : variant === "highspeed" ? "#f4f6f9" : "#c9ced8";
  return (
    <group>
      <InkedBox size={[6.6, 2.2, 2.2]} color={body} at={[0, 2, 0]} />
      <InkedBox size={[6.6, 0.25, 2.3]} color={variant === "steam" ? "#3a1a18" : "#8a919c"} at={[0, 3.2, 0]} outline={0.02} />
      {variant !== "steam" ? (
        <mesh position={[0, 1.4, 0]}>
          <boxGeometry args={[6.62, 0.22, 2.22]} />
          <meshBasicMaterial color={livery.accent} />
        </mesh>
      ) : null}
      <Windows x0={-2.9} x1={2.9} y={2.3} z={1.11} />
      <Wheels xs={[-2.4, -1.6, 1.6, 2.4]} spin={spin} />
    </group>
  );
};

// How far the line has run past the train by progress u: line speed until the key moment, then the way
// comes off as fast as the action stops it.
const distanceAt = (action: string, u: number, at: number, D: number) => {
  const tau = action === "brake" ? 45 : action === "derail" ? 14 : action === "bridge_collapse" ? 10 : action === "collide" ? 3 : 0;
  const f = u * D;
  const f0 = at * D;
  if (!tau || f <= f0) return V * f;
  return V * (f0 + tau * (1 - Math.exp(-(f - f0) / tau)));
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, D, u, at, since, pal, night, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "travel";
  const variant = scene.variant ?? "diesel";
  const livery = liveryOf(id);
  const other = liveryOf(id + 99);
  const cars = variant === "highspeed" ? 6 : 5;
  const dist = distanceAt(action, u, at, D);
  const moving = !(since > 20 && ["derail", "collide", "bridge_collapse"].includes(action));
  const spin = dist / 0.42;
  const tex = useMemo(() => groundTexture(pal, scene.setting === "city" ? "city" : scene.setting === "desert" ? "desert" : "countryside", id), [pal.ground, pal.ground2, scene.setting, id]); // eslint-disable-line react-hooks/exhaustive-deps
  tex.offset.set(dist / (4000 / 14), 0);
  const trees = useMemo(() => treeSpots(id, 90, [-160, 160, -90, 90], 9), [id]);
  const poles = useMemo(() => Array.from({ length: 14 }, (_, i) => i * 24), []);
  const bridgeLine = action === "bridge" || action === "bridge_collapse";
  // The bridge reaches the front of the train at the key moment (or halfway through a crossing).
  const bridgeX = bridgeLine ? distanceAt(action, action === "bridge" ? 0.5 : at, at, D) - dist + (action === "bridge" ? 0 : -8) : 0;

  const quake = ["derail", "collide", "bridge_collapse"].includes(action) ? shake(since, 1.1, frame) : new THREE.Vector3();
  const size = 44;
  const cam = shotOf(scene.shot ?? (action === "travel" || action === "brake" ? "chase" : "wide"), u, size);
  aim(camera, cam.pos.clone().add(quake), cam.look.clone().add(new THREE.Vector3(-8, 0, 0)), cam.fov, portrait, 1.25);

  // Where each vehicle is and how it lies: carriages jackknife in a derailment, the leading ones fall
  // with a collapsing bridge, the front buckles in a collision.
  const pose = (i: number) => {
    const x = 4 - (i === 0 ? 4 : 4 + 4.2 + (i - 1) * CAR) - (i > 0 && variant === "steam" ? 1.6 : 0);
    const p = { x, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0 };
    if (since <= 0) return p;
    const k = Easing.out(Easing.cubic)(Math.min(1, since / 30));
    if (action === "derail") {
      const side = i % 2 ? -1 : 1;
      const reach = Math.max(0, 1 - i * 0.14);
      p.yaw = side * 0.55 * k * reach;
      p.z = (i === 0 ? 3.5 : side * 1.6 * reach) * k;
      p.roll = (i < 3 ? side * (i === 0 ? 1.25 : 0.7) : 0) * k;
      p.y = i < 3 ? 0.4 * k : 0;
    }
    if (action === "collide" && i < 2) {
      p.pitch = (i === 0 ? 0.35 : 0.15) * k;
      p.y = (i === 0 ? 1.4 : 0.6) * k;
      p.x -= (i === 0 ? 1.2 : 0.6) * k;
    }
    if (action === "bridge_collapse" && i < 3) {
      const fall = Math.max(0, since - i * 6);
      p.y = -Math.min(20, 0.012 * fall * fall);
      p.pitch = -Math.min(0.9, fall * 0.03);
    }
    return p;
  };
  const span = action === "bridge_collapse" && since > 0 ? Math.min(20, 0.012 * since * since) : 0;

  return (
    <>
      <Atmosphere pal={pal} weather={w.weather} lightning={w.lightning} night={night} seed={w.seed} fog={1.6} />
      <Hills seed={id} color={scene.setting === "snow" ? "#e6edf3" : night ? "#1a2448" : pal.ground2} />
      {bridgeLine ? (
        <group>
          {/* Ground on both banks, a river far below, and the bridge between. */}
          {[-1, 1].map((s) => (
            <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[bridgeX + s * (34 + 1000), 0, 0]}>
              <planeGeometry args={[2000, 4000]} />
              <meshToonMaterial map={tex} gradientMap={toonRamp} />
            </mesh>
          ))}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bridgeX, -18, 0]}>
            <planeGeometry args={[70, 4000]} />
            <Toon color={night ? "#1f3a6e" : "#3d7fb0"} />
          </mesh>
          {Array.from({ length: 6 }, (_, k) => {
            const x = bridgeX - 30 + k * 12;
            const falls = action === "bridge_collapse" && k >= 2 && k <= 3;
            return (
              <group key={k} position={[x, falls ? -span : 0, 0]} rotation={[0, 0, falls ? (k === 2 ? -0.4 : 0.4) * Math.min(1, span / 10) : 0]}>
                <InkedBox size={[12, 0.6, 3.4]} color="#7d6f60" at={[6, 0.2, 0]} />
                {[1, -1].map((s) => (
                  <group key={s}>
                    <InkedBox size={[12, 0.3, 0.3]} color="#55504a" at={[6, 4.4, s * 1.9]} outline={0.03} />
                    <mesh position={[3, 2.3, s * 1.9]} rotation={[0, 0, 0.6]}>
                      <boxGeometry args={[5.2, 0.25, 0.25]} />
                      <Toon color="#55504a" />
                    </mesh>
                    <mesh position={[9, 2.3, s * 1.9]} rotation={[0, 0, -0.6]}>
                      <boxGeometry args={[5.2, 0.25, 0.25]} />
                      <Toon color="#55504a" />
                    </mesh>
                  </group>
                ))}
                {k % 2 === 0 ? <InkedBox size={[2, 18, 3]} color="#8a7d6c" at={[0, -9, 0]} /> : null}
              </group>
            );
          })}
          {action === "bridge_collapse" ? <Splash at={[bridgeX + 2, -17.5, 0]} since={since - 28} size={3} seed={id} /> : null}
        </group>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4000, 4000]} />
          <meshToonMaterial map={tex} gradientMap={toonRamp} />
        </mesh>
      )}
      {/* The track: ballast, sleepers streaming past, two rails. */}
      {!bridgeLine ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <planeGeometry args={[4000, 4.2]} />
          <Toon color="#8d877d" />
        </mesh>
      ) : null}
      {Array.from({ length: 200 }, (_, i) => {
        const x = ((((i * 1.3 - dist) % 260) + 260) % 260) - 160;
        if (bridgeLine && action === "bridge_collapse" && Math.abs(x - bridgeX - 6) < 12 && since > 0) return null;
        return (
          <mesh key={i} geometry={unitBox} position={[x, 0.12, 0]} scale={[0.35, 0.18, 2.8]}>
            <meshToonMaterial color="#5b4a3a" gradientMap={toonRamp} />
          </mesh>
        );
      })}
      {[0.72, -0.72].map((z) => (
        <mesh key={z} geometry={unitBox} position={[0, 0.3, z]} scale={[4000, 0.14, 0.12]}>
          <meshBasicMaterial color="#9aa0aa" />
        </mesh>
      ))}
      {!bridgeLine
        ? trees.map((t, i) => {
            const x = ((((t.x - dist) % 320) + 320) % 320) - 160;
            return <Tree key={i} spot={t} x={x} snow={scene.setting === "snow"} />;
          })
        : null}
      {poles.map((p, i) => {
        const x = ((((p - dist) % 336) + 336) % 336) - 168;
        return (
          <mesh key={i} position={[x, 3, -4]}>
            <cylinderGeometry args={[0.1, 0.12, 6, 6]} />
            <meshBasicMaterial color="#5b4a3a" />
          </mesh>
        );
      })}

      {/* The train. */}
      {Array.from({ length: cars + 1 }, (_, i) => {
        const p = pose(i);
        return (
          <group key={i} position={[p.x, p.y, p.z]} rotation={[p.roll, p.yaw, p.pitch]}>
            {i === 0 ? <Loco variant={variant} livery={livery} spin={spin} frame={frame} moving={moving} /> : <Carriage variant={variant} livery={livery} spin={spin} />}
          </group>
        );
      })}
      {action === "brake" && since > 0
        ? Array.from({ length: 10 }, (_, i) => {
            const r = rng(i + frame);
            return (
              <mesh key={i} position={[-4 - (i % 5) * CAR - r() * 3, 0.4 + r() * 0.5, (i % 2 ? 1 : -1) * 1.1]} scale={0.12 + r() * 0.15}>
                <icosahedronGeometry args={[1, 0]} />
                <meshBasicMaterial color={r() > 0.5 ? "#ffd36a" : "#ff8a3a"} />
              </mesh>
            );
          })
        : null}
      {action === "derail" ? (
        <group>
          <Billow at={[0, 0.5, 2]} since={since} count={26} spread={2.4} rise={1.2} size={2.4} color="#b8a98f" dark="#8f8270" seed={id} />
          <Debris at={[2, 1, 1]} since={since} count={14} speed={0.25} color="#5b4a3a" seed={id} floor={0} />
        </group>
      ) : null}
      {action === "collide" ? (
        <group>
          {/* The other train comes down the same line and meets ours at the key moment. */}
          {Array.from({ length: 4 }, (_, i) => {
            const k = Easing.out(Easing.cubic)(Math.min(1, Math.max(0, since) / 30));
            const gap = since < 0 ? -since * V * 2 : 0;
            const x = 4 + 4 + gap + (i === 0 ? 0 : 4.2 + (i - 1) * CAR) + (i === 0 ? -1.2 * k : 0);
            return (
              <group key={i} position={[x, i === 0 ? 1.4 * k : 0, 0]} rotation={[0, Math.PI, i === 0 ? 0.35 * k : 0]}>
                {i === 0 ? <Loco variant={variant === "steam" ? "steam" : "diesel"} livery={other} spin={-spin} frame={frame} moving={since < 0} /> : <Carriage variant={variant} livery={other} spin={-spin} />}
              </group>
            );
          })}
          <Flash at={[4, 2.5, 0]} since={since} size={4} />
          <Fireball at={[4, 2.5, 0]} since={since} size={2.5} />
          <Billow at={[4, 2, 0]} since={since + 4} count={24} spread={1.6} rise={3} size={2.4} color="#6f6a64" dark="#4a4642" seed={id} />
          <Debris at={[4, 2.5, 0]} since={since} count={18} speed={0.35} color="#3a3d45" seed={id} floor={0} />
        </group>
      ) : null}
    </>
  );
};

export const TrainScene = moduleScene(World);
