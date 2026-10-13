// An investigator's evidence board in a dark room: a flashlight finds each clue card as it is pinned
// and typed out, red string runs between them, the last clue is circled in marker, and the camera
// pulls back to show the whole board. A stamp (UNSOLVED, CLASSIFIED) can slam onto it at the end.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format } from "../types";
import { pick, type SceneProps } from "./shared";

const MONO = "'Special Elite', 'Courier Prime', 'Courier New', 'DejaVu Sans Mono', monospace";
const STRING = "#c3272b";
const CARD = "#ece3cc";
const INK = "#1d1a16";

// Where things are pinned, in % of the board. The photo (when there is one) takes the middle.
const SLOTS: Record<Format, { photo: [number, number]; clues: [number, number][] }> = {
  long: { photo: [50, 50], clues: [[20, 32], [79, 30], [24, 76], [77, 74], [50, 84]] },
  short: { photo: [50, 40], clues: [[29, 22], [72, 28], [27, 52], [73, 58], [48, 72]] },
};

const ease = Easing.inOut(Easing.cubic);

export const EvidenceScene: React.FC<SceneProps> = ({ scene, format }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: D, width, height } = useVideoConfig();
  const short = format === "short";
  const clues = (scene.items ?? []).filter(Boolean).slice(0, 5);
  const photo = scene.media?.kind === "image" ? scene.media.src : null;
  const slots = SLOTS[format];
  // Each card is pinned as the narration names its clue, or spread evenly when timings are missing.
  const said = scene.revealTimes?.length === clues.length ? scene.revealTimes : null;
  const at = (i: number) =>
    said ? Math.max(0, Math.round(said[i] * fps) - 6) : Math.round(D * 0.08 + (i * D * 0.62) / Math.max(clues.length, 1));
  const pullBack = Math.max(at(clues.length - 1) + 36, Math.round(D * 0.78));
  const stampAt = Math.min(D - 15, Math.max(Math.round(D * 0.84), pullBack + 10));

  // Camera: arrive on each clue as it is pinned and hold there, moving on just before the next one,
  // then pull back to the whole board.
  const start: [number, number, number, number] = [0, photo ? slots.photo[0] : 50, photo ? slots.photo[1] : 50, 1.25];
  const stops = clues.flatMap((_, i): [number, number, number, number][] => {
    const [cx, cy] = slots.clues[i];
    const leave = (i + 1 < clues.length ? at(i + 1) : pullBack) - 14;
    return [
      [at(i) + 6, cx, cy, 1.5],
      [Math.max(at(i) + 7, leave), cx, cy, 1.5],
    ];
  });
  const frames = [start, ...stops, [pullBack, 50, 50, 1.02], [Math.max(pullBack + 24, D), 50, 50, 1.0]];
  // interpolate needs rising keys
  const keys = frames.reduce<number[]>((out, [k]) => [...out, out.length ? Math.max(k, out[out.length - 1] + 1) : k], []);
  const [xs, ys, zs] = [1, 2, 3].map((c) => frames.map((f) => f[c]));
  const moveTo = (values: number[]) =>
    interpolate(frame, keys, values, { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const z = moveTo(zs);
  // Keep the board's edges out of frame.
  const room = ((1 - 1 / z) / 2) * 100;
  const clamp = (v: number) => Math.max(-room, Math.min(room, v));
  const [fx, fy] = [moveTo(xs), moveTo(ys)];
  const dx = clamp(50 - fx) + Math.sin(frame / 37) * 0.35;
  const dy = clamp(50 - fy) + Math.cos(frame / 43) * 0.3;
  // A thump on the board each time a pin goes in.
  const thump = clues.reduce((s, _, i) => s + Math.max(0, 1 - Math.abs(frame - at(i) - 4) / 5) * 0.012, 0);
  // The stamp hits hard: the board jolts for a few frames.
  const hit = frame >= stampAt && frame < stampAt + 8 && scene.text ? (1 - (frame - stampAt) / 8) * 14 : 0;
  const shakeX = hit * (random(`sx${frame}`) - 0.5);
  const shakeY = hit * (random(`sy${frame}`) - 0.5);

  const hub = photo ? slots.photo : null;
  const anchor = (i: number): [number, number] => slots.clues[i];
  const strings = clues.map((_, i) => {
    const from = hub ?? (i > 0 ? anchor(i - 1) : null);
    if (!from) return null;
    const to = anchor(i);
    const p = interpolate(frame, [at(i) + 4, at(i) + 22], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    // Board % to pixels, so the string keeps its thickness; it sags a little between pins.
    const [x1, y1, x2, y2] = [(from[0] * width) / 100, (from[1] * height) / 100, (to[0] * width) / 100, (to[1] * height) / 100];
    const sag = 40 + Math.abs(x2 - x1) * 0.12;
    const d = `M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag} ${x2} ${y2}`;
    return { d, p, key: i };
  });

  return (
    <AbsoluteFill style={{ background: "#120d09", overflow: "hidden" }}>
      <AbsoluteFill
        style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${z + thump}) translate(${dx}%, ${dy}%)`, transformOrigin: "50% 50%" }}
      >
        <Board />
        {scene.heading ? <CaseLabel text={scene.heading} short={short} /> : null}
        {photo ? <PinnedPhoto src={photo} x={slots.photo[0]} y={slots.photo[1]} short={short} /> : null}
        <svg viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
          {strings.map((s) =>
            s ? (
              <path
                key={s.key}
                d={s.d}
                fill="none"
                stroke={STRING}
                strokeWidth={5}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1"
                strokeDashoffset={1 - s.p}
                style={{ filter: "drop-shadow(0 3px 2px rgba(0,0,0,0.6))" }}
              />
            ) : null,
          )}
        </svg>
        {clues.map((text, i) => (
          <ClueCard
            key={i}
            id={`${scene.id}-${i}`}
            text={text}
            n={i + 1}
            at={at(i)}
            x={anchor(i)[0]}
            y={anchor(i)[1]}
            short={short}
            circled={i === clues.length - 1 && clues.length > 1}
          />
        ))}
      </AbsoluteFill>
      {/* the beam sits on what the camera is looking at, wherever the board's edge put it on screen */}
      <Flashlight z={z} pullBack={pullBack} x={50 + z * (fx - 50 + dx)} y={50 + z * (fy - 50 + dy)} />
      <Dust />
      <Grain />
      {scene.text ? <Stamp text={scene.text} at={stampAt} fps={fps} short={short} /> : null}
    </AbsoluteFill>
  );
};

// Dark cork, drawn with noise so no texture file is needed.
const Board: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #5a3f28 0%, #3a2818 60%, #24180e 100%)" }}>
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.8, mixBlendMode: "multiply" }}>
      <filter id="cork">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} seed={7} />
        <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 1.4 -0.2" />
      </filter>
      <rect width="100%" height="100%" filter="url(#cork)" />
    </svg>
  </AbsoluteFill>
);

const Pin: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: -size * 0.45,
      width: size,
      height: size,
      marginLeft: -size / 2,
      borderRadius: "50%",
      background: `radial-gradient(circle at 35% 30%, #ff8a80, ${STRING} 45%, #6d0f12 100%)`,
      boxShadow: "0 6px 6px rgba(0,0,0,0.55)",
      zIndex: 2,
    }}
  />
);

const ClueCard: React.FC<{ id: string; text: string; n: number; at: number; x: number; y: number; short: boolean; circled: boolean }> = ({
  id,
  text,
  n,
  at,
  x,
  y,
  short,
  circled,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 13, mass: 0.6 } });
  const tilt = pick(id, [-5, -3, -1.5, 2, 3.5, 5]);
  const cardW = short ? 400 : 390;
  // Typed out after the pin goes in; the card keeps its full size so nothing reflows.
  const typed = Math.floor(interpolate(frame, [at + 6, at + 6 + Math.min(24, text.length * 1.2)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: cardW,
        transform: `translate(-50%, -50%) rotate(${tilt}deg) scale(${interpolate(p, [0, 1], [1.35, 1])})`,
        opacity: interpolate(p, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
        padding: short ? "34px 30px 30px" : "30px 28px 26px",
        background: `linear-gradient(${CARD}, #e2d6b8)`,
        backgroundImage: `repeating-linear-gradient(transparent 0 46px, rgba(70,110,170,0.22) 46px 48px), linear-gradient(${CARD}, #ddd0b0)`,
        boxShadow: `0 ${interpolate(p, [0, 1], [40, 12])}px ${interpolate(p, [0, 1], [60, 18])}px rgba(0,0,0,0.6)`,
        color: INK,
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: short ? 40 : 36,
        lineHeight: 1.2,
        zIndex: 1,
      }}
    >
      <Pin />
      <div style={{ fontSize: "0.55em", letterSpacing: 3, color: STRING, marginBottom: 10 }}>CLUE {String(n).padStart(2, "0")}</div>
      <span>{text.slice(0, typed)}</span>
      <span style={{ visibility: "hidden" }}>{text.slice(typed)}</span>
      {circled ? <MarkerCircle at={at + 34} /> : null}
    </div>
  );
};

