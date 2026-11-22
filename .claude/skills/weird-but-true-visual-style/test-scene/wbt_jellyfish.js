// Weird But True Short (Sat): "The Jellyfish That Turns Back Into a Baby" (Turritopsis dohrnii). Style skill v1.2.
// Facts: a hydrozoan medusa of about 4.5 mm with a red stomach; when starved, injured or old it can shrink into a cyst,
// settle and grow back into a polyp colony that buds new medusae (reverse development). Found by a German marine-biology
// student, Christian Sommer, who collected hydrozoans off Rapallo on the Italian Riviera in 1988 and kept them in jars;
// published in 1996 (Bavestrello, Boero, Piraino and colleagues). It is still eaten by fish and killed by disease: not truly immortal.
// Shots (7 s each, 720x1280, 30 fps):
// K01 hook: close underwater, a tiny jellyfish pulses, shrinks into a blob and settles as a polyp (close, macro, push-in)
// K02 1988: Rapallo harbour, pastel houses, boats, a student on a jetty with a plankton net (elevated wide, slow orbit)
// K03 the lab: a bench of seawater jars; in one jar the jellies have become polyps (medium, push-in to the jar)
// K04 the cycle: medusa, then blob, then polyp colony, with new medusae budding off (medium, slow rise)
// K05 not immortal: a bright reef where a fish snaps up drifting jellies (wide, gentle drift)
import { renderer, THREE, SHOT, rnd, C, V, D, sm, mix, clamp, PAL, world, scene, sky, hemi, sun, fill, camera, grade, M, mesh, box, blob, canvasTex,
  person, walker, standPose, prop, orbit, card, run, hero, atmo } from './wbt_kit.js';

const K1 = SHOT === 'K01', K2 = SHOT === 'K02', K3 = SHOT === 'K03', K4 = SHOT === 'K04', K5 = SHOT === 'K05';
const UNDER = K1 || K4 || K5;
window.SHOT_SIZE = K1 ? 'close' : K2 || K5 ? 'wide' : 'medium';
const RED = '#D9452B', CYST = '#E98E66', POLYP = '#F2A48C', STALK = '#C8A57E';

// ---------------------------------------------------------------- the animal (registered look: clear bell, red cross-shaped stomach, white rim and tentacles)
function jelly(r = 0.3, parent = world) {
  const g = new THREE.Group(); parent.add(g); g.userData.prop = true; g.name = 'jellyfish';
  const bellM = new THREE.MeshStandardMaterial({ color: C('#EAF6F8'), transparent: true, opacity: 0.55, roughness: 0.25, flatShading: true, emissive: C('#CFEFF4'), emissiveIntensity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const bell = new THREE.Group(); g.add(bell);
  bell.add(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), bellM));
  const red = M(RED, { emissive: C('#C8361E'), emissiveIntensity: 0.55 });
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; mesh(new THREE.IcosahedronGeometry(r * 0.2, 0), red, Math.cos(a) * r * 0.24, r * 0.4, Math.sin(a) * r * 0.2, bell).scale.set(1, 0.6, 1); }
  mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.12, r * 0.5, 6), red, 0, r * 0.15, 0, bell);   // manubrium
  // four radial canals and gonads along the bell, a ring canal near the rim, a faint inner bell: what makes it read as a hydromedusa
  const canalM = M('#F7E9E4', { transparent: true, opacity: 0.85 });
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; for (let i = 0; i < 6; i++) { const th = (i + 0.5) / 6 * Math.PI * 0.5; const c = mesh(box(r * 0.03, r * 0.27, r * 0.015), canalM, Math.cos(a) * Math.sin(th) * r * 1.005, Math.cos(th) * r * 1.005, Math.sin(a) * Math.sin(th) * r * 1.005, bell); c.lookAt(0, 0, 0); }
    mesh(new THREE.IcosahedronGeometry(r * 0.1, 0), M('#F2A06A', { emissive: C('#C8602E'), emissiveIntensity: 0.3 }), Math.cos(a) * r * 0.55, r * 0.62, Math.sin(a) * r * 0.55, bell).scale.set(0.7, 1.3, 0.7); }
  const ringc = mesh(new THREE.TorusGeometry(r * 0.9, r * 0.012, 3, 24), canalM, 0, r * 0.12, 0, bell); ringc.rotation.x = Math.PI / 2;
  bell.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: C('#DDF2F6'), transparent: true, opacity: 0.25, flatShading: true, depthWrite: false, side: THREE.DoubleSide })));
  const rim = mesh(new THREE.TorusGeometry(r * 0.98, r * 0.035, 4, 24), M(PAL.offwhite), 0, -r * 0.05, 0, bell); rim.rotation.x = Math.PI / 2;
  const tents = []; const tm = M(PAL.offwhite, { transparent: true, opacity: 0.85 });
  for (let k = 0; k < 44; k++) { const a = k / 44 * Math.PI * 2; const P = new THREE.Group(); P.position.set(Math.cos(a) * r * 0.96, -r * 0.05, Math.sin(a) * r * 0.96); P.rotation.y = -a; bell.add(P);
    const Q = new THREE.Group(); P.add(Q); const L = r * (0.45 + 0.35 * ((k * 7) % 5) / 5); const m = mesh(new THREE.CylinderGeometry(r * 0.01, r * 0.004, L, 3), tm, 0, -L / 2, 0, Q); m.castShadow = false; tents.push({ Q, ph: k * 0.7 }); }
  const cyst = mesh(blob(r * 0.38, 1, 0.18), M(CYST, { emissive: C('#C2603E'), emissiveIntensity: 0.2 }), 0, 0, 0, g); cyst.visible = false;
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; }); g.userData.j = { bell, bellM, tents, cyst, r };
  return g;
}
// pulse: a quick contraction then a slow relax; m = 0 medusa .. 1 cyst (bell shrinks, tentacles pull in, the blob grows)
function pulse(g, t, m = 0, speed = 1.2, ph = 0) { const j = g.userData.j; const q = ((t * speed + ph) % 1); const c = q < 0.3 ? sm(0, 0.3, q) : 1 - sm(0.3, 1, q);
  const s = mix(1, 0.25, m); j.bell.scale.set(s * (1 - 0.16 * c * (1 - m)), s * (1 + 0.1 * c * (1 - m)), s * (1 - 0.16 * c * (1 - m)));
  j.tents.forEach((tn) => { tn.Q.rotation.z = (0.55 - 0.4 * c) * (1 - m) + 0.12 * Math.sin(t * 2.4 + tn.ph); tn.Q.scale.y = Math.max(0.02, 1 - m * 1.1); });
  j.bellM.opacity = 0.55 * (1 - sm(0.6, 1, m)); j.bell.visible = m < 0.98; j.cyst.visible = m > 0.3; j.cyst.scale.setScalar(Math.max(0.01, sm(0.3, 1, m))); return c; }

// polyp: stalk, hydranth and a ring of tentacles; grow 0..1
function polyp(h, parent) { const g = new THREE.Group(); parent.add(g);
  const st = mesh(new THREE.CylinderGeometry(h * 0.014, h * 0.022, h, 5), M('#E2BCA4'), 0, h / 2, 0, g); st.geometry.translate(0, 0, 0);
  const hy = new THREE.Group(); g.add(hy); mesh(new THREE.ConeGeometry(h * 0.11, h * 0.24, 7), M(POLYP, { emissive: C('#D9806A'), emissiveIntensity: 0.15 }), 0, h * 0.05, 0, hy).rotation.x = Math.PI;
  const tt = []; for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; const P = new THREE.Group(); P.position.set(Math.cos(a) * h * 0.07, h * 0.06, Math.sin(a) * h * 0.06); P.rotation.y = -a; hy.add(P);
    mesh(new THREE.CylinderGeometry(h * 0.012, h * 0.005, h * 0.3, 3), M('#FBE3D8'), 0, h * 0.15, 0, P); tt.push(P); }
  hy.position.y = h;
  g.userData.grow = (k, t = 0) => { k = clamp(k); g.visible = k > 0.02; g.scale.setScalar(Math.max(0.001, k)); tt.forEach((P, i) => (P.rotation.z = -mix(0.1, 1.1, sm(0.6, 1, k)) - 0.1 * Math.sin(t * 2 + i))); g.rotation.z = 0.06 * Math.sin(t * 0.9 + h * 20); };
  return g; }

// ---------------------------------------------------------------- underwater set pieces
function water(near, far) {
  scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#47C8E4'); gr.addColorStop(0.45, '#1C9CCB'); gr.addColorStop(1, '#0F70A8'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  scene.fog = new THREE.Fog(C('#1E92C4'), near, far);
  hemi.color.set(C('#A8E6F0')); hemi.groundColor.set(C('#B89E6E')); hemi.intensity = 1.15; sun.color = C('#F0FAF6'); sun.intensity = 2.8; sun.position.set(-3, 16, 5); fill.color = C('#9FE3EC'); fill.intensity = 0.5;
  renderer.toneMappingExposure = 1.0;
}
const sandTex = () => { const t = canvasTex(512, 512, (g) => { g.fillStyle = '#DDAA5C'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4200; i++) { g.fillStyle = `rgba(${rnd() < 0.55 ? '140,105,60' : '250,236,200'},${0.25 + rnd() * 0.3})`; g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 4, 2 + rnd() * 3); }
  g.strokeStyle = 'rgba(130,95,55,0.5)'; g.lineWidth = 5; for (let y = 10; y < 512; y += 26) { g.beginPath(); for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + 6 * Math.sin(x / 40 + y)); g.stroke(); } });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
function seabed(size, rep, y = 0) { const tx = sandTex(); tx.repeat.set(rep, rep); const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 30, 30), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.95, flatShading: true }));
  const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.08 * Math.sin(p.getX(i) * 0.9) * Math.cos(p.getY(i) * 0.7) * size / 20 + (rnd() - 0.5) * 0.03 * size / 20);
  m.geometry.computeVertexNormals(); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; world.add(m); return m; }
