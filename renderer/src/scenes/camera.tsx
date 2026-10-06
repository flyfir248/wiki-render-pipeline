// Camera moves over photos and clips, and the transitions scenes enter with.
import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Camera, Media, Scene, Transition } from "../types";
import { pick } from "./shared";

const CAMERAS: Camera[] = ["push_in", "parallax", "pan_left", "pull_out", "pan_right"];
const TRANSITIONS: Transition[] = ["slide", "zoom", "wipe", "fade", "flash"];

export const cameraOf = (scene: Scene): Camera => scene.camera ?? pick(scene.id, CAMERAS);
export const transitionOf = (scene: Scene): Transition =>
  scene.transition ?? (scene.id === "s1" ? "fade" : pick(`${scene.id}t`, TRANSITIONS));

const fill = { width: "100%", height: "100%", objectFit: "cover" as const };

const MediaEl: React.FC<{ media: Media; style: React.CSSProperties }> = ({ media, style }) =>
  media.kind === "video" ? (
    <OffthreadVideo src={staticFile(media.src)} muted style={style} />
  ) : (
    <Img src={staticFile(media.src)} style={style} />
  );

// Scene progress 0..1 with an ease, so moves start and settle gently.
const useProgress = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });
};

// A photo or clip filling the frame, moved by a virtual camera.
// `parallax` splits a photo into a blurred backdrop and a sharp tilted print floating in front of it.
export const CameraMedia: React.FC<{ media: Media; camera: Camera; flat?: boolean }> = ({ media, camera, flat }) => {
  const t = useProgress();
  const move = camera === "parallax" && (flat || media.kind === "video") ? "push_in" : camera;
  if (move === "parallax") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill style={{ transform: `scale(${1.35 + 0.1 * t}) translateX(${(t - 0.5) * 3}%)`, filter: "blur(22px) brightness(0.55)" }}>
          <MediaEl media={media} style={fill} />
        </AbsoluteFill>
        <AbsoluteFill style={{ perspective: 1600, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              width: "84%",
              height: "62%",
              transform: `translateZ(${t * 120}px) rotateY(${(0.5 - t) * 14}deg) rotateX(${(t - 0.5) * 4}deg) translateY(-6%)`,
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 40px 90px rgba(0,0,0,0.65)",
              border: "6px solid rgba(255,255,255,0.9)",
            }}
          >
            <MediaEl media={media} style={fill} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const transform = {
    push_in: `scale(${1.04 + 0.18 * t})`,
    pull_out: `scale(${1.24 - 0.18 * t})`,
    pan_left: `scale(1.2) translateX(${4 - 8 * t}%)`,
    pan_right: `scale(1.2) translateX(${-4 + 8 * t}%)`,
  }[move];
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform }}>
        <MediaEl media={media} style={fill} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const ENTER = 12; // frames

// Every scene enters with its transition, drifts in slightly over its length, and fades out briefly.
export const SceneFrame: React.FC<{ transition?: Transition; children: React.ReactNode }> = ({
  transition = "fade",
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, ENTER], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const fadeOut = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.03]);
  let style: React.CSSProperties = { opacity: Math.min(p, fadeOut), transform: `scale(${drift})` };
  if (transition === "slide") {
    style = { opacity: fadeOut, transform: `translateX(${(1 - p) * 100}%) scale(${drift})` };
  } else if (transition === "zoom") {
    style = { opacity: Math.min(p, fadeOut), transform: `scale(${drift * (1.25 - 0.25 * p)})`, filter: `blur(${(1 - p) * 12}px)` };
  } else if (transition === "wipe") {
    style = { opacity: fadeOut, transform: `scale(${drift})`, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
  } else if (transition === "flash") {
    style = { opacity: fadeOut, transform: `scale(${drift})` };
  }
  const flash = transition === "flash" ? interpolate(frame, [0, 3, 10], [0.9, 0.7, 0], { extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={style}>
      {children}
      {flash > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};
