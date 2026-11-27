// Sunday marble Short (6 Dec 2026): "The Marble Run That Plays a Song". A seamless 15 s loop (450 frames at 30 fps):
// frame 450 flows straight into frame 1, so the Short replays without a seam. Built on wbt_kit.js (style skill v1.2).
// Successor to the Infinite Marble Engine (23 Nov): same never-ending idea, but bright, in a real place, and musical.
//
// DRESSING PLAN (SKILL.md 3A). Shot size: medium (locked-off, +9 deg, 9:16). Hero distance 1.5 m, so the layers are
// foreground < 1.1 m from the camera, midground 1.1-4.5 m, background beyond 4.5 m.
// - Location and period: a small family toyshop and workshop on a sunny town street, today, late morning.
// - Foreground: the near edge of the workbench with wood shavings, a glass jar of spare marbles, a chisel, a hand plane.
// - Hero zone: the wooden marble machine on the bench: a bucket elevator lifts each marble, two switchback ramps, a
//   seven-bar xylophone it hops down (one note per bar), a spiral funnel, and a slow return ramp back to the elevator.
// - Midground: the toymaker at the back bench sanding a toy boat, his stool, the back bench with toys and tools, a tool
//   rack, a toy shelf (blocks, tops, a teddy, trains), a rocking horse, two hanging lamps, a mobile of paper birds,
//   bunting, a potted plant, a crate of offcuts.
// - Background: the shop front with its big window (mullions, mirrored "TOYS & MARBLES" lettering), the window display,
//   the pavement, a street tree and a lamp post, the road, and the buildings opposite (cafe with an awning, shopfronts,
//   upper windows, a bakery sign).
// - Atmosphere and activity: dust drifting in the light, the toymaker working, passers-by on both pavements, cars on the
//   road, the mobile turning and the bunting swaying.
// Everything that moves is periodic in 15 s (or a divisor of it), so the loop is exact.
// Colour families: warm wood/cream (built), warm sunlight (golden, amber), nature (leaf, turquoise, sky), teal/navy accents.
import { THREE, SHOT, rnd, C, V, D, sm, mix, clamp, PAL, world, scene, sky, hemi, sun, fill, camera, grade, M, E, mesh, box, blob, canvasTex,
  person, sitPose, walkPose, prop, card, run, hero, atmo, PATHS, FPS } from './wbt_kit.js';

window.SHOT_SIZE = 'medium';
const LOOP = 15;                 // seconds; the whole scene repeats exactly
const NM = 12;                   // marbles in circulation
const GAP = LOOP / NM;           // 1.25 s between marbles
const R = 0.02;                  // marble radius (4 cm shooters)
const NOTEXT = new URLSearchParams(location.search).get('notext') === '1';
sky('day', 40, 120); scene.fog = new THREE.Fog(C('#F3E6D2'), 5, 45);  // gentle depth haze so the street sits back
sun.position.set(-5, 12, 9); sun.target.position.set(0, 0.8, 0); sun.intensity = 2.7; hemi.intensity = 1.25; fill.intensity = 0.5;
Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 2, far: 30 }); sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.01;

