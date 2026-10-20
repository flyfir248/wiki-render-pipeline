// Proof of concept: the two reference looks built from code, no downloaded models.
// Shot A "blocky town": box people, box city, golden-hour light, a counter HUD and serif captions.
// Shot B "night diorama": dark fogged terrain, a lattice tower, a phone in a hand with a live screen,
// a signal beam and a wireframe coverage dome, with chip labels and word-by-word captions.
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React, { useMemo } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import * as THREE from "three";

const FPS = 30;
const lerp = (f: number, a: number, b: number, from: number, to: number, ease = true) =>
  interpolate(f, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease ? Easing.inOut(Easing.cubic) : undefined,
  });

// ---------------------------------------------------------------- the box person

type Look = { skin: string; shirt: string; pants: string; hair: string; shoes?: string; hat?: string };
type Pose = "walk" | "sit" | "stand" | "phone" | "wave";

const Box: React.FC<{ p?: [number, number, number]; s: [number, number, number]; c: string; r?: [number, number, number]; e?: number }> = ({
  p = [0, 0, 0],
  s,
  c,
  r = [0, 0, 0],
  e = 0,
}) => (
  <mesh position={p} rotation={r} castShadow receiveShadow>
    <boxGeometry args={s} />
    <meshStandardMaterial color={c} roughness={0.85} emissive={c} emissiveIntensity={e} flatShading />
  </mesh>
);

// A person is about 1.8 units tall; every limb hangs from a pivot so a pose is a handful of angles.
const Person: React.FC<{ look: Look; pose: Pose; t: number; position?: [number, number, number]; rotY?: number }> = ({
  look,
  pose,
  t,
  position = [0, 0, 0],
  rotY = 0,
}) => {
  const swing = pose === "walk" ? Math.sin(t * 7) * 0.6 : 0;
  const bob = pose === "walk" ? Math.abs(Math.cos(t * 7)) * 0.05 : 0;
  const sit = pose === "sit";
  const hip = sit ? 0.5 : 0.9;
  const legX = sit ? -Math.PI / 2 : 0;
  const headDown = pose === "phone" ? 0.45 : 0;
  const armL = pose === "phone" ? -1.1 : pose === "wave" ? 0 : -swing;
  const armR = pose === "phone" ? -1.1 : pose === "wave" ? -2.7 + Math.sin(t * 10) * 0.35 : swing;
  const armRz = pose === "wave" ? -0.25 : 0;
  return (
    <group position={[position[0], position[1] + bob, position[2]]} rotation={[0, rotY, 0]}>
      {[-0.13, 0.13].map((x, i) => (
        <group key={i} position={[x, hip, 0]} rotation={[legX + (i ? swing : -swing), 0, 0]}>
          <Box p={[0, -0.4, 0]} s={[0.22, 0.8, 0.24]} c={look.pants} />
          <Box p={[0, -0.84, 0.04]} s={[0.24, 0.1, 0.32]} c={look.shoes ?? "#2a2a2e"} />
        </group>
      ))}
      <Box p={[0, hip + 0.35, 0]} s={[0.52, 0.72, 0.3]} c={look.shirt} />
      {[-0.34, 0.34].map((x, i) => (
        <group key={i} position={[x, hip + 0.66, 0]} rotation={[i ? armR : armL, 0, i ? armRz : 0]}>
          <Box p={[0, -0.3, 0]} s={[0.17, 0.62, 0.2]} c={look.shirt} />
          <Box p={[0, -0.66, 0]} s={[0.15, 0.12, 0.17]} c={look.skin} />
        </group>
      ))}
      <group position={[0, hip + 0.74, 0]} rotation={[headDown, Math.sin(t * 0.9) * 0.08, 0]}>
        <Box p={[0, 0.24, 0]} s={[0.4, 0.42, 0.38]} c={look.skin} />
        <Box p={[0, 0.47, -0.02]} s={[0.43, 0.1, 0.42]} c={look.hair} />
        <Box p={[0, 0.34, -0.19]} s={[0.43, 0.32, 0.06]} c={look.hair} />
        {[-0.09, 0.09].map((x) => (
          <Box key={x} p={[x, 0.27, 0.195]} s={[0.06, 0.07, 0.01]} c="#111" />
        ))}
        <Box p={[0, 0.14, 0.195]} s={[0.14, 0.03, 0.01]} c="#5a2c25" />
        {look.hat ? <Box p={[0, 0.56, 0.03]} s={[0.46, 0.12, 0.52]} c={look.hat} /> : null}
      </group>
      {pose === "phone" ? (
        <group position={[0, hip + 0.32, 0.42]} rotation={[-0.9, 0, 0]}>
          <Box s={[0.18, 0.3, 0.03]} c="#1b1b20" />
          <Box p={[0, 0, 0.017]} s={[0.15, 0.26, 0.005]} c="#9fd3ff" e={1.4} />
        </group>
      ) : null}
    </group>
  );
};