const ROCKC = ['#8C8A84', '#9E968A', '#7E8A8C'];
let rockTex = null; const rockMat = () => { if (!rockTex) { rockTex = canvasTex(256, 256, (g) => { g.fillStyle = '#B07C5E'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) { g.fillStyle = ['rgba(214,120,150,0.4)', 'rgba(120,170,90,0.4)', 'rgba(150,110,170,0.3)', 'rgba(230,180,110,0.35)', 'rgba(60,70,66,0.35)', 'rgba(235,230,215,0.3)'][i % 6]; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 2 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, 7); g.fill(); } });
  rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping; rockTex.repeat.set(3, 3); } return new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.9, flatShading: true }); };
function rock(x, z, r, y = 0, col) { const g = prop('rock', x, z, rnd() * 6, y); const m = mesh(blob(r, 1, 0.22), col ? M(col) : rockMat(), 0, r * 0.35, 0, g); m.scale.y = 0.65;
  for (let k = 0; k < 3; k++) { const a = rnd() * 6.28; mesh(blob(r * 0.25, 0, 0.2), M([PAL.leaf, '#C9706A', PAL.golden][k]), Math.cos(a) * r * 0.55, r * 0.7, Math.sin(a) * r * 0.55, g).scale.y = 0.5; } return g; }
const sway = [];
function seagrass(x, z, h, n = 7) { const g = prop('seagrass', x, z, rnd() * 6); for (let k = 0; k < n; k++) { const b = new THREE.Group(); b.position.set((rnd() - 0.5) * h * 0.4, 0, (rnd() - 0.5) * h * 0.4); g.add(b);
  const l = h * (0.6 + rnd() * 0.5); mesh(box(h * 0.05, l, h * 0.012), M(k % 3 ? PAL.leaf : PAL.forest), 0, l / 2, 0, b); b.rotation.y = rnd() * 3; sway.push({ b, ph: rnd() * 6, a: 0.12 }); } return g; }
function coralBranch(x, z, h, col, y = 0) { const g = prop('branching coral', x, z, rnd() * 6, y); const mat = M(col);
  const grow = (p, len, rad, depth) => { const c = mesh(new THREE.CylinderGeometry(rad * 0.7, rad, len, 5), mat, 0, len / 2, 0, p); c.geometry.translate(0, 0, 0); if (depth > 2) return;
    for (let k = 0; k < 3; k++) { const q = new THREE.Group(); q.position.y = len * (0.55 + 0.4 * k / 3); q.rotation.set((rnd() - 0.5) * 1.4, rnd() * 6, (rnd() - 0.5) * 1.4); p.add(q); grow(q, len * 0.6, rad * 0.7, depth + 1); } };
  grow(g, h * 0.45, h * 0.07, 0); return g; }
function brainCoral(x, z, r, col, y = 0) { const g = prop('brain coral', x, z, rnd() * 6, y); const m = mesh(blob(r, 1, 0.1), M(col), 0, r * 0.4, 0, g); m.scale.y = 0.6;
  for (let k = 0; k < 6; k++) { const t = mesh(new THREE.TorusGeometry(r * (0.3 + k * 0.1), r * 0.03, 3, 14), M(C(col).multiplyScalar(0.8).getStyle()), 0, r * 0.62 - k * r * 0.04, 0, g); t.rotation.x = Math.PI / 2; } return g; }
function fanCoral(x, z, h, col, y = 0) { const g = prop('sea fan', x, z, rnd() * 3, y); const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(-h * 0.6, h * 0.4, -h * 0.5, h, 0, h); sh.bezierCurveTo(h * 0.5, h, h * 0.6, h * 0.4, 0, 0);
  const m = mesh(new THREE.ShapeGeometry(sh, 6), M(col, { side: THREE.DoubleSide, transparent: true, opacity: 0.92 }), 0, 0, 0, g); sway.push({ b: m, ph: rnd() * 6, a: 0.05 });
  for (let k = 0; k < 5; k++) { const v = mesh(box(h * 0.015, h * 0.8, h * 0.02), M(C(col).multiplyScalar(0.7).getStyle()), (k - 2) * h * 0.1, h * 0.42, 0.005, m); v.rotation.z = (k - 2) * 0.25; } return g; }
function anemone(x, z, r, col, y = 0) { const g = prop('anemone', x, z, 0, y); mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.6, r * 0.6, 8), M(col), 0, r * 0.3, 0, g);
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; const P = new THREE.Group(); P.position.set(Math.cos(a) * r * 0.4, r * 0.6, Math.sin(a) * r * 0.4); P.rotation.y = -a; g.add(P);
    mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.03, r * 0.8, 4), M(C(col).lerp(C(PAL.offwhite), 0.4).getStyle()), 0, r * 0.4, 0, P); sway.push({ b: P, ph: k, a: 0.18, z: true }); } return g; }
function sponge(x, z, h, col, y = 0) { const g = prop('tube sponge', x, z, 0, y); for (let k = 0; k < 3; k++) mesh(new THREE.CylinderGeometry(h * 0.13, h * 0.16, h * (0.6 + 0.3 * k), 7, 1, true), M(col, { side: THREE.DoubleSide }), (k - 1) * h * 0.22, h * (0.3 + 0.15 * k), (k % 2) * h * 0.1, g); return g; }
function starfish(x, z, r, col, y = 0) { const g = prop('starfish', x, z, rnd() * 6, y); for (let k = 0; k < 5; k++) { const a = k / 5 * 6.28; const m = mesh(new THREE.ConeGeometry(r * 0.22, r, 4), M(col), Math.cos(a) * r * 0.45, r * 0.08, Math.sin(a) * r * 0.45, g); m.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2); m.scale.z = 0.4; }
  mesh(new THREE.IcosahedronGeometry(r * 0.22, 0), M(col), 0, r * 0.08, 0, g); return g; }
function shell(x, z, r, y = 0) { const g = prop('shell', x, z, rnd() * 6, y); const m = mesh(new THREE.ConeGeometry(r, r * 1.6, 6), M(PAL.peach), 0, r * 0.5, 0, g); m.rotation.z = 1.2; return g; }
// fish: faceted body, tail and fins; wag with the swim
function fish(col, len, parent = world, stripe) { const g = new THREE.Group(); parent.add(g); g.userData.prop = true; g.name = 'fish';
  const b = mesh(new THREE.IcosahedronGeometry(1, 1), M(col), 0, 0, 0, g); b.scale.set(len * 0.13, len * 0.24, len * 0.5);
  if (stripe) for (const z of [0.12, -0.12]) { const s = mesh(new THREE.IcosahedronGeometry(1, 1), M(stripe), 0, 0, z * len, g); s.scale.set(len * 0.135, len * 0.2, len * 0.05); }
  const tail = new THREE.Group(); tail.position.z = -len * 0.45; g.add(tail); const tm = mesh(new THREE.ConeGeometry(len * 0.2, len * 0.32, 3), M(col), 0, 0, -len * 0.12, tail); tm.rotation.x = -Math.PI / 2; tm.scale.x = 0.25;
  mesh(new THREE.ConeGeometry(len * 0.1, len * 0.22, 3), M(col), 0, len * 0.22, -len * 0.05, g).scale.z = 0.3;
  for (const s of [-1, 1]) { mesh(new THREE.CircleGeometry(len * 0.045, 6), M(PAL.offwhite), s * len * 0.12, len * 0.05, len * 0.3, g).rotation.y = s * Math.PI / 2; mesh(new THREE.CircleGeometry(len * 0.025, 6), M(PAL.ink), s * len * 0.125, len * 0.05, len * 0.31, g).rotation.y = s * Math.PI / 2; }
  g.userData.tail = tail; return g; }
const swimmers = [];
// a school circling a centre: count, radius, height, speed, colours
function school(n, cx, cy, cz, rad, len, cols, speed = 0.4, stripe) { const f = []; for (let k = 0; k < n; k++) { const s = fish(cols[k % cols.length], len * (0.85 + rnd() * 0.3), world, stripe); f.push({ s, a: rnd() * 6.28, dr: (rnd() - 0.5) * rad * 0.5, dy: (rnd() - 0.5) * rad * 0.4, sp: speed * (0.9 + rnd() * 0.2) }); }
  swimmers.push({ f, cx, cy, cz, rad }); }
function swim(t) { for (const sc of swimmers) for (const q of sc.f) { const a = q.a + t * q.sp, r = sc.rad + q.dr; q.s.position.set(sc.cx + Math.cos(a) * r, sc.cy + q.dy + 0.1 * Math.sin(t * 1.3 + q.a), sc.cz + Math.sin(a) * r * 0.6);
  q.s.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a) * 0.6) * 1 + 0; q.s.userData.tail.rotation.y = 0.45 * Math.sin(t * 12 + q.a * 5); } }
