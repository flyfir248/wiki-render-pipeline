// The What If series' clock (fyt/whatif.py): the stage's time stamp, big at the top of every scene, with
// what the premise has added up to by then and a danger bar that only rises. When the stage changes, the
// number counts up to the new one (DAY 2 -> DAY 70 ticks through the days) or, for a new unit, the stamp
// slams in; either way it lands with a punch and a flash, and SoundEffects ticks and hits with it.
import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Scene, Theme } from "../types";

const COUNT_FRAMES = 18; // the count-up from the last stage's number to this one's
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Stage = { stamp: string; note: string | null; from: number; to: number; unit: string; n: number | null; levelFrom: number; level: number };

const parse = (stamp: string): { unit: string; n: number | null } => {
  const m = stamp.match(/^(.*?)([\d,]+(?:\.\d+)?)\s*$/);
  return m ? { unit: m[1].trim(), n: parseFloat(m[2].replace(/,/g, "")) } : { unit: stamp, n: null };
};

// Stages in frames: where each one starts (the first scene that carries its stamp) and its level.
export const clockStages = (scenes: Scene[], fps: number): Stage[] => {
  const out: Stage[] = [];
  scenes.forEach((s) => {
    if (!s.clock) return;
    const from = Math.round(s.start * fps);
    const to = Math.round(s.end * fps);
    const last = out[out.length - 1];
    const level = s.level ?? last?.level ?? 0;
    const levelFrom = s.levelFrom ?? last?.level ?? 0;
    if (last && last.stamp === s.clock) {
      last.to = to;
      last.level = level;
      last.note = s.clockNote ?? last.note;
      return;
    }
    out.push({ stamp: s.clock, note: s.clockNote ?? null, from, to, ...parse(s.clock), levelFrom, level });
  });
  return out;
};

// When each stage change lands, in frames: SoundEffects ticks through the count and hits as it lands.
export const clockCues = (scenes: Scene[], fps: number) =>
  clockStages(scenes, fps)
    .slice(1)
    .flatMap((st) => [
      { at: st.from + 4, name: "tick", gain: 0.55 },
      { at: st.from + 11, name: "tick", gain: 0.55 },
      { at: st.from + COUNT_FRAMES, name: "hit", gain: 0.75 },
    ]);

const fmt = (n: number, like: number) => (Number.isInteger(like) ? Math.round(n).toLocaleString("en-US") : n.toFixed(1));

// Amber when the world is still close to normal, red when it has gone far.
const danger = (k: number) => {
  const a = [255, 196, 64];
  const b = [255, 64, 48];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

export const WhatIfClock: React.FC<{ scenes: Scene[]; theme: Theme; format: Format }> = ({ scenes, theme, format }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const stages = clockStages(scenes, fps);
  if (!stages.length) return null;
  const idx = stages.reduce((k, st, i) => (frame >= st.from ? i : k), 0);
  const st = stages[idx];
  const prev = idx > 0 ? stages[idx - 1] : null;
  const since = frame - st.from;
  const short = format === "short";

  // The number counts up from the last stage when the unit is the same; a new unit slams in.
  const counting = prev && st.n != null && prev.n != null && prev.unit === st.unit && since < COUNT_FRAMES;
  const k = Easing.out(Easing.cubic)(Math.min(1, Math.max(0, since / COUNT_FRAMES)));
  const shown = counting ? `${st.unit} ${fmt(prev!.n! + (st.n! - prev!.n!) * k, st.n!)}` : st.stamp;
  const landed = since - COUNT_FRAMES;
  const punch = prev ? interpolate(landed, [0, 4, 12], [1.18, 0.96, 1], clamp) : 1;
  const slam = prev && !counting && prev.unit !== st.unit ? interpolate(since, [0, 6], [0, 1], clamp) : 1;
  const flash = prev ? interpolate(landed, [0, 10], [0.55, 0], clamp) : 0;
  const enter = interpolate(frame, [0, 10], [0, 1], clamp);

  // The danger bar rises over the stage's first part, from where the last stage left it.
  const level = interpolate(frame, [st.from, st.from + (st.to - st.from) * 0.7], [st.levelFrom, st.level], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const color = danger(level);

  const size = short ? 118 : 74;
  const barW = short ? width * 0.56 : width * 0.22;
  return (
    <div
      style={{
        position: "absolute",
        top: short ? height * 0.138 : height * 0.035,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: enter,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          padding: short ? "10px 36px 6px" : "6px 24px 4px",
          borderRadius: 18,
          background: "rgba(8,10,18,0.62)",
          border: `3px solid ${color}`,
          boxShadow: `0 10px 40px rgba(0,0,0,0.45), 0 0 ${24 + 40 * flash}px ${color}${flash > 0.05 ? "cc" : "55"}`,
          transform: `scale(${punch * (0.6 + 0.4 * slam)}) translateY(${(1 - slam) * -40}px)`,
          opacity: slam,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, monospace",
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1,
            letterSpacing: "0.04em",
            color: theme.text,
            textShadow: `0 4px 0 rgba(0,0,0,0.5)`,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {shown}
        </div>
        <div style={{ position: "absolute", inset: 0, borderRadius: 15, background: "#ffffff", opacity: flash * 0.5 }} />
      </div>
      {st.note ? (
        <div
          style={{
            marginTop: short ? 16 : 10,
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: short ? 58 : 36,
            color,
            textShadow: "0 3px 10px rgba(0,0,0,0.7)",
            opacity: prev ? interpolate(landed, [0, 8], [0, 1], clamp) : 1,
            transform: `translateY(${prev ? interpolate(landed, [0, 8], [12, 0], clamp) : 0}px)`,
          }}
        >
          {st.note}
        </div>
      ) : null}
      <div
        style={{
          marginTop: short ? 18 : 10,
          width: barW,
          height: short ? 16 : 10,
          borderRadius: 99,
          background: "rgba(255,255,255,0.16)",
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ width: `${Math.max(2, level * 100)}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${danger(0)}, ${color})` }} />
      </div>
    </div>
  );
};