const LOOKS: Look[] = [
  { skin: "#e8b48f", shirt: "#e8a019", pants: "#3c4f80", hair: "#3a2a20", hat: "#c9a76a" },
  { skin: "#7a4b32", shirt: "#e8457a", pants: "#2c3550", hair: "#14110f" },
  { skin: "#c58c62", shirt: "#3976c9", pants: "#2a2a35", hair: "#20160f" },
  { skin: "#f0c6a2", shirt: "#5bbf6a", pants: "#59472e", hair: "#b8862e" },
  { skin: "#5c3a26", shirt: "#d94a3a", pants: "#1f2b3f", hair: "#0d0b0a" },
  { skin: "#e3a77f", shirt: "#8d5ad1", pants: "#3a3a3a", hair: "#5a3220" },
];

// ---------------------------------------------------------------- the box town

function windowTexture(base: string, lit: string, seed: number) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 12; y < 250; y += 28)
    for (let x = 10; x < 120; x += 28) {
      g.fillStyle = rnd() > 0.7 ? lit : "#2b3442";
      g.fillRect(x, y, 16, 18);
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(x, y + 18, 16, 2);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const Building: React.FC<{ p: [number, number, number]; s: [number, number, number]; color: string; seed: number }> = ({ p, s, color, seed }) => {
  const tex = useMemo(() => {
    const t = windowTexture(color, "#ffd98a", seed);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(s[0] / 3)), Math.max(1, Math.round(s[1] / 6)));
    return t;
  }, [color, seed, s]);
  return (
    <mesh position={[p[0], p[1] + s[1] / 2, p[2]]} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial map={tex} roughness={0.9} />
    </mesh>
  );
};

const Tree: React.FC<{ p: [number, number, number]; k?: number }> = ({ p, k = 1 }) => (
  <group position={p} scale={k}>
    <Box p={[0, 0.9, 0]} s={[0.35, 1.8, 0.35]} c="#6b4a2e" />
    <Box p={[0, 2.4, 0]} s={[2.0, 1.4, 2.0]} c="#3f8f3a" />
    <Box p={[0.3, 3.3, -0.2]} s={[1.4, 1.0, 1.4]} c="#4ea446" />
    <Box p={[-0.5, 2.1, 0.6]} s={[1.0, 0.9, 1.0]} c="#367d33" />
  </group>
);

const Bench: React.FC<{ p: [number, number, number] }> = ({ p }) => (
  <group position={p}>
    <Box p={[0, 0.48, 0]} s={[2.4, 0.08, 0.6]} c="#8a5a33" />
    <Box p={[0, 0.9, -0.3]} s={[2.4, 0.5, 0.08]} c="#8a5a33" />
    {[-1.05, 1.05].map((x) => (
      <Box key={x} p={[x, 0.24, 0]} s={[0.1, 0.48, 0.55]} c="#2f2f33" />
    ))}
  </group>
);

const Taxi: React.FC<{ p: [number, number, number]; rotY?: number }> = ({ p, rotY = 0 }) => (
  <group position={p} rotation={[0, rotY, 0]}>
    <Box p={[0, 0.45, 0]} s={[1.8, 0.5, 3.6]} c="#f2c230" />
    <Box p={[0, 0.9, -0.2]} s={[1.6, 0.45, 1.9]} c="#f2c230" />
    <Box p={[0, 0.9, -0.2]} s={[1.62, 0.32, 1.7]} c="#2b3a4c" />
    {[-0.85, 0.85].flatMap((x) => [-1.1, 1.1].map((z) => <Box key={`${x}${z}`} p={[x, 0.22, z]} s={[0.2, 0.44, 0.6]} c="#151515" />))}
  </group>
);

