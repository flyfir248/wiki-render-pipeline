// Weird But True Short (Sun 29): "The Explosion That Left No Crater" (the Tunguska event). Style skill v1.2.
// Facts: on the morning of 30 June 1908 an object from space exploded several kilometres above the taiga near the
// Podkamennaya Tunguska River in central Siberia. It flattened about 80 million trees over more than 2,000 km2, the
// trunks lying pointed away from the centre; at the centre the trees stayed upright, stripped of branches ("telegraph
// poles"). At the Vanavara trading post, about 65 km away, people were thrown off their feet and windows broke; glass
// was broken up to about 200 km away. Evenk reindeer herders lived in the area in conical tents (chums). Leonid Kulik's
// expedition reached the centre in 1927 and found no impact crater. No one is shown hurt.
// Shots (7 s each, 1080x1920 final, 30 fps):
// G01 hook: aerial over the flattened circle of taiga, trunks pointing outward, a ring of standing forest, smoke, mist
// G02 dawn, 30 June 1908: Evenk chums and reindeer by the river; a fireball streaks across the sky and they look up
// G03 Vanavara trading post: a flash on the horizon, then the wind: shutters bang, panes burst, people sit down hard
// G04 1927: Kulik and two helpers with packs walk a cut trail through fallen trunks that all point the same way
// G05 the centre: bare upright trunks like telegraph poles, green regrowth below, Kulik looking up at them
import { dog, dogSit, renderer, THREE, SHOT, rnd, C, V, D, sm, mix, clamp, PAL, world, scene, sky, hemi, sun, fill, camera, M, E, mesh, box, blob, canvasTex,
  person, walker, standPose, sitPose, walkPose, prop, orbit, card, run, hero, atmo } from './wbt_kit.js';

const G1 = SHOT === 'G01', G2 = SHOT === 'G02', G3 = SHOT === 'G03', G4 = SHOT === 'G04', G5 = SHOT === 'G05';
window.SHOT_SIZE = G5 ? 'medium' : 'wide';
const BARK = '#7A5A3E', DEAD = '#A89276', BLEACH = '#C9B898', NEEDLE = '#3F7A45', NEEDLE2 = '#2F6A3E', LARCH = '#5E8F3E', MOSS = '#7E9A4E', PEAT = '#6B5640';
const FIREWEED = '#D9559A', BIRCH = '#EDE6D8';

// ---------------------------------------------------------------- shared helpers
function tex(base, cols, n, { size = 512, rep = 8, r = [2, 10], a = [0.3, 0.8] } = {}) {
  const t = canvasTex(size, size, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) { g.globalAlpha = mix(a[0], a[1], rnd()); g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(rnd() * w, rnd() * h, mix(r[0], r[1], rnd()), 0, 6.283); g.fill(); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t; }
let HF = () => 0; const Hy = (x, z) => HF(x, z);
function terrain(size, seg, hf, map, col = '#FFFFFF') { HF = hf; const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hf(p.getX(i), p.getZ(i))); g.computeVertexNormals();
  const m = mesh(g, M(col, { map, roughness: 0.95 }), 0, 0, 0); m.castShadow = false; return m; }
// instanced kit: parts = [[geometry, material]], each instance [x, y, z, ry, sx, sy, sz, rx?, rz?]
const _o = new THREE.Object3D();
function inst(parts, list, parent = world, shadow = true) { const g = new THREE.Group(); parent.add(g);
  for (const [geo, mat] of parts) { const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = shadow; im.receiveShadow = true;
    list.forEach((q, i) => { _o.position.set(q[0], q[1], q[2]); _o.rotation.set(q[7] || 0, q[3], q[8] || 0, 'YXZ'); _o.scale.set(q[4], q[5], q[6]); _o.updateMatrix(); im.setMatrixAt(i, _o.matrix); });
    im.computeBoundingBox(); im.computeBoundingSphere(); g.add(im); }
  return g; }
// standing conifer (spruce / larch): unit height 1
const CONIFER = [[new THREE.CylinderGeometry(0.03, 0.06, 1, 5).translate(0, 0.5, 0), M(BARK)], [new THREE.ConeGeometry(0.3, 0.42, 7).translate(0, 0.38, 0), M(NEEDLE)],
  [new THREE.ConeGeometry(0.23, 0.36, 7).translate(0, 0.6, 0), M(NEEDLE2)], [new THREE.ConeGeometry(0.15, 0.3, 6).translate(0, 0.8, 0), M(LARCH)]];
const forest = (list, parent) => inst(CONIFER, list.map(([x, z, h, ry = 0]) => [x, Hy(x, z), z, ry, h * 0.6, h, h * 0.6]), parent);
// fallen trunk, unit length 1 along +z from its root plate; tops point outward
const FALLEN = [[new THREE.CylinderGeometry(0.035, 0.06, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), M(BLEACH)],
  [new THREE.CylinderGeometry(0.16, 0.18, 0.05, 7).rotateX(Math.PI / 2).translate(0, 0.06, -0.02), M(PEAT)],
  [new THREE.CylinderGeometry(0.008, 0.015, 0.18, 4).rotateZ(1.0).translate(0.06, 0.04, 0.55), M(DEAD)], [new THREE.CylinderGeometry(0.008, 0.015, 0.15, 4).rotateZ(-1.1).translate(-0.05, 0.04, 0.72), M(DEAD)]];
const fallen = (list, parent) => inst(FALLEN, list.map(([x, z, len, ry, th = 1]) => [x, Hy(x, z) + 0.04 * th * len / 1, z, ry, len * th, len * th, len, -0.03]), parent);
// stripped standing trunk ("telegraph pole"), unit height 1, a few broken stubs
const POLETEX = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#B09A7C'; g.fillRect(0, 0, w, h); for (let i = 0; i < 90; i++) { g.fillStyle = ['#8E7A60', '#C9B898', '#7A6650'][i % 3]; g.globalAlpha = 0.7; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 20 + rnd() * 90); } g.globalAlpha = 0.8; g.fillStyle = '#5E4A3A'; for (let i = 0; i < 10; i++) g.fillRect(rnd() * w, rnd() * h, 3, 6); });
const POLE = [[new THREE.CylinderGeometry(0.018, 0.034, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ map: POLETEX, flatShading: true, roughness: 0.85 })], [new THREE.CylinderGeometry(0.006, 0.01, 0.12, 4).rotateZ(1.2).translate(0.04, 0.72, 0), M(DEAD)],
  [new THREE.CylinderGeometry(0.006, 0.01, 0.1, 4).rotateZ(-1.2).translate(-0.035, 0.6, 0.01), M('#8E7E6A')], [new THREE.CylinderGeometry(0.005, 0.008, 0.08, 4).rotateX(1.2).translate(0, 0.84, 0.03), M(DEAD)]];
const poles = (list, parent) => inst(POLE, list.map(([x, z, h, ry = 0]) => [x, Hy(x, z) - 0.02, z, ry, h, h, h]), parent);
// soft sprite for smoke, mist, glow (sprites only for smoke, sparks and mist: SKILL.md M-24)
const SOFT = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
function puff(col, op = 0.5, add = false, fog = true) { return new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: C(col), transparent: true, opacity: op, depthWrite: false, fog, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending })); }
// a rising smoke column: n puffs recycled upward from (x, y, z)
function smoke(x, y, z, { n = 14, h = 6, w = 1.2, col = '#8A8580', op = 0.45, speed = 0.6, drift = 0.25, s0 = 0.6 } = {}) { const ps = [];
  for (let i = 0; i < n; i++) { const s = puff(col, op); world.add(s); ps.push([s, i / n, rnd()]); }
  return (t) => ps.forEach(([s, ph, r]) => { const k = (ph + t * speed / h) % 1; s.position.set(x + drift * h * k * k + (r - 0.5) * w * 0.3, y + h * k, z + (r - 0.5) * w * 0.3);
    s.scale.setScalar(s0 + w * 1.6 * k); s.material.opacity = op * sm(0, 0.12, k) * (1 - sm(0.6, 1, k)); }); }
// birds: little V shapes flapping across
function birds(n, { x0 = -20, x1 = 20, y = 8, z = -10, speed = 2.5, col = '#3A3A3A', s = 1 } = {}) { const bs = [];
  for (let k = 0; k < n; k++) { const g = new THREE.Group(); world.add(g); g.scale.setScalar(s); const l = mesh(box(0.32, 0.02, 0.1), M(col), -0.16, 0, 0, g), r = mesh(box(0.32, 0.02, 0.1), M(col), 0.16, 0, 0, g); mesh(box(0.08, 0.06, 0.22), M(col), 0, 0, 0, g); bs.push({ g, l, r, o: rnd(), k }); }
  return (t, scatter = 0) => bs.forEach((b) => { const span = x1 - x0; b.g.position.set(x0 + ((t * speed + b.o * span) % span), y + 0.6 * Math.sin(t * 0.7 + b.k) + scatter * (1 + b.k * 0.4), z - b.k * 0.8 + scatter * b.o * 3);
    b.g.rotation.y = speed > 0 ? Math.PI / 2 : -Math.PI / 2; const f = 0.5 * Math.sin(t * (9 + 6 * scatter) + b.k); b.l.rotation.z = f; b.r.rotation.z = -f; }); }
// Evenk / Russian 1900s people on the kit
const furHat = (p, col = '#5E4330', trim = '#E6DCCB') => { const hd = p.userData.hd, s = p.userData.h / 6.5; mesh(new THREE.CylinderGeometry(s * 0.58, s * 0.6, s * 0.5, 8), M(col), 0, s * 0.38, -s * 0.02, hd); mesh(new THREE.CylinderGeometry(s * 0.64, s * 0.64, s * 0.14, 8), M(trim), 0, s * 0.16, -s * 0.02, hd); };
const beads = (p, cols = ['#C0392B', '#2E6DA4', '#F2B53A', '#F6F1E7']) => { const h = p.userData.h; for (let k = 0; k < 8; k++) mesh(box(h * 0.025, h * 0.025, h * 0.01), M(cols[k % cols.length]), -h * 0.05 + (k % 4) * h * 0.033, h * 0.2 - Math.floor(k / 4) * h * 0.03, h * 0.085, p.userData.body); };
const beard = (p, col = '#4A3626') => { const hd = p.userData.hd, s = p.userData.h / 6.5; const b = mesh(new THREE.IcosahedronGeometry(s * 0.32, 0), M(col), 0, -s * 0.32, s * 0.24, hd); b.scale.set(1.15, 1.2, 0.7); mesh(box(s * 0.36, s * 0.07, s * 0.06), M(col), 0, -s * 0.18, s * 0.43, hd); };
const cap = (p, col = '#4B4F45') => { const hd = p.userData.hd, s = p.userData.h / 6.5; mesh(new THREE.CylinderGeometry(s * 0.52, s * 0.54, s * 0.22, 9), M(col), 0, s * 0.36, -s * 0.03, hd); mesh(box(s * 0.62, s * 0.05, s * 0.34), M(col), 0, s * 0.27, s * 0.42, hd); };
const pack = (p, col = '#7A6A4E', roll = '#5E6B4E') => { const h = p.userData.h; const b = new THREE.Group(); p.userData.body.add(b); b.position.set(0, h * 0.17, -h * 0.11); mesh(box(h * 0.2, h * 0.24, h * 0.11), M(col), 0, 0, 0, b); const r = mesh(new THREE.CylinderGeometry(h * 0.04, h * 0.04, h * 0.24, 7), M(roll), 0, h * 0.15, 0, b); r.rotation.z = Math.PI / 2; return b; };
const coat = (p, col, len = 0.3) => { const h = p.userData.h; mesh(new THREE.CylinderGeometry(h * 0.1, h * 0.13, h * len, 8), M(col), 0, -h * len / 2 + h * 0.02, 0, p.userData.body); };
// reindeer, origin at the feet, facing +z; returns group with userData {neck, legs, head}
function reindeer({ coat: cc = '#8B7560', pale = '#E9E2D2', s = 1, antlers = true } = {}) { const g = new THREE.Group(); world.add(g); g.scale.setScalar(s); g.userData.prop = true; g.name = 'reindeer';
  const body = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.85, 7), M(cc), 0, 0.82, 0, g); body.rotation.x = Math.PI / 2;
  mesh(new THREE.IcosahedronGeometry(0.2, 0), M(pale), 0, 0.72, 0.3, g).scale.set(1, 0.9, 1.1);
  const legs = []; for (const [x, z] of [[-0.12, 0.32], [0.12, 0.32], [-0.12, -0.32], [0.12, -0.32]]) { const l = new THREE.Group(); l.position.set(x, 0.72, z); g.add(l); mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.7, 5), M(cc), 0, -0.35, 0, l); mesh(box(0.07, 0.06, 0.09), M('#3B2A20'), 0, -0.7, 0.01, l); legs.push(l); }
  const neck = new THREE.Group(); neck.position.set(0, 0.95, 0.38); g.add(neck); const nk = mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.42, 6), M(pale), 0, 0.17, 0.08, neck); nk.rotation.x = 0.5;
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.2); neck.add(head); const hm = mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.32, 6), M(cc), 0, 0, 0.1, head); hm.rotation.x = Math.PI / 2 - 0.3;
  mesh(box(0.07, 0.05, 0.05), M('#3B2A20'), 0, -0.04, 0.26, head); for (const sx of [-1, 1]) { mesh(new THREE.CircleGeometry(0.018, 5), E(PAL.eye), sx * 0.075, 0.03, 0.08, head).rotation.y = sx * 0.9; const ear = mesh(box(0.1, 0.03, 0.05), M(cc), sx * 0.1, 0.06, -0.02, head); ear.rotation.z = sx * 0.4; }
  if (antlers) for (const sx of [-1, 1]) { const a = new THREE.Group(); a.position.set(sx * 0.05, 0.08, -0.02); head.add(a); a.rotation.z = -sx * 0.35; a.rotation.x = -0.3;
    const am = M('#D8C9A8'); mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.42, 4), am, 0, 0.2, 0, a); for (const [y, r] of [[0.12, 0.9], [0.24, -0.8], [0.34, 0.7]]) { const t = mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.16, 4), am, 0, y, 0.04, a); t.rotation.x = r; } }
  const tail = mesh(box(0.08, 0.06, 0.1), M(pale), 0, 0.88, -0.45, g);
  g.userData = { prop: true, neck, head, legs, tail }; return g; }
