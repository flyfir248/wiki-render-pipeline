// 20-second style test for SKILL.md v1.1: Hachiko at Shibuya Station (a reconstruction, not archival).
// Facts: Hachiko (Akita, born Nov 1923) met Prof. Hidesaburo Ueno at Shibuya Station each day; Ueno died at work in
// May 1925 (implied here, never shown: he walks in and the doorway stays empty) and Hachiko kept waiting there every day
// until March 1935, nine years and ten months. In his later years his left ear drooped.
// Edit list (SKILL.md 14.5): the strongest moment, the old dog waiting, opens the Short; then 1924; then the years.
// T01 hook: old Hachiko sits by the entrance and looks up at each person who comes out (medium, +8 deg, push-in 10%)
// T02 1924: Ueno walks to the station with young Hachiko, goes in; the dog sits (elevated wide, +30 deg, 10 deg orbit)
// T03 the years: locked-off wide, spring to winter in 7 s while the crowds pass and he stays (time-lapse)
import { renderer, THREE, SHOT, rnd, C, V, D, sm, mix, clamp, PAL, world, scene, sky, hemi, sun, fill, camera, grade, M, E, mesh, box, blob, canvasTex,
  person, walker, standPose, sitPose, prop, dog, dogSit, dogWalk, orbit, card, run, hero, atmo } from './wbt_kit.js';

const T1 = SHOT === 'T01', T2 = SHOT === 'T02', T3 = SHOT === 'T03';
window.SHOT_SIZE = T1 ? 'medium' : 'wide';
sky('day', 28, 85);
sun.position.set(-10, 15, 11); sun.target.position.set(0, 0, -1);

// ---------------------------------------------------------------- the plaza
const paveTex = canvasTex(512, 512, (g) => { const n = 8, s = 512 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const k = 0.9 + rnd() * 0.16; const c = C(rnd() < 0.2 ? '#B9AC98' : '#A89F93').multiplyScalar(k); g.fillStyle = '#' + c.getHexString(); g.fillRect(i * s, j * s, s, s); }
  g.strokeStyle = 'rgba(70,64,58,0.6)'; g.lineWidth = 3; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke(); } });
paveTex.wrapS = paveTex.wrapT = THREE.RepeatWrapping; paveTex.repeat.set(20, 16);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 32), new THREE.MeshStandardMaterial({ map: paveTex, roughness: 0.9 })); ground.rotation.x = -Math.PI / 2; ground.position.z = 4; ground.receiveShadow = true; world.add(ground);
const road = mesh(box(60, 0.02, 5), M('#8C847A', { roughness: 0.95 }), 0, 0.01, 13.5);
mesh(box(60, 0.12, 0.3), M(PAL.cream), 0, 0.06, 10.9);
// tram rails on the road
for (const z of [12.8, 14.2]) mesh(box(60, 0.03, 0.07), M('#6E6A66', { roughness: 0.5, metalness: 0.6 }), 0, 0.03, z);