const Town: React.FC<{ t: number }> = ({ t }) => {
  const buildings = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; color: string; seed: number }[] = [];
    const cols = ["#c98e6b", "#e1d3b8", "#9fa7b5", "#b9705a", "#d8c08f", "#8e9bb0"];
    let k = 1;
    for (const side of [-1, 1])
      for (let z = 12; z > -80; z -= 7.5) {
        const h = 8 + ((k * 37) % 17);
        out.push({ p: [side * 13, 0, z], s: [8, h, 7], color: cols[k % cols.length], seed: k * 13 });
        k++;
      }
    return out;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 200]} />
        <meshStandardMaterial color="#353a46" roughness={1} />
      </mesh>
      {[-1, 1].map((side) => (
        <Box key={side} p={[side * 6.5, 0.12, -30]} s={[5, 0.24, 200]} c="#9c978e" />
      ))}
      {Array.from({ length: 20 }, (_, i) => (
        <Box key={i} p={[0, 0.02, 10 - i * 6]} s={[0.25, 0.02, 2.5]} c="#e8e2c8" />
      ))}
      {buildings.map((b, i) => (
        <Building key={i} {...b} />
      ))}
      {[-8, -22, -36, -50].map((z, i) => (
        <Tree key={z} p={[i % 2 ? 7.5 : -7.5, 0.24, z]} k={0.9} />
      ))}
      <Taxi p={[2.2, 0, -20 + t * 6]} rotY={Math.PI} />
      <Taxi p={[-2.2, 0, -45 - t * 4]} />
    </group>
  );
};

const TownShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / FPS;
  // A single dolly: down the pavement behind a walker with their head in their phone, then round to the bench.
  const camZ = lerp(frame, 0, 165, 9, -4.2);
  const camX = lerp(frame, 60, 165, 6.4, 3.4);
  const camY = lerp(frame, 0, 165, 2.6, 1.7);
  const look = new THREE.Vector3(lerp(frame, 60, 165, 6.5, 7.6), lerp(frame, 60, 165, 1.2, 1.1), lerp(frame, 0, 165, 2, -9.2));
  return (
    <ThreeCanvas width={width} height={height} camera={{ fov: 50, position: [camX, camY, camZ] }} gl={{ antialias: true }} shadows>
      <CamSet pos={[camX, camY, camZ]} look={look} />
      <color attach="background" args={["#f2b880"]} />
      <fog attach="fog" args={["#f1b27a", 18, 75]} />
      <hemisphereLight args={["#ffd9b0", "#46506a", 0.9]} />
      <directionalLight
        position={[-18, 14, -30]}
        intensity={2.4}
        color="#ffb36b"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={120}
      />
      <Town t={t} />
      <Person look={LOOKS[2]} pose="phone" t={t} position={[6.3, 0.24, 2 - t * 1.1]} rotY={Math.PI} />
      <Person look={LOOKS[3]} pose="walk" t={t + 1} position={[5.2, 0.24, -12 - t * 1.3]} rotY={Math.PI} />
      <Person look={LOOKS[5]} pose="phone" t={t} position={[8.2, 0.24, -16]} rotY={-0.6} />
      <Person look={LOOKS[4]} pose="phone" t={t} position={[5.0, 0.24, -24]} rotY={0.3} />
      <Bench p={[7.6, 0.24, -9]} />
      <group rotation={[0, -Math.PI / 2, 0]} position={[7.6, 0.24, -9]}>
        <Person look={LOOKS[0]} pose="sit" t={t} position={[-0.55, 0, 0.1]} />
        <Person look={LOOKS[1]} pose={frame > 120 ? "wave" : "sit"} t={t} position={[0.55, 0, 0.1]} />
      </group>
    </ThreeCanvas>
  );
};

const CamSet: React.FC<{ pos: [number, number, number]; look: THREE.Vector3 }> = ({ pos, look }) => {
  const camera = useThree((s) => s.camera);
  camera.position.set(...pos);
  camera.lookAt(look);
  return null;
};

// ---------------------------------------------------------------- the night diorama

