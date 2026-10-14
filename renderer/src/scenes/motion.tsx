// Code-drawn motion graphics for explainers. Every picture is a pure function of the frame, drawn in
// SVG, so the same frame always looks the same and any frame can be checked on its own
// (`python -m fyt sheet` lays frames out on a contact sheet).
//
// trend:      a line chart drawn by a glowing pen that stops at each point, its value counting beside it
// proportion: a 10 x 10 grid of dots that light up to show a share ("67 in 100")
// scale:      circles sized by value; the camera starts on the smallest and pulls out to reveal each
//             bigger one, so a speck next to a giant reads at a glance
// cycle:      steps around a loop, joined by arrows that draw themselves, then a comet runs the loop
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { DataPoint, Format, Scene, Theme } from "../types";
import { unit } from "../theme";
import { Heading, Sub, formatNumber, type SceneProps } from "./shared";

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// When each of n pieces appears: as the narration says it, or spread evenly over the scene.
const revealFrames = (scene: Scene, n: number, D: number, fps: number, from = 0.1, to = 0.68) => {
  const said = scene.revealTimes?.length === n ? scene.revealTimes : null;
  return Array.from({ length: n }, (_, i) =>
    said ? Math.max(4, Math.round(said[i] * fps) - 4) : Math.round(D * from + (n > 1 ? (i * D * (to - from)) / (n - 1) : 0)),
  );
};

// A small jolt of the camera each time something lands, so reveals hit instead of just appearing.
const kick = (frame: number, at: number[]) =>
  1 + at.reduce((sum, a) => sum + Math.max(0, 1 - Math.abs(frame - a - 3) / 6) * 0.018, 0);

const valueText = (scene: Scene, v: number) => `${scene.prefix ?? ""}${formatNumber(v)}${scene.suffix ?? ""}`;

// A round step size for about `count` gridlines between 0 and `span`.
const niceStep = (span: number, count = 4) => {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
};

const Glow: React.FC<{ id: string; blur: number }> = ({ id, blur }) => (
  <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation={blur} result="b" />
    <feMerge>
      <feMergeNode in="b" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
);

// ---------- trend ----------

const isYearLabel = (s: string) => /^-?\d{3,4}$/.test(s.trim());