// marine snow and drifting particles
function snow(n, cx, cy, cz, sx, sy, sz, size) { const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color: C('#F4FBFA'), transparent: true, opacity: 0.7 }), n); world.add(im);
  const pts = []; for (let i = 0; i < n; i++) pts.push([rnd(), rnd(), rnd(), rnd()]); const o = new THREE.Object3D();
  return (t) => { pts.forEach(([a, b, c, d], i) => { o.position.set(cx + (a - 0.5) * sx + 0.1 * sx * Math.sin(t * 0.3 + d * 9) * 0.1, cy + (((b + t * 0.015 * (0.5 + d)) % 1) - 0.5) * sy, cz + (c - 0.5) * sz); o.scale.setScalar(0.6 + d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.instanceMatrix.needsUpdate = true; }; }
// light shafts from the surface (additive, never blown: opacity <= 0.16)
function shafts(n, cx, cz, w, top, spread) { const tex = canvasTex(64, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(1, 'rgba(255,255,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  const gx = g.createLinearGradient(0, 0, 64, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 64, 256); });
  const s = []; for (let k = 0; k < n; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w * (0.6 + rnd() * 0.8), top), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(cx + (rnd() - 0.5) * spread, top / 2, cz + (rnd() - 0.5) * spread * 0.6); m.rotation.z = 0.18; world.add(m); s.push({ m, ph: rnd() * 6 }); }
  return (t) => s.forEach((q) => { q.m.lookAt(camera.position.x, q.m.position.y, camera.position.z); q.m.rotateZ(0.18); q.m.material.opacity = 0.1 + 0.05 * Math.sin(t * 0.8 + q.ph); }); }
function swayAll(t) { sway.forEach((q) => { if (q.z) q.b.rotation.z = -0.5 - q.a * Math.sin(t * 1.4 + q.ph); else { q.b.rotation.z = q.a * Math.sin(t * 1.1 + q.ph); q.b.rotation.x = q.a * 0.6 * Math.sin(t * 0.9 + q.ph * 2); } }); }

function urchin(x, z, r, y = 0) { const g = prop('sea urchin', x, z, 0, y); mesh(new THREE.IcosahedronGeometry(r, 0), M('#4A3A6A'), 0, r * 0.7, 0, g); for (let k = 0; k < 14; k++) { const v = new THREE.Vector3(rnd() - 0.5, rnd() * 0.8, rnd() - 0.5).normalize(); const sp = mesh(new THREE.ConeGeometry(r * 0.08, r * 1.6, 3), M('#5E4A86'), v.x * r, r * 0.7 + v.y * r, v.z * r, g); sp.lookAt(g.position.clone().add(v.clone().multiplyScalar(5)).add(V(0, r, 0))); sp.rotateX(Math.PI / 2); } return g; }
function fanworm(x, z, h, col, y = 0) { const g = prop('fan worm', x, z, 0, y); mesh(new THREE.CylinderGeometry(h * 0.04, h * 0.05, h, 5), M('#B9A27E'), 0, h / 2, 0, g); for (let k = 0; k < 10; k++) { const a = k / 10 * 6.28; const P = new THREE.Group(); P.position.y = h; P.rotation.y = a; g.add(P); const f = mesh(box(h * 0.02, h * 0.4, h * 0.03), M(col), 0, h * 0.2, 0, P); f; P.rotation.z = 0; P.children[0].rotation.x = 0.6; sway.push({ b: P, ph: k * 0.3, a: 0.08 }); } return g; }
function algae(x, z, h, col, y = 0) { const g = prop('algae tuft', x, z, rnd() * 6, y); for (let k = 0; k < 6; k++) { const b = new THREE.Group(); g.add(b); b.rotation.y = k; const l = h * (0.6 + rnd() * 0.5); const m = mesh(new THREE.ConeGeometry(h * 0.08, l, 3), M(col), 0, l / 2, 0, b); m; b.rotation.x = (rnd() - 0.5) * 0.6; sway.push({ b, ph: rnd() * 6, a: 0.1 }); } return g; }
function pebble(x, z, r) { const g = prop('pebbles', x, z, rnd() * 6); for (let k = 0; k < 4; k++) mesh(blob(r * (0.5 + rnd() * 0.5), 0, 0.2), M(['#B8AE9C', '#8E8A80', '#D9CDB8', '#A89F93'][k]), (rnd() - 0.5) * r * 4, r * 0.3, (rnd() - 0.5) * r * 4, g).scale.y = 0.55; return g; }
const CORAL = [PAL.blossom, PAL.amber, '#C96A8A', PAL.peach, '#B98AC0', PAL.golden, '#E07A5F', '#7FC4A8'];
function carpet(cx, cz, w, d, n, scale = 1, clear = 0, ccx = cx, ccz = cz) { for (let k = 0; k < n; k++) { const x = cx + (rnd() - 0.5) * w, z = cz + (rnd() - 0.5) * d; if (Math.hypot(x - ccx, z - ccz) < clear) continue; const s = scale * (0.6 + rnd() * 0.8); const c = CORAL[k % CORAL.length];
  [() => rock(x, z, 0.35 * s), () => coralBranch(x, z, 0.7 * s, c), () => brainCoral(x, z, 0.3 * s, c), () => sponge(x, z, 0.5 * s, c), () => seagrass(x, z, 0.6 * s, 6), () => anemone(x, z, 0.22 * s, c), () => algae(x, z, 0.35 * s, k % 2 ? '#C9584A' : PAL.leaf), () => pebble(x, z, 0.06 * s), () => urchin(x, z, 0.1 * s), () => fanworm(x, z, 0.25 * s, k % 2 ? PAL.signal : '#E8607A'), () => starfish(x, z, 0.15 * s, c), () => shell(x, z, 0.06 * s)][k % 12](); } }

// a reef wall behind the set: stacked encrusted boulders with coral on the ledges, so the upper frame is never open water
function reefWall(z, w, h, scale = 1) { for (let x = -w / 2; x <= w / 2; x += 1.6 * scale) for (let y = 0; y < h; y += 1.3 * scale) { const zz = z - y * 0.35 + (rnd() - 0.5) * scale; const r = (1.0 + rnd() * 0.6) * scale; rock(x + (rnd() - 0.5) * scale, zz, r, y);
  if (rnd() < 0.85) [coralBranch, brainCoral, sponge, fanCoral][Math.floor(rnd() * 4)](x + (rnd() - 0.5) * scale, zz + r * 0.3, (0.6 + rnd() * 0.6) * scale, CORAL[Math.floor(rnd() * CORAL.length)], y + r * 0.8); } }

let update = () => {}, overlay = () => {};

// ================================================================ K01 hook: the turn-back, close up
if (K1) {
  // Dressing plan (3A), macro reef ledge, 10 m down, Ligurian Sea: hero the medusa (bell ~ 0.6 m in scene units: a 4.5 mm
  // animal shown macro), settling on a mossy rock; midground hydroid stalks, red algae tufts, a tube sponge, seagrass,
  // a sea star, shells; background rocks and a sea fan in the blue; atmosphere marine snow, light shafts, a small school.
  water(4, 20); seabed(30, 16, 0);
  const ledge = rock(0.15, -0.05, 0.55); ledge.scale.set(1.15, 0.8, 1.0); ledge.updateMatrixWorld(true);
  const onLedge = (x, z) => { const rc = new THREE.Raycaster(V(x, 3, z), V(0, -1, 0)); const h = rc.intersectObject(ledge, true)[0]; return h ? h.point.y - 0.01 : 0; };
  carpet(0.2, -2.0, 6.5, 4.8, 110, 0.75, 0.6, 0.15, -0.05); reefWall(-4.6, 12, 6, 0.8); school(16, 0.0, 2.2, -3.0, 1.6, 0.22, [PAL.signal, PAL.golden], 0.45); school(12, 0.9, 1.7, -2.2, 0.9, 0.16, [PAL.sky, PAL.turquoise], -0.5, PAL.navy);
  for (const [x, z, h] of [[-1.3, -0.6, 0.7], [1.5, -0.9, 0.9], [-0.9, 0.6, 0.5], [1.2, 0.5, 0.6]]) seagrass(x, z, h, 6);
  sponge(-1.7, -1.6, 0.8, PAL.golden); starfish(0.9, 0.95, 0.22, PAL.brick); shell(-0.5, 1.0, 0.09); shell(0.4, 1.15, 0.07);
  for (const [x, z, col] of [[-1.2, -2.6, PAL.blossom], [1.9, -2.4, PAL.amber]]) coralBranch(x, z, 0.9, col);
  fanCoral(-3.2, -5.5, 2.2, '#C96A8A'); rock(3.4, -6, 1.6); rock(-4.6, -7.5, 2.0); coralBranch(2.2, -5.0, 1.4, PAL.peach);
  school(9, 0.5, 2.4, -6.5, 2.6, 0.32, [PAL.golden, PAL.signal], 0.35);
  const ms = snow(260, 0, 1.6, -1, 8, 4, 8, 0.012); const sh = shafts(5, 0, -4, 1.2, 9, 6);
  atmo('marine snow'); atmo('light shafts'); atmo('fish');
  for (const [dx, dz, f] of [[-0.45, 0.25, 0], [0.5, 0.3, 1], [-0.2, 0.45, 2], [0.25, 0.5, 3], [-0.55, -0.05, 4], [0.62, -0.1, 5], [0.05, 0.62, 6], [-0.38, 0.58, 1], [0.45, 0.6, 0]]) { const x = 0.15 + dx * 0.85, z = -0.05 + dz * 0.8, y = onLedge(x, z);
    [() => algae(x, z, 0.16, '#C9584A', y), () => fanworm(x, z, 0.14, PAL.signal, y), () => shell(x, z, 0.05, y), () => urchin(x, z, 0.06, y), () => algae(x, z, 0.14, PAL.leaf, y), () => fanworm(x, z, 0.12, '#E8607A', y), () => starfish(x, z, 0.09, PAL.amber, y)][f](); }
  const J = jelly(0.3); hero(J);
  const POS = V(0.15, 0.44, -0.05);  // top of the ledge
  const pol = [0, 1, 2].map((k) => { const p = polyp(0.32 + k * 0.06, world); p.position.set(POS.x - 0.12 + k * 0.13, POS.y - 0.04, POS.z + (k - 1) * 0.06); p.userData.grow(0); return p; });
  const stolon = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4), M(STALK), POS.x, POS.y - 0.02, POS.z, world); stolon.rotation.z = Math.PI / 2; stolon.visible = false;
  update = (t, u, e) => { swayAll(t); swim(t); ms(t); sh(t);
    const m = sm(2.4, 4.2, t); const y = mix(1.0, POS.y + 0.08, sm(0.2, 4.6, t)); J.position.set(POS.x + 0.06 * Math.sin(t * 0.6) * (1 - m), y + 0.03 * Math.sin(t * 2.4) * (1 - m), POS.z);
    J.rotation.z = 0.12 * Math.sin(t * 0.7) * (1 - m); pulse(J, t, m, 1.2);
    const gr = sm(4.4, 6.6, t); stolon.visible = gr > 0.05; stolon.scale.y = Math.max(0.01, gr); pol.forEach((p, k) => p.userData.grow(sm(4.5 + k * 0.35, 6.4 + k * 0.2, t), t));
    J.userData.j.cyst.scale.multiplyScalar(1 - 0.55 * gr);
    orbit(V(POS.x, mix(1.05, POS.y + 0.24, sm(0.8, 5.2, t)), POS.z), D(8 + 8 * e), D(mix(14, 22, e)), mix(2.05, 1.45, e)); camera.fov = 45; camera.updateProjectionMatrix(); };
  overlay = (t) => card('It Turns Back\nInto a Baby', { y: 0.2, size: 0.056 });
}

// ================================================================ K02 1988: Rapallo harbour, a student with a plankton net
if (K2) {
  // Dressing plan (3A), Rapallo harbour, Italian Riviera, summer 1988, mid-morning:
  //  foreground  the stone quay: crates of sample jars, coiled rope, an iron bollard, a fishing-net pile, a bucket
  //  hero zone   the student at the end of a wooden jetty hauling a fine plankton net out of the water
  //  midground   moored wooden gozzi and two sailboats, orange buoys, mooring lines, the small sea castle on its rocks
  //  background  tall pastel Ligurian houses with green shutters climbing the hill, a bell tower, palms and lamps along
  //              the promenade, café umbrellas, green hills with olive trees
  //  atmosphere  water ripples, boats bobbing, gulls, people walking the promenade, flags moving
  sky('day', 60, 160); sun.position.set(-12, 16, 12); sun.intensity = 3.2; fill.intensity = 0.3;
  const wtex = canvasTex(256, 256, (g) => { g.fillStyle = '#5A8EA4'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(${rnd() < 0.6 ? '190,235,245' : '20,90,130'},${0.25 + rnd() * 0.3})`; g.lineWidth = 2; const x = rnd() * 256, y = rnd() * 256; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16 + rnd() * 10, y); g.stroke(); } });
  wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(30, 30);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ map: wtex, roughness: 0.35, metalness: 0.1 })); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.7; sea.receiveShadow = true; world.add(sea);
  // quay (foreground) and the jetty
  mesh(box(30, 1.2, 9), M('#BFB3A0'), 0, -0.6, 8.5); const qt = canvasTex(256, 256, (g) => { g.fillStyle = '#C9BCA6'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(110,95,75,0.5)'; g.lineWidth = 3; for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) { const x = i * 64 + (j % 2) * 32; g.beginPath(); g.moveTo(x, j * 32); g.lineTo(x, j * 32 + 32); g.stroke(); } });
  qt.wrapS = qt.wrapT = THREE.RepeatWrapping; qt.repeat.set(8, 3); const qtop = new THREE.Mesh(new THREE.PlaneGeometry(30, 9), new THREE.MeshStandardMaterial({ map: qt, roughness: 0.9 })); qtop.rotation.x = -Math.PI / 2; qtop.position.set(0, 0.005, 8.5); qtop.receiveShadow = true; world.add(qtop);
  const jet = prop('jetty', 0.5, 0); const plank = canvasTex(128, 256, (g) => { g.fillStyle = '#A8703F'; g.fillRect(0, 0, 128, 256); for (let y = 0; y < 256; y += 16) { g.fillStyle = `rgba(${rnd() < 0.5 ? '90,55,30' : '200,150,100'},0.25)`; g.fillRect(0, y, 128, 14); g.fillStyle = 'rgba(60,35,20,0.6)'; g.fillRect(0, y + 14, 128, 2); } });
  plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(1, 4); const deck = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 8.4), new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85 })); deck.position.set(0, -0.06, -0.2); deck.castShadow = deck.receiveShadow = true; jet.add(deck);
  for (let z = -4.2; z <= 3.8; z += 1.6) for (const x of [-0.95, 0.95]) mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.6, 6), M('#6B4A2E'), x, -0.7, z, jet);
  for (const x of [-0.95, 0.95]) { mesh(box(0.06, 0.06, 8.4), M('#6B4A2E'), x, 0.85, -0.2, jet); for (let z = -4.2; z <= 3.8; z += 1.6) mesh(box(0.07, 0.9, 0.07), M('#6B4A2E'), x, 0.45, z, jet); }
  // the student (Christian Sommer, 1988): t-shirt, jeans, cap; the plankton net is a fine cone on a ring and a rope
  const stu = person({ top: PAL.sky, bottom: '#4E6A8A', skin: PAL.skin[0], hair: PAL.hair[3], height: 1.78, shoes: PAL.offwhite }); stu.position.set(0.55, 0, -3.8); stu.rotation.y = Math.PI * 0.92; hero(stu);
  const net = new THREE.Group(); world.add(net); const ring = mesh(new THREE.TorusGeometry(0.22, 0.015, 4, 16), M(PAL.charcoal), 0, 0, 0, net);
  const cone = mesh(new THREE.ConeGeometry(0.22, 0.8, 10, 1, true), new THREE.MeshStandardMaterial({ color: C(PAL.offwhite), transparent: true, opacity: 0.75, side: THREE.DoubleSide, flatShading: true }), 0, -0.4, 0, net); cone.rotation.x = Math.PI;
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), M('#9FC9D8', { transparent: true, opacity: 0.8 }), 0, -0.84, 0, net); ring.rotation.x = Math.PI / 2;
  const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 1, 0)]), new THREE.LineBasicMaterial({ color: C('#E8D49A') })); world.add(rope);
  // foreground props on the quay
  { const g = prop('crate of sample jars', 1.9, 1.4, 0.3); mesh(box(0.7, 0.4, 0.5), M(PAL.wood), 0, 0.2, 0, g); for (let k = 0; k < 6; k++) mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 8), M('#BFE2EE', { transparent: true, opacity: 0.85 }), -0.22 + (k % 3) * 0.22, 0.49, -0.1 + Math.floor(k / 3) * 0.2, g); }
  { const g = prop('rope coil', -0.9, 1.6); for (let k = 0; k < 4; k++) { const tr = mesh(new THREE.TorusGeometry(0.28 - k * 0.04, 0.035, 4, 14), M('#D9C08A'), 0, 0.04 + k * 0.06, 0, g); tr.rotation.x = Math.PI / 2; } }
  { const g = prop('bollard', -0.9, 3.9); mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), M(PAL.charcoal), 0, 0.25, 0, g); mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 8), M(PAL.charcoal), 0, 0.52, 0, g); }
  { const g = prop('net pile', 3.6, 4.2); mesh(blob(0.45, 1, 0.25), M('#3F7F8C'), 0, 0.18, 0, g).scale.y = 0.45; mesh(blob(0.3, 0, 0.25), M(PAL.amber), 0.3, 0.2, 0.2, g).scale.y = 0.4; }
  { const g = prop('bucket', 1.3, 1.9); mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 8), M(PAL.brick), 0, 0.15, 0, g); }
  // boats: gozzi (small wooden boats) and two sailboats, bobbing on their moorings
  const boats = [];
  const boat = (x, z, ry, col, sail) => { const g = prop(sail ? 'sailboat' : 'gozzo', x, z, ry, -0.62); const L = sail ? 6 : 4.2; mesh(box(1.5, 0.6, L * 0.7), M(col), 0, 0.3, 0, g); for (const s of [-1, 1]) { const b = mesh(new THREE.ConeGeometry(0.75, L * 0.18, 4), M(col), 0, 0.3, s * L * 0.42, g); b.rotation.x = s * Math.PI / 2; b.rotation.y = Math.PI / 4; b.scale.set(1, 1, 0.55); }
    mesh(box(1.55, 0.08, L * 0.72), M(PAL.wood), 0, 0.62, 0, g); mesh(box(1.3, 0.06, L * 0.6), M(PAL.offwhite), 0, 0.42, 0, g);
    if (sail) { mesh(new THREE.CylinderGeometry(0.05, 0.06, 7, 6), M(PAL.offwhite), 0, 4.0, 0.3, g); mesh(box(0.06, 0.06, 2.4), M(PAL.offwhite), 0, 1.3, -0.8, g); }
    else { mesh(box(0.25, 0.25, 0.5), M(PAL.offwhite), 0, 0.8, -0.8, g); } boats.push({ g, ph: rnd() * 6, y: -0.62 }); return g; };
  [[-6.5, -6, 0.2, PAL.offwhite], [-3.6, -8.5, 0.1, PAL.teal], [3.2, -7.5, -0.2, PAL.brick], [6.4, -5.2, -0.1, PAL.navy], [-9.5, -10, 0.3, PAL.golden], [9.6, -11, -0.25, PAL.offwhite], [-1.0, -13, 0.05, PAL.forest], [5.0, -15, 0.15, PAL.sky]].forEach(([x, z, r, c], k) => boat(x, z, r, c, k === 1 || k === 5));
  const buoys = []; for (const [x, z] of [[-4.8, -3.8], [2.4, -4.6], [-8.0, -12.5], [8.0, -9.0], [0.5, -10.5]]) { const g = prop('buoy', x, z, 0, -0.7); mesh(new THREE.IcosahedronGeometry(0.28, 1), M(PAL.amber), 0, 0.1, 0, g); buoys.push({ g, ph: rnd() * 6 }); }
  // the little sea castle on its rocks
  { const g = prop('sea castle', -15, -14.5); mesh(blob(3.2, 1, 0.25), M('#8C8A84'), 0, -0.4, 0, g).scale.y = 0.4; mesh(box(4, 4.5, 4), M('#D8C9A8'), 0, 2.2, 0, g); mesh(box(4.3, 0.5, 4.3), M('#C4B48F'), 0, 4.7, 0, g);
    for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) mesh(box(0.6, 0.5, 0.4), M('#C4B48F'), k * 1.4, 5.2, s * 2.0, g); mesh(box(1.4, 2.0, 1.4), M('#D8C9A8'), 1.0, 6.0, 0.5, g); mesh(box(0.6, 1.0, 0.06), M('#4A3A2C'), 0, 1.0, 2.03, g); }
  // the town: Ligurian houses on the hill, promenade, palms
  mesh(box(80, 1.3, 14), M('#BFB3A0'), 0, -0.05, -29); const hill = mesh(blob(40, 2, 0.12), M('#6E9E4E'), 0, -14, -64); hill.scale.set(1.6, 0.7, 0.8);
  const HC = ['#E2BE7E', '#E2A48A', '#EAC0B6', '#EAD69A', '#C98466', '#F3E1B5', '#DDB27E', '#D59C82'];
  const house = (x, z, w, h, d, y, col) => { const g = prop('house', x, z, 0, y); mesh(box(w, h, d), M(col), 0, h / 2, 0, g); mesh(box(w + 0.3, 0.35, d + 0.3), M('#B85C3C'), 0, h + 0.17, 0, g);
    const nx = Math.max(2, Math.round(w / 1.4)), ny = Math.max(2, Math.floor(h / 2.6)); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const xx = -w / 2 + (i + 0.5) * w / nx, yy = 1.6 + j * 2.6; if (yy > h - 0.6) continue;
      mesh(box(0.5, 1.0, 0.05), M('#3E3A36'), xx, yy, d / 2 + 0.02, g); for (const s of [-1, 1]) mesh(box(0.28, 1.0, 0.06), M('#4E7D4A'), xx + s * 0.42, yy, d / 2 + 0.03, g); } return g; };
  let hx = -36; let k = 0; while (hx < 36) { const w = 3 + rnd() * 2.6; house(hx + w / 2, -25.8, w, 9 + rnd() * 6, 4, 0.6, HC[k % HC.length]); hx += w + 0.05; k++; }
  for (let row = 1; row < 4; row++) { let x = -34 + rnd() * 3; while (x < 34) { const w = 3 + rnd() * 3; house(x + w / 2, -26 - row * 6, w, 8 + rnd() * 6, 4, 0.6 + row * 4.2, HC[(k++) % HC.length]); x += w + 0.6 + rnd() * 1.5; } }
  { const g = prop('bell tower', 6, -36, 0, 10); mesh(box(2.4, 14, 2.4), M('#E7D8B8'), 0, 7, 0, g); mesh(box(2.0, 2.0, 2.6), M('#3E3A36'), 0, 12, 0, g); const c = mesh(new THREE.ConeGeometry(1.9, 3, 4), M('#B85C3C'), 0, 15.5, 0, g); c.rotation.y = Math.PI / 4; }
  for (let x = -30; x <= 30; x += 6) { const g = prop('palm', x + 1.5, -24.0, rnd() * 6, 0.6); mesh(new THREE.CylinderGeometry(0.16, 0.24, 5.5, 6), M('#8A6A48'), 0, 2.75, 0, g); for (let j = 0; j < 7; j++) { const f = mesh(box(0.35, 0.05, 2.6), M(j % 2 ? PAL.leaf : PAL.forest), 0, 5.5, 0, g); f.geometry.translate(0, 0, 1.2); f.rotation.set(0.55, j / 7 * 6.28, 0); } }
  for (let x = -27; x <= 27; x += 6) { const g = prop('lamp', x, -24.0, 0, 0.6); mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), M(PAL.charcoal), 0, 1.7, 0, g); mesh(new THREE.IcosahedronGeometry(0.2, 0), M(PAL.offwhite), 0, 3.5, 0, g); }
  for (const [x, col] of [[-8, PAL.brick], [-5.5, PAL.offwhite], [9, PAL.golden], [11.5, PAL.teal]]) { const g = prop('café umbrella', x, -26.0, 0, 0.6); mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), M(PAL.charcoal), 0, 1.1, 0, g); mesh(new THREE.ConeGeometry(1.4, 0.5, 8), M(col), 0, 2.3, 0, g); mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 8), M(PAL.offwhite), 0.6, 0.75, 0.6, g); }
  // people on the promenade (they walk at z -23.0, clear of palms and lamps)
  const walkers = []; for (let k2 = 0; k2 < 8; k2++) { const p = person({ top: [PAL.brick, PAL.offwhite, PAL.golden, PAL.teal, PAL.peach, PAL.navy, PAL.leaf, PAL.sky][k2], bottom: [PAL.charcoal, '#4E6A8A', PAL.cream][k2 % 3], skin: PAL.skin[k2 % 4], hair: PAL.hair[k2 % 5], height: 1.6 + (k2 % 3) * 0.08 });
    p.position.y = 0.6; const dir = k2 % 2 ? 1 : -1; const go = walker(p, dir > 0 ? [[-34, -22.9 - (k2 % 2) * 0.2], [34, -22.9 - (k2 % 2) * 0.2]] : [[34, -22.5 - (k2 % 2) * 0.2], [-34, -22.5 - (k2 % 2) * 0.2]], -k2 * 3.5, 1); walkers.push({ p, go }); }
  const gulls = []; for (let k2 = 0; k2 < 6; k2++) { const g = new THREE.Group(); world.add(g); const l = mesh(box(0.5, 0.03, 0.14), M(PAL.offwhite), -0.25, 0, 0, g), r = mesh(box(0.5, 0.03, 0.14), M(PAL.offwhite), 0.25, 0, 0, g); mesh(new THREE.IcosahedronGeometry(0.12, 0), M(PAL.offwhite), 0, 0, 0, g); gulls.push({ g, l, r, o: rnd() * 6 }); }
  const flags = []; for (const [x, z, col] of [[-6.5, -6, PAL.brick], [9.6, -11, PAL.golden]]) { const f = mesh(box(0.02, 0.4, 0.6), M(col), x, 4.5, z, world); flags.push(f); }
  atmo('water ripples'); atmo('boats bobbing'); atmo('gulls'); atmo('promenade walkers'); atmo('flags');
  update = (t, u, e) => { wtex.offset.set(t * 0.01, t * 0.006); boats.forEach((b) => { b.g.position.y = b.y + 0.06 * Math.sin(t * 1.3 + b.ph); b.g.rotation.z = 0.04 * Math.sin(t * 1.1 + b.ph); });
    buoys.forEach((b) => (b.g.position.y = -0.7 + 0.08 * Math.sin(t * 1.6 + b.ph))); walkers.forEach((w) => { w.go(t + 10); w.p.position.y = 0.6; });
    gulls.forEach((g2, k2) => { g2.g.position.set(-20 + ((t * 2.5 + g2.o * 5) % 40), 9 + 1.5 * Math.sin(t * 0.5 + k2), -12 - k2 * 1.5); g2.l.rotation.z = 0.4 * Math.sin(t * 8 + k2); g2.r.rotation.z = -0.4 * Math.sin(t * 8 + k2); });
    flags.forEach((f, k2) => (f.rotation.y = 0.3 * Math.sin(t * 3 + k2)));
    // hauling the net: arms pull hand over hand, the net rises out of the water and drips
    const haul = sm(0.8, 5.5, t); standPose(stu, t); const pull = Math.sin(t * 5) * (haul > 0 && haul < 1 ? 1 : 0);
    stu.userData.arms[0].rotation.x = -1.1 - 0.35 * pull; stu.userData.arms[1].rotation.x = -1.1 + 0.35 * pull; stu.userData.body.rotation.x = 0.18; stu.userData.hd.rotation.x = 0.35;
    const hand = V(); stu.userData.arms[1].userData.hand.getWorldPosition(hand); net.position.set(0.6, mix(-1.4, 0.1, haul), -4.75); net.rotation.x = 0.1 * Math.sin(t * 2);
    rope.geometry.setFromPoints([hand, net.position.clone()]);
    orbit(V(0.4, 1.1, -3.9), D(mix(14, 22, e)), D(15), mix(9.5, 8.6, e)); camera.fov = 52; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Italy, 1988', { y: 0.2, size: 0.05, alpha: sm(0.2, 0.5, t) });
}

// ================================================================ K03 the lab: jars of seawater; in one, the jellies are polyps
if (K3) {
  // Dressing plan (3A), a university marine lab, 1988: foreground a petri dish and a glass pipette near the lens;
  // hero the labelled jar where the medusae became polyps; midground five more jars with live medusae and an air line,
  // the microscope, a notebook with sketches, a desk lamp, a rack of test tubes, the student leaning in; background
  // shelves of jars and books, a wall chart, the window onto the harbour; atmosphere jellies pulsing, bubbles, dust in
  // the window light, the curtain moving.
  scene.background = C('#F3E6C8'); renderer.toneMappingExposure = 1.05; hemi.color.set(C('#FFF4E2')); hemi.groundColor.set(C('#B9A27E')); hemi.intensity = 1.4;
  sun.position.set(2.5, 9, -4); sun.target.position.set(0, 0.9, 0); sun.intensity = 2.4; sun.color = C('#FFF0D8'); fill.position.set(-3, 3, 4); fill.intensity = 0.6;
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); sun.shadow.camera.updateProjectionMatrix();
  // room
  const floor = mesh(box(8, 0.1, 14), M('#B98A5A'), 0, -0.05, -1.5); floor;
  { const g = prop('glass cabinet', 1.2, -5.6, 0, 0); mesh(box(1.8, 1.1, 0.35), M('#8A6A48'), 0, 0.55, 0, g); for (const x of [-0.45, 0.45]) { mesh(box(0.8, 0.9, 0.02), M('#CFE6EE', { transparent: true, opacity: 0.5 }), x, 0.58, 0.18, g); for (let k = 0; k < 4; k++) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), M(['#BFE2EE', PAL.peach, '#D8E9C9', PAL.golden][k]), x - 0.3 + k * 0.2, 0.6, 0.05, g); } }
  { const g = prop('poster', -1.0, -5.76, 0, 1.3); mesh(box(0.6, 0.8, 0.02), M(PAL.navy), 0, 0, 0, g); mesh(new THREE.CircleGeometry(0.16, 10), M('#CFEFF4'), 0, 0.1, 0.015, g); mesh(new THREE.CircleGeometry(0.06, 8), M(RED), 0, 0.12, 0.02, g); mesh(box(0.4, 0.05, 0.01), M(PAL.paper), 0, -0.25, 0.015, g); }
  { const g = prop('gas taps', 0, -5.76, 0, 1.0); mesh(box(2.8, 0.06, 0.08), M('#B9C2C8', { metalness: 0.5, roughness: 0.4 }), 0, 0, 0.04, g); for (let k = 0; k < 6; k++) mesh(box(0.05, 0.1, 0.08), M(PAL.golden), -1.2 + k * 0.48, -0.06, 0.08, g); }
  { const g = prop('clock', -0.3, -5.76, 0, 2.6); mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16), M(PAL.offwhite), 0, 0, 0, g).rotation.x = Math.PI / 2; mesh(box(0.02, 0.15, 0.02), M(PAL.ink), 0, 0.06, 0.03, g); }
  { const g = prop('periodic table', -2.2, -5.76, 0, 1.9); mesh(box(1.0, 0.7, 0.02), M(PAL.paper), 0, 0, 0, g); for (let i = 0; i < 18; i++) for (let j = 0; j < 7; j++) if (j > 1 || i < 2 || i > 11) mesh(box(0.045, 0.07, 0.01), M([PAL.peach, PAL.sky, PAL.golden, PAL.leaf][(i + j) % 4]), -0.45 + i * 0.053, 0.27 - j * 0.085, 0.015, g); }
  { const g = prop('sink and tap', -2.3, -1.2, Math.PI / 2, 0); mesh(box(1.0, 0.9, 0.6), M('#8A6A48'), 0, 0.45, 0, g); mesh(box(0.7, 0.05, 0.45), M('#DCE6E8', { metalness: 0.4, roughness: 0.3 }), 0, 0.92, 0, g); mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), M('#B9C2C8', { metalness: 0.6, roughness: 0.3 }), 0, 1.07, -0.18, g); }
  const wall = canvasTex(256, 256, (g) => { g.fillStyle = '#D3E6D3'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,150,120' : '255,255,245'},0.1)`; g.fillRect(rnd() * 256, rnd() * 256, 4 + rnd() * 10, 2 + rnd() * 6); } g.fillStyle = '#6FA58E'; g.fillRect(0, 196, 256, 60); g.fillStyle = '#4E8A72'; g.fillRect(0, 192, 256, 5); });
  const bw = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), new THREE.MeshStandardMaterial({ map: wall, roughness: 0.9 })); bw.position.set(0, 1.6, -5.8); bw.receiveShadow = true; world.add(bw);
  for (const x of [-3, 3]) { const sw = mesh(box(0.1, 3.2, 8), M('#D3E6D3'), x, 1.6, -0.3); sw; }
  // the window with the harbour outside (pastel houses, sea, sky) and a curtain
  const view = canvasTex(512, 320, (g) => { const gr = g.createLinearGradient(0, 0, 0, 180); gr.addColorStop(0, '#6FB6E6'); gr.addColorStop(1, '#CFEAF6'); g.fillStyle = gr; g.fillRect(0, 0, 512, 180);
    g.fillStyle = '#6E9E4E'; g.beginPath(); g.moveTo(0, 150); g.quadraticCurveTo(250, 40, 512, 140); g.lineTo(512, 200); g.lineTo(0, 200); g.fill();
    let x = 0, k = 0; while (x < 512) { const w = 26 + rnd() * 22, h = 40 + rnd() * 40; g.fillStyle = ['#E8B864', '#E99A7A', '#F0B3A8', '#F2D27A', '#C9704A', '#F3E1B5'][k++ % 6]; g.fillRect(x, 200 - h, w - 2, h); g.fillStyle = '#B85C3C'; g.fillRect(x - 1, 200 - h - 5, w, 6);
      g.fillStyle = '#4E7D4A'; for (let j = 0; j < 3; j++) g.fillRect(x + 6, 200 - h + 8 + j * 12, w - 14, 5); x += w; }
    g.fillStyle = '#2F93B8'; g.fillRect(0, 200, 512, 120); for (let i = 0; i < 6; i++) { const bx = 30 + rnd() * 450, by = 225 + rnd() * 80; g.fillStyle = [PAL.offwhite, PAL.brick, PAL.teal][i % 3]; g.fillRect(bx, by, 26, 7); g.fillStyle = PAL.wood; g.fillRect(bx + 4, by - 4, 16, 4); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 5; i++) { const cx = rnd() * 512, cy = 20 + rnd() * 60; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + k * 14, cy + (k % 2) * 4, 12, 0, 7); g.fill(); } } g.strokeStyle = 'rgba(200,240,250,0.6)'; for (let i = 0; i < 90; i++) { const xx = rnd() * 512, yy = 205 + rnd() * 110; g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + 12, yy); g.stroke(); } });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshBasicMaterial({ map: view, fog: false })); win.position.set(1.2, 1.85, -5.78); world.add(win);
  { const g = prop('window frame', 1.2, -5.74, 0, 1.85); for (const [x, y, w, h] of [[0, 0.66, 2.1, 0.08], [0, -0.66, 2.2, 0.1], [-1.03, 0, 0.08, 1.4], [1.03, 0, 0.08, 1.4], [0, 0, 0.05, 1.3]]) mesh(box(w, h, 0.06), M(PAL.offwhite), x, y, 0, g); }
  const curtain = new THREE.Group(); curtain.position.set(2.45, 2.5, -5.7); world.add(curtain); for (let k = 0; k < 5; k++) mesh(box(0.14, 1.5, 0.05), M(k % 2 ? PAL.peach : '#F4C7A6'), k * 0.12, -0.75, (k % 2) * 0.04, curtain);
  // shelves on the back wall (background)
  for (const [x, items] of [[-1.6, 'jars'], [-1.6, 'books'], [-0.2, 'books2']]) { const y = items === 'jars' ? 2.2 : items === 'books' ? 1.55 : 2.25; const g = prop(items === 'jars' ? 'shelf of specimen jars' : 'shelf of books', x, -5.6, 0, y);
    mesh(box(1.4, 0.05, 0.3), M(PAL.wood), 0, 0, 0, g); for (let k = 0; k < 6; k++) { if (items === 'jars') mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24 + (k % 2) * 0.06, 8), M(['#BFE2EE', '#D8E9C9', '#F2E2C0'][k % 3], { transparent: true, opacity: 0.85 }), -0.55 + k * 0.22, 0.15, 0, g);
      else mesh(box(0.08 + (k % 3) * 0.03, 0.28 + (k % 2) * 0.06, 0.22), M([PAL.brick, PAL.navy, PAL.forest, PAL.golden, PAL.teal, PAL.wood][k]), -0.55 + k * 0.19, 0.16, 0, g); } }
  { const g = prop('wall chart', -1.1, -5.76, 0, 0.9); mesh(box(0.9, 0.6, 0.02), M(PAL.paper), 0, 0, 0, g); for (let k = 0; k < 4; k++) { const c = mesh(new THREE.CircleGeometry(0.07, 8), M([PAL.blossom, RED, PAL.golden, POLYP][k]), -0.3 + k * 0.2, 0.05, 0.015, g); c; } mesh(box(0.7, 0.02, 0.02), M(PAL.ink), 0, -0.15, 0.015, g); }
  // the bench
  { const g = prop('lab bench', 0, -0.25); const tiles = canvasTex(256, 128, (q) => { q.fillStyle = '#2F6A70'; q.fillRect(0, 0, 256, 128); for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) { q.fillStyle = `rgba(${rnd() < 0.5 ? '20,60,64' : '80,140,146'},0.35)`; q.fillRect(i * 16 + 1, j * 16 + 1, 14, 14); } q.strokeStyle = '#DCE6E2'; q.lineWidth = 1.5; for (let i = 0; i <= 256; i += 16) { q.beginPath(); q.moveTo(i, 0); q.lineTo(i, 128); q.stroke(); } for (let j = 0; j <= 128; j += 16) { q.beginPath(); q.moveTo(0, j); q.lineTo(256, j); q.stroke(); } });
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(6, 3); const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 1.2), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.5 })); top.position.y = 0.9; top.receiveShadow = top.castShadow = true; g.add(top);
    mesh(box(3.3, 0.86, 1.1), M('#8A6A48'), 0, 0.44, -0.02, g); for (let k = 0; k < 4; k++) { mesh(box(0.7, 0.36, 0.02), M('#9C7A55'), -1.2 + k * 0.8, 0.66, 0.54, g); mesh(box(0.7, 0.36, 0.02), M('#9C7A55'), -1.2 + k * 0.8, 0.24, 0.54, g); for (const y of [0.66, 0.24]) mesh(box(0.16, 0.03, 0.03), M('#C9B48A', { metalness: 0.5, roughness: 0.35 }), -1.2 + k * 0.8, y + 0.1, 0.56, g); } }
  { const g = prop('stool', -0.55, 0.85); mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), M(PAL.brick), 0, 0.62, 0, g); for (let k = 0; k < 3; k++) { const a = k * 2.1; const l = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 5), M(PAL.charcoal), Math.cos(a) * 0.14, 0.31, Math.sin(a) * 0.14, g); l.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); } }
  { const g = prop('seawater bucket', 0.75, 0.75); mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.32, 10), M(PAL.teal), 0, 0.16, 0, g); mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.01, 10), M('#7CC7D8'), 0, 0.28, 0, g); }
  { const g = prop('book stack', -0.45, -0.65, 0.2, 0.93); for (let k = 0; k < 3; k++) mesh(box(0.26, 0.05, 0.19), M([PAL.navy, PAL.brick, PAL.golden][k]), 0.01 * k, 0.025 + k * 0.05, 0, g); }
  { const g = prop('magnifier', 0.48, 0.12, 0.8, 0.93); const r = mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 14), M(PAL.charcoal), 0, 0.01, 0, g); r.rotation.x = Math.PI / 2; mesh(box(0.1, 0.012, 0.018), M(PAL.wood), 0.1, 0.01, 0, g); }
  { const g = prop('beaker', -1.5, -0.1, 0, 0.93); mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10, 1, true), M('#E6F4F6', { transparent: true, opacity: 0.4, side: THREE.DoubleSide }), 0, 0.07, 0, g); mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.08, 10), M('#9FD3DF', { transparent: true, opacity: 0.6 }), 0, 0.04, 0, g); }
  { const g = prop('sample tray', 1.0, -0.45, 0, 0.93); mesh(box(0.36, 0.03, 0.26), M(PAL.offwhite), 0, 0.015, 0, g); for (let k = 0; k < 6; k++) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), M(['#9FD3DF', PAL.peach, '#D8E9C9'][k % 3]), -0.11 + (k % 3) * 0.11, 0.04, -0.06 + Math.floor(k / 3) * 0.12, g); }
  const TOP = 0.93;
  // jars: glass, seawater, a paper label; tiny medusae pulse inside (shown big: the real ones are 4.5 mm)
  const glass = new THREE.MeshStandardMaterial({ color: C('#E6F4F6'), transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const seaw = new THREE.MeshStandardMaterial({ color: C('#7CC7D8'), transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false });
  const jars = []; const HERO_X = 0.15;
  for (const x of [-0.85, -0.55, -0.25, HERO_X, 0.5, 0.8]) { const g = prop(x === HERO_X ? 'jar of polyps' : 'jar', x, -0.3, 0, TOP); const h = 0.3, r = 0.11;
    mesh(new THREE.CylinderGeometry(r, r, h, 14, 1, true), glass, 0, h / 2, 0, g); mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, h * 0.8, 14), seaw, 0, h * 0.4, 0, g); mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.03, 14), M(PAL.charcoal), 0, h + 0.015, 0, g);
    mesh(box(0.1, 0.06, 0.005), M(PAL.paper), 0, h * 0.62, r + 0.004, g); mesh(box(0.07, 0.008, 0.006), M(PAL.ink), 0, h * 0.64, r + 0.006, g);
    if (x !== HERO_X) { const js = [0, 1].map((k) => { const j = jelly(0.034, g); j.position.set((k - 0.5) * 0.08, 0.12 + k * 0.08, 0.02); j.userData.prop = false; return j; }); jars.push({ g, js }); } else { hero(g); jars.push({ g, js: [], hero: true }); } }
  const hj = jars.find((j) => j.hero).g; const pols = []; for (let k = 0; k < 6; k++) { const p = polyp(0.1 + (k % 3) * 0.025, hj); const a = k * 1.1; p.position.set(Math.cos(a) * 0.05, 0.005, Math.sin(a) * 0.05); pols.push(p); }
  for (let k = 0; k < 3; k++) { const c = mesh(blob(0.012, 0, 0.2), M(CYST), Math.cos(k * 2) * 0.07, 0.01, Math.sin(k * 2) * 0.07, hj); c; }
  // air line and bubbles in the jar next to the hero
  const bubbles = []; const bj = jars[4].g; for (let k = 0; k < 10; k++) { const b = mesh(new THREE.IcosahedronGeometry(0.006, 0), M('#F4FBFA', { transparent: true, opacity: 0.8 }), 0.05, 0, 0, bj); bubbles.push({ b, ph: k / 10 }); }
  const tube = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0.55, TOP + 0.31, -0.3), V(0.6, TOP + 0.5, -0.45), V(1.1, TOP + 0.2, -0.6), V(1.2, TOP, -0.6)]), new THREE.LineBasicMaterial({ color: C('#D9E6E8') })); world.add(tube);
  { const g = prop('microscope', -1.25, -0.3, 0.5, TOP); mesh(box(0.22, 0.04, 0.28), M(PAL.charcoal), 0, 0.02, 0, g); const arm = mesh(box(0.05, 0.34, 0.06), M(PAL.charcoal), 0, 0.2, -0.1, g); arm.rotation.x = 0.2; mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 8), M(PAL.charcoal), 0, 0.34, -0.03, g).rotation.x = -0.35; mesh(box(0.16, 0.02, 0.14), M('#5E6670'), 0, 0.14, 0.02, g); }
  { const g = prop('notebook', 0.55, 0.42, -0.15, TOP); mesh(box(0.34, 0.015, 0.24), M(PAL.paper), 0, 0.008, 0, g); mesh(box(0.012, 0.018, 0.24), M(PAL.navy), 0, 0.01, 0, g); for (let k = 0; k < 2; k++) { const c = mesh(new THREE.TorusGeometry(0.03, 0.003, 3, 10), M(PAL.ink), -0.08 + k * 0.15, 0.017, -0.02, g); c.rotation.x = Math.PI / 2; } const pen = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), M(PAL.golden), 0.05, 0.02, 0.09, g); pen.rotation.z = Math.PI / 2; pen.rotation.y = 0.4; }
  { const g = prop('desk lamp', 1.35, -0.55, -0.6, TOP); mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.03, 10), M(PAL.teal), 0, 0.015, 0, g); const a = mesh(box(0.02, 0.42, 0.02), M(PAL.teal), 0, 0.22, 0, g); a.rotation.z = 0.3; mesh(new THREE.ConeGeometry(0.08, 0.12, 8, 1, true), M(PAL.teal, { side: THREE.DoubleSide }), -0.14, 0.42, 0, g).rotation.z = 2.3;
    const l = new THREE.PointLight(C('#FFE2B0'), 1.2, 2.5, 1.6); l.position.set(-0.18, 0.36, 0); g.add(l); }
  { const g = prop('test-tube rack', -0.65, 0.05, 0.1, TOP); mesh(box(0.3, 0.06, 0.08), M(PAL.wood), 0, 0.08, 0, g); for (let k = 0; k < 5; k++) mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), M(['#BFE2EE', PAL.peach, '#BFE2EE', '#D8E9C9', '#BFE2EE'][k], { transparent: true, opacity: 0.85 }), -0.12 + k * 0.06, 0.1, 0, g); }
  { const g = prop('seawater bottle', -1.0, -0.6, 0, TOP); mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.32, 10), M('#7CC7D8', { transparent: true, opacity: 0.6 }), 0, 0.16, 0, g); mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 8), M('#7CC7D8', { transparent: true, opacity: 0.6 }), 0, 0.36, 0, g); mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 8), M(PAL.brick), 0, 0.41, 0, g); }
  for (const [x, z, c] of [[0.42, -0.05, PAL.peach], [-0.05, 0.0, '#D8E9C9']]) { const g = prop('sample vial', x, z, 0, TOP); mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), M('#E6F4F6', { transparent: true, opacity: 0.6 }), 0, 0.05, 0, g); mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 8), M(c), 0, 0.105, 0, g); }
  { const g = prop('petri dish', -0.12, 0.25, 0, TOP); mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 14), M('#DCEFF3', { transparent: true, opacity: 0.7 }), 0, 0.008, 0, g); mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 14), M('#9FD3DF'), 0, 0.006, 0, g); }
  { const g = prop('pipette', 0.42, 0.22, 0.6, TOP); const p = mesh(new THREE.CylinderGeometry(0.006, 0.003, 0.22, 5), M('#E6F4F6', { transparent: true, opacity: 0.8 }), 0, 0.01, 0, g); p.rotation.z = Math.PI / 2; mesh(new THREE.IcosahedronGeometry(0.014, 0), M(PAL.brick), 0.11, 0.012, 0, g); }
  { const g = prop('shell', 1.05, 0.3, 0.4, TOP); const s = mesh(new THREE.ConeGeometry(0.03, 0.06, 6), M(PAL.peach), 0, 0.02, 0, g); s.rotation.z = 1.3; }
  // the student behind the bench, leaning in to look at the hero jar
  const stu = person({ top: PAL.sky, bottom: '#4E6A8A', skin: PAL.skin[0], hair: PAL.hair[3], height: 1.78 }); stu.position.set(1.05, 0, -1.6); stu.rotation.y = -0.4;
  const dust = snow(80, 1.0, 1.6, -1.6, 1.6, 1.4, 1.6, 0.004); atmo('jellies pulsing'); atmo('bubbles'); atmo('dust in the light'); atmo('curtain');
  update = (t, u, e) => { jars.forEach((j, k) => j.js.forEach((jj, i) => { pulse(jj, t, 0, 1.3, k * 0.3 + i * 0.5); jj.position.y = 0.12 + i * 0.08 + 0.015 * Math.sin(t * 1.1 + k + i); jj.position.x = (i - 0.5) * 0.08 + 0.01 * Math.sin(t * 0.7 + k); }));
    pols.forEach((p, k) => p.userData.grow(1, t + k)); bubbles.forEach((q) => { const v = (q.ph + t * 0.35) % 1; q.b.position.set(0.05 + 0.006 * Math.sin(t * 6 + q.ph * 10), 0.02 + v * 0.22, 0.0); });
    dust(t); curtain.rotation.x = 0.05 * Math.sin(t * 0.8); curtain.rotation.z = 0.03 * Math.sin(t * 0.6);
    standPose(stu, t); stu.userData.body.rotation.x = 0.38; stu.userData.hd.rotation.x = 0.35; stu.userData.hd.rotation.y = 0.05 * Math.sin(t * 0.5); stu.userData.arms.forEach((a) => (a.rotation.x = -0.5));
    orbit(V(HERO_X, TOP + 0.17, -0.3), D(mix(-12, -4, e)), D(mix(15, 11, e)), mix(1.65, 1.35, e)); camera.fov = 45; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Back to\nthe Start', { y: 0.2, size: 0.056, alpha: sm(0.3, 0.6, t) });
}

