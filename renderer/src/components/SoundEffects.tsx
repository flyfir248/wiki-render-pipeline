// Sound effects timed to the animation: a whoosh on the livelier scene changes, a pop as a pin drops
// or a prop appears, a boom or a crack of thunder with the effect, a chime when a figure lands and
// a thud for a document's stamp. The sounds themselves are written by fyt/sfx.py.
import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { effectStart, actorStart } from "../scenes/story";
import { pinFrames } from "../scenes/map";
import { sceneSpans, shownType, transitionOf } from "../scenes";
import { motionCues, statLands } from "../scenes/motion";
import { lightningFrames, sceneSeed } from "../scenes/world3d";
import { worldCues } from "../scenes/world";
import type { Scene } from "../types";

type Cue = { at: number; name: string; gain: number };

const EFFECT_SOUNDS: Record<string, [string, number]> = {
  explosion: ["boom", 1],
  lightning: ["thunder", 0.9],
  fire: ["flame", 0.8],
  sparkles: ["sparkle", 0.8],
  smoke: ["whoosh", 0.5],
};

export const cuesFor = (scenes: Scene[], fps: number): Cue[] => {
  const cues: Cue[] = [];
  const spans = sceneSpans(scenes, fps);
  scenes.forEach((scene, i) => {
    const { from, len } = spans[i];
    const transition = transitionOf(scene);
    // A gentle fade needs no sound; the moving transitions get a whoosh as they start, and the red
    // thread the zip of string pulled through fingers.
    const enter = transition === "flash" ? "thud" : transition === "thread" ? "zip" : "whoosh";
    if (scene.id !== "s1" && transition !== "fade") cues.push({ at: from - (transition === "thread" ? 1 : 4), name: enter, gain: 0.6 });
    // The hook opens on a hit, so the first frame lands with weight, and so does each chapter card.
    if (scene.chapter) cues.push({ at: from + 2, name: "hit", gain: 0.55 });
    if (scene.id === "s1") cues.push({ at: 0, name: "hit", gain: 0.7 });
    motionCues(scene, len, fps).forEach((c) => cues.push({ ...c, at: from + c.at }));
    const type = shownType(scene); // no pops or booms for art or pins that never appear
    if (type === "map" && scene.globe) cues.push({ at: from + Math.round(len * 0.18), name: "whoosh", gain: 0.9 }); // the dive
    if (type === "map") pinFrames(scene, len).forEach((f) => cues.push({ at: from + Math.round(f), name: "pop", gain: 0.8 }));
    if (type === "story") {
      (scene.actors ?? [])
        .filter((a) => a.src)
        .slice(0, 3)
        .forEach((a) => cues.push({ at: from + actorStart(a, len), name: "pop", gain: 0.6 }));
      const sound = scene.effect ? EFFECT_SOUNDS[scene.effect] : undefined;
      if (sound) cues.push({ at: from + effectStart(scene, len), name: sound[0], gain: sound[1] });
    }
    if (type === "aircraft") {
      // An engine strike lands with a bang, and the altitude readout with a chime as its figure is said.
      if (scene.effect) cues.push({ at: from + Math.round((scene.effectAt ?? 0.25) * len), name: scene.effect === "smoke" ? "hit" : "boom", gain: 0.9 });
      if (scene.altitudeTo != null && scene.landTimes?.length) cues.push({ at: from + Math.round(scene.landTimes[0] * fps), name: "chime", gain: 0.45 });
    }
    if (type === "ship") {
      // A collision lands with a bang; an explosion on deck with a boom.
      const at = Math.round((scene.effectAt ?? (scene.shipAction === "collide" ? 0.45 : 0.3)) * len);
      if (scene.shipAction === "collide") cues.push({ at: from + at, name: "boom", gain: 0.9 });
      else if (scene.effect === "explosion" || scene.effect === "fire") cues.push({ at: from + at, name: "boom", gain: 0.85 });
    }
    if (type === "world") worldCues(scene, len, fps).forEach((c) => cues.push({ ...c, at: from + c.at }));
    if ((type === "aircraft" || type === "ship") && scene.weather === "storm") {
      lightningFrames(sceneSeed(scene), len, fps).forEach((f) => cues.push({ at: from + f + 4, name: "thunder", gain: 0.6 }));
    }
    if (scene.type === "stat" && scene.value != null) {
      const lands = Math.max(20, statLands(scene, len, fps));
      cues.push({ at: from + lands - Math.round(fps * 0.8), name: "riser", gain: 0.45 });
      cues.push({ at: from + lands, name: "hit", gain: 0.8 });
    }
    if (scene.type === "document" && scene.author) cues.push({ at: from + Math.round(len * 0.55), name: "thud", gain: 0.8 });
  });
  // Never stack two sounds within a few frames of each other: the first one wins.
  return cues
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)
    .filter((c, i, all) => i === 0 || c.at - all[i - 1].at >= 6 || (c.name === "hit" && all[i - 1].name !== "hit"));
};

export const SoundEffects: React.FC<{ scenes: Scene[]; fps: number; dir: string; volume: number }> = ({ scenes, fps, dir, volume }) => (
  <>
    {cuesFor(scenes, fps).map((c, i) => (
      <Sequence key={i} from={c.at} name={`sfx:${c.name}`} layout="none">
        <Audio src={staticFile(`${dir}/${c.name}.wav`)} volume={volume * c.gain} />
      </Sequence>
    ))}
  </>
);
