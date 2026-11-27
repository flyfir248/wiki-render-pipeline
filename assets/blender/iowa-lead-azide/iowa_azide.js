// Iowa lead azide: "The Explosive Too Dangerous to Move". Trending Short, 27 Nov 2026, built on wbt_kit.js for SKILL.md v1.2.
// A reconstruction, not archival footage: the plant, bunkers, pit and farms are stylised; no real place is copied.
// Facts (Wikipedia "Iowa lead azide detonation", rev 1388319418, 27 Nov 2026; "Lead(II) azide"):
//   25 Nov 2026, 9:00 am CST, the US Army detonated about 9,500 lb (4,300 kg) of lead azide in 68 drums at the Iowa Army
//   Ammunition Plant near Middletown, Iowa. Lead azide is a primary explosive used to set off bigger charges. Stored since at
//   least the 1980s in earth-covered, concrete-lined magazines under an ethanol/water bath to keep it stable. March 2026:
//   surveillance found the bath had evaporated and the lead azide had recrystallised; crystals are sensitive to friction and
//   movement. A chemical neutralisation contract was cancelled in May 2026. Mitigation: 300 two-storey sand barriers, 19,000
//   cubic yards of lime, soaked soil, misters, blast aimed south/southwest. Two explosions; a grey/white plume drifted south
//   and southwest and was gone from sight within 6 minutes; a resident a mile away said windows rattled. No deaths or
//   injuries reported. About 300 EPA staff sampling soil, water and surfaces; results pending.
// Truth notes: nobody is shown near the pit at detonation (it was evacuated); the plume is shown drifting south; lead fallout
//   results are unknown, so the last shot shows sampling, not contamination. No politics on screen.
// Edit list (SKILL.md 14.5): the strongest image, the drums alone in the barrier ring with mist, opens the Short; then the
//   bunkers; the crystals; the pit being built; the blast from a farm a mile away; sampling.
// Colour meaning (fixed for the whole video): signal yellow = the lead azide drums; off-white = lime and crystals;
//   grey plume = the blast.
//
// ===================================================================== DRESSING PLANS (SKILL.md 3A), written first
// A01 hook, MEDIUM (+12 deg, 50 deg FOV, push-in 8%). Location/period: the blast pit, Iowa Army Ammunition Plant, 25 Nov
//   2026, morning, overcast-bright. Families: sandstone (barriers), signal yellow (drums), blue-grey (steel), off-white (lime).
//   Foreground: a sandbag stack, a coil of misting hose, a warning sign on a post.
//   Hero:       the drums of lead azide on a pallet in the centre of the pit (signal-yellow bands).
//   Midground:  stacked sand-barrier bags in rings, misting stands spraying, a lime pile, a hose run, cable reel,
//               a cone line, a walkway of boards, a second pallet of barrier bags.
//   Background: the outer barrier ring, an excavator, a pickup, a flagpole, bare trees, a water tower, the far fence.
//   Atmosphere: mist from the stands, a soldier walking out along the boards, flag moving, crows crossing.
// A02 the bunkers, WIDE (+30 deg, 58 deg FOV, orbit 8 deg). Location: magazine row at the plant, present day.
//   Foreground: chain-link fence with a warning sign, a fence post with a light.
//   Hero:       the earth-covered magazine with its concrete face and steel doors (centre).
//   Midground:  neighbouring magazines, a gravel road, a guard post, a patrol pickup, lightning-rod masts, a vent stack,
//               bollards, a forklift, a pallet stack.
//   Background: more mounds in rows, bare tree line, a water tower, grain bins of a farm, rolling fields, a barn.
//   Atmosphere: the pickup driving the road, crows, grass swaying.
// A03 crystals, CLOSE (+6 deg, 40 deg FOV, push-in 10%). Location: inside a magazine, March 2026 inspection.
//   Hero:       the open drum with white needle crystals growing over a dried tide-line.
//   Midground:  neighbouring drums on racks, a work lamp on a tripod, the inspector with a torch and clipboard.
//   Background: the concrete arch and the bright open doorway with the grass bank outside.
//   Atmosphere: dust drifting in the light from the door.
// A04 the pit, WIDE overhead (+42 deg, 56 deg FOV, slow push-in). Location: the pit under construction, Nov 2026.
//   Foreground: a stack of barrier bags, a parked pickup's bonnet.
//   Hero:       the drum pallet in the centre ring.
//   Midground:  rings of sand barriers, lime piles, an excavator moving, a dump truck driving, misting lines, workers
//               placing bags, a light tower, a water bowser, a generator.
//   Background: the plant road, magazines, fields, a farm, tree lines.
//   Atmosphere: dust behind the truck, workers moving, crows.
// A05 the blast, WIDE (+8 deg, 58 deg FOV, locked-off with a short shake at the boom). Location: a farmyard about a
//   mile away, 9:00 am. Foreground: a porch rail and a mailbox. Hero: the plume rising on the horizon. Midground: the
//   farmhouse with rattling windows, a barn, a silo, grain bins, a pickup, a tractor, a fence, cattle. Background:
//   stubble fields, tree lines, power poles, other farms. Atmosphere: the plume, birds lifting off, cattle turning.
// A06 sampling, MEDIUM (+10 deg, 50 deg FOV, push-in 8%). Location: a stubble field downwind, 26 Nov 2026.
//   Foreground: a sample cooler, survey flags.
//   Hero:       the EPA sampler kneeling with a scoop and a sample jar.
//   Midground:  a second sampler with a clipboard, a white van, more flags, an air-sampler stand, a fence, a field gate.
//   Background: a farm with barn and silo, a tree line, power poles, a grain elevator.
//   Atmosphere: grass and stubble moving, crows, a car on the far road.
import { renderer, THREE, SHOT, rnd, C, V, D, sm, mix, clamp, PAL, world, scene, sky, hemi, sun, fill, camera, grade, M, E, mesh, box, blob, canvasTex,
  person, walker, standPose, prop, orbit, card, run, hero, atmo } from './wbt_kit.js';

const S = SHOT;
window.SHOT_SIZE = { A01: 'medium', A02: 'wide', A03: 'close', A04: 'wide', A05: 'wide', A06: 'medium' }[S] || 'wide';
const DRUM = PAL.signal, LIME = PAL.offwhite, SAND = '#CDB07E', CAMO = '#7C7656';

// ---------------------------------------------------------------- shared ground textures
function texRows(base, line, n, rep, jit = 0.1) { const t = canvasTex(512, 512, (g) => { g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) { const c = C(base).multiplyScalar(0.78 + rnd() * 0.4); g.fillStyle = '#' + c.getHexString(); g.beginPath(); g.ellipse(rnd() * 512, rnd() * 512, 30 + rnd() * 70, 14 + rnd() * 40, rnd() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 2600; i++) { const c = C(base).multiplyScalar(0.7 + rnd() * 0.5); g.fillStyle = '#' + c.getHexString(); g.fillRect(rnd() * 512, rnd() * 512, 3 + rnd() * 9, 3 + rnd() * 6); }
  g.strokeStyle = line; g.lineWidth = 6; for (let k = 0; k < n; k++) { const y = (k + 0.5) * 512 / n; g.beginPath(); g.moveTo(0, y + (rnd() - 0.5) * 6); for (let x = 64; x <= 512; x += 64) g.lineTo(x, y + (rnd() - 0.5) * 10); g.stroke(); }
  g.fillStyle = 'rgba(60,45,30,0.55)'; for (let i = 0; i < 1400; i++) g.fillRect(rnd() * 512, rnd() * 512, 3, 8 + rnd() * 8);
  g.fillStyle = 'rgba(255,250,235,0.35)'; for (let i = 0; i < 900; i++) g.fillRect(rnd() * 512, rnd() * 512, 4, 3 + rnd() * 5); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 16; return t; }
function ground(tex, w = 220, d = 220, x = 0, z = 0, y = 0) { const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 })); g.rotation.x = -Math.PI / 2; g.position.set(x, y, z); g.receiveShadow = true; world.add(g); return g; }
const stubble = () => texRows('#C9A66B', 'rgba(120,90,50,0.55)', 14, 22);
const grass = () => texRows('#98A85C', 'rgba(70,90,40,0.25)', 6, 26);
const gravel = () => texRows('#A79C8C', 'rgba(90,84,76,0.35)', 3, 30);