function deerGraze(d, t, ph = 0) { const u = d.userData; const k = 0.5 + 0.5 * Math.sin(t * 0.6 + ph); u.neck.rotation.x = mix(0.0, 1.15, k * k); u.head.rotation.y = 0.15 * Math.sin(t * 1.3 + ph); u.tail.rotation.x = 0.2 * Math.sin(t * 5 + ph); }
// birch: white trunk with dark marks, light green crown
function birch(x, z, h = 3, parent) { const g = prop('birch', x, z, rnd() * 6, Hy(x, z), parent); mesh(new THREE.CylinderGeometry(0.06 * h / 3, 0.09 * h / 3, h, 6), M(BIRCH), 0, h / 2, 0, g);
  for (let k = 0; k < 4; k++) mesh(box(0.13 * h / 3, 0.03, 0.13 * h / 3), M('#2B2B2B'), 0, h * (0.2 + k * 0.17), 0, g);
  for (let k = 0; k < 3; k++) mesh(blob(h * 0.2, 0, 0.15), M(k % 2 ? '#8CC152' : PAL.leaf), (rnd() - 0.5) * h * 0.2, h * (0.85 + k * 0.1), (rnd() - 0.5) * h * 0.2, g); return g; }
function spruce(x, z, h = 4, parent) { const g = prop('spruce', x, z, rnd() * 6, Hy(x, z), parent); mesh(new THREE.CylinderGeometry(0.05 * h / 4, 0.1 * h / 4, h, 5), M(BARK), 0, h / 2, 0, g);
  for (let k = 0; k < 4; k++) mesh(new THREE.ConeGeometry(h * (0.26 - k * 0.05), h * 0.32, 7), M(k % 2 ? NEEDLE2 : NEEDLE), 0, h * (0.3 + k * 0.18), 0, g); return g; }
function fireweed(x, z, n = 6, s = 1, parent) { const g = prop('fireweed', x, z, 0, Hy(x, z), parent); for (let k = 0; k < n; k++) { const a = rnd() * 6.28, r = rnd() * 0.3 * s, h = (0.5 + rnd() * 0.5) * s;
  const st = mesh(new THREE.CylinderGeometry(0.008, 0.012, h, 4), M('#4F7A3A'), Math.cos(a) * r, h / 2, Math.sin(a) * r, g); st.castShadow = false;
  mesh(new THREE.ConeGeometry(0.05 * s, 0.24 * s, 5), M(FIREWEED), Math.cos(a) * r, h + 0.08 * s, Math.sin(a) * r, g); } return g; }
function rock(x, z, s = 1, col = '#8E8A86', parent) { const g = prop('rock', x, z, rnd() * 6, Hy(x, z), parent); const m = mesh(blob(0.5 * s, 0, 0.25), M(col), 0, 0.2 * s, 0, g); m.scale.y = 0.6; return g; }
// the sun's shadow box, scaled to the set
function shadowBox(r, far = 120) { Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far }); sun.shadow.camera.updateProjectionMatrix(); }

let update = () => {}, overlay = () => {};

// ================================================================ G01 hook: the flattened circle, from the air
if (G1) {
  // Dressing plan (3A), the Tunguska blast site, central Siberia, morning after (scene units: 1 = about 25 m; trees 1-1.4 tall):
  //  foreground  the edge of the standing taiga under the camera: two stands of tall spruce and larch, a rocky ridge
  //  hero zone   the centre: a cluster of bare upright trunks with smoke rising from smouldering moss beside them
  //  midground   eight sectors of fallen trunks, every one lying with its top pointing away from the centre, swamp pools,
  //              a winding stream, scorched patches, smouldering spots, a few surviving trees on a knoll
  //  background  the unbroken ring of standing forest all round, low hills, the Podkamennaya Tunguska river, far ridges
  //  atmosphere  smoke plumes, low mist drifting through the flattened forest, birds crossing, ember glow flickering
  sky('day', 70, 260); scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#6FAEE0'); gr.addColorStop(0.6, '#CFE3EC'); gr.addColorStop(1, '#EED9B6'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  scene.fog.color.set('#D6DCD2');
  sun.position.set(-30, 30, 22); sun.intensity = 2.9; sun.color = C('#FFE7C4'); hemi.intensity = 1.25; fill.intensity = 0.4; shadowBox(40, 140); renderer.toneMappingExposure = 1.08;
  const R = 17; // radius of the flattened zone
  const hf = (x, z) => { const r = Math.hypot(x, z); return 0.25 * Math.sin(x * 0.18) * Math.cos(z * 0.15) + 0.5 * sm(R + 4, R + 30, r) * (1 + Math.sin(Math.atan2(z, x) * 3)) + 1.5 * sm(45, 80, r) + 3 * sm(120, 200, -z) * (1 + Math.sin(x * 0.05)); };
  const groundMap = canvasTex(2048, 2048, (g, w, h) => { g.fillStyle = "#6F7E4A"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const x = rnd() * w, y = rnd() * h, r = Math.hypot(x - w / 2, y - h / 2) / (w / 2) * 210; // r in scene units over a 420-wide plane
      g.globalAlpha = 0.5; g.fillStyle = r < R ? ['#8C6E4C', '#7A5E42', '#9A7B55', '#6C7A44'][i % 4] : ['#4E6B3A', '#5E7A40', '#6F7E4A'][i % 3]; g.beginPath(); g.arc(x, y, 2 + rnd() * 6, 0, 6.283); g.fill(); }
    g.globalAlpha = 0.55; for (let i = 0; i < 40; i++) { const a = rnd() * 6.28, rr = rnd() * R * 0.8, x = w / 2 + Math.cos(a) * rr * w / 420, y = h / 2 + Math.sin(a) * rr * h / 420; g.fillStyle = '#4A3A2E'; g.beginPath(); g.arc(x, y, 4 + rnd() * 10, 0, 6.283); g.fill(); } });
  const grd = terrain(420, 200, hf, groundMap); groundMap.repeat.set(1, 1); grd.scale.set(1, 1, 1);
  // swamp pools and a stream (flat water planes slightly above the ground)
  const waterM = M('#5D9CB8', { roughness: 0.25, metalness: 0.1 });
  for (const [x, z, rx, rz] of [[-7, 4, 1.6, 0.9], [6, -5, 1.2, 0.8], [9, 7, 1.0, 1.4], [-4, -9, 1.4, 0.7], [-12, -2, 0.9, 0.6]]) { const p = prop('swamp pool', x, z, rnd() * 3, Hy(x, z) + 0.05); const m = mesh(new THREE.CircleGeometry(1, 9), waterM, 0, 0, 0, p); m.rotation.x = -Math.PI / 2; m.scale.set(rx, rz, 1); m.castShadow = false; }
  { const p = prop('stream', 0, 0); const pts = []; for (let k = 0; k <= 30; k++) { const z = -40 + k * 2.6, x = 12 + 4 * Math.sin(k * 0.45) - k * 0.25; pts.push([x, z]); }
    for (let k = 1; k < pts.length; k++) { const [x0, z0] = pts[k - 1], [x1, z1] = pts[k]; const l = Math.hypot(x1 - x0, z1 - z0); const m = mesh(new THREE.PlaneGeometry(0.7, l + 0.4), waterM, (x0 + x1) / 2, Hy((x0 + x1) / 2, (z0 + z1) / 2) + 0.08, (z0 + z1) / 2, p); m.rotation.set(-Math.PI / 2, 0, Math.atan2(x1 - x0, z1 - z0)); m.castShadow = false; } }
  // eight sectors of fallen trunks, tops pointing away from the centre
  for (let s = 0; s < 8; s++) { const list = []; for (let i = 0; i < 230; i++) { const a = (s + rnd()) / 8 * 6.283, r = 2.6 + Math.pow(rnd(), 0.8) * (R - 2.8); const x = Math.cos(a) * r, z = Math.sin(a) * r;
      list.push([x, z, 0.8 + rnd() * 0.5, Math.atan2(x, z) + (rnd() - 0.5) * 0.25]); }
    const g = new THREE.Group(); world.add(g); g.name = `fallen trees ${s + 1}`; g.userData.prop = true; fallen(list, g); }
  // hero: the bare upright trunks at the centre, smouldering moss
  const heroG = hero(prop('standing dead trunks at the centre', 0, 0)); { const list = []; for (let i = 0; i < 46; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 2.3; list.push([Math.cos(a) * r, Math.sin(a) * r, 2.0 + rnd() * 0.8, rnd() * 6]); } poles(list, heroG);
    for (let k = 0; k < 7; k++) { const a = k * 0.9, r = k ? 1.2 : 0; const ash = mesh(new THREE.CircleGeometry(1.2 + rnd() * 0.6, 9), M(k % 2 ? '#4A3A2E' : '#5E5048'), Math.cos(a) * r, Hy(0, 0) + 0.02 + k * 0.002, Math.sin(a) * r, heroG); ash.rotation.x = -Math.PI / 2; ash.castShadow = false; } }
  // the ring of standing forest beyond the flattened zone, in sectors (background) and two stands right under the camera (foreground)
  for (let s = 0; s < 10; s++) { const list = []; for (let i = 0; i < 620; i++) { const a = (s + rnd()) / 10 * 6.283, r = R + 0.5 + Math.pow(rnd(), 1.2) * 50; list.push([Math.cos(a) * r, Math.sin(a) * r, 1.4 + rnd() * 0.7, rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = `standing taiga ${s + 1}`; g.userData.prop = true; forest(list, g); }
  // the taiga running on to the horizon behind the site (background, in five far sectors) and the river across it
  for (let s = 0; s < 10; s++) { const list = []; for (let i = 0; i < 380; i++) { const x = -110 + (s + rnd()) * 22, z = -78 - rnd() * 80; if (Math.abs(z + 104) < 4) continue; list.push([x, z, 2.2 + rnd(), rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = `far taiga ${s + 1}`; g.userData.prop = true; forest(list, g); }
  { const p = prop('Podkamennaya Tunguska river', 0, -104); const m = mesh(new THREE.PlaneGeometry(240, 6), M('#6FA6C2', { roughness: 0.3 }), 0, Hy(0, -104) + 0.15, 0, p); m.rotation.x = -Math.PI / 2; m.rotation.z = 0.08; m.castShadow = false; }
  // a fringe of half-broken trees right at the edge (trunks snapped, leaning outward)
  { const list = []; for (let i = 0; i < 160; i++) { const a = rnd() * 6.283, r = R - 1.2 + rnd() * 1.8; list.push([Math.cos(a) * r, Math.sin(a) * r, 0.7 + rnd() * 0.3, rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = 'snapped trees at the edge'; g.userData.prop = true; poles(list, g); }
  // surviving trees on a knoll (midground), scorched patches with embers
  { const g = prop('survivors on a knoll', -9, 9); forest([[-9, 9, 1.0], [-8.4, 9.6, 0.8], [-9.6, 9.5, 0.9]], g); }
  const embers = []; for (const [x, z] of [[1.6, 1.2], [-2.2, -0.8], [3.5, -2.5], [-5, 5], [7, 2], [-1, 6]]) { const p = prop('smouldering patch', x, z, 0, Hy(x, z) + 0.06); const m = mesh(new THREE.CircleGeometry(0.7, 9), M('#3E342C'), 0, 0, 0, p); m.rotation.x = -Math.PI / 2; m.castShadow = false;
    const e = mesh(new THREE.CircleGeometry(0.22, 7), E('#E27A3A', 1.0), 0.1, 0.01, 0, p); e.rotation.x = -Math.PI / 2; e.castShadow = false; embers.push(e); }
  // foreground ridge right under the camera: tall spruce and larch, a rocky outcrop (camera is at +z)
  const fgA = prop('spruce stand, near left', -4.6, 16.0); forest([[-4.6, 16.0, 3.0], [-3.9, 16.6, 3.3], [-5.4, 16.8, 2.8], [-5.0, 15.2, 2.4], [-3.4, 15.6, 2.2], [-6.0, 15.6, 2.6]], fgA);
  const fgB = prop('larch stand, near right', 4.6, 16.4); forest([[4.6, 16.4, 3.2], [5.4, 15.6, 2.8], [3.9, 17.0, 3.4], [5.9, 17.0, 2.6], [3.6, 15.4, 2.2]], fgB);
  rock(1.0, 16.6, 1.6, '#8E8A86'); rock(-1.6, 17.2, 1.2, '#9C958B');
  // far hills (background)
  for (const [x, z, s, col] of [[-70, -170, 40, '#7E95A8'], [-10, -185, 50, '#8AA0B2'], [55, -165, 38, '#7E95A8'], [110, -150, 36, '#8AA0B2'], [-120, -140, 34, '#8AA0B2'], [20, -150, 30, '#7E95A8']]) { const p = prop('far hill', x, z); const m = mesh(new THREE.ConeGeometry(s, s * 0.45, 8), M(col), 0, Hy(x, z) + s * 0.15, 0, p); m.castShadow = false; }
  // atmosphere: smoke plumes from the centre and two patches, low mist, birds, embers flickering
  atmo('smoke'); atmo('low mist'); atmo('birds'); atmo('embers');
  const sm1 = smoke(0.6, Hy(0, -1.8) + 0.4, -1.8, { n: 16, h: 9, w: 2.0, op: 0.32, speed: 0.9, drift: 0.18 });
  const sm2 = smoke(3.5, Hy(3.5, -2.5) + 0.2, -2.5, { n: 10, h: 5, w: 1.2, op: 0.4, speed: 0.6, drift: 0.2 });
  const sm3 = smoke(-5, Hy(-5, 5) + 0.2, 5, { n: 10, h: 5, w: 1.2, op: 0.4, speed: 0.6, drift: 0.2 });
  const mist = []; for (let i = 0; i < 26; i++) { const s = puff('#EEF0EA', 0.32); world.add(s); const a = rnd() * 6.28, r = 4 + rnd() * 20; mist.push([s, Math.cos(a) * r, Math.sin(a) * r, rnd()]); s.scale.set(7 + rnd() * 5, 1.4 + rnd(), 1); }
  const bd = birds(5, { x0: -18, x1: 18, y: 10, z: 12, speed: 2.2, s: 1.6 });
  update = (t, u, e) => { sm1(t); sm2(t + 2); sm3(t + 4); bd(t);
    mist.forEach(([s, x, z, r]) => { s.position.set(x + t * 0.5 + 2 * Math.sin(r * 6), Hy(x, z) + 0.7 + r * 0.6, z); });
    embers.forEach((m, k) => { m.material.color.setRGB(0.9, 0.45 + 0.1 * Math.sin(t * 7 + k * 2), 0.2); m.scale.setScalar(0.85 + 0.25 * Math.sin(t * 5 + k)); });
    orbit(V(0, mix(1.3, 1.0, e), mix(-2.0, -2.6, e)), D(mix(-5, 3, e)), D(mix(36, 38, e)), mix(41, 38.5, e)); camera.fov = 56; camera.far = 400; camera.updateProjectionMatrix(); };
  overlay = () => card('No Crater', { y: 0.2, size: 0.062 });
}

// ---------------------------------------------------------------- shared set pieces for G02-G05 (1 unit = 1 m)
const BARKTEX = canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#D9C9A6'; g.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { g.fillStyle = ['#B89F78', '#8E6E4E', '#E8DCC0'][i % 3]; g.globalAlpha = 0.7; g.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 30, 2 + rnd() * 3); }
  g.globalAlpha = 1; g.fillStyle = '#8E6E4E'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 4); });
function chum(x, z, r = 1.8, ry = 0) { const g = prop('chum (Evenk tent)', x, z, ry, Hy(x, z)); const h = r * 2.0;
  const cov = mesh(new THREE.ConeGeometry(r, h, 11, 1, true), new THREE.MeshStandardMaterial({ map: BARKTEX, flatShading: true, roughness: 0.85, side: THREE.DoubleSide }), 0, h / 2, 0, g);
  const band = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.75, h * 0.14, 11, 1, true), M('#7A5A3E', { side: THREE.DoubleSide }), 0, h * 0.62, 0, g); band; cov;
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283; const p = mesh(new THREE.CylinderGeometry(0.03, 0.04, h * 1.25, 4), M(DEAD), Math.cos(a) * r * 0.42, h * 0.6, Math.sin(a) * r * 0.42, g); p.rotation.set(Math.sin(a) * -0.42, 0, Math.cos(a) * 0.42); }
  const door = mesh(new THREE.PlaneGeometry(r * 0.55, h * 0.36), M('#3B2A20', { side: THREE.DoubleSide }), 0, h * 0.18, r * 0.83, g); door.rotation.x = -0.45;
  mesh(box(r * 0.6, h * 0.42, 0.04), M('#8E5A3A'), r * 0.32, h * 0.2, r * 0.72, g).rotation.set(-0.45, 0.6, 0);  // hide flap pinned open
  return g; }
function campfire(x, z) { const g = prop('campfire with kettle', x, z, 0, Hy(x, z)); for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28; mesh(blob(0.1, 0, 0.2), M('#7A7570'), Math.cos(a) * 0.35, 0.06, Math.sin(a) * 0.35, g); }
  for (let k = 0; k < 4; k++) { const l = mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.6, 5), M(BARK), 0, 0.08, 0, g); l.rotation.set(Math.PI / 2, k * 0.8, 0); }
  const fl = []; for (let k = 0; k < 3; k++) { const f = mesh(new THREE.ConeGeometry(0.12 - k * 0.025, 0.4 - k * 0.08, 5), E(k ? '#FFC24A' : '#F07A2A'), (k - 1) * 0.06, 0.25, 0, g); f.castShadow = false; fl.push(f); }
  for (const a of [0, 2.1, 4.2]) { const p = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), M(DEAD), Math.cos(a) * 0.35, 0.65, Math.sin(a) * 0.35, g); p.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28); }
  mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 8), M('#33363B', { metalness: 0.4, roughness: 0.5 }), 0, 0.72, 0, g); mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.5, 3), M('#33363B'), 0, 1.0, 0, g);
  return (t) => fl.forEach((f, k) => { f.scale.set(1, 0.8 + 0.3 * Math.sin(t * 11 + k * 2), 1); f.rotation.y = t * 2 + k; }); }
