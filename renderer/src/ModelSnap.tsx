// A model seen from its side, turned the way the stage would turn it, for the orientation check
// (fyt/assetlib.py `orient`): with its front at +x it points to the right of the picture. `flip` turns
// it half round first, so the check can ask the same question of both ends.
import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { prepare, useModel, type Loaded } from "./scenes/world/stage";

export type ModelSnapProps = { src: string; forward: string; up: string; flip: boolean };

const Side: React.FC<{ model: Loaded; forward: string; up: string; flip: boolean }> = ({ model, forward, up, flip }) => {
  const { camera } = useThree();
  const made = useMemo(() => prepare(model, forward, up, { envMap: null, intensity: 1 }), [model, forward, up]);
  const s = made.size;
  const fov = 30;
  // far enough back that its length fills about four fifths of the frame and its height fits, side-on
  const half = Math.tan(((fov / 2) * Math.PI) / 180);
  const d = Math.max(s.x / 0.8 / 2 / (half * (16 / 9)), s.y / 0.75 / 2 / half) + s.z / 2;
  const cam = camera as THREE.PerspectiveCamera;
  cam.fov = fov;
  cam.position.set(0, s.y * 0.6, d);
  cam.lookAt(0, s.y * 0.45, 0);
  cam.updateProjectionMatrix();
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[3, 8, 6]} intensity={2} />
      <directionalLight position={[-4, 3, -5]} intensity={0.7} />
      <group rotation={[0, flip ? Math.PI : 0, 0]}>
        <primitive object={made.root} />
      </group>
    </>
  );
};

export const ModelSnap: React.FC<ModelSnapProps> = ({ src, forward, up, flip }) => {
  const { model } = useModel(src);
  return (
    <AbsoluteFill style={{ background: "#dfe6ee" }}>
      {model ? (
        <ThreeCanvas width={960} height={540} camera={{ fov: 30, position: [0, 2, 12] }} gl={{ antialias: true }}>
          <Side model={model} forward={forward} up={up} flip={flip} />
        </ThreeCanvas>
      ) : null}
    </AbsoluteFill>
  );
};
