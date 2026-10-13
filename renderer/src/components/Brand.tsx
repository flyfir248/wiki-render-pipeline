import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format, Theme } from "../types";

const SHORT_SUBSCRIBE_SECONDS = 3.5; // a Short's last seconds, where the series badge turns into the subscribe line

const pill = (theme: Theme, short: boolean): React.CSSProperties => ({
  fontFamily: theme.font,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  borderRadius: 999,
  boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
  padding: short ? "14px 34px" : "10px 26px",
  whiteSpace: "nowrap",
});

// The series name, small at the top of the whole video, so every video reads as part of a
// collection. Over a Short's last seconds it becomes the reason to subscribe; on screen only, so the
// narration still loops cleanly into the hook.
export const Brand: React.FC<{
  badge?: string | null;
  subscribe?: string | null;
  endCard: number;
  theme: Theme;
  format: Format;
}> = ({ badge, subscribe, endCard, theme, format }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const short = format === "short";
  const askFrom = short ? durationInFrames - Math.round(SHORT_SUBSCRIBE_SECONDS * fps) : Infinity;
  const asking = Boolean(subscribe) && frame >= askFrom;
  const endFrom = !short && endCard > 0 ? durationInFrames - Math.round(endCard * fps) : Infinity;
  const onEndCard = frame >= endFrom;

  const text = asking ? subscribe : badge;
  if (!text && !onEndCard) return null;
  const enter = spring({ frame: frame - (asking ? askFrom : 0), fps, config: { damping: 14 } });
  return (
    <>
      {onEndCard ? <EndCard subscribe={subscribe} theme={theme} from={endFrom} /> : null}
      {text && !onEndCard ? (
        <div
          style={{
            position: "absolute",
            top: short ? height * 0.085 : height * 0.05,
            left: short ? 0 : width * 0.04,
            right: short ? 0 : undefined,
            display: "flex",
            justifyContent: short ? "center" : "flex-start",
            opacity: asking ? enter : interpolate(frame, [0, fps * 0.6], [0, 0.92], { extrapolateRight: "clamp" }),
            transform: asking ? `scale(${interpolate(enter, [0, 1], [0.7, 1])})` : undefined,
          }}
        >
          <div
            style={{
              ...pill(theme, short),
              fontSize: asking ? 46 : short ? 34 : 24,
              color: asking ? theme.background : theme.text,
              background: asking ? theme.accent : "rgba(0,0,0,0.5)",
              border: asking ? "none" : `3px solid ${theme.accent}`,
              maxWidth: width * 0.9,
              whiteSpace: asking ? "normal" : "nowrap",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {text}
          </div>
        </div>
      ) : null}
    </>
  );
};

// A long video's last seconds: the picture dims and the subscribe line sits at the top, leaving the
// middle and bottom free for the end screen elements added in YouTube Studio.
const EndCard: React.FC<{ subscribe?: string | null; theme: Theme; from: number }> = ({ subscribe, theme, from }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const fade = interpolate(frame - from, [0, fps * 0.8], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, background: `rgba(5,8,18,${0.78 * fade})` }}>
      {subscribe ? (
        <div
          style={{
            position: "absolute",
            top: height * 0.12,
            left: 0,
            right: 0,
            textAlign: "center",
            opacity: fade,
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: 64,
            color: theme.text,
            textShadow: "0 6px 24px rgba(0,0,0,0.85)",
          }}
        >
          {subscribe}
        </div>
      ) : null}
    </div>
  );
};