// ================================================================ K04 the cycle
if (K4) {
  // Dressing plan (3A), the same Ligurian reef ledge: hero the polyp colony on its rock; midground the adult medusa
  // shrinking to a cyst, the colony's stolons and stalks, budding baby medusae, seagrass, sponges, a sea star, shells,
  // coral; background rocks, a sea fan and coral heads in the blue; atmosphere marine snow, light shafts, a school of fish.
  water(5, 26); seabed(40, 22, 0);
  const R = rock(0, -0.3, 0.6); R.scale.set(1.4, 0.75, 1.1);
  carpet(0, -2.2, 8, 7, 130, 0.9, 0.9, 0, -0.3); reefWall(-5.5, 14, 7, 0.9); school(18, 0.5, 2.6, -3.5, 2.0, 0.24, [PAL.sky, PAL.turquoise], -0.4, PAL.navy);
  for (const [x, z, h] of [[-1.8, 0.4, 0.8], [1.9, 0.3, 0.9], [-1.3, -1.6, 0.7], [1.5, -1.9, 0.8], [-0.7, 1.2, 0.5]]) seagrass(x, z, h, 6);
  sponge(-2.4, -1.2, 0.9, PAL.golden); sponge(2.6, -1.0, 0.7, '#C96A8A'); starfish(1.0, 1.2, 0.22, PAL.brick); shell(-0.4, 1.3, 0.09); shell(0.6, 1.5, 0.07);
  coralBranch(-1.4, -3.0, 1.0, PAL.blossom); coralBranch(1.8, -3.2, 1.2, PAL.amber); brainCoral(0.2, -2.8, 0.5, '#D9A35E');
  fanCoral(-3.6, -6.5, 2.5, '#C96A8A'); rock(4.2, -7, 1.8); rock(-5.6, -8.5, 2.2); coralBranch(2.8, -6.2, 1.6, PAL.peach); brainCoral(-2.0, -7.0, 0.9, '#B98AC0');
  school(10, 0.4, 3.4, -7, 3.0, 0.34, [PAL.golden, PAL.signal], 0.32);
  const ms = snow(300, 0, 2.2, -1.5, 10, 5, 10, 0.014); const sh = shafts(6, 0, -5, 1.4, 11, 8); atmo('marine snow'); atmo('light shafts'); atmo('fish');
  coralBranch(-0.85, 0.65, 0.9, PAL.blossom); fanCoral(1.05, 0.95, 0.9, '#E07A5F'); coralBranch(-0.6, 1.0, 1.4, PAL.amber); coralBranch(0.95, 0.7, 0.8, PAL.golden); fanCoral(0.8, 1.25, 0.8, '#C96A8A'); anemone(0.25, 1.6, 0.18, PAL.peach);
  const TOPY = 0.45; const col = new THREE.Group(); col.position.set(0.1, TOPY - 0.06, -0.25); world.add(col); hero(col); col.userData.prop = true; col.name = 'polyp colony';
  const stol = []; for (let k = 0; k < 4; k++) { const s = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 4), M(STALK), -0.2 + k * 0.14, 0.0, (k % 2) * 0.08, col); s.rotation.z = Math.PI / 2; s.rotation.y = k * 0.6; stol.push(s); }
  const pols = []; for (let k = 0; k < 7; k++) { const p = polyp(0.34 + (k % 3) * 0.07, col); p.position.set(-0.36 + k * 0.12, 0, Math.sin(k * 1.7) * 0.12); pols.push(p); }
  const adult = jelly(0.28); adult.userData.prop = true;
  const babies = [0, 1, 2, 3, 4].map((k) => { const j = jelly(0.07); j.visible = false; return j; });
  update = (t, u, e) => { swayAll(t); swim(t); ms(t); sh(t);
    const m = sm(0.6, 2.4, t); adult.position.set(mix(-0.9, -0.3, sm(0, 2.8, t)), mix(1.9, TOPY + 0.05, sm(0.2, 2.9, t)), -0.25); pulse(adult, t, m, 1.2); adult.visible = t < 3.3; if (t > 2.9) adult.userData.j.cyst.scale.multiplyScalar(1 - sm(2.9, 3.3, t));
    stol.forEach((s, k) => { s.scale.y = Math.max(0.01, sm(2.6 + k * 0.15, 3.6 + k * 0.15, t)); s.visible = t > 2.6; });
    pols.forEach((p, k) => p.userData.grow(sm(2.9 + k * 0.18, 4.3 + k * 0.18, t), t));
    babies.forEach((j, k) => { const t0 = 4.4 + k * 0.42; const q = clamp((t - t0) / 2.6); j.visible = t > t0; const p = pols[k + 1]; const base = V(); p.getWorldPosition(base); const h = 0.4 + (k % 3) * 0.07;
      j.position.set(base.x + 0.25 * q * Math.sin(k * 2.3), base.y + h * 0.9 + 1.6 * q * q + 0.6 * q, base.z + 0.15 * q * Math.cos(k)); j.scale.setScalar(mix(0.4, 1.0, sm(0, 0.3, q))); pulse(j, t, 0, 1.6, k * 0.3); });
    orbit(V(0, mix(0.95, 1.3, e), -0.3), D(mix(-6, 6, e)), D(mix(14, 18, e)), mix(3.6, 3.3, e)); camera.fov = 48; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Again and\nAgain', { y: 0.2, size: 0.056, alpha: sm(3.0, 3.4, t) });
}

