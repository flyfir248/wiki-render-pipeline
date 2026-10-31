// City module: a modern city of towers or a historic town of timber houses, a church and a river,
// seen from the air, and what can happen to it: a fire spreading street by street, a building
// collapsing, an earthquake, a flood rising through the streets, a blast. The layout comes from the
// city's name and the video's seed, so the same city looks the same in every scene of a video.
import React, { useMemo } from "react";
import { interpolate, Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clamp, Flash, rng, Sea, Smoke, Toon, toonRamp } from "../world3d";
import { aim, Atmosphere, Billow, Debris, Fireball, Hills, moduleScene, shake, shotOf, useWorld, type WorldProps } from "./kit";

type Building = { x: number; z: number; w: number; d: number; h: number; color: string; roof: string; tall: boolean; k: number };

const MODERN = ["#c9d3df", "#9fb3c8", "#e2d6c3", "#b8c0cc", "#8fa6bf", "#d6dde6"];
const OLD_WALLS = ["#efe2c6", "#e3cfa6", "#f4ecdc", "#d8bf94", "#cdb38a"];
const OLD_ROOFS = ["#7a4b33", "#8c5a3c", "#5e4636", "#9b6a45"];

// Windows: a grid of panes drawn once, wrapped round every tower.
const windowTexture = (rows: number, dark: string) => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = dark;
  const cols = 4;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) g.fillRect(4 + i * (64 / cols), 4 + j * (128 / rows), 64 / cols - 8, 128 / rows - 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const layout = (seed: number, historic: boolean): Building[] => {
  const r = rng(seed + 101);
  const out: Building[] = [];
  const n = historic ? 15 : 11;
  const step = historic ? 11 : 16;
  for (let gx = -n; gx <= n; gx++)
    for (let gz = -n; gz <= n; gz++) {
      if (historic && Math.abs(gz - 4) <= 1) continue; // the river runs through the old town
      if (!historic && (gx % 4 === 0 || gz % 4 === 0) && r() < 0.6) continue; // avenues and squares
      const dist = Math.hypot(gx, gz) / n;
      if (r() < dist * 0.5) continue; // thinning out toward the edge
      const k = out.length;
      if (historic) {
        const w = 5 + r() * 3;
        out.push({ x: gx * step + (r() - 0.5) * 2, z: gz * step + (r() - 0.5) * 2, w, d: 4 + r() * 3, h: 3 + r() * 3, color: OLD_WALLS[Math.floor(r() * OLD_WALLS.length)], roof: OLD_ROOFS[Math.floor(r() * OLD_ROOFS.length)], tall: false, k });
      } else {
        const tall = r() < 0.55 - dist * 0.4;
        out.push({ x: gx * step + (r() - 0.5) * 3, z: gz * step + (r() - 0.5) * 3, w: 7 + r() * 6, d: 7 + r() * 6, h: tall ? 18 + r() ** 1.5 * 60 * (1 - dist * 0.6) : 5 + r() * 10, color: MODERN[Math.floor(r() * MODERN.length)], roof: "#7f8794", tall, k });
      }
    }
  return out;
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const flame = new THREE.ConeGeometry(1, 1, 7);

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, D, u, at, since, pal, night, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "flyover";
  const historic = scene.variant === "historic";
  const buildings = useMemo(() => layout(id, historic), [id, historic]);
  const panes = useMemo(() => ({ tall: windowTexture(12, night ? "#ffd27a" : "#3b4a63"), low: windowTexture(4, night ? "#ffd27a" : "#3b4a63") }), [night]);
  const size = historic ? 125 : 140;

  // Where it starts: a fire's first house, the building that falls, the blast.
  const origin = useMemo(() => {
    const r = rng(id + 5);
    const near = buildings.filter((b) => Math.hypot(b.x, b.z) < size * 0.25);
    const pool = near.length ? near : buildings;
    return action === "collapse" ? pool.reduce((a, b) => (b.h > a.h ? b : a), pool[0]) : pool[Math.floor(r() * pool.length)];
  }, [buildings, id, action, size]);

  // A What If video's flood carries on from the last scene's level to this one's, up to over the tallest tower.
  const top = useMemo(() => buildings.reduce((m, b) => Math.max(m, b.h), 0) + 6, [buildings]);
  const water =
    action !== "flood"
      ? -9
      : scene.level != null
        ? -1.5 + (top + 1.5) * interpolate(frame, [0, D * 0.7], [scene.levelFrom ?? 0, scene.level], { ...clamp, easing: Easing.inOut(Easing.quad) })
        : interpolate(since, [0, D * 0.6], [-1.5, historic ? 2.6 : 4.2], { ...clamp, easing: Easing.out(Easing.quad) });
  const quake = action === "earthquake" ? shake(since, 2.2, frame) : action === "explosion" || action === "collapse" ? shake(since, 1, frame) : new THREE.Vector3();
  const cam = shotOf(scene.shot ?? (action === "flyover" ? "orbit" : "wide"), u, size);
  // A rising flood lifts the camera with it, so it never ends up looking at the sea from underneath.
  if (water > -1.4) {
    cam.pos.y = Math.max(cam.pos.y, water + size * 0.12);
    cam.look.y = Math.max(cam.look.y, water * 0.85);
  }
  aim(camera, cam.pos.clone().add(quake), cam.look.clone().add(new THREE.Vector3(origin.x * 0.3, 0, origin.z * 0.3)), cam.fov, portrait);

  // The fire spreads outward from its first house; behind the front, buildings are burnt out.
  const fireR = action === "fire" ? Math.max(0, since) * ((size * 0.55) / Math.max(1, D * (1 - at))) : -1;
const blastR = action === "explosion" ? Math.max(0, since) * 1.6 : -1;
  const topple = useMemo(() => {
    const r = rng(id + 77);
    return buildings.map(() => (r() < 0.16 ? { dir: r() * Math.PI * 2, delay: r() * 30 } : null));
  }, [buildings, id]);

  const burning: Building[] = [];
  const parts = buildings.map((b) => {
    const dist = Math.hypot(b.x - origin.x, b.z - origin.z);
    let color = b.color;
    let roof = b.roof;
    let h = b.h;
    let rot: [number, number, number] = [0, 0, 0];
    let lift = 0;
    let lit = false;
    if (action === "fire" && dist < fireR) {
      const burnt = dist < fireR - (historic ? 28 : 40);
      color = burnt ? "#3a3330" : b.color;
      roof = burnt ? "#2a2522" : roof;
      if (!burnt) {
        lit = true;
        burning.push(b);
      } else h = b.h * 0.6;
    }
    if (action === "collapse" && b === origin && since > 0) {
      const k = Easing.in(Easing.quad)(Math.min(1, since / 45));
      h = b.h * (1 - 0.92 * k);
      rot = [0.05 * k, 0, 0.08 * k];
    }
    if (action === "earthquake" && since > 0) {
      const sway = 0.05 * Math.exp(-since / 50) * Math.sin(since * 0.7 + b.k);
      rot = [sway, 0, sway * 0.7];
      const t = topple[b.k];
      if (t && since > t.delay) {
        const k = Easing.in(Easing.quad)(Math.min(1, (since - t.delay) / 28));
        rot = [Math.cos(t.dir) * 1.3 * k, 0, Math.sin(t.dir) * 1.3 * k];
        lift = -b.h * 0.25 * k;
      }
    }
    if (action === "explosion" && dist < blastR && dist < size * 0.3) {
      const k = Math.min(1, (blastR - dist) / 20) * (1 - dist / (size * 0.3));
      const a = Math.atan2(b.z - origin.z, b.x - origin.x);
      rot = [Math.sin(a) * 0.5 * k, 0, -Math.cos(a) * 0.5 * k];
      if (dist < size * 0.08) color = "#3a3330";
    }
    return { b, color, roof, h, rot, lift, lit };
  });

  return (
    <>
      <Atmosphere pal={pal} weather={w.weather} lightning={w.lightning} night={night} seed={w.seed} fog={2.2} />
      {night && action === "fire" ? <pointLight position={[origin.x, 30, origin.z]} intensity={4} distance={size * 1.5} color="#ff8a3a" /> : null}
      <Hills seed={id} color={night ? "#1a2448" : "#7fa86a"} radius={900} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5000, 5000]} />
        <Toon color={night ? "#1b2238" : historic ? "#9c8c6e" : "#8a919c"} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[size * 2.2, size * 2.2]} />
        <Toon color={night ? "#232a40" : historic ? "#b8a582" : "#a3a9b3"} />
      </mesh>
      {historic ? (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 4 * 11]}>
            <planeGeometry args={[size * 3, 22]} />
            <Toon color={night ? "#1f3a6e" : "#4f86b5"} />
          </mesh>
          {/* A cathedral with a spire rises over the old town. */}
          <group position={[-30, 0, -20]}>
            <mesh geometry={unitBox} position={[0, 7, 0]} scale={[26, 14, 11]}>
              <Toon color={action === "fire" && fireR > Math.hypot(-30 - origin.x, -20 - origin.z) + 30 ? "#3a3330" : "#d9cdb4"} />
            </mesh>
            <mesh position={[-10, 22, 0]} scale={[3.5, 30, 3.5]}>
              <coneGeometry args={[1, 1, 6]} />
              <Toon color="#6f6a64" />
            </mesh>
          </group>
        </group>
      ) : null}
      {parts.map(({ b, color, roof, h, rot, lift, lit }, i) => (
        <group key={i} position={[b.x, lift, b.z]} rotation={rot}>
          {historic ? (
            <>
              <mesh geometry={unitBox} position={[0, h / 2, 0]} scale={[b.w, h, b.d]}>
                <Toon color={color} />
              </mesh>
              <mesh geometry={unitBox} position={[0, h + b.d * 0.25, 0]} rotation={[Math.PI / 4, 0, 0]} scale={[b.w * 1.04, b.d * 0.72, b.d * 0.72]}>
                <Toon color={roof} />
              </mesh>
            </>
          ) : (
            <mesh geometry={unitBox} position={[0, h / 2, 0]} scale={[b.w, h, b.d]}>
              <meshToonMaterial color={color} map={b.tall ? panes.tall : panes.low} gradientMap={toonRamp} emissive={lit ? "#ff6a2a" : "#000000"} emissiveIntensity={lit ? 0.3 : 0} />
            </mesh>
          )}
          {lit ? (
            <mesh geometry={flame} position={[0, h + (historic ? b.d * 0.5 : 0) + 2, 0]} scale={[b.w * 0.35, 4 + 1.5 * Math.sin(frame / 2 + i), b.d * 0.35]}>
              <meshBasicMaterial color={(frame + i) % 4 < 2 ? "#ff7a2a" : "#ffc23a"} />
            </mesh>
          ) : null}
        </group>
      ))}
      {/* Smoke rises over the fire front. */}
      {burning
        .filter((_, i) => i % Math.max(1, Math.floor(burning.length / 6)) === 0)
        .slice(0, 6)
        .map((b, k) => (
          <Smoke key={k} at={[b.x, b.h + 3, b.z]} since={frame + 20 + k * 7} wind={[0.1, 0.22, 0.04]} fire={false} scale={historic ? 2.4 : 3.2} seed={k + id} />
        ))}
      {action === "collapse" ? (
        <group>
          <Billow at={[origin.x, 2, origin.z]} since={since} count={30} spread={3} rise={2} size={5} color="#b8b0a4" dark="#8f877c" seed={id} />
          <Debris at={[origin.x, origin.h * 0.6, origin.z]} since={since} count={18} speed={0.35} color="#8c8f96" seed={id} floor={0} />
        </group>
      ) : null}
      {action === "earthquake"
        ? topple.map((t, i) => (t && i % 2 === 0 ? <Billow key={i} at={[buildings[i].x, 1, buildings[i].z]} since={since - t.delay - 18} count={8} spread={1.2} rise={0.8} size={3} color="#b8b0a4" dark="#8f877c" seed={i} /> : null))
        : null}
      {action === "explosion" ? (
        <group>
          <Flash at={[origin.x, 8, origin.z]} since={since} size={10} />
          <Fireball at={[origin.x, 6, origin.z]} since={since} size={7} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[origin.x, 0.6, origin.z]} scale={Math.max(0.01, blastR)}>
            <ringGeometry args={[0.92, 1, 48]} />
            <meshBasicMaterial color="#fff3d0" transparent opacity={Math.max(0, 1 - since / 50)} />
          </mesh>
          <Billow at={[origin.x, 3, origin.z]} since={since - 6} count={34} spread={1.2} rise={7} size={5} color="#6f6a64" dark="#4a4642" seed={id} />
          <Debris at={[origin.x, 6, origin.z]} since={since} count={20} speed={0.6} color="#5d5a55" seed={id} floor={0} />
        </group>
      ) : null}
      {action === "flood" && water > -1.4 ? (
        <group position={[0, water, 0]}>
          <Sea pal={{ ...pal, ground: night ? "#28477e" : "#5b8fb5", ground2: night ? "#223e70" : "#4f82a8" }} frame={frame} travel={frame * 0.2} amp={0.25} size={size * 2.4} />
        </group>
      ) : null}
    </>
  );
};

export const CityScene = moduleScene(World);
