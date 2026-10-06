// Explainer graphics: a step-by-step diagram, a document with a highlighted line, and a transcript.
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { DialogueLine, Format, Theme } from "../types";
import { unit } from "../theme";
import { Heading, Stage, useEnter, type SceneProps } from "./shared";

const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', 'Courier New', monospace";

// Cause and effect: boxes appear one by one, each joined to the last by an arrow that draws itself.
export const ProcessScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const steps = (scene.items ?? []).slice(0, 5);
  const short = format === "short";
  const every = (durationInFrames * 0.7) / Math.max(steps.length, 1);
  return (
    <Stage format={format}>
      <Heading text={scene.heading} theme={theme} format={format} size={56} />
      <div style={{ display: "flex", flexDirection: short ? "column" : "row", alignItems: "center", gap: 0 }}>
        {steps.map((step, i) => {
          const at = 6 + i * every;
          const arrow = interpolate(frame, [at - 10, at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <React.Fragment key={i}>
              {i > 0 ? <Arrow progress={arrow} vertical={short} theme={theme} /> : null}
              <StepBox i={i} at={at} text={step} last={i === steps.length - 1} theme={theme} format={format} />
            </React.Fragment>
          );
        })}
      </div>
    </Stage>
  );
};

const Arrow: React.FC<{ progress: number; vertical: boolean; theme: Theme }> = ({ progress, vertical, theme }) => {
  const len = vertical ? 70 : 90;
  const w = vertical ? 40 : len;
  const h = vertical ? len : 40;
  const d = vertical ? `M20 0 L20 ${len - 14}` : `M0 20 L${len - 14} 20`;
  const tip = vertical ? `M6 ${len - 22} L20 ${len - 4} L34 ${len - 22}` : `M${len - 22} 6 L${len - 4} 20 L${len - 22} 34`;
  return (
    <svg width={w} height={h} style={{ flex: "0 0 auto", overflow: "visible" }}>
      <path d={d} stroke={theme.accent} strokeWidth={8} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - progress} fill="none" />
      <path d={tip} stroke={theme.accent} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={progress >= 1 ? 1 : 0} />
    </svg>
  );
};

const StepBox: React.FC<{ i: number; at: number; text: string; last: boolean; theme: Theme; format: Format }> = ({
  i,
  at,
  text,
  last,
  theme,
  format,
}) => {
  const p = useEnter(at);
  const short = format === "short";
  return (
    <div
      style={{
        width: short ? 820 : 300,
        padding: short ? "24px 30px" : "30px 24px",
        borderRadius: 24,
        background: last ? theme.accent : "rgba(255,255,255,0.08)",
        border: `3px solid ${last ? theme.accent : `${theme.accent2}66`}`,
        color: last ? theme.background : theme.text,
        fontFamily: theme.font,
        fontWeight: 800,
        fontSize: (short ? 42 : 36) * unit(format) * (short ? 0.85 : 1),
        lineHeight: 1.15,
        opacity: p,
        transform: `scale(${0.7 + 0.3 * p})`,
        display: "flex",
        alignItems: "center",
        gap: 20,
        textAlign: "left",
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: "0.7em", opacity: 0.7 }}>{String(i + 1).padStart(2, "0")}</span>
      <span>{text}</span>
    </div>
  );
};

