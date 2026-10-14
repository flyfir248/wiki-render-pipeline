import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Scene, Theme } from "../types";
import { unit } from "../theme";

export type SceneProps = { scene: Scene; theme: Theme; format: Format };

// ---------- shared helpers ----------

export const formatNumber = (n: number) =>
  Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : n % 1 === 0 ? String(n) : n.toFixed(1);

export const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delayFrames, fps, config: { damping: 16, mass: 0.7 } });
};

// Set when a scene sits over a photo: its content then goes on a dark panel, so the photo can stay
// bright around it instead of being darkened as a whole. The value is the panel's colour.
export const PanelContext = React.createContext<string | null>(null);

const column = { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 36 } as const;

export const Stage: React.FC<{ format: Format; children: React.ReactNode; justify?: string }> = ({
  format,
  children,
  justify = "center",
}) => {
  const panel = React.useContext(PanelContext);
  const short = format === "short";
  return (
    <AbsoluteFill style={{ ...column, padding: short ? "220px 80px 560px" : "90px 160px 170px", justifyContent: justify }}>
      {panel ? (
        <div
          style={{
            ...column,
            maxWidth: "100%",
            padding: short ? "52px 44px" : "48px 64px",
            borderRadius: 40,
            background: `${panel}d9`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </AbsoluteFill>
  );
};

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
