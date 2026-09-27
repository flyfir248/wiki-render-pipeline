import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Format, Scene, Theme } from "../types";
import { unit } from "../theme";

type SceneProps = { scene: Scene; theme: Theme; format: Format };

// ---------- shared helpers ----------

const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delayFrames, fps, config: { damping: 16, mass: 0.7 } });
};

// Fade + slight zoom on the way in and out of every scene.
export const SceneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.04]);
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `scale(${zoom})` }}>{children}</AbsoluteFill>
  );
};

const Stage: React.FC<{ format: Format; children: React.ReactNode; justify?: string }> = ({
  format,
  children,
  justify = "center",
}) => (
  <AbsoluteFill
    style={{
      padding: format === "short" ? "220px 80px 560px" : "90px 160px 170px",
      display: "flex",
      flexDirection: "column",
      justifyContent: justify,
      alignItems: "center",
      textAlign: "center",
      gap: 36,
    }}
  >
    {children}
  </AbsoluteFill>
);

const Heading: React.FC<{ text?: string | null; theme: Theme; format: Format; size?: number; delay?: number }> = ({
  text,
  theme,
  format,
  size = 64,
  delay = 0,
}) => {
  const p = useEnter(delay);
  if (!text) return null;
  return (
    <div
      style={{
        fontFamily: theme.font,
        fontWeight: 800,
        fontSize: size * unit(format),
        color: theme.text,
        lineHeight: 1.1,
        opacity: p,
        transform: `translateY(${(1 - p) * 40}px)`,
      }}
    >
      {text}
    </div>
  );
};

const Sub: React.FC<{ text?: string | null; theme: Theme; format: Format; delay?: number }> = ({
  text,
  theme,
  format,
  delay = 8,
}) => {
  const p = useEnter(delay);
  if (!text) return null;
  return (
    <div
      style={{
        fontFamily: theme.font,
        fontWeight: 500,
        fontSize: 38 * unit(format),
        color: theme.muted,
        maxWidth: 1400,
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px)`,
      }}
    >
      {text}
    </div>
  );
};

const formatNumber = (n: number) =>
  Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n % 1 === 0 ? String(n) : n.toFixed(1);

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
        {formatNumber(target * progress)}
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

// Stock footage / image with a slow Ken Burns move and a lower-third label.
const BrollScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1.05, 1.18]);
  const pan = interpolate(frame, [0, durationInFrames], [-2, 2]);
  const media = scene.media;
  const p = useEnter(6);
  const label = scene.heading ?? scene.text;
  return (
    <AbsoluteFill>
      {media ? (
        <AbsoluteFill style={{ transform: `scale(${zoom}) translateX(${pan}%)` }}>
          {media.kind === "video" ? (
            <OffthreadVideo src={staticFile(media.src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Img src={staticFile(media.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </AbsoluteFill>
      ) : null}
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
};

export const SceneView: React.FC<SceneProps> = (props) => {
  // Fall back to a kinetic statement for broll without media or unknown types.
  const type = props.scene.type === "broll" && !props.scene.media ? "statement" : props.scene.type;
  const Component = registry[type] ?? StatementScene;
  const scene = type === "statement" && !props.scene.text ? { ...props.scene, text: props.scene.heading } : props.scene;
  return <Component {...props} scene={scene} />;
};