function pole(x, z, l, ry, rz, col = DEAD, r = 0.05) { const m = mesh(new THREE.CylinderGeometry(r * 0.8, r, l, 5), M(col), x, 0, z); m.rotation.set(0, ry, rz); return m; }
const evenk = (o = {}) => { const p = person({ top: o.top || '#8E5A3A', bottom: o.bottom || '#5E4330', skin: o.skin || PAL.skin[2], hair: PAL.hair[0], collar: '#E6DCCB', shoes: '#5E4330', height: o.height || 1.62, longHair: o.longHair });
  coat(p, o.coatCol || o.top || '#8E5A3A', 0.34); beads(p); if (o.hat !== false) furHat(p, o.hatCol || '#6B4A2E'); return p; };

// ================================================================ G02 dawn, 30 June 1908: the fireball over the Evenk camp
if (G2) {
  // Dressing plan (3A), an Evenk reindeer herders' camp on the Podkamennaya Tunguska, dawn, 30 June 1908:
  //  foreground  a larch stump with an axe in it, a pile of reindeer pack saddles and bags, a young birch at the edge
  //  hero zone   the herder in a reindeer-hide coat and beaded apron, looking up as the fireball crosses
  //  midground   three birch-bark chums with smoke from their tops, a campfire with a kettle on a tripod, a woman and a
  //              child by the fire, seven reindeer grazing, a camp dog, a drying rack with hides and fish, birch-bark
  //              baskets, a cargo sledge, a birch-bark canoe drawn up on the shingle
  //  background  the broad river, the far bank of larch and spruce taiga, low blue hills, dawn sky
  //  atmosphere  the fireball and its smoke trail, smoke from the chums and the fire, mist on the river, birds, grass
  sky('golden', 55, 240); scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#5E86C8'); gr.addColorStop(0.45, '#B9C4D8'); gr.addColorStop(0.75, '#F4C79A'); gr.addColorStop(1, '#F7B07A'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  scene.fog.color.set('#E8C9A8');
  sun.position.set(18, 7, -10); sun.color = C('#FFC992'); sun.intensity = 2.6; hemi.color.set('#D9E2F0'); hemi.groundColor.set('#B49A72'); hemi.intensity = 1.35; fill.intensity = 0.45; fill.position.set(-8, 6, 10); shadowBox(22, 80); renderer.toneMappingExposure = 1.22;
  const hf = (x, z) => 0.15 * Math.sin(x * 0.3) * Math.cos(z * 0.25) - 0.9 * sm(-8, -11, z) * sm(-26, -23, z) + 0.6 * sm(-26, -32, z) + 3 * sm(-50, -90, z);
  terrain(240, 160, hf, tex('#7E9A4E', ['#6B8A42', '#93A85A', '#A89A5A', '#5E7A3E', '#C8B070'], 5000, { rep: 24 }));
  const shingle = mesh(new THREE.PlaneGeometry(80, 4), M('#B0A48E', { map: tex('#B0A48E', ['#8E8A86', '#C9BFAE', '#9C958B'], 3000, { rep: 10, r: [1, 3] }) }), 0, Hy(0, -9.5) + 0.03, -9.5); shingle.rotation.x = -Math.PI / 2; shingle.castShadow = false;
  const waterTex = tex('#4F8FB0', ['#6FA6C2', '#3E7A9C', '#8BBBD0'], 1800, { rep: 6, r: [2, 6] });
  const river = mesh(new THREE.PlaneGeometry(240, 16), M('#FFFFFF', { map: waterTex, roughness: 0.25, metalness: 0.15 }), 0, -0.55, -17.5); river.rotation.x = -Math.PI / 2; river.castShadow = false;
  // far bank taiga in sectors and hills (background)
  for (let s = 0; s < 6; s++) { const list = []; for (let i = 0; i < 260; i++) { const x = -90 + (s + rnd()) * 30, z = -27 - Math.pow(rnd(), 0.8) * 55; list.push([x, z, 5 + rnd() * 4 + (-z - 27) * 0.06, rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = `far-bank taiga ${s + 1}`; g.userData.prop = true; forest(list, g); }
  for (const [x, z, s] of [[-40, -125, 30], [5, -140, 40], [50, -130, 32], [-85, -110, 28]]) { const p = prop('blue hill', x, z); const m = mesh(new THREE.ConeGeometry(s, s * 0.5, 8), M('#7E8FB0'), 0, Hy(x, z) + s * 0.15, 0, p); m.castShadow = false; }
  // near-bank trees behind the camp
  for (const [x, z, h] of [[-9, -6, 7], [-11, -2, 8], [10, -7, 7.5], [12.5, -3, 8.5], [-7.5, -8.2, 6]]) spruce(x, z, h);
  birch(8.5, -5.5, 6); birch(-5, -7.6, 5.5);
  // the camp
  chum(-3.0, -4.2, 1.9, 0.4); chum(4.2, -5.0, 2.1, -0.3); chum(-7.0, -1.2, 1.6, 0.9);
  const fire = campfire(1.6, -1.2);
  const rack = prop('drying rack', -1.0, -7.0, 0.2); for (const x of [-1, 1]) { pole(x, -0.0, 1.8, 0, 0).position.set(x, 0.9, 0); rack.add(rack.children.length ? rack.children.pop() : new THREE.Group()); }
  { const g = rack; g.clear(); for (const x of [-1.1, 1.1]) mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 5), M(DEAD), x, 0.95, 0, g); mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 5), M(DEAD), 0, 1.8, 0, g).rotation.z = Math.PI / 2;
    mesh(box(0.9, 0.9, 0.03), M('#9B7451'), -0.5, 1.3, 0, g); mesh(box(0.7, 0.7, 0.03), M('#C9A57A'), 0.45, 1.4, 0, g); for (let k = 0; k < 4; k++) mesh(box(0.08, 0.34, 0.03), M('#B9C2C8', { metalness: 0.3, roughness: 0.4 }), 0.9 + k * 0.08, 1.58, 0.02, g); }
  for (const [x, z, c] of [[0.2, -2.6, '#D9C9A6'], [-0.25, -2.9, '#C9B48A'], [5.6, -2.3, '#D9C9A6']]) { const g = prop('birch-bark basket', x, z); mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.32, 8), M(c), 0, 0.16, 0, g); mesh(new THREE.TorusGeometry(0.2, 0.02, 4, 8), M('#8E6E4E'), 0, 0.32, 0, g).rotation.x = Math.PI / 2; }
  { const g = prop('cargo sledge', 6.6, -1.0, -0.5); for (const x of [-0.45, 0.45]) { mesh(box(0.06, 0.06, 2.4), M(BARK), x, 0.08, 0, g); mesh(box(0.06, 0.2, 0.06), M(BARK), x, 0.2, 0.9, g); mesh(box(0.06, 0.2, 0.06), M(BARK), x, 0.2, -0.9, g); }
    mesh(box(1.0, 0.05, 2.2), M('#A8703F'), 0, 0.32, 0, g); mesh(box(0.8, 0.4, 0.9), M('#8E5A3A'), 0, 0.55, -0.3, g); mesh(box(0.6, 0.3, 0.5), M('#C9B48A'), 0.05, 0.5, 0.6, g); }
  { const g = prop('birch-bark canoe', 2.5, -9.8, 0.15); const c = mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.2, 8, 1, false, 0, Math.PI), M('#D9C9A6', { side: THREE.DoubleSide }), 0, 0.3, 0, g); c.rotation.set(0, 0, Math.PI / 2); c.rotation.order = 'ZYX'; c.scale.set(1, 1, 0.8); c.rotation.y = 0; c.rotation.x = Math.PI; c.rotation.z = Math.PI / 2; mesh(box(0.06, 0.6, 0.06), M(BARK), 1.0, 0.3, 0, g).rotation.z = 0.8; }
  { const tuft = [[new THREE.ConeGeometry(0.1, 0.2, 5).translate(0, 0.1, 0), M('#6E9A44')]], list = [], fl = [], fl2 = [];
    for (let i = 0; i < 900; i++) { const x = -14 + rnd() * 28, z = -8.5 + rnd() * 17; if (Math.hypot(x - 1.6, z + 1.2) < 1.2) continue; list.push([x, Hy(x, z), z, rnd() * 6, 0.8 + rnd(), 0.5 + rnd() * 0.6, 0.8 + rnd()]); }
    for (let i = 0; i < 500; i++) { const x = -14 + rnd() * 28, z = -8 + rnd() * 17; (i % 3 ? fl : fl2).push([x, Hy(x, z) + 0.2, z, rnd() * 6, 1, 1, 1]); }
    const g = prop('grass tussocks and flowers', 0, 0); inst(tuft, list, g, false); inst([[new THREE.IcosahedronGeometry(0.05, 0), M('#F2D23A')]], fl, g, false); inst([[new THREE.IcosahedronGeometry(0.055, 0), M(FIREWEED)]], fl2, g, false); }
  { const g = prop('firewood stack', -1.6, -2.2, 0.3); for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 6), M(k % 2 ? '#8E6E4E' : BARK), -0.27 + k * 0.17 + r * 0.085, 0.08 + r * 0.15, 0, g).rotation.x = Math.PI / 2; }
  for (const [x, z] of [[-2.4, 6.0], [1.4, 6.6], [-0.4, 7.4]]) rock(x, z, 0.5, '#9C958B');
  // foreground
  { const g = prop('larch stump with axe', 3.0, 5.6); mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.55, 8), M('#8E6E4E'), 0, 0.27, 0, g); mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 8), M('#D8B58A'), 0, 0.56, 0, g);
    const ax = new THREE.Group(); ax.position.set(0.05, 0.6, 0); ax.rotation.z = -0.5; g.add(ax); mesh(box(0.05, 0.6, 0.05), M('#A8703F'), 0, 0.3, 0, ax); mesh(box(0.18, 0.1, 0.03), M('#6E7072', { metalness: 0.5, roughness: 0.4 }), 0.07, 0.0, 0, ax);
    for (let k = 0; k < 5; k++) mesh(box(0.3, 0.08, 0.1), M('#C9A57A'), -0.5 + rnd() * 0.3, 0.05, 0.3 + rnd() * 0.3, g).rotation.y = rnd() * 3; }
  { const g = prop('pack saddles and bags', 1.6, 5.4, 0.4); mesh(box(0.8, 0.35, 0.5), M('#8E5A3A'), 0, 0.18, 0, g); mesh(box(0.6, 0.3, 0.45), M('#6B4A2E'), 0.2, 0.5, 0, g); mesh(box(0.5, 0.25, 0.4), M('#C9A57A'), -0.6, 0.13, 0.3, g);
    for (const s of [-1, 1]) mesh(box(0.06, 0.4, 0.5), M('#A8703F'), s * 0.42, 0.45, 0, g); }
  birch(6.4, 5.2, 5.2);
  // people
  const herder = hero(evenk({ top: '#8E5A3A', height: 1.66 })); herder.position.set(1.7, Hy(1.7, 2.2), 2.2); herder.rotation.y = 0.5;
  const staff = mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.0, 5), M(BARK), 0, -0.6, 0.02, herder.userData.arms[1].userData.hand);
  const woman = evenk({ top: '#B65E48', coatCol: '#9B4E3C', height: 1.55, longHair: true, hatCol: '#2E4566' }); woman.position.set(2.7, 0, -1.9); woman.rotation.y = -0.7;
  const child = evenk({ top: '#C9A57A', height: 1.1, hatCol: '#B65E48' }); child.position.set(3.2, 0, -0.5); child.rotation.y = -1.6;
  const elder = evenk({ top: '#6B4A2E', height: 1.58, hatCol: '#5E4330' }); elder.position.set(-4.6, 0, -2.2); elder.rotation.y = 0.8;
  const pup = dog({ coat: '#3B2A20', belly: '#C9A57A', dark: '#1F1A17', size: 0.7 }); pup.position.set(0.9, 0, 1.4); pup.rotation.y = 0.6;
  const herd = []; for (const [x, z, ry, s] of [[3.9, 1.3, -1.0, 1], [0.1, 0.1, 0.9, 0.95], [-1.0, -3.4, 2.0, 0.9], [5.8, -1.8, -2.3, 0.85], [2.3, -3.4, 0.3, 0.9], [-2.6, 1.0, 1.8, 1.05], [-3.2, -1.0, 0.2, 0.9]]) { const d = reindeer({ s, coat: ['#8B7560', '#9C8670', '#6E5A48'][herd.length % 3], antlers: herd.length % 3 !== 2 }); d.position.set(x, Hy(x, z), z); d.rotation.y = ry; herd.push(d); }
  // the fireball: white core, warm glow, a long burning trail and a smoke trail left hanging in the sky
  const fb = new THREE.Group(); scene.add(fb); const core = mesh(new THREE.IcosahedronGeometry(2.4, 1), E('#FFF7E0'), 0, 0, 0, fb); core.castShadow = false;
  const glow = puff('#FFD28A', 0.9, true, false); glow.scale.setScalar(20); fb.add(glow); const glow2 = puff('#FFFFFF', 0.8, true, false); glow2.scale.setScalar(8); fb.add(glow2);
  const trail = []; for (let i = 0; i < 26; i++) { const s = puff(i < 10 ? '#FFC870' : '#FF9A50', 0.7 * (1 - i / 26), true, false); scene.add(s); trail.push(s); }
  const smk = []; for (let i = 0; i < 60; i++) { const s = puff('#C9BFB4', 0.0, false, false); scene.add(s); smk.push(s); }
  const fwd = V(0, 0, 0), rgt = V(0, 0, 0), upv = V(0, 0, 0); const TH = Math.tan(D(29)), TW = TH * 9 / 16, DEP = 170;
  const fpos = (t) => { const k = clamp((t - 0.3) / 6.4); const sx = mix(0.75, -0.75, k), sy = mix(0.30, 0.385, k); return camera.position.clone().addScaledVector(fwd, DEP).addScaledVector(rgt, sx * TW * DEP).addScaledVector(upv, (0.5 - sy) * 2 * TH * DEP); };
  // dawn clouds across the sky, placed in the camera's view
  camera.position.set(4.6, 2.3, 9.6); camera.lookAt(0.4, 3.9, -6); camera.fov = 58; camera.far = 700; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  { const f = V(0, 0, 0), r = V(0, 0, 0), u = V(0, 0, 0); camera.getWorldDirection(f); r.crossVectors(f, V(0, 1, 0)).normalize(); u.crossVectors(r, f).normalize(); const TH0 = Math.tan(D(29));
    const clouds = []; for (let i = 0; i < 26; i++) clouds.push([-1.1 + (i * 0.43) % 2.2 + rnd() * 0.2, 0.01 + (i / 26) * 0.44 + rnd() * 0.02, 1.1 + rnd() * 0.7]);
    for (let i = 0; i < 110; i++) clouds.push([-1.1 + rnd() * 2.2, 0.0 + rnd() * 0.44, 0.22 + rnd() * 0.2]);
    clouds.forEach(([sx, sy, sc], k) => { const dep = 240 + k * 5; const P = camera.position.clone().addScaledVector(f, dep).addScaledVector(r, sx * TH0 * 9 / 16 * dep).addScaledVector(u, (0.5 - sy) * 2 * TH0 * dep);
      const g = prop('dawn cloud', P.x, P.z, 0, P.y); g.lookAt(camera.position); g.rotation.x = 0; g.rotation.z = 0; const col = sy > 0.35 ? '#F6C9A8' : sy > 0.2 ? '#F3D9C8' : '#E9E4EE'; const mat = M(col, { emissive: C(col), emissiveIntensity: 0.12, fog: false });
      for (let i = 0; i < 6; i++) { const b = mesh(blob(5 * sc * (0.6 + rnd() * 0.6), 0, 0.2), mat, (i - 2.5) * 5.5 * sc, rnd() * 2 * sc, rnd() * 3, g); b.scale.set(1.4, 0.42, 1); b.castShadow = false; b.receiveShadow = false; } }); }
  atmo('fireball'); atmo('smoke from the chums and the fire'); atmo('river mist'); atmo('birds'); atmo('grazing reindeer');
  const s1 = smoke(-3.0, 3.6, -4.2, { n: 8, h: 4, w: 0.8, op: 0.35, speed: 0.45, drift: 0.4, s0: 0.4 }), s2 = smoke(4.2, 4.0, -5.0, { n: 8, h: 4, w: 0.8, op: 0.35, speed: 0.45, drift: 0.4, s0: 0.4 }), s3 = smoke(1.6, 0.4, -1.2, { n: 10, h: 3.5, w: 0.7, op: 0.4, speed: 0.5, drift: 0.4, s0: 0.3 });
  const mist = []; for (let i = 0; i < 14; i++) { const s = puff('#F6E6D8', 0.35); world.add(s); mist.push([s, -30 + rnd() * 60, -12 - rnd() * 8, rnd()]); s.scale.set(9 + rnd() * 5, 1.2, 1); }
  const bd = birds(4, { x0: -16, x1: 16, y: 11, z: -14, speed: 2.8, s: 1.2 });
  update = (t, u, e) => { fire(t); s1(t); s2(t + 1.5); s3(t + 3); bd(t, sm(2.5, 4.5, t) * 2); waterTex.offset.x = t * 0.02;
    mist.forEach(([s, x, z, r]) => s.position.set(x + t * 0.4, 0.2 + r * 0.5, z));
    camera.position.set(mix(4.6, 4.3, e), 2.3, mix(9.6, 8.9, e)); camera.lookAt(0.4, 3.9, -6); camera.fov = 58; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    camera.getWorldDirection(fwd); rgt.crossVectors(fwd, V(0, 1, 0)).normalize(); upv.crossVectors(rgt, fwd).normalize();
    const P = fpos(t), seen = sm(0.3, 0.8, t); fb.position.copy(P); fb.visible = t > 0.3; const fl = 1 + 0.12 * Math.sin(t * 23);
    glow.material.opacity = 0.85 * seen * fl; glow2.material.opacity = 0.8 * seen;
    const dir = fpos(t + 0.05).sub(fpos(t - 0.05)).normalize(); if (!(dir.lengthSq() > 0)) dir.set(-1, -0.1, 0); trail.forEach((s, i) => { s.position.copy(P).addScaledVector(dir, -(i + 1) * 3.2 * Math.min(1, (t - 0.3) * 1.5)); s.scale.setScalar(10 - i * 0.28); s.material.opacity = 0.7 * (1 - i / 26) * seen; s.visible = t > 0.35; });
    smk.forEach((s, i) => { const ti = 0.3 + i / smk.length * 6.4; const age = t - ti; s.visible = age > 0; if (age <= 0) return; s.position.copy(fpos(ti)).add(V(0, age * 0.4, 0)); s.scale.setScalar(4 + age * 2.0); s.material.opacity = 0.42 * Math.min(1, age * 2) * (1 - age / 14); });
    // the light of it washes over the camp
    const flash = seen * (0.55 + 0.45 * sm(2.0, 3.6, t) * (1 - sm(5.2, 6.8, t))); hemi.intensity = 1.35 + 0.35 * flash; sun.intensity = 2.6 + 0.6 * flash;
    // everyone turns and looks up
    standPose(herder, t); standPose(woman, t + 1); standPose(child, t + 2); standPose(elder, t + 3);
    const look = sm(1.0, 1.9, t); herder.rotation.y = mix(0.5, -1.2, look); herder.userData.hd.rotation.x = -0.55 * look; herder.userData.hd.rotation.y = mix(0, 0.2, look) - 0.15 * sm(3, 6, t);
    herder.userData.arms[0].rotation.x = -1.6 * sm(2.2, 2.9, t); herder.userData.arms[0].rotation.z = 0.3 * sm(2.2, 2.9, t);   // he points at it
    herder.userData.arms[1].rotation.x = -0.25;
    const lw = sm(1.6, 2.4, t); woman.rotation.y = mix(-0.7, 0.6, lw); woman.userData.hd.rotation.x = -0.5 * lw; child.rotation.y = mix(-1.6, 0.2, sm(1.8, 2.6, t)); child.userData.hd.rotation.x = -0.6 * sm(1.8, 2.6, t);
    child.userData.arms.forEach((a) => (a.rotation.x = -0.4 * sm(2.4, 3, t))); elder.userData.hd.rotation.x = -0.5 * sm(1.4, 2.2, t); elder.rotation.y = mix(0.8, 0.2, sm(1.4, 2.2, t));
    dogSit(pup, t, mix(0.3, -0.4, sm(1.2, 2.0, t))); pup.userData.neck.rotation.x = 0.55 - 0.5 * sm(1.2, 2.0, t);
    herd.forEach((d, k) => { deerGraze(d, t, k * 1.7); const up = sm(1.6 + k * 0.15, 2.3 + k * 0.15, t); d.userData.neck.rotation.x *= 1 - up; d.userData.neck.rotation.x -= 0.25 * up; });
  };
  overlay = (t) => card('Siberia, 1908', { y: 0.2, size: 0.05 });
}