// ---------------------------------------------------------------- the shop (floor, front wall with window)
const plank = canvasTex(512, 512, (g) => { for (let i = 0; i < 8; i++) { const c = C('#B98552').multiplyScalar(0.88 + rnd() * 0.2); g.fillStyle = '#' + c.getHexString(); g.fillRect(0, i * 64, 512, 64);
  g.fillStyle = 'rgba(70,45,25,0.5)'; g.fillRect(0, i * 64, 512, 3); const off = rnd() * 512; g.fillRect(off, i * 64, 3, 64);
  for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(90,60,30,0.18)'; g.fillRect(rnd() * 512, i * 64 + 8 + rnd() * 48, 40 + rnd() * 120, 2); } } });
plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(4, 4);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.position.z = -1; floor.receiveShadow = true; world.add(floor);
const FZ = -3.6; // shop front wall plane
const plaster = canvasTex(256, 256, (g) => { g.fillStyle = PAL.cream; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '170,140,100' : '255,255,245'},0.12)`; g.fillRect(rnd() * 256, rnd() * 256, 3 + rnd() * 9, 2 + rnd() * 4); } });
plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping; plaster.repeat.set(4, 2);
const wallM = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.88 });
{ const g = prop('shop front', 0, FZ);
  // wall around a 3.0 x 1.9 m window (sill at 0.9 m), a door to the right
  mesh(box(8, 0.9, 0.25), wallM, 0, 0.45, 0, g); mesh(box(8, 0.7, 0.25), wallM, 0, 3.15, 0, g);
  mesh(box(2.4, 1.9, 0.25), wallM, -2.7, 1.85, 0, g); mesh(box(0.5, 1.9, 0.25), wallM, 1.75, 1.85, 0, g); mesh(box(1.8, 1.9, 0.25), wallM, 3.1, 1.85, 0, g);
  mesh(box(8, 0.5, 0.06), M('#2A8C9A'), 0, 0.25, 0.15, g); mesh(box(8, 0.06, 0.08), M(PAL.wood), 0, 0.52, 0.16, g);   // painted wainscot
  // window frame and mullions
  const fr = M(PAL.teal, { roughness: 0.6 });
  mesh(box(3.2, 0.12, 0.3), fr, 0, 0.9, 0.05, g); mesh(box(3.2, 0.1, 0.2), fr, 0, 2.8, 0.05, g);
  for (const x of [-1.55, -0.52, 0.52, 1.55]) mesh(box(0.09, 1.9, 0.16), fr, x, 1.85, 0.05, g);
  mesh(box(3.1, 0.05, 0.1), fr, 0, 2.35, 0.05, g);
  // window display shelf
  mesh(box(3.1, 0.06, 0.45), M(PAL.wood), 0, 0.98, 0.0, g);
  // mirrored lettering painted on the glass (reads from the street)
  const lt = canvasTex(1024, 128, (c, w, h) => { c.translate(w, 0); c.scale(-1, 1); c.font = '700 78px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#E8B13E'; c.strokeStyle = '#7A4B2E'; c.lineWidth = 4; c.strokeText('TOYS  &  MARBLES', w / 2, h / 2); c.fillText('TOYS  &  MARBLES', w / 2, h / 2); });
  const lm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3), new THREE.MeshBasicMaterial({ map: lt, transparent: true, fog: false })); lm.position.set(0, 2.55, 0.02); g.add(lm);
  // door with a glass panel and a bell
  mesh(box(0.95, 2.1, 0.08), M(PAL.forest), 2.45, 1.05, 0.0, g); mesh(box(0.6, 0.9, 0.09), M('#BFE2F5', { roughness: 0.15 }), 2.45, 1.55, 0.0, g);
  mesh(new THREE.ConeGeometry(0.06, 0.08, 6), M(PAL.golden, { metalness: 0.6, roughness: 0.4 }), 2.0, 2.2, 0.12, g);
}
// window display: toy boat, spinning tops, a toy train, stacked blocks
{ const g = prop('window display', 0, FZ + 0.05);
  const hull = mesh(box(0.42, 0.1, 0.14), M(PAL.brick), -0.9, 1.07, 0, g); mesh(box(0.02, 0.32, 0.02), M(PAL.wood), -0.9, 1.28, 0, g); mesh(new THREE.ConeGeometry(0.12, 0.26, 3), M(PAL.offwhite), -0.84, 1.28, 0, g).rotation.y = 0.4; hull;
  for (const [x, c] of [[-0.35, PAL.turquoise], [-0.15, PAL.golden], [0.05, PAL.leaf]]) { mesh(new THREE.ConeGeometry(0.07, 0.09, 8), M(c), x, 1.06, 0, g).rotation.x = Math.PI; mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 5), M(PAL.wood), x, 1.13, 0, g); }
  for (let k = 0; k < 3; k++) mesh(box(0.16, 0.1, 0.1), M([PAL.navy, PAL.amber, PAL.sky][k]), 0.45 + k * 0.18, 1.06, 0, g);
  for (const [x, y, c] of [[0.7, 1.16, PAL.brick], [0.88, 1.16, PAL.leaf], [0.79, 1.26, PAL.golden]]) mesh(box(0.09, 0.09, 0.09), M(c), x, y, 0, g);
}
// bunting across the window (sways)
const bunting = []; { const g = prop('bunting', 0, FZ + 0.4);
  for (let k = 0; k < 13; k++) { const x = -1.8 + k * 0.3; const f = mesh(new THREE.ConeGeometry(0.07, 0.15, 3), M([PAL.brick, PAL.golden, PAL.turquoise, PAL.sky, PAL.leaf][k % 5]), x, 2.62 - 0.12 * Math.sin(Math.PI * k / 12), 0, g); f.rotation.x = Math.PI; bunting.push(f); } }

// ---------------------------------------------------------------- outside: pavement, road, buildings opposite
mesh(box(30, 0.12, 3.2), M('#C9BFAE'), 0, 0.0, FZ - 1.8);                 // near pavement
const kerb = mesh(box(30, 0.14, 0.18), M(PAL.warmgrey), 0, 0.0, FZ - 3.4); kerb;
mesh(box(30, 0.04, 4.6), M('#7C7670', { roughness: 0.95 }), 0, -0.04, FZ - 5.7); // road
for (let k = -7; k < 8; k++) mesh(box(1.1, 0.02, 0.12), M(PAL.offwhite), k * 2, 0.0, FZ - 5.7);
mesh(box(30, 0.12, 2.2), M('#C9BFAE'), 0, 0.0, FZ - 9.1);                  // far pavement
const BZ = FZ - 10.5;
const facades = [[-7, 3.4, PAL.brick, 9.5], [-3.4, 3.6, PAL.cream, 8.2], [0.2, 3.4, '#E7C98F', 10], [3.7, 3.4, PAL.sky, 8.6], [7.2, 3.4, PAL.peach, 9.2]];
facades.forEach(([x, w, col, h], i) => { const g = prop(['bakery', 'cafe', 'bookshop', 'flats', 'florist'][i], x, BZ);
  mesh(box(w, h, 1.2), M(col), 0, h / 2, 0, g); mesh(box(w + 0.2, 0.25, 1.35), M(PAL.charcoal), 0, h, 0, g);
  for (let fl = 1; fl < Math.floor(h / 3); fl++) for (let c = 0; c < 3; c++) { const wx = -w / 2 + w * (c + 0.5) / 3; mesh(box(0.7, 1.1, 0.06), M('#8FB4CC', { roughness: 0.3 }), wx, fl * 3 + 1.3, 0.62, g); mesh(box(0.84, 0.1, 0.12), M(PAL.offwhite), wx, fl * 3 + 0.72, 0.64, g); }
  mesh(box(w * 0.7, 1.6, 0.06), M('#9CC3D9', { roughness: 0.25 }), -w * 0.1, 1.4, 0.62, g); mesh(box(0.9, 2.1, 0.07), M([PAL.navy, PAL.forest, PAL.wood, PAL.teal, PAL.brick][i]), w * 0.36, 1.05, 0.62, g);
  mesh(box(w * 0.8, 0.4, 0.1), M([PAL.cream, PAL.navy, PAL.forest, PAL.offwhite, PAL.forest][i]), 0, 2.55, 0.66, g);
  if (i === 1) for (let s = 0; s < 6; s++) { const a = mesh(box(w / 6, 0.06, 1.0), M(s % 2 ? PAL.offwhite : PAL.teal), -w / 2 + w * (s + 0.5) / 6, 2.3, 1.1, g); a.rotation.x = 0.35; }
});
{ const g = prop('cafe tables', -3.2, BZ + 1.05); for (const dx of [-0.9, 0.6]) { mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 10), M(PAL.offwhite), dx, 0.75, 0, g); mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 5), M(PAL.charcoal), dx, 0.37, 0, g); } }
{ const g = prop('street tree', -2.1, FZ - 3.0); mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.6, 6), M('#6B4A2E'), 0, 1.3, 0, g); mesh(blob(1.1, 1, 0.18), M(PAL.leaf), 0, 3.1, 0, g); mesh(blob(0.8, 1, 0.2), M(PAL.forest), 0.5, 2.7, 0.2, g); }
{ const g = prop('lamp post', 1.6, FZ - 3.1); mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 6), M(PAL.charcoal), 0, 1.8, 0, g); mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.3, 6), M(PAL.charcoal), 0, 3.7, 0, g); mesh(new THREE.IcosahedronGeometry(0.1, 0), M(PAL.offwhite, { emissive: C('#FFE2A8'), emissiveIntensity: 0.2 }), 0, 3.55, 0, g); }
{ const g = prop('bench outside', 0.2, FZ - 0.55); mesh(box(1.4, 0.05, 0.4), M(PAL.wood), 0, 0.45, 0, g); mesh(box(1.4, 0.3, 0.05), M(PAL.wood), 0, 0.72, -0.18, g); for (const x of [-0.6, 0.6]) mesh(box(0.06, 0.45, 0.35), M(PAL.charcoal), x, 0.22, 0, g); }

// passers-by (periodic: each crosses a 24 m stretch in exactly 15 s or 7.5 s and wraps off-screen)
const SPAN = 16;
const walkers = [[-1, FZ - 1.2, 0.0, 1, PAL.navy, 3], [1, FZ - 2.3, 0.35, 1, PAL.brick, 1], [1, FZ - 2.0, 0.72, 1, PAL.golden, 4], [-1, FZ - 8.6, 0.15, 1, PAL.teal, 2], [1, FZ - 8.8, 0.6, 1, PAL.leaf, 0], [-1, FZ - 8.3, 0.55, 1, PAL.amber, 5]]
  .map(([dir, z, off, laps, col, r]) => { const p = person({ top: col, bottom: [PAL.charcoal, PAL.navy, PAL.wood][r % 3], skin: PAL.skin[r], hair: PAL.hair[(r * 2) % 6], height: 1.62 + r * 0.04 });
    const steps = 12 * laps; p.userData.step = SPAN * laps / (2 * steps); // 12 strides per 16 m: 0.67 m steps at 1.6 steps/s, and the cycle closes
    PATHS.push([V(-SPAN / 2, 0, z), V(SPAN / 2, 0, z)]);
    return { p, dir, z, off, laps }; });
atmo('passers-by');
const cars = [[PAL.sky, 0.0, 1, FZ - 4.9], [PAL.brick, 0.5, -1, FZ - 6.5], [PAL.golden, 0.25, -1, FZ - 6.5]].map(([col, off, dir, z]) => {
  const g = new THREE.Group(); world.add(g); g.userData.prop = true; g.name = 'car';
  mesh(box(3.6, 0.7, 1.7), M(col), 0, 0.55, 0, g); mesh(box(2.0, 0.6, 1.5), M(col), -0.2, 1.15, 0, g); mesh(box(2.02, 0.42, 1.52), M('#9CC3D9', { roughness: 0.2 }), -0.2, 1.17, 0, g);
  for (const [x, zz] of [[-1.15, 0.8], [1.15, 0.8], [-1.15, -0.8], [1.15, -0.8]]) { const w = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8), M(PAL.charcoal), x, 0.32, zz, g); w.rotation.x = Math.PI / 2; }
  return { g, off, dir, z }; });
atmo('street traffic');

// ---------------------------------------------------------------- midground: the workshop
const workM = M('#B98552');
{ const g = prop('back bench', -0.55, -1.55); mesh(box(1.6, 0.07, 0.7), workM, 0, 0.88, 0, g); for (const [x, z] of [[-0.72, -0.3], [0.72, -0.3], [-0.72, 0.3], [0.72, 0.3]]) mesh(box(0.08, 0.86, 0.08), M(PAL.wood), x, 0.43, z, g);
  mesh(box(1.5, 0.05, 0.6), M(PAL.wood), 0, 0.25, 0, g); }
{ const g = prop('vice and clamps', -1.15, -1.3); mesh(box(0.16, 0.12, 0.12), M(PAL.teal, { metalness: 0.5, roughness: 0.5 }), 0, 0.98, 0, g); mesh(box(0.05, 0.05, 0.22), M(PAL.charcoal), 0, 0.98, 0.12, g); }
const boat = prop('toy boat on the bench', -0.45, -1.35); { mesh(box(0.34, 0.08, 0.12), M(PAL.sky), 0, 0.96, 0, boat); mesh(box(0.12, 0.08, 0.09), M(PAL.offwhite), -0.04, 1.04, 0, boat); }
{ const g = prop('paint pots', 0.05, -1.45); for (let k = 0; k < 4; k++) mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 8), M([PAL.brick, PAL.golden, PAL.turquoise, PAL.leaf][k]), k * 0.11, 0.965, (k % 2) * 0.08, g); }
const maker = person({ top: PAL.forest, bottom: PAL.charcoal, skin: PAL.skin[2], hair: PAL.hair[5], collar: PAL.cream, height: 1.74 });
maker.position.set(-0.5, 0, -2.0); maker.rotation.y = D(10);
{ const apron = mesh(box(0.36, 0.5, 0.03), M(PAL.wood), 0, 0.12, 0.2, maker.userData.body); apron; }
const block = mesh(box(0.1, 0.05, 0.06), M('#C98F5A'), 0, -0.04, 0.03, maker.userData.arms[1].userData.hand);  // sanding block
{ const g = prop('stool', -0.5, -2.05); mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), M(PAL.wood), 0, 0.45, 0, g); for (let k = 0; k < 3; k++) { const a = k * 2.09; mesh(box(0.04, 0.45, 0.04), M('#6B4A2E'), Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14, g); } }
{ const g = prop('tool rack', -1.55, -2.6); mesh(box(1.0, 0.7, 0.04), M(PAL.sandstone), 0, 1.6, 0, g);
  for (let k = 0; k < 6; k++) { mesh(box(0.03, 0.3 + (k % 3) * 0.06, 0.03), M(PAL.wood), -0.38 + k * 0.15, 1.6, 0.04, g); mesh(box(0.07, 0.06, 0.03), M(k % 2 ? PAL.charcoal : PAL.teal), -0.38 + k * 0.15, 1.78, 0.05, g); }
  mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 12), M(PAL.charcoal), 0.32, 1.45, 0.05, g); }
{ const g = prop('toy shelf', 1.05, -1.8, D(-20)); mesh(box(0.9, 1.9, 0.35), M(PAL.wood), 0, 0.95, -0.02, g);
  for (const y of [0.45, 0.95, 1.45]) mesh(box(0.84, 0.03, 0.33), M('#C98F5A'), 0, y, 0.02, g);
  for (let k = 0; k < 4; k++) mesh(box(0.12, 0.12, 0.12), M([PAL.brick, PAL.golden, PAL.sky, PAL.leaf][k]), -0.3 + k * 0.18, 0.53, 0.05, g);
  for (let k = 0; k < 3; k++) { mesh(new THREE.ConeGeometry(0.06, 0.09, 8), M([PAL.turquoise, PAL.amber, PAL.navy][k]), -0.25 + k * 0.22, 1.02, 0.05, g).rotation.x = Math.PI; }
  const ted = new THREE.Group(); ted.position.set(0.0, 1.47, 0.04); g.add(ted); mesh(blob(0.1, 1, 0.05), M('#C68B5E'), 0, 0.1, 0, ted); mesh(blob(0.07, 1, 0.05), M('#C68B5E'), 0, 0.25, 0, ted);
  for (const s of [-1, 1]) mesh(new THREE.IcosahedronGeometry(0.03, 0), M('#A06842'), s * 0.05, 0.31, 0, ted);
  for (let k = 0; k < 3; k++) mesh(box(0.14, 0.08, 0.07), M([PAL.navy, PAL.brick, PAL.forest][k]), -0.3 + k * 0.16, 1.5, 0.05, g); }
{ const g = prop('rocking horse', 0.75, -2.6, D(-35)); mesh(box(0.55, 0.25, 0.18), M(PAL.offwhite), 0, 0.55, 0, g); mesh(box(0.15, 0.3, 0.14), M(PAL.offwhite), 0.25, 0.78, 0, g).rotation.z = -0.4; mesh(box(0.2, 0.1, 0.12), M(PAL.offwhite), 0.36, 0.92, 0, g);
  for (const z of [-0.12, 0.12]) { const rk = mesh(new THREE.TorusGeometry(0.45, 0.025, 4, 14, Math.PI * 0.55), M(PAL.brick), 0, 0.5, z, g); rk.rotation.z = Math.PI + Math.PI * 0.225; }
  mesh(box(0.06, 0.25, 0.02), M(PAL.brick), 0.2, 0.86, 0, g); for (const [x, z] of [[-0.2, -0.08], [0.2, -0.08], [-0.2, 0.08], [0.2, 0.08]]) mesh(box(0.04, 0.32, 0.04), M(PAL.offwhite), x, 0.27, z, g); }
{ const g = prop('potted plant', 1.5, -3.1); mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 8), M(PAL.brick), 0, 0.17, 0, g); mesh(blob(0.32, 1, 0.2), M(PAL.leaf), 0, 0.6, 0, g); mesh(blob(0.22, 1, 0.2), M(PAL.forest), 0.12, 0.85, 0.05, g); }
{ const g = prop('crate of offcuts', -1.2, -2.2); mesh(box(0.5, 0.35, 0.4), M('#C98F5A'), 0, 0.18, 0, g); for (let k = 0; k < 5; k++) mesh(box(0.05, 0.25 + rnd() * 0.2, 0.05), M(PAL.wood), -0.15 + k * 0.08, 0.45, (rnd() - 0.5) * 0.2, g); }
const lamps = [[-0.75, -1.3], [0.55, -2.3]].map(([x, z]) => { const g = prop('hanging lamp', x, z); mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 4), M(PAL.charcoal), 0, 2.75, 0, g);
  mesh(new THREE.ConeGeometry(0.2, 0.16, 10, 1, true), M(PAL.teal, { side: THREE.DoubleSide }), 0, 2.25, 0, g); mesh(new THREE.IcosahedronGeometry(0.06, 1), M('#FFF1DC', { emissive: C('#FFD9A0'), emissiveIntensity: 0.6 }), 0, 2.18, 0, g); return g; });
const shopLight = new THREE.PointLight(C('#FFD9A0'), 1.8, 4, 1.6); shopLight.position.set(-0.75, 2.1, -1.3); world.add(shopLight);
// mobile of paper birds (turns once every 15 s)
const mobile = prop('paper bird mobile', 0.15, -1.0); const mobArm = new THREE.Group(); mobArm.position.y = 2.15; mobile.add(mobArm);
mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.75, 4), M(PAL.charcoal), 0, 2.55, 0, mobile);
for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; const b = new THREE.Group(); b.position.set(Math.cos(a) * 0.28, -0.08 - (k % 2) * 0.1, Math.sin(a) * 0.28); mobArm.add(b);
  const bw = mesh(new THREE.ConeGeometry(0.05, 0.16, 3), M([PAL.offwhite, PAL.golden, PAL.sky, PAL.peach][k]), 0, 0, 0, b); bw.rotation.z = Math.PI / 2; bw.scale.z = 0.3;
  for (const s of [-1, 1]) { const w = mesh(box(0.08, 0.004, 0.1), M([PAL.offwhite, PAL.golden, PAL.sky, PAL.peach][k]), 0.01, 0.01, s * 0.05, b); w.rotation.x = s * 0.4; } b.rotation.y = -a; }
mesh(box(0.6, 0.006, 0.006), M(PAL.charcoal), 0, 0, 0, mobArm); mesh(box(0.006, 0.006, 0.6), M(PAL.charcoal), 0, 0, 0, mobArm);
atmo('toymaker at work'); atmo('mobile and bunting');

// ---------------------------------------------------------------- the workbench (foreground) under the machine
const benchTop = canvasTex(512, 512, (g) => { g.fillStyle = '#C99A64'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(80,50,25,0.45)'; g.fillRect(0, i * 86, 512, 3); }
  for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,80,40' : '235,205,160'},0.22)`; g.fillRect(rnd() * 512, rnd() * 512, 30 + rnd() * 90, 2); }
  for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(70,90,110,0.18)'; g.beginPath(); g.arc(rnd() * 512, rnd() * 512, 4 + rnd() * 10, 0, 7); g.fill(); } });
const bench = prop('workbench', 0, 0.15); { mesh(box(1.6, 0.08, 1.2), new THREE.MeshStandardMaterial({ map: benchTop, roughness: 0.8, flatShading: true }), 0, 0.76, 0, bench);
  for (const [x, z] of [[-0.72, -0.52], [0.72, -0.52], [-0.72, 0.52], [0.72, 0.52]]) mesh(box(0.09, 0.72, 0.09), M(PAL.wood), x, 0.36, z, bench); }
{ const g = prop('marble jar', -0.2, 0.56); const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10, 1, true), new THREE.MeshStandardMaterial({ color: C('#DDEFF5'), transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide, flatShading: true }));
  jar.position.y = 0.88; g.add(jar); mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 10), M(PAL.brick), 0, 0.97, 0, g);
  for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 0.035 * Math.sqrt((k % 7) / 7 + 0.1); mesh(new THREE.IcosahedronGeometry(0.019, 1), M([PAL.turquoise, PAL.brick, PAL.golden, PAL.sky, PAL.leaf, PAL.amber][k % 6], { roughness: 0.15 }), Math.cos(a) * r, 0.82 + Math.floor(k / 7) * 0.035, Math.sin(a) * r, g); } }
{ const g = prop('chisel', 0.08, 0.62, D(25)); mesh(box(0.025, 0.02, 0.14), M(PAL.brick), 0, 0.81, 0, g); mesh(box(0.02, 0.006, 0.1), M('#B9B4AC', { metalness: 0.8, roughness: 0.4 }), 0, 0.805, -0.11, g); }
{ const g = prop('hand plane', 0.27, 0.55, D(-15)); mesh(box(0.07, 0.06, 0.22), M(PAL.wood), 0, 0.83, 0, g); mesh(box(0.05, 0.05, 0.05), M(PAL.wood), 0, 0.88, -0.06, g); mesh(new THREE.IcosahedronGeometry(0.025, 0), M(PAL.wood), 0, 0.88, 0.06, g); }
{ const g = prop('wood shavings', 0.02, 0.42); for (let k = 0; k < 26; k++) { const s = mesh(new THREE.TorusGeometry(0.01 + rnd() * 0.008, 0.005, 3, 6, Math.PI * 1.6), M('#E8C99A'), (rnd() - 0.5) * 0.8, 0.805, (rnd() - 0.5) * 0.5, g); s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); } }

