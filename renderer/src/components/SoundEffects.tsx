// Sound effects timed to the animation: a whoosh on the livelier scene changes, a pop as a pin drops
// or a prop appears, a boom or a crack of thunder with the effect, a chime when a figure lands and
// a thud for a document's stamp. The sounds themselves are written by fyt/sfx.py.
import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { effectStart, actorStart } from "../scenes/story";
import { pinFrames } from "../scenes/map";
import { shownType, transitionOf } from "../scenes";
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
  for (const scene of scenes) {
    const from = Math.round(scene.start * fps);
    const len = Math.max(1, Math.round(scene.end * fps) - from);
    const transition = transitionOf(scene);
    // A gentle fade needs no sound; the moving transitions get a whoosh as they start.
    if (scene.id !== "s1" && transition !== "fade") cues.push({ at: from - 4, name: transition === "flash" ? "thud" : "whoosh", gain: 0.6 });
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
    if (scene.type === "stat" && scene.value != null) cues.push({ at: from + Math.round(Math.min(len * 0.55, 60)), name: "chime", gain: 0.7 });
    if (scene.type === "document" && scene.author) cues.push({ at: from + Math.round(len * 0.55), name: "thud", gain: 0.8 });
  }
  // Never stack two sounds within a few frames of each other: the first one wins.
  return cues
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)
    .filter((c, i, all) => i === 0 || c.at - all[i - 1].at >= 6);
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
