// 2D story scenes: an illustrated setting with flat illustrated props that enter, move and act
// out what the narration says, plus effects (explosion, fire, smoke, weather).
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Actor, Effect, Format, Setting, Theme } from "../types";
import { unit } from "../theme";
import { Heading, type SceneProps } from "./shared";

type Stage = { left: number; right: number; top: number; ground: number; w: number; h: number };

// Where props can stand: clear of the heading above and the captions below.
const stageOf = (format: Format, w: number, h: number): Stage =>
  format === "short"
    ? { left: 110, right: w - 110, top: 420, ground: 1200, w, h }
    : { left: 200, right: w - 200, top: 220, ground: 850, w, h };

const px = (s: Stage, x: number, y: number) => ({
  x: s.left + (Math.max(0, Math.min(100, x)) / 100) * (s.right - s.left),
  y: s.top + (Math.max(0, Math.min(100, y)) / 100) * (s.ground - s.top),
});

const SIZES = { s: 0.13, m: 0.2, l: 0.3 };

// ---------- settings ----------

const PALETTES: Record<Setting, { top: string; bottom: string; ground?: string; ground2?: string }> = {
  sky: { top: "#5aa9e6", bottom: "#cfe9f7", ground: "#7cc47a", ground2: "#5fa65d" },
  night: { top: "#0b1433", bottom: "#27325e", ground: "#1b2448", ground2: "#141b38" },
  space: { top: "#05040f", bottom: "#1a1240" },
  sea: { top: "#7cc3ea", bottom: "#d8eef8", ground: "#2f7fb8", ground2: "#1f5f92" },
  city: { top: "#f4a76b", bottom: "#ffd9a8", ground: "#3a3550", ground2: "#2a2640" },
  countryside: { top: "#8fd0f5", bottom: "#e6f6ff", ground: "#8ccf6e", ground2: "#6cb253" },
  desert: { top: "#f7b267", bottom: "#fde4b8", ground: "#e8b56e", ground2: "#d49a52" },
  snow: { top: "#9bb4cc", bottom: "#dfe8f0", ground: "#f4f8fb", ground2: "#dce6ee" },
  room: { top: "#e9dcc9", bottom: "#f3ebe0", ground: "#a77b55", ground2: "#8e6542" },
  road: { top: "#9fd3f2", bottom: "#e3f3fb", ground: "#5d6470", ground2: "#4a505b" },
};

