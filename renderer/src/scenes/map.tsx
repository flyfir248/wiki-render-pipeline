// Animated map in an atlas style: a blue ocean with a labelled grid of latitude and longitude, pale
// land with country borders and names, the countries involved highlighted, and a small globe showing
// where in the world the view is. The camera flies in from a wide view to the places, pins drop, and
// a route draws itself along the great circle between them, ending with its length.
import React, { useMemo } from "react";
import {
  geoArea,
  geoCentroid,
  geoContains,
  geoDistance,
  geoGraticule,
  geoInterpolate,
  geoMercator,
  geoOrthographic,
  geoPath,
} from "d3-geo";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-50m.json";
import coarse from "world-atlas/countries-110m.json";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Place } from "../types";
import { unit } from "../theme";
import { Heading, type SceneProps } from "./shared";

const atlas = countries as any;
const WORLD = feature(atlas, atlas.objects.countries) as unknown as FeatureCollection;
const coarseAtlas = coarse as any;
// The detailed outlines only matter close up; a wide view uses the lighter set.
const WORLD_COARSE = feature(coarseAtlas, coarseAtlas.objects.countries) as unknown as FeatureCollection;
const GLOBE_LAND = feature(coarseAtlas, coarseAtlas.objects.land) as unknown as Feature;

// Fixed atlas colours: a map has to read the same on every channel theme.
const OCEAN = "#123651";
const OCEAN_DEEP = "#0a2035";
const LAND = "#e4dcc6";
const BORDER = "#9c9178";
const LABEL = "#5c5442";
const GRID = "#cfe3f2";

// Country names placed where the country's biggest piece is, with its size for ranking.
type CountryLabel = { name: string; at: [number, number]; area: number };
const LABELS: CountryLabel[] = WORLD.features
  .map((f) => {
    const g = f.geometry as Polygon | MultiPolygon;
    const parts: Polygon[] = g.type === "MultiPolygon" ? g.coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : [g];
    const main = parts.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
    return { name: String(f.properties?.name ?? ""), at: geoCentroid(main) as [number, number], area: geoArea(main) };
  })
  .filter((l) => l.name && l.area > 0)
  .sort((a, b) => b.area - a.area);

// Seas and oceans, named in italics on the water. Big oceans have a few anchor points; the one
// nearest the middle of the view is used.
const WATERS: { name: string; at: [number, number]; size: number }[] = [
  ...[[-40, 35], [-30, 5], [-20, -25], [-62, 38], [-35, 50], [-67, 39.5], [-73, 34], [-20, 45]].map((at) => ({ name: "Atlantic Ocean", at: at as [number, number], size: 3 })),
  ...[[-150, 30], [-130, 5], [-120, -25], [165, 30], [160, 0], [-170, -10]].map((at) => ({ name: "Pacific Ocean", at: at as [number, number], size: 3 })),
  ...[[80, -15], [70, -30], [95, -10]].map((at) => ({ name: "Indian Ocean", at: at as [number, number], size: 3 })),
  { name: "Southern Ocean", at: [20, -58], size: 3 },
  { name: "Arctic Ocean", at: [0, 78], size: 3 },
  { name: "Arabian Sea", at: [64, 15], size: 2 },
  { name: "Bay of Bengal", at: [88, 15], size: 2 },
  { name: "South China Sea", at: [114, 14], size: 2 },
  { name: "Gulf of Mexico", at: [-90, 25], size: 2 },
  { name: "Caribbean Sea", at: [-75, 15], size: 2 },
  { name: "Mediterranean Sea", at: [18, 35], size: 2 },
  { name: "North Sea", at: [3, 56], size: 1 },
  { name: "Baltic Sea", at: [19, 57], size: 1 },
  { name: "Black Sea", at: [34, 43.3], size: 1 },
  { name: "Red Sea", at: [38.5, 20], size: 1 },
  { name: "Persian Gulf", at: [51.5, 27], size: 1 },
  { name: "Sea of Japan", at: [135, 40], size: 1 },
  { name: "Gulf of Maine", at: [-68.5, 42.6], size: 1 },
  { name: "Hudson Bay", at: [-85, 60], size: 2 },
  { name: "Tasman Sea", at: [160, -38], size: 2 },
  { name: "Bering Sea", at: [-178, 58], size: 2 },
  { name: "English Channel", at: [-2, 50.1], size: 1 },
  { name: "Caspian Sea", at: [50.5, 42], size: 1 },
];
// How many degrees across the view can be for a water label of each size to be worth showing.
const WATER_SPAN: Record<number, [number, number]> = { 1: [2, 30], 2: [6, 90], 3: [6, 400] };

