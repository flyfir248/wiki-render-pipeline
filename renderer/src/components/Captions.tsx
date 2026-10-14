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
        // The spoken word lifts a little and a red thread runs under it while it is said.
        const said = Math.max(0, Math.min(1, (t - w.start) / Math.max(0.12, w.end - w.start)));
        const lift = active ? spring({ frame: frame - Math.round(w.start * fps), fps, config: { damping: 10, mass: 0.4 } }) : 0;
        return (
          <span
            key={i}
            style={{
              position: "relative",
              color: active ? theme.accent : theme.text,
              marginRight: "0.28em",
              display: "inline-block",
              transform: `translateY(${-0.06 * lift}em) scale(${1 + 0.1 * lift})`,
            }}
          >
            {w.word}
            {active ? (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: "-0.04em",
                  height: "0.09em",
                  width: `${said * 100}%`,
                  borderRadius: "0.05em",
                  background: "#c3272b",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
                }}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
};
