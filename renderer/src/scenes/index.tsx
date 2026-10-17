import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Format, Scene, Theme } from "../types";
import { unit } from "../theme";

import { BeatCuts, ShotReel, cameraOf } from "./camera";
import { DialogueScene, DocumentScene, ProcessScene } from "./graphics";
import { EvidenceScene } from "./evidence";
import { MapScene, mapRegions, validPlaces } from "./map";
import { StoryScene } from "./story";
import { AircraftScene } from "./aircraft";
import { ShipScene } from "./ship";
import { WorldScene } from "./world";
import { CycleScene, Flash, ProportionScene, ScaleScene, TrendScene, impact, statLands } from "./motion";
import { Heading, PanelContext, Stage, Sub, formatNumber, useEnter, type SceneProps } from "./shared";

export { OVERLAP, SceneFrame, sceneSpans, transitionOf } from "./camera";

// A bare year (1968, not 1,968), shown as itself rather than counted up from zero.
const isYear = (scene: Scene) =>
  !scene.prefix && !(scene.suffix ?? "").trim() && Number.isInteger(scene.value) && (scene.value ?? 0) >= 1000 && (scene.value ?? 0) <= 2100;

// ---------- scene types ----------

const TitleScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const p = useEnter();
  const words = (scene.heading ?? "").split(" ");
  return (
    <Stage format={format}>
      <div
        style={{
          width: 140 * p * unit(format),
          height: 10,
          borderRadius: 5,
          background: theme.accent,
        }}
      />
      <div style={{ fontFamily: theme.font, fontWeight: 900, fontSize: 118 * unit(format), lineHeight: 1.02 }}>
        {words.map((w, i) => (
          <TitleWord key={i} word={w} i={i} theme={theme} />
        ))}
      </div>
      <Sub text={scene.text} theme={theme} format={format} delay={6 + words.length * 3} />
    </Stage>
  );
};

const TitleWord: React.FC<{ word: string; i: number; theme: Theme }> = ({ word, i, theme }) => {
  const p = useEnter(i * 3);
  return (
    <span
      style={{
        display: "inline-block",
        marginRight: "0.25em",
        color: i % 3 === 1 ? theme.accent : theme.text,
        opacity: p,
        transform: `translateY(${(1 - p) * 60}px) rotate(${(1 - p) * -6}deg)`,
      }}
    >
      {word}
    </span>
  );
};