// ---------------------------------------------------------------- the marble machine (hero). Local origin: base top centre.
const RUN = hero(prop('marble machine', 0, 0.8)); RUN.position.set(0, 0.8, 0);
const L = (x, y, z) => V(x, y, z);  // run-local point
const woodM = M(PAL.wood, { roughness: 0.7 }), trackM = M(PAL.cream, { roughness: 0.6 }), railM = M('#C98F5A', { roughness: 0.65 });
mesh(box(0.66, 0.04, 0.26), M(PAL.teal, { roughness: 0.55 }), -0.02, -0.02, -0.01, RUN);                 // painted base
const peg = canvasTex(256, 256, (g) => { g.fillStyle = '#E2C597'; g.fillRect(0, 0, 256, 256); g.fillStyle = 'rgba(110,75,40,0.55)'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.beginPath(); g.arc(16 + i * 32, 16 + j * 32, 4, 0, 7); g.fill(); } });
peg.wrapS = peg.wrapT = THREE.RepeatWrapping; peg.repeat.set(2.4, 3.2);
for (const y of [0.25, 0.45, 0.62]) mesh(box(0.64, 0.035, 0.015), new THREE.MeshStandardMaterial({ map: peg, roughness: 0.8, flatShading: true }), -0.02, y, -0.1, RUN);  // open frame: back slats, so the shop shows through
for (const x of [-0.335, 0.295]) mesh(box(0.03, 0.84, 0.04), woodM, x, 0.41, -0.09, RUN);                   // side posts
mesh(box(0.67, 0.03, 0.04), woodM, -0.02, 0.83, -0.09, RUN);

