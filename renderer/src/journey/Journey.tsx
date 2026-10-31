// A scale journey (fyt/journey.py): one camera move that never cuts, from your street to the edge of
// what can be seen, under the narration. L, the log10 of the measure in metres, comes from the keys the
// narration sets; it picks which worlds are drawn (cross-fading where they overlap), where each world's
// camera sits, and what the readouts say. Over it: the readout of the measure with the next landmark,
// a second readout the story brings in later, a tag on each landmark as it passes, the title, and the
// narration as one short italic line at a time.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import type { Journey, Scene } from "../types";
import { loadJourneyFonts, SERIF } from "./fonts";
import { formatLength, shownLevel, smooth } from "./scale";
import { FADE, ZONES, ZONE_VIEWS } from "./zones";
import { rng } from "../scenes/world3d";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const SMALL: React.CSSProperties = { fontFamily: "Inter, sans-serif", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase" };

// Stars rushing in toward the middle of the frame while you grow fast: the speed made visible.
const Streaks: React.FC<{ speed: number; frame: number; w: number; h: number }> = ({ speed, frame, w, h }) => {
  const k = Math.min(1, speed / 0.25);
  if (k < 0.03) return null;
  const r = rng(7);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(w, h) / 2;
  const lines = Array.from({ length: 140 }, (_, i) => {
    const a = r() * Math.PI * 2;
    const phase = r();
    const v = 0.6 + r();
    const u = 1 - ((phase + (frame * 0.012 * v * (0.4 + k))) % 1); // 1 at the edge -> 0 in the middle
    const r1 = R * u ** 1.6;
    const r2 = r1 * (1 + 0.12 * k + 0.1 * u);
    return { x1: cx + Math.cos(a) * r1, y1: cy + Math.sin(a) * r1, x2: cx + Math.cos(a) * r2, y2: cy + Math.sin(a) * r2, o: Math.min(1, u * 3) * (0.25 + 0.5 * r()), i };
  });
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0, opacity: k }}>
      {lines.map((l) => (
        <line key={l.i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#dfe8ff" strokeOpacity={l.o} strokeWidth={1.3} strokeLinecap="round" />
      ))}
    </svg>
  );
};

