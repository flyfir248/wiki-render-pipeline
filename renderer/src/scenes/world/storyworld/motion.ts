// The Motion Director: how things move over time, where the Animation Director (fyt/animation.py) and
// the beats say what they do. Everything here is worked out from the frame number alone, so frame 200
// rendered before frame 100 comes out the same.
//
// - A thing travelling with nowhere named (a plane on its way, a ship under way, someone walking past)
//   keeps going across the beats of its scene at one steady speed, from where the last beat left it,
//   instead of starting over from its spot each beat (the MOAB C-130 jumped back 68 units at every cue).
// - Each kind of travel has its own speed profile: a cruise is steady, a trip to a named spot speeds
//   up and slows down (a vehicle more gently than a person), a fall accelerates under gravity
//   (index.tsx `carry`), and an approach or departure eases in or out.
// - What is left of a jump or a sudden turn (a beat that turns someone round, a subject swapped in the
//   frame, a blast that changes what the camera must take in) is bridged over a few frames, never
//   across a cut; steady motion passes through unchanged.
import type { CastMember } from "./types";

export const CRUISING = ["walk", "run", "carry", "drive", "fly", "swim", "move", "approach", "depart", "climb"];

// Steady speed per second: a vehicle in its own lengths, anything else in stage units (about one
// person-and-a-gap).
export const rateOf = (verb: string, archetype: string) =>
  !CRUISING.includes(verb) ? 0 : archetype === "vehicle" ? 0.7 : verb === "run" ? 1.0 : verb === "climb" ? 0.25 : 0.5;

// A trip from one spot to another: speeding up over its first part, steady, slowing over its last
// (a trapezoid of speed, so neither the start nor the stop is a jolt). `a`: the share spent speeding up.
export const trip = (u: number, a = 0.25) => {
  const x = Math.min(1, Math.max(0, u));
  const top = 1 / (1 - a); // the steady speed, so the whole trip covers 1
  if (x < a) return (top * x * x) / (2 * a);
  if (x > 1 - a) return 1 - (top * (1 - x) * (1 - x)) / (2 * a);
  return top * (x - a / 2);
};

// Each cast member of the beat being played, with how far it has travelled on its own heading before
// this beat (`drift`) and whether it travels on now (`cruising`). casts[s]: the cast as beat s plays it;
// edges[s] .. edges[s + 1]: beat s's frames. Its first stretch of travel is centred on its spot, so a
// plane flying through the whole scene passes its spot half way, as it did when the scene had one beat.
export const withDrift = (casts: CastMember[][], edges: number[], fps: number, i: number): CastMember[] =>
  casts[i].map((c, n) => {
    if (c.attached || c.released) return { ...c, drift: 0, cruising: false };
    const go = (s: number) => {
      const m = casts[s][n];
      return m.to && m.to !== m.at ? 0 : rateOf(m.verb, m.build.archetype) * ((edges[s + 1] - edges[s]) / fps);
    };
    const named = (s: number) => Boolean(casts[s][n].to && casts[s][n].to !== casts[s][n].at);
    let drift = 0;
    let first = true; // still on its first stretch (nowhere named yet)
    for (let s = 0; s < i; s++) {
      if (named(s)) {
        drift = 0; // it arrives at the spot it was sent to
        first = false;
      } else drift += go(s);
    }
    if (first) {
      let run = 0;
      for (let s = 0; s < casts.length && !named(s); s++) run += go(s);
      drift -= run / 2;
    }
    return { ...c, drift, cruising: !named(i) && rateOf(c.verb, c.build.archetype) > 0 };
  });

type Cam = { pos: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown }; look: Cam["pos"]; fov: number; setup: number; roll: number };
type Actor = { pos: Cam["pos"]; yaw: number; hidden?: boolean; drop?: number; boom?: number; m: { verb: string } };
type State = { sg: { i: number }; b: { actors: Actor[]; cam: Cam } };

// How far either side of a frame a jump or a sudden turn is spread, in seconds.
export const BRIDGE = 0.3;

// The blocking at `frame` with any jump or sudden turn bridged: each value is a weighted mean of the
// same value over the frames around it (a bell curve, at most BRIDGE seconds either side). The mean of
// a steady motion is the motion itself, so steady travel and a held camera are untouched; a jump becomes
// a quick glide and a snap turn a quick turn. The camera is only blended within its own shot, never
// across a cut; a fall and a blast keep their own abrupt timing. `at(f)` gives the raw blocking of frame f.
export const bridged = <S extends State>(at: (f: number) => S, frame: number, D: number, fps: number): S => {
  const here = at(frame);
  const N = Math.max(1, Math.round(BRIDGE * fps));
  const sigma = N / 2;
  const around: { s: S; j: number; w: number }[] = [];
  for (let j = -N; j <= N; j++) {
    const f = frame + j;
    if (f < 0 || f > D - 1) continue;
    around.push({ s: j === 0 ? here : at(f), j, w: Math.exp(-(j * j) / (2 * sigma * sigma)) });
  }
  // only as far either side as both sides can be used: a lopsided mean would trail a moving thing
  // (near a cut, the end of the scene or a release, less is smoothed rather than anything lagging)
  const even = (ok: (s: S) => boolean) => {
    let r = 0;
    while (r < N && [r + 1, -(r + 1)].every((j) => around.some((x) => x.j === j && ok(x.s)))) r++;
    return around.filter((x) => Math.abs(x.j) <= r);
  };
  // the camera, within its shot
  const shot = even((s) => s.sg.i === here.sg.i && s.b.cam.setup === here.b.cam.setup);
  const mean = (pick: (s: S) => number, list = shot) => {
    let sum = 0, wsum = 0;
    for (const { s, w } of list) {
      sum += pick(s) * w;
      wsum += w;
    }
    return sum / wsum;
  };
  const cam = here.b.cam;
  cam.pos.set(mean((s) => s.b.cam.pos.x), mean((s) => s.b.cam.pos.y), mean((s) => s.b.cam.pos.z));
  cam.look.set(mean((s) => s.b.cam.look.x), mean((s) => s.b.cam.look.y), mean((s) => s.b.cam.look.z));
  cam.fov = mean((s) => s.b.cam.fov);
  cam.roll = mean((s) => s.b.cam.roll);
  // each actor's place and heading, unless it is falling, landing or blowing up (abrupt by design)
  here.b.actors.forEach((p, n) => {
    const abrupt = (s: S) => {
      const q = s.b.actors[n];
      return !q || q.hidden || q.drop !== undefined || q.boom !== undefined || ["fall", "crash", "explode"].includes(q.m.verb);
    };
    if (abrupt(here)) return;
    const list = even((s) => !abrupt(s));
    p.pos.set(mean((s) => s.b.actors[n].pos.x, list), mean((s) => s.b.actors[n].pos.y, list), mean((s) => s.b.actors[n].pos.z, list));
    // headings followed frame to frame the short way round (so turning about takes it round, not
    // through a blur of in-between headings), then averaged
    const turned = new Map<number, number>();
    let prev = 0;
    for (const [idx, x] of [...list].sort((a, b) => a.j - b.j).entries()) {
      const y = x.s.b.actors[n].yaw;
      prev = idx === 0 ? y : prev + Math.atan2(Math.sin(y - prev), Math.cos(y - prev));
      turned.set(x.j, prev);
    }
    const yaw = mean((s) => turned.get(list.find((x) => x.s === s)!.j)!, list);
    p.yaw = here.b.actors[n].yaw + Math.atan2(Math.sin(yaw - here.b.actors[n].yaw), Math.cos(yaw - here.b.actors[n].yaw));
  });
  return here;
};
