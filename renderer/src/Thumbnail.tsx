import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Background } from "./components/Background";
import type { ThumbnailProps } from "./types";

// Big, high-contrast text over an optional image: readable at phone size.
export const Thumbnail: React.FC<ThumbnailProps> = (props) => {
  if (props.art && props.background) return <ArtThumbnail {...props} />;
  const { title, kicker, theme, background, format } = props;
  const short = format === "short";
  return (
    <AbsoluteFill>
      <Background theme={theme} energy={0.6} />
      {background ? (
        <AbsoluteFill>
          <Img src={staticFile(background.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill
            style={{
              background: short
                ? `linear-gradient(transparent 30%, ${theme.background}f0 75%)`
                : `linear-gradient(90deg, ${theme.background}f5 0%, ${theme.background}bb 55%, transparent 100%)`,
            }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          padding: short ? "0 70px 260px" : "0 90px",
          justifyContent: short ? "flex-end" : "center",
          gap: 26,
          maxWidth: short ? undefined : 1250,
        }}
      >
        <div
          style={{
            alignSelf: "flex-start",
            padding: "12px 26px",
            borderRadius: 12,
            background: theme.accent,
            color: theme.background,
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: short ? 56 : 48,
            letterSpacing: 2,
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: short ? 124 : 118,
            lineHeight: 1.0,
            color: theme.text,
            textTransform: "uppercase",
            textShadow: "0 8px 30px rgba(0,0,0,0.8)",
            WebkitTextStroke: "2px rgba(0,0,0,0.35)",
          }}
        >
          {title}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// An illustration of the story's key moment beside (or above) a few huge words, the last one in the
// accent colour. The square drawing fills the right of a wide thumbnail or the top of a vertical one.
const ArtThumbnail: React.FC<ThumbnailProps> = ({ title, kicker, theme, background, format }) => {
  const short = format === "short";
  const words = title.trim().split(/\s+/);
  const last = words.pop() ?? "";
  const size = short ? 150 : words.length + 1 > 3 ? 140 : 168;
  return (
    <AbsoluteFill style={{ background: theme.background }}>
      <Img
        src={staticFile(background!.src)}
        style={
          short
            ? { position: "absolute", left: -60, top: 120, width: 1200, height: 1200, objectFit: "cover" }
            : { position: "absolute", right: 0, top: 0, width: 1140, height: 1080, objectFit: "cover" }
        }
      />
      <AbsoluteFill
        style={{
          background: short
            ? `linear-gradient(${theme.background}cc 0%, transparent 14%, transparent 52%, ${theme.background} 68%)`
            : `linear-gradient(90deg, ${theme.background} 0%, ${theme.background} 40%, ${theme.background}00 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          padding: short ? "0 70px 230px" : "0 0 0 90px",
          justifyContent: short ? "flex-end" : "center",
          gap: 22,
          width: short ? undefined : 1050,
        }}
      >
        {kicker ? (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "8px 22px",
              borderRadius: 10,
              border: `4px solid ${theme.accent}`,
              color: theme.accent,
              fontFamily: theme.font,
              fontWeight: 900,
              fontSize: short ? 50 : 54,
              letterSpacing: 3,
            }}
          >
            {kicker}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: theme.font,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 0.98,
            color: theme.text,
            textTransform: "uppercase",
            textShadow: "0 6px 0 rgba(0,0,0,0.55), 0 10px 40px rgba(0,0,0,0.8)",
            WebkitTextStroke: "3px rgba(0,0,0,0.6)",
            paintOrder: "stroke fill",
          }}
        >
          {words.join(" ")} <span style={{ color: theme.accent }}>{last}</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
