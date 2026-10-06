import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Scene, Theme } from "../types";
import { unit } from "../theme";

export type SceneProps = { scene: Scene; theme: Theme; format: Format };

// ---------- shared helpers ----------

export const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delayFrames, fps, config: { damping: 16, mass: 0.7 } });
};

export const Stage: React.FC<{ format: Format; children: React.ReactNode; justify?: string }> = ({
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

export const Heading: React.FC<{ text?: string | null; theme: Theme; format: Format; size?: number; delay?: number }> = ({
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

export const Sub: React.FC<{ text?: string | null; theme: Theme; format: Format; delay?: number }> = ({
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

// Stable pick from a list by scene id, so a scene looks the same on every render.
export const pick = <T,>(id: string, options: readonly T[]): T => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return options[h % options.length];
};
