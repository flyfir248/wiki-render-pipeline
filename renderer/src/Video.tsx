import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { SoundEffects } from "./components/SoundEffects";
import { Visualizer, energyOf, useVoiceSpectrum } from "./components/Visualizer";
import { SceneFrame, SceneView, transitionOf } from "./scenes";
import type { RenderProps, Word } from "./types";

const ReactiveLayer: React.FC<{ props: RenderProps; voice: string }> = ({ props, voice }) => {
  const spectrum = useVoiceSpectrum(voice);
  return (
    <>
      <Background theme={props.theme} energy={energyOf(spectrum)} />
      {props.showVisualizer && spectrum ? <Visualizer spectrum={spectrum} theme={props.theme} /> : null}
    </>
  );
};

// Lower the music while someone is speaking, raise it in the gaps.
const musicVolume = (base: number, words: Word[], fps: number, total: number) => (f: number) => {
  const t = f / fps;
  const speaking = words.some((w) => t >= w.start - 0.3 && t <= w.end + 0.3);
  const fade = interpolate(f, [0, fps, total - fps * 2, total], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (speaking || words.length === 0 ? base : base * 2.2) * fade;
};

export const Video: React.FC<RenderProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: props.theme.background }}>
      {props.voice ? <ReactiveLayer props={props} voice={props.voice} /> : <Background theme={props.theme} />}

      {props.scenes.map((scene, i) => {
        const from = Math.round(scene.start * fps);
        const len = Math.max(1, Math.round(scene.end * fps) - from);
        return (
          <Sequence key={scene.id} from={from} durationInFrames={len} name={`${scene.type}:${scene.id}`}>
            <SceneFrame transition={transitionOf(scene)} instant={i === 0}>
              <SceneView scene={scene} theme={props.theme} format={props.format} />
            </SceneFrame>
          </Sequence>
        );
      })}

      {props.showCaptions && props.captions.length ? (
        <Captions words={props.captions} theme={props.theme} format={props.format} />
      ) : null}

      {props.voice ? <Audio src={staticFile(props.voice)} /> : null}
      {props.sfx ? <SoundEffects scenes={props.scenes} fps={fps} dir={props.sfx.dir} volume={props.sfx.volume} /> : null}
      {props.music ? (
        <Audio
          src={staticFile(props.music.src)}
          loop
          volume={musicVolume(props.music.volume, props.captions, fps, durationInFrames)}
        />
      ) : null}
    </AbsoluteFill>
  );
};
