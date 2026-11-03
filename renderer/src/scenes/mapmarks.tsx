// Data drawn on a map, the way news explainers annotate a satellite view: arrows for what flows where,
// ships streaming along a lane, range rings, hatched danger zones, measured distances and strikes.
// Each mark draws itself in after the camera arrives, one after another, then keeps moving.
import React from "react";
import { geoCircle, geoDistance, type GeoProjection } from "d3-geo";
import { Easing, interpolate } from "remotion";
import type { MapMark, Theme } from "../types";

type XY = [number, number];

const COLORS: Record<string, string> = { red: "#f43f5e", amber: "#fbbf24", blue: "#38bdf8", white: "#f8fafc" };
const DEFAULT_COLOR: Record<MapMark["kind"], string> = {
  flow: "amber",
  traffic: "white",
  ring: "red",
  zone: "red",
  ruler: "white",
  strike: "red",
};

// A smooth line through the points (Catmull-Rom), sampled densely, with its length so far at each sample.
const smooth = (pts: XY[], per = 16): { pts: XY[]; at: number[] } => {
  if (pts.length < 3) {
    const out: XY[] = [];
    for (let i = 0; i < pts.length - 1; i++)
      for (let j = 0; j < per; j++) {
        const f = j / per;
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
      }
    out.push(pts[pts.length - 1]);
    return withLength(out);
  }
  const out: XY[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return withLength(out);
};

const withLength = (pts: XY[]) => {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, at };
};

