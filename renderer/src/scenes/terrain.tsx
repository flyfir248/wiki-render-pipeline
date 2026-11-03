// A 3D flyover of real ground: Copernicus elevation raised into a mesh with Sentinel-2 imagery draped
// over it (fyt/satellite.py stages both), lit by a low sun and fading into haze at the horizon. The
// camera sweeps in and down over the scene's places, or follows its route, with the places pinned.
import React, { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Terrain } from "../types";
import { unit } from "../theme";
import { Heading, type SceneProps } from "./shared";
import { Pin, pinFrames, validPlaces } from "./map";

const HAZE = "#8ea6bd";
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

type Ground = { heights: Float32Array; w: number; h: number; tex: THREE.Texture };

// Heights from a terrain-RGB PNG: metres = -10000 + (R*65536 + G*256 + B) / 10.
const loadGround = async (t: Terrain): Promise<Ground> => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = staticFile(t.dem);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const heights = new Float32Array(c.width * c.height);
  for (let i = 0; i < heights.length; i++) heights[i] = -10000 + (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) / 10;
  const tex = await new THREE.TextureLoader().loadAsync(staticFile(t.tex));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { heights, w: c.width, h: c.height, tex };
};

// The ground in kilometres: x east, z south, y up (heights exaggerated so relief reads from altitude).
const useGeometry = (t: Terrain, g: Ground | null) =>
  useMemo(() => {
    if (!g) return null;
    const [west, south, east, north] = t.bounds;
    const lat = (south + north) / 2;
    const W = (east - west) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const H = (north - south) * 110.57;
    const relief = Math.max(50, t.maxM - Math.max(0, t.minM));
    // a gentle hill country gets more lift than the Himalaya, so both read as relief
    const lift = Math.max(1.4, Math.min(5, (0.06 * Math.max(W, H)) / (relief / 1000)));
    const geo = new THREE.PlaneGeometry(W, H, g.w - 1, g.h - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const y0 = mercY(south);
    const y1 = mercY(north);
    for (let r = 0; r < g.h; r++) {
      const la = north - ((north - south) * r) / (g.h - 1);
      const v = (mercY(la) - y0) / (y1 - y0);
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c;
        pos.setY(i, (Math.max(0, g.heights[i]) / 1000) * lift);
        uv.setXY(i, c / (g.w - 1), v);
      }
    }
    geo.computeVertexNormals();
    // where a lon/lat (and its ground height) is in the scene
    const at = (lon: number, la: number): THREE.Vector3 => {
      const c = Math.round(((lon - west) / (east - west)) * (g.w - 1));
      const r = Math.round(((north - la) / (north - south)) * (g.h - 1));
      const hgt = g.heights[Math.max(0, Math.min(g.h - 1, r)) * g.w + Math.max(0, Math.min(g.w - 1, c))] ?? 0;
      return new THREE.Vector3(((lon - west) / (east - west) - 0.5) * W, (Math.max(0, hgt) / 1000) * lift, ((north - la) / (north - south) - 0.5) * H);
    };
    return { geo, W, H, at };
  }, [t, g]);

// The camera's path: in from high and far, down over the ground, still drifting at the end. With a
// route, it follows the route from behind and above instead.
const cameraAt = (S: number, f: number, route: THREE.Vector3[] | null): { pos: THREE.Vector3; look: THREE.Vector3 } => {
  const e = Easing.inOut(Easing.cubic)(f);
  if (route && route.length > 1) {
    const curve = new THREE.CatmullRomCurve3(route);
    const u = Math.min(0.999, Math.max(0, e));
    const head = curve.getPointAt(u);
    const dir = curve.getTangentAt(u).setY(0).normalize();
    const pos = head.clone().addScaledVector(dir, -0.32 * S).add(new THREE.Vector3(0, 0.17 * S, 0));
    return { pos, look: head.clone().addScaledVector(dir, 0.12 * S) };
  }
  const pos = new THREE.Vector3(
    interpolate(e, [0, 1], [-0.16 * S, 0.05 * S]),
    interpolate(e, [0, 1], [0.42 * S, 0.15 * S]),
    interpolate(e, [0, 1], [0.66 * S, 0.3 * S]),
  );
  const look = new THREE.Vector3(interpolate(e, [0, 1], [0, 0.03 * S]), 0, interpolate(e, [0, 1], [-0.02 * S, -0.06 * S]));
  return { pos, look };
};

const Rig: React.FC<{ pos: THREE.Vector3; look: THREE.Vector3; fov: number; far: number }> = ({ pos, look, fov, far }) => {
  const { camera } = useThree();
  camera.position.copy(pos);
  camera.lookAt(look);
  const cam = camera as THREE.PerspectiveCamera;
  if (cam.fov !== fov || cam.far !== far) {
    cam.fov = fov;
    cam.near = 0.05;
    cam.far = far;
    cam.updateProjectionMatrix();
  }
  return null;
};

