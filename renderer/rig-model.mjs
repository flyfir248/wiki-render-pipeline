// Rigs a still model (one mesh, no skeleton) so it can move: finds its legs, body, neck, head and tail
// (or its wings, or the length of a body that slithers or swims) from its shape, builds a skeleton
// through them, weights each vertex to the bones nearest it, and writes its clips: a walk and a run
// whose feet cover the ground they claim to, standing, eating, attacking and lying still. A shape it
// cannot read is left as it was, with the reason, rather than given a broken rig.
//
//   node rig-model.mjs in.glb out.glb [--type auto|quadruped|bird|serpent]
//
// Prints one JSON line: {ok, type, bones, clips, gait, checks} or {ok: false, reason}.
// The model faces +z with +y up (the Everything Library's convention, which split-model.mjs keeps).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize, prune, quantize } from "@gltf-transform/functions";

const [input, output, ...rest] = process.argv.slice(2);
const at = rest.indexOf("--type");
const want = at >= 0 ? rest[at + 1] : "auto";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const say = (o) => {
  console.log(JSON.stringify(o));
  process.exit(o.ok ? 0 : 1);
};
if (root.listSkins().length) say({ ok: false, reason: "already rigged" });
await doc.transform(dequantize());

// --- the mesh, in the model's own space -------------------------------------------------------------
const scene = root.listScenes()[0];
const meshNodes = root.listNodes().filter((n) => n.getMesh());
if (!meshNodes.length) say({ ok: false, reason: "no mesh" });
const done = new Set();
for (const node of meshNodes) {
  const M = node.getWorldMatrix();
  for (const prim of node.getMesh().listPrimitives()) {
    for (const [name, w] of [["POSITION", 1], ["NORMAL", 0]]) {
      const a = prim.getAttribute(name);
      if (!a || done.has(a)) continue;
      done.add(a);
      const v = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v);
        const o = [0, 1, 2].map((k) => M[k] * v[0] + M[4 + k] * v[1] + M[8 + k] * v[2] + (w ? M[12 + k] : 0));
        if (!w) {
          const l = Math.hypot(...o) || 1;
          o.forEach((_, k) => (o[k] /= l));
        }
        a.setElement(i, o);
      }
    }
  }
  // a skinned mesh is placed by its bones: it hangs straight off the scene, untransformed
  for (const p of [...node.listParents()]) if (p.propertyType === "Node") p.removeChild(node);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!scene.listChildren().includes(node)) scene.addChild(node);
}
for (const n of root.listNodes()) if (!n.getMesh() && !n.listChildren().length) n.dispose();

const prims = meshNodes.flatMap((n) => n.getMesh().listPrimitives());
const pts = [];
for (const prim of new Set(prims)) {
  const a = prim.getAttribute("POSITION");
  const v = [0, 0, 0];
  for (let i = 0; i < a.getCount(); i++) pts.push(a.getElement(i, v).slice());
}
const mn = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
const mx = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
const W = mx[0] - mn[0], H = mx[1] - mn[1], L = mx[2] - mn[2];
const cx = (mn[0] + mx[0]) / 2, g = mn[1];
const big = Math.max(W, H, L);
const mean = (ps, k) => ps.reduce((s, p) => s + p[k], 0) / Math.max(1, ps.length);

// --- reading the shape ------------------------------------------------------------------------------
// bones: name, parent, head (the joint) and tail (where the bone ends, for weighting)
const bones = [];
const bone = (name, parent, head, tail) => (bones.push({ name, parent, head, tail }), name);

