// A library model: a vetted glTF from renderer/public/models (fyt/assets.py copies it into the job), used
// in place of a module's procedural model when one exists for the exact object. It is turned to face +x,
// scaled to the length the module frames, and given the cel materials so it sits in the same style.
// If it fails to load, the module's own procedural model is drawn instead, and the render goes on.
import React, { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelRef } from "../../types";
import { outlineMaterial, toonRamp } from "../world3d";

const loads = new Map<string, Promise<THREE.Object3D>>();

const load = (src: string) => {
  let p = loads.get(src);
  if (!p) {
    p = new GLTFLoader().loadAsync(staticFile(src)).then((g) => g.scene);
    loads.set(src, p);
  }
  return p;
};

const useLibrary = (src: string | undefined) => {
  const [state, setState] = useState<{ obj: THREE.Object3D | null; failed: boolean }>({ obj: null, failed: false });
  const [handle] = useState(() => (src ? delayRender(`loading model ${src}`) : null));
  useEffect(() => {
    if (!src) return;
    load(src)
      .then((obj) => setState({ obj, failed: false }))
      .catch((e) => {
        console.error(`model ${src} failed to load: ${e}`);
        setState({ obj: null, failed: true });
      })
      .finally(() => handle !== null && continueRender(handle));
  }, [src, handle]);
  return state;
};

// Turn the model so its nose points along +x and its top along +y, then fit its length.
const fitted = (obj: THREE.Object3D, model: ModelRef, length: number, ground: boolean) => {
  const o = obj.clone(true);
  const fit = model.fit ?? {};
  const turn = new THREE.Group();
  turn.add(o);
  if (fit.up === "+z") o.rotation.x = -Math.PI / 2;
  const yaw = { "+x": 0, "-x": Math.PI, "+z": Math.PI / 2, "-z": -Math.PI / 2 }[fit.forward ?? "+x"];
  turn.rotation.y = yaw;
  const ink = outlineMaterial(0.02);
  const meshes: THREE.Mesh[] = [];
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh);
  });
  meshes.forEach((mesh) => { // collected first: the outlines added here are meshes too
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshToonMaterial({ color: old?.color ?? new THREE.Color("#d9dde3"), map: old?.map ?? null, gradientMap: toonRamp });
    if (mesh.geometry.attributes.normal) mesh.add(new THREE.Mesh(mesh.geometry, ink));
  });
  const outer = new THREE.Group();
  outer.add(turn);
  const box = new THREE.Box3().setFromObject(outer);
  const size = box.getSize(new THREE.Vector3());
  const k = length / Math.max(1e-6, size.x);
  outer.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  outer.position.set(-c.x, ground ? -box.min.y * k : -c.y, -c.z);
  const root = new THREE.Group();
  root.add(outer);
  return root;
};

export const LibraryModel: React.FC<{ model: ModelRef; length: number; ground?: boolean; fallback: React.ReactNode }> = ({ model, length, ground = false, fallback }) => {
  const { obj, failed } = useLibrary(model.src);
  const object = useMemo(() => (obj ? fitted(obj, model, length, ground) : null), [obj, model, length, ground]);
  if (failed || !model.src) return <>{fallback}</>;
  return object ? <primitive object={object} /> : null;
};

// The library model when the scene has one, else the module's own.
export const Modelled: React.FC<{ model?: ModelRef | null; length: number; ground?: boolean; children: React.ReactNode }> = ({ model, length, ground, children }) =>
  model?.level === "library" && model.src ? <LibraryModel model={model} length={length} ground={ground} fallback={children} /> : <>{children}</>;