// ---------------------------------------------------------------- Shibuya Station (simplified: single storey, timber and plaster, tiled hip roof)
const st = new THREE.Group(); world.add(st);
const FZ = -4.2;  // facade plane
mesh(box(18, 0.4, 8.6), M(PAL.sandstone), 0, 0.2, -8.3, st);                       // stone base
mesh(box(18, 4.6, 6.4), M(PAL.cream), 0, 2.5, -9.6, st);                              // main hall behind
for (const [x, w] of [[-5.25, 7.5], [5.25, 7.5]]) mesh(box(w, 4.6, 0.4), M(PAL.cream), x, 2.5, FZ, st);   // facade either side of the door
mesh(box(3.0, 1.8, 0.4), M(PAL.cream), 0, 3.9, FZ, st);                                // lintel above the door (door 3.0 x 3.0)
mesh(box(0.3, 4.6, 2.2), M(PAL.cream), -1.65, 2.5, FZ - 1.1, st); mesh(box(0.3, 4.6, 1.2), M(PAL.cream), 1.65, 2.5, FZ - 0.6, st);  // vestibule sides; the right one opens onto the platform passage
mesh(box(3.4, 0.3, 2.4), M(PAL.cream), 0, 4.65, FZ - 1.1, st);
mesh(box(3.0, 3.0, 0.1), M('#F2D49A', { emissive: C('#E9B765'), emissiveIntensity: 0.25 }), 0, 1.9, FZ - 2.15, st);  // warm lit ticket hall wall
const inLight = new THREE.PointLight(C('#FFD9A0'), 6, 6, 1.5); inLight.position.set(0, 2.6, FZ - 1.2); st.add(inLight);
const plaster = canvasTex(256, 256, (g) => { g.fillStyle = PAL.cream; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '160,130,90' : '255,255,245'},0.10)`; g.fillRect(rnd() * 256, rnd() * 256, 3 + rnd() * 10, 2 + rnd() * 4); }
  g.strokeStyle = 'rgba(140,110,80,0.35)'; g.lineWidth = 2; for (let y = 32; y < 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); } });
plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping; plaster.repeat.set(3, 2);
st.traverse((o) => { if (o.isMesh && o.material === M(PAL.cream)) o.material = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.85, flatShading: true }); });
// timber posts and beams on the facade
for (const x of [-8.9, -6.2, -3.4, -1.55, 1.55, 3.4, 6.2, 8.9]) mesh(box(0.28, 4.6, 0.12), M(PAL.wood), x, 2.5, FZ + 0.26, st);
for (const y of [0.55, 4.7]) mesh(box(18.2, 0.24, 0.14), M(PAL.wood), 0, y, FZ + 0.27, st);
// windows: lattice panes, warm inside
for (const x of [-7.55, -4.8, 4.8, 7.55]) { mesh(box(1.9, 1.6, 0.06), M('#F6E2B4', { emissive: C('#F2B53A'), emissiveIntensity: 0.18 }), x, 2.5, FZ + 0.22, st);
  for (const dx of [-0.48, 0, 0.48]) mesh(box(0.06, 1.6, 0.08), M(PAL.wood), x + dx, 2.5, FZ + 0.26, st); mesh(box(1.9, 0.06, 0.08), M(PAL.wood), x, 2.5, FZ + 0.26, st); }
// canopy over the entrance
mesh(box(5.2, 0.16, 2.0), M(PAL.wood), 0, 3.35, FZ + 1.0, st); for (const x of [-2.4, 2.4]) mesh(new THREE.CylinderGeometry(0.09, 0.1, 3.3, 6), M(PAL.wood), x, 1.65, FZ + 1.85, st);
mesh(box(5.4, 0.1, 2.2), M(PAL.bluegrey), 0, 3.47, FZ + 1.0, st);
// hip roof (4-sided cone stretched)
const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1), M(PAL.bluegrey)); roof.rotation.y = Math.PI / 4; roof.scale.set(13.9, 3.2, 7.6); roof.position.set(0, 4.8 + 1.6, -7.5); roof.castShadow = roof.receiveShadow = true; st.add(roof);
mesh(box(19.2, 0.18, 9.4), M(PAL.navy), 0, 4.85, -7.6, st);  // eaves
// station clock above the door
const clockTex = canvasTex(128, 128, (g) => { g.fillStyle = PAL.offwhite; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = PAL.wood; g.stroke();
  g.fillStyle = PAL.ink; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.fillRect(64 + Math.sin(a) * 48 - 3, 64 - Math.cos(a) * 48 - 3, 6, 6); } });
const clk = new THREE.Group(); clk.position.set(0, 3.95, FZ + 0.24); st.add(clk);
clk.add(new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.7 })));
const hh = mesh(box(0.06, 0.28, 0.02), M(PAL.ink), 0, 0, 0.02, clk); hh.geometry.translate(0, 0.12, 0); const mm = mesh(box(0.04, 0.42, 0.02), M(PAL.ink), 0, 0, 0.03, clk); mm.geometry.translate(0, 0.19, 0);
// name board (blank: no invented lettering)
mesh(box(3.2, 0.5, 0.08), M(PAL.offwhite), 0, 5.25, FZ + 0.3, st); mesh(box(3.36, 0.62, 0.05), M(PAL.wood), 0, 5.25, FZ + 0.25, st);

// ---------------------------------------------------------------- shops either side and the city behind
function shop(x, z, w, d, h, wall, roofCol, ry = 0) { const g = prop('shop', x, z, ry);
  mesh(box(w, h, d), M(wall), 0, h / 2, 0, g); const r = mesh(new THREE.ConeGeometry(1, 1, 4, 1), M(roofCol), 0, h + 0.7, 0, g); r.rotation.y = Math.PI / 4; r.scale.set(w * 0.78, 1.4, d * 0.78);
  mesh(box(w * 0.9, 0.12, 1.0), M(roofCol), 0, h * 0.48, d / 2 + 0.5, g);   // shop awning
  for (let k = 0; k < Math.max(1, Math.round(w / 1.6)); k++) { const xx = -w / 2 + (k + 0.5) * w / Math.max(1, Math.round(w / 1.6)); mesh(box(0.9, 0.9, 0.06), M('#F6E2B4', { emissive: C(PAL.golden), emissiveIntensity: 0.12 }), xx, h * 0.75, d / 2 + 0.03, g); }
  return g; }
const shopCols = [[PAL.cream, PAL.brick], ['#E8D2B0', PAL.teal], [PAL.offwhite, PAL.navy], ['#EBC9A0', PAL.wood], [PAL.cream, PAL.bluegrey]];
[[-15, -1, 5.0, 4, 5.2], [-15.5, 4.4, 4.2, 4, 4.0], [-15, 9.2, 4.6, 4, 5.8], [15, -1.2, 4.6, 4, 4.6], [15.4, 4.0, 4.8, 4, 6.0], [15, 9.0, 4.2, 4, 4.2]].forEach(([x, z, w, d, h], k) => { const [a, b] = shopCols[k % 5]; shop(x, z, w, d, h, a, b, x < 0 ? Math.PI / 2 : -Math.PI / 2); });
for (let i = 0; i < 14; i++) { const x = -30 + i * 4.6 + rnd(), h = 6 + rnd() * 9; const g = prop('distant building', x, -20 - rnd() * 6); mesh(box(3.6 + rnd(), h, 3.5), M(i % 2 ? '#B8C4CF' : '#C9C3B8'), 0, h / 2, 0, g);
  for (let k = 0; k < Math.floor(h / 2.2); k++) mesh(box(2.6, 0.5, 0.05), M('#8E9BA8'), 0, 1.4 + k * 2.2, 1.78, g); }
// telegraph poles and wires along the road (era detail)
const poles = []; for (const x of [-12, -4, 4, 12]) { const g = prop('telegraph pole', x, 10.4); mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 6), M('#6B4A2E'), 0, 3.75, 0, g); mesh(box(1.6, 0.1, 0.1), M('#6B4A2E'), 0, 7.0, 0, g); poles.push(x); }
const wireM = new THREE.LineBasicMaterial({ color: C(PAL.charcoal) });
for (const dx of [-0.7, 0.7]) for (let k = 0; k < poles.length - 1; k++) { const pts = []; for (let s = 0; s <= 12; s++) { const u = s / 12; pts.push(V(mix(poles[k], poles[k + 1], u) + dx, 7.05 - 0.35 * Math.sin(Math.PI * u), 10.4)); } world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireM)); }
// street lamps
for (const [x, z] of [[-4.5, 2.5], [4.5, 2.5], [-4.5, 8.5], [5.2, 8.5]]) { const g = prop('street lamp', x, z); mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6), M(PAL.charcoal), 0, 1.7, 0, g); mesh(new THREE.IcosahedronGeometry(0.2, 0), M(PAL.offwhite, { emissive: C('#FFE2A8'), emissiveIntensity: 0.3 }), 0, 3.5, 0, g); }
// benches and planters for scale and set dressing (clear of every walker path by >= 0.3 m)
for (const [x, z, ry] of [[-6.8, 0.6, 0.0], [6.9, 0.4, 0.0]]) { const g = prop('bench', x, z, ry); mesh(box(1.6, 0.08, 0.45), M(PAL.wood), 0, 0.45, 0, g); mesh(box(1.6, 0.4, 0.06), M(PAL.wood), 0, 0.72, -0.2, g); for (const sx of [-0.7, 0.7]) mesh(box(0.08, 0.45, 0.4), M(PAL.charcoal), sx, 0.22, 0, g); }

// ---------------------------------------------------------------- cherry trees with four seasons
const SEASON = { spring: [PAL.blossom, '#F7D3DC', '#EDA9BB'], summer: [PAL.leaf, PAL.forest, '#5FA347'], autumn: [PAL.amber, PAL.golden, PAL.brick], winter: null };
const trees = [];
function cherry(x, z, s = 1) { const g = prop('cherry tree', x, z, rnd() * 6); g.scale.setScalar(s * (0.9 + rnd() * 0.2));
  const bark = M('#5E4330'); mesh(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 6), bark, 0, 1.1, 0, g);
  const branches = [], blobs = []; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + rnd() * 0.6; const b = mesh(new THREE.CylinderGeometry(0.05, 0.09, 1.5, 5), bark, Math.cos(a) * 0.45, 2.5, Math.sin(a) * 0.45, g); b.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); branches.push(b); }
  for (let k = 0; k < 6; k++) { const a = rnd() * 6.28, r = rnd() * 1.0; const mats = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85, color: C(SEASON.spring[i]) }));
    const m = mesh(blob(0.75 + rnd() * 0.35, 1, 0.14), mats[k % 3], Math.cos(a) * r, 2.9 + rnd() * 0.7, Math.sin(a) * r, g); m.userData.i = k % 3; blobs.push(m); }
  const snow = []; for (const b of blobs.slice(0, 3)) { const s2 = mesh(blob(0.5, 0, 0.1), M(PAL.offwhite), b.position.x, b.position.y - 0.25, b.position.z, g); s2.scale.y = 0.35; s2.visible = false; snow.push(s2); }
  trees.push({ g, blobs, snow, ph: rnd() * 6 }); return g; }
for (const [x, z] of [[-3.9, -2.5], [3.9, -2.6], [-7.5, -1.8], [7.6, -2.0], [-8.4, 5.2], [8.6, 5.6], [-11.5, 1.6], [11.8, 1.2]]) cherry(x, z, 1.05);
function setSeason(t) { // t in seasons: 0 spring .. 1 summer .. 2 autumn .. 3 winter
  const keys = ['spring', 'summer', 'autumn']; const k = Math.min(2, Math.floor(t)), f = sm(0.55, 1, t - k);
  for (const tr of trees) { const wint = sm(2.6, 3.0, t);
    tr.blobs.forEach((b) => { const a = C(SEASON[keys[k]][b.userData.i]), c = C(SEASON[keys[Math.min(2, k + 1)]][b.userData.i]); b.material.color.copy(a.lerp(c, k < 2 ? f : 0)); b.scale.setScalar(Math.max(0.001, 1 - wint)); b.visible = wint < 0.99; });
    tr.snow.forEach((s) => (s.visible = false)); }
}

// planters with low shrubs and flowers (colour and scale near the door)
for (const [x, z] of [[-5.6, -2.9], [5.6, -2.9], [-7.0, 6.0], [7.2, 6.0]]) { const g = prop('planter', x, z); mesh(box(1.4, 0.45, 0.7), M(PAL.wood), 0, 0.22, 0, g); for (let k = 0; k < 3; k++) mesh(blob(0.28, 0, 0.15), M(k === 1 ? PAL.forest : PAL.leaf), -0.45 + k * 0.45, 0.6, 0, g);
  for (let k = 0; k < 5; k++) mesh(new THREE.IcosahedronGeometry(0.07, 0), M(k % 2 ? PAL.golden : PAL.peach), -0.55 + k * 0.27, 0.78, 0.18, g); }
// fallen petals on the paving (spring), recoloured as leaves in autumn
const GP = 700; const petalsOnGround = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 5), new THREE.MeshStandardMaterial({ color: C(PAL.blossom), roughness: 0.9 }), GP); world.add(petalsOnGround);
{ const o = new THREE.Object3D(); for (let i = 0; i < GP; i++) { const a = rnd() * 6.28, r = Math.pow(rnd(), 0.6) * 3.2; const cx = [[-3.9, -2.5], [3.9, -2.6], [-7.5, -1.8], [7.6, -2.0], [1.2, -1.6], [2.2, -0.4], [2.0, 0.6]][i % 7];
  o.position.set(cx[0] + Math.cos(a) * r * 1.4, 0.006, cx[1] + Math.sin(a) * r + 0.8); o.rotation.set(-Math.PI / 2, 0, rnd() * 6); o.scale.setScalar(0.7 + rnd() * 0.8); o.updateMatrix(); petalsOnGround.setMatrixAt(i, o.matrix); } }
// foreground dressing near the door: a luggage cart with trunks, a bicycle rack (clear of every path by >= 0.3 m)
{ const g = prop('luggage cart', -2.9, -2.0, 0.3); mesh(box(1.3, 0.1, 0.7), M(PAL.wood), 0, 0.32, 0, g);
  for (const [x, z] of [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]]) { const w = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 8), M(PAL.charcoal), x, 0.14, z, g); w.rotation.x = Math.PI / 2; }
  mesh(box(0.6, 0.38, 0.45), M(PAL.brick), -0.3, 0.56, 0, g); mesh(box(0.5, 0.3, 0.4), M(PAL.teal), 0.3, 0.52, 0.05, g); mesh(box(0.42, 0.26, 0.34), M(PAL.golden), 0.28, 0.8, 0.02, g); }
// ---------------------------------------------------------------- environment dressing (SKILL.md 3A), round 3
// Dressing plan, Shibuya Station plaza, spring 1924-1935:
//  foreground  potted pine and stone lantern (hook), planters, the cherry trees by the door
//  hero zone   Hachiko (+ Ueno in T02)
//  midground   news kiosk with vendor, roast-sweet-potato cart with steam, two rickshaws (one puller resting), parked
//              bicycles, notice board, fire-bucket stack, station attendant, seated travellers on the benches,
//              paper lanterns under the canopy, posters between the posts, ticket windows and gate inside the hall
//  background  shops with awnings, telegraph poles and wires, a tram on the road, distant city blocks, roof vents
//  atmosphere  crowd, falling petals, steam, the tram, birds crossing, lanterns swaying
// Every object answers "where, when, what is happening": a busy 1920s commuter station. Nothing stands on a walker's path.
st.userData.prop = true; st.name = 'station';
const lanterns = [];
for (const x of [-1.9, -0.7, 0.7, 1.9]) { const g = prop('paper lantern', x, FZ + 1.6, 0, 2.75); const b = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.36, 8), M(x < 0 ? PAL.brick : PAL.offwhite, { emissive: C('#F7C77A'), emissiveIntensity: 0.25 }), 0, 0, 0, g);
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), M(PAL.charcoal), 0, 0.2, 0, g); mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), M(PAL.charcoal), 0, -0.2, 0, g); lanterns.push(g); b; }
for (const [x, col] of [[-2.5, PAL.teal], [-2.75, PAL.golden], [2.5, PAL.brick], [2.75, PAL.sky]]) { const g = prop('poster', x, FZ + 0.23, 0, 0); mesh(box(0.42, 0.62, 0.02), M(col), 0, 1.95 + (x > 0 ? 0.1 : 0), 0, g); mesh(box(0.3, 0.06, 0.025), M(PAL.paper), 0, 2.1 + (x > 0 ? 0.1 : 0), 0.005, g); mesh(box(0.3, 0.04, 0.025), M(PAL.paper), 0, 1.85 + (x > 0 ? 0.1 : 0), 0.005, g); }
{ const g = prop('timetable', 0, FZ - 2.12); mesh(box(1.1, 0.7, 0.04), M('#2E3A33'), 0, 2.55, 0, g); for (let k = 0; k < 5; k++) mesh(box(0.9, 0.04, 0.045), M(PAL.paper), 0, 2.33 + k * 0.11, 0, g);
  for (const x of [-1.45, -0.35, 0.35, 1.45]) mesh(box(0.06, 3.0, 0.05), M(PAL.wood), x, 1.5, 0.02, g); }
const queue = [person({ outfit: 'kimono', top: PAL.navy, bottom: PAL.navy, obi: PAL.peach, skin: PAL.skin[0], hair: PAL.hair[0], bun: true, height: 1.52 }), person({ top: PAL.warmgrey, bottom: PAL.charcoal, skin: PAL.skin[1], hat: 'boater', height: 1.7 })];
queue[0].position.set(-1.0, 0, FZ - 1.65); queue[0].rotation.y = Math.PI; queue[1].position.set(-1.0, 0, FZ - 1.05); queue[1].rotation.y = Math.PI;
// inside the hall: ticket windows, a clerk behind each, a wooden gate either side of the walkway
for (const x of [-1.0, 0.9]) { const g = prop('ticket window', x, FZ - 2.08); mesh(box(0.7, 0.55, 0.06), M('#4A3A2C'), 0, 1.4, 0, g); mesh(box(0.8, 0.08, 0.2), M(PAL.wood), 0, 1.1, 0.08, g); }
for (const x of [-1.35, -0.75, 0.75, 1.35]) { const g = prop('ticket gate', x, FZ - 0.7); mesh(box(0.12, 0.95, 0.5), M(PAL.wood), 0, 0.48, 0, g); mesh(box(0.16, 0.06, 0.55), M(PAL.warmgrey), 0, 0.98, 0, g); }
{ const g = prop('fire buckets', -2.2, FZ + 0.45); for (const [x, y] of [[-0.2, 0.15], [0, 0.15], [0.2, 0.15], [-0.1, 0.45], [0.1, 0.45], [0, 0.75]]) mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.28, 8), M(PAL.brick), x, y, 0, g); }
{ const g = prop('notice board', 3.4, FZ + 0.4); for (const x of [-0.55, 0.55]) mesh(box(0.08, 1.6, 0.08), M(PAL.wood), x, 0.8, 0, g); mesh(box(1.3, 0.9, 0.06), M(PAL.wood), 0, 1.3, 0, g);
  for (const [x, y, c] of [[-0.35, 1.45, PAL.paper], [0.05, 1.4, PAL.cream], [0.38, 1.25, PAL.peach], [-0.2, 1.1, PAL.paper]]) mesh(box(0.3, 0.32, 0.02), M(c), x, y, 0.04, g); }
// news kiosk with its vendor
{ const g = prop('news kiosk', 5.3, -0.8, -Math.PI / 2); mesh(box(1.5, 1.1, 1.0), M(PAL.teal), 0, 0.55, 0, g); mesh(box(1.7, 0.1, 1.3), M(PAL.wood), 0, 1.9, 0.1, g); for (const x of [-0.75, 0.75]) mesh(box(0.08, 0.85, 0.08), M(PAL.wood), x, 1.5, -0.4, g);
  for (let k = 0; k < 6; k++) mesh(box(0.22, 0.03, 0.3), M(k % 2 ? PAL.paper : PAL.offwhite), -0.6 + k * 0.24, 1.12, 0.3, g); mesh(box(1.5, 0.4, 0.04), M(PAL.golden), 0, 1.65, 0.62, g); }
const kioskMan = person({ top: PAL.wood, bottom: PAL.charcoal, skin: PAL.skin[2], hat: 'boater', height: 1.64 }); kioskMan.position.set(6.1, 0, -0.8); kioskMan.rotation.y = -Math.PI / 2;
// roast sweet potato cart with steam
{ const g = prop('sweet potato cart', -5.0, 1.8, Math.PI - 0.3); mesh(box(1.2, 0.7, 0.7), M(PAL.wood), 0, 0.65, 0, g); for (const z of [-0.38, 0.38]) { const w = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 10), M(PAL.charcoal), -0.2, 0.32, z, g); w.rotation.x = Math.PI / 2; }
  mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.5, 8), M('#4A4642'), 0.15, 1.25, 0, g); mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), M('#4A4642'), 0.15, 1.75, 0, g); mesh(box(0.9, 0.04, 0.04), M(PAL.wood), -0.9, 0.85, 0.25, g); mesh(box(0.9, 0.04, 0.04), M(PAL.wood), -0.9, 0.85, -0.25, g); }
const potatoMan = person({ top: PAL.navy, bottom: PAL.charcoal, skin: PAL.skin[3], hair: PAL.hair[5], height: 1.6 }); potatoMan.position.set(-4.1, 0, 2.5); potatoMan.rotation.y = 2.4;
const steam = []; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: C('#F4F4F2'), transparent: true, opacity: 0.6, roughness: 1, flatShading: true })); world.add(m); steam.push({ m, ph: i / 14 }); }
// rickshaws, one with its puller resting on the footboard
function rickshaw(x, z, ry, col) { const g = prop('rickshaw', x, z, ry); for (const s of [-1, 1]) { const w = mesh(new THREE.TorusGeometry(0.45, 0.04, 4, 12), M(PAL.charcoal), s * 0.42, 0.45, 0, g); w.rotation.y = Math.PI / 2; }
  mesh(box(0.8, 0.35, 0.55), M(col), 0, 0.75, 0, g); mesh(box(0.8, 0.5, 0.1), M(col), 0, 1.1, -0.25, g); const hood = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.85, 8, 1, true, 0, Math.PI), M(PAL.charcoal, { side: THREE.DoubleSide }), 0, 1.15, -0.1, g); hood.rotation.z = Math.PI / 2; hood.rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) { const sh = mesh(box(0.05, 0.05, 1.6), M(PAL.wood), s * 0.35, 0.55, 0.95, g); sh.rotation.x = 0.25; } return g; }
rickshaw(-5.7, 5.3, -2.0, PAL.brick); rickshaw(6.4, 1.6, 1.9, PAL.navy);
const puller = person({ top: PAL.offwhite, bottom: PAL.navy, skin: PAL.skin[3], hair: PAL.hair[0], height: 1.62 }); puller.position.set(6.8, 0, 2.2); puller.rotation.y = -2.0;
// parked bicycles
for (let k = 0; k < 3; k++) { const g = prop('bicycle', -8.6 + k * 0.55, -3.55, Math.PI / 2 + 0.15); for (const z of [-0.5, 0.5]) { const w = mesh(new THREE.TorusGeometry(0.32, 0.025, 4, 12), M(PAL.charcoal), 0, 0.33, z, g); w.rotation.y = Math.PI / 2; }
  const f = mesh(box(0.04, 0.04, 0.95), M(k === 1 ? PAL.forest : PAL.brick), 0, 0.6, 0, g); f.rotation.x = 0.1; mesh(box(0.04, 0.5, 0.04), M(PAL.charcoal), 0, 0.55, 0.35, g); mesh(box(0.4, 0.04, 0.04), M(PAL.charcoal), 0, 0.82, 0.38, g); }
// station attendant at the door, travellers resting on the benches
const attendant = person({ top: PAL.navy, bottom: PAL.navy, skin: PAL.skin[1], hat: 'fedora', hatCol: PAL.navy, collar: PAL.golden, height: 1.68 }); attendant.position.set(-1.9, 0, FZ + 1.0); attendant.rotation.y = 0.5;
const sitter1 = person({ outfit: 'kimono', top: PAL.peach, bottom: '#C97E5A', obi: PAL.teal, skin: PAL.skin[0], hair: PAL.hair[1], bun: true, height: 1.5 }); sitter1.position.set(-6.4, 0, 0.62);
const sitter2 = person({ top: PAL.bluegrey, bottom: PAL.charcoal, skin: PAL.skin[2], hat: 'boater', height: 1.7, collar: PAL.offwhite }); sitter2.position.set(6.5, 0, 0.42);
// foreground for the hook: a potted pine and a stone lantern just inside the bottom-right of frame
if (T1) { const pine = prop('potted pine', 2.45, -0.7); pine.scale.setScalar(0.85); mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.36, 8), M(PAL.brick), 0, 0.18, 0, pine); mesh(blob(0.32, 0, 0.15), M(PAL.forest), 0, 0.62, 0, pine); mesh(blob(0.22, 0, 0.15), M(PAL.forest), 0.1, 0.9, 0.05, pine);
  const lan = prop('stone lantern', 1.35, 0.25); mesh(box(0.34, 0.12, 0.34), M('#9C958B'), 0, 0.06, 0, lan); mesh(box(0.12, 0.5, 0.12), M('#9C958B'), 0, 0.37, 0, lan); mesh(box(0.3, 0.24, 0.3), M('#A9A296', { emissive: C('#F2B53A'), emissiveIntensity: 0.15 }), 0, 0.74, 0, lan);
  const cap = mesh(new THREE.ConeGeometry(0.3, 0.2, 4), M('#8E877D'), 0, 0.96, 0, lan); cap.rotation.y = Math.PI / 4; }
// stone gutter across the plaza and iron drain covers (flat: walkers cross them)
mesh(box(30, 0.015, 0.35), M('#7E776E'), 0, 0.008, 0.7); for (const x of [-6, -2, 2, 6]) { const d = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 10), M('#7E776E', { roughness: 0.6, metalness: 0.2 }), x + 0.4, 0.012, 0.7); d; }
// stone bench and lantern near the wide cameras, and two direction posts (blank boards): foreground for T02/T03
{ const g = prop('stone bench', 0.4, 5.6); mesh(box(1.0, 0.12, 0.4), M('#9C958B'), 0, 0.42, 0, g); for (const x of [-0.38, 0.38]) mesh(box(0.16, 0.36, 0.34), M('#8E877D'), x, 0.18, 0, g); }
{ const g = prop('stone lantern', 1.6, 5.9); mesh(box(0.4, 0.14, 0.4), M('#9C958B'), 0, 0.07, 0, g); mesh(box(0.14, 0.6, 0.14), M('#9C958B'), 0, 0.44, 0, g); mesh(box(0.34, 0.28, 0.34), M('#A9A296', { emissive: C('#F2B53A'), emissiveIntensity: 0.15 }), 0, 0.88, 0, g); const c = mesh(new THREE.ConeGeometry(0.34, 0.22, 4), M('#8E877D'), 0, 1.13, 0, g); c.rotation.y = Math.PI / 4; }
for (const [x, z, col] of [[-1.35, 2.75, PAL.brick], [1.35, 2.3, PAL.teal]]) { const g = prop('direction post', x, z); mesh(box(0.1, 2.2, 0.1), M(PAL.wood), 0, 1.1, 0, g); mesh(box(0.7, 0.22, 0.04), M(col), 0.2, 1.9, 0, g); mesh(box(0.6, 0.06, 0.045), M(PAL.paper), 0.2, 1.9, 0, g); }
// taller city blocks behind the station so the skyline reads above its roof
for (const [x, h, col] of [[-13, 15, '#C9BBA8'], [-8, 17, '#B8C4CF'], [-3, 15, '#D3C2A6'], [2, 18, '#BFC6C9'], [7, 15, '#C9BBA8'], [12, 16.5, '#B8C4CF']]) { const g = prop('city block', x, -23); mesh(box(4.2, h, 4), M(col), 0, h / 2, 0, g);
  for (let k = 0; k < Math.floor(h / 2.4); k++) for (const wx of [-1.3, 0, 1.3]) mesh(box(0.7, 0.8, 0.05), M('#8E9BA8'), wx, 1.5 + k * 2.4, 2.03, g); mesh(box(4.4, 0.3, 4.2), M(PAL.bluegrey), 0, h + 0.15, 0, g); }
// tram on the road, roof vents, birds
const tram = prop('tram', -30, 13.5, 0); mesh(box(7.5, 2.2, 2.2), M('#E3D6B5'), 0, 1.45, 0, tram); mesh(box(7.5, 0.6, 2.25), M(PAL.forest), 0, 0.6, 0, tram); mesh(box(7.7, 0.15, 2.3), M(PAL.charcoal), 0, 2.62, 0, tram);
for (let k = 0; k < 6; k++) mesh(box(0.8, 0.7, 0.05), M('#F6E2B4', { emissive: C(PAL.golden), emissiveIntensity: 0.15 }), -3 + k * 1.2, 1.8, 1.11, tram); const pole = mesh(box(0.05, 1.6, 0.05), M(PAL.charcoal), 1.5, 3.3, 0, tram); pole.rotation.z = -0.6;
for (const x of [-5, 5]) { const g = prop('roof vent', x, -7.0, 0, 5.0); mesh(box(0.6, 1.2, 0.6), M(PAL.bluegrey), 0, 0.6, 0, g); mesh(box(0.8, 0.1, 0.8), M(PAL.navy), 0, 1.25, 0, g); }
const birds = []; for (let k = 0; k < 7; k++) { const g = new THREE.Group(); world.add(g); const l = mesh(box(0.28, 0.02, 0.08), M(PAL.charcoal), -0.14, 0, 0, g), r = mesh(box(0.28, 0.02, 0.08), M(PAL.charcoal), 0.14, 0, 0, g); birds.push({ g, l, r, o: rnd() }); }
atmo('crowd'); atmo('falling petals'); atmo('steam'); atmo('tram'); atmo('birds'); atmo('lanterns');
function life(t) { // background life shared by every shot
  steam.forEach((p) => { const q = (p.ph + t * 0.25) % 1; p.m.position.set(-5.15 + Math.sin(q * 6 + p.ph * 9) * 0.12 * q, 2.1 + q * 1.4, 1.75); p.m.scale.setScalar(0.4 + q * 1.6); p.m.material.opacity = 0.55 * (1 - q); });
  tram.position.x = -26 + t * 7.5; lanterns.forEach((g, k) => (g.rotation.z = 0.06 * Math.sin(t * 1.6 + k)));
  birds.forEach((b, k) => { const x = -14 + ((t * 3.2 + b.o * 6) % 30), y = 9.5 + Math.sin(k) * 0.8 + 0.15 * Math.sin(t * 3 + k), z = -6 + k * 0.6; b.g.position.set(x, y, z); b.l.rotation.z = 0.5 * Math.sin(t * 12 + k); b.r.rotation.z = -0.5 * Math.sin(t * 12 + k); });
  standPose(kioskMan, t); kioskMan.userData.hd.rotation.y = 0.3 * Math.sin(t * 0.7); standPose(potatoMan, t + 1); potatoMan.userData.arms[1].rotation.x = -0.6 + 0.25 * Math.sin(t * 2.2);
  sitPose(puller, t, 0.2 * Math.sin(t * 0.5)); standPose(attendant, t + 2); attendant.userData.hd.rotation.y = 0.35 * Math.sin(t * 0.45);
  sitPose(sitter1, t, 0.25 * Math.sin(t * 0.6 + 1)); sitPose(sitter2, t + 3, -0.2); queue.forEach((q, k) => standPose(q, t + k * 2)); }
// ---------------------------------------------------------------- falling petals / leaves / snow
const FALL = 260; const flakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.05), new THREE.MeshStandardMaterial({ color: C(PAL.blossom), side: THREE.DoubleSide, roughness: 0.9 }), FALL); world.add(flakes);
const fl = []; for (let i = 0; i < FALL; i++) fl.push({ x: -10 + rnd() * 20, z: -3 + rnd() * 12, ph: rnd(), sp: 0.5 + rnd() * 0.5, r: rnd() * 6 });
const dm = new THREE.Object3D();
function fall(t, col, speed = 1, scale = 1) { flakes.material.color.set(col); fl.forEach((f, i) => { const q = (f.ph + t * 0.09 * f.sp * speed) % 1; dm.position.set(f.x + Math.sin(t * 1.3 + f.r) * 0.4, 5.5 * (1 - q), f.z + Math.cos(t * 0.9 + f.r) * 0.3);
  dm.rotation.set(t * 2 + f.r, t * 1.5 + f.r, 0); dm.scale.setScalar(scale); dm.updateMatrix(); flakes.setMatrixAt(i, dm.matrix); }); flakes.instanceMatrix.needsUpdate = true; }

// snow cover on the ground and roof (winter)
const snowGround = new THREE.Mesh(new THREE.PlaneGeometry(40, 32), new THREE.MeshStandardMaterial({ color: C('#EEF2F4'), roughness: 0.95, transparent: true, opacity: 0 })); snowGround.material.map = null; snowGround.rotation.x = -Math.PI / 2; snowGround.position.set(0, 0.02, 4); snowGround.receiveShadow = true; world.add(snowGround);

// ---------------------------------------------------------------- people (shared kit), all paths clear the dog, benches, lamps and trees by >= 0.3 m
const DOGPOS = V(1.6, 0, -1.2);
const folk = [
  { o: { outfit: 'kimono', top: PAL.teal, bottom: PAL.teal, obi: PAL.golden, skin: PAL.skin[0], hair: PAL.hair[0], bun: true, height: 1.55 } },
  { o: { top: PAL.wood, bottom: PAL.charcoal, skin: PAL.skin[1], hat: 'boater', height: 1.68, collar: PAL.offwhite } },
  { o: { outfit: 'kimono', top: PAL.brick, bottom: '#8E4A3A', obi: PAL.cream, skin: PAL.skin[1], hair: PAL.hair[1], bun: true, height: 1.52 } },
  { o: { top: PAL.navy, bottom: PAL.navy, skin: PAL.skin[2], hat: 'fedora', hatCol: PAL.charcoal, height: 1.72, collar: PAL.offwhite } },
  { o: { top: '#E8D2B0', bottom: PAL.warmgrey, skin: PAL.skin[1], hair: PAL.hair[0], height: 1.25 } },    // a schoolboy
  { o: { outfit: 'kimono', top: PAL.forest, bottom: PAL.forest, obi: PAL.peach, skin: PAL.skin[0], hair: PAL.hair[0], bun: true, height: 1.58 } },
  { o: { top: PAL.bluegrey, bottom: PAL.charcoal, skin: PAL.skin[2], hat: 'boater', height: 1.7, collar: PAL.offwhite } },
  { o: { top: PAL.charcoal, bottom: PAL.charcoal, skin: PAL.skin[1], hat: 'fedora', hatCol: PAL.wood, height: 1.66, collar: PAL.offwhite } },
];
const doorOut = (k) => [[3.2, FZ - 1.75], [0.2 * (k % 3) - 0.2, FZ - 1.75], [0.2 * (k % 3) - 0.2, FZ + 1.8]];  // from the platform passage
// routes leave the door and fan out across the plaza, or come in from the street
const ROUTES = [
  [...doorOut(0), [-2.5, 2.0], [-5.6, 9.5]], [...doorOut(1), [-0.6, 3.0], [-1.6, 10.2]], [...doorOut(2), [1.0, 3.5], [5.4, 10.2]],
  [[-10, 9.6], [-3.0, 6.0], [-0.3, FZ + 2.0], [-0.3, FZ - 1.75], [3.2, FZ - 1.75]], [[9.5, 9.0], [3.0, 5.0], [0.3, FZ + 2.0], [0.3, FZ - 1.75], [3.2, FZ - 1.75]],
  [[-12.4, 7.0], [12.4, 7.6]], [[12.4, 3.6], [5.6, 3.0], [-5.6, 3.6], [-12.4, 4.0]], [[-2.0, 10.5], [-2.6, 4.5], [-3.2, -0.5], [-11.6, -0.6]],
];
const ppl = folk.map((f) => person(f.o));
// trampled, slushy tracks in the snow wherever people walk, plus the dog's own patch (winter detail; no blank white field)
snowGround.material.map = canvasTex(2048, 1640, (g, w, h) => { g.fillStyle = '#EEF2F4'; g.fillRect(0, 0, w, h); const P = ([x, z]) => [(x + 20) / 40 * w, (z + 12) / 32 * h];
  for (let i = 0; i < 16000; i++) { g.fillStyle = `rgba(110,125,140,${0.18 + rnd() * 0.22})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 3 + rnd() * 5, 5 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(95,105,118,${0.25 + rnd() * 0.2})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 12 + rnd() * 28, 8 + rnd() * 18, rnd() * 3, 0, 7); g.fill(); }  // footprints and slush
  g.lineCap = g.lineJoin = 'round'; for (const r of ROUTES) for (const [lw, a] of [[60, 0.35], [26, 0.5]]) { g.strokeStyle = `rgba(120,128,138,${a})`; g.lineWidth = lw; g.beginPath(); r.forEach((p, k) => { const [x, y] = P(p); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  // the station hand's shovelled path from the gates toward the street: wet stone, banked edges
  for (const [lw, col] of [[118, 'rgba(225,232,238,0.9)'], [96, 'rgba(92,100,110,0.55)']]) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); [[0, -4.2], [-0.4, 1.0], [-1.2, 4.5], [-1.6, 8.0]].forEach((p, k) => { const [x, y] = P(p); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  g.strokeStyle = 'rgba(70,78,88,0.5)'; g.lineWidth = 3; for (let z = -4; z < 8; z += 0.5) { const x = -0.4 * Math.min(1, (z + 4.2) / 5.2) - Math.max(0, (z - 1) / 3.5) * 0.8; const [a, b] = P([x - 0.55, z]), [c] = P([x + 0.55, z]); g.beginPath(); g.moveTo(a, b); g.lineTo(c, b); g.stroke(); }
  const [dx, dy] = P([DOGPOS.x, DOGPOS.z]); for (let k = 0; k < 40; k++) { const an = k * 0.55, rr = 30 + 8 * Math.sin(k); g.fillStyle = 'rgba(100,92,84,0.5)'; g.beginPath(); g.ellipse(dx + Math.cos(an) * rr, dy + Math.sin(an) * rr * 0.8, 4, 5, an, 0, 7); g.fill(); }  // paw prints where he circles
 g.fillStyle = 'rgba(140,130,118,0.35)'; g.beginPath(); g.ellipse(dx, dy, 44, 32, 0, 0, 7); g.fill(); });
snowGround.material.color.set('#FFFFFF'); snowGround.material.needsUpdate = true;
let crowd = [];
function useCrowd(plan) { crowd = plan.map(([i, r, t0, sp]) => ({ p: ppl[i], go: walker(ppl[i], ROUTES[r], t0, sp) })); ppl.forEach((p) => (p.visible = false)); }

// ---------------------------------------------------------------- Hachiko and Prof. Ueno (registered in SKILL.md section 9)
const hachi = dog({ coat: '#E9D3AE', belly: '#F7EEDD', dark: PAL.wood, collar: PAL.brick, size: T2 ? 0.9 : 1 });
hero(hachi); hachi.position.copy(DOGPOS); hachi.rotation.y = D(2);

let update = () => {}, overlay = () => {};

if (T1) { // hook: frame 1 = thumbnail. Old Hachiko waits; looks up at each person leaving the station.
  setSeason(0.15);
  useCrowd([[0, 0, -1.2, 1], [1, 2, 1.6, 1], [3, 1, 3.9, 1], [5, 6, -6, 1], [6, 5, -3, 1], [7, 3, -4.5, 1]]);
  const looks = [[0.2, 1.6], [2.6, 4.0], [4.8, 6.6]];
  update = (t, u, e) => { life(t); crowd.forEach((c) => c.go(t)); fall(t, PAL.blossom, 1, 1.0); mm.rotation.z = -t * 0.03; hh.rotation.z = -1.1;
    let look = D(8) + 0.04 * Math.sin(t * 0.8); for (const [a, b] of looks) look += D(22) * (sm(a, a + 0.45, t) - sm(b - 0.45, b, t));
    dogSit(hachi, t, look, true); hachi.userData.neck.rotation.x = 0.55 + 0.12 * (sm(0.2, 0.6, t) - sm(1.2, 1.6, t) + sm(2.6, 3.0, t) - sm(3.6, 4.0, t) + sm(4.8, 5.2, t) - sm(6.2, 6.6, t));
    hachi.userData.tail.rotation.z = 0.06 * Math.sin(t * 2.5);
    orbit(V(DOGPOS.x - 0.15, 0.85, DOGPOS.z), D(22 + 4 * e), D(6), mix(3.6, 3.25, e)); camera.fov = 50; camera.updateProjectionMatrix(); };
  overlay = (t) => card('He Waited\nEvery Day', { y: 0.2, size: 0.058 });
}

if (T2) { // 1924: Ueno walks to the station with young Hachiko, goes in; the dog sits by the door.
  setSeason(0.3); sun.intensity = 3.1; fill.intensity = 0.35; sun.color = C('#FFE6C2');
  const ueno = person({ top: PAL.charcoal, bottom: PAL.charcoal, skin: '#E0AE84', hair: '#1F1A17', hat: 'fedora', hatCol: PAL.navy, collar: PAL.offwhite, bag: PAL.wood, height: 1.66, step: 0.72, cadence: 1.85 });
  hero(ueno); const path = [[-2.4, 2.6], [-0.3, -1.4], [0.0, FZ - 1.75], [3.2, FZ - 1.75]]; const uGo = walker(ueno, path, 0.0);
  const dogPath = [[-1.75, 2.85], [0.35, -1.25], [0.9, FZ + 1.35]]; const v = 0.72 * 1.85;
  const dpts = dogPath.map(([x, z]) => V(x, 0, z)); const dlen = dpts[0].distanceTo(dpts[1]) + dpts[1].distanceTo(dpts[2]);
  hachi.userData.cadence = v / hachi.userData.step;
  useCrowd([[0, 5, -2, 1], [1, 7, -1.5, 1], [5, 6, -5, 1], [4, 4, 2.2, 1], [6, 2, -2.4, 1]]);
  update = (t, u, e) => { life(t); uGo(t); if (!ueno.visible && t < 1) ueno.visible = true; crowd.forEach((c) => c.go(t)); fall(t, PAL.blossom, 1, 0.9); mm.rotation.z = -1.6 - t * 0.03; hh.rotation.z = -4.2;
    const dd = Math.min(t * v, dlen); let pos; if (dd < dpts[0].distanceTo(dpts[1])) pos = dpts[0].clone().lerp(dpts[1], dd / dpts[0].distanceTo(dpts[1]));
    else { const a = dpts[0].distanceTo(dpts[1]); pos = dpts[1].clone().lerp(dpts[2], (dd - a) / dpts[1].distanceTo(dpts[2])); }
    const seg = dd < dpts[0].distanceTo(dpts[1]) ? [dpts[0], dpts[1]] : [dpts[1], dpts[2]]; hachi.position.copy(pos);
    const settle = sm(dlen / v, dlen / v + 0.7, t);
    if (dd < dlen) { hachi.rotation.y = Math.atan2(seg[1].x - seg[0].x, seg[1].z - seg[0].z); dogWalk(hachi, dd, t); }
    else { hachi.rotation.y = mix(Math.atan2(seg[1].x - seg[0].x, seg[1].z - seg[0].z), D(200), settle); if (settle < 0.5) dogWalk(hachi, dlen, t); else dogSit(hachi, t, D(-15), false); }
    const fx = clamp(ueno.position.z, FZ, 3), tg = V(mix(-1.6, 0.2, e), 0.9, mix(1.2, -2.0, e)); orbit(tg, D(24 + 10 * e), D(28), mix(9.0, 8.2, e)); camera.fov = 56; fx; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Shibuya, 1924', { y: 0.2, size: 0.05, alpha: sm(0.0, 0.01, t) });
}

if (T3) { // the years: locked-off wide; spring, summer, autumn, winter while he stays
  useCrowd([[0, 0, -1, 2.4], [1, 3, -2, 2.4], [2, 6, -4, 2.4], [3, 2, 0.6, 2.4], [5, 1, 2.2, 2.4], [6, 4, 1.0, 2.4], [7, 5, -3, 2.4], [4, 7, 3.0, 2.4]]);
  // winter travellers who arrive late, so the plaza is busy to the last frame
  const late = [[PAL.brick, 6, 4.6], [PAL.teal, 0, 4.9], [PAL.golden, 3, 5.2], [PAL.forest, 2, 5.6]].map(([col, r, t0]) => { const p = person({ top: col, bottom: PAL.charcoal, skin: PAL.skin[(r + 1) % 4], hat: 'fedora', hatCol: PAL.charcoal, height: 1.66 });
    const g = new THREE.Group(); p.add(g); g.position.set(0.12, 1.86, 0.05); mesh(new THREE.ConeGeometry(0.55, 0.22, 10), M(col === PAL.golden ? PAL.navy : PAL.golden), 0, 0, 0, g); mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4), M(PAL.wood), 0, -0.35, 0, g);
    return { p, go: walker(p, ROUTES[r], t0, 1.6) }; });
  crowd.push(...late);
  const roofBase = C(PAL.bluegrey);
  // winter activity: a station hand clears the snow into piles
  const piles = [[2.5, 0.8, 0.45], [3.3, 1.5, 0.35], [-6.0, -2.0, 0.5]].map(([x, z, r]) => { const g = prop('snow pile', x, z); mesh(blob(r, 1, 0.2), M('#F2F5F7'), 0, r * 0.35, 0, g).scale.y = 0.55; g.visible = false; return g; });
  const shoveler = person({ top: PAL.navy, bottom: PAL.navy, skin: PAL.skin[1], hat: 'fedora', hatCol: PAL.navy, collar: PAL.golden, height: 1.68 }); shoveler.position.set(3.4, 0, 0.5); shoveler.rotation.y = -1.9;
  { const sh = new THREE.Group(); shoveler.userData.arms[0].userData.hand.add(sh); mesh(box(0.03, 0.9, 0.03), M(PAL.wood), 0, -0.3, 0.1, sh); mesh(box(0.25, 0.03, 0.3), M('#6E6A66'), 0, -0.75, 0.2, sh); }
  const umbr = ppl.map((p, k) => { const g = new THREE.Group(); p.add(g); g.position.set(0.12, p.userData.h * 1.12, 0.05); const c = mesh(new THREE.ConeGeometry(0.55, 0.22, 10), M([PAL.brick, PAL.navy, PAL.golden, PAL.teal][k % 4]), 0, 0, 0, g);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4), M(PAL.wood), 0, -0.35, 0, g); g.visible = false; c; return g; });
  update = (t, u, e) => { life(t); const s = t / 7 * 3.25; setSeason(s); crowd.forEach((c) => c.go(t));
    petalsOnGround.visible = s < 1.0 || (s > 2.0 && s < 2.9); petalsOnGround.material.color.set(s < 1 ? PAL.blossom : PAL.amber); umbr.forEach((g) => (g.visible = s > 2.7)); piles.forEach((p) => (p.visible = s > 2.75)); shoveler.visible = s > 2.75; if (shoveler.visible) { standPose(shoveler, t); shoveler.userData.arms.forEach((a) => (a.rotation.x = -0.9 + 0.5 * Math.sin(t * 4))); shoveler.userData.body.rotation.x = 0.25 + 0.15 * Math.sin(t * 4); } const wint = sm(2.55, 3.0, s); snowGround.material.opacity = 0.62 * wint; renderer.toneMappingExposure = mix(1.05, 0.92, wint); roof.material.color.copy(roofBase.clone().lerp(C(PAL.offwhite), wint * 0.4));
    if (s < 1) fall(t, PAL.blossom, 1.4, 1); else if (s < 2) fall(t, PAL.blossom, 1.4, 0.001); else if (s < 2.6) fall(t, PAL.amber, 1.2, 1.4); else fall(t, PAL.offwhite, 0.8, 1.6);
    sun.intensity = mix(3.1, 2.0, wint); hemi.intensity = mix(1.1, 1.35, wint); fill.intensity = mix(0.3, 0.55, wint); hemi.color.set(C('#CFE6F7').lerp(C('#DCE6EE'), wint)); grade.uniforms.cool.value = 0.5 * wint;
    dogSit(hachi, t, D(-10) + D(-35) * (sm(1.0, 1.4, t) - sm(2.2, 2.6, t)), true); mm.rotation.z = -t * 3; hh.rotation.z = -t * 0.25;
    orbit(V(0.9, 1.1, -1.2), D(-16), D(25), 9.2); camera.fov = 54; camera.updateProjectionMatrix(); };
  overlay = (t) => card('For Nearly\n10 Years', { y: 0.2, size: 0.056, alpha: sm(3.6, 4.1, t) });
}

run(update, overlay);
