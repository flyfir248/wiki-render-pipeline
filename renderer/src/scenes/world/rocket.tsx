// Rocket module: a multi-stage rocket or a shuttle stack at the launch site and in the sky: ignition
// and lift-off, the climb on its exhaust plume, a stage separating, or a break-up. Built from code with
// generic colours, never a real agency's markings.
import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Cloud, Flash, groundTexture, Inked, InkedBox, liveryOf, rng, Sea, slab, Smoke, Toon, toonRamp, type Livery } from "../world3d";
import { Modelled } from "./library";
import { aim, Atmosphere, Billow, Debris, Fireball, Hills, moduleScene, shake, useWorld, type WorldProps } from "./kit";

const puff = new THREE.IcosahedronGeometry(1, 0);

// A lathed body from y0 to y1 with an optional nose cone, radius r.
const bodyGeometry = (r: number, y0: number, y1: number, nose: number) => {
  const pts = [new THREE.Vector2(0.01, y0), new THREE.Vector2(r, y0), new THREE.Vector2(r, y1)];
  for (let i = 1; i <= 8 && nose > 0; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(Math.max(0.01, r * Math.cos((t * Math.PI) / 2) ** 0.8), y1 + nose * Math.sin((t * Math.PI) / 2)));
  }
  if (!nose) pts.push(new THREE.Vector2(0.01, y1));
  return new THREE.LatheGeometry(pts, 18);
};

// The exhaust: a flickering flame and a trail of smoke streaming down from the engines.
const Plume: React.FC<{ at: [number, number, number]; frame: number; speed: number; scale?: number; trail?: boolean }> = ({ at, frame, speed, scale = 1, trail = true }) => (
  <group position={at} scale={scale}>
    {[0, 1, 2].map((k) => (
      <mesh key={k} position={[0, -1.6 - k * 0.9, 0]} rotation={[Math.PI, 0, 0]} scale={[1 - k * 0.22, 1 + 0.35 * Math.sin(frame / 2 + k), 1 - k * 0.22]}>
        <coneGeometry args={[1.1, 3.4, 10]} />
        <meshBasicMaterial color={k === 0 ? "#fff3c0" : k === 1 ? "#ffc23a" : "#ff7a2a"} />
      </mesh>
    ))}
    {trail
      ? Array.from({ length: 34 }, (_, i) => {
          const age = i * 2 + (frame % 2);
          const r = rng(i * 3 + 1);
          return (
            <mesh key={i} geometry={puff} position={[(r() - 0.5) * age * 0.04, -5 - age * speed, (r() - 0.5) * age * 0.04]} scale={0.9 + age * 0.06}>
              <meshToonMaterial color={age < 8 ? "#f4efe6" : "#d9d6d0"} emissive="#c9c4bc" emissiveIntensity={0.4} gradientMap={toonRamp} />
            </mesh>
          );
        })
      : null}
  </group>
);

// A spec (fyt/assets.py) gives a named rocket its features: the Saturn V's three stages, black roll
// pattern and escape tower; a Falcon 9's finless body. Without one, a generic two-stage rocket in livery colours.
export type RocketSpec = { stages?: number; rollPattern?: boolean; tower?: boolean; fins?: boolean; band?: string; tank?: string };

// Black quarter panels around the body, alternating with white: the roll pattern cameras tracked.
const quarter = new THREE.CylinderGeometry(1.315, 1.315, 1, 18, 1, true, 0, Math.PI / 2);
const RollPattern: React.FC<{ y: number; h: number; turn: number }> = ({ y, h, turn }) => (
  <>
    {[0, 2].map((k) => (
      <mesh key={k} geometry={quarter} position={[0, y, 0]} scale={[1, h, 1]} rotation={[0, turn + (k * Math.PI) / 2, 0]}>
        <meshBasicMaterial color="#16171c" side={THREE.DoubleSide} />
      </mesh>
    ))}
  </>
);

const towerMotor = new THREE.CylinderGeometry(0.18, 0.26, 1.4, 12);