// ---------------------------------------------------------------- props
const drumTex = canvasTex(512, 512, (g) => { g.fillStyle = '#7A8A98'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,46,54' : '200,210,220'},${0.15 + rnd() * 0.2})`; g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 3, 2 + rnd() * 3); }
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${rnd() < 0.6 ? '140,80,40' : '50,56,64'},0.55)`; const x = rnd() * 512, y = rnd() * 512; g.fillRect(x, y, 3 + rnd() * 5, 30 + rnd() * 100); g.beginPath(); g.arc(x, y, 4 + rnd() * 8, 0, 7); g.fill(); }
  g.fillStyle = PAL.offwhite; g.fillRect(300, 120, 140, 92); g.fillStyle = PAL.ink; for (let k = 0; k < 5; k++) g.fillRect(312, 134 + k * 15, 70 + rnd() * 40, 6); });
function drum(x, z, parent, o = {}) { const g = new THREE.Group(); g.position.set(x, 0, z); (parent || world).add(g);
  mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12, 1, !!o.open), M(o.col || '#FFFFFF', { map: drumTex, roughness: 0.5, metalness: 0.3, side: o.open ? THREE.DoubleSide : THREE.FrontSide }), 0, 0.44, 0, g);
  for (const y of [0.25, 0.63]) mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12), M(PAL.charcoal, { roughness: 0.5, metalness: 0.4 }), 0, y, 0, g);
  mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.14, 12), M(DRUM), 0, 0.44, 0, g);
  if (!o.open) mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 12), M('#5C6B78', { roughness: 0.5, metalness: 0.4 }), 0, 0.895, 0, g);
  return g; }
let _wood; const woodM = () => _wood ||= new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85, map: (() => { const t = canvasTex(256, 256, (g) => { g.fillStyle = PAL.wood; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) { g.fillStyle = 'rgba(60,36,20,0.75)'; g.fillRect(0, y, 256, 4); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '70,44,24' : '210,160,110'},0.35)`; g.fillRect(rnd() * 256, y + 4 + rnd() * 26, 20 + rnd() * 60, 2); } g.fillStyle = 'rgba(40,30,20,0.8)'; g.fillRect(20 + rnd() * 20, y + 14, 4, 4); g.fillRect(220 + rnd() * 10, y + 14, 4, 4); } }); return t; })() });
function pallet(x, z, ry = 0, name = 'drum pallet') { const g = prop(name, x, z, ry); mesh(box(1.3, 0.14, 1.3), woodM(), 0, 0.07, 0, g); return g; }
function drumPallet(x, z, ry = 0, name) { const g = pallet(x, z, ry, name); for (const [a, b] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) { const d = drum(a, b, g); d.position.y = 0.14; d.rotation.y = rnd() * 6; } return g; }
// sand barrier: a two-storey stack of bulk bags (each ~1.3 m), faceted
const bagMats = [SAND, '#C4A472'].map((base) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, map: canvasTex(256, 256, (g) => { g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '90,70,40' : '255,245,220'},${0.1 + rnd() * 0.2})`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 1 + rnd() * 2); }
  g.strokeStyle = 'rgba(80,62,40,0.6)'; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, 20 + k * 44 + rnd() * 8); g.bezierCurveTo(80, 30 + k * 44, 170, 10 + k * 44, 256, 24 + k * 44); g.stroke(); }
  g.fillStyle = 'rgba(240,232,210,0.9)'; g.fillRect(30, 0, 18, 256); g.fillRect(208, 0, 18, 256); g.fillStyle = 'rgba(60,50,40,0.5)'; g.fillRect(30, 0, 2, 256); g.fillRect(208, 0, 2, 256); }) }));
function barrier(x, z, ry = 0, tiers = 2, name = 'sand barrier') { const g = prop(name, x, z, ry);
  for (let k = 0; k < tiers; k++) { const b = mesh(box(1.25, 1.2, 1.25), bagMats[k % 2], 0, 0.6 + k * 1.22, 0, g); b.scale.set(1 + (rnd() - 0.5) * 0.08, 1, 1 + (rnd() - 0.5) * 0.08); b.rotation.y = (rnd() - 0.5) * 0.12;
    for (const sx of [-0.5, 0.5]) mesh(box(0.08, 0.2, 0.08), M('#E6D9B5'), sx, 1.25 + k * 1.22, 0.5, g); }
  return g; }
function ring(cx, cz, r, n, tiers, name, skip = () => false) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; if (skip(a)) continue; out.push(barrier(cx + Math.cos(a) * r, cz + Math.sin(a) * r, -a, tiers, name)); } return out; }
function limePile(x, z, s = 1) { const g = prop('lime pile', x, z, rnd() * 6); const m = mesh(blob(1.6 * s, 1, 0.18), M(LIME), 0, 0, 0, g); m.scale.set(1.2, 0.55, 1); return g; }
function mister(x, z, ry = 0) { const g = prop('misting stand', x, z, ry); mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6), M(PAL.charcoal), 0, 1.1, 0, g);
  const h = mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.35, 8), M(PAL.bluegrey, { roughness: 0.5, metalness: 0.4 }), 0, 2.3, 0.1, g); h.rotation.x = 1.1; for (const a of [0, 2.1, 4.2]) mesh(box(0.05, 0.05, 0.8), M(PAL.charcoal), Math.cos(a) * 0.35, 0.03, Math.sin(a) * 0.35, g).rotation.y = -a; return g; }
function sign(x, z, ry = 0, text = 'DANGER\nEXPLOSIVES', name = 'warning sign') { const g = prop(name, x, z, ry); mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), M(PAL.warmgrey), 0, 0.9, 0, g);
  const tex = canvasTex(256, 160, (c) => { c.fillStyle = PAL.offwhite; c.fillRect(0, 0, 256, 160); c.fillStyle = PAL.brick; c.fillRect(0, 0, 256, 50); c.fillStyle = PAL.offwhite; c.font = '800 36px Arial'; c.textAlign = 'center'; const [a, b] = text.split('\n'); c.fillText(a, 128, 38); c.fillStyle = PAL.ink; c.font = '800 34px Arial'; c.fillText(b || '', 128, 112); });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })); p.position.set(0, 1.6, 0.05); p.castShadow = true; g.add(p); return g; }
function bareTree(x, z, s = 1, name = 'bare tree') { const g = prop(name, x, z, rnd() * 6); g.scale.setScalar(s * (0.88 + rnd() * 0.24)); const bark = M('#5E4A3A');
  mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.4, 6), bark, 0, 1.7, 0, g);
  for (let k = 0; k < 6; k++) { const a = k * 1.05 + rnd() * 0.5, y = 2.4 + rnd() * 1.6; const b = mesh(new THREE.CylinderGeometry(0.04, 0.09, 2.0, 5), bark, Math.cos(a) * 0.5, y + 0.6, Math.sin(a) * 0.5, g); b.rotation.set(Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75); }
  const crown = mesh(blob(1.5, 1, 0.2), M('#8A7563', { transparent: true, opacity: 0.55 }), 0, 4.2, 0, g); crown.castShadow = false; crown.scale.y = 0.8; return g; }
function evergreen(x, z, s = 1) { const g = prop('cedar', x, z); g.scale.setScalar(s * (0.9 + rnd() * 0.2)); mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 5), M('#5E4A3A'), 0, 0.4, 0, g);
  for (let k = 0; k < 3; k++) mesh(new THREE.ConeGeometry(1.1 - k * 0.3, 1.5, 7), M(k % 2 ? PAL.forest : '#3B6B45'), 0, 1.2 + k * 0.85, 0, g); return g; }
function barn(x, z, ry = 0, s = 1, col = PAL.brick) { const g = prop('barn', x, z, ry); g.scale.setScalar(s);
  mesh(box(8, 5, 12), M(col), 0, 2.5, 0, g); const r = mesh(new THREE.CylinderGeometry(4.6, 4.6, 12.4, 4, 1), M(PAL.charcoal), 0, 5.0, 0, g); r.rotation.z = Math.PI / 2; r.rotation.y = Math.PI / 2; r.scale.set(1, 1, 0.55); r.rotation.set(Math.PI / 2, 0, Math.PI / 4); r.scale.set(0.8, 1, 0.55);
  mesh(box(3, 3.6, 0.1), M(PAL.offwhite), 0, 1.8, 6.03, g); mesh(box(2.8, 0.12, 0.12), M(PAL.offwhite), 0, 1.8, 6.1, g).rotation.z = 0.9; mesh(box(2.8, 0.12, 0.12), M(PAL.offwhite), 0, 1.8, 6.1, g).rotation.z = -0.9;
  mesh(box(1.4, 1.2, 0.1), M(PAL.cream), 0, 6.0, 6.03, g); return g; }
function silo(x, z, s = 1) { const g = prop('silo', x, z); g.scale.setScalar(s); mesh(new THREE.CylinderGeometry(1.6, 1.6, 12, 12), M('#C9C3B8'), 0, 6, 0, g); mesh(new THREE.SphereGeometry(1.62, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(PAL.bluegrey, { metalness: 0.4, roughness: 0.5 }), 0, 12, 0, g);
  for (let k = 1; k < 6; k++) mesh(new THREE.CylinderGeometry(1.63, 1.63, 0.1, 12), M('#9E978B'), 0, k * 2, 0, g); return g; }
function grainBin(x, z, s = 1) { const g = prop('grain bin', x, z); g.scale.setScalar(s); mesh(new THREE.CylinderGeometry(2.6, 2.6, 5, 16), M('#B9BEC4', { metalness: 0.5, roughness: 0.45 }), 0, 2.5, 0, g);
  mesh(new THREE.ConeGeometry(2.75, 1.6, 16), M('#A7ADB3', { metalness: 0.5, roughness: 0.45 }), 0, 5.8, 0, g); for (let k = 1; k < 5; k++) mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.06, 16), M('#8F969D'), 0, k, 0, g); return g; }
function farmhouse(x, z, ry = 0, s = 1) { const g = prop('farmhouse', x, z, ry); g.scale.setScalar(s); mesh(box(7, 5.6, 6), M(PAL.offwhite), 0, 2.8, 0, g);
  const r = mesh(new THREE.ConeGeometry(1, 1, 4), M(PAL.navy), 0, 6.6, 0, g); r.rotation.y = Math.PI / 4; r.scale.set(5.6, 2.2, 4.8);
  const wins = []; for (const [wx, wy] of [[-2, 1.6], [2, 1.6], [-2, 4.1], [2, 4.1], [0, 4.1]]) { const w = mesh(box(1.0, 1.3, 0.06), M('#BFD8F0', { roughness: 0.15 }), wx, wy, 3.03, g); wins.push(w); mesh(box(1.16, 1.46, 0.04), M(PAL.charcoal), wx, wy, 3.0, g); }
  mesh(box(1.1, 2.1, 0.06), M(PAL.wood), 0, 1.05, 3.03, g); mesh(box(7.6, 0.18, 2.2), M(PAL.warmgrey), 0, 2.9, 4.1, g); for (const px of [-3.5, -1.2, 1.2, 3.5]) mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.9, 6), M(PAL.offwhite), px, 1.45, 5.1, g);
  mesh(box(0.6, 1.6, 0.6), M(PAL.brick), 2.2, 7.4, -0.8, g); g.userData.wins = wins; return g; }
function waterTower(x, z, s = 1) { const g = prop('water tower', x, z); g.scale.setScalar(s); for (const a of [0.8, 2.4, 3.9, 5.5]) { const l = mesh(new THREE.CylinderGeometry(0.15, 0.2, 14, 5), M(PAL.bluegrey), Math.cos(a) * 2, 7, Math.sin(a) * 2, g); l.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1); }
  mesh(new THREE.SphereGeometry(3.2, 12, 8), M('#C9D2DA'), 0, 16, 0, g).scale.y = 0.8; return g; }
function pole(x, z) { const g = prop('power pole', x, z); mesh(new THREE.CylinderGeometry(0.11, 0.15, 9, 6), M('#6B4A2E'), 0, 4.5, 0, g); mesh(box(2.0, 0.12, 0.12), M('#6B4A2E'), 0, 8.4, 0, g); return g; }
function fence(x0, z0, x1, z1, name = 'fence') { const g = prop(name, x0, z0); const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2.5)), a = Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i <= n; i++) mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 5), M(PAL.wood), (x1 - x0) * i / n, 0.65, (z1 - z0) * i / n, g);
  for (const y of [0.5, 0.9, 1.2]) { const w = mesh(box(L, 0.02, 0.02), M(PAL.charcoal), (x1 - x0) / 2, y, (z1 - z0) / 2, g); w.rotation.y = -a; } return g; }
function chainFence(x0, z0, x1, z1) { const g = prop('chain-link fence', x0, z0); const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
  const tex = canvasTex(64, 64, (c) => { c.clearRect(0, 0, 64, 64); c.strokeStyle = 'rgba(120,128,136,0.9)'; c.lineWidth = 2; for (let k = -64; k < 128; k += 12) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 64, 64); c.stroke(); c.beginPath(); c.moveTo(k + 64, 0); c.lineTo(k, 64); c.stroke(); } }); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(L / 0.5, 4);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 })); p.position.set((x1 - x0) / 2, 1.1, (z1 - z0) / 2); p.rotation.y = -a; g.add(p);
  const n = Math.round(L / 3); for (let i = 0; i <= n; i++) mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), M('#9AA2AA', { metalness: 0.5, roughness: 0.5 }), (x1 - x0) * i / n, 1.25, (z1 - z0) * i / n, g); return g; }
function pickup(x, z, ry = 0, col = '#E8E4DA', name = 'pickup') { const g = prop(name, x, z, ry); mesh(box(1.9, 0.75, 5.2), M(col, { roughness: 0.5 }), 0, 0.75, 0, g); mesh(box(1.8, 0.75, 2.0), M(col, { roughness: 0.5 }), 0, 1.45, 0.6, g);
  mesh(box(1.82, 0.5, 1.6), M('#3A4B5C', { roughness: 0.2 }), 0, 1.5, 0.65, g); for (const [wx, wz] of [[-0.9, 1.6], [0.9, 1.6], [-0.9, -1.6], [0.9, -1.6]]) { const w = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), M(PAL.charcoal), wx, 0.4, wz, g); w.rotation.z = Math.PI / 2; } return g; }
const vanTex = canvasTex(512, 256, (g) => { g.fillStyle = PAL.offwhite; g.fillRect(0, 0, 512, 256); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(120,130,140,${0.05 + rnd() * 0.12})`; g.fillRect(rnd() * 512, rnd() * 256, 2 + rnd() * 3, 2); }
  g.fillStyle = 'rgba(80,90,100,0.7)'; for (const x of [120, 250, 380]) g.fillRect(x, 20, 3, 200); g.fillRect(0, 200, 512, 3); g.fillStyle = PAL.charcoal; for (const x of [140, 270, 400]) g.fillRect(x, 110, 30, 8); g.fillStyle = 'rgba(150,120,90,0.45)'; for (let i = 0; i < 60; i++) g.fillRect(rnd() * 512, 210 + rnd() * 46, 6 + rnd() * 20, 3 + rnd() * 6); });