const quadruped = () => {
  let band = pts.filter((p) => p[1] < g + H * 0.1);
  if (band.length < 8) band = pts.filter((p) => p[1] < g + H * 0.16);
  // two groups of feet along the body (k-means on z), each split into left and right
  let zb = Math.min(...band.map((p) => p[2])), zf = Math.max(...band.map((p) => p[2]));
  let back = [], front = [];
  for (let it = 0; it < 8; it++) {
    back = band.filter((p) => Math.abs(p[2] - zb) <= Math.abs(p[2] - zf));
    front = band.filter((p) => Math.abs(p[2] - zb) > Math.abs(p[2] - zf));
    zb = mean(back, 2);
    zf = mean(front, 2);
  }
  const gap = zf - zb;
  if (gap < L * 0.25) return `its feet are not apart along its body (${(gap / L).toFixed(2)} of its length)`;
  const feet = {};
  for (const [end, ps, z] of [["F", front, zf], ["B", back, zb]]) {
    for (const [side, keep] of [["L", (p) => p[0] >= cx], ["R", (p) => p[0] < cx]]) {
      const q = ps.filter(keep);
      if (q.length < 2) return `no ${side === "L" ? "left" : "right"} ${end === "F" ? "front" : "back"} foot`;
      feet[end + side] = [mean(q, 0), g, mean(q, 2)];
    }
    if (Math.abs(feet[end + "L"][0] - feet[end + "R"][0]) < W * 0.12) return "its left and right feet are not apart";
  }
  // the belly: the underside between the legs, along the middle
  const under = pts.filter((p) => p[2] > zb + gap * 0.35 && p[2] < zf - gap * 0.35 && Math.abs(p[0] - cx) < W * 0.15);
  if (!under.length) return "nothing between its legs to find a belly by";
  const belly = Math.min(...under.map((p) => p[1])) - g;
  if (belly < H * 0.05) return `its belly touches the ground (${(belly / H).toFixed(2)} of its height)`;
  const topAt = (z, r) => {
    const near = pts.filter((p) => Math.abs(p[2] - z) < L * r);
    return near.length ? Math.max(...near.map((p) => p[1])) - g : belly;
  };
  const hipY = g + belly + (topAt(zb, 0.08) - belly) * 0.3;
  const shoY = g + belly + (topAt(zf, 0.08) - belly) * 0.3;
  // the head: the front-most part beyond the shoulders
  const fore = pts.filter((p) => p[2] > zf + (mx[2] - zf) * 0.55);
  const headY = fore.length ? mean(fore, 1) : shoY;
  const headZ = zf + (mx[2] - zf) * 0.7;
  const neckY = shoY + (headY - shoY) * 0.45, neckZ = zf + (mx[2] - zf) * 0.3;
  bone("root", null, [cx, g, (zb + zf) / 2], [cx, g, zf]);
  bone("hips", "root", [cx, hipY, zb], [cx, hipY, (zb + zf) / 2]);
  bone("spine", "hips", [cx, (hipY + shoY) / 2, (zb + zf) / 2], [cx, shoY, zf]);
  bone("chest", "spine", [cx, shoY, zf], [cx, neckY, neckZ]);
  bone("neck", "chest", [cx, neckY, neckZ], [cx, headY, headZ]);
  bone("head", "neck", [cx, headY, headZ], [cx, headY, mx[2]]);
  if (zb - mn[2] > L * 0.08) bone("tail", "hips", [cx, hipY, zb - (zb - mn[2]) * 0.15], [cx, hipY, mn[2]]);
  for (const k of ["FL", "FR", "BL", "BR"]) {
    const f = feet[k];
    const top = k[0] === "F" ? shoY : hipY;
    const kn = g + belly * 0.5;
    bone(`leg${k}`, k[0] === "F" ? "chest" : "hips", [f[0], top, f[2]], [f[0], kn, f[2]]);
    bone(`shin${k}`, `leg${k}`, [f[0], kn, f[2]], [f[0], g, f[2]]);
  }
  return { legs: (hipY + shoY) / 2 - g, belly };
};

const bird = () => {
  if (W < L * 1.3) return "its wings are not spread";
  const body = pts.filter((p) => Math.abs(p[0] - cx) < W * 0.12);
  const cy = mean(body, 1), cz = mean(body, 2);
  bone("root", null, [cx, cy, cz], [cx, cy, mx[2]]);
  bone("head", "root", [cx, cy, cz + L * 0.2], [cx, cy, mx[2]]);
  bone("tail", "root", [cx, cy, cz - L * 0.15], [cx, cy, mn[2]]);
  for (const [s, sign] of [["L", 1], ["R", -1]]) {
    const edge = sign > 0 ? mx[0] : mn[0];
    const inner = [cx + sign * W * 0.08, cy, cz], mid = [cx + (edge - cx) * 0.5, cy, cz];
    bone(`wing${s}`, "root", inner, mid);
    bone(`tip${s}`, `wing${s}`, mid, [edge, cy, cz]);
  }
  return { span: W };
};

const serpent = () => {
  if (L < H * 2.2 || L < W * 1.6) return "it is not long and low";
  const n = 6;
  let parent = bone("root", null, [cx, g, (mn[2] + mx[2]) / 2], [cx, g, mx[2]]);
  for (let i = 0; i < n; i++) {
    const z0 = mn[2] + (L * i) / n, z1 = mn[2] + (L * (i + 1)) / n;
    const slice = (z) => pts.filter((p) => Math.abs(p[2] - z) < L / n);
    const y = (z) => mean(slice(z), 1) || g + H / 2;
    parent = bone(`seg${i}`, parent, [cx, y(z0), z0], [cx, y(z1), z1]);
  }
  return { length: L };
};