function terrain() {
  const g = new THREE.PlaneGeometry(160, 160, 80, 80);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const far = Math.max(0, y - 30) / 35;
    pos.setZ(i, Math.sin(x * 0.07) * 0.35 + Math.cos(y * 0.05 + x * 0.03) * 0.4 - 0.4 + far * far * 14 * (0.6 + 0.4 * Math.sin(x * 0.05)));
  }
  g.computeVertexNormals();
  return g;
}

const Tower: React.FC<{ p: [number, number, number]; blink: number; h?: number }> = ({ p, blink, h = 14 }) => {
  const steel = "#7d8794";
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return (
    <group position={p}>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x * 0.6, h / 2, z * 0.6]} rotation={[z * 0.06, 0, -x * 0.06]} castShadow>
          <boxGeometry args={[0.12, h, 0.12]} />
          <meshStandardMaterial color={steel} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {Array.from({ length: Math.floor(h / 1.5) }, (_, k) => {
        const y = 1 + k * 1.5;
        const w = 1.25 * (1 - (y / h) * 0.75);
        return (
          <group key={k} position={[0, y, 0]}>
            {[0, Math.PI / 2].map((r) => (
              <mesh key={r} rotation={[0, r, Math.PI / 4]}>
                <boxGeometry args={[w * 1.9, 0.05, 0.05]} />
                <meshStandardMaterial color={steel} />
              </mesh>
            ))}
          </group>
        );
      })}
      {[0, 1, 2].map((k) => (
        <Box key={k} p={[Math.cos(k * 2.1) * 0.45, h - 1, Math.sin(k * 2.1) * 0.45]} r={[0, -k * 2.1, 0]} s={[0.25, 1.4, 0.1]} c="#c9ced6" />
      ))}
      <mesh position={[0, h + 0.3, 0]}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshBasicMaterial color={new THREE.Color("#ff2d2d").multiplyScalar(0.3 + blink * 1.6)} toneMapped={false} />
      </mesh>
      <pointLight position={[0, h + 0.3, 0]} color="#ff3030" intensity={blink * 14} distance={10} />
    </group>
  );
};

function useScreen(frame: number) {
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 760;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [canvas]);
  const g = canvas.getContext("2d")!;
  const calling = frame > 75;
  const grd = g.createLinearGradient(0, 0, 0, 760);
  grd.addColorStop(0, "#2a2f3c");
  grd.addColorStop(1, "#11141b");
  g.fillStyle = grd;
  g.fillRect(0, 0, 360, 760);
  g.fillStyle = "#000";
  g.beginPath();
  g.roundRect(120, 18, 120, 34, 17);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "600 22px Inter, Arial";
  g.fillText("11:47", 34, 44);
  g.textAlign = "right";
  g.fillText(calling ? "SOS" : "No Service", 326, 44);
  g.textAlign = "center";
  if (!calling) {
    g.font = "300 28px Inter, Arial";
    g.fillStyle = "#c8ccd6";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
    keys.forEach((k, i) => {
      const x = 90 + (i % 3) * 90;
      const y = 250 + Math.floor(i / 3) * 95;
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.beginPath();
      g.arc(x, y, 36, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.fillText(k, x, y + 10);
    });
    g.font = "600 46px Inter, Arial";
    g.fillText("911".slice(0, Math.min(3, Math.floor(frame / 15))), 180, 150);
  } else {
    g.font = "500 22px Inter, Arial";
    g.fillStyle = "#9aa3b2";
    g.fillText(frame > 110 ? "connected" : "calling…", 180, 150);
    g.fillStyle = "#fff";
    g.font = "700 40px Inter, Arial";
    g.fillText("Emergency Call", 180, 200);
    if (frame > 110) {
      g.fillStyle = "#33d17a";
      g.font = "600 30px Inter, Arial";
      const s = Math.floor((frame - 110) / 30);
      g.fillText(`00:0${s}`, 180, 245);
    }
    ["mute", "keypad", "speaker"].forEach((k, i) => {
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.beginPath();
      g.arc(90 + i * 90, 420, 36, 0, Math.PI * 2);
      g.fill();
    });
  }
  g.fillStyle = "#ff3b30";
  g.beginPath();
  g.arc(180, 650, 40, 0, Math.PI * 2);
  g.fill();
  tex.needsUpdate = true;
  return tex;
}