function van(x, z, ry = 0) { const g = prop('white van', x, z, ry); mesh(box(2.0, 2.2, 5.4), new THREE.MeshStandardMaterial({ map: vanTex, roughness: 0.5, flatShading: true }), 0, 1.45, 0, g); mesh(box(1.9, 0.8, 0.06), M('#3A4B5C', { roughness: 0.2 }), 0, 1.9, 2.71, g);
  mesh(box(2.02, 0.25, 3.0), M(PAL.teal), 0, 1.2, -0.6, g); for (const [wx, wz] of [[-0.95, 1.7], [0.95, 1.7], [-0.95, -1.7], [0.95, -1.7]]) { const w = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), M(PAL.charcoal), wx, 0.38, wz, g); w.rotation.z = Math.PI / 2; } return g; }
function excavator(x, z, ry = 0) { const g = prop('excavator', x, z, ry); mesh(box(2.6, 0.8, 4.2), M(PAL.charcoal), 0, 0.4, 0, g); const top = new THREE.Group(); top.position.y = 0.9; g.add(top);
  mesh(box(2.6, 1.2, 3.0), M(PAL.golden), 0, 0.6, -0.3, top); mesh(box(1.1, 1.3, 1.2), M('#3A4B5C', { roughness: 0.2 }), -0.7, 1.6, 0.6, top);
  const arm = new THREE.Group(); arm.position.set(0.6, 1.0, 1.2); top.add(arm); const a1 = mesh(box(0.35, 0.35, 3.6), M(PAL.golden), 0, 0.9, 1.6, arm); a1.rotation.x = -0.5; const a2 = mesh(box(0.3, 0.3, 2.6), M(PAL.golden), 0, 1.2, 4.0, arm); a2.rotation.x = 0.9; mesh(box(0.9, 0.7, 0.7), M(PAL.charcoal), 0, 0.2, 4.7, arm);
  g.userData.top = top; return g; }
function dumpTruck(x, z, ry = 0) { const g = prop('dump truck', x, z, ry); mesh(box(2.4, 1.6, 2.2), M(PAL.brick), 0, 1.5, 2.6, g); mesh(box(2.5, 1.5, 4.4), M(PAL.warmgrey), 0, 1.75, -0.8, g); mesh(box(2.2, 0.4, 4.0), M(SAND), 0, 2.6, -0.8, g);
  for (const [wx, wz] of [[-1.1, 2.6], [1.1, 2.6], [-1.1, -0.4], [1.1, -0.4], [-1.1, -1.8], [1.1, -1.8]]) { const w = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), M(PAL.charcoal), wx, 0.5, wz, g); w.rotation.z = Math.PI / 2; } return g; }
function lightTower(x, z) { const g = prop('light tower', x, z); mesh(box(1.4, 1.0, 2.4), M(PAL.golden), 0, 0.7, 0, g); mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 6), M(PAL.charcoal), 0, 4, 0, g);
  for (const dx of [-0.5, 0.5]) mesh(box(0.5, 0.4, 0.2), M(PAL.offwhite, { emissive: C('#FFF1DC'), emissiveIntensity: 0.3 }), dx, 7, 0, g); return g; }
function generator(x, z, ry = 0) { const g = prop('generator', x, z, ry); mesh(box(1.4, 1.1, 2.4), M(PAL.leaf), 0, 0.75, 0, g); mesh(box(1.5, 0.15, 2.5), M(PAL.charcoal), 0, 0.12, 0, g); return g; }
function bowser(x, z, ry = 0) { const g = prop('water bowser', x, z, ry); const t = mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12), M(PAL.teal), 0, 1.3, 0, g); t.rotation.x = Math.PI / 2;
  for (const dz of [-0.9, 0.9]) for (const dx of [-0.9, 0.9]) { const w = mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 10), M(PAL.charcoal), dx, 0.38, dz, g); w.rotation.z = Math.PI / 2; } return g; }
function cone(x, z) { const g = prop('traffic cone', x, z); mesh(new THREE.ConeGeometry(0.18, 0.7, 8), M(PAL.amber), 0, 0.35, 0, g); mesh(box(0.4, 0.04, 0.4), M(PAL.charcoal), 0, 0.02, 0, g); return g; }
function hardhat(p, col = PAL.offwhite) { const u = p.userData, h = u.h / 6.5; mesh(new THREE.SphereGeometry(h * 0.58, 8, 5, 0, Math.PI * 2, 0, 1.45), M(col), 0, h * 0.12, 0, u.hd); mesh(new THREE.CylinderGeometry(h * 0.66, h * 0.66, h * 0.04, 10), M(col), 0, h * 0.12, h * 0.05, u.hd); }
function cow(x, z, ry = 0, col = '#3B2A20') { const g = prop('cow', x, z, ry); const b = mesh(box(0.7, 0.75, 1.6), M(col), 0, 1.0, 0, g); mesh(box(0.72, 0.3, 0.5), M(PAL.offwhite), 0, 1.15, 0.2, g);
  const hd = mesh(box(0.38, 0.42, 0.55), M(col), 0, 1.15, 1.0, g); mesh(box(0.3, 0.2, 0.15), M('#F1C9A5'), 0, 1.0, 1.28, g); for (const [lx, lz] of [[-0.25, 0.6], [0.25, 0.6], [-0.25, -0.6], [0.25, -0.6]]) mesh(box(0.14, 0.62, 0.14), M(col), lx, 0.31, lz, g);
  g.userData.head = hd; return g; }
