// The world scene: one 3D scene type whose subject picks a module. Every subject in catalog.json has a
// module here; adding a subject means adding its catalog entry (what it can do, the words that point to
// it) and registering its module below. The pipeline reads the same catalog, so the scriptwriter, the
// visual planner and the fact guards offer it to every video from then on.
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, Subject } from "../../types";
import type { SceneProps } from "../shared";
import { AircraftScene } from "../aircraft";
import { ShipScene } from "../ship";
import { lightningFrames, sceneSeed } from "../world3d";
import { momentOf } from "./kit";
import { LandscapeScene } from "./landscape";
import { TrainScene } from "./train";
import { VehicleScene } from "./vehicle";
import { RocketScene } from "./rocket";
import { SpaceScene } from "./space";
import { CityScene } from "./city";

// The aircraft and ship modules came first, with their own field names; they read the world fields here.
const AircraftModule: React.FC<SceneProps> = (p) => (
  <AircraftScene {...p} scene={{ ...p.scene, maneuver: (p.scene.action ?? p.scene.maneuver ?? "cruise") as Scene["maneuver"] }} />
);
const ShipModule: React.FC<SceneProps> = (p) => (
  <ShipScene
    {...p}
    scene={{
      ...p.scene,
      vessel: (p.scene.variant ?? p.scene.vessel ?? "liner") as Scene["vessel"],
      shipAction: (p.scene.action ?? p.scene.shipAction ?? "sail") as Scene["shipAction"],
      obstacle: p.scene.obstacle as Scene["obstacle"],
    }}
  />
);

export const MODULES: Record<Subject, React.FC<SceneProps>> = {
  aircraft: AircraftModule,
  ship: ShipModule,
  train: TrainScene,
  vehicle: VehicleScene,
  rocket: RocketScene,
  space: SpaceScene,
  city: CityScene,
  landscape: LandscapeScene,
};

// Says on screen what a 3D scene is: a reconstruction of what the narration describes, or an
// illustration where it shows the subject without a documented event.
const Label: React.FC<{ scene: Scene; theme: SceneProps["theme"]; short: boolean }> = ({ scene, theme, short }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 12, fps, config: { damping: 18 } });
  const k = short ? 1.3 : 1;
  return (
    <div
      style={{
        position: "absolute",
        right: short ? 60 : 40,
        top: short ? 130 : 26,
        padding: `${5 * k}px ${12 * k}px`,
        borderRadius: 6,
        background: `${theme.background}b3`,
        color: theme.muted,
        fontFamily: theme.font,
        fontWeight: 700,
        fontSize: 15 * k,
        letterSpacing: 2.5,
        opacity: 0.9 * p,
      }}
    >
      {scene.illustrative ? "ILLUSTRATION" : "RECONSTRUCTION"}
    </div>
  );
};

export const WorldScene: React.FC<SceneProps> = (props) => {
  const Module = MODULES[(props.scene.subject ?? "landscape") as Subject] ?? LandscapeScene;
  return (
    <AbsoluteFill>
      <Module {...props} />
      <Label scene={props.scene} theme={props.theme} short={props.format === "short"} />
    </AbsoluteFill>
  );
};

// Sounds for a world scene, frames from its start: the key moment lands with the sound its action makes.
const SOUNDS: Record<string, [string, number]> = {
  collide: ["boom", 0.9], crash: ["boom", 0.9], derail: ["boom", 0.85], explode: ["boom", 1], impact: ["boom", 1],
  collapse: ["boom", 0.85], erupt: ["boom", 1], explosion: ["boom", 1], bridge_collapse: ["boom", 0.9],
  earthquake: ["thunder", 0.9], tsunami: ["whoosh", 0.9], avalanche: ["thunder", 0.8], launch: ["boom", 0.8],
  separation: ["thud", 0.7], flyby: ["whoosh", 0.7], fire: ["flame", 0.7], wildfire: ["flame", 0.7], sink: ["thud", 0.6],
  capsize: ["thud", 0.6], brake: ["zip", 0.5], flood: ["whoosh", 0.6],
};

export const worldCues = (scene: Scene, len: number, fps: number): { at: number; name: string; gain: number }[] => {
  const cues: { at: number; name: string; gain: number }[] = [];
  const at = Math.round(momentOf(scene) * len);
  const sound = SOUNDS[scene.action ?? ""];
  if (sound) {
    if (scene.action === "launch") cues.push({ at: at - Math.round(fps * 0.8), name: "riser", gain: 0.5 });
    cues.push({ at, name: sound[0], gain: sound[1] });
  }
  if (scene.effect && !sound) cues.push({ at: Math.round((scene.effectAt ?? 0.3) * len), name: scene.effect === "smoke" ? "hit" : "boom", gain: 0.85 });
  if (scene.subject === "aircraft" && scene.altitudeTo != null && scene.landTimes?.length) cues.push({ at: Math.round(scene.landTimes[0] * fps), name: "chime", gain: 0.45 });
  if (scene.weather === "storm") lightningFrames(sceneSeed(scene), len, fps).forEach((f) => cues.push({ at: f + 4, name: "thunder", gain: 0.6 }));
  return cues;
};
