// Sun shadows for the catalog's 3D modules (aircraft, ships, trains, cities, landscapes...), which were
// drawn without any: a plane over a runway or a train on its track looked pasted on. Placed inside a
// ThreeCanvas after the module, it makes the strongest directional light cast shadows over what the
// camera is looking at, and every solid mesh cast and receive them.
//
// The shadow map is fitted each frame round what the camera is looking at, so it stays sharp whatever
// the module's scale.
import React from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const solid = (m: THREE.Material) =>
  !m.transparent && m.side !== THREE.BackSide && !(m instanceof THREE.MeshBasicMaterial) && !(m instanceof THREE.ShaderMaterial) && !(m instanceof THREE.SpriteMaterial);

export const SunShadows: React.FC<{ mapSize?: number }> = ({ mapSize = 2048 }) => {
  const { gl, scene, camera } = useThree();
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  useFrame(() => {
    let sun: THREE.DirectionalLight | null = null;
    scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight && (!sun || o.intensity > sun.intensity)) sun = o;
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const ok = mats.every(solid);
        // the very large things (sky domes, the ground plane, far hills) only receive
        const big = o.geometry.boundingSphere?.radius ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere?.radius ?? 0);
        const scale = o.getWorldScale(new THREE.Vector3());
        const r = big * Math.max(scale.x, scale.y, scale.z);
        o.castShadow = ok && r < 120;
        o.receiveShadow = ok;
      }
    });
    if (!sun) return;
    const light = sun as THREE.DirectionalLight;
    // what the camera is looking at: modules frame their subject round the origin, so the point on
    // the line of sight as far away as the origin is
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const pos = camera.getWorldPosition(new THREE.Vector3());
    const t = Math.max(8, Math.min(400, pos.length()));
    const focus = pos.clone().add(dir.multiplyScalar(t));
    const reach = Math.max(10, Math.min(260, t * 0.8));
    // the sun's direction as the module set it (its light aimed at the origin), kept from the first frame
    if (!light.userData.toSun) light.userData.toSun = light.position.clone().sub(new THREE.Vector3()).normalize();
    const toSun = (light.userData.toSun as THREE.Vector3).clone();
    light.target.position.copy(focus);
    light.position.copy(focus.clone().add(toSun.multiplyScalar(reach * 3)));
    if (!light.target.parent) scene.add(light.target);
    light.target.updateMatrixWorld();
    light.castShadow = true;
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 0.5;
    cam.far = reach * 6;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = reach * 0.0015;
    light.shadow.radius = 3;
  });
  return null;
};