// a channel (plank + two lips) under a list of marble-centre points
function channel(pts, lip = 0.012) { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const len = a.distanceTo(b) + 0.004; const g = new THREE.Group();
    g.position.copy(a).add(b).multiplyScalar(0.5); RUN.add(g); g.lookAt(RUN.localToWorld(b.clone()));  // lookAt takes world coords
    mesh(box(0.04, 0.006, len), trackM, 0, -R - 0.003, 0, g); for (const s of [-1, 1]) mesh(box(0.006, lip, len), railM, s * 0.022, -R + lip / 2 - 0.004, 0, g); } }
function pegTo(p) { const z0 = -0.09, l = p.z - z0; if (l <= 0.01) return; const m = mesh(new THREE.CylinderGeometry(0.004, 0.004, l, 5), woodM, p.x, p.y - R - 0.008, z0 + l / 2, RUN); m.rotation.x = Math.PI / 2; }

// ---- bucket elevator (belt in the x-y plane, 8 cups, one every 1.25 s)
const BX = -0.22, YB = 0.08, YT = 0.68, BH = YT - YB;
const PR = 3 * BH / (Math.PI * 22.5);       // pulley radius chosen so the pulleys' 4 spokes return to the same angle after 15 s
const BL = 2 * BH + 2 * Math.PI * PR, NCUP = 8, SP = BL / NCUP, BV = SP / GAP;
function beltAt(s) { s = ((s % BL) + BL) % BL;   // returns [point, outward angle]
  if (s < BH) return [L(BX + PR, YB + s, 0), 0];
  s -= BH; if (s < Math.PI * PR) { const a = s / PR; return [L(BX + PR * Math.cos(a), YT + PR * Math.sin(a), 0), a]; }
  s -= Math.PI * PR; if (s < BH) return [L(BX - PR, YT - s, 0), Math.PI];
  s -= BH; const a = Math.PI + s / PR; return [L(BX + PR * Math.cos(a), YB + PR * Math.sin(a), 0), a]; }