const Rocket: React.FC<{ livery: Livery; split: number; lower: boolean; upper: boolean; spec?: RocketSpec }> = ({ livery, split, lower, upper, spec = {} }) => {
  const g = useMemo(() => ({ low: bodyGeometry(1.3, 0, 15, 0), high: bodyGeometry(1.3, 15.4, 26, 4.5), fin: slab([[0, 0], [-0, 3.2], [1.7, 0.6], [1.7, 0]], 0.12) }), []);
  const band = spec.band ?? livery.accent;
  const band2 = spec.band ?? livery.accent2;
  return (
    <group>
      {lower ? (
        <group position={[0, -split, 0]} rotation={[0, 0, split * 0.02]}>
          <Inked geometry={g.low} color="#f4f6f9" outline={0.06} />
          <mesh position={[0, 14.8, 0]}>
            <cylinderGeometry args={[1.32, 1.32, 0.8, 18]} />
            <meshBasicMaterial color="#1b1c22" />
          </mesh>
          {spec.rollPattern ? (
            <>
              <RollPattern y={2.2} h={3.2} turn={0} />
              <RollPattern y={12.6} h={2.4} turn={Math.PI / 2} />
            </>
          ) : spec.band ? null : (
            <mesh position={[0, 7, 0]}>
              <cylinderGeometry args={[1.31, 1.31, 1.2, 18]} />
              <meshBasicMaterial color={band} />
            </mesh>
          )}
          {(spec.fins ?? true ? [0, 1, 2, 3] : []).map((k) => (
            <mesh key={k} geometry={g.fin} rotation={[0, (k * Math.PI) / 2, 0]} position={[Math.cos((k * Math.PI) / 2) * 1.2, 0, -Math.sin((k * Math.PI) / 2) * 1.2]}>
              <Toon color="#1b1c22" />
            </mesh>
          ))}
        </group>
      ) : null}
      {upper ? (
        <group>
          <Inked geometry={g.high} color="#f4f6f9" outline={0.06} />
          {spec.band ? null : (
            <mesh position={[0, 20, 0]}>
              <cylinderGeometry args={[1.31, 1.31, 0.6, 18]} />
              <meshBasicMaterial color={band2} />
            </mesh>
          )}
          {(spec.stages ?? 2) >= 3 ? (
            <mesh position={[0, 21.8, 0]}>
              <cylinderGeometry args={[1.31, 1.31, 0.5, 18]} />
              <meshBasicMaterial color={band2} />
            </mesh>
          ) : null}
          {spec.tower ? (
            // The launch escape tower: a thin truss and its motor above the capsule.
            <group position={[0, 30.2, 0]}>
              <mesh position={[0, 1.6, 0]}>
                <cylinderGeometry args={[0.12, 0.35, 3.2, 8]} />
                <meshBasicMaterial color="#3a3d45" />
              </mesh>
              <Inked geometry={towerMotor} color="#e9e6df" outline={0.03} position={[0, 3.9, 0]} />
            </group>
          ) : null}
        </group>
      ) : null}
    </group>
  );
};