let _conc; const concM = () => _conc ||= new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, map: (() => { const t = canvasTex(256, 128, (g) => { g.fillStyle = '#C9C3B8'; g.fillRect(0, 0, 256, 128); for (let y = 0; y < 128; y += 16) { g.fillStyle = `rgba(90,84,76,${0.25 + rnd() * 0.2})`; g.fillRect(0, y, 256, 2); }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(110,100,86,0.3)'; g.fillRect(rnd() * 256, rnd() * 64, 3, 30 + rnd() * 50); } g.fillStyle = PAL.ink; g.fillRect(20, 14, 40, 22); g.fillStyle = PAL.offwhite; g.font = '700 16px Arial'; g.fillText(String(10 + Math.floor(rnd() * 80)), 24, 31); }); return t; })() });
function mound(x, z, ry = 0, s = 1, name = 'earth-covered magazine') { const g = prop(name, x, z, ry); g.scale.setScalar(s);
  const m = mesh(new THREE.CylinderGeometry(4.2, 4.2, 14, 12), M('#5F7F3E'), 0, 0, 0, g); m.rotation.x = Math.PI / 2; m.scale.set(1.1, 1, 0.9);
  mesh(box(9.6, 4.6, 0.7), concM(), 0, 2.3, 7.1, g); mesh(box(3.0, 2.6, 0.12), M(PAL.bluegrey, { metalness: 0.5, roughness: 0.5 }), 0, 1.3, 7.5, g); mesh(box(0.06, 2.6, 0.14), M(PAL.charcoal), 0, 1.3, 7.56, g);
  for (const sx of [-1, 1]) { const w = mesh(box(0.7, 3.4, 3.6), M('#BDB6AA'), sx * 5.0, 1.7, 8.6, g); w.rotation.y = sx * 0.35; }
  mesh(box(5, 0.08, 3.5), M('#B0A69A'), 0, 0.04, 9.2, g); mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.4, 8), M(PAL.warmgrey), 0, 4.4, -2, g); return g; }
function mast(x, z) { const g = prop('lightning mast', x, z); mesh(new THREE.CylinderGeometry(0.06, 0.12, 12, 5), M('#9AA2AA', { metalness: 0.5 }), 0, 6, 0, g); return g; }
function hayBales(x, z, ry = 0) { const g = prop('round bales', x, z, ry); for (const dx of [-1, 0.6, 2.2]) { const b = mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 10), M('#D8B868'), dx, 0.8, 0, g); b.rotation.z = Math.PI / 2; } return g; }
function tractor(x, z, ry = 0) { const g = prop('tractor', x, z, ry); mesh(box(1.3, 1.1, 2.6), M(PAL.forest), 0, 1.2, 0, g); mesh(box(1.2, 1.2, 1.2), M('#3A4B5C', { roughness: 0.2 }), 0, 2.3, -0.6, g);
  for (const [wx, wz, r] of [[-0.85, -0.8, 0.8], [0.85, -0.8, 0.8], [-0.75, 1.0, 0.45], [0.75, 1.0, 0.45]]) { const w = mesh(new THREE.CylinderGeometry(r, r, 0.4, 12), M(PAL.charcoal), wx, r, wz, g); w.rotation.z = Math.PI / 2; } return g; }
function mailbox(x, z, ry = 0) { const g = prop('mailbox', x, z, ry); mesh(box(0.1, 1.1, 0.1), M(PAL.wood), 0, 0.55, 0, g); mesh(box(0.3, 0.3, 0.55), M(PAL.charcoal), 0, 1.2, 0, g); mesh(box(0.04, 0.2, 0.06), M(PAL.brick), 0.17, 1.35, -0.1, g); return g; }
function elevator(x, z, s = 1) { const g = prop('grain elevator', x, z); g.scale.setScalar(s); for (const dx of [-3, 0, 3]) mesh(new THREE.CylinderGeometry(1.5, 1.5, 18, 10), M('#D6D0C4'), dx, 9, 0, g); mesh(box(4, 6, 4), M('#C9C3B8'), 0, 21, 0, g); return g; }

// ---------------------------------------------------------------- shared moving systems
// crows: faceted birds flapping along a line
function crows(n, from, to, t0, dur, y0) { const flock = []; for (let i = 0; i < n; i++) { const g = new THREE.Group(); world.add(g); const bm = M('#22252B');
  mesh(box(0.12, 0.1, 0.36), bm, 0, 0, 0, g); const w = [-1, 1].map((s) => { const p = new THREE.Group(); g.add(p); const m = mesh(box(0.4, 0.02, 0.18), bm, s * 0.2, 0, 0, p); return p; }); flock.push({ g, w, o: V((rnd() - 0.5) * 4, (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 4), ph: rnd() * 6 }); }
  atmo('crows'); return (t) => flock.forEach((b, i) => { const u = clamp((t - t0 - i * 0.12) / dur); b.g.position.lerpVectors(from, to, u).add(b.o); b.g.position.y += y0 * 0 + Math.sin(t * 2 + b.ph) * 0.2; b.g.lookAt(to.clone().add(b.o)); b.w.forEach((p, k) => (p.rotation.z = (k ? 1 : -1) * Math.sin(t * 14 + b.ph) * 0.6)); }); }
// mist: instanced faceted droplets drifting up from a set of nozzles
function mist(nozzles, n = 260, spread = 1.4, col = '#F6F1E7') { const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshStandardMaterial({ color: C(col), transparent: true, opacity: 0.45, roughness: 1, depthWrite: false }), n); im.castShadow = false; world.add(im);
  const seeds = Array.from({ length: n }, () => [Math.floor(rnd() * nozzles.length), rnd(), rnd() * 6, rnd()]); const o = new THREE.Object3D(); atmo('mist');
  return (t) => { seeds.forEach(([k, ph, a, r], i) => { const u = (t * 0.35 + ph) % 1, [x, y, z] = nozzles[k]; o.position.set(x + Math.cos(a) * u * spread * (0.4 + r), y + u * 1.4 - u * u * 1.2, z + Math.sin(a) * u * spread * (0.4 + r)); o.scale.setScalar(0.6 + u * 2.4); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.instanceMatrix.needsUpdate = true; }; }
// dust motes floating in a light shaft
function motes(box3, n = 160) { const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.012, 0), E('#FFF1DC', 1.2), n); world.add(im); const s = Array.from({ length: n }, () => [rnd(), rnd(), rnd(), rnd() * 6]); const o = new THREE.Object3D(); atmo('dust in the light');
  return (t) => { s.forEach(([a, b, c, p], i) => { o.position.set(mix(box3[0], box3[3], a) + 0.1 * Math.sin(t * 0.7 + p), mix(box3[1], box3[4], (b + t * 0.02) % 1), mix(box3[2], box3[5], c) + 0.1 * Math.cos(t * 0.5 + p)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.instanceMatrix.needsUpdate = true; }; }
// the blast plume: faceted puffs that grow, rise and drift south (+x on screen right)
function plume(x, z, s = 1, tBoom = 1.2) { const g = prop('blast plume', x, z); const puffs = []; for (let i = 0; i < 46; i++) { const m = mesh(blob(1, 1, 0.2), new THREE.MeshStandardMaterial({ color: C(i % 3 ? '#B9B4AC' : '#D9D2C5'), flatShading: true, roughness: 1, transparent: true, opacity: 0.95 }), 0, 0, 0, g); m.castShadow = false; puffs.push({ m, a: rnd() * 6, r: rnd(), h: rnd(), k: i / 46 }); }
  const flash = mesh(new THREE.IcosahedronGeometry(1, 1), E('#FFE2A8', 1.4), 0, 1, 0, g); flash.castShadow = false; atmo('blast plume');
  const upd = (t) => { const T = t - tBoom; const T2 = t - tBoom - 0.9; flash.visible = (T > 0 && T < 0.35) || (T2 > 0 && T2 < 0.3); flash.scale.setScalar(s * (3 + 10 * clamp(T > 0.35 ? T2 / 0.3 : T / 0.35)));
    puffs.forEach((p) => { const age = T - p.k * 0.6; p.m.visible = age > 0; if (age <= 0) return; const grow = 1 - Math.exp(-age * 1.3), hgt = (p.h * 0.5 + 0.5) * 34 * s * grow, rad = (2 + p.r * 6) * s * grow;
      p.m.position.set(Math.cos(p.a) * rad + age * 1.6 * s * (p.h + 0.3), hgt, Math.sin(p.a) * rad * 0.6); p.m.scale.setScalar(s * (2 + 5 * grow * (0.6 + p.h))); }); };
  g.userData.upd = upd; return g; }
function litter(at, n, d0, d1, col = '#C9A66B') { const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.03, 1, 5), M(col), n); im.receiveShadow = true; world.add(im); const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { const d = mix(d0, d1, Math.sqrt(rnd())), [x, z] = at(d, (rnd() - 0.5) * 2.4); const up = rnd() < 0.15; o.position.set(x, up ? 0.12 : 0.03, z); o.rotation.set(up ? 0 : Math.PI / 2, rnd() * 6, up ? (rnd() - 0.5) * 0.4 : 0); o.scale.set(1, up ? 0.25 : 0.3 + rnd() * 0.5, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    im.setColorAt(i, C(col).multiplyScalar(0.7 + rnd() * 0.45)); } }
function stubbleField(x, z, w, d) { const g = prop('corn stubble rows', x, z); const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.015, 0.02, 0.25, 4), M('#B89558'), 1); world.remove(im); return g; }