const Backdrop: React.FC<{ setting: Setting; stage: Stage; historic?: boolean }> = ({ setting, stage, historic }) => {
  const frame = useCurrentFrame();
  const { w, h, ground } = stage;
  const pal = PALETTES[setting] ?? PALETTES.sky;
  const g = ground + 40; // the horizon sits just below where props stand
  const stars = setting === "night" || setting === "space";
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.top} />
          <stop offset="1" stopColor={pal.bottom} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill="url(#skyg)" />
      {stars
        ? Array.from({ length: setting === "space" ? 140 : 80 }, (_, i) => (
            <circle
              key={i}
              cx={random(`sx${i}`) * w}
              cy={random(`sy${i}`) * (setting === "space" ? h : g)}
              r={1 + random(`sr${i}`) * 2.2}
              fill="#fff"
              opacity={0.4 + 0.6 * Math.abs(Math.sin(frame / 20 + i))}
            />
          ))
        : null}
      {setting === "night" ? <circle cx={w * 0.8} cy={h * 0.14} r={70} fill="#f5f0d0" /> : null}
      {["sky", "countryside", "desert", "road", "sea"].includes(setting) ? (
        <circle cx={w * 0.82} cy={h * 0.13} r={80} fill={setting === "desert" ? "#fff3c4" : "#fff6d6"} opacity={0.95} />
      ) : null}
      {["sky", "countryside", "sea", "road"].includes(setting)
        ? [0, 1, 2].map((i) => {
            const cx = ((random(`c${i}`) * w + frame * (0.6 + i * 0.25)) % (w + 400)) - 200;
            const cy = h * (0.08 + 0.09 * i);
            return (
              <g key={i} fill="#fff" opacity={0.9}>
                <ellipse cx={cx} cy={cy} rx={110} ry={36} />
                <ellipse cx={cx - 50} cy={cy + 8} rx={60} ry={30} />
                <ellipse cx={cx + 55} cy={cy + 6} rx={70} ry={30} />
              </g>
            );
          })
        : null}
      {setting === "city" && historic
        ? Array.from({ length: 11 }, (_, i) => {
            // A town before 1900: gabled houses of two to four storeys, and a church spire.
            const bw = w / 11;
            const bh = 150 + random(`hb${i}`) * 170;
            const x = i * bw;
            const spire = i === 7;
            return (
              <g key={i}>
                {spire ? <polygon points={`${x + bw * 0.2},${g - bh - 60} ${x + bw * 0.5},${g - bh - 420} ${x + bw * 0.8},${g - bh - 60}`} fill="#5a4a5e" /> : null}
                <rect x={x} y={g - bh - (spire ? 60 : 0)} width={bw - 4} height={bh + (spire ? 60 : 0)} fill={i % 2 ? "#6b5a52" : "#7a685c"} />
                <polygon points={`${x - 4},${g - bh} ${x + bw / 2 - 2},${g - bh - bw * 0.55} ${x + bw},${g - bh}`} fill="#4a3a3a" />
                {Array.from({ length: Math.floor(bh / 70) }, (_, k) => (
                  <rect key={k} x={x + bw * 0.3} y={g - bh + 26 + k * 70} width={bw * 0.36} height={30} fill="#ffd27a" opacity={random(`hw${i}-${k}`) > 0.5 ? 0.8 : 0.2} />
                ))}
              </g>
            );
          })
        : setting === "city"
        ? Array.from({ length: 14 }, (_, i) => {
            const bw = w / 14;
            const bh = 160 + random(`b${i}`) * 380;
            return (
              <g key={i}>
                <rect x={i * bw} y={g - bh} width={bw - 6} height={bh} fill={i % 2 ? "#4a4466" : "#544d73"} />
                {Array.from({ length: Math.floor(bh / 60) }, (_, k) => (
                  <rect key={k} x={i * bw + 14} y={g - bh + 20 + k * 60} width={bw - 34} height={18} fill="#ffd27a" opacity={random(`w${i}-${k}`) > 0.45 ? 0.85 : 0.15} />
                ))}
              </g>
            );
          })
        : null}
      {setting === "room" ? (
        <g>
          <rect x={w * 0.62} y={h * 0.12} width={w * 0.22} height={h * 0.22} fill="#bfe3f5" stroke="#8e6542" strokeWidth={14} />
          <line x1={w * 0.73} y1={h * 0.12} x2={w * 0.73} y2={h * 0.34} stroke="#8e6542" strokeWidth={8} />
        </g>
      ) : null}
      {pal.ground ? (
        setting === "sea" ? (
          [0, 1, 2].map((k) => {
            const yy = g + k * 60;
            const off = (frame * (2 + k)) % 200;
            let d = `M ${-200 + off} ${yy}`;
            for (let x = -200 + off; x < w + 200; x += 100) d += ` q 50 ${k % 2 ? 22 : -22} 100 0`;
            d += ` V ${h} H -200 Z`;
            return <path key={k} d={d} fill={k === 0 ? pal.ground : k === 1 ? pal.ground2 : "#174b77"} />;
          })
        ) : setting === "countryside" || setting === "desert" || setting === "snow" ? (
          <g>
            <path d={`M0 ${g + 20} Q ${w * 0.25} ${g - 70} ${w * 0.5} ${g + 10} T ${w} ${g - 10} V ${h} H 0 Z`} fill={pal.ground2} />
            <path d={`M0 ${g + 60} Q ${w * 0.35} ${g} ${w * 0.7} ${g + 50} T ${w} ${g + 40} V ${h} H 0 Z`} fill={pal.ground} />
          </g>
        ) : (
          <g>
            <rect x={0} y={g} width={w} height={h - g} fill={pal.ground} />
            {setting === "road"
              ? Array.from({ length: 12 }, (_, i) => (
                  <rect key={i} x={((((i * 220 - frame * 8) % (w + 220)) + w + 220) % (w + 220)) - 110} y={g + 70} width={120} height={14} fill="#f5f5f5" />
                ))
              : null}
          </g>
        )
      ) : null}
    </svg>
  );
};

