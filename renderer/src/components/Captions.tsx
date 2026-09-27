import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Theme, Word } from "../types";

// Group words into short phrases so only a few are on screen at once.
const chunk = (words: Word[], maxWords: number, maxGap = 0.6): Word[][] => {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const breakHere =
      cur.length >= maxWords || (prev && w.start - prev.end > maxGap) || (prev && /[.!?]$/.test(prev.word));
    if (breakHere && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
};

export const Captions: React.FC<{ words: Word[]; theme: Theme; format: Format }> = ({ words, theme, format }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const groups = React.useMemo(() => chunk(words, format === "short" ? 3 : 6), [words, format]);
  const group = groups.find((g) => t >= g[0].start - 0.05 && t <= g[g.length - 1].end + 0.25);
  if (!group) return null;

  const pop = spring({ frame: frame - Math.round(group[0].start * fps), fps, config: { damping: 14, mass: 0.6 } });
  const short = format === "short";
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.08,
        right: width * 0.08,
        top: short ? height * 0.68 : undefined,
        bottom: short ? undefined : height * 0.11,
        textAlign: "center",
        fontFamily: theme.font,
        fontWeight: 900,
        fontSize: short ? 84 : 54,
        lineHeight: 1.15,
        color: theme.text,
        textTransform: short ? "uppercase" : "none",
        textShadow: "0 6px 24px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.9)",
        transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`,
      }}
    >
      {group.map((w, i) => {
        const active = t >= w.start && t <= w.end + 0.05;
        return (
          <span key={i} style={{ color: active ? theme.accent : theme.text, marginRight: "0.28em", display: "inline-block" }}>
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