// ---------------------------------------------------------------- shots
// aim(cam, tgt) gives at(d, f): a ground point d metres from the camera along the view, f = -1..1 across the 9:16 width
const HW = Math.tan(D(29)) * 0.5625 * 0.85;  // half-width per metre at ~58 deg vertical FOV, kept inside the safe area
function aim(cam, tgt) { const u = V(tgt.x - cam.x, 0, tgt.z - cam.z).normalize(), r = V(-u.z, 0, u.x); return (d, f = 0) => [cam.x + u.x * d + r.x * f * HW * d, cam.z + u.z * d + r.z * f * HW * d]; }
const arc = (r, a0, a1, step = 10) => { const out = []; for (let a = a0; a0 < a1 ? a <= a1 : a >= a1; a += (a0 < a1 ? step : -step)) out.push([Math.cos(D(a)) * r, Math.sin(D(a)) * r]); return out; };
function clouds(n, cx, cz, spread, y) { for (let i = 0; i < n; i++) { const c = mesh(blob(1, 1, 0.25), M('#FFFFFF', { roughness: 1 }), cx + (rnd() - 0.5) * spread, y + rnd() * y * 0.3, cz + (rnd() - 0.5) * spread * 0.3); c.scale.set(18 + rnd() * 20, 5 + rnd() * 3, 9); c.castShadow = false; } }
function skyFill(at, camY, pitch, n, d0, d1, a0 = 2, a1 = 26) { for (let i = 0; i < n; i++) { const d = mix(d0, d1, rnd()), [x, z] = at(d, (rnd() - 0.5) * 2.6), a = D(pitch + mix(a0, a1, (i + rnd()) / n));
    const c = mesh(blob(1, 1, 0.3), M(rnd() < 0.3 ? '#E9EEF2' : '#FFFFFF', { roughness: 1 }), x, camY + d * Math.tan(a), z); c.scale.set(d * (0.06 + rnd() * 0.08), d * (0.018 + rnd() * 0.014), d * 0.05); c.castShadow = false; } }
function wideLight() { hemi.intensity = 1.05; fill.intensity = 0.28; sun.intensity = 3.0; renderer.toneMappingExposure = 1.0; }
let update = () => {}, overlay = () => {};
const sweep = [];
camera.near = 0.1; camera.far = S === 'A05' ? 3000 : 700; camera.updateProjectionMatrix();

if (S === 'A01' || S === 'A04') {
  sky('day', 80, 420);
  ground(texRows(S === 'A04' ? '#A88F66' : '#B8A27A', 'rgba(110,90,60,0.5)', 10, 30), 60, 60);
  ground(stubble(), 900, 900, 0, 0, -0.02);
  const hub = drumPallet(0, 0, 0.2, 'drum pallet'); hero(hub);
  drumPallet(1.6, -1.1, 0.6, 'second drum pallet');
  const GAP = D(50);
  ring(0, 0, 6.5, 18, 2, 'inner barrier', (a) => S === 'A01' && Math.abs(a - GAP) < 0.4);
  ring(0, 0, 13, 30, 2, 'outer barrier', (a) => S === 'A04' && Math.abs(a - 4.0) < 0.2);
  for (const [x, z, s] of [[-9, 4, 1], [8.5, -6, 0.9], [-4, -9.5, 0.8], [9.5, 6, 1.1], [-10, -5, 0.9]]) limePile(x, z, s);
  const nozz = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; const x = Math.cos(a) * 4.2, z = Math.sin(a) * 4.2; mister(x, z, -a + Math.PI / 2); nozz.push([x * 0.95, 2.3, z * 0.95]); }
  sweep.push(mist(nozz, 320, 1.8));
  { const g = new THREE.Group(); world.add(g); const pts = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push(V(Math.cos(a) * 4.6, 0.06, Math.sin(a) * 4.6)); } const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 80, 0.05, 5, true), M(PAL.charcoal)); tube.castShadow = true; g.add(tube); }
  { const g = prop('cable reel', -3.4, 2.2, 0.4); const r = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10), M(PAL.wood), 0, 0.55, 0, g); r.rotation.z = Math.PI / 2; }
  for (const [x, z] of [[10.0, -1.6], [11.2, -1.4], [12.4, -1.2]]) cone(x, z);
  sign(10.8, 3.2, -0.9, 'DANGER\nEXPLOSIVES');
  { const g = prop('bag pallet', -3.2, 3.6, 0.5); mesh(box(1.2, 0.12, 1.2), M(PAL.wood), 0, 0.06, 0, g); mesh(box(1.0, 0.9, 1.0), M(SAND), 0, 0.6, 0, g); }
  for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2 + rnd() * 0.1; bareTree(Math.cos(a) * (46 + rnd() * 8), Math.sin(a) * (46 + rnd() * 8), 1.5); }
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; pole(Math.cos(a) * 36, Math.sin(a) * 36); }
  if (S === 'A01') {
    const CAM = V(3.64, 2.19, 3.68), at = aim(CAM, V(0.3, 0.7, -0.3)); skyFill(at, 2.4, -3, 14, 120, 300, 4, 30);
        { const [x, z] = at(2.3, 0.45); const g = prop('sandbag stack', x, z, 0.3); for (let k = 0; k < 6; k++) mesh(box(0.6, 0.22, 0.35), M(k % 2 ? SAND : '#BFA06E'), (k % 3) * 0.62 - 0.6, 0.12 + Math.floor(k / 3) * 0.23, 0, g); }
    { const [x, z] = at(2.6, -0.8); const g = prop('hose coil', x, z); for (let k = 0; k < 4; k++) { const tr = mesh(new THREE.TorusGeometry(0.35 + k * 0.04, 0.035, 4, 14), M(PAL.charcoal), 0, 0.04 + k * 0.05, 0, g); tr.rotation.x = Math.PI / 2; } }
    { const [x, z] = at(8.5, 0.75); sign(x, z, D(30), 'DANGER\nNO ENTRY', 'gap sign'); }
    { const [x, z] = at(28, 0.45); excavator(x, z, 0.9); } { const [x, z] = at(32, -0.5); pickup(x, z, 1.2, '#E8E4DA', 'army pickup'); }
    { const [x, z] = at(26, -0.15); lightTower(x, z); } { const [x, z] = at(30, 0.1); generator(x, z, 0.3); } { const [x, z] = at(70, 0.3); waterTower(x, z, 1.1); }
    { const [x, z] = at(36, 0.75); const g = prop('flagpole', x, z); mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 6), M(PAL.offwhite), 0, 4.5, 0, g); const f = mesh(box(1.8, 1.0, 0.02), M(PAL.navy), 0.95, 8.3, 0, g); f.castShadow = false; atmo('flag'); sweep.push((t) => (f.rotation.y = 0.25 * Math.sin(t * 3))); }
    for (const [d, f] of [[90, -0.6], [100, 0.2], [110, 0.7]]) { const [x, z] = at(d, f); mound(x, z, 0.8, 0.9, 'magazine (far)'); }
    { const [x, z] = at(120, -0.3); grainBin(x, z, 1.3); } { const [x, z] = at(130, 0.5); barn(x, z, -0.4, 1.1); }
    const sol = person({ height: 1.78, skin: PAL.skin[2], hair: PAL.hair[0], top: CAMO, bottom: CAMO, shoes: '#3B2A20' }); hardhat(sol, '#6E6A4E');
    const w = walker(sol, arc(2.95, 205, 290, 8), 0, 0.55);
    sweep.push(crows(5, V(-40, 14, -30), V(30, 18, -40), 0.4, 6, 0));
    update = (t, u, e) => { sweep.forEach((f) => f(t)); w(t); orbit(V(0.3, 0.7, -0.3), D(40), D(16), mix(5.4, 5.0, e)); camera.fov = 52; camera.updateProjectionMatrix(); };
    overlay = (t) => card('Iowa, 25 Nov 2026', { y: 0.2, size: 0.046, alpha: 1 - sm(5.6, 6.2, t) });
  } else {
    const CAM = V(18.2, 24.6, 31.6), at = aim(CAM, V(0, 0, 0)); wideLight(); hemi.intensity = 0.8; fill.intensity = 0.15; sun.intensity = 3.6;
    const ex = excavator(-15, 8, 2.2); const dt = dumpTruck(0, 0, 0);
    lightTower(-15, -9); generator(-17, -12, 0.3); bowser(16, -10, -0.3);
    const ws = [[60, 100, 0], [265, 300, 1], [-15, 15, 2], [180, 195, 3]].map(([a0, a1, k]) => { const p = person({ height: 1.75, skin: PAL.skin[(k * 2) % 6], hair: PAL.hair[k % 6], top: CAMO, bottom: CAMO }); hardhat(p, '#6E6A4E'); return walker(p, arc(9.6, a0, a1, 5), 0, 0.45); });
    for (const [d, f] of [[19, -0.6], [20, 0.35]]) { const [x, z] = at(d, f); const g = prop('bag pallet (near)', x, z, 0.4); mesh(box(1.2, 0.12, 1.2), M(PAL.wood), 0, 0.06, 0, g); mesh(box(1.0, 0.9, 1.0), M(SAND), 0, 0.6, 0, g); }
    { const [x, z] = at(15, 0.1); const g = prop('bag stack', x, z, 0.2); for (let k = 0; k < 3; k++) mesh(box(1.2, 1.2, 1.2), M(SAND), k * 1.3 - 1.3, 0.6, 0, g); }
    { const [x, z] = at(23, 0.75); pickup(x, z, -0.3, PAL.bluegrey, 'parked pickup'); }
    for (const [d, f] of [[140, -0.7], [150, -0.1], [160, 0.5], [175, 0.9]]) { const [x, z] = at(d, f); mound(x, z, 0.6, 1, 'magazine (far)'); }
    { const [x, z] = at(170, 0.2); waterTower(x, z, 1.4); } { const [x, z] = at(190, 0.65); barn(x, z, 0.3, 1.3); } { const [x, z] = at(185, -0.6); grainBin(x, z, 1.6); } { const [x, z] = at(260, 0.1); elevator(x, z, 2); }
    sweep.push(crows(6, V(-40, 18, 0), V(40, 22, -20), 0.3, 6.5, 0));
    const dust = mist([[0, 0.3, 0]], 120, 2.5, '#D8C6A0'); const dustIM = world.children[world.children.length - 1]; atmo('truck dust');
    update = (t, u, e) => { sweep.forEach((f) => f(t)); ws.forEach((f) => f(t)); dt.position.set(mix(-30, 4, t / 7), 0, mix(19, 20, t / 7)); dt.rotation.y = Math.PI / 2 + 0.05; dust(t); dustIM.position.set(dt.position.x - 4, 0, dt.position.z);
      ex.userData.top.rotation.y = 0.5 * Math.sin(t * 0.6);
      orbit(V(0, 0, 0), D(30), D(34), mix(46, 42, e)); camera.fov = 56; camera.updateProjectionMatrix(); };
    overlay = (t) => card('300 Sand Barriers', { y: 0.2, size: 0.05, alpha: 1 });
  }
}