// grass tussocks and flowers scattered over a rectangle, skipping any [x, z, r] holes
function tussocks(x0, x1, z0, z1, n, holes = [], parent, skip = () => false) { const tuft = [[new THREE.ConeGeometry(0.1, 0.2, 5).translate(0, 0.1, 0), M('#6E9A44')]], list = [], fl = [], fl2 = [];
  for (let i = 0; i < n; i++) { const x = mix(x0, x1, rnd()), z = mix(z0, z1, rnd()); if (holes.some(([hx, hz, hr]) => Math.hypot(x - hx, z - hz) < hr) || skip(x, z)) continue; list.push([x, Hy(x, z), z, rnd() * 6, 0.8 + rnd(), 0.5 + rnd() * 0.6, 0.8 + rnd()]);
    if (i % 2) (i % 3 ? fl : fl2).push([x + 0.2, Hy(x, z) + 0.18, z + 0.1, 0, 1, 1, 1]); }
  const g = new THREE.Group(); g.name = 'grass tussocks and flowers'; (parent || world).add(g); /* ground cover, not a set piece */ inst(tuft, list, g, false); inst([[new THREE.IcosahedronGeometry(0.05, 0), M('#F2D23A')]], fl, g, false); inst([[new THREE.IcosahedronGeometry(0.055, 0), M(FIREWEED)]], fl2, g, false); return g; }
// a point in the current camera's view: sx -1..1 across, sy 0..1 down the frame, at depth dep
function inView(sx, sy, dep) { camera.updateMatrixWorld(); const f = V(0, 0, 0), r = V(0, 0, 0), u = V(0, 0, 0); camera.getWorldDirection(f); r.crossVectors(f, V(0, 1, 0)).normalize(); u.crossVectors(r, f).normalize(); const th = Math.tan(D(camera.fov / 2));
  return camera.position.clone().addScaledVector(f, dep).addScaledVector(r, sx * th * camera.aspect * dep).addScaledVector(u, (0.5 - sy) * 2 * th * dep); }
function cloudsInView(list, { col = '#FFFFFF', warm = '#F6E6D8', dep0 = 240 } = {}) { list.forEach(([sx, sy, sc], k) => { const dep = dep0 + k * 5; const P = inView(sx, sy, dep);
  const g = prop('cloud', P.x, P.z, 0, P.y); g.lookAt(camera.position); g.rotation.x = 0; g.rotation.z = 0; const c = sy > 0.3 ? warm : col; const mat = M(c, { emissive: C(c), emissiveIntensity: 0.12, fog: false });
  for (let i = 0; i < 6; i++) { const b = mesh(blob(5 * sc * (0.6 + rnd() * 0.6), 0, 0.2), mat, (i - 2.5) * 5.5 * sc, rnd() * 3 * sc, rnd() * 3, g); b.scale.set(1.3, 0.55, 1); b.castShadow = false; b.receiveShadow = false; } }); }
// log cabin with carved window frames, a porch, shutters and glass panes (panes and shutters returned for the blast)
const LOGTEX = canvasTex(256, 256, (g, w, h) => { for (let y = 0; y < h; y += 32) { const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, '#B08458'); gr.addColorStop(0.5, '#9A6E45'); gr.addColorStop(0.92, '#6E4A2E'); gr.addColorStop(1, '#4A3220'); g.fillStyle = gr; g.fillRect(0, y, w, 32); }
  g.globalAlpha = 0.35; for (let i = 0; i < 120; i++) { g.fillStyle = '#5E4330'; g.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 40, 1.5); } });