for (const x of [BX + PR, BX - PR]) mesh(box(0.006, BH, 0.03), M(PAL.charcoal), x, (YB + YT) / 2, 0, RUN);
const pulleys = [YB, YT].map((y) => { const g = new THREE.Group(); g.position.set(BX, y, 0); RUN.add(g); const w = mesh(new THREE.CylinderGeometry(PR + 0.003, PR + 0.003, 0.034, 12), M(PAL.charcoal), 0, 0, 0, g); w.rotation.x = Math.PI / 2;
  for (let k = 0; k < 2; k++) { const sp = mesh(box(PR * 1.6, 0.005, 0.005), M(PAL.golden), 0, 0, 0.019, g); sp.rotation.z = k * Math.PI / 2; } return g; });
mesh(box(0.024, YT - YB + 0.02, 0.012), woodM, BX, (YB + YT) / 2, -0.05, RUN);   // elevator spine
for (const y of [YB, YT]) { const ax = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 5), M(PAL.warmgrey), BX, y, -0.03, RUN); ax.rotation.x = Math.PI / 2; }
const cups = []; for (let j = 0; j < NCUP; j++) { const g = new THREE.Group(); RUN.add(g); mesh(box(0.034, 0.005, 0.036), M(PAL.golden, { roughness: 0.5 }), 0.017, 0.0025, 0, g); mesh(box(0.005, 0.014, 0.036), M(PAL.golden, { roughness: 0.5 }), 0.034, 0.007, 0, g); cups.push(g); }
// gear wheel at the foot, driven from the bottom pulley at 1:3 (12 teeth: returns to the same look after 15 s)
const gear = new THREE.Group(); gear.position.set(-0.07, 0.07, 0.03); RUN.add(gear);
{ const d = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12), M(PAL.brick), 0, 0, 0, gear); d.rotation.x = Math.PI / 2;
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; mesh(box(0.014, 0.014, 0.012), M(PAL.brick), Math.cos(a) * 0.056, Math.sin(a) * 0.056, 0, gear).rotation.z = a; }
  for (let k = 0; k < 3; k++) { const s = mesh(box(0.09, 0.008, 0.004), M(PAL.golden), 0, 0, 0.008, gear); s.rotation.z = k * Math.PI / 3; } }