export const TrendScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps } = useVideoConfig();
  const short = format === "short";
  const data: DataPoint[] = (scene.data ?? []).filter((d) => Number.isFinite(d.value)).slice(0, 12);
  const n = data.length;
  const W = short ? 900 : 1560;
  const H = short ? 760 : 640;
  const pad = { l: short ? 120 : 150, r: short ? 50 : 80, t: 80, b: 80 };
  const k = unit(format);

  // Years are spaced by time; anything else is evenly spaced.
  const years = data.map((d) => (isYearLabel(d.label) ? Number(d.label) : NaN));
  const byYear = n > 1 && years.every((y, i) => Number.isFinite(y) && (i === 0 || y > years[i - 1]));
  const fx = data.map((_, i) =>
    n < 2 ? 0.5 : byYear ? (years[i] - years[0]) / (years[n - 1] - years[0]) : i / (n - 1),
  );
  const values = data.map((d) => d.value);
  const lo0 = Math.min(0, ...values);
  const hi0 = Math.max(...values, lo0 + 1);
  const step = niceStep(hi0 - lo0);
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil((hi0 * 1.04) / step) * step;
  const X = (f: number) => pad.l + f * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  // The pen travels point to point, easing into each one and pausing there a moment.
  const start = 14;
  const span = Math.max(30, D * 0.68 - start);
  const seg = n > 1 ? span / (n - 1) : span;
  const reach = data.map((_, i) => start + i * seg);
  const along = n < 2 ? 0 : Math.min(n - 1, Math.max(0, (frame - start) / seg));
  const i0 = Math.floor(along);
  const u = interpolate(along - i0, [0, 0.82], [0, 1], { ...clamp, easing: ease });
  const t = Math.min(n - 1, i0 + u);
  const lerp = (a: number, b: number) => a + (b - a) * (t - Math.floor(t));
  const j = Math.floor(t);
  const penF = n < 2 ? fx[0] ?? 0.5 : j >= n - 1 ? fx[n - 1] : lerp(fx[j], fx[j + 1]);
  const penV = n < 2 ? values[0] ?? 0 : j >= n - 1 ? values[n - 1] : lerp(values[j], values[j + 1]);
  const pen: [number, number] = [X(penF), Y(penV)];
  const drawn = [...data.slice(0, j + 1).map((d, i) => [X(fx[i]), Y(d.value)] as [number, number]), pen];
  const line = drawn.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pen[0].toFixed(1)} ${Y(Math.max(lo, 0))} L${X(fx[0] ?? 0)} ${Y(Math.max(lo, 0))} Z`;
  const done = frame >= start + span;

  // The highest point gets a ring and the scene's note once the line is drawn.
  const peak = values.indexOf(Math.max(...values));
  const callout = spring({ frame: frame - (start + span + 6), fps, config: { damping: 14 } });
  const grid = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease });
  const zoom = interpolate(frame, [0, D], [1.05, 1], clamp);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  // Axis labels too close to the one before are dropped (the last one always shows).
  const shownLabel = data.map(() => false);
  let lastX = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (lastX - X(fx[i]) >= (short ? 110 : 120)) {
      shownLabel[i] = true;
      lastX = X(fx[i]);
    } else if (i === n - 1) {
      shownLabel[i] = true;
      lastX = X(fx[i]);
    }
  }
  // The running value shows as many decimals as the data has.
  const whole = values.every((v) => Number.isInteger(v));
  const penShown = whole ? Math.round(penV) : Math.round(penV * 10) / 10;
  const tagW = 40 + valueText(scene, penShown).length * 22 * k * 0.8;
  const tagX = Math.max(pad.l, Math.min(W - pad.r - tagW, pen[0] - tagW / 2));
  const tagAbove = pen[1] - pad.t > 70;
  const pX = X(fx[peak] ?? 0);
  const pY = Y(values[peak] ?? 0);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: short ? "200px 60px 560px" : "70px 120px 170px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, transform: `scale(${zoom * kick(frame, reach)})` }}>
        <Heading text={scene.heading} theme={theme} format={format} size={56} />
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
          <defs>
            <Glow id={`tg-${scene.id}`} blur={8} />
            <linearGradient id={`ta-${scene.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={theme.accent} stopOpacity={0.35} />
              <stop offset="1" stopColor={theme.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((v, i) => (
            <g key={v} opacity={grid}>
              <line
                x1={pad.l}
                x2={pad.l + (W - pad.l - pad.r) * interpolate(frame, [i * 2, i * 2 + 20], [0, 1], { ...clamp, easing: ease })}
                y1={Y(v)}
                y2={Y(v)}
                stroke={v === 0 ? theme.muted : `${theme.muted}40`}
                strokeWidth={v === 0 ? 3 : 2}
                strokeDasharray={v === 0 ? undefined : "6 10"}
              />
              <text x={pad.l - 18} y={Y(v) + 10} textAnchor="end" fill={theme.muted} fontFamily={theme.font} fontSize={30 * k} fontWeight={600}>
                {valueText(scene, v)}
              </text>
            </g>
          ))}
          {n > 1 ? <path d={area} fill={`url(#ta-${scene.id})`} /> : null}
          {n > 1 ? (
            <path d={line} fill="none" stroke={theme.accent} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" filter={`url(#tg-${scene.id})`} />
          ) : null}
          {data.map((d, i) => {
            const pop = spring({ frame: frame - reach[i], fps, config: { damping: 11, mass: 0.6 } });
            const x = X(fx[i]);
            return (
              <g key={i}>
                <circle cx={x} cy={Y(d.value)} r={11 * pop} fill={theme.background} stroke={theme.accent} strokeWidth={6} />
                {shownLabel[i] ? (
                  <text
                    x={x}
                    y={H - pad.b + 48 * k}
                    textAnchor="middle"
                    fill={theme.text}
                    opacity={Math.min(1, pop)}
                    fontFamily={theme.font}
                    fontSize={32 * k}
                    fontWeight={700}
                  >
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* the pen and its running value */}
          {!done || callout < 0.5 ? (
            <g opacity={interpolate(frame, [start - 8, start, start + span, start + span + 10], [0, 1, 1, 0], clamp)}>
              <circle cx={pen[0]} cy={pen[1]} r={16} fill={theme.accent} filter={`url(#tg-${scene.id})`} />
              <rect
                x={tagX}
                y={tagAbove ? pen[1] - 92 : pen[1] + 30}
                width={tagW}
                height={58}
                rx={14}
                fill={theme.accent}
              />
              <text
                x={tagX + tagW / 2}
                y={tagAbove ? pen[1] - 52 : pen[1] + 70}
                textAnchor="middle"
                fill={theme.background}
                fontFamily={theme.font}
                fontSize={32 * k * 0.9}
                fontWeight={900}
              >
                {valueText(scene, penShown)}
              </text>
            </g>
          ) : null}
          {n > 0 ? (
            <g opacity={callout}>
              <circle cx={pX} cy={pY} r={22 + 26 * callout} fill="none" stroke={theme.accent2} strokeWidth={5} opacity={1 - callout * 0.4} />
              <text
                x={Math.max(pad.l + 10, Math.min(W - pad.r - 10, pX))}
                y={pY - 62 < 40 ? pY + 92 : pY - 56}
                textAnchor={pX > W * 0.75 ? "end" : pX < W * 0.25 ? "start" : "middle"}
                fill={theme.accent2}
                fontFamily={theme.font}
                fontSize={40 * k}
                fontWeight={900}
              >
                {valueText(scene, values[peak])}
              </text>
            </g>
          ) : null}
        </svg>
        <Sub text={scene.text} theme={theme} format={format} delay={Math.round(start + span + 10)} />
      </div>
    </AbsoluteFill>
  );
};

// ---------- proportion ----------

// value is a share: a percentage (67) or a fraction (0.67).
export const shareOf = (value: number | null | undefined) => {
  const v = value ?? 0;
  return Math.max(0, Math.min(100, v > 0 && v <= 1 ? v * 100 : v));
};

export const ProportionScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps } = useVideoConfig();
  const short = format === "short";
  const share = shareOf(scene.value);
  const lit = Math.round(share);
  const cell = short ? 70 : 60;
  const size = cell * 10;
  const fillFrom = 28;
  const fillTo = Math.max(fillFrom + 30, Math.round(D * 0.55));
  const filled = interpolate(frame, [fillFrom, fillTo], [0, share], { ...clamp, easing: ease });
  const counted = interpolate(frame, [fillFrom, fillTo], [0, share], { ...clamp, easing: ease });
  const shown = Number.isInteger(share) ? Math.round(counted) : Math.round(counted * 10) / 10;
  const pulseFrom = fillTo + 8;
  const number = spring({ frame: frame - fillTo, fps, config: { damping: 8 } });

  const dots = Array.from({ length: 100 }, (_, i) => {
    const r = Math.floor(i / 10);
    const c = i % 10;
    const appear = spring({ frame: frame - (4 + (r + c) * 1.1), fps, config: { damping: 13, mass: 0.5 } });
    const on = Math.max(0, Math.min(1, filled - i));
    const wave = frame > pulseFrom && i < lit ? 0.12 * Math.max(0, Math.sin((frame - pulseFrom) / 6 - (r + c) * 0.45)) : 0;
    return (
      <circle
        key={i}
        cx={c * cell + cell / 2}
        cy={r * cell + cell / 2}
        r={cell * 0.36 * appear * (1 + wave + on * (1 - on) * 0.8)}
        fill={on > 0 ? theme.accent : "rgba(255,255,255,0.13)"}
        opacity={on > 0 ? 0.35 + 0.65 * on : 1}
      />
    );
  });

  const figure = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: short ? "center" : "flex-start", gap: 14, maxWidth: short ? 900 : 640 }}>
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 900,
          fontSize: 200 * unit(format) * (short ? 0.85 : 1),
          lineHeight: 1,
          color: theme.accent,
          transform: `scale(${1 + 0.06 * number * Math.max(0, 1 - (frame - fillTo) / 30)})`,
          textShadow: `0 0 50px ${theme.accent}55`,
        }}
      >
        {scene.prefix ?? ""}
        {shown}
        {scene.suffix ?? "%"}
      </div>
      <Sub text={scene.text} theme={theme} format={format} delay={fillFrom} />
    </div>
  );

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: short ? "200px 60px 560px" : "70px 140px 170px", gap: 40 }}>
      <Heading text={scene.heading} theme={theme} format={format} size={56} />
      <div style={{ display: "flex", flexDirection: short ? "column" : "row", alignItems: "center", gap: short ? 40 : 110 }}>
        {short ? figure : null}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {dots}
        </svg>
        {short ? null : figure}
      </div>
    </AbsoluteFill>
  );
};

