// Animated map: the camera flies in from a wide view to the places, pins drop, and a route
// draws itself along the great circle between them with a glowing marker at its head.
import React from "react";
import { geoDistance, geoGraticule10, geoInterpolate, geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-50m.json";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Place } from "../types";
import { unit } from "../theme";
import { Heading, type SceneProps } from "./shared";

const atlas = countries as any;
const WORLD = feature(atlas, atlas.objects.countries) as unknown as FeatureCollection;
const GRATICULE = geoGraticule10();

type LonLat = [number, number];

export const validPlaces = (places?: Place[] | null): Place[] =>
  (places ?? []).filter(
    (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 80 && Math.abs(p.lon) <= 180,
  );

const clampLat = (v: number) => Math.max(-80, Math.min(80, v));
const clampLon = (v: number) => Math.max(-180, Math.min(180, v));

// A box around the places, padded by `factor` of their span (at least `min` degrees), as fitting
// geometry. Longitudes are relative to `lon0`, the meridian the map is rotated to.
const box = (pts: LonLat[], lon0: number, factor: number, min: number): Geometry => {
  const lons = pts.map((p) => ((p[0] - lon0 + 540) % 360) - 180);
  const lats = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const pad = Math.max(min, Math.max(x1 - x0, y1 - y0) * factor);
  return {
    type: "MultiPoint",
    coordinates: [
      [Math.max(-179, x0 - pad), clampLat(y0 - pad)],
      [Math.min(179, x1 + pad), clampLat(y1 + pad)],
    ],
  };
};

type View = { scale: number; center: LonLat }; // center in the rotated frame

const fit = (geo: Geometry, rect: [[number, number], [number, number]]): View => {
  const p = geoMercator().fitExtent(rect, geo);
  const cx = (rect[0][0] + rect[1][0]) / 2;
  const cy = (rect[0][1] + rect[1][1]) / 2;
  // Never zoom out so far that the world is narrower than the frame.
  return { scale: Math.max(p.scale(), (rect[1][0] - rect[0][0]) / (2 * Math.PI)), center: p.invert!([cx, cy]) as LonLat };
};

// The meridian halfway along the shorter way round between the westmost and eastmost places.
const midLon = (pts: LonLat[]): number => {
  const v = pts.reduce(([x, y], p) => [x + Math.cos((p[0] * Math.PI) / 180), y + Math.sin((p[0] * Math.PI) / 180)], [0, 0]);
  return (Math.atan2(v[1], v[0]) * 180) / Math.PI;
};

// Where the route head is after travelling `t` (0..1) of the total great-circle distance.
const along = (pts: LonLat[], t: number): { line: LonLat[]; head: LonLat } => {
  const legs = pts.slice(1).map((p, i) => geoDistance(pts[i], p));
  const total = legs.reduce((a, b) => a + b, 0) || 1;
  let left = t * total;
  const line: LonLat[] = [pts[0]];
  for (let i = 0; i < legs.length; i++) {
    if (left >= legs[i]) {
      line.push(pts[i + 1]);
      left -= legs[i];
      continue;
    }
    const head = geoInterpolate(pts[i], pts[i + 1])(legs[i] ? left / legs[i] : 1) as LonLat;
    // Sample the partial leg so it still bends along the great circle.
    const steps = 24;
    const f = legs[i] ? left / legs[i] : 1;
    for (let k = 1; k <= steps; k++) line.push(geoInterpolate(pts[i], pts[i + 1])((f * k) / steps) as LonLat);
    return { line, head };
  }
  return { line, head: pts[pts.length - 1] };
};

// Fraction of the route at which each place is reached.
const arrivals = (pts: LonLat[]): number[] => {
  const legs = pts.slice(1).map((p, i) => geoDistance(pts[i], p));
  const total = legs.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return [0, ...legs.map((d) => (acc += d) / total)];
};

export const MapScene: React.FC<SceneProps> = ({ scene, theme, format }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames, fps } = useVideoConfig();
  const places = validPlaces(scene.places);
  const pts = places.map((p) => [p.lon, p.lat] as LonLat);
  const short = format === "short";
  // Keep the map clear of the heading above and the captions below.
  const rect: [[number, number], [number, number]] = short ? [[90, 420], [width - 90, 1220]] : [[200, 210], [width - 200, 900]];
  const lon0 = midLon(pts);
  const close = fit(box(pts, lon0, 0.35, pts.length > 1 ? 1.5 : 3), rect);
  const wide = fit(box(pts, lon0, 2.5, 25), rect);

  const fly = interpolate(frame, [0, durationInFrames * 0.4], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const scale = wide.scale * Math.pow(close.scale / wide.scale, fly);
  const center = geoInterpolate(wide.center, close.center)(fly) as LonLat;
  const proj = geoMercator()
    .rotate([-lon0, 0])
    .scale(scale)
    .center(center)
    .translate([(rect[0][0] + rect[1][0]) / 2, (rect[0][1] + rect[1][1]) / 2]);
  const path = geoPath(proj);

  const routed = pts.length > 1 && scene.route !== false;
  const travel = routed
    ? interpolate(frame, [durationInFrames * 0.3, durationInFrames * 0.85], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      })
    : 1;
  const reached = arrivals(pts);
  const route = routed ? along(pts, travel) : null;
  const head = route ? proj(route.head) : null;
  const k = unit(format);

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="vignette" cx="50%" cy="45%" r="70%">
            <stop offset="60%" stopColor={theme.background} stopOpacity={0} />
            <stop offset="100%" stopColor={theme.background} stopOpacity={0.95} />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width={width} height={height} fill={theme.background} />
        <path d={path(GRATICULE) ?? ""} fill="none" stroke={theme.accent2} strokeOpacity={0.12} strokeWidth={1} />
        <path d={path(WORLD) ?? ""} fill={theme.background2} stroke={theme.accent2} strokeOpacity={0.45} strokeWidth={1.2} />
        {route ? (
          <path
            d={path({ type: "LineString", coordinates: route.line }) ?? ""}
            fill="none"
            stroke={theme.accent}
            strokeWidth={7 * k}
            strokeLinecap="round"
            strokeDasharray={`${18 * k} ${12 * k}`}
            filter="url(#glow)"
          />
        ) : null}
        {head && travel > 0 && travel < 1 ? (
          <g filter="url(#glow)">
            <circle cx={head[0]} cy={head[1]} r={16 * k} fill={theme.text} />
            <circle cx={head[0]} cy={head[1]} r={30 * k} fill="none" stroke={theme.accent} strokeWidth={4} />
          </g>
        ) : null}
        <rect width={width} height={height} fill="url(#vignette)" />
      </svg>
      {places.map((p, i) => {
        const xy = proj([p.lon, p.lat]);
        if (!xy) return null;
        const at = routed ? durationInFrames * (0.3 + 0.55 * reached[i]) : durationInFrames * (0.3 + 0.1 * i);
        const anchor = xy[0] < width * 0.3 ? 15 : xy[0] > width * 0.7 ? 85 : 50; // keep labels inside the frame
        return <Pin key={i} x={xy[0]} y={xy[1]} anchor={anchor} name={p.name} at={at} fps={fps} theme={theme} k={k} />;
      })}
      <AbsoluteFill style={{ padding: short ? "220px 80px 0" : "60px 160px 0", alignItems: "center" }}>
        <div style={{ padding: "14px 34px", borderRadius: 18, background: `${theme.background}d9` }}>
          <Heading text={scene.heading} theme={theme} format={format} size={52} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Pin: React.FC<{ x: number; y: number; anchor: number; name: string; at: number; fps: number; theme: SceneProps["theme"]; k: number }> = ({
  x,
  y,
  anchor,
  name,
  at,
  fps,
  theme,
  k,
}) => {
  const frame = useCurrentFrame();
  const p = spring({ frame: frame - at, fps, config: { damping: 11, mass: 0.6 } });
  const ring = ((frame - at) % 40) / 40;
  if (frame < at) return null;
  const size = 26 * k;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)" }}>
      <div
        style={{
          position: "absolute",
          left: -size,
          top: -size,
          width: size * 2,
          height: size * 2,
          borderRadius: "50%",
          border: `4px solid ${theme.accent}`,
          opacity: 1 - ring,
          transform: `scale(${0.5 + ring * 1.6})`,
        }}
      />
      <div
        style={{
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          borderRadius: "50%",
          background: theme.accent,
          border: `5px solid ${theme.text}`,
          transform: `scale(${p})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: size,
          transform: `translate(-${anchor}%, ${(1 - p) * 20}px)`,
          opacity: p,
          whiteSpace: "nowrap",
          padding: "8px 20px",
          borderRadius: 12,
          background: theme.text,
          color: theme.background,
          fontFamily: theme.font,
          fontWeight: 800,
          fontSize: 34 * k,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        {name}
      </div>
    </div>
  );
};