// An illustrated plate for this scene, with a slow push in so the props in front read as a separate
// layer. The art is square: in a Short it is shown sharp at about its own size across the stage, and
// a blurred, dimmed copy fills above and below instead of blowing the picture up; in 16:9 it fills
// the frame.
const Plate: React.FC<{ src: string; stage: Stage }> = ({ src, stage }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [0, durationInFrames], [0, 1]);
  const side = Math.min(stage.w, stage.h) * 1.02;
  const cy = (stage.top + stage.ground) / 2;
  const push = `scale(${1.02 + 0.05 * t}) translateX(${(0.5 - t) * 1.2}%)`;
  if (stage.w > stage.h) {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: push }} />
      </AbsoluteFill>
    );
  }
  const fade = "to bottom";
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px) brightness(0.6) saturate(1.1)", transform: "scale(1.15)" }} />
      <div
        style={{
          position: "absolute",
          left: (stage.w - side) / 2,
          top: cy - side / 2,
          width: side,
          height: side,
          overflow: "hidden",
          WebkitMaskImage: `linear-gradient(${fade}, transparent 0%, black 9%, black 91%, transparent 100%)`,
          maskImage: `linear-gradient(${fade}, transparent 0%, black 9%, black 91%, transparent 100%)`,
        }}
      >
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: push }} />
      </div>
    </AbsoluteFill>
  );
};

// When a prop appears and when the effect goes off, in frames from the scene's start (the sound
// effects use these too).
export const actorStart = (actor: Actor, frames: number) => Math.round(Math.max(0, Math.min(0.8, actor.at ?? 0)) * frames);
export const effectStart = (scene: { effectAt?: number | null }, frames: number) =>
  Math.round(Math.max(0, Math.min(0.9, scene.effectAt ?? 0.35)) * frames);

// ---------- actors ----------

const ActorView: React.FC<{ actor: Actor; stage: Stage; theme: Theme; format: Format }> = ({ actor, stage, theme, format }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const start = actorStart(actor, durationInFrames);
  if (frame < start) return null;
  const f = frame - start;
  const p = spring({ frame: f, fps, config: { damping: 13, mass: 0.7 } });
  const size = SIZES[actor.size] * Math.min(stage.w, stage.h) * (format === "short" ? 1 : 1.1);
  const from = px(stage, actor.x, actor.y);
  const moving = actor.to_x != null || actor.to_y != null;
  const to = px(stage, actor.to_x ?? actor.x, actor.to_y ?? actor.y);
  const t = moving
    ? interpolate(frame, [start + 10, Math.max(start + 11, durationInFrames * 0.85)], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      })
    : 0;
  let x = from.x + (to.x - from.x) * t;
  let y = from.y + (to.y - from.y) * t;
  let rotate = moving ? Math.max(-14, Math.min(14, ((to.y - from.y) / (Math.hypot(to.x - from.x, to.y - from.y) || 1)) * 20)) * (t > 0 && t < 1 ? 1 : 0.3) : 0;
  let scale = 1;
  let opacity = 1;

  if (actor.enter === "pop") scale *= p;
  if (actor.enter === "fade") opacity *= p;
  if (actor.enter === "slide_left") x -= (1 - p) * stage.w * 0.7;
  if (actor.enter === "slide_right") x += (1 - p) * stage.w * 0.7;
  if (actor.enter === "drop") y -= (1 - p) * stage.h * 0.6;
  if (actor.enter === "rise") {
    y += (1 - p) * 260;
    opacity *= p;
  }
  const busy = f > 12;
  if (busy && actor.action === "shake") x += Math.sin(f * 2.3) * 9;
  if (busy && actor.action === "pulse") scale *= 1 + 0.08 * Math.sin(f / 4);
  if (busy && actor.action === "spin") rotate += (f - 12) * 6;
  if (actor.action === "bob") y += Math.sin(f / 7) * 12;
  if (busy && actor.action === "blink") opacity *= Math.floor(f / 6) % 2 ? 0.35 : 1;
  if (actor.action === "fall") {
    const fall = interpolate(frame, [durationInFrames * 0.45, durationInFrames * 0.9], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.quad),
    });
    y += fall * (stage.ground + 60 - y);
    rotate += fall * 70;
  }
  const k = unit(format);
  return (
    <>
      {moving && t > 0 ? (
        <svg width={stage.w} height={stage.h} style={{ position: "absolute", inset: 0 }}>
          <line x1={from.x} y1={from.y - size / 2} x2={x} y2={y - size / 2} stroke={theme.accent} strokeWidth={6} strokeDasharray="16 14" strokeLinecap="round" opacity={0.75} />
        </svg>
      ) : null}
      {actor.y >= 85 && actor.action !== "fall" ? (
        <div
          style={{
            position: "absolute",
            left: x - size * 0.35,
            top: from.y + (to.y - from.y) * t - size * 0.06,
            width: size * 0.7,
            height: size * 0.12,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.22)",
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
      <Img
        src={staticFile(actor.src)}
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size,
          width: size,
          height: size,
          opacity,
          transform: `rotate(${rotate}deg) scale(${scale})`,
          transformOrigin: "50% 80%",
          filter: "drop-shadow(0 10px 14px rgba(0,0,0,0.25))",
        }}
      />
      {actor.label ? (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y + 8,
            transform: `translateX(-50%) scale(${Math.min(1, scale)})`,
            opacity: opacity * p,
            padding: "6px 18px",
            borderRadius: 12,
            whiteSpace: "nowrap",
            background: theme.background,
            color: theme.text,
            fontFamily: theme.font,
            fontWeight: 800,
            fontSize: 30 * k,
          }}
        >
          {actor.label}
        </div>
      ) : null}
    </>
  );
};