LOGTEX.wrapS = LOGTEX.wrapT = THREE.RepeatWrapping;
const PLANK = canvasTex(256, 256, (g, w, h) => { for (let x = 0; x < w; x += 32) { g.fillStyle = ['#7A6A5A', '#867464', '#6E6052'][(x / 32) % 3]; g.fillRect(x, 0, 32, h); g.fillStyle = '#4A4038'; g.fillRect(x, 0, 2, h); } }); PLANK.wrapS = PLANK.wrapT = THREE.RepeatWrapping;
function cabin(name, x, z, w, d, h, ry, { windows = [], porch = false, trim = '#4F86B8' } = {}) { const g = prop(name, x, z, ry, Hy(x, z));
  const lt = LOGTEX.clone(); lt.needsUpdate = true; lt.repeat.set(w / 1.2, h / 1.2); const ltd = LOGTEX.clone(); ltd.needsUpdate = true; ltd.repeat.set(d / 1.2, h / 1.2);
  const wm = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.85 }), dm = new THREE.MeshStandardMaterial({ map: ltd, roughness: 0.85 });
  mesh(box(w, h, 0.3), wm, 0, h / 2, d / 2, g); mesh(box(w, h, 0.3), wm, 0, h / 2, -d / 2, g); mesh(box(0.3, h, d), dm, -w / 2, h / 2, 0, g); mesh(box(0.3, h, d), dm, w / 2, h / 2, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let y = 0.12; y < h; y += 0.25) mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 7), M('#A27A52'), sx * (w / 2 + 0.05), y, sz * (d / 2 + 0.05), g).rotation.set(0, 0, 0);
  // gable roof of grey planks, gable ends in logs, a brick chimney
  const pt = PLANK.clone(); pt.needsUpdate = true; pt.repeat.set(w / 1.5, 2); const rm = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.9, flatShading: true }); const rise = d * 0.36, sl = Math.hypot(d / 2 + 0.5, rise);
  for (const s of [-1, 1]) { const r = mesh(box(w + 1.0, 0.1, sl), rm, 0, h + rise / 2, s * (d / 4 + 0.25), g); r.rotation.x = s * Math.atan2(rise, d / 2 + 0.5); }
  for (const s of [-1, 1]) { const gb = new THREE.Shape(); gb.moveTo(-d / 2, 0); gb.lineTo(d / 2, 0); gb.lineTo(0, rise); gb.closePath(); const m = mesh(new THREE.ExtrudeGeometry(gb, { depth: 0.2, bevelEnabled: false }), dm, s * w / 2 - (s > 0 ? 0.2 : 0), h, 0, g); m.rotation.y = Math.PI / 2; }
  const ch = mesh(box(0.5, 1.4, 0.5), M('#B65E48'), w * 0.25, h + rise * 0.8, -d * 0.15, g);
  const panes = [], shutters = [];
  for (const [wx, wy, side] of windows) { const fz = side === 'front' ? d / 2 + 0.16 : -d / 2 - 0.16, sg = side === 'front' ? 1 : -1; const wg = new THREE.Group(); wg.position.set(wx, wy, fz); g.add(wg); if (sg < 0) wg.rotation.y = Math.PI;
    mesh(box(1.0, 1.2, 0.06), M('#2B3440'), 0, 0, -0.02, wg);     // dark room behind the glass
    for (const [px, py] of [[-0.22, 0.27], [0.22, 0.27], [-0.22, -0.27], [0.22, -0.27]]) { const p = mesh(box(0.4, 0.5, 0.02), M('#BFE2F0', { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2, emissive: C('#9FD0E8'), emissiveIntensity: 0.25 }), px, py, 0.03, wg); p.castShadow = false; panes.push(p); }
    mesh(box(1.12, 0.07, 0.08), M(PAL.offwhite), 0, 0, 0.05, wg); mesh(box(0.07, 1.3, 0.08), M(PAL.offwhite), 0, 0, 0.05, wg);
    mesh(box(1.3, 0.12, 0.1), M(trim), 0, 0.7, 0.05, wg); mesh(box(1.3, 0.1, 0.1), M(trim), 0, -0.68, 0.05, wg); for (const s of [-1, 1]) mesh(box(0.1, 1.4, 0.1), M(trim), s * 0.6, 0, 0.05, wg);
    const crown = mesh(new THREE.ConeGeometry(0.75, 0.3, 3), M(PAL.offwhite), 0, 0.9, 0.05, wg); crown.rotation.z = 0; crown.scale.z = 0.15;
    for (const s of [-1, 1]) { const hg = new THREE.Group(); hg.position.set(s * 0.66, 0, 0.1); wg.add(hg); const sh = mesh(box(0.55, 1.25, 0.05), M(trim), s * 0.28, 0, 0, hg); mesh(box(0.4, 0.08, 0.06), M(PAL.offwhite), s * 0.28, 0.3, 0.02, hg); mesh(box(0.4, 0.08, 0.06), M(PAL.offwhite), s * 0.28, -0.3, 0.02, hg); sh; hg.rotation.y = s * 1.75; shutters.push([hg, s]); } }
  if (porch) { const pz = d / 2 + 1.0; mesh(box(w * 0.55, 0.12, 1.8), M('#8E6E4E'), porch, 0.45, pz, g); for (let k = 0; k < 3; k++) mesh(box(1.2, 0.08, 0.3), M('#7A5A3E'), porch, 0.12 + k * 0.13, pz + 1.05 - k * 0.2, g);
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.4, 6), M('#8E6E4E'), porch + s * w * 0.26, 1.2, pz + 0.8, g);
    const pr = mesh(box(w * 0.6, 0.08, 2.1), rm, porch, 2.45, pz - 0.05, g); pr.rotation.x = 0.18; const door = mesh(box(0.9, 1.8, 0.06), M('#6E4A2E'), porch, 1.42, d / 2 + 0.17, g); door; }
  g.userData.panes = panes; g.userData.shutters = shutters; g.userData.chimney = g.localToWorld(V(w * 0.25, h + rise * 0.8 + 0.7, -d * 0.15)); return g; }

