import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Background } from "./components/Background";
import type { ThumbnailProps } from "./types";

// One subject, big, and 2-4 words that read at phone size. With a cut-out subject it stands over a dark
// blurred copy of its photo; otherwise the picture fills the frame under the words.
export const Thumbnail: React.FC<ThumbnailProps> = ({ title, kicker, theme, background, subject, format }) => {
  const short = format === "short";
  const words = title.trim().split(/\s+/);
  // the last word carries the twist ("SURVIVED 3 SINKINGS"): it takes the accent colour
  const lead = words.slice(0, -1).join(" ");
  const last = words[words.length - 1] ?? "";
  // the longest word must fit on one line: heavy capitals run about 0.7em wide
  const room = short ? 960 : subject ? 680 : 1010;
  const longest = Math.max(...words.map((w) => w.length), 1);
  const size = Math.min(short ? (words.length > 3 ? 132 : 150) : 128, Math.floor(room / (0.7 * longest)));
  const text = (
    <div
      style={{
        fontFamily: theme.font,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 0.98,
        color: theme.text,
        textTransform: "uppercase",
        letterSpacing: -1,
        textShadow: "0 6px 0 rgba(0,0,0,0.55), 0 12px 40px rgba(0,0,0,0.8)",
        WebkitTextStroke: "3px rgba(0,0,0,0.6)",
        textAlign: short ? "center" : "left",
      }}
    >
      {lead ? <span>{lead} </span> : null}
      <span style={{ color: theme.accent }}>{last}</span>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      <Background theme={theme} energy={0.6} />
      {background ? (
        <AbsoluteFill>
          <Img src={staticFile(background.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          {subject ? null : (
            <AbsoluteFill
              style={{
                background: short
                  ? `linear-gradient(${theme.background}e0 0%, transparent 34%, transparent 70%, ${theme.background}90 100%)`
                  : `linear-gradient(90deg, ${theme.background}f0 0%, ${theme.background}99 45%, transparent 75%)`,
              }}
            />
          )}
        </AbsoluteFill>
      ) : null}
      {subject ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: short ? "center" : "flex-end" }}>
          <Img
            src={staticFile(subject.src)}
            style={{
              width: short ? "96%" : "62%",
              height: short ? "74%" : "96%",
              objectFit: "contain",
              objectPosition: short ? "center bottom" : "right bottom",
              filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.7))",
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          padding: short ? "150px 60px 0" : "0 70px",
          justifyContent: short ? "flex-start" : "center",
          maxWidth: short ? undefined : subject ? 820 : 1150,
          gap: 22,
        }}
      >
        {kicker ? (
          <div
            style={{
              alignSelf: short ? "center" : "flex-start",
              padding: "10px 24px",
              borderRadius: 12,
              background: theme.accent,
              color: theme.background,
              fontFamily: theme.font,
              fontWeight: 900,
              fontSize: short ? 52 : 44,
              letterSpacing: 2,
            }}
          >
            {kicker}
          </div>
        ) : null}
        {text}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