// A page from a report, letter or newspaper: it slides in, the camera leans in, and the key line is highlighted.
// heading = what the document is, text = the line from it, author = source and date.
export const DocumentScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = useEnter(0);
  const short = format === "short";
  const k = unit(format);
  const lean = interpolate(frame, [0, durationInFrames], [1, 1.08]);
  const mark = interpolate(frame, [durationInFrames * 0.2, durationInFrames * 0.6], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const stamp = useEnter(Math.round(durationInFrames * 0.55));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: short ? 420 : 60 }}>
      <div
        style={{
          position: "relative",
          width: short ? 900 : 1150,
          padding: short ? "70px 64px 90px" : "60px 80px 80px",
          background: "#f3eee2",
          color: "#1d1b16",
          borderRadius: 6,
          boxShadow: "0 50px 120px rgba(0,0,0,0.6)",
          transform: `translateY(${(1 - p) * 300}px) rotate(${-2 + p * 1}deg) scale(${lean})`,
          opacity: p,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 22 * k, letterSpacing: 4, textTransform: "uppercase", opacity: 0.6, borderBottom: "2px solid #1d1b1633", paddingBottom: 18 }}>
          {scene.heading ?? "Document"}
        </div>
        {/* faint lines of body text above and below the quoted line */}
        {[0.9, 0.75].map((w, i) => (
          <div key={i} style={{ height: 14 * k, width: `${w * 100}%`, background: "#1d1b1622", borderRadius: 4, marginTop: 26 }} />
        ))}
        <div style={{ position: "relative", marginTop: 34, fontFamily: "Georgia, 'DejaVu Serif', serif", fontSize: 50 * k * (short ? 0.85 : 1), lineHeight: 1.35 }}>
          <span
            style={{
              backgroundImage: `linear-gradient(${theme.accent}cc, ${theme.accent}cc)`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${mark}% 100%`,
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
              padding: "0 6px",
            }}
          >
            {scene.text}
          </span>
        </div>
        {[0.95, 0.6].map((w, i) => (
          <div key={i} style={{ height: 14 * k, width: `${w * 100}%`, background: "#1d1b1622", borderRadius: 4, marginTop: 26 }} />
        ))}
        {scene.author ? (
          <div
            style={{
              position: "absolute",
              right: 50,
              bottom: -30,
              padding: "10px 26px",
              border: "5px solid #b3261e",
              color: "#b3261e",
              fontFamily: MONO,
              fontWeight: 800,
              fontSize: 28 * k,
              textTransform: "uppercase",
              background: "#f3eee2",
              opacity: stamp,
              transform: `rotate(-6deg) scale(${2 - stamp})`,
            }}
          >
            {scene.author}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// A transcript: who said what, one line at a time, typed out. For real recorded words only.
export const DialogueScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const { durationInFrames } = useVideoConfig();
  const lines = (scene.lines ?? []).slice(0, 4);
  const speakers = [...new Set(lines.map((l) => l.speaker))];
  const every = (durationInFrames * 0.75) / Math.max(lines.length, 1);
  return (
    <Stage format={format} justify="center">
      {scene.heading ? (
        <div style={{ fontFamily: MONO, fontSize: 30 * unit(format), letterSpacing: 6, textTransform: "uppercase", color: theme.accent2 }}>
          ● {scene.heading}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 28, width: format === "short" ? 900 : 1300 }}>
        {lines.map((line, i) => (
          <Bubble key={i} line={line} at={4 + i * every} span={every} right={speakers.indexOf(line.speaker) % 2 === 1} theme={theme} format={format} />
        ))}
      </div>
    </Stage>
  );
};

const Bubble: React.FC<{ line: DialogueLine; at: number; span: number; right: boolean; theme: Theme; format: Format }> = ({
  line,
  at,
  span,
  right,
  theme,
  format,
}) => {
  const frame = useCurrentFrame();
  const p = useEnter(at);
  const typed = Math.floor(
    interpolate(frame, [at, at + Math.max(8, span * 0.8)], [0, line.text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  if (frame < at) return null;
  const k = unit(format);
  return (
    <div style={{ alignSelf: right ? "flex-end" : "flex-start", maxWidth: "85%", textAlign: "left", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
      <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 24 * k, letterSpacing: 3, textTransform: "uppercase", color: right ? theme.accent2 : theme.accent, marginBottom: 8 }}>
        {line.speaker}
      </div>
      <div
        style={{
          padding: "22px 30px",
          borderRadius: right ? "24px 6px 24px 24px" : "6px 24px 24px 24px",
          background: right ? `${theme.accent2}26` : "rgba(255,255,255,0.1)",
          border: `2px solid ${right ? theme.accent2 : theme.accent}55`,
          fontFamily: MONO,
          fontSize: 38 * k * 0.85,
          color: theme.text,
          lineHeight: 1.3,
        }}
      >
        “{line.text.slice(0, typed)}
        {typed < line.text.length ? <span style={{ opacity: Math.floor(frame / 8) % 2 ? 0 : 1 }}>▍</span> : "”"}
      </div>
    </div>
  );
};