// ================================================================ G03 Vanavara trading post: the flash, then the wind
if (G3) {
  // Dressing plan (3A), Vanavara trading post on the Podkamennaya Tunguska, about 65 km from the centre, 7 a.m., 30 June 1908:
  //  foreground  a chopping block with split firewood, a water barrel and a bucket, a birch at the edge of the yard
  //  hero zone   the trader on the porch of the trading-post cabin, sitting on a bench, then thrown off it by the wind
  //  midground   the log trading post with carved blue window frames and shutters, a storehouse on short stilts, a woman at a
  //              washing line, a man splitting wood, a cart, sacks and barrels, a well sweep, a rail fence, chickens, a dog
  //  background  the river and the taiga running to the horizon where the flash appears, far cabins, low hills
  //  atmosphere  chimney smoke, the flash and then a travelling wall of dust, flying leaves and washing, birds, chickens
  sky('day', 90, 320); sun.position.set(-12, 12, 8); sun.intensity = 2.8; hemi.intensity = 1.3; fill.intensity = 0.45; shadowBox(20, 80); renderer.toneMappingExposure = 1.12;
  scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#5FA8E6'); gr.addColorStop(0.6, '#BFE2F5'); gr.addColorStop(1, '#F2E2C4'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  const hf = (x, z) => 0.1 * Math.sin(x * 0.4) * Math.cos(z * 0.3) - 1.0 * sm(-14, -17, z) * sm(-32, -29, z) + 2.5 * sm(-60, -110, z);
  terrain(260, 170, hf, tex('#8AA552', ['#7A9A4A', '#9FB060', '#B8A86A', '#6B8A42', '#A89A5A'], 6000, { rep: 26 }));
  { const yard = mesh(new THREE.CircleGeometry(7, 14), M('#A89070', { map: tex('#A89070', ['#8A6E4E', '#C8B090', '#7A6448', '#D9C9A6', '#6B8A42'], 4000, { rep: 3, r: [1, 6], a: [0.5, 0.95] }) }), 0.5, 0.02, 0); yard.rotation.x = -Math.PI / 2; yard.castShadow = false; yard.scale.set(1.3, 1, 1); }
  const waterTex = tex('#5A96B8', ['#6FA6C2', '#3E7A9C', '#8BBBD0'], 1500, { rep: 6, r: [2, 6] });
  const river = mesh(new THREE.PlaneGeometry(260, 14), M('#FFFFFF', { map: waterTex, roughness: 0.25, metalness: 0.15 }), 0, -0.6, -22.5); river.rotation.x = -Math.PI / 2; river.castShadow = false;
  for (let s = 0; s < 6; s++) { const list = []; for (let i = 0; i < 300; i++) { const x = -110 + (s + rnd()) * 36, z = -32 - Math.pow(rnd(), 0.7) * 70; list.push([x, z, 6 + rnd() * 5 + (-z - 32) * 0.05, rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = `taiga to the horizon ${s + 1}`; g.userData.prop = true; forest(list, g); }
  for (const [x, z, s] of [[-50, -150, 34], [10, -165, 44], [70, -150, 36]]) { const p = prop('low hill', x, z); const m = mesh(new THREE.ConeGeometry(s, s * 0.4, 8), M('#8A9EB4'), 0, Hy(x, z) + s * 0.12, 0, p); m.castShadow = false; }
  // the settlement
  const post = cabin('trading post', -1.4, -2.8, 6.4, 4.6, 2.6, 0.12, { windows: [[-1.9, 1.45, 'front'], [1.9, 1.45, 'front']], porch: 0.0 });
  const store = cabin('storehouse', 5.2, -8.5, 4.2, 3.4, 2.2, -0.25, { windows: [[0, 1.25, 'front']], trim: '#B65E48' }); store.position.y += 0.35; for (const [a, b] of [[-1.8, -1.4], [1.8, -1.4], [-1.8, 1.4], [1.8, 1.4]]) mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.4, 6), M('#6E4A2E'), a, -0.17, b, store);
  const far1 = cabin('far cabin', -11, -12, 4.5, 3.6, 2.3, 0.4, { windows: [[0, 1.3, 'front']] }), far2 = cabin('far cabin', 12.5, -13.5, 4.0, 3.4, 2.2, -0.5, { windows: [[0.6, 1.3, 'front']], trim: '#2A8C9A' });
  for (const [x, z, h] of [[-8, -7, 8], [-9.5, -3.5, 9], [10, -4, 7], [9, 2.5, 8.5], [-7.5, 3.5, 7.5]]) spruce(x, z, h); birch(-6.2, -8.6, 6); birch(7.8, -1.6, 5.5);
  const trees = world.children.filter((o) => o.name === 'spruce' || o.name === 'birch');
  // washing line, woman, man splitting wood, cart, sacks, barrels, well sweep, fence, chickens, dog
  { const g = prop('washing line', 2.8, 0.4, -0.15); for (const x of [-1.6, 1.6]) mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.0, 5), M(DEAD), x, 1.0, 0, g); mesh(new THREE.CylinderGeometry(0.008, 0.008, 3.2, 3), M('#E8E0D0'), 0, 1.9, 0, g).rotation.z = Math.PI / 2; }
  const wash = []; for (const [x, c, wv, hv] of [[2.5, PAL.offwhite, 0.7, 0.9], [3.3, '#C0392B', 0.5, 0.6], [4.0, '#7EC4EA', 0.6, 0.8], [4.6, PAL.offwhite, 0.45, 0.5]]) { const p = new THREE.Group(); world.add(p); p.position.set(x - 0.8, 1.9, 0.4 - (x - 3.6) * 0.15); p.rotation.y = -0.15; const m = mesh(box(wv, hv, 0.02), M(c, { side: THREE.DoubleSide }), 0, -hv / 2, 0, p); m.castShadow = true; wash.push([p, rnd()]); }
  const woman = person({ outfit: 'kimono', top: '#B65E48', bottom: '#5E6B9A', obi: '#F2B53A', skin: PAL.skin[1], hair: PAL.hair[2], height: 1.6, bun: true }); woman.position.set(2.2, 0, 1.05); woman.rotation.y = Math.PI - 0.2;
  { const hd = woman.userData.hd, s2 = 1.6 / 6.5; mesh(new THREE.SphereGeometry(s2 * 0.56, 8, 5, 0, 6.283, 0, 1.6), M('#F2B53A'), 0, s2 * 0.05, -s2 * 0.02, hd); }   // headscarf
  const basket = prop('wash basket', 1.3, 1.4); mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.3, 9), M('#C9A57A'), 0, 0.15, 0, basket); mesh(box(0.4, 0.1, 0.3), M(PAL.offwhite), 0, 0.3, 0, basket);
  const chopper = person({ top: '#5E6B4E', bottom: '#4A4038', skin: PAL.skin[1], hair: PAL.hair[2], height: 1.74, hat: 'fedora', hatCol: '#5E5048' }); beard(chopper, '#6B4A2E'); chopper.position.set(3.0, 0, -1.9); chopper.rotation.y = -1.9;
  const axe = new THREE.Group(); chopper.userData.arms[1].userData.hand.add(axe); mesh(box(0.05, 0.8, 0.05), M('#A8703F'), 0, -0.1, 0.25, axe).rotation.x = 1.2; mesh(box(0.03, 0.12, 0.2), M('#6E7072', { metalness: 0.5 }), 0, 0.05, 0.62, axe);
  const block = prop('chopping block and split wood', 2.3, -1.6); mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.5, 8), M('#8E6E4E'), 0, 0.25, 0, block); for (let k = 0; k < 9; k++) mesh(box(0.12, 0.12, 0.45), M(k % 2 ? '#C9A57A' : '#B08458'), (rnd() - 0.5) * 1.2, 0.06, 0.4 + rnd() * 0.5, block).rotation.y = rnd() * 3;
  { const g = prop('woodpile', 7.5, 0.0, -0.6); for (let r = 0; r < 4; r++) for (let k = 0; k < 7 - r; k++) mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 6), M(k % 2 ? '#8E6E4E' : '#A27A52'), -0.6 + k * 0.2 + r * 0.1, 0.1 + r * 0.18, 0, g).rotation.x = Math.PI / 2; }
  { const g = prop('cart', -6.6, 1.2, 0.9); mesh(box(1.2, 0.08, 2.0), M('#A8703F'), 0, 0.7, 0, g); for (const s of [-1, 1]) { mesh(box(0.06, 0.35, 2.0), M('#8E6E4E'), s * 0.6, 0.88, 0, g); const w = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 10), M('#6E4A2E'), s * 0.68, 0.45, 0.4, g); w.rotation.z = Math.PI / 2; }
    mesh(box(0.06, 0.06, 2.4), M('#8E6E4E'), -0.25, 0.6, 2.0, g); mesh(box(0.06, 0.06, 2.4), M('#8E6E4E'), 0.25, 0.6, 2.0, g); for (let k = 0; k < 3; k++) mesh(blob(0.25, 0, 0.1), M('#D9C9A6'), -0.3 + k * 0.3, 0.95, -0.4 + k * 0.3, g); }
  for (const [x, z] of [[-5.4, -0.6], [-4.9, -0.2]]) { const g = prop('barrel', x, z); mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 10), M('#8E6E4E'), 0, 0.38, 0, g); for (const y of [0.12, 0.62]) mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 10), M('#33363B'), 0, y, 0, g); }
  { const g = prop('sacks', 0.9, -0.2); for (let k = 0; k < 3; k++) mesh(blob(0.25, 0, 0.1), M('#D9C9A6'), k * 0.35 - 0.35, 0.2, 0, g).scale.y = 1.2; }
  { const g = prop('well sweep', -6.0, -5.6); mesh(box(0.9, 0.7, 0.9), M('#8E6E4E'), 0, 0.35, 0, g); mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.0, 5), M(DEAD), 1.6, 1.5, 0, g); const arm = mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.5, 5), M(DEAD), 0.5, 2.9, 0, g); arm.rotation.z = 1.2; mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.3, 3), M('#5E4330'), -0.7, 1.5, 0, g); }
  { const g = prop('rail fence', 0, 5.0); for (let k = 0; k < 8; k++) { const x = -9 + k * 2.0; mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.2, 5), M(DEAD), x, 0.6, 0.3 * Math.sin(k), g); } for (const y of [0.45, 0.95]) { const r = mesh(new THREE.CylinderGeometry(0.04, 0.04, 14.5, 5), M(DEAD), -2.0, y, 0, g); r.rotation.z = Math.PI / 2; } }
  const hens = []; for (let k = 0; k < 6; k++) { const g = prop('chicken', -1.0 + k * 0.45 + rnd() * 0.3, 2.2 + rnd() * 1.4, rnd() * 6); mesh(blob(0.14, 0, 0.1), M(k % 2 ? PAL.offwhite : '#B65E48'), 0, 0.18, 0, g); mesh(new THREE.IcosahedronGeometry(0.07, 0), M(k % 2 ? PAL.offwhite : '#B65E48'), 0, 0.3, 0.12, g); mesh(box(0.04, 0.05, 0.02), M('#D9452B'), 0, 0.38, 0.12, g); mesh(new THREE.ConeGeometry(0.02, 0.06, 4), M('#F2B53A'), 0, 0.3, 0.2, g).rotation.x = Math.PI / 2; hens.push([g, g.position.clone(), rnd()]); }
  const pup = dog({ coat: '#C9A57A', belly: '#F3E6C8', dark: '#6B4A2E', size: 0.75 }); pup.position.set(-2.4, 0, 2.4); pup.rotation.y = 0.5;
  tussocks(-12, 12, -12, 9, 1500, [[0.5, 0, 6.0], [-1.4, -2.8, 4]]);
  { const g = prop('straw and wood chips', 0.6, 3.2); for (let k = 0; k < 60; k++) { const m = mesh(box(0.14, 0.015, 0.03), M(k % 3 ? '#D9C08A' : '#B08458'), (rnd() - 0.5) * 7, 0.03, (rnd() - 0.5) * 6, g); m.rotation.y = rnd() * 3; m.castShadow = false; } }
  for (const [x, z] of [[-1.8, 3.6], [1.0, 4.6], [-0.3, 2.0]]) { const g = prop('cart rut puddle', x, z, rnd() * 3, 0.03); const m = mesh(new THREE.CircleGeometry(0.26, 8), M('#5E7F8E', { roughness: 0.25 }), 0, 0, 0, g); m.rotation.x = -Math.PI / 2; m.scale.set(1.5, 0.7, 1); m.castShadow = false; }
  // foreground: water barrel and bucket, a birch, a stack of poles
  { const g = prop('water barrel and bucket', 0.5, 6.4); mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.85, 10), M('#7A5A3E'), 0, 0.43, 0, g); for (const y of [0.15, 0.7]) mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 10), M('#33363B'), 0, y, 0, g); const wt = mesh(new THREE.CircleGeometry(0.33, 10), M('#5A96B8', { roughness: 0.2 }), 0, 0.84, 0, g); wt.rotation.x = -Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 8), M('#9C958B', { metalness: 0.4 }), 0.6, 0.15, 0.2, g); }
  { const g = prop('upturned sledge', 3.0, 6.2, -0.4); for (const x of [-0.4, 0.4]) { const r = mesh(box(0.06, 0.08, 2.2), M(BARK), x, 0.5, 0, g); r.rotation.x = 0.3; } mesh(box(0.9, 0.05, 1.8), M('#A8703F'), 0, 0.3, 0.1, g).rotation.x = 0.3; for (const z of [-0.6, 0, 0.6]) mesh(box(0.06, 0.4, 0.06), M(BARK), 0.4, 0.2, z, g); }
  { const g = prop('tool rack with scythe and rake', -1.0, 5.9, 0.2); for (const x of [-0.5, 0.5]) mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 5), M(DEAD), x, 0.7, 0, g); mesh(box(1.2, 0.06, 0.06), M(DEAD), 0, 1.3, 0, g);
    const sc = mesh(box(0.04, 1.6, 0.04), M('#A8703F'), -0.25, 0.85, 0.08, g); sc.rotation.z = 0.1; mesh(box(0.6, 0.04, 0.02), M('#9C958B', { metalness: 0.5 }), -0.05, 1.6, 0.08, g).rotation.z = -0.3;
    mesh(box(0.04, 1.6, 0.04), M('#A8703F'), 0.25, 0.85, 0.08, g); mesh(box(0.4, 0.05, 0.05), M('#8E6E4E'), 0.25, 1.6, 0.08, g); }
  { const g = prop('gatepost with lantern', 1.7, 5.0); mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.9, 6), M('#8E7E6A'), 0, 0.95, 0, g); mesh(box(0.5, 0.06, 0.06), M('#8E7E6A'), -0.2, 1.8, 0, g);
    mesh(box(0.16, 0.22, 0.16), M('#33363B'), -0.38, 1.6, 0, g); mesh(box(0.11, 0.14, 0.11), M('#F2D28A', { emissive: C('#F2B53A'), emissiveIntensity: 0.3 }), -0.38, 1.6, 0, g); }
  { const g = prop('firewood basket', 0.2, 4.8, 0.4); mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.35, 9), M('#C9A57A'), 0, 0.17, 0, g); for (let k = 0; k < 5; k++) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), M(k % 2 ? '#8E6E4E' : '#B08458'), -0.12 + k * 0.06, 0.4, 0, g).rotation.z = 0.2 * (k - 2); }
  { const g = prop('stack of poles', 1.9, 7.1, 0.3); for (let k = 0; k < 6; k++) mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.2, 5), M(k % 2 ? DEAD : '#8E7E6A'), -0.3 + k * 0.12, 0.07 + (k % 2) * 0.1, 0, g).rotation.x = Math.PI / 2; }
  // the hero: the trader on the porch bench
  const bench = prop('porch bench', -0.5, -0.1); mesh(box(1.4, 0.07, 0.4), M('#A8703F'), 0, 0.9, 0, bench); for (const s of [-1, 1]) mesh(box(0.07, 0.45, 0.35), M('#8E6E4E'), s * 0.6, 0.68, 0, bench);
  const trader = hero(person({ top: '#7A6A5A', bottom: '#33363B', skin: PAL.skin[1], hair: PAL.hair[2], height: 1.72, hat: 'fedora', hatCol: '#4A4038', collar: PAL.offwhite })); beard(trader, '#8A6A4A'); coat(trader, '#7A6A5A', 0.28);
  const hat = trader.userData.hd.children[trader.userData.hd.children.length - 1 - 2]; // brim+crown are the fedora's last two meshes before the beard
  const fed = trader.userData.hd.children.filter((m) => m.geometry && m.geometry.type === 'CylinderGeometry' && m.position.y > 0.1); hat;
  const T0 = V(-0.55, 0.45, -0.1);
  // the flash: a white-gold glow at the horizon, the sky lights up; then the wall of dust and wind
  camera.position.set(2.7, 3.0, 10.6); camera.lookAt(-2.0, 2.5, -6); camera.fov = 58; camera.far = 500; camera.updateProjectionMatrix();
  const flash = puff('#FFF4D0', 0, true, false); flash.position.copy(inView(0.25, 0.33, 170)); scene.add(flash); const flash2 = puff('#FFD08A', 0, true, false); flash2.position.copy(inView(0.25, 0.31, 175)); scene.add(flash2);
  const fcore = mesh(new THREE.IcosahedronGeometry(4.5, 1), E('#FFFBEA'), 0, 0, 0); fcore.position.copy(inView(0.25, 0.33, 168)); fcore.castShadow = false;
  { const cl = []; for (let i = 0; i < 26; i++) cl.push([-1.1 + (i * 0.43) % 2.2 + rnd() * 0.2, 0.01 + (i / 26) * 0.34 + rnd() * 0.02, 1.1 + rnd() * 0.7]); for (let i = 0; i < 120; i++) cl.push([-1.1 + rnd() * 2.2, rnd() * 0.38, 0.22 + rnd() * 0.2]); for (let i = 0; i < 70; i++) cl.push([-1.1 + rnd() * 2.2, 0.12 + rnd() * 0.26, 0.16 + rnd() * 0.14]); for (let i = 0; i < 50; i++) cl.push([rnd() * 1.1, 0.16 + rnd() * 0.2, 0.18 + rnd() * 0.16]); cloudsInView(cl); }
  const dust = []; for (let i = 0; i < 46; i++) { const sp = puff(i % 2 ? '#BCA88E' : '#C8B8A0', 0); world.add(sp); dust.push([sp, -30 + (i % 23) * 2.8 + rnd(), i < 23 ? 0 : 1, rnd()]); }
  const debris = []; for (let i = 0; i < 70; i++) { const m = mesh(box(0.06, 0.02, 0.05), M(['#8AA552', '#C9A57A', '#7A9A4A', '#E08A2E'][i % 4]), 0, -5, 0); m.castShadow = false; debris.push([m, -12 + rnd() * 24, rnd() * 3, rnd()]); }
  const shards = []; post.updateMatrixWorld(true); post.userData.panes.forEach((p) => { const w0 = p.getWorldPosition(V(0, 0, 0)); for (let k = 0; k < 9; k++) { const m = mesh(new THREE.CircleGeometry(0.06 + rnd() * 0.05, 3), M('#CFEAF5', { transparent: true, opacity: 0.85, side: THREE.DoubleSide, emissive: C('#BFE2F0'), emissiveIntensity: 0.4, roughness: 0.1 }), w0.x, w0.y, w0.z); m.visible = false; m.castShadow = false;
    shards.push({ m, p0: w0.clone().add(V((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4, 0)), v: V((rnd() - 0.5) * 2.4, 1 + rnd() * 2, 2.5 + rnd() * 3), r: V(rnd() * 9, rnd() * 9, 0) }); } });
  const chim = smoke(post.userData.chimney.x, post.userData.chimney.y, post.userData.chimney.z, { n: 10, h: 4, w: 0.7, op: 0.35, speed: 0.5, drift: 0.3, s0: 0.35 });
  const bd = birds(6, { x0: -14, x1: 14, y: 9, z: -10, speed: 2.0, s: 1.1 });
  atmo('chimney smoke'); atmo('the flash and the wall of dust'); atmo('flying leaves and washing'); atmo('birds'); atmo('chickens');
  const HIT = 3.15, shake = V(0, 0, 0);
  update = (t, u, e) => { waterTex.offset.x = t * 0.02;
    const fl = sm(1.3, 1.5, t) * (1 - sm(1.7, 2.7, t)); fcore.visible = t > 1.3 && t < 2.6; fcore.scale.setScalar(0.6 + 1.6 * sm(1.3, 1.8, t) * (1 - sm(2.0, 2.6, t))); flash.material.opacity = 0.7 * fl; flash.scale.setScalar(13 + 14 * sm(1.3, 2.2, t)); flash2.material.opacity = 0.3 * sm(1.4, 1.8, t) * (1 - sm(1.9, 2.8, t)); flash2.scale.setScalar(22 + 14 * sm(1.4, 3, t));
    hemi.intensity = 1.3 + 0.45 * fl; sun.intensity = 2.8 + 0.8 * fl; renderer.toneMappingExposure = 1.12 + 0.05 * fl;
    // the wall of dust sweeps in from the horizon, arriving at the yard at HIT
    const front = mix(-70, 18, sm(2.2, HIT + 0.9, t) * 0.4 + clamp((t - 2.2) / (HIT + 0.9 - 2.2)) * 0.6);
    dust.forEach(([sp, x, row, r]) => { const z = front - row * 4 - r * 2; sp.position.set(x, 1.2 + row * 1.8 + r, z); sp.scale.set(9 + r * 4, 4 + row * 2, 1); sp.material.opacity = 0.55 * sm(2.2, 2.6, t) * (1 - sm(HIT + 0.6, HIT + 2.4, t)) * (z < 12 ? 1 : 0); });
    const wind = sm(HIT - 0.15, HIT + 0.15, t) * (1 - 0.6 * sm(HIT + 1.0, HIT + 2.5, t)); const gust = wind * (0.8 + 0.2 * Math.sin(t * 13));
    debris.forEach(([m, x, y, r]) => { const k = t - HIT - r * 0.6; m.visible = k > 0 && k < 3; if (!m.visible) return; m.position.set(x + Math.sin(k * 4 + r * 9) * 0.5, 0.2 + y * sm(0, 0.5, k) + Math.sin(k * 3 + r) * 0.4, -10 + k * 9); m.rotation.set(k * 9 + r, k * 7, k * 5); });
    trees.forEach((tr) => { const arrive = sm(front - 3, front + 1, tr.position.z); tr.rotation.z = 0; tr.rotation.x = 0.12 * arrive * gust + 0.03 * Math.sin(t * 2 + tr.position.x); });
    chim(t); bd(t, sm(HIT - 0.3, HIT + 1.5, t) * 3);
    // shutters bang, the panes burst out
    const sh = post.userData.shutters.concat(store.userData.shutters, far1.userData.shutters, far2.userData.shutters); sh.forEach(([hg, s], k) => { const kk = t - HIT - k * 0.05; hg.rotation.y = s * (1.75 - (kk > 0 ? 1.7 * Math.abs(Math.sin(kk * 9)) * Math.exp(-kk * 1.2) : 0)); });
    post.userData.panes.forEach((p) => (p.visible = t < HIT + 0.05)); store.userData.panes.forEach((p, k) => (p.visible = t < HIT + 0.3 || k % 2));
    shards.forEach((s2) => { const k = t - HIT - 0.05; s2.m.visible = k > 0; if (k <= 0) return; const p = s2.p0.clone().addScaledVector(s2.v, k); p.y = Math.max(0.03, s2.p0.y + s2.v.y * k - 4.9 * k * k); if (p.y <= 0.03) { s2.m.rotation.set(-Math.PI / 2, 0, s2.r.x); const kl = Math.max(0, (s2.p0.y + 2) / 6); p.z = s2.p0.z + s2.v.z * Math.min(k, 0.6 + kl); p.x = s2.p0.x + s2.v.x * Math.min(k, 0.6 + kl); } else s2.m.rotation.set(s2.r.x * k, s2.r.y * k, 0); s2.m.position.copy(p); });
    // washing whips and the light pieces blow away
    wash.forEach(([p, r], k) => { const off = k % 2 === 0 && t > HIT + 0.1; p.rotation.x = -0.15 * Math.sin(t * 1.5 + r * 4) - 1.2 * gust * (0.7 + 0.3 * Math.sin(t * 17 + k)); if (off) { const kk = t - HIT - 0.1; p.position.set(1.7 + k * 0.7 + kk * 1.2, 1.9 + kk * 1.5 - kk * kk * 0.25, 0.4 + kk * 4.5); p.rotation.y = kk * 3; } });
    // the trader is pitched off the bench and sits down hard in the yard; the woman sits down; the man drops to one knee
    const fall = sm(HIT, HIT + 0.55, t);
    sitPose(trader, t, 0.25 * sm(1.4, 1.9, t)); trader.position.set(mix(T0.x, T0.x - 0.15, fall), mix(0.45, -0.31, fall) + 0.3 * Math.sin(Math.PI * fall), mix(T0.z, T0.z + 1.9, fall)); trader.rotation.y = mix(0.15, 0.0, fall); trader.userData.body.rotation.x = 0.5 * Math.sin(Math.PI * fall) - 0.2 * fall;
    trader.userData.hd.rotation.x = -0.15 * sm(1.4, 1.9, t); trader.userData.arms.forEach((a, k) => { a.rotation.x = mix(-0.6, -1.9, sm(HIT + 0.1, HIT + 0.5, t)) + 0.5 * sm(HIT + 1.5, HIT + 2.5, t); a.rotation.z = (k ? -1 : 1) * 0.3 * fall; });
    fed.forEach((m) => { const kh = t - HIT - 0.1; if (kh > 0) { if (m.parent !== world) { trader.updateMatrixWorld(true); world.attach(m); m.userData.w0 = m.position.clone(); } m.position.copy(m.userData.w0).add(V(0.3 * kh, Math.max(-m.userData.w0.y + 0.05, kh * 1.2 - 2.2 * kh * kh), kh * 2.0)); m.rotation.x = kh * 6; } });
    standPose(woman, t); const wsit = sm(HIT + 0.05, HIT + 0.6, t); woman.rotation.y = mix(Math.PI - 0.2, Math.PI - 0.9, sm(1.4, 1.9, t)); woman.userData.arms.forEach((a, k) => (a.rotation.x = mix(-2.6 + 0.1 * Math.sin(t * 2 + k), -1.5, sm(1.4, 1.9, t)) + 0.6 * wsit));
    woman.userData.hips.position.y = woman.userData.body.position.y = mix(woman.userData.leg, 0.2, wsit); woman.userData.legs.forEach((l) => { l.rotation.x = -1.4 * wsit; l.scale.y = 1 - 0.4 * wsit; }); woman.userData.body.rotation.x = -0.3 * Math.sin(Math.PI * wsit);
    woman.position.set(2.2, 0, mix(1.05, 1.75, wsit));
    standPose(chopper, t); const swing = t < 1.4 ? 0.5 - 0.5 * Math.cos(t * 4.4) : 0; chopper.userData.arms.forEach((a) => (a.rotation.x = -2.6 * swing - 0.4 * (t >= 1.4 ? 1 : 0)));
    chopper.rotation.y = mix(-1.9, -0.4, sm(1.5, 2.1, t)); const kneel = sm(HIT + 0.1, HIT + 0.5, t); chopper.userData.hips.position.y = chopper.userData.body.position.y = mix(chopper.userData.leg, chopper.userData.leg * 0.6, kneel); chopper.userData.legs[0].rotation.x = -1.4 * kneel; chopper.userData.legs[1].rotation.x = 0.9 * kneel; chopper.userData.legs[1].scale.y = 1 - 0.3 * kneel; chopper.userData.body.rotation.x = 0.35 * kneel;
    chopper.userData.arms.forEach((a) => (a.rotation.x += -1.0 * kneel));
    hens.forEach(([g, p0, r], k) => { const k2 = t - HIT + 0.2; const run2 = clamp(k2) * 0 + Math.max(0, k2); g.position.set(p0.x + (r - 0.5) * run2 * 1.5, Math.max(0, Math.sin(Math.min(k2, 1) * Math.PI) * 0.5 * (k2 > 0 ? 1 : 0)), p0.z + run2 * 1.8); g.rotation.x = t < HIT ? 0.4 * Math.max(0, Math.sin(t * 5 + k)) : 0; });
    dogSit(pup, t, mix(0.2, -0.6, sm(1.4, 2.0, t))); pup.userData.neck.rotation.x = 0.55 - 0.5 * sm(1.4, 2.0, t);
    // camera: wide, slow push; a little handheld shake only after the wind hits (<= 0.4 deg)
    const hs = sm(HIT, HIT + 0.2, t) * (1 - sm(HIT + 1.2, HIT + 2.6, t)); shake.set(Math.sin(t * 7.1) * 0.006, Math.sin(t * 5.3 + 1) * 0.005, 0).multiplyScalar(hs);
    camera.position.set(mix(2.7, 2.5, e), mix(3.0, 2.9, e), mix(10.6, 9.8, e)); camera.lookAt(-2.0, 2.5, -6); camera.rotation.x += shake.x; camera.rotation.y += shake.y; camera.fov = 58; camera.far = 500; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Windows\nShattered', { y: 0.2, size: 0.056, alpha: sm(HIT + 0.4, HIT + 0.8, t) });
}

// ---------------------------------------------------------------- 1927: Kulik's expedition
function kulik() { const p = hero(person({ top: '#6E6450', bottom: '#4A4038', skin: PAL.skin[1], hair: '#5E4A3A', height: 1.76, shoes: '#2B2420', step: 0.7, cadence: 1.7 })); coat(p, '#6E6450', 0.36); beard(p, '#5E4A3A'); cap(p, '#4B4F45'); pack(p, '#7A6A4E', '#5E6B4E');
  const stick = mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.5, 5), M(BARK), 0, -0.45, 0.05, p.userData.arms[1].userData.hand); stick; return p; }