// ---- the path, as timed segments. Each: [duration, fn(p in 0..1) -> run-local point, rolling (bool)]
const segs = [];
const TL = BH / BV;   // lift time (marble rides one cup up the whole straight)
const CUPOFF = (y) => L(BX + PR + 0.019, y + 0.005 + R, 0);
segs.push([TL, (p) => CUPOFF(YB + p * BH), false, 'lift']);
const R1a = L(-0.15, 0.705, 0.03), R1b = L(0.215, 0.668, 0.03);
segs.push([0.28, (p) => { const a = CUPOFF(YT), q = sm(0, 1, p); return L(mix(a.x, R1a.x, q), mix(a.y, R1a.y, q) + 0.012 * Math.sin(Math.PI * p), mix(a.z, R1a.z, q)); }, false, 'tip']);
const lin = (a, b, ease = 0) => (p) => { const q = ease ? p * (1 - ease) + ease * p * p : p; return a.clone().lerp(b, q); };
segs.push([1.5, lin(R1a, R1b, 0.35), true, 'R1']);
const uturn = (cx, y0, y1, side, zFrom) => (p) => { const a = Math.PI * p; return L(cx + side * 0.032 * Math.sin(a), mix(y0, y1, p), zFrom * Math.cos(a)); };
const R2a = L(0.215, 0.646, -0.03), R2b = L(-0.095, 0.592, -0.03);
segs.push([0.42, uturn(0.215, 0.668, 0.646, 1, 0.03), true, 'U1']);
segs.push([1.5, lin(R2a, R2b, 0.35), true, 'R2']);
segs.push([0.42, uturn(-0.095, 0.592, 0.570, -1, -0.03), true, 'U2']);
// xylophone: 7 bars stepping down to the right; the marble hops from bar to bar (one note per landing)
const NB = 7, HOP = 0.2, BARS = [...Array(NB)].map((_, i) => L(-0.06 + i * 0.046, 0.53 - i * 0.021, 0.03));
let prev = L(-0.095, 0.570, 0.03);
for (let i = 0; i < NB; i++) { const a = prev.clone(), b = BARS[i].clone().add(L(0, R, 0)); const h = 0.022; segs.push([HOP, (p) => L(mix(a.x, b.x, p), mix(a.y, b.y, p) + 4 * h * p * (1 - p), mix(a.z, b.z, p)), false, 'bar' + i]); prev = b; }
// chute to the back rim of the funnel
const FC = L(0.075, 0.27, 0.0), TILT = D(32), FR = 0.1, FH = 0.022, FD = 0.06;
const FN = V(0, Math.cos(TILT), Math.sin(TILT)), FW = V(0, -Math.sin(TILT), Math.cos(TILT)), FX = V(1, 0, 0);
const fdepth = (r) => FD * Math.pow(clamp((FR - r) / (FR - FH)), 1.5);
const fpt = (r, phi, lift = R) => FC.clone().addScaledVector(FX, r * Math.cos(phi)).addScaledVector(FW, r * Math.sin(phi)).addScaledVector(FN, -fdepth(r) + lift);
const RIN = FR - 0.024, RH = FH + 0.004, TURNS = 3.5, TF = 2.4;
const entry = fpt(RIN, -Math.PI / 2);
const chuteC = new THREE.CatmullRomCurve3([prev.clone(), L(0.235, 0.40, 0.0), L(0.19, 0.345, -0.05), entry.clone().add(L(0.035, 0.004, 0)), entry.clone()]);
segs.push([0.42, (p) => chuteC.getPointAt(p * p * 0.4 + p * 0.6), true, 'chute']);
// spiral: radius shrinks, angular speed grows (conservation of angular momentum, roughly)
const SPN = 400, spr = [], sph = []; { let th = 0; for (let k = 0; k <= SPN; k++) { const q = k / SPN; const r = mix(RIN, RH, Math.pow(q, 1.25)); spr.push(r); sph.push(th); th += 1 / r; } const tot = sph[SPN]; for (let k = 0; k <= SPN; k++) sph[k] *= TURNS * 2 * Math.PI / tot; }
segs.push([TF, (p) => { const k = Math.min(SPN - 1, Math.floor(p * SPN)), f = p * SPN - k; const r = mix(spr[k], spr[k + 1], f), th = mix(sph[k], sph[k + 1], f); return fpt(r, -Math.PI / 2 - th); }, true, 'funnel']);
const hole = FC.clone().addScaledVector(FN, -FD), R3a = L(hole.x, 0.135, hole.z + 0.0);
const spiralEnd = fpt(RH, -Math.PI / 2 - TURNS * 2 * Math.PI);
segs.push([0.24, (p) => spiralEnd.clone().lerp(hole.clone().addScaledVector(FN, R * 0.2), Math.min(1, p * 2)).lerp(R3a, Math.max(0, p * 2 - 1) ** 2), false, 'drop']);
const R3b = CUPOFF(YB); const used = segs.reduce((s, x) => s + x[0], 0);
segs.push([LOOP - used, (p) => { const q = 1 - (1 - p) * (1 - p) * 0.25 - 0.75 * (1 - p); return R3a.clone().lerp(R3b, q * 0.97 + 0.03 * p); }, true, 'R3']);
// build the visible track under the rolling segments
const sample = (f, n) => [...Array(n + 1)].map((_, k) => f(k / n));
for (const [, f, roll, name] of segs) { if (!roll || name === 'funnel' || name === 'R3') continue; const pts = sample(f, name[0] === 'U' ? 10 : name === 'chute' ? 14 : 2); channel(pts); pts.filter((_, k) => k % 4 === 0 || k === pts.length - 1).forEach(pegTo); }
// the return ramp stops short of the cups' sweep; the marble rolls the last few cm onto the waiting cup
{ const e = R3a.clone().lerp(R3b, (R3a.x - (-0.15)) / (R3a.x - R3b.x)); channel([R3a.clone().add(L(0.03, 0.0, 0)), e]); pegTo(R3a); pegTo(e); }
// xylophone bars + rails
const barMs = []; const BARCOL = [PAL.brick, PAL.amber, PAL.golden, PAL.leaf, PAL.turquoise, PAL.sky, '#5E7FB8'];
const barMesh = BARS.map((b, i) => { const m = new THREE.MeshStandardMaterial({ color: C(BARCOL[i]), flatShading: true, roughness: 0.45, metalness: 0.25 }); barMs.push(m);
  const bar = mesh(box(0.036, 0.01, 0.12 - i * 0.008), m, b.x, b.y - 0.005, b.z, RUN); for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.006, 5), M(PAL.offwhite), b.x, b.y + 0.001, b.z + s * (0.045 - i * 0.004), RUN); return bar; });