if (S === 'A02') {
  sky('day', 90, 520); ground(grass(), 120, 260); ground(stubble(), 1000, 1000, 0, 0, -0.03);
  const CAM = V(7, 13, 36), TGT = V(0, 2.0, -2), at = aim(CAM, TGT); wideLight(); skyFill(at, 13, -13, 44, 150, 420, 1, 32); fill.intensity = 0.18; hemi.intensity = 0.95;
  { const g = prop('gravel road', 0, 14); const r = new THREE.Mesh(new THREE.PlaneGeometry(200, 6), new THREE.MeshStandardMaterial({ map: gravel(), roughness: 0.95 })); r.rotation.x = -Math.PI / 2; r.position.set(0, 0.02, 0); r.receiveShadow = true; g.add(r); }
  const hm = mound(0, 0, 0, 1, 'magazine'); hero(hm);
  for (const [x, z] of [[-13, -34], [13, -34], [0, -68], [-13, -102], [13, -102]]) mound(x, z, 0, 1, 'magazine');
  chainFence(-14, 22, 14, 22); sign(-4, 22.3, 0, 'DANGER\nEXPLOSIVES', 'fence sign'); sign(8, 22.3, 0, 'RESTRICTED\nAREA', 'fence sign 2');
  { const g = prop('gate post light', 3.5, 24); mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), M(PAL.charcoal), 0, 1.6, 0, g); mesh(box(0.4, 0.25, 0.3), M(PAL.offwhite, { emissive: C('#FFF1DC'), emissiveIntensity: 0.25 }), 0, 3.25, 0, g); }
  { const g = prop('guard post', 10, 18, -0.3); mesh(box(2.4, 2.6, 2.4), M(PAL.cream), 0, 1.3, 0, g); mesh(box(2.8, 0.2, 2.8), M(PAL.navy), 0, 2.7, 0, g); mesh(box(1.6, 0.8, 0.06), M('#BFD8F0', { roughness: 0.15 }), 0, 1.7, 1.22, g); }
  for (const [x, z] of [[-6, -6], [6, -6]]) mast(x, z); for (const x of [-7.5, 7.5]) { const g = prop('jersey barrier', x, 11.2); mesh(box(3, 0.8, 0.6), M('#C9C3B8'), 0, 0.4, 0, g); } { const g = prop('vent stack', 0, -18); mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.4, 8), M(PAL.warmgrey), 0, 5.2, 0, g); }
  for (const x of [-2.2, 2.2]) { const g = prop('bollard', x, 10.6); mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.0, 8), M(PAL.golden), 0, 0.5, 0, g); }
  { const g = prop('forklift', -7, 9, 0.6); mesh(box(1.2, 1.2, 2.2), M(PAL.amber), 0, 0.9, 0, g); mesh(box(1.1, 0.06, 1.2), M(PAL.charcoal), 0, 0.2, 1.6, g); mesh(box(0.1, 2.4, 0.1), M(PAL.charcoal), -0.4, 1.4, 1.1, g); mesh(box(0.1, 2.4, 0.1), M(PAL.charcoal), 0.4, 1.4, 1.1, g); }
  { const g = prop('pallet stack', -9.5, 8, 0.3); for (let k = 0; k < 4; k++) mesh(box(1.2, 0.14, 1.2), M(PAL.wood), 0, 0.07 + k * 0.16, 0, g); }
  const pu = pickup(0, 0, 0, PAL.offwhite, 'patrol pickup');
  for (let i = 0; i < 12; i++) { const [x, z] = at(130 + rnd() * 30, -1 + i / 5.5); bareTree(x, z, 1.8); }
  for (let i = 0; i < 4; i++) { const [x, z] = at(125, -0.9 + i * 0.6); evergreen(x, z, 2.4); }
  { const [x, z] = at(170, 0.6); waterTower(x, z, 1.4); } { const [x, z] = at(190, -0.5); grainBin(x, z, 1.4); } { const [x, z] = at(200, -0.2); barn(x, z, 0.4, 1.3); } { const [x, z] = at(210, 0.2); silo(x, z, 1.1); }
  for (let i = 0; i < 4; i++) { const [x, z] = at(140, -0.8 + i * 0.55); pole(x, z); }
  sweep.push(crows(7, V(-50, 20, -60), V(50, 26, -40), 0.2, 6.5, 0));
  const tuftN = 700, grassTufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.08, 0.5, 3), M('#6E8A44'), tuftN); world.add(grassTufts); atmo('grass swaying'); const tufts = Array.from({ length: tuftN }, () => [(rnd() - 0.5) * 40, 32 - rnd() * 60, rnd() * 6]).filter(([x, z]) => Math.abs(z - 14) > 3.5 && !(Math.abs(x) < 8 && z > -8 && z < 12)); const o = new THREE.Object3D();
  update = (t, u, e) => { sweep.forEach((f) => f(t)); tufts.forEach(([x, z, p], i) => { o.position.set(x, 0.2, z); o.rotation.set(0.15 * Math.sin(t * 2 + p + x * 0.2), 0, 0); o.updateMatrix(); grassTufts.setMatrixAt(i, o.matrix); }); grassTufts.count = tufts.length; grassTufts.instanceMatrix.needsUpdate = true;
    pu.position.set(mix(-30, 18, t / 7), 0, 14.2); pu.rotation.y = Math.PI / 2;
    camera.position.copy(CAM).lerp(TGT, 0.08 * e); camera.lookAt(TGT); camera.fov = 56; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Stored Since\nthe 1980s', { y: 0.2, size: 0.048, alpha: 1 });
}