// legs first; a long, low body without four clear legs bends along its length instead (a worm or a
// caterpillar is named as one by its library entry: fyt/rigging.py)
const tries = want !== "auto" ? [want] : ["quadruped", "serpent", "bird"];
const why = {};
let type = null, shape = null;
for (const t of tries) {
  bones.length = 0;
  const r = { quadruped, bird, serpent }[t]();
  if (typeof r === "string") why[t] = r;
  else {
    type = t;
    shape = r;
    break;
  }
}
if (!type) say({ ok: false, reason: Object.entries(why).map(([k, v]) => `${k}: ${v}`).join("; ") });

// --- weights: each vertex to the bones nearest it -----------------------------------------------------
const segDist = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};
const skinned = bones.map((b, i) => [b, i]).filter(([b]) => b.name !== "root");
const weigh = (p) => {
  const ds = skinned.map(([b, i]) => [i, segDist(p, b.head, b.tail) / big + 0.004]);
  ds.sort((a, b) => a[1] - b[1]);
  const top = ds.slice(0, 4).map(([i, d]) => [i, 1 / d ** 4]);
  const s = top.reduce((a, [, w]) => a + w, 0);
  const out = top.map(([i, w]) => [i, w / s]).filter(([, w]) => w > 0.02);
  const s2 = out.reduce((a, [, w]) => a + w, 0);
  while (out.length < 4) out.push([0, 0]);
  return out.map(([i, w]) => [i, w / s2]);
};
for (const prim of new Set(prims)) {
  const a = prim.getAttribute("POSITION");
  const n = a.getCount();
  const J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  const v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    weigh(a.getElement(i, v)).forEach(([j, w], k) => {
      J[i * 4 + k] = j;
      Wt[i * 4 + k] = w;
    });
  }
  const buf = root.listBuffers()[0];
  prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(J).setBuffer(buf));
  prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(Wt).setBuffer(buf));
}

// --- the skeleton -------------------------------------------------------------------------------------
const buf = root.listBuffers()[0];
const nodes = {};
for (const b of bones) {
  const p = b.parent ? bones.find((x) => x.name === b.parent).head : [0, 0, 0];
  nodes[b.name] = doc.createNode(b.name).setTranslation([b.head[0] - p[0], b.head[1] - p[1], b.head[2] - p[2]]);
  if (b.parent) nodes[b.parent].addChild(nodes[b.name]);
}
scene.addChild(nodes.root);
const ibm = new Float32Array(bones.length * 16);
bones.forEach((b, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1], i * 16));
const skin = doc.createSkin("auto").setSkeleton(nodes.root)
  .setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buf));
for (const b of bones) skin.addJoint(nodes[b.name]);
for (const node of meshNodes) node.setSkin(skin);

// --- clips --------------------------------------------------------------------------------------------
// Each clip is a loop of rotations per bone (radians about x: + tips a bone's end down and back; about
// y: + turns it to the model's left; about z: + rolls it up on the left), sampled finely enough to stay
// smooth when played back linearly.
const quat = ([x, y, z]) => {
  const c = [x, y, z].map((a) => Math.cos(a / 2)), s = [x, y, z].map((a) => Math.sin(a / 2));
  return [s[0] * c[1] * c[2] + c[0] * s[1] * s[2], c[0] * s[1] * c[2] - s[0] * c[1] * s[2], c[0] * c[1] * s[2] + s[0] * s[1] * c[2], c[0] * c[1] * c[2] - s[0] * s[1] * s[2]];
};
const TAU = Math.PI * 2;
const clips = {};
const clip = (name, T, pose, move = null) => {
  const steps = 24;
  const anim = doc.createAnimation(name);
  const times = new Float32Array(steps + 1).map((_, i) => (T * i) / steps);
  const input = doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buf);
  for (const b of bones) {
    const qs = new Float32Array((steps + 1) * 4);
    let still = true;
    for (let i = 0; i <= steps; i++) {
      const r = pose(b.name, i / steps) ?? [0, 0, 0];
      if (r.some((x) => Math.abs(x) > 1e-4)) still = false;
      qs.set(quat(r), i * 4);
    }
    if (still) continue;
    const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
      .setOutput(doc.createAccessor().setType("VEC4").setArray(qs).setBuffer(buf));
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes[b.name]).setTargetPath("rotation").setSampler(sampler));
  }
  if (move) {
    const tr = new Float32Array((steps + 1) * 3);
    const base = nodes.root.getTranslation();
    for (let i = 0; i <= steps; i++) tr.set([base[0], base[1] + move(i / steps), base[2]], i * 3);
    const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
      .setOutput(doc.createAccessor().setType("VEC3").setArray(tr).setBuffer(buf));
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.root).setTargetPath("translation").setSampler(sampler));
  }
  clips[name] = T;
};
const sin = (u) => Math.sin(TAU * u), cos = (u) => Math.cos(TAU * u);
const gait = {};

