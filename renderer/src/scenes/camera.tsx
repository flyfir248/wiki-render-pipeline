// Camera moves over photos and clips, and the transitions scenes enter with.
import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Beat, Camera, Format, Media, Scene, Transition } from "../types";
import { pick } from "./shared";

const CAMERAS: Camera[] = ["push_in", "parallax", "pan_left", "pull_out", "pan_right"];
// The red thread is the channel's signature cut, so it comes up most; the others keep it from wearing thin.
const TRANSITIONS: Transition[] = ["thread", "whip", "zoom", "thread", "slide", "wipe", "thread", "whip", "fade", "flash"];

export const cameraOf = (scene: Scene): Camera => scene.camera ?? pick(scene.id, CAMERAS);
export const transitionOf = (scene: Scene): Transition =>
  scene.transition ?? (scene.id === "s1" ? "fade" : pick(`${scene.id}t`, TRANSITIONS));

const fill = { width: "100%", height: "100%", objectFit: "cover" as const };

const MediaEl: React.FC<{ media: Media; style: React.CSSProperties }> = ({ media, style }) =>
  media.kind === "video" ? (
    <OffthreadVideo src={staticFile(media.src)} muted style={style} />
  ) : media.styled ? (
    <Collage media={media} style={style} />
  ) : (
    <Img src={staticFile(media.src)} style={style} />
  );