// ---------- scale ----------

type Stage = { zoom: number; cx: number };

export const ScaleScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps, width, height } = useVideoConfig();
  const short = format === "short";
  const k = unit(format);
  const items = [...(scene.data ?? [])].filter((d) => d.value > 0).sort((a, b) => a.value - b.value).slice(0, 5);
  const n = items.length;
  const vmax = Math.max(...items.map((d) => d.value), 1);
  // Area follows the value, so a circle 4 times the value is twice as wide.
  const radius = items.map((d) => Math.sqrt(d.value / vmax) * 1000);
  const xs: number[] = [];
  radius.forEach((r, i) => xs.push(i === 0 ? r : xs[i - 1] + radius[i - 1] + Math.max(r * 0.12, radius[i - 1] * 0.5) + r));

  // The view: ground line at a fixed height on screen; the camera frames all circles revealed so far.
  // Low enough for big circles, high enough that labels under the ground clear the captions.
  const groundY = short ? height * 0.6 : height * 0.7;
  const top = short ? 520 : 300;
  const sidePad = short ? 90 : 160;
  const stages: Stage[] = items.map((_, i) => {
    const left = xs[0] - radius[0];
    const right = xs[i] + radius[i];
    const zoom = Math.min((groundY - top) / (2 * radius[i]), (width - 2 * sidePad) / (right - left));
    return { zoom, cx: (left + right) / 2 };
  });
  const at = revealFrames(scene, n, D, fps, 0.06, 0.7);
  if (n) at[0] = Math.min(at[0], 12); // never open on an empty stage
  const MOVE = Math.max(18, Math.min(34, Math.round(D / (3 * Math.max(n, 1)))));
  // Which stage the camera is in, and how far it has moved toward the next.
  let s = 0;
  let u = 0;
  for (let i = 1; i < n; i++) {
    if (frame >= at[i] - MOVE / 2) {
      s = i - 1;
      u = interpolate(frame, [at[i] - MOVE / 2, at[i] + MOVE / 2], [0, 1], { ...clamp, easing: ease });
      if (u >= 1) {
        s = i;
        u = 0;
      }
    }
  }
  const a = stages[s] ?? { zoom: 1, cx: 0 };
  const b = stages[Math.min(s + 1, n - 1)] ?? a;
  // Zoom moves evenly in log space; the centre moves so the view's edges glide rather than lurch.
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * u);
  const w = a.zoom === b.zoom ? u : (1 / a.zoom - 1 / zoom) / (1 / a.zoom - 1 / b.zoom);
  const cx = a.cx + (b.cx - a.cx) * w;
  const drift = interpolate(frame, [0, D], [1, 0.97]);
  const Z = zoom * drift * kick(frame, at);
  const sx = (x: number) => width / 2 + (x - cx) * Z;

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <Glow id={`sg-${scene.id}`} blur={14} />
          <radialGradient id={`sr-${scene.id}`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffffff" stopOpacity={0.35} />
            <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </radialGradient>
        </defs>
        <line x1={0} x2={width} y1={groundY} y2={groundY} stroke={`${theme.muted}66`} strokeWidth={3} />
        {items.map((d, i) => {
          const grow = spring({ frame: frame - at[i], fps, config: { damping: 14, mass: 0.8 } });
          const r = radius[i] * Z * grow;
          const x = sx(xs[i]);
          const newest = i === n - 1 || frame < at[i + 1];
          const color = newest ? theme.accent : theme.accent2;
          return (
            <g key={i} opacity={Math.min(1, grow * 1.5)}>
              <circle cx={x} cy={groundY - r} r={r} fill={color} opacity={0.92} filter={newest ? `url(#sg-${scene.id})` : undefined} />
              <circle cx={x} cy={groundY - r} r={r} fill={`url(#sr-${scene.id})`} />
              {/* a speck too small to see gets a ring so the eye can find it */}
              {r < 12 && grow > 0.5 ? (
                <circle cx={x} cy={groundY - 22} r={20} fill="none" stroke={color} strokeWidth={4} opacity={0.9} />
              ) : null}
            </g>
          );
        })}
      </svg>
      {items.map((d, i) => {
        const grow = spring({ frame: frame - at[i] - 6, fps, config: { damping: 16 } });
        const r = radius[i] * Z;
        // Labels sit above each circle; a speck's label shows only while it is the newest.
        const small = r < 12;
        const newest = i === n - 1 || frame < at[i + 1];
        if (small && !newest) {
          // A speck keeps a small label under the ground line, so the viewer knows what it is.
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: sx(xs[i]) - 20,
                top: groundY + 14,
                opacity: grow,
                whiteSpace: "nowrap",
                fontFamily: theme.font,
                fontWeight: 700,
                fontSize: 28 * k,
                color: theme.muted,
              }}
            >
              ↑ {d.label}, {valueText(scene, d.value)}
            </div>
          );
        }
        // Keep the label on screen even when its circle sits near the edge.
        const x = Math.max(260, Math.min(width - 260, sx(xs[i])));
        const y = groundY - 2 * Math.max(r, 22) - 24;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -100%) translateY(${(1 - grow) * 20}px)`,
              opacity: grow,
              textAlign: "center",
              whiteSpace: "nowrap",
              fontFamily: theme.font,
              textShadow: "0 4px 18px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 40 * k, color: theme.text }}>{d.label}</div>
            <div style={{ fontWeight: 700, fontSize: 32 * k, color: newest ? theme.accent : theme.accent2 }}>{valueText(scene, d.value)}</div>
          </div>
        );
      })}
      <AbsoluteFill style={{ alignItems: "center", padding: short ? "200px 60px 0" : "70px 120px 0" }}>
        <Heading text={scene.heading} theme={theme} format={format} size={56} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", padding: `${groundY + (short ? 90 : 64)}px 70px 0` }}>
        <Sub text={scene.text} theme={theme} format={format} delay={(at[n - 1] ?? 0) + MOVE} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- cycle ----------

// How far along the loop (degrees) a step's box reaches, so arrows start and end clear of it.
const clearance = (rx: number, ry: number, hw: number, hh: number, angle: number) => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const [cx, cy] = [rx * Math.cos(rad(angle)), ry * Math.sin(rad(angle))];
  for (let d = 2; d < 90; d += 1) {
    const [x, y] = [rx * Math.cos(rad(angle + d)), ry * Math.sin(rad(angle + d))];
    if (Math.abs(x - cx) > hw + 18 || Math.abs(y - cy) > hh + 18) return d;
  }
  return 90;
};

export const CycleScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: D, fps, width, height } = useVideoConfig();
  const short = format === "short";
  const steps = (scene.items ?? []).filter(Boolean).slice(0, 5);
  const n = steps.length;
  // The loop is an ellipse, wider than tall, so the steps leave room for the name in the middle.
  const [rx, ry] = short ? [320, 360] : [420, 280];
  const boxW = short ? 300 : n >= 5 ? 330 : 360;
  const boxH = short ? 130 : 116;
  const [cx, cy] = [width / 2, short ? 820 : 520];
  const angle = (i: number) => -90 + (i * 360) / Math.max(n, 1);
  const pos = (deg: number): [number, number] => [cx + rx * Math.cos((deg * Math.PI) / 180), cy + ry * Math.sin((deg * Math.PI) / 180)];
  const at = revealFrames(scene, n, D, fps, 0.08, 0.6);
  const loopFrom = (at[n - 1] ?? 0) + 30;
  const speed = 360 / (fps * 3.2); // one lap every ~3 seconds
  const comet = angle(0) + Math.max(0, frame - loopFrom) * speed;
  const running = frame >= loopFrom;
  const hw = boxW / 2;
  const hh = boxH / 2;

  const arcs = steps.map((_, i) => {
    // The box is symmetric, so the clearance on its far side is found by stepping backwards from the next step.
    const from = angle(i) + clearance(rx, ry, hw, hh, angle(i));
    const to = angle(i) + 360 / n - clearance(rx, ry, hw, hh, -angle(i + 1));
    // The arrow into step i+1 draws just before it appears; the closing arrow after the last step.
    const drawAt = i + 1 < n ? at[i + 1] - 16 : (at[n - 1] ?? 0) + 12;
    const p = interpolate(frame, [drawAt, drawAt + 16], [0, 1], { ...clamp, easing: ease });
    const end = from + (to - from) * p;
    const [x1, y1] = pos(from);
    const [x2, y2] = pos(end);
    const large = end - from > 180 ? 1 : 0;
    const th = (end * Math.PI) / 180;
    const tipAngle = Math.atan2(ry * Math.cos(th), -rx * Math.sin(th)); // the loop's direction at the arrow's end
    const tip = (len: number, side: number): [number, number] => [
      x2 - len * Math.cos(tipAngle) + side * len * 0.7 * Math.cos(tipAngle + Math.PI / 2),
      y2 - len * Math.sin(tipAngle) + side * len * 0.7 * Math.sin(tipAngle + Math.PI / 2),
    ];
    const [ax, ay] = tip(26, 1);
    const [bx, by] = tip(26, -1);
    return { d: `M${x1} ${y1} A${rx} ${ry} 0 ${large} 1 ${x2} ${y2}`, p, head: `M${ax} ${ay} L${x2} ${y2} L${bx} ${by}`, key: i };
  });

  const centre = spring({ frame: frame - loopFrom + 10, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ transform: `scale(${kick(frame, at)})` }}>
      <AbsoluteFill style={{ alignItems: "center", padding: short ? "200px 60px 0" : "60px 120px 0" }}>
        <Heading text={scene.heading} theme={theme} format={format} size={56} />
      </AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <Glow id={`cg-${scene.id}`} blur={10} />
        </defs>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`${theme.muted}22`} strokeWidth={2} strokeDasharray="4 14" />
        {n > 1
          ? arcs.map((a) => (
              <g key={a.key} opacity={a.p > 0 ? 1 : 0}>
                <path d={a.d} fill="none" stroke={theme.accent2} strokeWidth={7} strokeLinecap="round" />
                <path d={a.head} fill="none" stroke={theme.accent2} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={a.p >= 0.98 ? 1 : 0} />
              </g>
            ))
          : null}
        {running
          ? Array.from({ length: 14 }, (_, t) => {
              const [x, y] = pos(comet - t * 3.2);
              return <circle key={t} cx={x} cy={y} r={14 * (1 - t / 15)} fill={theme.accent} opacity={(1 - t / 14) * 0.9} filter={t === 0 ? `url(#cg-${scene.id})` : undefined} />;
            })
          : null}
      </svg>
      {steps.map((step, i) => {
        const p = spring({ frame: frame - at[i], fps, config: { damping: 12, mass: 0.6 } });
        const [x, y] = pos(angle(i));
        // A step glows as the comet passes through it.
        const gap = running ? Math.abs((((comet - angle(i)) % 360) + 360) % 360) : 999;
        const near = running ? Math.max(0, 1 - Math.min(gap, 360 - gap) / 25) : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - hw,
              top: y - hh,
              width: boxW,
              height: boxH,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "0 22px",
              boxSizing: "border-box",
              borderRadius: 24,
              background: near > 0.05 ? theme.accent : theme.background2,
              border: `4px solid ${near > 0.05 ? theme.accent : `${theme.accent2}aa`}`,
              color: near > 0.05 ? theme.background : theme.text,
              fontFamily: theme.font,
              fontWeight: 800,
              fontSize: (short ? 36 : 40) * (step.length > 22 ? 0.85 : 1),
              lineHeight: 1.1,
              opacity: Math.min(1, p * 1.4),
              transform: `scale(${(0.6 + 0.4 * p) * (1 + 0.07 * near)})`,
              boxShadow: near > 0.05 ? `0 0 ${50 * near}px ${theme.accent}aa` : "0 20px 50px rgba(0,0,0,0.4)",
            }}
          >
            {step}
          </div>
        );
      })}
      {scene.text ? (
        <div
          style={{
            position: "absolute",
            left: cx - rx + hw + 30,
            width: 2 * (rx - hw - 30),
            top: cy - 60,
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: 44 * (short ? 1.1 : 1),
            lineHeight: 1.05,
            color: theme.accent,
            opacity: centre,
            transform: `scale(${0.8 + 0.2 * centre})`,
          }}
        >
          {scene.text}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