// The opening: the subject's photo at full brightness with the hook in huge words across it. Every
// word is on screen from the first frame (that frame decides whether people stay), each with a punch.
const HookScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const short = format === "short";
  const words = (scene.heading ?? "").split(" ").filter(Boolean);
  const size = (short ? 150 : 128) * (words.length > 5 ? 0.75 : 1);
  return (
    <AbsoluteFill>
      {scene.media ? (
        <>
          <AbsoluteFill style={{ transform: `scale(${interpolate(frame, [0, 8], [1.18, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })})` }}>
            <ShotReel media={scene.media} shots={scene.shots} camera="push_in" flat format={format} />
          </AbsoluteFill>
          <AbsoluteFill
            style={{ background: `linear-gradient(${theme.background}66 0%, transparent 28%, ${theme.background}40 55%, ${theme.background}d9 100%)` }}
          />
        </>
      ) : null}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          gap: 30,
          padding: short ? "0 70px 420px" : "0 160px 80px",
        }}
      >
        <div
          style={{
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.0,
            textTransform: short ? "uppercase" : "none",
            textShadow: "0 8px 40px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.8)",
          }}
        >
          {words.map((w, i) => {
            const pop = spring({ frame: frame - i * 2, fps, config: { damping: 12, mass: 0.5 } });
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  margin: "0 0.16em",
                  color: i % 3 === 1 ? theme.accent : theme.text,
                  transform: `translateY(${interpolate(pop, [0, 1], [-0.18, 0])}em)`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        <Sub text={scene.text} theme={theme} format={format} delay={6} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Kinetic typography: each word slams into place as the narrator says it (or, without timings, one
// after another across the scene), and the line leans slowly toward the viewer.
const StatementScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const words = (scene.text ?? "").split(" ");
  const revealEnd = Math.max(10, durationInFrames * 0.6);
  const said = scene.revealTimes?.length === words.length ? scene.revealTimes : null;
  const lean = interpolate(frame, [0, durationInFrames], [1, 1.06]);
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={40} />
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 800,
          fontSize: (words.length > 14 ? 60 : 78) * unit(format),
          lineHeight: 1.2,
          maxWidth: 1500,
          transform: `scale(${lean})`,
        }}
      >
        {words.map((w, i) => {
          const at = said ? Math.round(said[i] * fps) - 2 : (i / words.length) * revealEnd;
          const slam = spring({ frame: frame - at, fps, config: { damping: 13, mass: 0.5, stiffness: 180 } });
          // Words not said yet wait faintly in place, so the line is never an empty frame.
          const o = interpolate(frame, [at, at + 3], [0.14, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const emphasise = /^[A-Z0-9$%]/.test(w) && i > 0;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: o,
                color: emphasise ? theme.accent : theme.text,
                marginRight: "0.25em",
                      transform: frame < at ? undefined : `scale(${1 + (1 - slam) * (emphasise ? 1.2 : 0.7)}) rotate(${(1 - slam) * (i % 2 ? 4 : -4)}deg)`,
                filter: frame >= at && slam < 0.9 ? `blur(${(1 - slam) * 6}px)` : undefined,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </Stage>
  );
};

const StatScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const target = scene.value ?? 0;
  const lands = Math.max(20, statLands(scene, durationInFrames, fps));
  // The count runs for the second and a half before the number is said, so it lands on the word.
  const countFrom = Math.max(5, lands - 45);
  const statText = `${scene.prefix ?? ""}${isYear(scene) ? String(target) : formatNumber(target)}${scene.suffix ?? ""}`;
  const progress = interpolate(frame, [countFrom, lands], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const pulse = spring({ frame: frame - lands, fps: 30, config: { damping: 8 } });
  // The number lands like an impact cut: a punch in, a flash, and (in SoundEffects) a hit.
  const hit = impact(frame, lands);
  return (
    <AbsoluteFill style={{ transform: `scale(${hit.punch})` }}>
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={52} />
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 900,
          // Long figures shrink to fit across a Short's narrow frame.
          fontSize: Math.min(210 * unit(format), (format === "short" ? 900 : 1600) / (0.62 * Math.max(1, statText.length))),
          color: theme.accent,
          lineHeight: 1,
          transform: `scale(${1 + 0.05 * pulse})`,
          textShadow: `0 0 60px ${theme.accent}55`,
          // A number said late in the scene waits off screen instead of sitting at zero.
          opacity: interpolate(frame, [countFrom - 8, countFrom], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        {scene.prefix ?? ""}
        {isYear(scene) ? String(target) : formatNumber(target * progress)}
        {scene.suffix ?? ""}
      </div>
      <Sub text={scene.text} theme={theme} format={format} delay={20} />
    </Stage>
    <Flash amount={hit.flash} />
    </AbsoluteFill>
  );
};

const BarsScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const data = scene.data ?? [];
  const max = Math.max(...data.map((d) => d.value), 1);
  const short = format === "short";
  const chartH = short ? 820 : 520;
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={56} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: short ? 28 : 44, height: chartH + 90 }}>
        {data.map((d, i) => {
          const g = interpolate(frame, [8 + i * 6, 32 + i * 6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.back(1.4)),
          });
          const h = Math.max(4, (d.value / max) * chartH * g);
          const top = i === data.length - 1 || d.value === max;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 34 * unit(format), color: theme.text, opacity: g }}>
                {formatNumber(d.value * Math.min(g, 1))}
              </div>
              <div
                style={{
                  width: short ? 150 : Math.min(180, 1200 / Math.max(data.length, 1)),
                  height: h,
                  borderRadius: "16px 16px 4px 4px",
                  background: top ? theme.accent : `linear-gradient(${theme.accent2}, ${theme.background2})`,
                }}
              />
              <div style={{ fontFamily: theme.font, fontWeight: 600, fontSize: 30 * unit(format), color: theme.muted }}>
                {d.label}
              </div>
            </div>
          );
        })}
      </div>
      <Sub text={scene.text} theme={theme} format={format} delay={30} />
    </Stage>
  );
};

const ListScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const { durationInFrames } = useVideoConfig();
  const items = scene.items ?? [];
  const step = Math.min(24, (durationInFrames * 0.6) / Math.max(items.length, 1));
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={64} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26, alignItems: "stretch", minWidth: format === "short" ? 820 : 1100 }}>
        {items.map((item, i) => (
          <ListItem key={i} i={i} delay={10 + i * step} text={item} theme={theme} format={format} />
        ))}
      </div>
    </Stage>
  );
};

const ListItem: React.FC<{ i: number; delay: number; text: string; theme: Theme; format: Format }> = ({
  i,
  delay,
  text,
  theme,
  format,
}) => {
  const p = useEnter(delay);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "22px 34px",
        borderRadius: 22,
        background: "rgba(255,255,255,0.07)",
        border: `2px solid ${theme.accent}33`,
        opacity: p,
        transform: `translateX(${(1 - p) * -120}px)`,
        textAlign: "left",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          width: 64 * unit(format),
          height: 64 * unit(format),
          borderRadius: "50%",
          background: theme.accent,
          color: theme.background,
          fontFamily: theme.font,
          fontWeight: 900,
          fontSize: 34 * unit(format),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {i + 1}
      </div>
      <div style={{ fontFamily: theme.font, fontWeight: 700, fontSize: 46 * unit(format), color: theme.text }}>{text}</div>
    </div>
  );
};

const QuoteScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const p = useEnter();
  return (
    <Stage format={format}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 220 * unit(format), color: theme.accent, lineHeight: 0.6, opacity: p }}>
        “
      </div>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 64 * unit(format),
          color: theme.text,
          maxWidth: 1400,
          lineHeight: 1.25,
          opacity: p,
          transform: `scale(${0.94 + 0.06 * p})`,
        }}
      >
        {scene.text}
      </div>
      {scene.author ? <Sub text={`— ${scene.author}`} theme={theme} format={format} delay={18} /> : null}
    </Stage>
  );
};

const TimelineScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const events = scene.events ?? [];
  const short = format === "short";
  const drawn = interpolate(frame, [5, durationInFrames * 0.7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={56} />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: short ? "column" : "row",
          gap: short ? 40 : 30,
          width: short ? 860 : 1600,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            position: "absolute",
            background: theme.accent,
            borderRadius: 4,
            ...(short
              ? { left: 30, top: 0, width: 6, height: `${drawn * 100}%` }
              : { top: 30, left: 0, height: 6, width: `${drawn * 100}%` }),
          }}
        />
        {events.map((e, i) => {
          const at = (i / Math.max(events.length, 1)) * durationInFrames * 0.7;
          const p = spring({ frame: frame - at, fps: 30, config: { damping: 14 } });
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: short ? "row" : "column",
                alignItems: short ? "flex-start" : "center",
                gap: 20,
                opacity: p,
                transform: `translateY(${(1 - p) * 30}px)`,
                textAlign: short ? "left" : "center",
              }}
            >
              <div style={{ width: 66, height: 66, flex: "0 0 auto", borderRadius: "50%", background: theme.background, border: `6px solid ${theme.accent}` }} />
              <div>
                <div style={{ fontFamily: theme.font, fontWeight: 900, fontSize: 44 * unit(format), color: theme.accent }}>{e.label}</div>
                <div style={{ fontFamily: theme.font, fontWeight: 500, fontSize: 30 * unit(format), color: theme.text }}>{e.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

const ComparisonScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const short = format === "short";
  const column = (title: string | null | undefined, items: string[], color: string, delay: number) => (
    <ComparisonColumn title={title} items={items} color={color} delay={delay} theme={theme} format={format} />
  );
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={56} />
      <div style={{ display: "flex", flexDirection: short ? "column" : "row", gap: 40, width: short ? 900 : 1500 }}>
        {column(scene.leftTitle, scene.left ?? [], theme.accent2, 6)}
        {column(scene.rightTitle, scene.right ?? [], theme.accent, 16)}
      </div>
    </Stage>
  );
};

