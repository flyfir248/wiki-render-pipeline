// Landscape module: a volcano, a mountain range, a coast with a town, or a forest, and what nature does
// to them: an eruption (ash column, lava, flying rock), a tsunami rolling ashore, a wildfire front
// crossing the trees, an avalanche pouring down a slope. All built from code in the cel-shaded look.
import React, { useMemo } from "react";
import { interpolate, Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, Flash, groundTexture, Inked, rng, Sea, Smoke, swellOf, Toon, toonRamp, type Palette } from "../world3d";
import { aim, Atmosphere, Billow, Debris, Hills, moduleScene, shake, shotOf, Tree, treeSpots, useWorld, type WorldProps } from "./kit";

const puff = new THREE.IcosahedronGeometry(1, 0);

// A lathed mountain with a jagged surface; with a crater for a volcano.
const peakGeometry = (seed: number, R: number, h: number, crater: boolean) => {
  const pts: THREE.Vector2[] = crater
    ? [new THREE.Vector2(0.01, h * 0.86), new THREE.Vector2(R * 0.09, h * 0.9), new THREE.Vector2(R * 0.13, h), new THREE.Vector2(R * 0.3, h * 0.78), new THREE.Vector2(R * 0.6, h * 0.36), new THREE.Vector2(R, 0)]
    : [new THREE.Vector2(0.01, h), new THREE.Vector2(R * 0.2, h * 0.78), new THREE.Vector2(R * 0.5, h * 0.4), new THREE.Vector2(R, 0)];
  const base = new THREE.LatheGeometry(pts.reverse(), 14); // bottom to top, so the faces point outward
  base.deleteAttribute("normal");
  base.deleteAttribute("uv");
  const g = mergeVertices(base, 0.01);
  const r = rng(seed);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.01) continue;
    const k = 1 + (r() - 0.5) * 0.18;
    pos.setXYZ(i, pos.getX(i) * k, y * (1 + (r() - 0.5) * 0.06), pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
};

// A house: a box and a pitched roof.
const House: React.FC<{ at: [number, number, number]; s: number; wall: string; roof: string; tilt?: number; sink?: number }> = ({ at, s, wall, roof, tilt = 0, sink = 0 }) => (
  <group position={[at[0], at[1] - sink, at[2]]} rotation={[tilt, 0, tilt * 0.6]} scale={s}>
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[1.4, 1, 1]} />
      <Toon color={wall} />
    </mesh>
    <mesh position={[0, 1.25, 0]} rotation={[0, 0, Math.PI / 4]} scale={[0.75, 0.75, 1.06]}>
      <boxGeometry args={[1, 1, 1]} />
      <Toon color={roof} />
    </mesh>
  </group>
);