if (type === "quadruped") {
  const legs = shape.legs;
  // a leg swings forward (-) and back (+) about its hip; the shin lifts while the foot travels forward
  const stride = (u, ph, A, lift) => (name) => {
    const k = name.slice(-2);
    const s = u + ph[k];
    if (name.startsWith("leg")) return [-A * sin(s), 0, 0];
    if (name.startsWith("shin")) return [lift * Math.max(0, cos(s)) * (k[0] === "F" ? 1 : -1), 0, 0];
    return null;
  };
  // walk: one foot after another (left hind, left fore, right hind, right fore)
  const walk = { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 };
  const Aw = 0.32, Tw = 1.0;
  clip("Walk", Tw, (n, u) => {
    if (/^(leg|shin)/.test(n)) return stride(u, walk, Aw, 0.45)(n);
    if (n === "head") return [0.04 * sin(u * 2), 0, 0];
    if (n === "spine") return [0, 0, 0.03 * sin(u)];
    if (n === "tail") return [0, 0.18 * sin(u), 0];
    return null;
  }, (u) => Math.abs(sin(u * 2)) * legs * 0.015);
  // run: a gallop, the hind pair then the fore pair, the back flexing with it
  const run = { BL: 0, BR: 0.08, FL: 0.5, FR: 0.58 };
  const Ar = 0.55, Tr = 0.55;
  clip("Run", Tr, (n, u) => {
    if (/^(leg|shin)/.test(n)) return stride(u, run, Ar, 0.8)(n);
    if (n === "spine") return [0.12 * sin(u + 0.25), 0, 0];
    if (n === "chest") return [-0.1 * sin(u + 0.25), 0, 0];
    if (n === "head") return [0.08 * sin(u), 0, 0];
    if (n === "tail") return [-0.3 + 0.15 * sin(u), 0, 0];
    return null;
  }, (u) => Math.max(0, sin(u + 0.1)) * legs * 0.08);
  // ground covered per second, as a share of the model's largest side (how the renderer sizes it):
  // a foot planted for half the cycle sweeps 2·leg·sin(A) under the body
  gait.Walk = (4 * legs * Math.sin(Aw)) / Tw / big;
  gait.Run = (4 * legs * Math.sin(Ar)) / Tr / big;
  clip("Idle", 4, (n, u) => {
    if (n === "head") return [0.05 * sin(u * 0.5), 0.18 * sin(u * 0.5), 0];
    if (n === "neck") return [0.03 * sin(u), 0.05 * sin(u * 0.5), 0];
    if (n === "chest") return [0.015 * sin(u * 2), 0, 0];
    if (n === "tail") return [0, 0.25 * sin(u), 0];
    return null;
  });
  // the neck bends until the muzzle reaches the grass (a giraffe's far, a pig's hardly at all)
  const nk = bones.find((b) => b.name === "neck"), hd = bones.find((b) => b.name === "head");
  const muzzle = [hd.tail[1] - nk.head[1], hd.tail[2] - nk.head[2]];
  let reach = 0.2;
  for (; reach < 1.5; reach += 0.05) {
    const y = muzzle[0] * Math.cos(reach) - muzzle[1] * Math.sin(reach) + nk.head[1];
    if (y < g + H * 0.12) break;
  }
  clip("Eat", 3, (n, u) => {
    if (n === "neck") return [reach * 0.85 + 0.04 * sin(u), 0, 0];
    if (n === "head") return [0.35 + 0.08 * sin(u * 3), 0.05 * sin(u), 0];
    if (n === "tail") return [0, 0.2 * sin(u), 0];
    return null;
  });
  clip("Attack", 1.2, (n, u) => {
    const p = Math.max(0, sin(u));
    if (n === "chest") return [-0.25 * p, 0, 0];
    if (n === "neck") return [0.2 * p, 0, 0];
    if (n === "head") return [0.25 * p, 0, 0];
    if (n === "legFL" || n === "legFR") return [-0.6 * p, 0, 0];
    if (n === "tail") return [-0.3 * p, 0, 0];
    return null;
  });
  clip("Sleep", 4, (n, u) => {
    if (n === "chest") return [0.02 * sin(u), 0, 0];
    if (n === "head") return [0.15, 0, 0];
    if (n.startsWith("legF")) return [-0.35, 0, 0];
    if (n.startsWith("legB")) return [0.35, 0, 0];
    return null;
  });
} else if (type === "bird") {
  const flap = (u, A) => (n) => {
    const s = sin(u);
    if (n === "wingL") return [0, 0, A * s];
    if (n === "wingR") return [0, 0, -A * s];
    if (n === "tipL") return [0, 0, A * 0.6 * sin(u - 0.12)];
    if (n === "tipR") return [0, 0, -A * 0.6 * sin(u - 0.12)];
    if (n === "head") return [0.05 * sin(u), 0, 0];
    return null;
  };
  clip("Fly", 0.5, (n, u) => flap(u, 0.6)(n), (u) => -sin(u) * shape.span * 0.02);
  clip("Idle", 3, (n, u) => flap(u, 0.12)(n));
} else {
  // a wave travelling from head to tail, growing toward the tail
  const n = bones.length;
  const wave = (A, k) => (name, u) => {
    const i = Number(name.slice(3));
    return [0, A * (1 - i / n + 0.25) * sin(u + (i / n) * k), 0];
  };
  clip("Move", 1.2, wave(0.32, 1));
  clip("Swim", 1.0, wave(0.4, 1));
  clip("Idle", 4, wave(0.08, 0.6));
  gait.Move = (shape.length * 0.35) / 1.2 / big;
}