const Shuttle: React.FC<{ livery: Livery; split: number; spec?: RocketSpec }> = ({ split, spec = {} }) => {
  const g = useMemo(
    () => ({
      tank: bodyGeometry(1.7, 0, 22, 4),
      srb: bodyGeometry(0.7, 0, 21, 1.6),
      orbiter: bodyGeometry(0.9, 2, 16, 2.2),
      wing: slab([[0, 0], [0, 9], [-3.4, 1.5], [-3.4, 0]], 0.25),
    }),
    [],
  );
  return (
    <group>
      <Inked geometry={g.tank} color={spec.tank ?? "#d9772f"} outline={0.06} />
      {[1, -1].map((s) => (
        <group key={s} position={[0, -split, s * 2.6]} rotation={[s * split * 0.03, 0, 0]}>
          <Inked geometry={g.srb} color="#f1f1ee" outline={0.05} />
        </group>
      ))}
      <group position={[2.6, 0, 0]}>
        <Inked geometry={g.orbiter} color="#f4f6f9" outline={0.05} />
        <mesh geometry={g.wing} position={[0.6, 2.4, 0]} rotation={[0, Math.PI / 2, 0]}>
          <Toon color="#f4f6f9" />
        </mesh>
        <mesh position={[0.95, 16, 0]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.15, 0.8, 0.9]} />
          <meshBasicMaterial color="#1b2340" />
        </mesh>
      </group>
    </group>
  );
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, D, u, at, since, pal, night, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "launch";
  const shuttle = scene.variant === "shuttle";
  const spec = scene.model?.params as RocketSpec | undefined;
  const livery = liveryOf(id);
  const tex = useMemo(() => groundTexture(pal, scene.setting === "desert" ? "desert" : "countryside", id), [pal.ground, pal.ground2, scene.setting, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // "pad" waits on the pad with the engines cold; "launch" lights them at the key moment.
  const onPad = action === "launch" || action === "pad";
  const lit = action === "launch" ? since : -1;
  // Up high the sky darkens toward space.
  const high = action === "separation" ? 0.75 : action === "ascent" || action === "explode" ? 0.25 : 0;
  const sky = useMemo(() => ({ ...pal, top: "#" + new THREE.Color(pal.top).lerp(new THREE.Color("#060a1e"), high).getHexString(), horizon: "#" + new THREE.Color(pal.horizon).lerp(new THREE.Color("#3a5a9a"), high * 0.8).getHexString() }), [pal.top, pal.horizon, high]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lift-off: still on the pad until the key moment, then rising faster and faster.
  const rise = onPad ? (lit > 0 ? 0.0045 * lit * lit : 0) : 0;
  const exploded = action === "explode" && since > 0;
  const split = action === "separation" && since > 0 ? 0.004 * since * since + since * 0.05 : 0;
  const quake = onPad ? shake(lit, 0.5, frame) : exploded ? shake(since, 0.8, frame) : new THREE.Vector3();
  const clouds = useMemo(() => {
    const r = rng(id + 2);
    return Array.from({ length: 14 }, (_, i) => ({ x: (r() - 0.5) * 120, y: r() * 160, z: -20 - r() * 80, s: 1.5 + r() * 2, seed: id + i }));
  }, [id]);

  const h = shuttle ? 26 : 30;
  let pos: THREE.Vector3;
  let look: THREE.Vector3;
  let fov = 36;
  if (onPad) {
    const d = (u - 0.5) * 2;
    pos = new THREE.Vector3(48 + d * 4, 10, 62);
    look = new THREE.Vector3(0, Math.min(rise + h * 0.5, 15 + rise * 0.85), 0);
    fov = 40;
  } else {
    const shot = scene.shot ?? (action === "explode" ? "wide" : "side");
    const a = shot === "orbit" ? 0.3 + u * 1.4 : shot === "front" ? 0.2 : shot === "chase" ? 2.4 : 1.2;
    const r = shot === "wide" ? 110 : 55;
    pos = new THREE.Vector3(Math.cos(a) * r, h * 0.5 + (shot === "below" ? -30 : 6), Math.sin(a) * r);
    look = new THREE.Vector3(0, h * 0.45, 0);
  }
  aim(camera, pos.add(quake), look, fov, portrait, 1.3);

  return (
    <>
      <Atmosphere pal={sky} weather={w.weather} lightning={w.lightning} night={night} seed={w.seed} fog={onPad ? 2 : 4} />
      {onPad ? (
        <group>
          <Hills seed={id} color={night ? "#1a2448" : pal.ground2} radius={900} />
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[4000, 4000]} />
            <meshToonMaterial map={tex} gradientMap={toonRamp} />
          </mesh>
          {scene.setting !== "desert" ? (
            <group position={[0, 0.2, -420]}>
              <Sea pal={{ ...pal, ground: night ? "#1f3a6e" : "#2f7fb8", ground2: night ? "#193260" : "#276ea3" }} frame={frame} travel={0} amp={0.3} size={600} />
            </group>
          ) : null}
          {/* The pad, the flame trench and the service tower. */}
          <InkedBox size={[22, 2, 22]} color="#b9b4aa" at={[0, 1, 0]} />
          <InkedBox size={[6, 0.4, 26]} color="#3a3d45" at={[0, 2.05, 0]} outline={0.02} />
          <group position={[-6.5, 2, 0]}>
            {[0, 1, 2, 3].map((k) => (
              <InkedBox key={k} size={[0.4, h + 6, 0.4]} color="#b8442f" at={[(k % 2) * 3 - 1.5, (h + 6) / 2, Math.floor(k / 2) * 3 - 1.5]} outline={0.03} />
            ))}
            {Array.from({ length: 9 }, (_, j) => (
              <InkedBox key={j} size={[3.4, 0.25, 3.4]} color="#b8442f" at={[0, 3 + j * 3.6, 0]} outline={0.02} />
            ))}
            <InkedBox size={[4.5, 0.3, 0.3]} color="#b8442f" at={[2.4, h * 0.75, 0]} outline={0.02} />
          </group>
          {lit < 0 ? <Smoke at={[1.5, h * 0.6, 0]} since={frame + 20} wind={[0.05, 0.02, 0.03]} scale={0.5} seed={4} /> : null}
          <Billow at={[0, 2, 0]} since={lit} count={36} spread={4} rise={1.2} size={4.5} color="#f1ede6" dark="#d6d1c9" seed={id} />
        </group>
      ) : (
        clouds.map((c, i) => {
          // Clouds stream down past a climbing rocket.
          const y = ((((c.y - frame * 0.9) % 180) + 180) % 180) - 60;
          return (
            <group key={i} position={[c.x, y, c.z]} scale={c.s}>
              <Cloud seed={c.seed} color={sky.cloud} />
            </group>
          );
        })
      )}

      {!exploded ? (
        <group position={[0, onPad ? 2.2 + rise : 0, 0]}>
          <Modelled model={scene.model} length={h} ground>
            {shuttle ? <Shuttle livery={livery} split={split} spec={spec} /> : <Rocket livery={livery} split={split} lower upper spec={spec} />}
          </Modelled>
          {(!onPad || lit > 0) && split < 4 ? <Plume at={[0, 0, 0]} frame={frame} speed={onPad ? 0.25 : 0.9} scale={shuttle ? 1.3 : 1} trail={!onPad} /> : null}
          {split > 0 && !shuttle ? <Plume at={[0, 15.4, 0]} frame={frame} speed={0.9} scale={0.7} trail={false} /> : null}
        </group>
      ) : null}
      {action === "explode" ? (
        <group>
          <Flash at={[0, h * 0.5, 0]} since={since} size={9} />
          <Fireball at={[0, h * 0.5, 0]} since={since} size={8} />
          <Debris at={[0, h * 0.5, 0]} since={since} count={24} speed={0.5} color="#f4f6f9" seed={id} gravity={0.004} />
          {/* Two trails of smoke curl apart from the break-up. */}
          {[1, -1].map((s) =>
            Array.from({ length: 30 }, (_, i) => {
              const t = Math.min(since, 120) - i * 3;
              if (t <= 0) return null;
              return (
                <mesh key={`${s}${i}`} geometry={puff} position={[s * t * 0.45, h * 0.5 + t * 0.35 - 0.002 * t * t, Math.sin(t / 20) * 4]} scale={1.2 + i * 0.05}>
                  <meshToonMaterial color="#efece6" emissive="#d6d1c9" emissiveIntensity={0.4} gradientMap={toonRamp} />
                </mesh>
              );
            }),
          )}
          {since > 0 ? <Billow at={[0, h * 0.5, 0]} since={since} count={22} spread={2.4} rise={0.6} size={4} color="#e9e5de" dark="#bdb7ae" seed={id + 1} /> : null}
        </group>
      ) : null}
    </>
  );
};

export const RocketScene = moduleScene(World);