// ================================================================ K05 not immortal: a fish snaps up a drifting jelly
if (K5) {
  // Dressing plan (3A), a bright shallow reef: foreground coral heads and a sea fan at the frame edges; hero a drifting
  // medusa and the wrasse that eats it; midground more drifting medusae, branching, brain and table corals, anemones,
  // sponges, sea stars, a reef shelf; background coral bommies and rocks fading into the blue; atmosphere two fish
  // schools, marine snow, light shafts, swaying fans and grass.
  water(7, 40); sun.intensity = 3.1; seabed(70, 34, 0); carpet(0, -5, 20, 14, 240, 1.4, 1.6, 0, 0.5); reefWall(-13, 30, 10, 1.4);
  for (const [x, z, h] of [[-1.9, 2.3, 1.6], [2.1, 2.1, 1.4]]) coralBranch(x, z, h, PAL.amber);
  const C1 = [PAL.blossom, PAL.amber, '#C96A8A', PAL.peach, '#B98AC0', PAL.golden, '#E07A5F'];
  for (let k = 0; k < 14; k++) { const a = rnd() * 6.28, r = 2.5 + rnd() * 6; const x = Math.cos(a) * r, z = -3 + Math.sin(a) * r * 0.8; if (Math.abs(x) < 1.2 && z > -1.5) continue; [coralBranch, brainCoral, sponge][k % 3](x, z, k % 3 === 1 ? 0.6 + rnd() * 0.4 : 1.0 + rnd() * 0.8, C1[k % 7]); }
  for (const [x, z] of [[-2.6, 0.2], [2.8, -0.4], [-4.5, -5.0], [4.2, -6.0]]) anemone(x, z, 0.35, PAL.blossom);
  for (const [x, z] of [[-1.5, 1.4], [1.8, 1.6], [-3.6, -1.4]]) starfish(x, z, 0.2, [PAL.brick, PAL.golden, PAL.amber][Math.floor(rnd() * 3)]);
  for (const [x, z, s] of [[-9, -14, 3.0], [8, -15, 3.4], [0, -19, 3.8], [-16, -12, 2.8], [15, -12, 3.0]]) { rock(x, z, s); coralBranch(x + 0.5, z + 1, s * 0.6, C1[Math.floor(rnd() * 7)], s * 0.4); }
  for (const [x, z, h] of [[-1.2, 2.1, 1.3], [1.4, 2.0, 1.1]]) fanCoral(x, z, h, '#C96A8A'); coralBranch(-1.3, 1.3, 1.6, PAL.golden); fanCoral(1.75, 1.4, 1.2, '#E07A5F'); coralBranch(1.45, 1.7, 1.3, PAL.blossom); brainCoral(0.35, 1.75, 0.35, PAL.amber); coralBranch(-0.5, 1.8, 0.9, '#B98AC0'); coralBranch(1.0, 2.7, 0.7, PAL.blossom);
  // kelp: tall ribbons swaying at the reef edge
  for (const [x, z, h] of [[-3.6, -3.0, 4.5], [-4.4, -4.5, 5.5], [3.9, -3.5, 5.0], [4.8, -5.0, 6.0], [-2.6, -6.5, 5.0], [2.4, -7.0, 5.5]]) { const g = prop('kelp', x, z); for (let k = 0; k < 4; k++) { const b = new THREE.Group(); b.position.set((k - 1.5) * 0.2, 0, (k % 2) * 0.15); g.add(b);
    for (let j = 0; j < 6; j++) { const seg = mesh(box(0.22, h / 6, 0.02), M(j % 2 ? '#7A8A3A' : '#8E9A44'), 0, (j + 0.5) * h / 6, 0, b); seg.rotation.y = j * 0.5; } sway.push({ b, ph: k + x, a: 0.08 }); } }
  { const g = prop('table coral', 3.2, -2.6, 0); mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.8, 6), M('#D9A35E'), 0, 0.4, 0, g); mesh(new THREE.CylinderGeometry(1.0, 0.8, 0.12, 9), M('#D9A35E'), 0, 0.85, 0, g); }
  for (const [x, z, h] of [[-0.8, -1.6, 0.8], [1.0, -2.2, 0.7], [-3.0, 1.2, 0.6]]) seagrass(x, z, h, 7);
  school(12, -1.5, 3.8, -6, 3.5, 0.35, [PAL.golden, PAL.signal], 0.3); school(9, 2.5, 2.2, -9, 2.5, 0.3, [PAL.sky, PAL.turquoise], -0.4, PAL.navy);
  const ms = snow(260, 0, 2.5, -2, 14, 6, 12, 0.016); const sh = shafts(7, 0, -6, 1.8, 14, 10); atmo('fish schools'); atmo('marine snow'); atmo('light shafts'); atmo('drifting jellies');
  const drift = [[-1.6, 2.6, -2.0], [1.4, 3.1, -3.5], [-2.6, 3.6, -5.0], [2.6, 2.0, -1.5], [0.0, 3.9, -6.0]].map(([x, y, z], k) => { const j = jelly(0.12); j.position.set(x, y, z); return { j, x, y, z, k }; });
  const prey = jelly(0.14); hero(prey);
  const wr = fish(PAL.turquoise, 0.9, world, PAL.golden); hero(wr); const jaw = mesh(box(0.08, 0.04, 0.12), M(PAL.turquoise), 0, -0.07, 0.42, wr);
  const PREY = V(0.25, 1.75, -1.0);
  update = (t, u, e) => { swayAll(t); swim(t); ms(t); sh(t);
    drift.forEach((d) => { d.j.position.set(d.x + 0.2 * Math.sin(t * 0.4 + d.k), d.y + 0.12 * Math.sin(t * 0.9 + d.k), d.z); pulse(d.j, t, 0, 1.1, d.k * 0.3); });
    // the wrasse cruises in, turns, and snaps the jelly at 3.9 s (implied: a quick gulp, the jelly is gone, no shown injury)
    const tS = 3.9; const p0 = V(-3.2, 1.4, -2.5), p1 = V(-0.9, 1.75, -1.6), p2 = V(PREY.x - 0.05, PREY.y, PREY.z - 0.1), p3 = V(1.5, 2.3, -2.4);
    let pos, look; if (t < tS) { const q = sm(0.8, tS, t); pos = new THREE.CatmullRomCurve3([p0, p1, p2]).getPoint(q); look = new THREE.CatmullRomCurve3([p0, p1, p2]).getTangent(Math.min(0.999, q)); }
    else { const q = sm(tS, 7.0, t); pos = p2.clone().lerp(p3, q); look = p3.clone().sub(p2); }
    wr.position.copy(pos); wr.lookAt(pos.clone().add(look)); wr.userData.tail.rotation.y = 0.5 * Math.sin(t * (t > tS - 0.4 && t < tS + 0.4 ? 22 : 10));
    jaw.rotation.x = 0.5 * sm(tS - 0.35, tS - 0.15, t) * (1 - sm(tS, tS + 0.12, t));
    prey.visible = t < tS + 0.02; prey.position.set(PREY.x + 0.1 * Math.sin(t * 0.5), PREY.y + 0.05 * Math.sin(t * 1.0), PREY.z); prey.scale.setScalar(1 - sm(tS - 0.08, tS + 0.02, t) * 0.9); pulse(prey, t, 0, 1.1);
    orbit(V(0.2, mix(1.6, 1.75, e), -1.2), D(mix(-4, 4, e)), D(14), mix(6.2, 5.6, e)); camera.fov = 52; camera.updateProjectionMatrix(); };
  overlay = (t) => card('Just Not\nInvincible', { y: 0.2, size: 0.056, alpha: sm(4.3, 4.7, t) });
}

run(update, overlay);
