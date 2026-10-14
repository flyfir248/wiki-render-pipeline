import React from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";

// Paper grain over everything, moved to a new spot every other frame so it "boils" like printed,
// hand-made animation (12 drawings a second) instead of sitting dead still over the picture.
const NOISE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">` +
      `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>` +
      `<feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.35"/></filter>` +
      `<rect width="300" height="300" filter="url(#n)"/></svg>`,
  );

export const Grain: React.FC<{ strength?: number }> = ({ strength = 0.07 }) => {
  const frame = useCurrentFrame();
  const step = Math.floor(frame / 2);
  const x = (step * 137) % 300;
  const y = (step * 89) % 300;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        backgroundImage: `url("${NOISE}")`,
        backgroundPosition: `${x}px ${y}px`,
        opacity: strength,
        mixBlendMode: "overlay",
      }}
    />
  );
};

// Atmosphere: dust drifting through the light, and a soft beam that sweeps across now and then, so
// even a held frame is never completely still. Every speck's path is a function of the frame.
const SPECKS = Array.from({ length: 34 }, (_, i) => ({
  x: random(`dx${i}`),
  y: random(`dy${i}`),
  r: 1.2 + random(`dr${i}`) * 3.2,
  speed: 0.15 + random(`ds${i}`) * 0.5,
  sway: random(`dw${i}`) * Math.PI * 2,
  glow: 0.12 + random(`dg${i}`) * 0.3,
}));

export const Atmosphere: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const SWEEP = 11; // seconds between beams
  const s = (t % SWEEP) / 2.6; // the beam crosses in 2.6 s, then rests
  const beam = s < 1 ? s : null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {SPECKS.map((p, i) => {
          const y = (((p.y * height - t * p.speed * 40) % height) + height) % height;
          const x = p.x * width + Math.sin(t * 0.6 + p.sway) * 18;
          return <circle key={i} cx={x} cy={y} r={p.r} fill="#fff6dc" opacity={p.glow * (0.6 + 0.4 * Math.sin(t * 1.3 + p.sway))} />;
        })}
      </svg>
      {beam !== null ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(110deg, transparent ${beam * 140 - 40}%, rgba(255,240,200,0.07) ${beam * 140 - 25}%, transparent ${beam * 140 - 10}%)`,
            mixBlendMode: "screen",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