const PhoneInHand: React.FC<{ frame: number }> = ({ frame }) => {
  const screen = useScreen(frame);
  const skin = "#e2b08c";
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.76, 1.56, 0.08]} />
        <meshStandardMaterial color="#202228" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.042]}>
        <planeGeometry args={[0.7, 1.48]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      {/* a blocky hand: palm behind, thumb on the side, four fingers round the far edge */}
      <Box p={[0.04, -0.42, -0.12]} s={[0.62, 0.7, 0.16]} c={skin} />
      <Box p={[-0.4, -0.28, 0.02]} s={[0.13, 0.42, 0.15]} c={skin} r={[0, 0, -0.35]} />
      {[0.12, -0.08, -0.28, -0.48].map((y) => (
        <Box key={y} p={[0.4, y, 0.03]} s={[0.1, 0.16, 0.14]} c={skin} />
      ))}
      <Box p={[0.06, -1.05, -0.14]} s={[0.56, 0.6, 0.3]} c="#2b3142" />
    </group>
  );
};

const NightShot: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / FPS;
  const ground = useMemo(terrain, []);
  const blink = Math.max(0, Math.sin(t * 5)) ** 3;
  const tower = new THREE.Vector3(7, 0, -20);
  // Push in behind the phone, then rise and swing wide so the tower and its coverage read.
  const camPos: [number, number, number] = [lerp(frame, 0, 180, -0.2, -2.4), lerp(frame, 0, 180, 2.2, 2.6), lerp(frame, 0, 180, 3.4, 6.2)];
  const look = new THREE.Vector3(lerp(frame, 0, 180, 0.2, 3.0), lerp(frame, 0, 180, 1.2, 4.0), lerp(frame, 0, 180, -3, -14));
  const beam = lerp(frame, 110, 140, 0, 1);
  const dome = lerp(frame, 130, 175, 0, 1);
  const phonePos = new THREE.Vector3(0, 1.6, 0);
  const dir = new THREE.Vector3().subVectors(tower.clone().setY(14), phonePos);
  const len = dir.length();
  const mid = phonePos.clone().addScaledVector(dir, 0.5 * beam);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return (
    <ThreeCanvas width={width} height={height} camera={{ fov: 45, position: camPos }} gl={{ antialias: true }} shadows>
      <CamSet pos={camPos} look={look} />
      <color attach="background" args={["#3b475c"]} />
      <fog attach="fog" args={["#3b475c", 14, 110]} />
      <hemisphereLight args={["#8fa3c8", "#1a2230", 1.3]} />
      <directionalLight position={[-20, 25, -10]} intensity={1.1} color="#b9c9ea" castShadow />
      <directionalLight position={[-2, 4, 8]} intensity={1.4} color="#d6dcf0" />
      <pointLight position={[0.2, 2.2, 1.0]} intensity={2.2} distance={4} color="#9fc4ff" />
      <mesh geometry={ground} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#3e5048" roughness={1} flatShading />
      </mesh>
      {/* fence posts and a parked car for scale */}
      {Array.from({ length: 14 }, (_, i) => (
        <Box key={i} p={[-14 + i * 2.2, 0.9, -9]} s={[0.12, 1.4, 0.12]} c="#5a5146" />
      ))}
      <group position={[-3.5, 0.6, -2.5]} rotation={[0, 0.5, 0]}>
        <Box p={[0, 0.3, 0]} s={[2.0, 0.7, 4.2]} c="#c9ccd2" />
        <Box p={[0, 0.85, -0.3]} s={[1.8, 0.55, 2.2]} c="#c9ccd2" />
        <Box p={[0, 0.85, -0.3]} s={[1.82, 0.4, 2.0]} c="#1c2430" />
        <Box p={[0.6, 0.35, 2.12]} s={[0.4, 0.2, 0.05]} c="#fff6d8" e={2} />
        <Box p={[-0.6, 0.35, 2.12]} s={[0.4, 0.2, 0.05]} c="#fff6d8" e={2} />
      </group>
      <Tower p={[tower.x, 0, tower.z]} blink={blink} />
      <group position={[phonePos.x + 0.2, phonePos.y, phonePos.z]} rotation={[-0.15, -0.2, 0.06]}>
        <PhoneInHand frame={frame} />
      </group>
      {beam > 0 ? (
        <mesh position={mid} quaternion={quat}>
          <cylinderGeometry args={[0.04, 0.04, len * beam, 8]} />
          <meshBasicMaterial color="#ff4a4a" toneMapped={false} transparent opacity={0.9} />
        </mesh>
      ) : null}
      {dome > 0 ? (
        <mesh position={[tower.x, 0, tower.z]} scale={dome * 26}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color="#ff9a2e" wireframe transparent opacity={0.45} toneMapped={false} />
        </mesh>
      ) : null}
    </ThreeCanvas>
  );
};

