// Camera moves over photos and clips, and the transitions scenes enter with.
import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Beat, Camera, Format, Media, Scene, Transition } from "../types";
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

// Shorts cut to a new shot about this often; long videos keep one shot per scene.
const SHOT_SECONDS: Record<Format, number> = { short: 2.5, long: 0 };
const MOVES: Camera[] = ["push_in", "pan_left", "pull_out", "pan_right"];
// Where the camera looks when it cuts back to a photo already shown: a tighter crop elsewhere in it.
const CROPS = ["50% 30%", "30% 55%", "70% 45%", "50% 70%"];

// A shot that cuts in with a short zoom punch, optionally cropped tighter around `origin`.
const Shot: React.FC<{ media: Media; camera: Camera; flat?: boolean; zoom: number; origin: string; punch: boolean }> = ({
  media,
  camera,
  flat,
  zoom,
  origin,
  punch,
}) => {
  const frame = useCurrentFrame();
  const kick = punch ? interpolate(frame, [0, 6], [1.08, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom * kick})`, transformOrigin: origin }}>
        <CameraMedia media={media} camera={camera} flat={flat} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// A scene's photo, then its extra photos, each for a few seconds with its own camera move. When the
// photos run out it cuts back to them cropped tighter, so the picture still changes every few seconds.
export const ShotReel: React.FC<{ media: Media; shots?: Media[] | null; camera: Camera; flat?: boolean; format: Format }> = ({
  media,
  shots,
  camera,
  flat,
  format,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const every = SHOT_SECONDS[format] * fps;
  const pool = [media, ...(shots ?? []).filter((m) => m.kind === "image")];
  const n = media.kind === "video" || !every ? 1 : Math.max(1, Math.floor(durationInFrames / every));
  if (n === 1) return <CameraMedia media={media} camera={camera} flat={flat} />;
  const first = MOVES.indexOf(camera);
  const len = durationInFrames / n;
  return (
    <AbsoluteFill>
      {Array.from({ length: n }, (_, k) => {
        const from = Math.round(k * len);
        const repeat = Math.floor(k / pool.length);
        return (
          <Sequence key={k} from={from} durationInFrames={Math.round((k + 1) * len) - from} layout="none">
            <Shot
              media={pool[k % pool.length]}
              camera={k === 0 ? camera : MOVES[((first < 0 ? 0 : first) + k) % MOVES.length]}
              flat
              zoom={repeat ? 1.22 : 1}
              origin={repeat ? CROPS[(k + repeat) % CROPS.length] : "50% 50%"}
              punch={k > 0}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// One storyboard illustration, full screen for its sentence. The art is square: in a Short it is shown
// sharp across the middle over a blurred, darkened copy of itself rather than blown up; in 16:9 it
// fills the frame. It drifts slowly, alternating direction from beat to beat, and dissolves in.
const ArtShot: React.FC<{ src: string; k: number; format: Format; instant?: boolean }> = ({ src, k, format, instant }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });
  const enter = instant ? 1 : interpolate(frame, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const dir = k % 2 ? -1 : 1;
  const move = `scale(${1.04 + 0.07 * t}) translateX(${dir * (t - 0.5) * 2.4}%)`;
  const img = { width: "100%", height: "100%", objectFit: "cover" as const };
  const vignette = "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)";
  if (width >= height || format === "long") {
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: enter }}>
        <Img src={staticFile(src)} style={{ ...img, transform: move }} />
        <AbsoluteFill style={{ background: vignette }} />
      </AbsoluteFill>
    );
  }
  const side = width;
  const top = (height - side) / 2 - height * 0.04;
  const fade = "linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)";
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: enter }}>
      <Img src={staticFile(src)} style={{ ...img, filter: "blur(30px) brightness(0.5) saturate(1.1)", transform: "scale(1.2)" }} />
      <div style={{ position: "absolute", left: 0, top, width: side, height: side, overflow: "hidden", WebkitMaskImage: fade, maskImage: fade }}>
        <Img src={staticFile(src)} style={{ ...img, transform: move }} />
      </div>
      <AbsoluteFill style={{ background: vignette }} />
    </AbsoluteFill>
  );
};

// A scene with storyboard beats: its own graphic plays until the first beat, then each sentence cuts
// to its illustration on the word it starts with. A beat at 0 opens the scene with the scene's own
// transition, so the scene's graphic is not shown at all.
export const BeatCuts: React.FC<{ beats: Beat[]; format: Format; children: React.ReactNode }> = ({ beats, format, children }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const marks = beats
    .map((b) => ({ ...b, from: Math.round(b.at * fps) }))
    .filter((b) => b.from >= 0 && b.from < durationInFrames - 8)
    .sort((a, b) => a.from - b.from);
  if (!marks.length) return <>{children}</>;
  return (
    <AbsoluteFill>
      {marks[0].from > 0 && <Sequence durationInFrames={marks[0].from}>{children}</Sequence>}
      {marks.map((b, k) => {
        const to = k + 1 < marks.length ? marks[k + 1].from : durationInFrames;
        return (
          <Sequence key={k} from={b.from} durationInFrames={Math.max(1, to - b.from)}>
            <ArtShot src={b.src} k={k} format={format} instant={b.from === 0} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const ENTER = 12; // frames

// Every scene enters with its transition, drifts in slightly over its length, and fades out briefly.
// The first scene is on screen from the first frame: a fade from black there is a frame people swipe on.
export const SceneFrame: React.FC<{ transition?: Transition; instant?: boolean; children: React.ReactNode }> = ({
  transition = "fade",
  instant = false,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = instant ? 1 : interpolate(frame, [0, ENTER], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
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
  const flash = transition === "flash" && !instant ? interpolate(frame, [0, 2, 8], [0.6, 0.45, 0], { extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={style}>
      {children}
      {flash > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};
