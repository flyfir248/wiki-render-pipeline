import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

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