// ---------------------------------------------------------------- overlays

const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  const mins = Math.round(lerp(frame, 0, 165, 30, 62, false));
  return (
    <div style={{ position: "absolute", left: 56, top: 120, color: "#fff", fontFamily: "Georgia, serif", textShadow: "0 2px 10px rgba(0,0,0,.35)" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ width: 70, height: 5, background: i === 0 ? "#f2c45a" : "rgba(255,255,255,.45)" }} />
        ))}
      </div>
      <div style={{ font: "700 34px Inter, Arial", letterSpacing: 2 }}>DAY 1</div>
      <div style={{ font: "600 20px Inter, Arial", letterSpacing: 3, opacity: 0.9, marginTop: 6 }}>SCREEN TIME HANDED BACK</div>
      <div style={{ fontSize: 92, lineHeight: 1.05 }}>
        {Math.floor(mins / 60)} h {String(mins % 60).padStart(2, "0")} min
      </div>
    </div>
  );
};

const SerifCaption: React.FC<{ lines: [number, string][] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  const cur = [...lines].reverse().find(([f]) => frame >= f);
  if (!cur) return null;
  const o = lerp(frame, cur[0], cur[0] + 8, 0, 1);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top: 1180, textAlign: "center", color: "#fff", opacity: o, font: "italic 54px Georgia, serif", textShadow: "0 3px 14px rgba(0,0,0,.6)" }}>
      {cur[1]}
    </div>
  );
};

const Chip: React.FC<{ x: number; y: number; text: string; dot: string; from: number }> = ({ x, y, text, dot, from }) => {
  const frame = useCurrentFrame();
  const o = lerp(frame, from, from + 10, 0, 1);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: o, transform: `translateY(${(1 - o) * 12}px)`, display: "flex", alignItems: "center", gap: 10, background: "rgba(12,14,20,.82)", color: "#fff", padding: "10px 18px", borderRadius: 30, font: "700 24px Inter, Arial", letterSpacing: 2 }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: dot }} />
      {text}
    </div>
  );
};

const WordCaption: React.FC<{ words: [number, string][] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const shown = words.filter(([f]) => frame >= f);
  const group = shown.slice(Math.floor((shown.length - 1) / 2) * 2);
  if (!group.length) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 1480, display: "flex", justifyContent: "center", gap: 18 }}>
      {group.map(([f, w], i) => (
        <span key={f} style={{ font: "800 66px Inter, Arial", color: "#fff", background: "rgba(10,12,18,.8)", padding: "6px 18px", borderRadius: 12, borderBottom: i === group.length - 1 ? "5px solid #fff" : "none" }}>
          {w}
        </span>
      ))}
    </div>
  );
};

export const BlockyPoc: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Sequence durationInFrames={165}>
      <TownShot />
      <Hud />
      <SerifCaption
        lines={[
          [5, "Heads still down. Out of habit."],
          [80, "Same bench. She finally looked up."],
        ]}
      />
    </Sequence>
    <Sequence from={165} durationInFrames={180}>
      <NightShot />
      <Chip x={60} y={110} text="NO SERVICE" dot="#ff3b30" from={0} />
      <Chip x={60} y={180} text="ANOTHER CARRIER" dot="#ff9a2e" from={130} />
      <WordCaption
        words={[
          [0, "Zero"],
          [12, "bars."],
          [40, "Dial"],
          [52, "911"],
          [85, "anyway."],
          [110, "Another"],
          [122, "carrier's"],
          [140, "tower"],
          [150, "answers."],
        ]}
      />
    </Sequence>
  </AbsoluteFill>
);