// The point `f` (0..1) of the way along, and the direction there in degrees.
const pointAt = (line: { pts: XY[]; at: number[] }, f: number): { xy: XY; deg: number } => {
  const total = line.at[line.at.length - 1] || 1;
  const want = Math.max(0, Math.min(1, f)) * total;
  let i = 1;
  while (i < line.at.length - 1 && line.at[i] < want) i++;
  const a = line.pts[i - 1];
  const b = line.pts[i];
  const seg = line.at[i] - line.at[i - 1] || 1;
  const g = (want - line.at[i - 1]) / seg;
  return { xy: [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g], deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
};

const upTo = (line: { pts: XY[]; at: number[] }, f: number): XY[] => {
  const total = line.at[line.at.length - 1] || 1;
  const out = line.pts.filter((_, i) => line.at[i] <= f * total);
  out.push(pointAt(line, f).xy);
  return out;
};

const d = (pts: XY[]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");

let TAKEN: Box[] = [];

const Label: React.FC<{ x: number; y: number; text: string; color: string; k: number; font: string; opacity: number; anchor?: "start" | "middle" | "end" }> = ({
  x,
  y: wantY,
  text,
  color,
  k,
  font,
  opacity,
  anchor = "middle",
}) => {
  const y = clear(TAKEN, x, wantY, text, k, anchor);
  return (
  <text
    x={x}
    y={y}
    textAnchor={anchor}
    dominantBaseline="central"
    fill={color}
    stroke="#020617"
    strokeWidth={6 * k}
    strokeOpacity={0.85}
    paintOrder="stroke"
    fontFamily={font}
    fontWeight={800}
    fontSize={27 * k}
    letterSpacing={1.5}
    opacity={opacity}
    style={{ textTransform: "uppercase" }}
  >
    {text}
  </text>
  );
};

export const markStarts = (marks: MapMark[], from: number): number[] =>
  marks.map((m, i) => (m.at != null ? m.at : Math.min(0.82, from + 0.05 + i * 0.11)));

// Labels already placed this frame, so a later one steps aside instead of printing over them.
type Box = { x0: number; x1: number; y0: number; y1: number };
const clear = (taken: Box[], x: number, y: number, text: string, k: number, anchor: "start" | "middle" | "end"): number => {
  const w = text.length * 27 * k * 0.68 + 16;
  const h = 27 * k * 1.25;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  for (const dy of [0, h, -h, 2 * h, -2 * h, 3 * h, -3 * h]) {
    const b = { x0, x1: x0 + w, y0: y + dy - h / 2, y1: y + dy + h / 2 };
    if (!taken.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) {
      taken.push(b);
      return y + dy;
    }
  }
  return y;
};

export const MapMarks: React.FC<{
  marks: MapMark[];
  proj: GeoProjection;
  frame: number;
  D: number;
  fps: number;
  from: number; // when the camera has arrived, 0..1 of the scene
  k: number;
  theme: Theme;
  id: string;
}> = ({ marks, proj, frame, D, fps, from, k, theme, id }) => {
  const starts = markStarts(marks, from);
  TAKEN = []; // labels are laid out afresh each frame, in the order the marks appear
  const xy = (p: [number, number]) => proj(p) as XY | null;
  return (
    <g>
      <defs>
        {Object.entries(COLORS).map(([name, c]) => (
          <pattern key={name} id={`hatch-${id}-${name}`} width={14 * k} height={14 * k} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={14 * k} height={14 * k} fill={c} fillOpacity={0.12} />
            <line x1={0} y1={0} x2={0} y2={14 * k} stroke={c} strokeWidth={4 * k} strokeOpacity={0.75} />
          </pattern>
        ))}
        <filter id={`markglow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={5} result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {marks.map((m, i) => {
        const start = D * starts[i];
        const p = interpolate(frame, [start, start + fps * 1.1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        });
        if (p <= 0) return null;
        const color = COLORS[m.color ?? DEFAULT_COLOR[m.kind]] ?? COLORS.white;
        const since = (frame - start) / fps; // seconds since it appeared
        const pts = (m.path ?? []).map(xy).filter(Boolean) as XY[];
        const fade = interpolate(frame, [start, start + fps * 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

        if ((m.kind === "flow" || m.kind === "traffic") && pts.length >= 2) {
          const line = smooth(pts);
          const total = line.at[line.at.length - 1];
          if (m.kind === "flow") {
            const w = (7 + 5 * Math.max(1, Math.min(5, m.width ?? 2))) * k;
            const shown = upTo(line, p);
            const tip = pointAt(line, p);
            const mid = pointAt(line, [0.5, 0.32, 0.68][i % 3]);
            // chevrons marching along the arrow once it is drawn
            const step = 70 * k;
            const chevrons = p >= 1 ? Array.from({ length: Math.floor(total / step) }, (_, j) => ((j * step + since * 90 * k) % total) / total) : [];
            return (
              <g key={i}>
                <path d={d(shown)} fill="none" stroke="#020617" strokeOpacity={0.55} strokeWidth={w + 8 * k} strokeLinecap="round" strokeLinejoin="round" />
                <path d={d(shown)} fill="none" stroke={color} strokeOpacity={0.9} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" filter={`url(#markglow-${id})`} />
                {chevrons.map((f, j) => {
                  if (f > 0.9) return null;
                  const c = pointAt(line, f);
                  return (
                    <path key={j} d={`M${-w * 0.25} ${-w * 0.32} L${w * 0.15} 0 L${-w * 0.25} ${w * 0.32}`} fill="none" stroke="#020617" strokeOpacity={0.5} strokeWidth={3 * k} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${c.xy[0]} ${c.xy[1]}) rotate(${c.deg})`} />
                  );
                })}
                <path d={`M${-w * 0.2} ${-w * 1.05} L${w * 1.5} 0 L${-w * 0.2} ${w * 1.05} Z`} fill={color} stroke="#020617" strokeOpacity={0.5} strokeWidth={2 * k} transform={`translate(${tip.xy[0]} ${tip.xy[1]}) rotate(${tip.deg})`} />
                {m.label ? <Label x={mid.xy[0]} y={mid.xy[1] - w - 26 * k} text={m.label} color={color} k={k} font={theme.font} opacity={p} /> : null}
              </g>
            );
          }
          // traffic: a lane drawn faintly, with ships streaming along it at a steady pace
          const n = Math.round(6 + 3 * Math.max(1, Math.min(5, m.width ?? 2)));
          const speed = (55 * k) / Math.max(total, 1); // fraction of the lane per second
          const label = pointAt(line, [0.5, 0.3, 0.7][i % 3]);
          return (
            <g key={i} opacity={fade}>
              <path d={d(line.pts)} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={10 * k} strokeLinecap="round" />
              <path d={d(line.pts)} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={2 * k} strokeDasharray={`${10 * k} ${12 * k}`} />
              {Array.from({ length: n }, (_, j) => {
                const f = (j / n + since * speed + (i * 0.37) % 1) % 1;
                const at = pointAt(line, f);
                const edge = Math.min(1, f / 0.06, (1 - f) / 0.06);
                return (
                  <g key={j} transform={`translate(${at.xy[0]} ${at.xy[1]}) rotate(${at.deg})`} opacity={edge}>
                    <path d={`M${-11 * k} ${-4.5 * k} L${7 * k} ${-4.5 * k} L${13 * k} 0 L${7 * k} ${4.5 * k} L${-11 * k} ${4.5 * k} Z`} fill={color} stroke="#020617" strokeWidth={1.5 * k} filter={`url(#markglow-${id})`} />
                  </g>
                );
              })}
              {m.label ? <Label x={label.xy[0]} y={label.xy[1] - 34 * k} text={m.label} color={color} k={k} font={theme.font} opacity={fade} /> : null}
            </g>
          );
        }

        if (m.kind === "ring" && m.point && m.km) {
          const deg = (m.km / 6371) * (180 / Math.PI);
          const ring = geoCircle().center(m.point).radius(Math.max(1e-4, deg * p)).precision(2)();
          const shape = ringPath(proj, ring.coordinates[0] as [number, number][]);
          const c = xy(m.point);
          const top = xy([m.point[0], Math.min(84, m.point[1] + deg * p)]);
          const pulse = (since * 0.6) % 1;
          return (
            <g key={i}>
              <path d={shape} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={4 * k} strokeDasharray={`${16 * k} ${10 * k}`} strokeOpacity={0.95} />
              {p >= 1 ? (
                <path d={ringPath(proj, geoCircle().center(m.point).radius(deg * pulse).precision(2)().coordinates[0] as [number, number][])} fill="none" stroke={color} strokeWidth={3 * k} strokeOpacity={0.6 * (1 - pulse)} />
              ) : null}
              {c ? <circle cx={c[0]} cy={c[1]} r={9 * k} fill={color} stroke="#020617" strokeWidth={3 * k} /> : null}
              {top && m.label ? <Label x={top[0]} y={top[1] + 30 * k} text={`${m.label} · ${Math.round(m.km).toLocaleString("en-GB")} km`} color={color} k={k} font={theme.font} opacity={p} /> : null}
            </g>
          );
        }

        if (m.kind === "zone" && pts.length >= 3) {
          const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
          const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
          const s = 0.85 + 0.15 * p;
          const closed = d(pts) + "Z";
          return (
            <g key={i} opacity={fade}>
              <g transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`}>
                <path d={closed} fill={`url(#hatch-${id}-${m.color ?? DEFAULT_COLOR.zone})`} />
                <path d={closed} fill="none" stroke={color} strokeWidth={4 * k} strokeDasharray={`${14 * k} ${9 * k}`} strokeDashoffset={-since * 20 * k} />
              </g>
              {m.label ? <Label x={cx} y={cy} text={m.label} color="#fff" k={k} font={theme.font} opacity={p} /> : null}
            </g>
          );
        }

        if (m.kind === "ruler" && m.path && m.path.length >= 2) {
          const a = xy(m.path[0]);
          const b = xy(m.path[m.path.length - 1]);
          if (!a || !b) return null;
          const km = geoDistance(m.path[0], m.path[m.path.length - 1]) * 6371;
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const nx = -Math.sin(ang);
          const ny = Math.cos(ang);
          const e: XY = [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
          const tick = 18 * k;
          const shown = Math.round(km * p);
          const mid: XY = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
          const flip = ny < 0 ? -1 : 1;
          const text = `${m.label ? `${m.label} · ` : ""}${shown >= 10 ? shown.toLocaleString("en-GB") : (km * p).toFixed(1)} km`;
          return (
            <g key={i}>
              <line x1={a[0]} y1={a[1]} x2={e[0]} y2={e[1]} stroke="#020617" strokeOpacity={0.6} strokeWidth={9 * k} strokeLinecap="round" />
              <line x1={a[0]} y1={a[1]} x2={e[0]} y2={e[1]} stroke={color} strokeWidth={4 * k} strokeLinecap="round" />
              <line x1={a[0] - nx * tick} y1={a[1] - ny * tick} x2={a[0] + nx * tick} y2={a[1] + ny * tick} stroke={color} strokeWidth={4 * k} />
              <line x1={e[0] - nx * tick} y1={e[1] - ny * tick} x2={e[0] + nx * tick} y2={e[1] + ny * tick} stroke={color} strokeWidth={4 * k} />
              <Label x={mid[0] - nx * flip * 40 * k} y={mid[1] - ny * flip * 40 * k} text={text} color={color} k={k} font={theme.font} opacity={fade} />
            </g>
          );
        }

        if (m.kind === "strike" && m.point) {
          const c = xy(m.point);
          if (!c) return null;
          const flash = interpolate(since, [0, 0.15, 0.9], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const pulses = [0, 0.5].map((o) => ((since * 0.8 + o) % 1));
          return (
            <g key={i}>
              <circle cx={c[0]} cy={c[1]} r={60 * k * (0.3 + flash)} fill="#fde68a" fillOpacity={0.55 * flash} filter={`url(#markglow-${id})`} />
              {pulses.map((q, j) => (
                <circle key={j} cx={c[0]} cy={c[1]} r={(14 + 46 * q) * k} fill="none" stroke={color} strokeWidth={4 * k} strokeOpacity={0.9 * (1 - q) * fade} />
              ))}
              <circle cx={c[0]} cy={c[1]} r={11 * k} fill={color} stroke="#fff" strokeWidth={3 * k} />
              <path d={`M${c[0] - 7 * k} ${c[1] - 7 * k} L${c[0] + 7 * k} ${c[1] + 7 * k} M${c[0] + 7 * k} ${c[1] - 7 * k} L${c[0] - 7 * k} ${c[1] + 7 * k}`} stroke="#fff" strokeWidth={3 * k} />
              {m.label ? <Label x={c[0] + 28 * k} y={c[1]} text={m.label} color="#fff" k={k} font={theme.font} opacity={fade} anchor="start" /> : null}
            </g>
          );
        }
        return null;
      })}
    </g>
  );
};

// A ring's outline on screen, point by point (so it is never clipped or wrapped by the projection).
const ringPath = (proj: GeoProjection, ring: [number, number][]) => d(ring.map((q) => proj(q)).filter(Boolean) as XY[]) + "Z";

// The points a scene's marks cover, so the camera frames them along with the places: every point of a
// path, a strike, and a ring's centre with its north, south, east and west edges.
export const markPoints = (marks: MapMark[] | null | undefined): [number, number][] =>
  (marks ?? []).flatMap((m) => {
    if (m.kind === "ring" && m.point && m.km) {
      const dl = (m.km / 6371) * (180 / Math.PI);
      const dx = dl / Math.max(0.2, Math.cos((m.point[1] * Math.PI) / 180));
      return [m.point, [m.point[0], m.point[1] + dl], [m.point[0], m.point[1] - dl], [m.point[0] + dx, m.point[1]], [m.point[0] - dx, m.point[1]]] as [number, number][];
    }
    return [...(m.path ?? []), ...(m.point ? [m.point] : [])];
  }).filter((p) => Math.abs(p[1]) <= 80 && Math.abs(p[0]) <= 180);
