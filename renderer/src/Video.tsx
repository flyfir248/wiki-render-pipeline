import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Brand } from "./components/Brand";
import { Captions } from "./components/Captions";
import { ChapterCard } from "./components/ChapterCard";
import { Atmosphere, Grain } from "./components/Grain";
import { SoundEffects } from "./components/SoundEffects";
import { WhatIfClock } from "./components/WhatIfClock";
import { JourneyLayer, StoryCaptions } from "./journey/Journey";
import { Visualizer, energyOf, useVoiceSpectrum } from "./components/Visualizer";
import { SceneFrame, SceneView, sceneSpans, transitionOf } from "./scenes";
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

// What If videos: the clock sits at the top of every scene, so a chart or card is drawn a little smaller
// and lower to leave it room. 3D worlds and maps fill the frame behind it.
const FULL_BLEED = ["world", "map", "aircraft", "ship", "broll"];
const ClockRoom: React.FC<{ on: boolean; format: RenderProps["format"]; children: React.ReactNode }> = ({ on, format, children }) =>
  on ? (
    <AbsoluteFill style={{ transform: format === "short" ? "translateY(19%) scale(0.78)" : "translateY(9%) scale(0.86)", transformOrigin: "50% 0%" }}>
      {children}
    </AbsoluteFill>
  ) : (
    <>{children}</>
  );

export const Video: React.FC<RenderProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const spans = sceneSpans(props.scenes, fps);
  return (
    <AbsoluteFill style={{ backgroundColor: props.theme.background }}>
      {props.journey ? (
        <JourneyLayer journey={props.journey} portrait={props.format === "short"} />
      ) : props.voice ? (
        <ReactiveLayer props={props} voice={props.voice} />
      ) : (
        <Background theme={props.theme} />
      )}

      {props.scenes.map((scene, i) => {
        if (scene.type === "journey") return null; // the journey layer draws it
        const { from, len, tail, exit } = spans[i];
        return (
          <Sequence key={scene.id} from={from} durationInFrames={len} name={`${scene.type}:${scene.id}`}>
            <SceneFrame transition={transitionOf(scene)} instant={i === 0} tail={tail} exit={exit}>
              <ClockRoom on={Boolean(scene.clock) && !FULL_BLEED.includes(scene.type)} format={props.format}>
                <SceneView scene={scene} theme={props.theme} format={props.format} />
              </ClockRoom>
            </SceneFrame>
            {scene.chapter && scene.chapterNumber ? <ChapterCard number={scene.chapterNumber} title={scene.chapter} theme={props.theme} /> : null}
          </Sequence>
        );
      })}

      <Atmosphere />
      <Grain />

      {props.scenes.some((s) => s.clock) ? <WhatIfClock scenes={props.scenes} theme={props.theme} format={props.format} /> : null}

      {props.journey ? (
        <StoryCaptions scenes={props.scenes} portrait={props.format === "short"} />
      ) : props.showCaptions && props.captions.length ? (
        <Captions words={props.captions} theme={props.theme} format={props.format} />
      ) : null}

      <Brand badge={props.badge} subscribe={props.subscribe} endCard={props.endCard ?? 0} theme={props.theme} format={props.format} />

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