// ---------- effects ----------

const EffectView: React.FC<{ effect: Effect; at: number; x: number; y: number; src?: string | null; stage: Stage }> = ({
  effect,
  at,
  x,
  y,
  src,
  stage,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - at;
  if (effect === "rain" || effect === "snow") {
    const snow = effect === "snow";
    return (
      <svg width={stage.w} height={stage.h} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: snow ? 90 : 120 }, (_, i) => {
          const speed = snow ? 2 + random(`v${i}`) * 2 : 28 + random(`v${i}`) * 12;
          const yy = (random(`y${i}`) * stage.h + frame * speed) % stage.h;
          const xx = (random(`x${i}`) * stage.w + (snow ? Math.sin(frame / 20 + i) * 20 : -yy * 0.15) + stage.w) % stage.w;
          return snow ? (
            <circle key={i} cx={xx} cy={yy} r={3 + random(`r${i}`) * 4} fill="#fff" opacity={0.9} />
          ) : (
            <line key={i} x1={xx} y1={yy} x2={xx - 6} y2={yy + 34} stroke="#cfe6ff" strokeWidth={3} opacity={0.7} />
          );
        })}
      </svg>
    );
  }
  if (f < 0) return null;
  const size = 0.32 * Math.min(stage.w, stage.h);
  if (effect === "explosion") {
    const p = spring({ frame: f, fps, config: { damping: 9, mass: 0.5 } });
    const fade = interpolate(f, [18, 40], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <>
        <svg width={stage.w} height={stage.h} style={{ position: "absolute", inset: 0 }}>
          {[0, 8].map((d) => {
            const r = interpolate(f - d, [0, 24], [0, size * 1.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <circle key={d} cx={x} cy={y} r={r} fill="none" stroke="#ffb347" strokeWidth={14} opacity={interpolate(f - d, [0, 24], [0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />;
          })}
          {Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2 + random(`a${i}`) * 0.3;
            const d = interpolate(f, [0, 30], [0, size * (0.9 + random(`d${i}`) * 0.7)], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
            return <circle key={i} cx={x + Math.cos(a) * d} cy={y + Math.sin(a) * d + f * f * 0.05} r={10 + random(`pr${i}`) * 10} fill={i % 2 ? "#ff6b35" : "#ffd23f"} opacity={fade} />;
          })}
        </svg>
        {src ? <Img src={staticFile(src)} style={{ position: "absolute", left: x - (size * p) / 2, top: y - (size * p) / 2, width: size * p, height: size * p, opacity: fade }} /> : null}
        <AbsoluteFill style={{ background: "#fff", opacity: interpolate(f, [0, 3, 8], [0.7, 0.4, 0], { extrapolateRight: "clamp" }) }} />
      </>
    );
  }
  if (effect === "lightning") {
    return (
      <>
        <AbsoluteFill style={{ background: "#fff", opacity: f < 12 && f % 4 < 2 ? 0.7 : 0 }} />
        {src ? <Img src={staticFile(src)} style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, opacity: Math.floor(f / 5) % 3 ? 1 : 0.4 }} /> : null}
      </>
    );
  }
  if (effect === "smoke") {
    return (
      <svg width={stage.w} height={stage.h} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: 8 }, (_, i) => {
          const life = ((f + i * 9) % 70) / 70;
          return <circle key={i} cx={x + Math.sin(i * 2 + f / 15) * 30 + life * 40} cy={y - life * size * 1.6} r={30 + life * 80} fill="#8a8f98" opacity={(1 - life) * 0.55 * Math.min(1, f / 10)} />;
        })}
      </svg>
    );
  }
  // fire and sparkles: the illustration, alive
  const p = spring({ frame: f, fps, config: { damping: 12 } });
  const flicker = effect === "fire" ? 1 + 0.07 * Math.sin(f * 1.7) + 0.04 * Math.sin(f * 3.1) : 1 + 0.15 * Math.abs(Math.sin(f / 6));
  return (
    <>
      {effect === "fire" ? (
        <div style={{ position: "absolute", left: x - size, top: y - size, width: size * 2, height: size * 2, borderRadius: "50%", background: "radial-gradient(#ff8c4288, transparent 65%)", opacity: p }} />
      ) : null}
      {src ? (
        <Img
          src={staticFile(src)}
          style={{
            position: "absolute",
            left: x - size / 2,
            top: y - size,
            width: size,
            height: size,
            transform: `scale(${p * (effect === "fire" ? 1 : flicker)}, ${p * flicker})`,
            transformOrigin: "50% 100%",
          }}
        />
      ) : null}
    </>
  );
};