// Grid spacing that leaves a handful of lines across a view `span` degrees wide.
const STEPS = [1, 2, 5, 10, 15, 30];
const gridStep = (span: number) => STEPS.find((s) => span / s <= 8) ?? 30;
const degrees = (v: number, pos: string, neg: string) => (v === 0 ? "0°" : `${Math.abs(Math.round(v))}°${v > 0 ? pos : neg}`);

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

// When each pin drops, in frames from the scene's start: as the route reaches it, or one after another.
export const pinFrames = (scene: SceneProps["scene"], frames: number): number[] => {
  const pts = validPlaces(scene.places).map((p) => [p.lon, p.lat] as LonLat);
  const routed = pts.length > 1 && scene.route !== false;
  const reached = arrivals(pts);
  return pts.map((_, i) => (routed ? frames * (0.3 + 0.55 * reached[i]) : frames * (0.3 + 0.1 * i)));
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
  const key = pts.map((p) => p.join(",")).join(";");
  // The countries the places are in, highlighted on the map.
  const involved = useMemo(
    () => WORLD.features.filter((f) => pts.some((p) => geoContains(f, p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

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
    .translate([(rect[0][0] + rect[1][0]) / 2, (rect[0][1] + rect[1][1]) / 2])
    // Cut everything off-screen before it becomes SVG: the detailed outlines are what makes maps slow.
    .clipExtent([[-20, -20], [width + 20, height + 20]]);
  const path = geoPath(proj).digits(1);
  const k = unit(format);

  // Grid: lines every `step` degrees for the current zoom, labelled along the edges.
  const span = (width / scale) * (180 / Math.PI);
  const step = gridStep(span);
  const grid = geoGraticule().step([step, step]).extentMajor([[-180, -80], [180, 80 + 1e-6]]).extentMinor([[-180, -80], [180, 80 + 1e-6]]);
  const topLeft = proj.invert!([0, 0]) as LonLat;
  const bottomRight = proj.invert!([width, height]) as LonLat;
  const latTicks: number[] = [];
  for (let v = Math.ceil(bottomRight[1] / step) * step; v <= topLeft[1]; v += step) if (Math.abs(v) <= 80) latTicks.push(v);
  const lonTicks: number[] = [];
  const west = topLeft[0];
  for (let v = Math.ceil(west / step) * step; v <= west + span; v += step) lonTicks.push(v);
  const edgeY = rect[1][1] - 16; // longitude labels along the bottom of the map area
  const lines = grid();
  const grow = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Country names that fit at this zoom, biggest first, never on top of each other or a pin.
  const pinXY = pts.map((p) => proj(p)).filter(Boolean) as [number, number][];
  // Each pin keeps its dot and its name tag (above it) clear of other labels.
  const pinBoxes = places.map((p) => {
    const xy = proj([p.lon, p.lat]);
    if (!xy) return null;
    const w = p.name.length * 34 * k * 0.62 + 60;
    return { x0: xy[0] - w / 2 - 20, x1: xy[0] + w / 2 + 20, y0: xy[1] - 120 * k, y1: xy[1] + 40 * k };
  });
  const clearOfPins = (x: number, y: number, w: number, h: number) =>
    !pinBoxes.some((b) => b && x + w / 2 > b.x0 && x - w / 2 < b.x1 && y + h / 2 > b.y0 && y - h / 2 < b.y1);
  const regional = span < 70;
  const globeR = short ? 105 : 85;
  const globeAt: [number, number] = short ? [width - 90 - globeR, 1220 - globeR - 10] : [width - 60 - globeR, height - 190 - globeR];
  const underGlobe = (x: number, y: number, pad: number) => regional && Math.hypot(x - globeAt[0], y - globeAt[1]) < globeR + pad;
  const placed: { x: number; y: number; w: number; h: number; name: string; size: number }[] = [];
  for (const l of LABELS) {
    if (placed.length >= 10) break;
    const xy = proj(l.at);
    if (!xy || xy[0] < 60 || xy[0] > width - 60 || xy[1] < rect[0][1] - 40 || xy[1] > rect[1][1] + 40) continue;
    const across = Math.sqrt(l.area) * scale; // rough size of the country on screen in pixels
    if (across < 90) continue;
    const size = Math.max(18, Math.min(34, across / 12)) * (short ? 1.15 : 1);
    const w = l.name.length * size * 0.66;
    const h = size * 1.3;
    const box = { x: xy[0] - w / 2, y: xy[1] - h / 2, w, h, name: l.name, size };
    if (box.x < 110 || box.x + w > width - 30 || underGlobe(xy[0], xy[1], w / 2 + 20)) continue;
    const hits = placed.some((o) => box.x < o.x + o.w + 12 && o.x < box.x + box.w + 12 && box.y < o.y + o.h && o.y < box.y + box.h);
    const nearPin = !clearOfPins(xy[0], xy[1], w, h);
    if (!hits && !nearPin) placed.push(box);
  }

  const mid: [number, number] = [(rect[0][0] + rect[1][0]) / 2, (rect[0][1] + rect[1][1]) / 2];
  const waters: { x: number; y: number; name: string; size: number }[] = [];
  const named = new Set<string>();
  const candidates = WATERS.map((wl) => ({ wl, xy: proj(wl.at) }))
    .filter(({ wl, xy }) => xy && span >= WATER_SPAN[wl.size][0] && span <= WATER_SPAN[wl.size][1])
    .sort((a, b) => Math.hypot(a.xy![0] - mid[0], a.xy![1] - mid[1]) - Math.hypot(b.xy![0] - mid[0], b.xy![1] - mid[1]));
  for (const { wl, xy } of candidates) {
    const [x, y] = xy!;
    const size = (wl.size === 3 ? 30 : 24) * (short ? 1.15 : 1);
    const w = wl.name.length * size * 0.5;
    if (named.has(wl.name) || x - w / 2 < 110 || x + w / 2 > width - 30 || y < rect[0][1] || y > (short ? 1500 : rect[1][1] - 40)) continue;
    if (underGlobe(x, y, w / 2 + 20) || !clearOfPins(x, y, w, size * 1.4)) continue;
    if (placed.some((o) => x + w / 2 > o.x && x - w / 2 < o.x + o.w && Math.abs(y - (o.y + o.h / 2)) < size)) continue;
    named.add(wl.name);
    waters.push({ x, y, name: wl.name, size });
  }

  const routed = pts.length > 1 && scene.route !== false;
  const travel = routed
    ? interpolate(frame, [durationInFrames * 0.3, durationInFrames * 0.85], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      })
    : 1;
  const route = routed ? along(pts, travel) : null;
  const head = route ? proj(route.head) : null;
  const miles = routed ? pts.slice(1).reduce((a, p, i) => a + geoDistance(pts[i], p), 0) * 3958.8 : 0;
  const total = useEnterAt(frame, durationInFrames * 0.86);

  // The locator globe, turned to face the places, with the current view outlined.
  const globe = geoOrthographic()
    .rotate([-close.center[0] - lon0, -Math.max(-60, Math.min(60, close.center[1]))])
    .scale(globeR)
    .translate(globeAt)
    .clipAngle(90);
  const globePath = geoPath(globe);
  const view: LonLat[] = [
    proj.invert!([rect[0][0], rect[0][1]]) as LonLat,
    proj.invert!([rect[1][0], rect[0][1]]) as LonLat,
    proj.invert!([rect[1][0], rect[1][1]]) as LonLat,
    proj.invert!([rect[0][0], rect[1][1]]) as LonLat,
  ];
  const viewOutline: Geometry = {
    type: "LineString",
    coordinates: [...view, view[0]].flatMap((p, i, all) =>
      i === 0 ? [p] : Array.from({ length: 8 }, (_, j) => geoInterpolate(all[i - 1], p)((j + 1) / 8) as LonLat),
    ),
  };

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="ocean" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor={OCEAN} />
            <stop offset="100%" stopColor={OCEAN_DEEP} />
          </radialGradient>
          <radialGradient id="vignette" cx="50%" cy="45%" r="72%">
            <stop offset="65%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width={width} height={height} fill="url(#ocean)" />
        <path d={path(lines) ?? ""} fill="none" stroke={GRID} strokeOpacity={0.22 * grow} strokeWidth={1.4} />
        {/* one path for land and borders: the map is the slowest thing to draw, so it is drawn once */}
        <path d={path(span > 90 ? WORLD_COARSE : WORLD) ?? ""} fill={LAND} stroke={BORDER} strokeWidth={1.2} strokeLinejoin="round" />
        {involved.map((f, i) => {
          // A country much bigger than the view (the whole USA around Boston) isn't worth highlighting.
          const [[x0, y0], [x1, y1]] = path.bounds(f);
          if ((x1 - x0) * (y1 - y0) > width * height * 1.5) return null;
          return <path key={i} d={path(f) ?? ""} fill={theme.accent} fillOpacity={0.3 * grow} stroke={theme.accent} strokeWidth={3} strokeOpacity={grow} />;
        })}
        {/* the grid continues faintly over land, so the lines read as one grid */}
        <path d={path(lines) ?? ""} fill="none" stroke="#000" strokeOpacity={0.06 * grow} strokeWidth={1} />
        {placed.map((l) => (
          <text
            key={l.name}
            x={l.x + l.w / 2}
            y={l.y + l.h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={LABEL}
            fillOpacity={0.85 * grow}
            fontFamily={theme.font}
            fontWeight={700}
            fontSize={l.size}
            letterSpacing={l.size * 0.12}
            style={{ textTransform: "uppercase" }}
          >
            {l.name}
          </text>
        ))}
        {waters.map((wl) => (
          <text
            key={wl.name}
            x={wl.x}
            y={wl.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={GRID}
            fillOpacity={0.6 * grow}
            fontFamily="Georgia, 'DejaVu Serif', serif"
            fontStyle="italic"
            fontSize={wl.size}
            letterSpacing={wl.size * 0.08}
          >
            {wl.name}
          </text>
        ))}
        {route ? (
          <path
            d={path({ type: "LineString", coordinates: route.line }) ?? ""}
            fill="none"
            stroke="#c2410c"
            strokeWidth={7 * k}
            strokeLinecap="round"
            strokeDasharray={`${18 * k} ${12 * k}`}
          />
        ) : null}
        {head && travel > 0 && travel < 1 ? (
          <g filter="url(#glow)">
            <circle cx={head[0]} cy={head[1]} r={16 * k} fill="#fff" />
            <circle cx={head[0]} cy={head[1]} r={30 * k} fill="none" stroke="#c2410c" strokeWidth={4} />
          </g>
        ) : null}
        <rect width={width} height={height} fill="url(#vignette)" />
        {/* grid labels along the edges */}
        {latTicks.map((v) => {
          const xy = proj([topLeft[0], v]);
          if (!xy || xy[1] < rect[0][1] - 30 || xy[1] > rect[1][1] + 30) return null;
          return (
            <text key={`lat${v}`} x={short ? 24 : 40} y={xy[1]} dominantBaseline="central" fill={GRID} fillOpacity={0.9 * grow} stroke={OCEAN_DEEP} strokeWidth={3} strokeOpacity={grow} paintOrder="stroke" fontFamily={theme.font} fontWeight={700} fontSize={22 * k}>
              {degrees(v, "N", "S")}
            </text>
          );
        })}
        {lonTicks.map((v) => {
          const xy = proj([v, 0]);
          if (!xy || xy[0] < 120 || xy[0] > width - 120 || underGlobe(xy[0], edgeY, 50)) return null;
          const lon = ((v + 540) % 360) - 180;
          return (
            <text key={`lon${v}`} x={xy[0]} y={edgeY} textAnchor="middle" fill={GRID} fillOpacity={0.9 * grow} stroke={OCEAN_DEEP} strokeWidth={3} strokeOpacity={grow} paintOrder="stroke" fontFamily={theme.font} fontWeight={700} fontSize={22 * k}>
              {degrees(lon, "E", "W")}
            </text>
          );
        })}
        {regional ? (
          <g opacity={grow}>
            <circle cx={globeAt[0]} cy={globeAt[1]} r={globeR + 6} fill="#000" fillOpacity={0.35} />
            <path d={globePath({ type: "Sphere" }) ?? ""} fill={OCEAN} stroke={GRID} strokeOpacity={0.7} strokeWidth={2} />
            <path d={globePath(GLOBE_LAND) ?? ""} fill={LAND} />
            <path d={globePath(viewOutline) ?? ""} fill="none" stroke={theme.accent} strokeWidth={3} />
            {pts.map((p, i) => {
              const xy = globe(p);
              return xy ? <circle key={i} cx={xy[0]} cy={xy[1]} r={4} fill="#c2410c" /> : null;
            })}
          </g>
        ) : null}
      </svg>
      {places.map((p, i) => {
        const xy = proj([p.lon, p.lat]);
        if (!xy) return null;
        const at = pinFrames(scene, durationInFrames)[i];
        const anchor = xy[0] < width * 0.3 ? 15 : xy[0] > width * 0.7 ? 85 : 50; // keep labels inside the frame
        return <Pin key={i} x={xy[0]} y={xy[1]} anchor={anchor} name={p.name} at={at} fps={fps} theme={theme} k={k} />;
      })}
      <AbsoluteFill style={{ padding: short ? "220px 80px 0" : "60px 160px 0", alignItems: "center" }}>
        <div style={{ padding: "14px 34px", borderRadius: 18, background: `${theme.background}e6` }}>
          <Heading text={scene.heading} theme={theme} format={format} size={52} />
        </div>
        {routed && miles >= 1 ? (
          <div
            style={{
              marginTop: 18,
              padding: "10px 26px",
              borderRadius: 14,
              background: "#c2410c",
              color: "#fff",
              fontFamily: theme.font,
              fontWeight: 800,
              fontSize: short ? 30 : 34,
              opacity: total,
              transform: `scale(${0.8 + 0.2 * total})`,
            }}
          >
            {distanceText(miles)}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const useEnterAt = (frame: number, at: number) =>
  interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

// "about 1,200 miles (1,900 kilometers)", rounded the way a narrator would say it.
export const distanceText = (miles: number): string => {
  const round = (v: number) => {
    const unit = v >= 1000 ? 100 : v >= 100 ? 10 : 1;
    return (Math.round(v / unit) * unit).toLocaleString("en-US");
  };
  return `about ${round(miles)} miles (${round(miles * 1.609344)} kilometers)`;
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