for (const s of [-1, 1]) { const a = BARS[0].clone().add(L(-0.02, -0.016, s * 0.05)), b = BARS[NB - 1].clone().add(L(0.02, -0.016, s * 0.028)); const g = new THREE.Group(); RUN.add(g);
  g.position.copy(a).add(b).multiplyScalar(0.5); g.lookAt(RUN.localToWorld(b.clone())); mesh(box(0.012, 0.012, a.distanceTo(b)), woodM, 0, 0, 0, g); }
BARS.filter((_, i) => i % 3 === 0).forEach((b) => pegTo(b.clone().add(L(0, -0.012, 0))));
// funnel: a lathe around the tilted axis
{ const prof = []; for (let k = 0; k <= 10; k++) { const r = mix(FH, FR, k / 10); prof.push(new THREE.Vector2(r, -fdepth(r))); } prof.push(new THREE.Vector2(FR + 0.012, 0.004));
  const lg = new THREE.LatheGeometry(prof, 28); const fm = mesh(lg, new THREE.MeshStandardMaterial({ color: C(PAL.offwhite), flatShading: true, roughness: 0.55, side: THREE.DoubleSide }), FC.x, FC.y - R * 0, FC.z, RUN);
  fm.quaternion.setFromUnitVectors(V(0, 1, 0), FN);
  const rim = mesh(new THREE.TorusGeometry(FR + 0.012, 0.007, 4, 28), M(PAL.teal), FC.x, FC.y, FC.z, RUN); rim.quaternion.setFromUnitVectors(V(0, 0, 1), FN);
  for (const dx of [-0.06, 0.06]) { const b = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 5), woodM, FC.x + dx, 0.29, -0.085, RUN); b.rotation.x = Math.PI / 2; } }

// ---- precompute the marble's 15 s circuit: position and rolling orientation, 240 samples per second
const TS = 240, NT = LOOP * TS, posT = [], qT = [], starts = []; { let t = 0; for (const s of segs) { starts.push(t); t += s[0]; } }
const segAt = (tau) => { let i = segs.length - 1; while (i > 0 && tau < starts[i]) i--; return i; };
const evalPos = (tau) => { const i = segAt(tau); const [d, f] = segs[i]; return f(clamp((tau - starts[i]) / d)); };
for (let k = 0; k <= NT; k++) posT.push(evalPos(Math.min(LOOP - 1e-6, k / TS)));
{ let q = new THREE.Quaternion(); const tmp = new THREE.Quaternion(), up = V(0, 1, 0), w = V(); let lastW = V();
  const qa = []; for (let k = 0; k <= NT; k++) { qa.push(q.clone()); if (k === NT) break; const tau = k / TS, i = segAt(tau);
    const v = posT[k + 1].clone().sub(posT[k]); let ang = 0;
    if (segs[i][2]) { const n = segs[i][3] === 'funnel' ? FN : up; w.crossVectors(n, v); ang = v.length() / R; if (w.lengthSq() > 1e-12) { w.normalize(); lastW.copy(w); } }
    else if (segs[i][3] !== 'lift') { ang = v.length() / R * 0.7; w.copy(lastW); }
    if (ang > 0 && w.lengthSq() > 0.5) { tmp.setFromAxisAngle(w, ang); q.premultiply(tmp); } }
  // during the lift, ease the marble from its end-of-circuit orientation back to its start one (it settles in the cup)
  const qEnd = qa[NT].clone(); const nl = Math.round(TL * TS);
  for (let k = 0; k <= NT; k++) { if (k <= nl) { const f = sm(0, 1, k / nl); qT.push(qEnd.clone().slerp(qa[nl], f)); } else qT.push(qa[k]); }
  // qa[nl] equals qa[0] (no rolling in the lift), so the circuit closes exactly
}
const STRIKES = []; segs.forEach((s, i) => { if (s[3].startsWith('bar')) STRIKES.push([+s[3].slice(3), starts[i] + s[0]]); });
window.MARBLE_TIMING = { loop: LOOP, gap: GAP, marbles: NM, strikes: STRIKES, segs: segs.map((s, i) => [s[3], +starts[i].toFixed(4), +s[0].toFixed(4)]) };

