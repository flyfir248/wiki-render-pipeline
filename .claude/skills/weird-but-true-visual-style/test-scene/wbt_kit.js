// Weird But True shared kit for Three.js scenes (SKILL.md v1.1). Bright daylight, faceted low-poly (flat shading),
// palette from section 4.2, one character system (section 9) and the 9:16 overlay rules (section 8).
// A story page imports this, builds its shots and calls run(update, overlay). Works with 04_PIPELINES\threejs\render.js
// (window.ready / window.renderFrame) and in a browser for live preview: ?shot=T01&w=360&h=640&t=2.5 (or &play=1).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
export { THREE };

export const P = new URLSearchParams(location.search);
export const W = +(P.get('w') || 720), H = +(P.get('h') || 1280);
export const SHOT = P.get('shot') || 'T01';
export const FPS = 30, DUR = 7, N = FPS * DUR;
let seed = 11 + SHOT.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
export const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const C = (h) => new THREE.Color(h);
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const D = THREE.MathUtils.degToRad;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- palette (SKILL.md 4.2, 4.3)
export const PAL = {
  golden: '#F2B53A', amber: '#E08A2E', peach: '#F4B38A', leaf: '#7DBA4E', forest: '#2F7A4A', turquoise: '#2FB3A6', sky: '#7EC4EA',
  wood: '#A8703F', cream: '#F3E6C8', sandstone: '#D8B58A', brick: '#B65E48', teal: '#2A8C9A', bluegrey: '#6E8496', navy: '#2E4566',
  charcoal: '#33363B', warmgrey: '#8C847A', offwhite: '#F6F1E7', signal: '#FFD23F', blossom: '#F2BCCB', ink: '#1E2228', paper: '#FFF8EA',
  skin: ['#F1C9A5', '#E0AE84', '#C68B5E', '#A06842', '#7A4B2E', '#55331F'], hair: ['#1F1A17', '#3B2A20', '#6B4A2E', '#A77B4F', '#D8C08A', '#B9B4AC'],
  eye: '#22252B',
};

// ---------------------------------------------------------------- renderer, scene, light (SKILL.md 5)
export const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
export const scene = new THREE.Scene();
export const world = new THREE.Group(); scene.add(world);

export function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
export const SKIES = { day: ['#5FA8E6', '#BFE2F5', '#F6E6C8'], golden: ['#6C8FD0', '#F4C08A', '#F7A867'], overcast: ['#9AA7B4', '#B8C2CB', '#CCD3D8'], night: ['#1B2A4A', '#2A3A60', '#3A4D78'] };
export function sky(name = 'day', fogNear = 30, fogFar = 90) {
  const [a, b, c] = SKIES[name];
  scene.background = canvasTex(4, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, a); gr.addColorStop(0.62, b); gr.addColorStop(1, c); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); });
  scene.fog = new THREE.Fog(C(b).lerp(C(c), 0.5), fogNear, fogFar);
}
export const hemi = new THREE.HemisphereLight(C('#CFE6F7'), C('#C9B48A'), 1.35); scene.add(hemi);
export const sun = new THREE.DirectionalLight(C('#FFEBCF'), 2.6); sun.position.set(-9, 14, 10); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
scene.add(sun); scene.add(sun.target);
export const fill = new THREE.DirectionalLight(C('#BFD8F0'), 0.55); fill.position.set(10, 6, -6); scene.add(fill);