// --- checks: pose it as it walks and see the feet stay down and nothing flies apart ---------------------
const world = (pose) => {
  const M = {};
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const fromQT = ([x, y, z, w], t) => [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
  for (const b of bones) {
    const local = fromQT(quat(pose(b.name) ?? [0, 0, 0]), nodes[b.name].getTranslation());
    M[b.name] = b.parent ? mul(M[b.parent], local) : local;
  }
  return bones.map((b) => mul(M[b.name], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1]));
};
const posed = (pose) => {
  const S = world(pose);
  const out = [];
  for (const prim of new Set(prims)) {
    const a = prim.getAttribute("POSITION"), J = prim.getAttribute("JOINTS_0"), Wt = prim.getAttribute("WEIGHTS_0");
    const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v); J.getElement(i, j); Wt.getElement(i, w);
      const o = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const m = S[j[k]];
        for (let r = 0; r < 3; r++) o[r] += w[k] * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
      }
      out.push([o, v.slice()]);
    }
  }
  return out;
};
const checks = {};
const rest0 = posed(() => null);
checks.rest = Math.max(...rest0.map(([o, v]) => Math.hypot(o[0] - v[0], o[1] - v[1], o[2] - v[2]))) / big;
if (!bones.every((b) => [...b.head, ...b.tail].every(Number.isFinite))) say({ ok: false, reason: "a bone could not be placed" });
if (!(checks.rest <= 1e-3)) say({ ok: false, reason: `the rest pose moves the mesh (${checks.rest.toFixed(4)})` });
if (type === "quadruped") {
  const ph = { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 };
  let lowest = 0, stretch = 0;
  for (const u of [0, 0.125, 0.25, 0.375]) {
    const pose = (n) => (n.startsWith("leg") ? [-0.32 * sin(u + ph[n.slice(-2)]), 0, 0] : null);
    const p = posed(pose);
    lowest = Math.max(lowest, Math.abs(Math.min(...p.map(([o]) => o[1])) - g) / H);
    // how far any edge of the mesh stretches against its length at rest
    stretch = Math.max(stretch, Math.max(...p.map(([o, v]) => Math.hypot(o[0] - v[0], o[1] - v[1], o[2] - v[2]))) / H);
  }
  // against the length of its legs: a swung leg rises by leg·(1 − cos A), a few hundredths
  const lift = (lowest * H) / shape.legs;
  checks.feet = Number(lift.toFixed(3));
  checks.travel = Number(stretch.toFixed(3));
  if (!(lift <= 0.1)) say({ ok: false, reason: `its feet leave the ground as it walks (${lift.toFixed(3)} of its leg)` });
}

const extras = { rig: "auto", type, gait };
nodes.root.setExtras(extras);
scene.setExtras(extras);
await doc.transform(prune({ keepAttributes: true }), quantize({ quantizeWeight: 8 }));
await io.write(output, doc);
say({ ok: true, type, bones: bones.length, clips: Object.keys(clips), gait, checks });