const ComparisonColumn: React.FC<{
  title?: string | null;
  items: string[];
  color: string;
  delay: number;
  theme: Theme;
  format: Format;
}> = ({ title, items, color, delay, theme, format }) => {
  const p = useEnter(delay);
  return (
    <div
      style={{
        flex: 1,
        padding: 40,
        borderRadius: 28,
        background: "rgba(255,255,255,0.06)",
        borderTop: `10px solid ${color}`,
        opacity: p,
        transform: `translateY(${(1 - p) * 60}px)`,
        textAlign: "left",
      }}
    >
      <div style={{ fontFamily: theme.font, fontWeight: 900, fontSize: 48 * unit(format), color, marginBottom: 18 }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ fontFamily: theme.font, fontWeight: 600, fontSize: 36 * unit(format), color: theme.text, margin: "12px 0" }}>
          • {it}
        </div>
      ))}
    </div>
  );
};

// A photo or clip moved by the scene's camera, with a lower-third label.
const BrollScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const media = scene.media;
  const p = useEnter(6);
  const label = scene.heading ?? scene.text;
  return (
    <AbsoluteFill>
      {media ? <ShotReel media={media} shots={scene.shots} camera={cameraOf(scene)} format={format} /> : null}
      <AbsoluteFill style={{ background: `linear-gradient(transparent 45%, ${theme.background}dd)` }} />
      {label ? (
        <div
          style={{
            position: "absolute",
            left: format === "short" ? 70 : 120,
            top: format === "short" ? 260 : 110,
            maxWidth: format === "short" ? 900 : 1100,
            padding: "18px 30px",
            borderLeft: `10px solid ${theme.accent}`,
            background: `${theme.background}cc`,
            fontFamily: theme.font,
            fontWeight: 800,
            fontSize: 48 * unit(format),
            color: theme.text,
            opacity: p,
            transform: `translateX(${(1 - p) * -80}px)`,
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const registry: Record<Scene["type"], React.FC<SceneProps>> = {
  title: TitleScene,
  statement: StatementScene,
  stat: StatScene,
  bars: BarsScene,
  list: ListScene,
  quote: QuoteScene,
  timeline: TimelineScene,
  comparison: ComparisonScene,
  broll: BrollScene,
  map: MapScene,
  process: ProcessScene,
  document: DocumentScene,
  dialogue: DialogueScene,
  story: StoryScene,
  evidence: EvidenceScene,
  trend: TrendScene,
  proportion: ProportionScene,
  scale: ScaleScene,
  cycle: CycleScene,
  aircraft: AircraftScene,
  ship: ShipScene,
  world: WorldScene,
};

// A photo or clip behind a template scene, moved by the scene's camera. It stays bright: the scene's
// content sits on its own dark panel, and only the edges darken, under the heading and the captions.
const Backdrop: React.FC<{ scene: Scene; media: NonNullable<Scene["media"]>; theme: Theme; format: Format }> = ({
  scene,
  media,
  theme,
  format,
}) => (
  <AbsoluteFill>
    <ShotReel media={media} shots={scene.shots} camera={cameraOf(scene)} flat format={format} />
    <AbsoluteFill
      style={{
        background: `linear-gradient(${theme.background}80 0%, ${theme.background}1a 30%, ${theme.background}33 60%, ${theme.background}e6 100%)`,
      }}
    />
  </AbsoluteFill>
);

// What a scene is drawn as: a kinetic statement stands in for broll without media, a map without
// places, a story without any art, an evidence board without clues, or a chart without enough data.
export const shownType = (raw: Scene): Scene["type"] =>
  (raw.type === "broll" && !raw.media) ||
  (raw.type === "map" && !validPlaces(raw.places).length && !mapRegions(raw).length) ||
  (raw.type === "story" && !(raw.actors ?? []).some((a) => a.src)) ||
  (raw.type === "evidence" && !(raw.items ?? []).some(Boolean)) ||
  (raw.type === "trend" && (raw.data ?? []).length < 2) ||
  (raw.type === "scale" && (raw.data ?? []).filter((d) => d.value > 0).length < 2) ||
  (raw.type === "cycle" && (raw.items ?? []).filter(Boolean).length < 3)
    ? "statement"
    : raw.type;

// Scenes whose picture can change with the story (fyt/storyboard.py BEAT_TYPES).
const BEAT_TYPES: Scene["type"][] = ["title", "statement", "stat", "quote", "broll", "story"];

// Scenes that draw their own full frame, so a photo is never put behind them.
const DRAWN_OVER: Scene["type"][] = ["broll", "map", "story", "evidence", "aircraft", "ship", "world"];
// Code-drawn charts: a photo goes far behind them, dim and soft, so the chart reads first.
const CHARTS: Scene["type"][] = ["trend", "proportion", "scale", "cycle"];
// Graphics that float in 3D space: they tip up into place and sway gently, so they never sit dead flat.
const FLOATING: Scene["type"][] = [...CHARTS, "stat", "bars", "list", "timeline", "comparison", "process", "quote"];

const Depth: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({ frame, fps, config: { damping: 15, mass: 0.9 } });
  const dir = id.length % 2 ? 1 : -1; // neighbouring scenes tip in from opposite sides
  const tiltX = (1 - land) * 16 + Math.cos(frame / 70) * 1.6;
  const tiltY = (1 - land) * 10 * dir + Math.sin(frame / 90) * 2.4;
  return (
    <AbsoluteFill style={{ perspective: 1800 }}>
      <AbsoluteFill style={{ transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`, transformStyle: "preserve-3d" }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const DimBackdrop: React.FC<{ scene: Scene; media: NonNullable<Scene["media"]>; theme: Theme; format: Format }> = ({ scene, media, theme, format }) => (
  <AbsoluteFill>
    <AbsoluteFill style={{ filter: "blur(4px) brightness(0.55) saturate(0.8)", transform: "scale(1.06)" }}>
      <ShotReel media={media} shots={null} camera={cameraOf(scene)} flat format={format} />
    </AbsoluteFill>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, ${theme.background}aa 0%, ${theme.background}66 70%, ${theme.background}cc 100%)` }} />
  </AbsoluteFill>
);

const SceneBody: React.FC<SceneProps> = (props) => {
  const type = shownType(props.scene);
  const Component = registry[type] ?? StatementScene;
  const scene = type === "statement" && !props.scene.text ? { ...props.scene, text: props.scene.heading } : props.scene;
  const media = props.scene.media;
  if (type === "title" && props.scene.id === "s1") return <HookScene {...props} scene={scene} />;
  const body = FLOATING.includes(type) ? (
    <Depth id={props.scene.id}>
      <Component {...props} scene={scene} />
    </Depth>
  ) : (
    <Component {...props} scene={scene} />
  );
  if (media && CHARTS.includes(type)) {
    return (
      <AbsoluteFill>
        <DimBackdrop scene={props.scene} media={media} theme={props.theme} format={props.format} />
        {body}
      </AbsoluteFill>
    );
  }
  if (media && !DRAWN_OVER.includes(type)) {
    return (
      <AbsoluteFill>
        <Backdrop scene={props.scene} media={media} theme={props.theme} format={props.format} />
        <PanelContext.Provider value={props.theme.background}>{body}</PanelContext.Provider>
      </AbsoluteFill>
    );
  }
  return body;
};

export const SceneView: React.FC<SceneProps> = (props) => {
  const beats = props.scene.beats;
  if (beats?.length && BEAT_TYPES.includes(props.scene.type)) {
    return (
      <BeatCuts beats={beats} format={props.format}>
        <SceneBody {...props} />
      </BeatCuts>
    );
  }
  return <SceneBody {...props} />;
};