export const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 200);
const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
export const composer = new EffectComposer(renderer, rt); composer.setPixelRatio(1); composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.25, 0.4, 0.9); composer.addPass(bloom);  // strength <= 0.35, threshold >= 0.85
composer.addPass(new OutputPass());
// gentle finishing pass: vignette <= 25% at the corners, grain 1.5%
export const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, t: { value: 0 }, cool: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float t, cool; varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; c=mix(c, c*vec3(0.94,0.99,1.06), cool);
      vec2 d=vUv-.5; d.x*=0.7; c*=1.0-0.30*pow(length(d)*1.45,2.6); c+=(h(vUv*1000.+t)-.5)*0.015; gl_FragColor=vec4(c,1.); }` });
composer.addPass(grade);

// ---------------------------------------------------------------- materials: faceted, roughness 0.55-0.9 (SKILL.md 6)
const cache = {};
export const M = (hex, o = {}) => cache[hex + JSON.stringify(o)] ||= new THREE.MeshStandardMaterial({ color: C(hex), flatShading: true, roughness: 0.78, metalness: 0, ...o });
export const E = (hex, s = 1) => cache['E' + hex + s] ||= new THREE.MeshBasicMaterial({ color: C(hex).multiplyScalar(s), fog: false });
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; (parent || world).add(m); return m; }
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// a lumpy faceted blob (tree canopy, bush, rock): icosahedron with jittered vertices, deterministic
export function blob(r, detail = 1, jit = 0.12) { const g = new THREE.IcosahedronGeometry(r, detail); const p = g.attributes.position; const m = new Map();
  for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; if (!m.has(k)) m.set(k, 1 + (rnd() - 0.5) * 2 * jit); const s = m.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); }
  g.computeVertexNormals(); return g; }

// ---------------------------------------------------------------- characters (SKILL.md 9): one face, hand and outfit system
// height in metres; head = height / 6.5; eyes at 45% of head height. Origin at the feet, facing +z.
export function person(o = {}) {
  const h = o.height || 1.7, skin = o.skin || PAL.skin[1], hair = o.hair || PAL.hair[0];
  const top = o.top || PAL.navy, bottom = o.bottom || PAL.charcoal, kimono = o.outfit === 'kimono';
  const g = new THREE.Group(); (o.parent || world).add(g);
  const head = h / 6.5, leg = h * 0.47, torso = h * 0.3, sh = h * 0.125;
  const hips = new THREE.Group(); hips.position.y = leg; g.add(hips);
  const legs = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * h * 0.05, 0, 0); hips.add(p);
    mesh(new THREE.CylinderGeometry(h * 0.04, h * 0.032, leg * 0.94, 6), M(kimono ? PAL.offwhite : bottom), 0, -leg * 0.47, 0, p);
    mesh(box(h * 0.06, h * 0.035, h * 0.12), M(o.shoes || '#3B2A20'), 0, -leg + h * 0.0175, h * 0.025, p); return p; });
  const body = new THREE.Group(); body.position.y = leg; g.add(body);
  if (kimono) { mesh(new THREE.CylinderGeometry(h * 0.1, h * 0.13, leg * 0.88, 8), M(bottom), 0, -leg * 0.47 + leg * 0.06, 0, body);
    mesh(new THREE.CylinderGeometry(h * 0.105, h * 0.105, h * 0.06, 8), M(o.obi || PAL.golden), 0, torso * 0.3, 0, body); }
  mesh(new THREE.CylinderGeometry(h * 0.1, h * 0.085, torso, 7), M(top), 0, torso / 2, 0, body);
  if (o.collar) mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.06, h * 0.05, 6), M(o.collar), 0, torso * 0.97, h * 0.012, body);
  const arms = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * h * 0.125, torso * 0.92, 0); body.add(p);
    mesh(new THREE.CylinderGeometry(h * (kimono ? 0.045 : 0.032), h * (kimono ? 0.05 : 0.028), sh * 2.6, 6), M(top), 0, -sh * 1.3, 0, p);
    // mitten hand with a separate thumb
    const hand = new THREE.Group(); hand.position.y = -sh * 2.65; p.add(hand);
    mesh(box(h * 0.035, h * 0.05, h * 0.03), M(skin), 0, 0, 0, hand); mesh(box(h * 0.012, h * 0.025, h * 0.014), M(skin), -s * h * 0.022, h * 0.006, h * 0.006, hand);
    p.userData.hand = hand; return p; });
  const neck = new THREE.Group(); neck.position.y = torso; body.add(neck);
  const hd = new THREE.Group(); hd.position.y = head * 0.62; neck.add(hd);
  mesh(new THREE.IcosahedronGeometry(head * 0.5, 1), M(skin), 0, 0, 0, hd).scale.set(0.9, 1.05, 0.92);
  mesh(new THREE.CylinderGeometry(head * 0.17, head * 0.2, head * 0.3, 5), M(skin), 0, -head * 0.5, 0, neck).position.y = head * 0.1;
  for (const s of [-1, 1]) { mesh(new THREE.CircleGeometry(head * 0.075, 6), E(PAL.eye), s * head * 0.17, -head * 0.05 + head * 0.0, head * 0.43, hd);
    const cl = mesh(new THREE.CircleGeometry(head * 0.022, 5), E('#FFFFFF'), s * head * 0.17 + head * 0.025, head * 0.0, head * 0.435, hd); cl.castShadow = false;
    const br = mesh(box(head * 0.2, head * 0.045, head * 0.04), M(hair), s * head * 0.17, head * 0.13, head * 0.41, hd); br.rotation.z = s * -0.12; }
  mesh(new THREE.ConeGeometry(head * 0.06, head * 0.14, 4), M(skin), 0, -head * 0.12, head * 0.45, hd).rotation.x = Math.PI / 2;  // nose
  const mouth = mesh(box(head * 0.16, head * 0.03, head * 0.03), M('#7A3B33'), 0, -head * 0.26, head * 0.41, hd);
  const hairM = M(hair); const cap = mesh(new THREE.SphereGeometry(head * 0.53, 8, 5, 0, Math.PI * 2, 0, o.longHair ? 1.9 : 1.35), hairM, 0, head * 0.03, -head * 0.03, hd);
  if (o.bun) mesh(new THREE.IcosahedronGeometry(head * 0.2, 0), hairM, 0, head * 0.25, -head * 0.4, hd);
  if (o.hat === 'fedora') { mesh(new THREE.CylinderGeometry(head * 0.62, head * 0.62, head * 0.04, 10), M(o.hatCol || PAL.navy), 0, head * 0.38, 0, hd);
    mesh(new THREE.CylinderGeometry(head * 0.38, head * 0.44, head * 0.32, 8), M(o.hatCol || PAL.navy), 0, head * 0.55, 0, hd); }
  if (o.hat === 'boater') { mesh(new THREE.CylinderGeometry(head * 0.66, head * 0.66, head * 0.04, 10), M('#E8D49A'), 0, head * 0.38, 0, hd);
    mesh(new THREE.CylinderGeometry(head * 0.42, head * 0.42, head * 0.24, 9), M('#E8D49A'), 0, head * 0.5, 0, hd); mesh(new THREE.CylinderGeometry(head * 0.425, head * 0.425, head * 0.07, 9), M(PAL.navy), 0, head * 0.44, 0, hd); }
  if (o.bag) { const b = mesh(box(h * 0.2, h * 0.14, h * 0.05), M(o.bag), 0, -h * 0.08, 0, arms[1].userData.hand); b.position.set(0, -h * 0.08, 0); }
  g.userData = { h, legs, arms, body, hips, hd, mouth, leg, step: o.step || h * 0.42, cadence: o.cadence || 1.8 };
  return g;
}

// Planted-foot walk: during stance the foot is fixed in the world, so ground speed = step x cadence exactly (no sliding).
// d = distance walked so far (m). Returns nothing; poses the legs, arms and body.
export function walkPose(p, d, lift = 1) {
  const u = p.userData, L = u.step, legLen = u.leg;
  const cyc = d / (2 * L);  // one cycle = two steps
  u.legs.forEach((lg, k) => { const ph = (cyc + k * 0.5) % 1; let off, up = 0;
    if (ph < 0.5) off = L / 2 - (ph / 0.5) * L; else { const s = sm(0, 1, (ph - 0.5) / 0.5); off = -L / 2 + s * L; up = Math.sin(Math.PI * (ph - 0.5) / 0.5) * 0.06 * lift; }
    lg.rotation.x = -Math.asin(clamp(off / legLen, -0.9, 0.9)); lg.scale.y = 1 - up; });
  u.arms.forEach((a, k) => (a.rotation.x = Math.sin(2 * Math.PI * cyc + k * Math.PI) * 0.35));
  const bob = Math.abs(Math.cos(2 * Math.PI * cyc)) * 0.02; u.body.position.y = u.leg + bob; u.hips.position.y = u.leg + bob;
}
export function standPose(p, t = 0) { const u = p.userData; u.legs.forEach((l) => { l.rotation.x = 0; l.scale.y = 1; }); u.arms.forEach((a, k) => (a.rotation.x = 0.04 * Math.sin(t * 1.3 + k)));
  u.body.position.y = u.leg + 0.004 * Math.sin(t * 2.1); }
// walk a person along a polyline path (array of [x,z]) at speed = step x cadence; returns the update fn (t in s)
export function walker(p, path, t0 = 0, speedMul = 1) {
  const pts = path.map(([x, z]) => V(x, 0, z)); const segs = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); segs.push([pts[i - 1], pts[i], tot, l]); tot += l; }
  const v = p.userData.step * p.userData.cadence * speedMul;
  return (t) => { const d = clamp((t - t0) * v, 0, tot); let s = segs[segs.length - 1]; for (const q of segs) if (d <= q[2] + q[3]) { s = q; break; }
    const k = s[3] ? (d - s[2]) / s[3] : 0; p.position.lerpVectors(s[0], s[1], k); p.rotation.y = Math.atan2(s[1].x - s[0].x, s[1].z - s[0].z);
    p.visible = t >= t0 && d < tot - 0.01; walkPose(p, d); return d >= tot; };
}

// ---------------------------------------------------------------- dog (medium breed, ~0.62 m at the shoulder). Origin at the feet, facing +z.
export function dog(o = {}) {
  const coat = o.coat || '#E9D3AE', belly = o.belly || '#F7EEDD', dark = o.dark || PAL.wood; const s = o.size || 1;
  const g = new THREE.Group(); (o.parent || world).add(g); g.scale.setScalar(s);
  const root = new THREE.Group(); root.position.y = 0.42; g.add(root);   // body pivot near the hips
  const torso = new THREE.Group(); root.add(torso);
  const tb = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.52, 7), M(coat), 0, 0, 0.18, torso); tb.rotation.x = Math.PI / 2;
  mesh(new THREE.IcosahedronGeometry(0.17, 1), M(coat), 0, 0.02, 0.42, torso).scale.set(1, 1.05, 0.9);      // chest
  mesh(new THREE.IcosahedronGeometry(0.12, 1), M(belly), 0, -0.04, 0.52, torso).scale.set(0.9, 1.1, 0.6);    // white chest
  mesh(new THREE.IcosahedronGeometry(0.15, 1), M(coat), 0, 0.0, -0.06, torso);                               // haunch
  const neck = new THREE.Group(); neck.position.set(0, 0.1, 0.5); torso.add(neck);
  mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.22, 7), M(coat), 0, 0.08, 0.02, neck).rotation.x = -0.5;
  if (o.collar) { const c = mesh(new THREE.TorusGeometry(0.115, 0.018, 4, 10), M(o.collar), 0, 0.05, 0.0, neck); c.rotation.x = Math.PI / 2 - 0.5; }
  const head = new THREE.Group(); head.position.set(0, 0.22, 0.08); neck.add(head);
  mesh(new THREE.IcosahedronGeometry(0.12, 1), M(coat), 0, 0, 0, head).scale.set(1.1, 0.95, 1.0);
  const muz = mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.13, 6), M(belly), 0, -0.035, 0.13, head); muz.rotation.x = Math.PI / 2;
  mesh(new THREE.IcosahedronGeometry(0.025, 0), M('#1F1A17'), 0, -0.02, 0.2, head);
  for (const k of [-1, 1]) { mesh(new THREE.CircleGeometry(0.018, 6), E(PAL.eye), k * 0.05, 0.03, 0.105, head).rotation.y = k * 0.25;
    mesh(new THREE.CircleGeometry(0.006, 4), E('#FFFFFF'), k * 0.05 + 0.006, 0.037, 0.107, head).rotation.y = k * 0.25; }
  const ears = [-1, 1].map((k) => { const e = new THREE.Group(); e.position.set(k * 0.065, 0.085, -0.01); head.add(e);
    const c = mesh(new THREE.ConeGeometry(0.04, 0.085, 3), M(coat), 0, 0.04, 0, e); c.rotation.y = Math.PI / 6; mesh(new THREE.ConeGeometry(0.022, 0.05, 3), M(dark), 0, 0.03, 0.012, e); e.rotation.z = -k * 0.25; return e; });
  // curled tail over the back (Akita)
  const tail = new THREE.Group(); tail.position.set(0, 0.12, -0.12); torso.add(tail);
  const tc = mesh(new THREE.TorusGeometry(0.075, 0.04, 5, 8, Math.PI * 1.4), M(coat), 0, 0.06, -0.02, tail); tc.rotation.y = Math.PI / 2;
  // legs: front pair hangs from the chest, back pair from the haunch
  const legs = [[-0.08, 0.42], [0.08, 0.42], [-0.08, -0.05], [0.08, -0.05]].map(([x, z], k) => { const p = new THREE.Group(); p.position.set(x, -0.02, z); root.add(p);
    mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 5), M(coat), 0, -0.2, 0, p); mesh(box(0.06, 0.035, 0.08), M(belly), 0, -0.4, 0.015, p); p.userData.front = k < 2; return p; });
  g.userData = { root, torso, neck, head, ears, tail, legs, step: 0.36, cadence: 3.0 };
  return g;
}
// sit: hips down, torso up ~35 deg, hind legs folded under, front legs straight
export function dogSit(d, t, look = 0, earDroop = false) { const u = d.userData;
  u.root.position.y = 0.18; u.torso.rotation.x = -0.62; u.root.position.z = 0;
  u.legs.forEach((l) => { if (l.userData.front) { l.position.y = 0.2; l.position.z = 0.31; l.rotation.x = 0; l.scale.y = 1.0; } else { l.position.y = -0.02; l.position.z = -0.02; l.rotation.x = -1.35; l.scale.y = 0.55; } });
  u.neck.rotation.x = 0.55 + 0.03 * Math.sin(t * 2.4); u.head.rotation.y = look; u.head.rotation.x = -0.05 + 0.02 * Math.sin(t * 1.7);
  u.ears[1].rotation.z = -0.25; u.ears[0].rotation.z = earDroop ? 1.2 : 0.25; u.ears[0].rotation.x = earDroop ? 0.4 : 0;  // in his later years Hachiko's left ear drooped
  u.tail.rotation.z = 0.08 * Math.sin(t * 3.2); u.torso.scale.y = 1 + 0.012 * Math.sin(t * 4.0);  // breathing
}
export function dogWalk(d, dist, t) { const u = d.userData, L = u.step; const cyc = dist / (2 * L);
  u.root.position.y = 0.42 + 0.012 * Math.abs(Math.sin(2 * Math.PI * cyc)); u.torso.rotation.x = 0;
  u.legs.forEach((l, k) => { const ph = (cyc + ((k === 0 || k === 3) ? 0 : 0.5)) % 1; let off, up = 0;   // diagonal pairs (trot)
    if (ph < 0.5) off = L / 2 - (ph / 0.5) * L; else { const s = sm(0, 1, (ph - 0.5) / 0.5); off = -L / 2 + s * L; up = Math.sin(Math.PI * (ph - 0.5) / 0.5) * 0.15; }
    l.position.y = -0.02; l.position.z = l.userData.front ? 0.42 : -0.05; l.rotation.x = -Math.asin(clamp(off / 0.4, -0.9, 0.9)); l.scale.y = 1 - up; });
  u.neck.rotation.x = 0.1; u.head.rotation.y = 0.15 * Math.sin(t * 1.1); u.head.rotation.x = 0;
  u.ears.forEach((e, k) => { e.rotation.z = (k ? -0.25 : 0.25); e.rotation.x = 0; }); u.tail.rotation.z = 0.25 * Math.sin(t * 7);
}

// ---------------------------------------------------------------- camera helpers (SKILL.md 7): eased moves only
export function orbit(tgt, az, el, dist) { camera.position.set(tgt.x + dist * Math.cos(el) * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(el) * Math.cos(az)); camera.lookAt(tgt); }

// ---------------------------------------------------------------- 9:16 overlay text (SKILL.md 8, 10): paper card, ink text
const out = document.createElement('canvas'); out.width = W; out.height = H; const og = out.getContext('2d');
export function card(text, { y = 0.2, size = 0.052, alpha = 1, sub = false } = {}) {
  if (alpha <= 0.01 || !text) return; og.save(); og.globalAlpha = alpha;
  const fs = Math.round(H * size); og.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; og.textBaseline = 'middle';
  const lines = text.split('\n'); const wmax = Math.max(...lines.map((l) => og.measureText(l).width)); const pad = fs * 0.45, lh = fs * 1.15;
  const bw = wmax + pad * 2, bh = lines.length * lh + pad * 0.9; const cx = W * 0.45, x0 = cx - bw / 2, y0 = H * y - bh / 2;   // centred in x 6-84% (clear of the right rail)
  og.fillStyle = sub ? 'rgba(30,34,40,0.82)' : PAL.paper; og.beginPath(); og.roundRect(x0, y0, bw, bh, fs * 0.3); og.fill();
  og.fillStyle = sub ? PAL.paper : PAL.ink; og.textAlign = 'center'; lines.forEach((l, k) => og.fillText(l, cx, y0 + pad * 0.45 + lh * (k + 0.5)));
  og.restore();
}

export function run(update, overlay = () => {}) {
  const draw = (i) => { const t = i / FPS, u = i / (N - 1), e = u * u * (3 - 2 * u); update(t, u, e); grade.uniforms.t.value = i * 0.37; composer.render();
    og.clearRect(0, 0, W, H); og.drawImage(renderer.domElement, 0, 0); overlay(t, u, e); return out; };
  window.renderFrame = (i) => draw(i).toDataURL('image/jpeg', 0.93);
  window.FRAMES = N; window.ready = true;
  // live preview in a browser: show the composited canvas and play or hold a time
  if (P.get('play') || P.get('t')) { renderer.domElement.style.display = 'none'; document.body.appendChild(out);
    if (P.get('t')) draw(Math.round(+P.get('t') * FPS)); else { let i = 0; const loop = () => { draw(i); i = (i + 1) % N; requestAnimationFrame(loop); }; loop(); } }
}