// The great wave: a curling wall of water, its crest white, extruded along the shore.
const waveGeometry = (h: number) => {
  const s = new THREE.Shape();
  s.moveTo(-22, 0);
  s.quadraticCurveTo(-6, h * 0.25, -1, h * 0.85);
  s.quadraticCurveTo(1, h * 1.08, 4, h * 0.92);
  s.quadraticCurveTo(2.5, h * 0.7, 6, h * 0.2);
  s.lineTo(8, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 900, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -450);
  g.rotateY(Math.PI / 2); // the profile now faces the shore along -z
  return g;
};

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, D, u, at, since, pal, night, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "flyover";
  const variant = action === "erupt" ? "volcano" : action === "tsunami" ? "coast" : action === "wildfire" ? "forest" : action === "avalanche" ? "mountain" : scene.variant ?? "volcano";
  const island = variant === "volcano" && (scene.setting === "sea" || !scene.setting);
  const snowy = scene.setting === "snow" || variant === "mountain";
  const ground: Palette = useMemo(() => (snowy ? { ...pal, ground: "#eef3f8", ground2: "#d9e3ec" } : pal), [pal.ground, pal.ground2, snowy]); // eslint-disable-line react-hooks/exhaustive-deps
  const tex = useMemo(() => groundTexture(ground, scene.setting === "desert" ? "desert" : "countryside", id), [ground, scene.setting, id]);
  const seaPal = useMemo(() => ({ ...pal, ground: night ? "#1f3a6e" : "#2f7fb8", ground2: night ? "#193260" : "#276ea3" }), [pal.top, night]); // eslint-disable-line react-hooks/exhaustive-deps

  const volcano = useMemo(() => peakGeometry(id, 60, 40, true), [id]);
  const peaks = useMemo(() => [0, 1, 2, 3, 4].map((i) => peakGeometry(id + i * 7, 34 + (i % 3) * 10, 30 + ((i * 7) % 5) * 7, false)), [id]);
  const wave = useMemo(() => waveGeometry(26), []);
  const trees = useMemo(() => treeSpots(id, variant === "forest" ? 260 : 90, variant === "forest" ? [-110, 110, -90, 40] : [-140, 140, -120, -18]), [id, variant]);
  const houses = useMemo(() => {
    const r = rng(id + 3);
    return Array.from({ length: 34 }, () => ({ x: -90 + r() * 180, z: -8 - r() * 40, s: 1.6 + r() * 1.4, wall: ["#f2e6d0", "#e8d5b5", "#f7f3ea", "#d9c2a0"][Math.floor(r() * 4)], roof: ["#b5523b", "#8c3f2e", "#5b6c8a"][Math.floor(r() * 3)] }));
  }, [id]);

  // Camera: each action has a framing that shows it best, nudged by the scene's shot.
  const quake = action === "erupt" ? shake(since, 1.4, frame) : action === "avalanche" ? shake(since, 0.6, frame) : new THREE.Vector3();
  let cam;
  if (action === "tsunami") {
    const d = (u - 0.5) * 2;
    cam = { pos: new THREE.Vector3(-30 + d * 10, 8, -80), look: new THREE.Vector3(10, 12, 60), fov: 44 };
  } else if (action === "wildfire") {
    cam = { pos: new THREE.Vector3(-70 + u * 30, 45, 110), look: new THREE.Vector3(0, 0, -20), fov: 38 };
  } else {
    cam = shotOf(scene.shot ?? (action === "flyover" ? "orbit" : "wide"), u, variant === "volcano" ? 120 : 100);
    if (action === "erupt") cam = { ...cam, look: cam.look.clone().add(new THREE.Vector3(0, 32, 0)), pos: cam.pos.clone().add(new THREE.Vector3(0, 6, 25)) };
  }
  aim(camera, cam.pos.clone().add(quake), cam.look, cam.fov, portrait);

  // ----- the eruption -----
  const crater: [number, number, number] = [0, 39, 0];
  const lava = Math.max(0, Math.min(1, since / (D * 0.5)));

  // ----- the tsunami: the wave comes ashore at the key moment, then the water runs inland -----
  const waveZ = action === "tsunami" ? interpolate(u, [0, at, 1], [260, 0, -60], { ...clamp, easing: Easing.inOut(Easing.quad) }) : 400;
  const flood = action === "tsunami" ? interpolate(u, [at, Math.min(1, at + 0.3)], [0, 3.2], clamp) : 0;

  // ----- the wildfire front, sweeping across the trees from the key moment -----
  const front = action === "wildfire" ? -130 + Math.max(0, since) * (260 / Math.max(1, D * (1 - at))) : -999;

  // ----- the avalanche: a front sliding down the slope toward the camera -----
  const slide = action === "avalanche" ? Math.max(0, Math.min(1, since / (D * 0.55))) : 0;

  return (
    <>
      <Atmosphere pal={pal} weather={w.weather} lightning={w.lightning} night={night} seed={w.seed} fog={2} />
      <Hills seed={id} color={snowy ? "#e6edf3" : night ? "#1a2448" : pal.ground2} />
      {island || variant === "coast" ? <Sea pal={seaPal} frame={frame} travel={0} amp={swellOf(w.weather)} size={700} /> : null}
      {/* Land: everywhere for inland places; an island under the volcano; behind the shore for a coast. */}
      {island ? (
        <mesh position={[0, 0.2, 0]} scale={[1, 0.02, 1]}>
          <cylinderGeometry args={[78, 84, 20, 18]} />
          <Toon color="#c9b07a" />
        </mesh>
      ) : variant === "coast" ? (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, -250]}>
            <planeGeometry args={[1400, 500]} />
            <meshToonMaterial map={tex} gradientMap={toonRamp} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, -2]}>
            <planeGeometry args={[1400, 10]} />
            <Toon color="#e9d6a5" />
          </mesh>
        </group>
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[4000, 4000]} />
          <meshToonMaterial map={tex} gradientMap={toonRamp} />
        </mesh>
      )}

      {variant === "volcano" ? (
        <group>
          <Inked geometry={volcano} color={night ? "#4a3f3a" : "#7a6a5c"} outline={0.25} />
          {/* The crater glows once it erupts; lava runs down four sides. */}
          {action === "erupt" && since >= 0 ? (
            <group>
              <mesh position={[0, 35.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[6.5, 14]} />
                <meshBasicMaterial color={frame % 6 < 3 ? "#ff6a2a" : "#ffa33a"} />
              </mesh>
              {[0.3, 1.9, 3.4, 5].map((a, k) =>
                Array.from({ length: 14 }, (_, j) => {
                  const t = (j + 1) / 14;
                  if (t > lava * (0.7 + 0.3 * ((k * 3) % 2))) return null;
                  const rr = 8 + t * 42;
                  const y = interpolate(rr, [8, 18, 36, 60], [38, 31, 14, 0.5], clamp);
                  return (
                    <mesh key={`${k}-${j}`} geometry={puff} position={[Math.cos(a + t * 0.2) * rr, y + 0.6, Math.sin(a + t * 0.2) * rr]} scale={[2.2, 0.8, 2.2]}>
                      <meshBasicMaterial color={j % 2 ? "#ff7a2a" : "#ffb03a"} />
                    </mesh>
                  );
                }),
              )}
            </group>
          ) : null}
        </group>
      ) : null}
      {variant === "mountain"
        ? peaks.map((g, i) => (
            <group key={i} position={[(i - 2) * 45, 0, -30 - (i % 2) * 35]}>
              <Inked geometry={g} color="#7d8794" outline={0.2} />
              <mesh position={[0, 30 + ((i * 7) % 5) * 7 - 7, 0]} scale={[8, 7, 8]}>
                <coneGeometry args={[1, 1, 14]} />
                <Toon color="#f4f8fb" />
              </mesh>
            </group>
          ))
        : null}

      {/* Trees, burning as the fire front passes them. */}
      {variant !== "volcano" || !island
        ? trees.map((t, i) => {
            const burn = action === "wildfire" ? Math.max(0, Math.min(1, (front - t.x) / 14)) : 0;
            const swept = action === "tsunami" && waveZ < t.z + 4;
            if (swept) return null;
            return <Tree key={i} spot={t} snow={snowy} burn={burn} frame={frame} />;
          })
        : null}
      {action === "wildfire"
        ? [-60, -20, 20, 60].map((z, k) => <Smoke key={k} at={[front - 6, 2, z - 20]} since={since + k * 5} wind={[0.08, 0.16, 0.02]} fire scale={3.2} seed={k + 3} />)
        : null}

      {variant === "coast"
        ? houses.map((h, i) => {
            const hit = action === "tsunami" && waveZ < h.z + 2;
            const t = hit ? Math.min(1, (h.z + 2 - waveZ) / 25) : 0;
            return <House key={i} at={[h.x, 0.6, h.z]} s={h.s} wall={h.wall} roof={h.roof} tilt={t * 0.6} sink={t * 2.5} />;
          })
        : null}

      {action === "tsunami" ? (
        <group>
          <group position={[0, 0, waveZ]}>
            <mesh geometry={wave}>
              <Toon color={night ? "#2c4f8e" : "#4a9ad0"} />
            </mesh>
            {Array.from({ length: 60 }, (_, i) => (
              <mesh key={i} geometry={puff} position={[-220 + i * 7.5 + Math.sin(frame / 5 + i) * 1.5, 24.5 + Math.sin(i * 1.7) * 1.2, -2.5]} scale={[4.2, 2.4, 3]}>
                <meshToonMaterial color="#ffffff" emissive="#dfefff" emissiveIntensity={0.5} gradientMap={toonRamp} />
              </mesh>
            ))}
            {Array.from({ length: 40 }, (_, i) => (
              <mesh key={`f${i}`} geometry={puff} position={[-200 + i * 10, 1, -6 - Math.sin(i * 2.3) * 2]} scale={[5, 1.6, 3]}>
                <meshToonMaterial color="#f4fbff" emissive="#dfefff" emissiveIntensity={0.4} gradientMap={toonRamp} />
              </mesh>
            ))}
          </group>
          {/* Behind the wave the sea runs inland over the shore. */}
          {flood > 0 ? (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, flood, Math.min(0, waveZ) / 2 - 2]}>
              <planeGeometry args={[1400, Math.abs(Math.min(0, waveZ)) + 6]} />
              <meshToonMaterial color={night ? "#28477e" : "#4f8fbf"} gradientMap={toonRamp} />
            </mesh>
          ) : null}
        </group>
      ) : null}

      {action === "erupt" ? (
        <group>
          {/* Before: a thin plume of steam. At the moment: a blast, a towering ash column, flying rock. */}
          {since < 0 ? <Smoke at={crater} since={frame + 30} wind={[0.03, 0.1, 0]} scale={2} seed={11} /> : null}
          <Flash at={[0, 44, 0]} since={since} size={9} />
          <Billow at={crater} since={since} count={34} spread={1.6} rise={9} size={5} color="#77716b" dark="#4f4a46" seed={id} />
          <Billow at={[0, 95, 0]} since={since - 30} count={22} spread={7} rise={1.5} size={7} color="#8a847d" dark="#5d5853" seed={id + 1} />
          <Debris at={crater} since={since} count={22} speed={0.9} color="#3a2f2a" seed={id} gravity={0.012} floor={0} />
        </group>
      ) : null}

      {action === "avalanche" ? (
        <group>
          {Array.from({ length: 36 }, (_, i) => {
            const r = rng(i * 5 + id);
            const t = Math.max(0, slide - r() * 0.35);
            if (t <= 0) return null;
            const p = new THREE.Vector3(0, 52, -30).lerp(new THREE.Vector3(10 + r() * 20, 2, 60), t);
            return (
              <mesh key={i} geometry={puff} position={[p.x + (r() - 0.5) * 24, p.y + r() * 4, p.z + (r() - 0.5) * 10]} scale={3 + t * 7 * r()}>
                <meshToonMaterial color="#f7fafc" emissive="#e6eef5" emissiveIntensity={0.4} gradientMap={toonRamp} />
              </mesh>
            );
          })}
        </group>
      ) : null}
    </>
  );
};

export const LandscapeScene = moduleScene(World);
