// Motion QA: every story-world scene of a video played through frame by frame, as the renderer places
// it (segmentOf, block, then motion.ts `bridged`), without drawing anything, and checked for motion that
// would look jerky: a thing jumping between frames, a sudden turn, the camera jumping or lurching within
// a shot. A cut is allowed to move the camera anywhere; a fall's landing and a blast are abrupt by design
// and not flagged. Run by renderer/motion-check.mjs.
import { momentOf } from "../kit";
import { block, segmentOf } from "./index";
import { bridged } from "./motion";
import type { World } from "./types";

export type Finding = { scene: string; frame: number; what: string; detail: string };
type V = { x: number; y: number; z: number };

const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

export const checkScene = (scene: { id: string; start: number; end: number; world: World }, fps: number): Finding[] => {
  const D = Math.max(2, Math.round((scene.end - scene.start) * fps));
  const at = (f: number) => {
    const sg = segmentOf(scene.world, f, D, momentOf(scene as never), fps);
    return { sg, b: block(sg.world, sg.frame, fps, sg.D, sg.at, false, { u: f / Math.max(1, D - 1), t: f / fps, s: D / fps }) };
  };
  const rows = Array.from({ length: D }, (_, f) => {
    const { sg, b } = bridged(at, f, D, fps);
    return {
      shot: `${sg.i}/${b.cam.setup}`,
      cam: b.cam.pos.clone(),
      look: b.cam.look.clone(),
      actors: b.actors.map((p) => ({ e: p.m.entity, pos: p.pos.clone(), yaw: p.yaw, size: Math.max(p.w0, p.h), abrupt: Boolean(p.hidden || p.drop !== undefined || p.boom !== undefined || ["fall", "crash", "explode"].includes(p.m.verb)) })),
    };
  });
  const out: Finding[] = [];
  const add = (frame: number, what: string, detail: string) => {
    // one finding per kind of problem per thing in a burst of frames
    const last = out[out.length - 1];
    if (last && last.what === what && last.detail.split(":")[0] === detail.split(":")[0] && frame - last.frame < fps / 2) return;
    out.push({ scene: scene.id, frame, what, detail });
  };
  const n = rows[0]?.actors.length ?? 0;
  for (let a = 0; a < n; a++) {
    const steps = rows.slice(1).map((r, f) => dist(r.actors[a].pos, rows[f].actors[a].pos));
    const usual = Math.max(median(steps), 1e-3);
    for (let f = 1; f < D; f++) {
      const p = rows[f].actors[a], q = rows[f - 1].actors[a];
      if (p.abrupt || q.abrupt) continue;
      const cut = rows[f].shot !== rows[f - 1].shot;
      const step = steps[f - 1];
      // a jump: far more than its usual step and a good share of its own size, where no cut hides it
      if (!cut && step > Math.max(usual * 6, p.size * 0.15)) add(f, "jump", `${p.e}: moved ${step.toFixed(2)} in one frame (usually ${usual.toFixed(2)})`);
      // a lurch: its speed changing by more than its own usual step from one frame to the next
      if (!cut && f > 1 && !rows[f - 2].actors[a].abrupt && Math.abs(step - steps[f - 2]) > Math.max(usual * 1.5, p.size * 0.05))
        add(f, "lurch", `${p.e}: speed ${steps[f - 2].toFixed(2)} -> ${step.toFixed(2)} per frame`);
      // a snap turn: more than 25 degrees in a frame
      const r = turn(q.yaw, p.yaw);
      if (!cut && r > 0.44) add(f, "snap turn", `${p.e}: turned ${Math.round((r * 180) / Math.PI)} degrees in one frame`);
    }
  }
  // the camera, within each shot: a jump or a lurch measured against the shot's own pace and scale
  const camSteps = rows.slice(1).map((r, f) => dist(r.cam, rows[f].cam));
  const usual = Math.max(median(camSteps), 1e-3);
  for (let f = 1; f < D; f++) {
    if (rows[f].shot !== rows[f - 1].shot) continue;
    const reach = dist(rows[f].cam, rows[f].look);
    const step = camSteps[f - 1];
    if (step > Math.max(usual * 8, reach * 0.06)) add(f, "camera jump", `camera: moved ${step.toFixed(2)} in one frame, ${Math.round((step / reach) * 100)}% of its distance to the subject`);
    else if (f > 1 && rows[f - 1].shot === rows[f - 2].shot && Math.abs(step - camSteps[f - 2]) > Math.max(usual * 3, reach * 0.02))
      add(f, "camera lurch", `camera: speed ${camSteps[f - 2].toFixed(2)} -> ${step.toFixed(2)} per frame`);
  }
  return out;
};

export const checkProps = (props: { fps: number; scenes: { id: string; type: string; start: number; end: number; world?: World }[] }): Finding[] =>
  props.scenes.filter((s) => s.type === "world" && s.world).flatMap((s) => checkScene(s as never, props.fps));