// ---- the marbles
const MCOL = [PAL.turquoise, '#D9573B', PAL.golden, '#4FA3E0', PAL.leaf, PAL.amber];
const marbles = [...Array(NM)].map((_, k) => { const g = new THREE.Group(); RUN.add(g);
  const m = mesh(new THREE.IcosahedronGeometry(R, 1), M(MCOL[k % 6], { roughness: 0.14 }), 0, 0, 0, g);
  const band = mesh(new THREE.TorusGeometry(R * 0.84, R * 0.2, 4, 12), M(PAL.offwhite, { roughness: 0.2 }), 0, 0, 0, g); band.rotation.x = 0.5; m; return g; });

// ---------------------------------------------------------------- dust in the light (periodic drift)
const NDUST = 160, dust = new THREE.BufferGeometry(), dpos = new Float32Array(NDUST * 3), dseed = [];
for (let i = 0; i < NDUST; i++) dseed.push([(rnd() - 0.5) * 1.8, 0.9 + rnd() * 1.4, -0.4 - rnd() * 2.6, rnd() * 6.28, 1 + Math.floor(rnd() * 2)]);
dust.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
const dustPts = new THREE.Points(dust, new THREE.PointsMaterial({ color: C('#FFF1DC'), size: 0.012, transparent: true, opacity: 0.7, depthWrite: false })); world.add(dustPts); atmo('dust in the light');

// ---------------------------------------------------------------- per-frame update (every motion has period 15 s or a divisor)
const TAU = 2 * Math.PI;
function update(t) {
  t = ((t % LOOP) + LOOP) % LOOP;
  // belt, cups, pulleys, gear
  const s0 = BV * t; cups.forEach((c, j) => { const [p, a] = beltAt(s0 + j * SP); c.position.copy(p); c.rotation.z = a; });
  const pa = -s0 / PR; pulleys.forEach((p) => (p.rotation.z = pa)); gear.rotation.z = -pa / 3;
  // marbles: each is the same circuit shifted by 1.25 s
  marbles.forEach((g, k) => { const tau = (t + k * GAP) % LOOP, f = tau * TS, i = Math.floor(f), u = f - i; g.position.copy(posT[i]).lerp(posT[Math.min(NT, i + 1)], u); g.quaternion.copy(qT[i]); });
  // xylophone bars ring when struck (strike times repeat every 1.25 s)
  for (const [b, ts] of STRIKES) { const age = (((t - ts) % GAP) + GAP) % GAP; const env = Math.exp(-age * 9); barMesh[b].position.y = BARS[b].y - 0.005 - 0.0035 * env * Math.cos(age * 70);
    barMs[b].emissive.set(BARCOL[b]); barMs[b].emissiveIntensity = 0.55 * env; }
  // toymaker sanding (strokes every 0.75 s), glancing up at the machine once per loop
  sitPose(maker, t, D(12) * sm(5, 6, t) * (1 - sm(8, 9, t)));
  const st = Math.sin(TAU * t / 0.75); maker.userData.arms[1].rotation.x = -1.05 + 0.18 * st; maker.userData.arms[1].rotation.z = 0.12; maker.userData.arms[0].rotation.x = -0.85; maker.userData.arms[0].rotation.z = -0.1;
  maker.userData.body.rotation.x = 0.18 + 0.02 * st; maker.userData.hd.rotation.x = 0.25 * (1 - sm(5, 6, t) * (1 - sm(8, 9, t)));
  // passers-by and cars
  walkers.forEach((w) => { const d = ((t / LOOP) * w.laps + w.off) % 1 * SPAN * w.laps; const x = w.dir * (((d % SPAN) / SPAN) * SPAN - SPAN / 2); w.p.position.set(x, 0, w.z); w.p.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2; walkPose(w.p, d); });
  cars.forEach((c) => { const u = ((t / 5 + c.off) % 1); c.g.position.set(c.dir * (u * 40 - 20), 0, c.z); c.g.rotation.y = c.dir > 0 ? 0 : Math.PI; });
  // mobile, bunting, lamps
  mobArm.rotation.y = TAU * t / LOOP; bunting.forEach((f, k) => (f.rotation.z = 0.08 * Math.sin(TAU * t / 3 + k * 0.7)));
  lamps.forEach((l, k) => (l.rotation.z = 0.004 * Math.sin(TAU * t / 5 + k)));
  dseed.forEach(([x, y, z, ph, n], i) => { const a = TAU * n * t / LOOP + ph; dpos[i * 3] = x + 0.12 * Math.sin(a); dpos[i * 3 + 1] = y + 0.08 * Math.sin(a * 2 + ph); dpos[i * 3 + 2] = z + 0.1 * Math.cos(a); });
  dust.attributes.position.needsUpdate = true;
  // locked-off camera, +9 deg, three-quarter-ish (12 deg off square), medium
  const tg = V(-0.01, 1.17, 0); const az = D(12), el = D(9), dist = 1.6;
  camera.position.set(tg.x + dist * Math.cos(el) * Math.sin(az), tg.y + dist * Math.sin(el), tg.z + dist * Math.cos(el) * Math.cos(az)); camera.lookAt(tg); camera.fov = 50; camera.updateProjectionMatrix();
}
const overlay = () => { if (!NOTEXT) card('TURN THE\nSOUND ON', { y: 0.155, size: 0.05 }); };
run((t) => update(t), overlay);