// A red marker loop scrawled around the card, then a question mark beside it.
const MarkerCircle: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const loop = interpolate(frame, [at, at + 16], [0, 1], { easing: Easing.out(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const mark = interpolate(frame, [at + 14, at + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < at) return null;
  const pen = { fill: "none", stroke: "#e0262c", strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round", pathLength: 1, strokeDasharray: "1" } as const;
  return (
    <svg viewBox="0 0 200 120" preserveAspectRatio="none" style={{ position: "absolute", left: "-14%", top: "-24%", width: "128%", height: "148%", overflow: "visible", pointerEvents: "none" }}>
      {/* slightly more than one turn, so the ends overlap like a real pen loop */}
      <path {...pen} d="M30 22 C 80 2, 170 4, 192 40 C 210 80, 150 116, 90 114 C 30 112, 2 86, 8 56 C 14 26, 60 10, 120 12" strokeDashoffset={1 - loop} />
      <path {...pen} strokeWidth={9} d="M206 6 C 214 -8, 238 -6, 236 10 C 234 24, 218 24, 220 38" strokeDashoffset={1 - mark} />
      <circle cx={220} cy={52} r={5} fill="#e0262c" opacity={mark >= 1 ? 1 : 0} />
    </svg>
  );
};

// A flashlight beam in a dark room: it looks where the camera looks, flickers a little, and widens
// as the camera pulls back so the whole board is lit at the end.
const Flashlight: React.FC<{ z: number; pullBack: number; x: number; y: number }> = ({ z, pullBack, x, y }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const flicker = 1 - 0.06 * random(`f${Math.floor(frame / 2)}`) - (random(`d${Math.floor(frame / 9)}`) < 0.04 ? 0.25 : 0);
  const lit = interpolate(frame, [pullBack - 10, pullBack + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const r = Math.max(width, height) * interpolate(lit, [0, 1], [0.32 + (1.5 - z) * 0.2, 0.75]);
  const cx = interpolate(lit, [0, 1], [x, 50]) + Math.sin(frame / 23) * 2.5;
  const cy = interpolate(lit, [0, 1], [y, 47]) + Math.cos(frame / 29) * 2;
  const dark = interpolate(lit, [0, 1], [0.9, 0.6]) * flicker + (1 - flicker) * 0.9;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle ${r}px at ${cx}% ${cy}%, rgba(0,0,0,${1 - flicker}) 0%, rgba(0,0,0,${0.15 + (1 - flicker)}) 55%, rgba(0,0,0,${dark}) 100%)`,
        }}
      />
      {/* warm bulb colour inside the beam */}
      <AbsoluteFill style={{ background: `radial-gradient(circle ${r * 0.8}px at ${cx}% ${cy}%, rgba(255,200,120,0.16), transparent 70%)`, mixBlendMode: "screen" }} />
    </AbsoluteFill>
  );
};

// Dust drifting through the beam.
const Dust: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: 26 }, (_, i) => {
        const x = (random(`dx${i}`) * 100 + frame * (0.02 + random(`vx${i}`) * 0.05)) % 100;
        const y = (random(`dy${i}`) * 100 - frame * (0.03 + random(`vy${i}`) * 0.06) + 1000) % 100;
        const size = 2 + random(`ds${i}`) * 4;
        const glow = 0.25 + 0.35 * Math.sin(frame / (12 + i) + i);
        // Only motes near the middle, where the beam is, catch the light.
        const inBeam = Math.max(0, 1 - Math.hypot(x - 50, y - 47) / 35);
        return (
          <div
            key={i}
            style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: size, height: size, borderRadius: "50%", background: "#ffe6bf", opacity: glow * inBeam, filter: "blur(1px)" }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Film grain, a new pattern every two frames.
const Grain: React.FC = () => {
  const seed = Math.floor(useCurrentFrame() / 2) % 12;
  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.09, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <filter id={`grain${seed}`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
      </filter>
      <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
    </svg>
  );
};

const PinnedPhoto: React.FC<{ src: string; x: number; y: number; short: boolean }> = ({ src, x, y, short }) => {
  const p = spring({ frame: useCurrentFrame(), fps: useVideoConfig().fps, config: { damping: 14 } });
  const size = short ? 520 : 440;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        padding: "18px 18px 70px",
        background: "#f3efe6",
        transform: `translate(-50%, -50%) rotate(-2.5deg) scale(${interpolate(p, [0, 1], [1.2, 1])})`,
        opacity: p,
        boxShadow: "0 18px 30px rgba(0,0,0,0.6)",
      }}
    >
      <Pin size={40} />
      <Img src={staticFile(src)} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", filter: "grayscale(1) sepia(0.35) contrast(1.15)" }} />
    </div>
  );
};

// The case name on a strip of masking tape across the top of the board.
const CaseLabel: React.FC<{ text: string; short: boolean }> = ({ text, short }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: short ? "9%" : "8%",
      transform: "translateX(-50%) rotate(-1.5deg)",
      padding: "14px 40px",
      background: "rgba(232, 214, 160, 0.92)",
      boxShadow: "0 6px 12px rgba(0,0,0,0.45)",
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: short ? 46 : 42,
      letterSpacing: 4,
      color: INK,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </div>
);

const Stamp: React.FC<{ text: string; at: number; fps: number; short: boolean }> = ({ text, at, fps, short }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const p = spring({ frame: frame - at, fps, config: { damping: 11, mass: 0.5, stiffness: 220 } });
  const flash = interpolate(frame - at, [0, 2, 6], [0, 0.35, 0], { extrapolateRight: "clamp" });
  const landed = frame - at >= 4;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: short ? 380 : 0 }}>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <div
        style={{
          position: "relative",
          transform: `rotate(-12deg) scale(${interpolate(p, [0, 1], [2.6, 1])})`,
          opacity: interpolate(p, [0, 0.25], [0, 0.92], { extrapolateRight: "clamp" }),
          padding: "14px 46px",
          border: `10px solid ${STRING}`,
          borderRadius: 14,
          color: STRING,
          fontFamily: MONO,
          fontWeight: 900,
          fontSize: short ? 120 : 140,
          letterSpacing: 10,
          textTransform: "uppercase",
          textShadow: "0 0 2px rgba(0,0,0,0.4)",
          background: "rgba(20,10,8,0.25)",
        }}
      >
        {text}
        {/* ink spattered by the impact */}
        {landed
          ? Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${random(`sp${i}`) * 110 - 5}%`,
                  top: `${random(`sq${i}`) > 0.5 ? 108 + random(`sr${i}`) * 25 : -12 - random(`sr${i}`) * 25}%`,
                  width: 6 + random(`ss${i}`) * 16,
                  height: 6 + random(`ss${i}`) * 16,
                  borderRadius: "50%",
                  background: STRING,
                }}
              />
            ))
          : null}
      </div>
    </AbsoluteFill>
  );
};
