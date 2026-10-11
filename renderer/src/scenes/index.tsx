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

import { ShotReel, cameraOf } from "./camera";
import { DialogueScene, DocumentScene, ProcessScene } from "./graphics";
import { MapScene, mapRegions, validPlaces } from "./map";
import { StoryScene } from "./story";
import { Heading, PanelContext, Stage, Sub, useEnter, type SceneProps } from "./shared";

export { SceneFrame, transitionOf } from "./camera";

const formatNumber = (n: number) =>
  Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n % 1 === 0 ? String(n) : n.toFixed(1);

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
          <ShotReel media={scene.media} shots={scene.shots} camera="push_in" flat format={format} />
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

// Kinetic typography: words reveal one at a time across the scene.
const StatementScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const words = (scene.text ?? "").split(" ");
  const revealEnd = Math.max(10, durationInFrames * 0.6);
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
        }}
      >
        {words.map((w, i) => {
          const at = (i / words.length) * revealEnd;
          const o = interpolate(frame, [at, at + 6], [0.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const emphasise = /^[A-Z0-9$%]/.test(w) && i > 0;
          return (
            <span
              key={i}
              style={{ display: "inline-block", opacity: o, color: emphasise ? theme.accent : theme.text, marginRight: "0.25em" }}
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
  const { durationInFrames } = useVideoConfig();
  const target = scene.value ?? 0;
  const progress = interpolate(frame, [5, Math.min(durationInFrames * 0.55, 60)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const pulse = spring({ frame: frame - 60, fps: 30, config: { damping: 8 } });
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={52} />
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 900,
          fontSize: 210 * unit(format),
          color: theme.accent,
          lineHeight: 1,
          transform: `scale(${1 + 0.05 * pulse})`,
          textShadow: `0 0 60px ${theme.accent}55`,
        }}
      >
        {scene.prefix ?? ""}
        {isYear(scene) ? String(target) : formatNumber(target * progress)}
        {scene.suffix ?? ""}
      </div>
      <Sub text={scene.text} theme={theme} format={format} delay={20} />
    </Stage>
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
// places, or a story without any art.
export const shownType = (raw: Scene): Scene["type"] =>
  (raw.type === "broll" && !raw.media) ||
  (raw.type === "map" && !validPlaces(raw.places).length && !mapRegions(raw).length) ||
  (raw.type === "story" && !(raw.actors ?? []).some((a) => a.src))
    ? "statement"
    : raw.type;

export const SceneView: React.FC<SceneProps> = (props) => {
  const type = shownType(props.scene);
  const Component = registry[type] ?? StatementScene;
  const scene = type === "statement" && !props.scene.text ? { ...props.scene, text: props.scene.heading } : props.scene;
  const media = props.scene.media;
  if (type === "title" && props.scene.id === "s1") return <HookScene {...props} scene={scene} />;
  if (media && type !== "broll" && type !== "map" && type !== "story") {
    return (
      <AbsoluteFill>
        <Backdrop scene={props.scene} media={media} theme={props.theme} format={props.format} />
        <PanelContext.Provider value={props.theme.background}>
          <Component {...props} scene={scene} />
        </PanelContext.Provider>
      </AbsoluteFill>
    );
  }
  return <Component {...props} scene={scene} />;
};
