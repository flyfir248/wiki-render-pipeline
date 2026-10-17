// Space module: a satellite, probe, station, capsule, asteroid or comet beside the Earth, the Moon,
// Mars, Jupiter or Saturn: circling in orbit, sweeping past, an asteroid striking the surface, or the
// planet opening to show its layers. Planets are painted in code; spacecraft are generic.
import React, { useMemo } from "react";
import { interpolate, Easing } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, Flash, Inked, InkedBox, rng, Toon, toonRamp } from "../world3d";
import { aim, Atmosphere, Billow, moduleScene, useWorld, type WorldProps } from "./kit";

const puff = new THREE.IcosahedronGeometry(1, 0);

// A planet's surface, painted once: oceans and continents, craters, dust and ice, or cloud bands.
const planetTexture = (body: string) => {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const r = rng(body.length * 977 + body.charCodeAt(0));
  const blob = (color: string, n: number, size: number, ymin = 20, ymax = 236) => {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = r() * 512;
      const y = ymin + r() * (ymax - ymin);
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.ellipse(x + (r() - 0.5) * size, y + (r() - 0.5) * size * 0.6, size * (0.3 + r() * 0.5), size * (0.2 + r() * 0.35), r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  if (body === "earth") {
    g.fillStyle = "#2f6fb5";
    g.fillRect(0, 0, 512, 256);
    blob("#5f9e55", 9, 60, 40, 210);
    blob("#c9b07a", 4, 30, 90, 160);
    g.fillStyle = "#f4f8fb";
    g.fillRect(0, 0, 512, 14);
    g.fillRect(0, 242, 512, 14);
    g.globalAlpha = 0.75;
    blob("#ffffff", 14, 26);
    g.globalAlpha = 1;
  } else if (body === "moon") {
    g.fillStyle = "#b9b6b0";
    g.fillRect(0, 0, 512, 256);
    blob("#9a968f", 8, 50);
    g.strokeStyle = "#8a867f";
    g.lineWidth = 3;
    for (let i = 0; i < 70; i++) {
      g.beginPath();
      g.arc(r() * 512, r() * 256, 3 + r() ** 2 * 18, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (body === "mars") {
    g.fillStyle = "#c2653a";
    g.fillRect(0, 0, 512, 256);
    blob("#9a4a2c", 10, 45);
    blob("#d9875a", 6, 30);
    g.fillStyle = "#f4ece6";
    g.fillRect(0, 0, 512, 10);
  } else {
    const bands = body === "saturn" ? ["#e8d9b0", "#d9c08a", "#efe4c6", "#cdb27a"] : ["#e8d2b0", "#c08a5a", "#f1e4cc", "#a86b45", "#e0c49a"];
    for (let y = 0; y < 256; y += 14) {
      g.fillStyle = bands[Math.floor(r() * bands.length)];
      g.fillRect(0, y, 512, 14 + r() * 8);
    }
    if (body === "jupiter") {
      g.fillStyle = "#b8442f";
      g.beginPath();
      g.ellipse(320, 165, 30, 14, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
};

const lump = (seed: number, radius: number) => {
  const base = new THREE.IcosahedronGeometry(radius, 2);
  base.deleteAttribute("normal");
  base.deleteAttribute("uv");
  const g = mergeVertices(base);
  const r = rng(seed);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + r() * 0.45;
    pos.setXYZ(i, pos.getX(i) * k * 1.3, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
};

const Panel: React.FC<{ at: [number, number, number]; size: [number, number] }> = ({ at, size }) => (
  <InkedBox size={[size[0], 0.06, size[1]]} color="#2b4f9e" at={at} outline={0.04} />
);

const Craft: React.FC<{ variant: string; seed: number; frame: number }> = ({ variant, seed, frame }) => {
  const rock = useMemo(() => lump(seed, 3), [seed]);
  const cone = useMemo(() => new THREE.LatheGeometry([new THREE.Vector2(0.01, 2.2), new THREE.Vector2(1.6, 0), new THREE.Vector2(0.01, 0)], 18), []);
  switch (variant) {
    case "asteroid":
    case "comet":
      return (
        <group rotation={[frame * 0.01, frame * 0.013, 0]}>
          <Inked geometry={rock} color={variant === "comet" ? "#8d8a86" : "#7a6a5c"} outline={0.08} />
        </group>
      );
    case "station":
      return (
        <group>
          <InkedBox size={[16, 0.5, 0.5]} color="#c9ced8" at={[0, 0, 0]} />
          {[-6, -2.5, 2.5, 6].map((x) =>
            [1, -1].map((s) => <Panel key={`${x}${s}`} at={[x, 0, s * 4.2]} size={[2.6, 7]} />),
          )}
          {[0, 1.8, -1.8].map((x, i) => (
            <mesh key={i} position={[x, -1.1, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.8, 0.8, 3, 14]} />
              <Toon color="#eef0f3" />
            </mesh>
          ))}
        </group>
      );
    case "capsule":
      return (
        <group rotation={[0, 0, -Math.PI / 2]}>
          <Inked geometry={cone} color="#c9ced8" outline={0.05} />
          <mesh position={[0, -1.4, 0]}>
            <cylinderGeometry args={[1.5, 1.5, 2.8, 18]} />
            <Toon color="#f1f1ee" />
          </mesh>
          <mesh position={[0, -3.2, 0]}>
            <coneGeometry args={[0.7, 1, 12]} />
            <Toon color="#55504a" />
          </mesh>
        </group>
      );
    case "probe":
      return (
        <group>
          <mesh position={[0, 1.2, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[2.4, 0.4, 0.6, 20]} />
            <Toon color="#f1f1ee" />
          </mesh>
          <InkedBox size={[1.4, 1, 1.4]} color="#d9a441" at={[0, 0.3, 0]} />
          <mesh position={[3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 6, 6]} />
            <meshBasicMaterial color="#8a919c" />
          </mesh>
          <mesh position={[-1.8, -0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, 1.6, 10]} />
            <Toon color="#55504a" />
          </mesh>
        </group>
      );
    default: // satellite
      return (
        <group>
          <InkedBox size={[1.6, 1.6, 1.6]} color="#d9a441" at={[0, 0, 0]} />
          {[1, -1].map((s) => (
            <group key={s}>
              <mesh position={[0, 0, s * 1.4]}>
                <boxGeometry args={[0.08, 0.08, 1.2]} />
                <meshBasicMaterial color="#8a919c" />
              </mesh>
              <Panel at={[0, 0, s * 4]} size={[1.6, 4.2]} />
            </group>
          ))}
          <mesh position={[0.9, 0.9, 0]} rotation={[0, 0, -0.8]}>
            <coneGeometry args={[0.8, 0.4, 16, 1, true]} />
            <meshToonMaterial color="#f1f1ee" side={THREE.DoubleSide} gradientMap={toonRamp} />
          </mesh>
        </group>
      );
  }
};

const LAYERS = [
  { r: 1, color: "" },
  { r: 0.82, color: "#d9773a" },
  { r: 0.55, color: "#f2a33a" },
  { r: 0.3, color: "#ffe08a" },
];

const World: React.FC<WorldProps> = ({ scene, portrait }) => {
  const w = useWorld(scene);
  const { frame, u, at, since, id } = w;
  const { camera } = useThree();
  const action = scene.action ?? "orbit";
  const variant = action === "impact" && !["asteroid", "comet"].includes(scene.variant ?? "") ? "asteroid" : scene.variant ?? "satellite";
  const body = scene.obstacle ?? "earth";
  const tex = useMemo(() => planetTexture(body), [body]);
  const spin = frame * 0.0025;

  let planet = { pos: new THREE.Vector3(0, -72, 0), r: 60 };
  let craft = new THREE.Vector3(0, 0, 0);
  let cam = { pos: new THREE.Vector3(-14, 4, 12), look: new THREE.Vector3(0, -4, 0), fov: 40 };
  const hit = new THREE.Vector3(0.45, 0.55, 0.7).normalize();
  const open = action === "layers" ? interpolate(since, [0, 40], [0.0001, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const gapCentre = Math.PI * 0.5; // the cut faces the camera
  if (action === "orbit") {
    const d = (u - 0.5) * 2;
    cam = { pos: new THREE.Vector3(-14 + d * 3, 4 + d, 13), look: new THREE.Vector3(0, -3, 0), fov: 42 };
  } else if (action === "flyby") {
    planet = { pos: new THREE.Vector3(0, 0, -110), r: 42 };
    craft = new THREE.Vector3(interpolate(u, [0, at, 1], [-60, 0, 60]), 6 - 6 * Math.abs(u - at), -20 + 10 * (1 - Math.abs(u - at) * 2));
    cam = { pos: new THREE.Vector3(craft.x * 0.25, 10, 40), look: new THREE.Vector3(craft.x * 0.5, 0, -40), fov: 42 };
  } else if (action === "impact") {
    planet = { pos: new THREE.Vector3(0, 0, 0), r: 40 };
    const surface = hit.clone().multiplyScalar(40);
    const start = surface.clone().add(new THREE.Vector3(90, 40, 30));
    craft = since < 0 ? start.clone().lerp(surface, Easing.in(Easing.quad)(Math.min(1, u / Math.max(0.01, at)))) : surface;
    cam = { pos: new THREE.Vector3(70 + u * 10, 50, 110), look: new THREE.Vector3(10, 10, 10), fov: 40 };
  } else if (action === "layers") {
    planet = { pos: new THREE.Vector3(0, 0, 0), r: 36 };
    const a = gapCentre + (u - 0.5) * 0.5;
    cam = { pos: new THREE.Vector3(-Math.cos(a) * 105, 38, Math.sin(a) * 105), look: new THREE.Vector3(0, 0, 0), fov: 40 };
  }
  aim(camera, cam.pos, cam.look, cam.fov, portrait, 1.25);

  const phiLength = Math.PI * 2 - open * Math.PI * 0.5;
  const phiStart = gapCentre + open * Math.PI * 0.25;
  const showCraft = action !== "layers" && !(action === "impact" && since > 0);

  return (
    <>
      <Atmosphere pal={w.pal} weather="clear" lightning={0} night seed={w.seed} space />
      <group position={planet.pos} rotation={[0.25, action === "layers" ? 0 : spin, 0]}>
        {action === "layers" ? (
          <group>
            {LAYERS.map((l, i) => {
              const r = planet.r * l.r;
              const inner = planet.r * (LAYERS[i + 1]?.r ?? 0);
              return (
                <group key={i}>
                  <mesh>
                    <sphereGeometry args={[r, 48, 32, phiStart, phiLength]} />
                    {i === 0 ? <meshToonMaterial map={tex} gradientMap={toonRamp} side={THREE.DoubleSide} /> : <meshToonMaterial color={l.color} gradientMap={toonRamp} side={THREE.DoubleSide} />}
                  </mesh>
                  {open > 0.01
                    ? [phiStart, phiStart + phiLength].map((phi, k) => (
                        <mesh key={k} rotation={[0, Math.PI + phi, 0]}>
                          <ringGeometry args={[inner, r, 40, 1, -Math.PI / 2, Math.PI]} />
                          <meshToonMaterial color={i === 0 ? "#8a6a4a" : l.color} gradientMap={toonRamp} side={THREE.DoubleSide} />
                        </mesh>
                      ))
                    : null}
                </group>
              );
            })}
          </group>
        ) : (
          <mesh>
            <sphereGeometry args={[planet.r, 48, 32]} />
            <meshToonMaterial map={tex} gradientMap={toonRamp} />
          </mesh>
        )}
        {body === "earth" ? (
          <mesh>
            <sphereGeometry args={[planet.r * 1.04, 48, 32]} />
            <meshBasicMaterial color="#7fb8ff" transparent opacity={0.18} side={THREE.BackSide} />
          </mesh>
        ) : null}
        {body === "saturn" ? (
          <mesh rotation={[Math.PI / 2 - 0.3, 0, 0]}>
            <ringGeometry args={[planet.r * 1.3, planet.r * 2.1, 64]} />
            <meshToonMaterial color="#d9c08a" gradientMap={toonRamp} side={THREE.DoubleSide} />
          </mesh>
        ) : null}
      </group>

      {showCraft ? (
        <group position={craft} rotation={[0.2, frame * 0.004, 0.1]}>
          <Craft variant={variant} seed={id} frame={frame} />
          {variant === "comet" || (action === "impact" && since < 0)
            ? Array.from({ length: 16 }, (_, i) => (
                <mesh key={i} geometry={puff} position={[i * 1.6, i * 0.7, i * 0.5]} scale={1.4 + i * 0.25}>
                  <meshBasicMaterial color={action === "impact" ? "#ffb347" : "#cfe6ff"} transparent opacity={0.6 * (1 - i / 16)} />
                </mesh>
              ))
            : null}
        </group>
      ) : null}

      {action === "impact" ? (
        <group>
          <Flash at={hit.clone().multiplyScalar(41).toArray() as [number, number, number]} since={since} size={7} />
          {/* A shock ring spreads over the surface from the impact, and the impact site glows. */}
          <group position={hit.clone().multiplyScalar(40.3)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit)}>
            {since > 0 ? (
              <>
                <mesh scale={Math.min(24, 1 + since * 0.45)}>
                  <ringGeometry args={[0.85, 1, 48]} />
                  <meshBasicMaterial color="#ffe3a0" transparent opacity={Math.max(0, 1 - since / 70)} side={THREE.DoubleSide} />
                </mesh>
                <mesh scale={Math.max(0.01, 4 - since * 0.02)}>
                  <circleGeometry args={[1, 24]} />
                  <meshBasicMaterial color="#ff6a2a" />
                </mesh>
              </>
            ) : null}
          </group>
          <Billow at={hit.clone().multiplyScalar(41).toArray() as [number, number, number]} since={since} count={26} spread={2} rise={1.6} size={2.4} color="#a8957e" dark="#7d6c5a" seed={id} />
        </group>
      ) : null}
    </>
  );
};

export const SpaceScene = moduleScene(World);