// ---------- the scene ----------

export const StoryScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const stage = stageOf(format, width, height);
  const actors = (scene.actors ?? []).filter((a) => a.src).slice(0, 5);
  const setting = scene.setting ?? "sky";
  const effectAt = effectStart(scene, durationInFrames);
  const anchor = actors[0];
  const where = px(stage, scene.effectX ?? anchor?.to_x ?? anchor?.x ?? 50, scene.effectY ?? (anchor ? (anchor.to_y ?? anchor.y) - 15 : 50));
  // The whole stage jolts when something explodes.
  const jolt = scene.effect === "explosion" && frame >= effectAt && frame < effectAt + 12 ? Math.sin((frame - effectAt) * 3) * 14 : 0;
  return (
    <AbsoluteFill style={{ transform: `translate(${jolt}px, ${jolt * 0.6}px)` }}>
      <Backdrop setting={setting} stage={stage} historic={theme.era === "historic"} />
      {scene.backdropSrc ? <Plate src={scene.backdropSrc} stage={stage} /> : null}
      {actors.map((a, i) => (
        <ActorView key={i} actor={a} stage={stage} theme={theme} format={format} />
      ))}
      {scene.effect ? <EffectView effect={scene.effect} at={effectAt} x={where.x} y={where.y} src={scene.effectSrc} stage={stage} /> : null}
      {scene.heading ? (
        <AbsoluteFill style={{ padding: format === "short" ? "220px 80px 0" : "50px 160px 0", alignItems: "center" }}>
          <div style={{ padding: "12px 32px", borderRadius: 18, background: `${theme.background}d9` }}>
            <Heading text={scene.heading} theme={theme} format={format} size={48} />
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