if (S === 'A03') {
  scene.background = C('#3A3631'); scene.fog = new THREE.Fog(C('#D9D2C5'), 30, 80);
  const conc = texRows('#BDB6AA', 'rgba(80,74,66,0.6)', 10, 1); conc.repeat.set(10, 8);
  { const ft = canvasTex(1024, 1024, (g) => { g.fillStyle = '#9C8A70'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 40; i++) { const c = C('#9C8A70').multiplyScalar(0.85 + rnd() * 0.25); g.fillStyle = '#' + c.getHexString(); g.beginPath(); g.ellipse(rnd() * 1024, rnd() * 1024, 60 + rnd() * 120, 30 + rnd() * 60, rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 9000; i++) { const c = C('#9C8A70').multiplyScalar(0.6 + rnd() * 0.6); g.fillStyle = '#' + c.getHexString(); g.fillRect(rnd() * 1024, rnd() * 1024, 2 + rnd() * 4, 2 + rnd() * 4); }
    g.strokeStyle = 'rgba(60,50,40,0.85)'; g.lineWidth = 5; for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * 512, 0); g.lineTo(k * 512, 1024); g.stroke(); g.beginPath(); g.moveTo(0, k * 512); g.lineTo(1024, k * 512); g.stroke(); }
    g.strokeStyle = 'rgba(70,60,50,0.6)'; g.lineWidth = 2; for (let i = 0; i < 25; i++) { let x = rnd() * 1024, y = rnd() * 1024; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(90,70,50,0.3)'; g.beginPath(); g.ellipse(rnd() * 1024, rnd() * 1024, 30 + rnd() * 60, 15 + rnd() * 30, rnd() * 3, 0, 7); g.fill(); } });
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(8, 16); ft.anisotropy = 16; ground(ft, 20, 40, 0, 0); }
  for (const x of [-1.55, 1.55]) { const st = mesh(box(0.12, 0.012, 30), M(PAL.amber), x, 0.006, -2); st.receiveShadow = true; for (let k = 0; k < 30; k++) mesh(box(0.13, 0.014, 0.25), M(PAL.charcoal), x, 0.007, -16 + k * 1.0); }
  { const g = new THREE.Group(); world.add(g); const pts = [V(1.0, 0.03, -1.2), V(0.2, 0.03, 0.0), V(-0.2, 0.03, 0.4), V(0.6, 0.03, 2.0), V(1.1, 0.03, 3.6)]; const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.025, 5), M(PAL.golden)); g.add(tube); }
  { const g = prop('concrete arch', 0, -14); const a = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 14, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ map: conc, side: THREE.BackSide, flatShading: true, roughness: 0.9 })); a.rotation.set(Math.PI / 2, 0, 0); a.position.set(0, 0, 12); g.add(a); a.receiveShadow = true;
    for (let k = -5; k < 6; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(3.95, 0.08, 4, 16, Math.PI), M('#9E978B')); rib.position.set(0, 0, k * 2.6 + 12); g.add(rib); } }
  { const g = prop('open doorway', 0, 12); mesh(box(9, 5, 0.4), M('#C9C3B8'), 0, 2.5, 0, g); const hole = mesh(box(2.8, 2.6, 0.5), E('#EFF3E4', 1.05), 0, 1.3, 0, g); hole.castShadow = false; mesh(new THREE.PlaneGeometry(2.8, 0.9), E('#9BB06A', 1.0), 0, 0.45, 0.3, g); }
  const key = new THREE.SpotLight(C('#FFE2B8'), 105, 40, 0.55, 0.6, 1.2); key.position.set(0, 2.4, 11.5); key.target.position.set(-0.6, 0.5, 0); key.castShadow = true; scene.add(key, key.target);
  sun.intensity = 0.0; hemi.intensity = 1.3; hemi.color.set('#EADCC4'); hemi.groundColor.set('#8C847A'); fill.intensity = 0.5; fill.position.set(-3, 5, -4);
  for (const z of [-6, -4.2, -2.4, -0.6, 3.2, 5.0, 6.8]) for (const x of [-2.4, 2.4]) { if (Math.abs(z - 1) < 2 && x < 0) continue; const g = prop('drum on rack', x, z); mesh(box(1.0, 0.2, 1.4), woodM(), 0, 0.1, 0, g); const d = drum(0, 0, g); d.position.y = 0.2; d.rotation.y = rnd() * 6; }
  const hd = prop('open drum', -0.9, 1.0, 0.3); hero(hd); { const d = drum(0, 0, hd, { open: true }); d.position.y = 0.2; mesh(box(1.0, 0.2, 1.0), woodM(), 0, 0.1, 0, hd);
    mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), M('#7A6A58'), 0, 0.92, 0, hd); mesh(new THREE.TorusGeometry(0.283, 0.014, 4, 18), M('#D9C9A8'), 0, 1.0, 0, hd).rotation.x = Math.PI / 2; }
  { const lid = prop('drum lid', -0.2, 1.6, 0.4); mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 12), M('#5C6B78', { roughness: 0.5, metalness: 0.4 }), 0, 0.015, 0, lid); }
  const xtals = []; for (let i = 0; i < 90; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 0.24; const m = mesh(new THREE.ConeGeometry(0.014 + rnd() * 0.012, 0.14 + rnd() * 0.14, 4), M('#F6F1E7', { roughness: 0.25, emissive: C('#FFF8EA'), emissiveIntensity: 0.2 }), Math.cos(a) * r, 0.93, Math.sin(a) * r, hd); m.geometry.translate(0, 0.07, 0); m.scale.x = 1.4; m.rotation.set((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2); m.userData.k = rnd(); m.castShadow = false; xtals.push(m); }
  for (let i = 0; i < 36; i++) { const a = i / 36 * 6.28; const m = mesh(new THREE.ConeGeometry(0.012, 0.12, 4), M('#F6F1E7', { roughness: 0.25 }), Math.cos(a) * 0.27, 1.08, Math.sin(a) * 0.27, hd); m.geometry.translate(0, 0.06, 0); m.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8); m.userData.k = rnd(); xtals.push(m); }
  { const g = prop('inspection case', -1.75, 2.4, 0.4); mesh(box(0.55, 0.22, 0.38), M(PAL.brick), 0, 0.11, 0, g); mesh(box(0.2, 0.04, 0.04), M(PAL.charcoal), 0, 0.24, 0, g); }
  const lamp = prop('work lamp', 0.6, -0.8, -0.6); mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), M(PAL.charcoal), 0, 0.8, 0, lamp); mesh(box(0.35, 0.25, 0.15), M(PAL.golden), 0, 1.65, 0, lamp); const lt = new THREE.PointLight(C('#FFE2B8'), 8, 6, 1.5); lt.position.set(0.5, 1.7, -0.6); scene.add(lt);
  const insp = person({ height: 1.72, skin: PAL.skin[1], hair: PAL.hair[2], top: '#C7BFA9', bottom: PAL.navy }); insp.position.set(1.3, 0, 4.3); insp.rotation.y = Math.PI + 0.55; hardhat(insp, PAL.offwhite);
  { const tor = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.22, 6), M(PAL.charcoal), 0, -0.05, 0.08, insp.userData.arms[1].userData.hand); tor.rotation.x = Math.PI / 2; mesh(box(0.22, 0.3, 0.02), M(PAL.offwhite), 0, -0.05, 0.05, insp.userData.arms[0].userData.hand); }
  const beam = new THREE.SpotLight(C('#FFF8EA'), 25, 6, 0.25, 0.4, 1.5); scene.add(beam, beam.target);
  sweep.push(motes([-1.5, 0.3, -2, 1.5, 2.6, 11], 240));
  update = (t, u, e) => { sweep.forEach((f) => f(t)); standPose(insp, t); insp.userData.arms[1].rotation.x = -1.0 + 0.1 * Math.sin(t * 0.8); insp.userData.arms[0].rotation.x = -0.7; insp.userData.hd.rotation.x = 0.35;
    const hand = new THREE.Vector3(); insp.userData.arms[1].userData.hand.getWorldPosition(hand); beam.position.copy(hand); beam.target.position.set(-0.9 + 0.1 * Math.sin(t * 0.9), 0.95, 1.0);
    const g = sm(0.2, 6.2, t); xtals.forEach((m) => m.scale.set(1, Math.max(0.001, clamp(g * 1.6 - m.userData.k * 0.6)), 1));
    orbit(V(-0.75, 1.0, 1.1), D(-160), D(34), mix(2.6, 2.3, e)); camera.fov = 46; camera.updateProjectionMatrix(); };
  overlay = (t) => card('The Liquid\nDried Up', { y: 0.2, size: 0.05, alpha: sm(0.5, 0.9, t) });
}

if (S === 'A05') {
  sky('day', 200, 2400); ground(stubble(), 4000, 4000);
  const CAM = V(0, 3.2, 40), TGT = V(6, 9, -200), at = aim(CAM, TGT); wideLight(); skyFill(at, 3.2, 1.5, 40, 300, 1400, 2, 28); skyFill(at, 3.2, 0, 14, 700, 1500, 1, 6);
  { const g = prop('farmyard gravel', 0, 10); const tt = texRows('#A79C8C', 'rgba(70,64,56,0.55)', 2, 10); const r = new THREE.Mesh(new THREE.PlaneGeometry(26, 34), new THREE.MeshStandardMaterial({ map: tt, roughness: 0.95 })); r.rotation.x = -Math.PI / 2; r.position.y = 0.01; r.receiveShadow = true; g.add(r); }
  const pl = plume(90, -700, 6, -0.15); sweep.push(pl.userData.upd);
  const fh = farmhouse(-6, 0, 0.35, 1); hero(fh);
  barn(10, -20, -0.3, 1); silo(18, -30, 1); grainBin(4, -30, 1); grainBin(-3, -36, 0.9); pickup(3, 12, 0.8, PAL.brick, 'farm pickup'); tractor(8, -4, -0.6); hayBales(-14, -16, 0.3);
  fence(-12, 22, 12, 22, 'yard fence'); fence(-60, -50, 60, -50, 'field fence');
  const cows = [[6, 3, 0.5], [9, 6, 2.0], [3.5, 5, -1], [11, 1, 3]].map(([x, z, r], k) => cow(x, z, r, k % 2 ? '#3B2A20' : '#6B4A2E'));
  for (let i = 0; i < 10; i++) bareTree(-140 + i * 30 + rnd() * 10, -170 - rnd() * 30, 2.6);
  for (let i = 0; i < 6; i++) pole(-50 + i * 20, -70);
  barn(-60, -260, 0.3, 1.6, '#9E5444'); grainBin(-40, -270, 1.8); farmhouse(70, -280, -0.3, 1.8); elevator(-20, -480, 2.4); for (let i = 0; i < 8; i++) bareTree(-200 + i * 60, -420, 3);
  { const g = prop('porch rail', -3.5, 31, 0.1); for (let k = 0; k < 6; k++) mesh(box(0.12, 1.0, 0.12), M(PAL.offwhite), k * 0.6, 0.5, 0, g); mesh(box(3.4, 0.12, 0.14), M(PAL.offwhite), 1.5, 1.0, 0, g); }
  mailbox(4.2, 30, -0.3); litter(at, 600, 14, 40); litter(at, 700, 4, 16, '#7A736A');
  { const g = prop('fuel tank', -9, 16, 0.3); const tk = mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 10), M(PAL.offwhite), 0, 1.6, 0, g); tk.rotation.z = Math.PI / 2; for (const x of [-0.8, 0.8]) mesh(box(0.12, 1.0, 0.9), M(PAL.charcoal), x, 0.5, 0, g); }
  { const g = prop('tyre stack', 7.5, 17); for (let k = 0; k < 3; k++) { const t = mesh(new THREE.TorusGeometry(0.4, 0.16, 5, 10), M(PAL.charcoal), 0, 0.16 + k * 0.3, 0, g); t.rotation.x = Math.PI / 2; } }
  { const g = prop('puddle', -2, 19); const p = mesh(new THREE.CircleGeometry(1.2, 9), M('#9DB7C9', { roughness: 0.1 }), 0, 0.03, 0, g); p.rotation.x = -Math.PI / 2; p.scale.set(1.6, 0.8, 1); }
  { const g = prop('dog house', -10, 8, 0.6); mesh(box(1.0, 0.8, 1.2), M(PAL.wood), 0, 0.4, 0, g); const r = mesh(new THREE.ConeGeometry(0.85, 0.5, 4), M(PAL.brick), 0, 1.05, 0, g); r.rotation.y = Math.PI / 4; }
  { const g = prop('wheelbarrow', 1.2, 21, 0.8); mesh(box(0.7, 0.35, 1.0), M(PAL.leaf), 0, 0.55, 0, g); const w = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8), M(PAL.charcoal), 0, 0.2, 0.55, g); w.rotation.z = Math.PI / 2; }
  sweep.push(crows(9, V(4, 3, -12), V(-40, 40, -120), 1.6, 4.5, 0));
  update = (t, u, e) => { sweep.forEach((f) => f(t));
    // sound reaches a farm about 1.6 km away ~4.7 s after the flash: the windows and the camera shake then
    const snd = t - 4.6; const sh = snd > 0 && snd < 0.6 ? (1 - snd / 0.6) : 0; fh.userData.wins.forEach((w, k) => (w.rotation.z = sh * 0.04 * Math.sin(t * 80 + k)));
    cows.forEach((c, k) => { c.userData.head.rotation.y = sm(1.4 + k * 0.2, 2.2 + k * 0.2, t) * -0.6; });
    camera.position.copy(CAM).add(V(sh * 0.04 * Math.sin(t * 60), sh * 0.03 * Math.sin(t * 47), 0)); camera.lookAt(TGT); camera.fov = 58; camera.updateProjectionMatrix(); };
  overlay = (t) => card('9:00 AM', { y: 0.2, size: 0.056, alpha: sm(0.2, 0.6, t) });
}