const Readout: React.FC<{ label: string; value: string; sub?: string | null; align: "left" | "right"; punch?: number; scale: number }> = ({ label, value, sub, align, punch = 0, scale }) => (
  <div style={{ textAlign: align, color: "#f4f1ea", textShadow: "0 2px 12px rgba(0,0,0,0.65)" }}>
    <div style={{ ...SMALL, fontSize: 13 * scale, color: "rgba(244,241,234,0.75)" }}>{label}</div>
    <div style={{ fontFamily: SERIF, fontSize: 46 * scale, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", transform: `scale(${1 + punch * 0.08})`, transformOrigin: align === "left" ? "0 50%" : "100% 50%" }}>{value}</div>
    {sub ? <div style={{ ...SMALL, fontSize: 12 * scale, marginTop: 6 * scale, color: "rgba(244,241,234,0.6)", whiteSpace: "pre-line" }}>{sub}</div> : null}
  </div>
);

export const JourneyLayer: React.FC<{ journey: Journey; portrait: boolean }> = ({ journey, portrait }) => {
  loadJourneyFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const L = shownLevel(journey, t);
  const speed = Math.abs(shownLevel(journey, t + 0.5) - shownLevel(journey, t - 0.5)); // L a second
  const cold = journey.coldOpen ?? 0;
  const scale = portrait ? 1.5 : 1;
  const seed = journey.seed ?? 1;

  const views = ZONES.map((z) => ({ ...z, o: smooth(z.from, z.from + FADE, L) * (1 - smooth(z.to - FADE, z.to, L)) })).filter((z) => z.o > 0.002);

  // the readouts: the measure (with the next landmark ahead), and the story's second readout
  const value = formatLength(10 ** L);
  const next = t >= cold ? journey.marks.find((m) => m.L > L + 0.02) : undefined;
  const gauge = [...journey.gauges].reverse().find((g) => g.t <= t && t >= cold);
  const punch = gauge ? interpolate(t - gauge.t, [0, 0.12, 0.45], [0, 1, 0], clamp) : 0;
  const mark = t >= cold ? journey.marks.reduce<{ m: Journey["marks"][number]; d: number } | null>((best, m) => {
    const d = Math.abs(m.L - L);
    return d < 0.24 && (!best || d < best.d) ? { m, d } : best;
  }, null) : null;
  const flash = cold > 0 ? interpolate(t - cold, [-0.1, 0, 0.35], [0, 1, 0], clamp) : 0;
  const title = journey.title && t >= journey.title.from && t <= journey.title.to ? journey.title : null;

  return (
    <AbsoluteFill style={{ backgroundColor: "#02030a" }}>
      {views.map((z) => {
        const View = ZONE_VIEWS[z.name];
        return (
          <AbsoluteFill key={z.name} style={{ opacity: z.o }}>
            <ThreeCanvas width={width} height={height} gl={{ antialias: true, logarithmicDepthBuffer: true }} camera={{ fov: 55, position: [0, 2, 5] }}>
              <View L={L} t={t} seed={seed} portrait={portrait} />
            </ThreeCanvas>
          </AbsoluteFill>
        );
      })}
      {L > 4.5 ? <Streaks speed={speed} frame={frame} w={width} h={height} /> : null}
      {/* a soft vignette, so the readouts sit on darker ground */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
      <div style={{ position: "absolute", left: 48 * scale, top: portrait ? 230 : 40 }}>
        <Readout label={journey.measure} value={value} sub={next ? `next · ${next.name}` : null} align="left" scale={scale} />
      </div>
      {gauge ? (
        <div style={{ position: "absolute", right: 48 * scale, top: portrait ? 230 : 40, opacity: interpolate(t - journey.gauges[0].t, [0, 0.4], [0, 1], clamp) }}>
          <Readout label={gauge.label} value={gauge.text} align="right" punch={punch} scale={scale} />
        </div>
      ) : null}
      {mark ? (
        <div style={{ position: "absolute", left: width * (portrait ? 0.12 : 0.56), top: height * (portrait ? 0.36 : 0.3), opacity: 1 - smooth(0.12, 0.24, mark.d), color: "#f4f1ea", textShadow: "0 2px 14px rgba(0,0,0,0.8)" }}>
          <div style={{ width: 70 * scale, height: 1.5, background: "rgba(244,241,234,0.8)", marginBottom: 10 * scale }} />
          <div style={{ fontFamily: SERIF, fontSize: 40 * scale, lineHeight: 1.05 }}>{mark.m.name}</div>
          {mark.m.note ? <div style={{ ...SMALL, fontSize: 14 * scale, marginTop: 8 * scale, color: "rgba(244,241,234,0.78)" }}>{mark.m.note}</div> : null}
        </div>
      ) : null}
      {title ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(t, [title.from, title.from + 0.5, title.to - 0.5, title.to], [0, 1, 1, 0], clamp) }}>
          <div style={{ fontFamily: SERIF, fontSize: (portrait ? 64 : 76), color: "#fbf8f1", textAlign: "center", maxWidth: width * 0.8, lineHeight: 1.15, textShadow: "0 4px 30px rgba(0,0,0,0.7)" }}>{title.text}</div>
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ backgroundColor: "#ffffff", opacity: flash }} />
    </AbsoluteFill>
  );
};

// The narration as one short italic line at a time, in a quiet box near the bottom.
export const StoryCaptions: React.FC<{ scenes: Scene[]; portrait: boolean }> = ({ scenes, portrait }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const s = scenes.find((x) => t >= x.start && t < x.end);
  if (!s?.text) return null;
  const o = interpolate(t, [s.start + 0.05, s.start + 0.3, s.end - 0.25, s.end], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: height * (portrait ? 0.2 : 0.08), display: "flex", justifyContent: "center", opacity: o }}>
      <div
        style={{
          fontFamily: SERIF, fontStyle: "italic", fontSize: portrait ? 50 : 36, color: "#f4f1ea", background: "rgba(8,8,12,0.5)",
          padding: portrait ? "12px 26px" : "8px 22px", borderRadius: 8, maxWidth: width * 0.8, textAlign: "center", lineHeight: 1.3,
          textShadow: "0 1px 6px rgba(0,0,0,0.6)",
        }}
      >
        {s.text}
      </div>
    </div>
  );
};