export const TerrainFlyover: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames: D, fps } = useVideoConfig();
  const t = scene.terrain!;
  const short = format === "short";
  const k = unit(format);
  const [ground, setGround] = useState<Ground | null>(null);
  const [handle] = useState(() => delayRender(`terrain ${t.dem}`, { timeoutInMilliseconds: 120000 }));
  useEffect(() => {
    loadGround(t)
      .then(setGround)
      .catch((e) => {
        console.error("terrain failed to load", e);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mesh = useGeometry(t, ground);
  useEffect(() => {
    if (mesh) continueRender(handle);
  }, [mesh, handle]);

  const places = validPlaces(scene.places);
  const S = mesh ? Math.max(mesh.W, mesh.H) : 1;
  const route = mesh && t.path && t.path.length > 1 ? t.path.map(([lon, la]) => mesh.at(lon, la).add(new THREE.Vector3(0, 0.02 * S, 0))) : null;
  const f = interpolate(frame, [0, D], [0, 1]);
  const { pos, look } = cameraAt(S, f, route);
  const fov = short ? 62 : 40;
  const far = S * 2.2;
  // the same camera, outside the canvas, to place the pins over their spots on the ground
  const cam = useMemo(() => new THREE.PerspectiveCamera(fov, width / height, 0.05, far), [fov, width, height, far]);
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateMatrixWorld();
  const pins = mesh
    ? places.map((p) => {
        const v = mesh.at(p.lon, p.lat).project(cam);
        return v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 ? [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height] : null;
      })
    : [];
  const at = pinFrames(scene, D);
  const routeLine = useMemo(() => {
    if (!route) return null;
    const curve = new THREE.CatmullRomCurve3(route);
    return new THREE.TubeGeometry(curve, 200, 0.004 * S, 6, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, mesh]);
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(#253a52 0%, ${HAZE} 46%, ${HAZE} 100%)` }}>
      {mesh ? (
        <AbsoluteFill style={{ opacity: fadeIn }}>
          <ThreeCanvas width={width} height={height} gl={{ antialias: true }} camera={{ fov, position: [0, S, S] }}>
            <Rig pos={pos} look={look} fov={fov} far={far} />
            <fog attach="fog" args={[HAZE, pos.distanceTo(look) * 0.75, pos.distanceTo(look) * 1.7]} />
            <ambientLight intensity={1.15} color="#d4deec" />
            <directionalLight position={[-S, S * 0.45, -S * 0.3]} intensity={2.6} color="#fff1dc" />
            <hemisphereLight args={["#b9d2ff", "#3b3127", 0.35]} />
            {/* the ground carried on past what was staged, so its edges melt into the haze instead of ending */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
              <planeGeometry args={[S * 8, S * 8]} />
              <meshStandardMaterial color={t.edge ?? "#0e1c2b"} roughness={1} />
            </mesh>
            <mesh geometry={mesh.geo}>
              <meshStandardMaterial map={ground!.tex} roughness={1} metalness={0} />
            </mesh>
            {routeLine ? (
              <mesh geometry={routeLine}>
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} fog={false} />
              </mesh>
            ) : null}
          </ThreeCanvas>
        </AbsoluteFill>
      ) : null}
      {/* a cool documentary grade and a vignette over the 3D ground */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(rgba(3,8,18,0.35), transparent 25%, transparent 75%, rgba(3,8,18,0.45))" }} />
      {places.map((p, i) => {
        const xy = pins[i];
        if (!xy) return null;
        const anchor = xy[0] < width * 0.3 ? 15 : xy[0] > width * 0.7 ? 85 : 50;
        return <Pin key={i} x={xy[0]} y={xy[1]} anchor={anchor} name={p.name} at={Math.max(at[i], D * 0.25 + i * 8)} fps={fps} theme={theme} k={k} />;
      })}
      {scene.mapCredit ? (
        <div style={{ position: "absolute", left: short ? 40 : 36, bottom: short ? 330 : 26, fontFamily: theme.font, fontSize: short ? 20 : 17, color: "#e2e8f0", opacity: 0.8, textShadow: "0 1px 3px #000" }}>
          {scene.mapCredit}
        </div>
      ) : null}
      <AbsoluteFill style={{ padding: short ? "220px 80px 0" : "60px 160px 0", alignItems: "center" }}>
        <div style={{ padding: "14px 34px", borderRadius: 18, background: `${theme.background}e6` }}>
          <Heading text={scene.heading} theme={theme} format={format} size={52} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