if (S === 'A06') {
  sky('day', 90, 600); ground(stubble(), 1200, 1200);
  const CAM = V(1.5, 1.55, 4.3), at = aim(CAM, V(0, 1.15, 0)); wideLight(); skyFill(at, 1.55, -5, 40, 120, 400, 1, 30); skyFill(at, 1.55, -5, 12, 300, 600, 0.5, 6);
  const smp = person({ height: 1.74, skin: PAL.skin[3], hair: PAL.hair[0], top: PAL.offwhite, bottom: PAL.offwhite, shoes: PAL.teal }); hero(smp); smp.rotation.y = 0.55; { const g = prop('sample bucket and trowel', -0.55, 0.45); mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 8), M(PAL.offwhite), 0, 0.15, 0, g); const tr = mesh(box(0.06, 0.02, 0.3), M(PAL.bluegrey, { metalness: 0.6, roughness: 0.4 }), 0.2, 0.03, 0.1, g); tr.rotation.y = 0.6; } hardhat(smp, PAL.teal);
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), M('#DCEBF2', { roughness: 0.1, transparent: true, opacity: 0.85 }), 0, -0.06, 0.03, smp.userData.arms[0].userData.hand);
  mesh(box(0.05, 0.03, 0.22), M(PAL.bluegrey, { metalness: 0.6, roughness: 0.4 }), 0, -0.05, 0.1, smp.userData.arms[1].userData.hand);
  const two = person({ height: 1.66, skin: PAL.skin[1], hair: PAL.hair[3], top: PAL.offwhite, bottom: PAL.offwhite, longHair: true, shoes: PAL.teal }); hardhat(two, PAL.teal); { const [x, z] = at(7.0, 0.55); two.position.set(x, 0, z); } two.rotation.y = 0.2;
  mesh(box(0.22, 0.3, 0.02), M(PAL.paper), 0, -0.05, 0.05, two.userData.arms[0].userData.hand);
  { const [x, z] = at(3.0, 0.8); const g = prop('sample cooler', x, z, 0.3); mesh(box(0.5, 0.35, 0.35), M(PAL.teal), 0, 0.2, 0, g); mesh(box(0.52, 0.06, 0.37), M(PAL.offwhite), 0, 0.37, 0, g); }
  for (const [d, f] of [[2.8, -0.75], [5.2, -0.5], [6.2, 0.2], [8.5, -0.3], [9.5, 0.75], [11.5, 0.1]]) { const [x, z] = at(d, f); const g = prop('survey flag', x, z); mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4), M(PAL.charcoal), 0, 0.4, 0, g); const fl = mesh(box(0.18, 0.12, 0.005), M(PAL.amber), 0.09, 0.74, 0, g); fl.castShadow = false; sweep.push((t) => (fl.rotation.y = 0.4 * Math.sin(t * 4 + x))); }
  atmo('flags flutter');
  { const [x, z] = at(13, -0.85); van(x, z, 1.9); } { const [x, z] = at(8, 0.9); const g = prop('air sampler', x, z); mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), M(PAL.charcoal), 0, 0.75, 0, g); mesh(box(0.4, 0.5, 0.3), M(PAL.offwhite), 0, 1.5, 0, g); mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), M(PAL.charcoal), 0, 1.8, 0, g); }
  { const [x, z] = at(18, 0); fence(x - 14, z + 4, x + 14, z - 4, 'field fence'); } { const [x, z] = at(17, 0.7); const g = prop('field gate', x, z, 0.3); mesh(box(4, 0.08, 0.06), M(PAL.warmgrey), 0, 1.0, 0, g); mesh(box(4, 0.08, 0.06), M(PAL.warmgrey), 0, 0.5, 0, g); }
  { const [x, z] = at(22, -0.6); hayBales(x, z, 0.2); } { const [x, z] = at(26, 0.6); pickup(x, z, -0.4, PAL.brick, 'farm pickup'); }
  { const [x, z] = at(70, -0.5); barn(x, z, 0.3, 1.1); } { const [x, z] = at(75, -0.15); silo(x, z, 1); } { const [x, z] = at(68, 0.35); grainBin(x, z, 1.1); } { const [x, z] = at(80, 0.8); farmhouse(x, z, -0.4, 1); }
  for (let i = 0; i < 8; i++) { const [x, z] = at(100 + rnd() * 10, -1 + i * 0.28); bareTree(x, z, 1.8); } for (let i = 0; i < 4; i++) { const [x, z] = at(50, -0.9 + i * 0.6); pole(x, z); } { const [x, z] = at(170, 0.3); elevator(x, z, 1.6); }
  litter(at, 560, 0.8, 16);
  const [cx, cz] = at(45, 0); const car = pickup(cx, cz, Math.PI / 2, PAL.navy, 'car on the far road'); atmo('traffic');
  { const g = prop('far road', cx, cz); const r = new THREE.Mesh(new THREE.PlaneGeometry(300, 5), new THREE.MeshStandardMaterial({ map: gravel(), roughness: 0.95 })); r.rotation.x = -Math.PI / 2; r.position.y = 0.02; r.receiveShadow = true; g.add(r); { const u = V(cx - CAM.x, 0, cz - CAM.z).normalize(); g.rotation.y = -Math.atan2(-u.x, u.z); } }
  sweep.push(crows(6, V(-40, 14, -40), V(40, 18, -30), 0.3, 6.5, 0));
  const kneel = () => { const u2 = smp.userData; u2.hips.position.y = 0.6; u2.body.position.y = 0.6; u2.legs[0].rotation.x = -0.95; u2.legs[0].scale.y = 0.78; u2.legs[1].rotation.x = 0.55; u2.legs[1].scale.y = 0.8; u2.body.rotation.x = 0.55; };
  update = (t, u, e) => { sweep.forEach((f) => f(t)); standPose(two, t); two.userData.arms[0].rotation.x = -0.9; two.userData.hd.rotation.x = 0.3; two.userData.arms[1].rotation.x = -0.5 + 0.25 * Math.sin(t * 2.2);
    standPose(smp, t); const u2 = smp.userData; const lift = sm(0.3, 1.6, t); u2.arms[0].rotation.x = mix(-0.3, -1.75, lift); u2.arms[0].rotation.z = mix(0, -0.35, lift); u2.arms[1].rotation.x = -0.25 + 0.05 * Math.sin(t * 1.3); u2.hd.rotation.x = mix(0.1, 0.05, lift); u2.hd.rotation.y = mix(0, 0.35, lift) + 0.05 * Math.sin(t * 0.7);
    { const u = V(cx - CAM.x, 0, cz - CAM.z).normalize(), k = mix(-40, 40, t / 7); car.position.set(cx - u.z * k, 0, cz + u.x * k); car.rotation.y = Math.atan2(-u.z, u.x); }
    camera.position.copy(CAM).lerp(V(0, 1.15, 0), 0.08 * e); camera.lookAt(0, 1.15, 0); camera.fov = 50; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Where Did\nthe Lead Go?', { y: 0.2, size: 0.05, alpha: sm(2.0, 2.4, t) });
}

run(update, overlay);