function helper(o) { const p = person({ top: o.top, bottom: '#4A4038', skin: o.skin || PAL.skin[1], hair: o.hair || PAL.hair[2], height: o.h || 1.7, step: 0.68, cadence: 1.75, shoes: '#2B2420' }); cap(p, o.cap || '#5E5048'); pack(p, o.pack || '#8E7458', o.roll || '#A8703F'); return p; }
const SAW = '#E8D2A8';
// a fallen trunk lying along +x (top pointing +x) from its root plate at x0; sawn = cut end instead of the top
function trunk(name, x0, z, len, r = 0.18, { sawnAt = null, ry = 0, plate = true } = {}) { const g = prop(name, x0, z, ry, Hy(x0, z)); const L = sawnAt !== null ? sawnAt - x0 : len;
  const m = mesh(new THREE.CylinderGeometry(sawnAt !== null ? r * 0.85 : r * 0.35, r, L, 7), M(BLEACH), L / 2, r * 0.9, 0, g); m.rotation.z = -Math.PI / 2;
  if (sawnAt !== null) { const c = mesh(new THREE.CircleGeometry(r * 0.85, 7), M(SAW), L + 0.005, r * 0.9, 0, g); c.rotation.y = Math.PI / 2; }
  const bk = [BLEACH, '#B8A68A', '#D2C3A6', '#A89276'][Math.floor(rnd() * 4)]; m.material = M(bk);
  if (plate) { const pl = mesh(new THREE.CylinderGeometry(r * 3.0, r * 3.4, r * 1.2, 8), M('#6B5640'), -0.05, r * 2.4, 0, g); pl.rotation.z = Math.PI / 2; for (let k = 0; k < 5; k++) { const rt = mesh(new THREE.CylinderGeometry(0.02, 0.04, r * 3, 4), M('#5E4A3A'), -0.15, r * 2.4 + Math.cos(k * 1.3) * r * 2.6, Math.sin(k * 1.3) * r * 2.6, g); rt.rotation.x = k; } }
  for (let k = 0; k < 3; k++) { const st = mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.3, 4), M(DEAD), L * (0.35 + k * 0.2), r * 1.4, (k % 2 ? 1 : -1) * r * 0.8, g); st.rotation.x = (k % 2 ? 1 : -1) * 1.0; }
  return g; }
function sapling(x, z, h = 1, kind = 0) { return kind ? birch(x, z, h * 1.6) : spruce(x, z, h * 1.4); }

if (G4) {
  // Dressing plan (3A), 1927, 20 years on, the fallen forest about 10 km from the centre, a summer morning:
  //  foreground  the root plate of a fallen larch at the bottom left, a clump of fireweed at the bottom right
  //  hero zone   Leonid Kulik (beard, cap, long coat, pack, walking stick) leading along the trail he has cut
  //  midground   two helpers with packs (one carries the theodolite tripod), dozens of bleached fallen trunks lying the
  //              same way (root plates to the left, tops to the right), sawn ends along the trail, young larch and
  //              birch regrowth, fireweed, a boggy pool, a few broken standing snags
  //  background  the same fallen forest over the low hills, a far ridge of standing taiga, summer clouds
  //  atmosphere  a mosquito swarm, birds, regrowth and fireweed moving in the breeze, drifting clouds, a butterfly
  window.SHOT_SIZE = 'wide';
  sky('day', 50, 220); sun.position.set(-10, 15, 9); sun.intensity = 2.9; hemi.intensity = 1.3; fill.intensity = 0.45; shadowBox(22, 90); renderer.toneMappingExposure = 1.1;
  const hf = (x, z) => 0.12 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 2.5 * sm(-30, -80, z) * (1 + Math.sin(x * 0.04));
  terrain(260, 170, hf, tex('#7E9A4E', ['#6B8A42', '#93A85A', '#A89A5A', '#5E7A3E', '#B8A86A', '#8A7A5A'], 7000, { rep: 28 }));
  { const tr = mesh(new THREE.PlaneGeometry(1.5, 30), M('#A08A68', { map: tex('#A08A68', ['#8A7458', '#B49C78', '#6B8A42', '#C9B48A'], 2500, { rep: 3, r: [1, 4], a: [0.5, 0.9] }) }), 0, 0.02, -8); tr.rotation.x = -Math.PI / 2; tr.castShadow = false; }
  // fallen trunks both sides of the trail: root plates to the left (towards the centre), tops to the right; sawn where the trail crosses
  let n = 0; for (let z = 4.5; z > -26; z -= 0.9 + rnd() * 1.4) { n++; const len = 5 + rnd() * 7, x0 = -len * (0.2 + rnd() * 0.7) - 1.5 - rnd() * 2, r = 0.1 + rnd() * 0.12;
    if (x0 + len > -0.7) { trunk('fallen trunk (sawn)', x0, z, len, r, { sawnAt: -1.0, ry: (rnd() - 0.5) * 0.12 }); const x1 = 1.1; if (x0 + len > 1.8) trunk('fallen trunk top (sawn)', x1, z, 0, r * 0.8, { sawnAt: null, plate: false }).children[0].geometry = new THREE.CylinderGeometry(r * 0.3, r * 0.8, x0 + len - x1, 7).translate(0, 0, 0); }
    else trunk('fallen trunk', x0, z, len, r, { ry: (rnd() - 0.5) * 0.35 });
    if (n % 2) trunk("fallen trunk", 2.2 + rnd() * 3, z - 0.5 + rnd() * 0.3, 4 + rnd() * 6, 0.1 + rnd() * 0.08, { ry: (rnd() - 0.5) * 0.35 }); }
  // fix up the cut tops: position the right-hand pieces so the sawn face looks back at the trail
  world.children.filter((o) => o.name === 'fallen trunk top (sawn)').forEach((g) => { const m = g.children[0]; const L = m.geometry.parameters.height; m.position.set(L / 2, m.position.y, 0); m.rotation.z = -Math.PI / 2; const c = mesh(new THREE.CircleGeometry(m.geometry.parameters.radiusBottom, 7), M(SAW), -0.005, m.position.y, 0, g); c.rotation.y = -Math.PI / 2; });
  // far fallen forest on the hills (instanced, all pointing the same way) and the standing ridge beyond
  for (let s = 0; s < 6; s++) { const list = []; for (let i = 0; i < 500; i++) { const x = -60 + (s + rnd()) * 20, z = -28 - rnd() * 50; list.push([x, z, 2.6 + rnd() * 1.6, Math.PI / 2 + (rnd() - 0.5) * 0.3]); }
    const g = new THREE.Group(); world.add(g); g.name = `fallen forest on the hills ${s + 1}`; g.userData.prop = true; fallen(list, g); }
  for (let s = 0; s < 5; s++) { const list = []; for (let i = 0; i < 260; i++) { const x = -90 + (s + rnd()) * 36, z = -80 - rnd() * 40; list.push([x, z, 9 + rnd() * 5, rnd() * 6]); }
    const g = new THREE.Group(); world.add(g); g.name = `standing taiga ridge ${s + 1}`; g.userData.prop = true; forest(list, g); }
  { const list = []; for (let i = 0; i < 40; i++) { const x = -30 + rnd() * 60, z = -12 - rnd() * 30; if (Math.abs(x) < 2) continue; list.push([x, z, 4 + rnd() * 4, rnd() * 6]); } const g = new THREE.Group(); world.add(g); g.name = 'broken snags'; g.userData.prop = true; poles(list, g); }
  // regrowth, fireweed, a boggy pool
  for (const [x, z, h, k] of [[-2.6, 1.2, 1.1, 0], [2.4, -2.5, 1.3, 1], [-3.4, -5.6, 1.6, 1], [3.2, -7.5, 1.2, 0], [-2.2, -10.5, 1.5, 0], [2.6, -12.5, 1.8, 1], [-4.5, -2.5, 1.0, 0], [4.6, 0.8, 1.2, 1]]) sapling(x, z, h, k);
  for (const [x, z, k] of [[-1.7, 3.2, 9], [1.8, 2.4, 8], [-2.0, -1.6, 7], [1.9, -4.2, 9], [-1.8, -7.8, 7], [2.2, -9.6, 8], [3.8, -4.8, 6], [-3.6, 0.0, 6]]) fireweed(x, z, k, 1.2);
  { const p = prop('boggy pool', 4.6, -3.2, 0.3, 0.04); const m = mesh(new THREE.CircleGeometry(1.2, 9), M('#5D8CA0', { roughness: 0.2 }), 0, 0, 0, p); m.rotation.x = -Math.PI / 2; m.scale.set(1.4, 0.7, 1); m.castShadow = false; }
  tussocks(-10, 10, -22, 8, 2000, [], undefined, (x) => Math.abs(x) < 0.95);
  // foreground: a big root plate and fireweed
  { const g = prop('root plate of a fallen larch', -2.0, 5.4, 0.25); const pl = mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.4, 9), M('#6B5640'), 0, 1.0, 0, g); pl.rotation.z = Math.PI / 2; for (let k = 0; k < 8; k++) { const rt = mesh(new THREE.CylinderGeometry(0.03, 0.07, 1.4, 4), M('#5E4A3A'), -0.15, 1.0 + Math.cos(k * 0.8) * 0.9, Math.sin(k * 0.8) * 0.9, g); rt.rotation.x = k * 0.8; }
    const tk = mesh(new THREE.CylinderGeometry(0.2, 0.32, 6, 7), M(BLEACH), 3.0, 0.55, 0, g); tk.rotation.z = -Math.PI / 2 + 0.08; }
  fireweed(1.9, 5.6, 12, 1.0);
  // the expedition
  const K = kulik(); const kGo = walker(K, [[0.1, -5.6], [-0.05, -1.6], [0.1, 3.0]], 0.0, 0.92);
  const h1 = helper({ top: '#5E6B4E', h: 1.7 }); const h1Go = walker(h1, [[0.05, -8.4], [-0.05, -4.4], [0.1, 0.2]], 0.0, 0.95);
  const tri = new THREE.Group(); h1.userData.arms[1].userData.hand.add(tri); for (let k = 0; k < 3; k++) { const l = mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 4), M('#A8703F'), 0.03 * (k - 1), 0.4, 0.05, tri); l.rotation.x = 0.15 * (k - 1); } mesh(box(0.14, 0.1, 0.1), M('#B08D57', { metalness: 0.4 }), 0, 1.05, 0.05, tri);
  const h2 = helper({ top: '#8E7458', h: 1.66, pack: '#5E6B4E', roll: '#C9A57A' }); const h2Go = walker(h2, [[0.0, -11.0], [0.05, -7.0], [0.0, -2.4]], 0.0, 0.95);
  const axe2 = new THREE.Group(); h2.userData.arms[1].userData.hand.add(axe2); mesh(box(0.04, 0.6, 0.04), M('#A8703F'), 0, -0.1, 0.12, axe2).rotation.x = 1.0; mesh(box(0.02, 0.1, 0.16), M('#6E7072', { metalness: 0.5 }), 0, 0.12, 0.38, axe2);
  // atmosphere
  const mos = []; for (let i = 0; i < 40; i++) { const m = mesh(new THREE.IcosahedronGeometry(0.012, 0), M('#2B2B2B'), 0, 0, 0); m.castShadow = false; mos.push([m, rnd() * 6.28, rnd()]); }
  const bfly = new THREE.Group(); world.add(bfly); const wl = mesh(box(0.08, 0.005, 0.06), M('#F2B53A'), -0.04, 0, 0, bfly), wr = mesh(box(0.08, 0.005, 0.06), M('#F2B53A'), 0.04, 0, 0, bfly);
  const bd = birds(4, { x0: -16, x1: 16, y: 10, z: -16, speed: 2.4, s: 1.1 });
  camera.position.set(1.7, 3.3, 8.6); camera.lookAt(0, 1.0, -5); camera.fov = 58; camera.far = 500; camera.updateProjectionMatrix();
  { const cl = []; for (let i = 0; i < 22; i++) cl.push([-1.1 + (i * 0.43) % 2.2 + rnd() * 0.2, 0.01 + (i / 22) * 0.2, 1.0 + rnd() * 0.6]); for (let i = 0; i < 60; i++) cl.push([-1.1 + rnd() * 2.2, rnd() * 0.24, 0.22 + rnd() * 0.2]); cloudsInView(cl); }
  const sway = world.children.filter((o) => o.name === 'birch' || o.name === 'spruce' || o.name === 'fireweed');
  atmo('mosquito swarm'); atmo('birds'); atmo('regrowth in the breeze'); atmo('butterfly');
  update = (t, u, e) => { kGo(t); h1Go(t); h2Go(t); bd(t);
    K.userData.hd.rotation.y = 0.25 * Math.sin(t * 0.7); K.userData.hd.rotation.x = 0.1; h1.userData.arms[1].rotation.x = -0.4; h2.userData.hd.rotation.y = -0.3 * Math.sin(t * 0.5 + 1);
    sway.forEach((o, k) => { o.rotation.z = 0.04 * Math.sin(t * 1.6 + k); o.rotation.x = 0.03 * Math.sin(t * 1.3 + k * 2); });
    const kp = K.position; mos.forEach(([m, a, r]) => m.position.set(kp.x + 0.5 * Math.cos(a + t * (2 + r)) + 0.2, 1.9 + 0.3 * Math.sin(t * 3 + a * 2), kp.z + 0.5 * Math.sin(a * 1.3 + t * (2.5 + r))));
    bfly.position.set(1.4 + 0.8 * Math.sin(t * 0.8), 0.8 + 0.25 * Math.sin(t * 3.1), 1.0 + 0.6 * Math.cos(t * 0.6)); wl.rotation.z = 0.9 * Math.sin(t * 22); wr.rotation.z = -wl.rotation.z;
    camera.position.set(mix(1.7, 1.6, e), mix(3.3, 3.2, e), mix(8.6, 9.2, e)); camera.lookAt(0, 1.0, mix(-5, -3.6, e)); camera.fov = 58; camera.updateProjectionMatrix(); };
  overlay = (t) => card('All Pointing\nOut', { y: 0.2, size: 0.056, alpha: sm(0.2, 0.5, t) });
}