// The collage look (fyt/cutout.py): the photo as a halftone print pinned over a dim, blown-up copy of
// itself, with its subject cut out in black and white and lifted off the print, breaking out of its
// frame. The cut-out moves in small steps, like stop-motion paper.
const Collage: React.FC<{ media: Media; style: React.CSSProperties }> = ({ media }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const step = Math.floor(frame / 3); // 10 poses a second
  // 2.5D parallax: the backdrop, the print and the cut-out drift at different speeds, so the flat
  // photo reads as three layers at different depths.
  const t = interpolate(frame, [0, durationInFrames], [-0.5, 0.5], { extrapolateRight: "clamp" });
  const dir = media.src.length % 2 ? 1 : -1;
  const lift = spring({ frame: frame - 4, fps, config: { damping: 12, mass: 0.6 } });
  const wobble = ((step * 7919) % 5) - 2; // -2..2, a stable "random" pose per step
  // The print as large as fits, leaving a margin of the backdrop around it.
  const aspect = media.aspect ?? 1.5;
  const maxW = width * (width > height ? 0.8 : 0.9);
  const maxH = height * (width > height ? 0.8 : 0.55);
  const w = Math.min(maxW, maxH * aspect);
  const h = w / aspect;
  const box: React.CSSProperties = { position: "absolute", left: (width - w) / 2, top: (height - h) / 2 - height * 0.03, width: w, height: h };
  const img = { width: "100%", height: "100%", objectFit: "cover" as const, display: "block" };
  const tilt = (((media.src.length * 31) % 5) - 2) * 0.6; // each photo sits at its own slight angle
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={staticFile(media.styled!)}
        style={{ ...img, position: "absolute", transform: `scale(${1.25 + 0.04 * (t + 0.5)}) translateX(${-dir * t * 3}%)`, filter: "brightness(0.42) blur(2px)" }}
      />
      <div style={{ ...box, transform: `translateX(${dir * t * 1.5}%) rotate(${tilt}deg)` }}>
        <div style={{ position: "absolute", inset: 0, outline: "10px solid #f4eee0", boxShadow: "0 30px 70px rgba(0,0,0,0.6)" }}>
          <Img src={staticFile(media.styled!)} style={img} />
        </div>
        {media.cutout ? (
          <Img
            src={staticFile(media.cutout)}
            style={{
              ...img,
              position: "absolute",
              inset: 0,
              transformOrigin: "50% 100%",
              transform: `translateX(${dir * t * 3}%) translateY(${-2.5 * lift}%) scale(${1 + 0.12 * lift + 0.03 * (t + 0.5)}) rotate(${wobble * 0.2 - tilt * 0.5}deg)`,
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

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

// A new shot about this often (growth.shot_seconds and long_shot_seconds in fyt/config.py).
const SHOT_SECONDS: Record<Format, number> = { short: 2.5, long: 5 };
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
const THREAD = "#c3272b";

// The signature cut: a red string, pinned at the top, is pulled across the frame and the new scene is
// revealed in its wake. The string sags and sways a little, like real thread.
const ThreadEdge: React.FC<{ p: number }> = ({ p }) => {
  const { width, height } = useVideoConfig();
  if (p <= 0 || p >= 1) return null;
  const [top, bottom] = threadEdge(p);
  const x1 = (top / 100) * width;
  const x2 = (bottom / 100) * width;
  const sway = Math.sin(p * Math.PI) * width * 0.03;
  const d = `M${x1} -20 Q${(x1 + x2) / 2 + sway} ${height / 2} ${x2} ${height + 20}`;
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <path d={d} stroke="rgba(0,0,0,0.45)" strokeWidth={14} fill="none" transform="translate(8 10)" />
      <path d={d} stroke={THREAD} strokeWidth={9} fill="none" strokeLinecap="round" />
      <path d={d} stroke="rgba(255,255,255,0.25)" strokeWidth={2} fill="none" strokeDasharray="10 14" />
      <circle cx={x1 + 6} cy={26} r={15} fill="#e8e1cf" stroke="#000" strokeOpacity={0.3} strokeWidth={3} />
    </svg>
  );
};

// Where the thread crosses the top and bottom of the frame (% of width) as it is pulled across.
const threadEdge = (p: number): [number, number] => {
  const top = -20 + 145 * p;
  return [top, top - 25];
};

// A horizontal motion blur for the whip pan (CSS blur can only blur both ways at once).
const WhipBlur: React.FC<{ amount: number }> = ({ amount }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id="whip-blur" x="-20%" y="0" width="140%" height="100%">
      <feGaussianBlur stdDeviation={`${amount} 0`} />
    </filter>
  </svg>
);

// Every scene enters with its transition, drifts in slightly over its length, and fades out briefly.
// The first scene is on screen from the first frame: a fade from black there is a frame people swipe on.
// Transitions where the outgoing scene stays on screen under the incoming one: the thread is pulled
// across it, or it is whipped off to the side as the next one whips in.
export const OVERLAP: Partial<Record<Transition, number>> = { thread: 16, whip: 9 };

// Where each scene sits on the video's timeline, in frames. `len` includes the `tail` it stays on
// screen under the next scene's transition, and is the length the scene's own animation is timed to.
export const sceneSpans = (scenes: Scene[], fps: number) =>
  scenes.map((scene, i) => {
    const from = Math.round(scene.start * fps);
    const next = scenes[i + 1];
    const exit = next ? transitionOf(next) : undefined;
    const tail = (exit && OVERLAP[exit]) ?? 0;
    return { from, len: Math.max(1, Math.round(scene.end * fps) - from) + tail, tail, exit };
  });

export const SceneFrame: React.FC<{ transition?: Transition; instant?: boolean; tail?: number; exit?: Transition; children: React.ReactNode }> = ({
  transition = "fade",
  instant = false,
  tail = 0,
  exit,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames: total } = useVideoConfig();
  if (tail > 0 && frame >= total - tail) {
    // Leaving under the next scene's transition.
    const q = (frame - (total - tail)) / tail;
    // Scenes are see-through over the shared background, so under the thread the old scene is cut
    // away exactly where the new one is revealed.
    const [top, bottom] = threadEdge(Easing.inOut(Easing.cubic)(q));
    const out: React.CSSProperties =
      exit === "whip"
        ? { transform: `translateX(${-70 * Easing.in(Easing.cubic)(q)}%) scale(1.03)`, filter: "url(#whip-blur-out)" }
        : { transform: "scale(1.03)", clipPath: `polygon(${top}% 0%, 100% 0%, 100% 100%, ${bottom}% 100%)` };
    return (
      <AbsoluteFill style={out}>
        {exit === "whip" ? (
          <svg width={0} height={0} style={{ position: "absolute" }}>
            <filter id="whip-blur-out" x="-20%" y="0" width="140%" height="100%">
              <feGaussianBlur stdDeviation={`${40 * q} 0`} />
            </filter>
          </svg>
        ) : null}
        {children}
      </AbsoluteFill>
    );
  }
  const durationInFrames = total - tail;
  const p = instant ? 1 : interpolate(frame, [0, ENTER], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const fadeOut = tail > 0 ? 1 : interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {
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
  } else if (transition === "thread") {
    const t = instant ? 1 : interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
    const [top, bottom] = threadEdge(t);
    style = {
      opacity: fadeOut,
      transform: `scale(${drift * (1.04 - 0.04 * t)})`,
      clipPath: t >= 1 ? undefined : `polygon(0% 0%, ${top}% 0%, ${bottom}% 100%, 0% 100%)`,
    };
    return (
      <AbsoluteFill>
        <AbsoluteFill style={style}>{children}</AbsoluteFill>
        <ThreadEdge p={t} />
      </AbsoluteFill>
    );
  } else if (transition === "whip") {
    // A fast pan that lands with a little overshoot, smeared sideways while it moves.
    const t = instant ? 1 : interpolate(frame, [0, 9], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.3)) });
    const blur = instant ? 0 : interpolate(frame, [0, 8], [40, 0], { extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ opacity: fadeOut, transform: `translateX(${(1 - t) * 70}%) scale(${drift})`, filter: blur > 0.5 ? "url(#whip-blur)" : undefined }}>
        <WhipBlur amount={blur} />
        {children}
      </AbsoluteFill>
    );
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
