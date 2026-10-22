import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../types";

const CARD_SECONDS = 2.6;
const THREAD = "#c3272b"; // the channel's red thread, as under the spoken caption word

// A long video's chapter card: "Part N" and the chapter's title slide in at the top left over the first
// seconds of the chapter's first scene, on a dark panel so they read over whatever the scene draws, a
// red thread draws under them, and they slide away. A sign of how far the story has come, and a fresh
// start for attention.
export const ChapterCard: React.FC<{ number: number; title: string; theme: Theme }> = ({ number, title, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const total = Math.round(CARD_SECONDS * fps);
  if (frame >= total) return null;
  const enter = spring({ frame, fps, config: { damping: 16, mass: 0.6 } });
  const leave = interpolate(frame, [total - 10, total], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const x = interpolate(enter, [0, 1], [-width * 0.5, 0]) - leave * width * 0.6;
  const thread = interpolate(frame, [6, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.04,
        top: height * 0.12,
        maxWidth: width * 0.62,
        padding: "22px 34px 26px",
        borderRadius: 14,
        background: "rgba(5,8,18,0.82)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        transform: `translateX(${x}px)`,
        fontFamily: theme.font,
      }}
    >
      <div style={{ color: theme.accent, fontWeight: 800, fontSize: 28, letterSpacing: "0.18em", textTransform: "uppercase" }}>
        Part {number}
      </div>
      <div style={{ color: theme.text, fontWeight: 900, fontSize: 62, lineHeight: 1.08, marginTop: 6 }}>{title}</div>
      <div
        style={{
          marginTop: 14,
          height: 7,
          width: `${thread * 100}%`,
          borderRadius: 4,
          background: THREAD,
        }}
      />
    </div>
  );
};