if (G5) {
  // Dressing plan (3A), the centre of the blast, 1927: the "telegraph pole" forest, a summer afternoon:
  //  foreground  a broken snag and a mossy log at the left edge, fireweed at the bottom right
  //  hero zone   Kulik with his pack and stick, head tipped back, looking up at a bare trunk; his notebook in his hand
  //  midground   bare upright trunks stripped of branches all round, young larch and birch regrowth, fireweed, moss
  //              hummocks, a helper photographing with a plate camera on a tripod, a packed bundle, a theodolite
  //  background  more standing bare trunks fading into the distance, the low hills, summer clouds
  //  atmosphere  birds circling over the poles, a butterfly, regrowth and fireweed moving, drifting clouds
  sky('day', 40, 200); sun.position.set(-12, 16, 10); sun.intensity = 3.0; hemi.intensity = 1.4; fill.intensity = 0.5; shadowBox(18, 80); renderer.toneMappingExposure = 1.2;
  const hf = (x, z) => 0.12 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 2 * sm(-35, -90, z);
  terrain(240, 160, hf, tex('#7E9A4E', ['#6B8A42', '#93A85A', '#A89A5A', '#5E7A3E', '#B8A86A'], 7000, { rep: 28 }));
  // the bare trunks: near ones as named props, far ones instanced
  const near = [[0.7, -0.9, 13], [-1.9, -3.2, 12], [2.6, -4.0, 14], [-3.4, -1.2, 11], [3.6, -1.6, 12.5], [-0.8, -6.5, 13.5], [1.4, -8.5, 12], [-3.2, -9.0, 13], [4.8, -7.0, 12], [-5.4, -5.0, 12.5], [-2.6, 2.4, 10.5]];
  near.forEach(([x, z, h], k) => { const g = prop('bare upright trunk', x, z, rnd() * 6, Hy(x, z)); poles([[0, 0, h, 0]], g); g.children[0].position.y = 0; g.rotation.z = (rnd() - 0.5) * 0.04; });
  { const list = []; for (let i = 0; i < 600; i++) { const a = rnd() * 6.28, r = 9 + rnd() * 60; list.push([Math.cos(a) * r, Math.sin(a) * r - 6, 10 + rnd() * 5, rnd() * 6]); } for (let s = 0; s < 6; s++) { const g = new THREE.Group(); world.add(g); g.name = `bare trunks beyond ${s + 1}`; g.userData.prop = true; poles(list.slice(s * 100, s * 100 + 100), g); } }
  for (const [x, z, s] of [[-50, -140, 34], [10, -150, 40], [65, -135, 32]]) { const p = prop('low hill', x, z); const m = mesh(new THREE.ConeGeometry(s, s * 0.4, 8), M('#8A9EB4'), 0, Hy(x, z) + s * 0.12, 0, p); m.castShadow = false; }
  for (const [x, z, h, k] of [[-1.4, 0.4, 1.2, 1], [1.8, 0.0, 1.0, 0], [-2.6, -2.2, 1.5, 0], [2.2, -2.6, 1.4, 1], [-0.4, -3.8, 1.3, 1], [3.4, -5.4, 1.6, 0], [-2.8, -6.0, 1.4, 1], [0.9, -5.0, 1.1, 0]]) sapling(x, z, h, k);
  for (const [x, z, k] of [[-0.9, 1.4, 8], [1.3, 1.9, 7], [-2.3, -0.6, 8], [2.9, -2.0, 7], [0.2, -2.6, 6], [-1.5, -4.6, 7]]) fireweed(x, z, k, 0.9);
  for (const [x, z] of [[-1.2, 2.2], [1.9, 2.4], [-3.0, 1.0], [3.0, 0.8]]) { const g = prop('moss hummock', x, z); const m = mesh(blob(0.4, 0, 0.2), M('#6B8A42'), 0, 0.1, 0, g); m.scale.y = 0.45; }
  tussocks(-9, 9, -14, 6, 1400, [[0, 0.9, 0.5]]);
  // the helper photographing with a plate camera
  const ph = helper({ top: '#8E7458', h: 1.68 }); ph.position.set(2.0, 0, -2.2); ph.rotation.y = -0.6;
  const tripod = prop('plate camera on a tripod', 1.45, -1.6, -0.6); for (let k = 0; k < 3; k++) { const l = mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 4), M('#A8703F'), Math.cos(k * 2.1) * 0.18, 0.62, Math.sin(k * 2.1) * 0.18, tripod); l.rotation.set(Math.sin(k * 2.1) * 0.25, 0, -Math.cos(k * 2.1) * 0.25); }
  mesh(box(0.26, 0.24, 0.3), M('#5E4330'), 0, 1.32, 0, tripod); mesh(box(0.18, 0.16, 0.16), M('#2B2420'), 0, 1.32, 0.22, tripod); mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), M('#B08D57', { metalness: 0.5 }), 0, 1.32, 0.33, tripod).rotation.x = Math.PI / 2;
  { const g = prop('packed bundle and theodolite', -1.0, 1.3, 0.4); mesh(box(0.6, 0.35, 0.4), M('#7A6A4E'), 0, 0.18, 0, g); mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8), M('#5E6B4E'), 0, 0.45, 0, g).rotation.z = Math.PI / 2; mesh(box(0.25, 0.25, 0.2), M('#8E5A3A'), 0.5, 0.12, 0.2, g); }
  // foreground
  { const g = prop('broken snag', -1.3, 3.5); mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.0, 7), M(DEAD), 0, 1.5, 0, g); const tp = mesh(new THREE.ConeGeometry(0.17, 0.5, 5), M('#8E7E6A'), 0.05, 3.2, 0, g); tp.rotation.z = 0.4; }
  { const g = prop('mossy log', -0.6, 3.9, 0.3); const l = mesh(new THREE.CylinderGeometry(0.17, 0.2, 2.2, 7), M('#8E7E6A'), 0, 0.17, 0, g); l.rotation.z = Math.PI / 2; mesh(blob(0.2, 0, 0.2), M('#6B8A42'), 0.3, 0.33, 0, g).scale.y = 0.4; }
  fireweed(1.25, 3.6, 8, 0.7);
  { const g = prop('larch sapling, near', -0.35, 2.9); mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 5), M(BARK), 0, 0.45, 0, g); for (let k = 0; k < 3; k++) mesh(new THREE.ConeGeometry(0.28 - k * 0.07, 0.35, 7), M(k % 2 ? LARCH : '#7DBA4E'), 0, 0.45 + k * 0.2, 0, g); }
  // the hero: Kulik looks up the trunk
  const K = kulik(); K.position.set(0.35, 0, 0.5); K.rotation.y = 0.4;
  const note = new THREE.Group(); K.userData.arms[0].userData.hand.add(note); mesh(box(0.12, 0.16, 0.02), M('#F3E6C8'), 0, -0.02, 0.05, note);
  const bd = birds(5, { x0: -10, x1: 10, y: 15, z: -4, speed: 2.0, s: 1.2 });
  const bfly = new THREE.Group(); world.add(bfly); const wl = mesh(box(0.08, 0.005, 0.06), M('#E9E2D2'), -0.04, 0, 0, bfly), wr = mesh(box(0.08, 0.005, 0.06), M('#E9E2D2'), 0.04, 0, 0, bfly);
  camera.position.set(0.9, 0.95, 4.9); camera.lookAt(0.3, 2.5, -1); camera.fov = 54; camera.far = 500; camera.updateProjectionMatrix();
  { const cl = []; for (let i = 0; i < 22; i++) cl.push([-1.1 + (i * 0.43) % 2.2 + rnd() * 0.2, 0.01 + (i / 22) * 0.5, 1.0 + rnd() * 0.6]); for (let i = 0; i < 90; i++) cl.push([-1.1 + rnd() * 2.2, rnd() * 0.55, 0.22 + rnd() * 0.2]); cloudsInView(cl, { dep0: 260 }); }
  const sway = world.children.filter((o) => o.name === 'birch' || o.name === 'spruce' || o.name === 'fireweed');
  atmo('birds circling'); atmo('butterfly'); atmo('regrowth in the breeze'); atmo('clouds');
  update = (t, u, e) => { bd(t); standPose(K, t); standPose(ph, t + 1);
    const up = sm(0.2, 1.4, t); K.userData.hd.rotation.x = -1.0 * up; K.userData.hd.rotation.y = -0.15 * up + 0.1 * Math.sin(t * 0.4); K.userData.body.rotation.x = -0.14 * up;
    K.userData.arms[0].rotation.x = -0.9 + 0.1 * Math.sin(t); K.userData.arms[1].rotation.x = -0.2; K.rotation.y = mix(0.4, 0.15, sm(0.3, 2.5, t));
    ph.userData.body.rotation.x = 0.35; ph.userData.arms.forEach((a) => (a.rotation.x = -1.3)); ph.userData.hd.rotation.x = 0.3;
    sway.forEach((o, k) => { o.rotation.z = 0.04 * Math.sin(t * 1.6 + k); o.rotation.x = 0.03 * Math.sin(t * 1.3 + k * 2); });
    bfly.position.set(-0.8 + 0.9 * Math.sin(t * 0.7), 0.9 + 0.3 * Math.sin(t * 3.0), 1.8 + 0.5 * Math.cos(t * 0.5)); wl.rotation.z = 0.9 * Math.sin(t * 22); wr.rotation.z = -wl.rotation.z;
    camera.position.set(mix(0.9, 0.85, e), mix(0.95, 0.9, e), mix(4.9, 4.45, e)); camera.lookAt(0.3, mix(2.5, 2.8, e), -1); camera.fov = 54; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Still\nStanding', { y: 0.2, size: 0.058, alpha: sm(0.2, 0.5, t) });
}

run(update, overlay);
