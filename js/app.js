import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel, DIM, H, H_DEFAULT, H_LABELS, MEASURED, P, W_PHI, PC_PHI, heightChips, setMeasurements } from './model.js';

const $ = (id) => document.getElementById(id);
const V = THREE.Vector3;
const ZAX = new V(0, 0, 1);
const viewport = $('viewport');

// ---------- renderer, scena, kamera ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
} catch (err) {
  $('loading').textContent = 'Ta przeglądarka nie udostępnia WebGL. Otwórz stronę w Chrome, Safari albo Firefoksie.';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.setClearColor(0x000000, 0);
viewport.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f969e, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(1400, 2600, 1900);
const fill = new THREE.DirectionalLight(0xdfe7ff, 0.7);
fill.position.set(-1800, 900, -1400);
scene.add(sun, fill);

const camera = new THREE.PerspectiveCamera(32, 1, 10, 40000);
let sceneTop = 1515;
const TARGET = new V(0, (DIM.floor + sceneTop) / 2, 0);
// [punkt, na który patrzy kamera, kierunek do kamery]; odległość dobierana tak, by zmieścić zasobnik.
const VIEWS = {
  iso: [TARGET, new V(-0.78, 0.3, 0.55)],
  isoBackLeft: [TARGET, new V(-0.72, 0.3, -0.62)],
  isoFront: [TARGET, new V(0.36, 0.3, 0.88)],
  isoTop: [new V(0, 560, 0), new V(0.42, 0.78, 0.47)],
  front: [TARGET, new V(0, 0.04, 1)],
  back: [TARGET, new V(0, 0.04, -1)],
  right: [TARGET, new V(1, 0.04, 0)],
  left: [TARGET, new V(-1, 0.04, 0)],
  top: [new V(0, 700, 0), new V(0.002, 1, 0.1)],
};
function fitDist() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(((sceneTop - DIM.floor) / 2 + 190) / t, 560 / (t * camera.aspect));
}
function viewPose(name) {
  const [t, d] = VIEWS[name];
  const k = name === 'isoTop' || name === 'top' ? 0.72 : 1;
  return [t, t.clone().addScaledVector(d.clone().normalize(), fitDist() * k)];
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 300;
controls.maxDistance = 8000;

// ---------- płaszczyzny przekroju ----------
// A: pionowa, normalna wzdłuż X (przesuw lewo–prawo), B: pionowa wzdłuż Z (przód–tył), H: pozioma.
// Wyłączona płaszczyzna jest odsuwana daleko, żeby liczba płaszczyzn (i shadery) się nie zmieniała.
const BIG = 1e7;
const planes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
const negPlanes = planes.map(() => new THREE.Plane());
const capClip = {
  union: [0, 1, 2].map((i) => planes.filter((_, j) => j !== i)),
  corner: [0, 1, 2].map((i) => negPlanes.filter((_, j) => j !== i)),
};
const sec = {
  mode: 'union', rot: 0,
  p: [{ on: true, pos: 0, flip: true }, { on: false, pos: 0, flip: false }, { on: false, pos: 800, flip: false }],
};
let effMode = 'union';
const ui = { pins: true, names: false, dims: false, leaks: false, frames: false, access: false };

// ---------- otwory w warstwach (discard w shaderze) ----------
const MAXB = 16;
function boreUniforms(list) {
  const A = [], B = [], R = [];
  for (let i = 0; i < MAXB; i++) {
    const b = list[i];
    A.push(b ? b.a.clone() : new V());
    B.push(b ? b.b.clone() : new V(0, 1, 0));
    R.push(b ? b.r : 0);
  }
  return { uBoreA: { value: A }, uBoreB: { value: B }, uBoreR: { value: R }, uBoreN: { value: Math.min(list.length, MAXB) } };
}
function withBores(mat, uni) {
  if (!uni) return mat;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoreW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvBoreW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBoreW;
uniform vec3 uBoreA[${MAXB}];
uniform vec3 uBoreB[${MAXB}];
uniform float uBoreR[${MAXB}];
uniform int uBoreN;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	for (int i = 0; i < ${MAXB}; i++) {
		if (i >= uBoreN) break;
		vec3 ab = uBoreB[i] - uBoreA[i];
		float t = dot(vBoreW - uBoreA[i], ab) / dot(ab, ab);
		if (t > 0.0 && t < 1.0 && length(vBoreW - uBoreA[i] - t * ab) < uBoreR[i]) discard;
	}`);
  };
  mat.customProgramCacheKey = () => 'bores';
  return mat;
}

// ---------- części modelu + zaślepki przekroju (stencil) ----------
// Dla każdej bryły i płaszczyzny: tylne ściany +1, przednie −1 w stencilu, potem płaszczyzna
// rysowana tam, gdzie stencil ≠ 0 (wnętrze bryły), w kolorze materiału przekroju.
// Własne pomiary wysokości: z adresu (?m=h6:1040,h7:1140) albo zapamiętane w przeglądarce.
const MEAS_KEY = 'zasobnikS15.pomiary';
function readMeasurements() {
  let src = new URLSearchParams(location.search).get('m');
  if (src === null) {
    try { src = localStorage.getItem(MEAS_KEY); } catch { src = null; }
  }
  const out = {};
  for (const pair of (src ?? '').split(',')) {
    const [k, v] = pair.split(':');
    if (k && v) out[k.trim()] = Number(v);
  }
  return out;
}
setMeasurements(readMeasurements());
const model = buildModel();
const boreUni = Object.fromEntries(Object.entries(model.bores).map(([k, l]) => [k, boreUniforms(l)]));
const parts = [];
const stencilMats = planes.map((pl) => {
  const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [pl] };
  const op = (o) => ({ stencilFail: o, stencilZFail: o, stencilZPass: o });
  return [
    new THREE.MeshBasicMaterial({ ...base, side: THREE.BackSide, ...op(THREE.IncrementWrapStencilOp) }),
    new THREE.MeshBasicMaterial({ ...base, side: THREE.FrontSide, ...op(THREE.DecrementWrapStencilOp) }),
  ];
});
const capGroups = planes.map(() => { const g = new THREE.Group(); scene.add(g); return g; });
const capGeo = new THREE.PlaneGeometry(5000, 5000);
const idColor = (id) => new THREE.Color().setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, THREE.LinearSRGBColorSpace);
let order = 10;

function addPart(el, spec) {
  const uni = spec.bores ? boreUni[spec.bores] : null;
  const side = spec.side ?? THREE.FrontSide;
  const mat = withBores(new THREE.MeshStandardMaterial({
    color: spec.color, metalness: spec.metal ?? 0, roughness: spec.rough ?? 0.6, side, clippingPlanes: planes,
    transparent: !!spec.transparent, opacity: spec.opacity ?? 1, depthWrite: !spec.transparent, vertexColors: !!spec.vertexColors,
  }), uni);
  const mesh = new THREE.Mesh(spec.geo, mat);
  mesh.renderOrder = spec.transparent ? 900000 : 800000;
  scene.add(mesh);
  const p = { el, spec, mesh, mat, id: parts.length + 1, stencil: [], caps: [], capMats: [], capPick: [] };
  p.pickMat = withBores(new THREE.MeshBasicMaterial({ color: idColor(p.id), clippingPlanes: planes, side, toneMapped: false }), uni);
  p.capBase = new THREE.Color(spec.cap).multiplyScalar(0.25);
  if (!spec.noCap) {
    for (let i = 0; i < 3; i++) {
      const ro = order;
      order += 2;
      const [mb, mf] = stencilMats[i];
      const sb = new THREE.Mesh(spec.geo, mb), sf = new THREE.Mesh(spec.geo, mf);
      sb.renderOrder = sf.renderOrder = ro;
      scene.add(sb, sf);
      const capCfg = {
        side: THREE.DoubleSide, clippingPlanes: capClip.union[i], stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      };
      const cm = withBores(new THREE.MeshStandardMaterial({ ...capCfg, color: spec.cap, roughness: 0.85, metalness: 0, emissive: p.capBase.clone() }), uni);
      const cp = withBores(new THREE.MeshBasicMaterial({ ...capCfg, color: idColor(p.id), toneMapped: false }), uni);
      const cap = new THREE.Mesh(capGeo, cm);
      cap.renderOrder = ro + 1;
      cap.frustumCulled = false;
      cap.onAfterRender = (r) => r.clearStencil();
      capGroups[i].add(cap);
      p.stencil.push([sb, sf]);
      p.caps.push(cap);
      p.capMats.push(cm);
      p.capPick.push(cp);
    }
  }
  parts.push(p);
  (el.rt ??= []).push(p);
}
for (const el of model.elements) for (const spec of el.parts) addPart(el, spec);

// Tarcza termometru (dekoracja bez przekroju).
const clippedExtras = [];
const decor = [];
function dialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf8';
  g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#25282c'; g.fillStyle = '#25282c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 26px system-ui, sans-serif';
  const ang = (v) => Math.PI * (0.75 + (1.5 * v) / 120);
  for (let v = 0; v <= 120; v += 10) {
    const a = ang(v), r1 = v % 20 === 0 ? 90 : 100;
    g.lineWidth = v % 20 === 0 ? 4 : 2;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1); g.lineTo(128 + Math.cos(a) * 113, 128 + Math.sin(a) * 113); g.stroke();
    if (v % 40 === 0) g.fillText(String(v), 128 + Math.cos(a) * 66, 128 + Math.sin(a) * 66);
  }
  g.font = '600 22px system-ui, sans-serif';
  g.fillText('°C', 128, 186);
  const a = ang(52);
  g.strokeStyle = '#d0312d'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); g.stroke();
  g.beginPath(); g.arc(128, 128, 9, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
for (const el of model.elements) {
  for (const d of el.decor) {
    const m = new THREE.MeshBasicMaterial({ map: dialTexture(), clippingPlanes: planes });
    clippedExtras.push(m);
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(d.r, 48), m);
    mesh.position.copy(d.pos);
    mesh.renderOrder = 800001;
    scene.add(mesh);
    decor.push({ el, mesh });
  }
}

// ---------- otoczenie: podłoga, opisy przód/tył ----------
const nonPickable = [];
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.34)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = DIM.floor + 0.5;
  const grid = new THREE.GridHelper(4000, 40, 0x8e97a1, 0xb9c0c8);
  grid.position.y = DIM.floor;
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  scene.add(shadow, grid);
  nonPickable.push(shadow, grid);
}
const floorLabels = [['PRZÓD (rewizja)', new V(0, DIM.floor, 820)], ['TYŁ (przyłącza)', new V(0, DIM.floor, -820)]].map(([txt, p]) => {
  const d = document.createElement('div');
  d.className = 'floor';
  d.textContent = txt;
  const o = new CSS2DObject(d);
  o.position.copy(p);
  scene.add(o);
  return o;
});

// ---------- wymiary ----------
const dims = new THREE.Group();
scene.add(dims);
nonPickable.push(dims);
const dimLabels = [];
{
  const mat = new THREE.LineBasicMaterial({ color: 0x3b4652, depthTest: false, transparent: true, opacity: 0.85 });
  const line = (a, b) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat); l.renderOrder = 1e6; dims.add(l); };
  const label = (text, p, cls = '') => {
    const d = document.createElement('div');
    d.className = `dim ${cls}`;
    d.textContent = text;
    const o = new CSS2DObject(d);
    o.position.copy(p);
    dims.add(o);
    dimLabels.push(o);
  };
  // Linie wymiarowe z tyłu (przyłącza) i z przodu (termometr, rewizja, spust); bliskie wysokości dzielą jeden opis.
  const dimSide = (z, items) => {
    const zz = z + Math.sign(z) * 16;
    line(new V(0, 0, z), new V(0, DIM.L, z));
    line(new V(0, 0, Math.sign(z) * 340), new V(0, 0, zz));
    line(new V(0, DIM.L, Math.sign(z) * 150), new V(0, DIM.L, zz));
    const groups = [];
    for (const it of [...items].sort((a, b) => a.y - b.y)) {
      line(it.from, new V(0, it.y, zz));
      const g = groups[groups.length - 1];
      if (g && it.y - g.y < 40) g.txt.push(it.txt);
      else groups.push({ y: it.y, txt: [it.txt] });
    }
    for (const g of groups) label(g.txt.join(' · '), new V(0, g.y, z + Math.sign(z) * 24), 'left');
  };
  const at = (k, phi, txt) => ({ y: H[k], from: P(352, phi, H[k]), txt: `${k} = ${H[k]} ${txt}` });
  dimSide(-480, [at('h9', W_PHI, 'c.w.u.'), at('h8', PC_PHI, 'zasil. PC'), at('h7', W_PHI, 'termostat'), at('h6', PC_PHI, 'cyrk.'), at('h4', W_PHI, 'czujnik'), at('h2', W_PHI, 'zimna'), at('h3', PC_PHI, 'powrót PC')]);
  dimSide(480, [at('h11', 0, 'termometr'), at('h12', 0, 'rewizja'), { y: H.h1, from: new V(0, H.h1, 36), txt: `h1 = ${H.h1} spust` }]);
  label('0 = podłoga', new V(0, 0, -504), 'left');
  label(`wysokość ${DIM.L}`, new V(0, DIM.L, -504), 'left');
  const yD = DIM.L + 95, yd = DIM.L + 45;
  line(new V(0, yD, -DIM.R), new V(0, yD, DIM.R));
  line(new V(0, DIM.L, -DIM.R), new V(0, yD + 14, -DIM.R));
  line(new V(0, DIM.L, DIM.R), new V(0, yD + 14, DIM.R));
  label('Ø650 z izolacją', new V(0, yD + 22, 0), 'up');
  line(new V(0, yd, -DIM.Rs), new V(0, yd, DIM.Rs));
  line(new V(0, DIM.yTk, -DIM.Rs), new V(0, yd + 12, -DIM.Rs));
  line(new V(0, DIM.yTk, DIM.Rs), new V(0, yd + 12, DIM.Rs));
  label('Ø550 zbiornik', new V(0, yd - 18, 0), 'up');
}

// ---------- przecieki ----------
const leakGroup = new THREE.Group();
scene.add(leakGroup);
nonPickable.push(leakGroup);
const leakMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.95, clippingPlanes: planes });
const dripMat = new THREE.MeshBasicMaterial({ color: 0x1e7bff, depthTest: false, transparent: true, opacity: 0.95, clippingPlanes: planes });
const dripLineMat = new THREE.LineBasicMaterial({ color: 0x1e7bff, depthTest: false, transparent: true, opacity: 0.75, clippingPlanes: planes });
clippedExtras.push(leakMat, dripMat, dripLineMat);
const leakRings = [];
for (const L of model.leaks) {
  for (const rg of L.rings) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(rg.r, Math.max(2.2, rg.r * 0.06), 10, 56), leakMat);
    m.position.copy(rg.pos);
    m.quaternion.setFromUnitVectors(ZAX, rg.axis.clone().normalize());
    m.renderOrder = 1e6;
    leakGroup.add(m);
    leakRings.push(m);
  }
}
const dripCurve = new THREE.CatmullRomCurve3(model.drip, false, 'centripetal');
{
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(dripCurve.getSpacedPoints(240)), dripLineMat);
  l.renderOrder = 1e6;
  leakGroup.add(l);
  const hole = new THREE.Mesh(new THREE.TorusGeometry(10, 2.5, 8, 32), leakMat);
  hole.position.copy(model.pinhole);
  hole.lookAt(new V(0, model.pinhole.y, 0));
  hole.renderOrder = 1e6;
  leakGroup.add(hole);
}
const drops = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 8), dripMat);
  m.renderOrder = 1e6;
  leakGroup.add(m);
  return m;
});
const holeLabel = (() => {
  const d = document.createElement('div');
  d.className = 'dim warn';
  d.textContent = 'przykładowa dziura → woda spływa pod pianką';
  const o = new CSS2DObject(d);
  o.position.copy(model.pinhole).add(new V(0, 40, 0));
  scene.add(o);
  return o;
})();

// ---------- dostęp przez rewizję do korka dolnego ----------
const access = new THREE.Group();
scene.add(access);
nonPickable.push(access);
let accessLabel;
{
  const a = new V(0, H.h12 - 30, 300), b = new V(0, DIM.yBa + 10, 32);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: 0x2f9e44, dashSize: 14, gapSize: 9, depthTest: false, transparent: true }));
  l.computeLineDistances();
  l.renderOrder = 1e6;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(48, 3, 8, 48), new THREE.MeshBasicMaterial({ color: 0x2f9e44, depthTest: false, transparent: true }));
  ring.position.set(0, DIM.yBa + 1, 0);
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 1e6;
  access.add(l, ring);
  const d = document.createElement('div');
  d.className = 'dim ok';
  d.textContent = `rewizja Ø125 → spaw mufy spustu ≈ ${Math.round(a.distanceTo(b) / 10)} cm`;
  accessLabel = new CSS2DObject(d);
  accessLabel.position.copy(a).lerp(b, 0.5).add(new V(0, 10, 60));
  scene.add(accessLabel);
}

// ---------- ramki płaszczyzn ----------
const planeFrames = [0, 1, 2].map((i) => {
  const [w, h] = i === 2 ? [1000, 1000] : [1000, 1900];
  const g = new THREE.BufferGeometry().setFromPoints([new V(-w / 2, -h / 2, 0), new V(w / 2, -h / 2, 0), new V(w / 2, h / 2, 0), new V(-w / 2, h / 2, 0)]);
  const l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: [0xe8590c, 0x1c7ed6, 0x2f9e44][i], transparent: true, opacity: 0.8 }));
  capGroups[i].add(l);
  nonPickable.push(l);
  return l;
});

// ---------- stan: widoczność, podświetlenie, wybór ----------
let hovered = null, selected = null, solo = false;
const HL = new THREE.Color(0xff7a1a), tmpC = new THREE.Color();

function refreshPaint() {
  for (const el of model.elements) {
    const k = el === selected ? 0.42 : el === hovered ? 0.24 : 0;
    for (const p of el.rt) {
      p.mat.emissive.copy(HL).multiplyScalar(k);
      p.capMats.forEach((m) => m.emissive.copy(p.capBase).add(tmpC.copy(HL).multiplyScalar(k * 0.9)));
    }
  }
}
const shown = (el) => el.visible && (!solo || !selected || el === selected);

function syncVisibility() {
  for (const p of parts) {
    const vis = shown(p.el);
    p.mesh.visible = vis;
    p.stencil.forEach(([b, f], i) => (b.visible = f.visible = vis && sec.p[i].on));
    p.caps.forEach((c, i) => (c.visible = vis && sec.p[i].on));
  }
  for (const d of decor) d.mesh.visible = shown(d.el);
  scheduleOcclusion();
}

function updatePlanes() {
  const active = sec.p.filter((q) => q.on).length;
  const mode = active ? sec.mode : 'union';
  const th = THREE.MathUtils.degToRad(sec.rot);
  const axes = [new V(Math.cos(th), 0, -Math.sin(th)), new V(Math.sin(th), 0, Math.cos(th)), new V(0, 1, 0)];
  sec.p.forEach((q, i) => {
    const pl = planes[i];
    if (q.on) {
      pl.normal.copy(axes[i]).multiplyScalar(q.flip ? 1 : -1);
      pl.constant = q.flip ? -q.pos : q.pos;
    } else {
      pl.normal.set(0, 1, 0);
      pl.constant = mode === 'corner' ? -BIG : BIG;
    }
    negPlanes[i].copy(pl).negate();
    pl.projectPoint(TARGET, capGroups[i].position);
    capGroups[i].quaternion.setFromUnitVectors(ZAX, pl.normal);
    planeFrames[i].visible = q.on && ui.frames;
  });
  if (mode !== effMode) {
    effMode = mode;
    const inter = mode === 'corner';
    for (const p of parts) {
      p.mat.clipIntersection = p.pickMat.clipIntersection = inter;
      p.capMats.forEach((m, i) => (m.clippingPlanes = capClip[mode][i]));
      p.capPick.forEach((m, i) => (m.clippingPlanes = capClip[mode][i]));
    }
    for (const m of clippedExtras) m.clipIntersection = inter;
  }
  syncVisibility();
}

function kept(p, margin = 4) {
  const ds = [];
  sec.p.forEach((q, i) => { if (q.on) ds.push(planes[i].distanceToPoint(p)); });
  if (!ds.length) return true;
  return effMode === 'corner' ? ds.some((d) => d > -margin) : ds.every((d) => d > -margin);
}

function updatePins() {
  for (const el of model.elements) {
    el.pin.visible = ui.pins && shown(el) && kept(el.anchor);
    el.pinDiv.classList.toggle('occluded', !!el.occluded);
    el.pinDiv.classList.toggle('sel', el === selected);
    el.pinDiv.classList.toggle('hov', el === hovered);
  }
  // napis na podłodze znika, gdy leży za zasobnikiem
  const toCam = new V(camera.position.x, 0, camera.position.z);
  for (const o of floorLabels) o.visible = o.position.x * toCam.x + o.position.z * toCam.z > -0.65 * toCam.length() * o.position.length();
  for (const o of dimLabels) o.visible = ui.dims;
  dims.visible = ui.dims;
  noAnode.visible = !hasAnode() && kept(noAnode.position);
  access.visible = accessLabel.visible = ui.access;
  leakGroup.visible = ui.leaks;
  holeLabel.visible = ui.leaks && kept(model.pinhole);
}

// ---------- render identyfikatorów (wskazywanie myszą, zasłanianie numerów) ----------
const pickRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: true });
const occRT = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true, stencilBuffer: true });
const pickBuf = new Uint8Array(4);

function idRender(target, offset) {
  const off = nonPickable.filter((o) => o.visible);
  off.forEach((o) => (o.visible = false));
  const decoOn = decor.filter((d) => d.mesh.visible);
  decoOn.forEach((d) => (d.mesh.visible = false));
  const noPick = parts.filter((p) => p.spec.noPick && p.mesh.visible);
  noPick.forEach((p) => (p.mesh.visible = false));
  for (const p of parts) {
    p.mesh.material = p.pickMat;
    p.caps.forEach((c, i) => (c.material = p.capPick[i]));
  }
  if (offset) camera.setViewOffset(...offset);
  renderer.setRenderTarget(target);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  if (offset) camera.clearViewOffset();
  for (const p of parts) {
    p.mesh.material = p.mat;
    p.caps.forEach((c, i) => (c.material = p.capMats[i]));
  }
  off.forEach((o) => (o.visible = true));
  decoOn.forEach((d) => (d.mesh.visible = true));
  noPick.forEach((p) => (p.mesh.visible = true));
}

function pickAt(x, y) {
  idRender(pickRT, [viewport.clientWidth, viewport.clientHeight, x, y, 1, 1]);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  const id = pickBuf[0] | (pickBuf[1] << 8);
  return id ? parts[id - 1] : null;
}

let occTimer = 0;
function scheduleOcclusion() {
  clearTimeout(occTimer);
  occTimer = setTimeout(runOcclusion, 160);
}
function runOcclusion() {
  const W = Math.max(2, Math.round(viewport.clientWidth / 3)), Hh = Math.max(2, Math.round(viewport.clientHeight / 3));
  occRT.setSize(W, Hh);
  idRender(occRT, null);
  const buf = new Uint8Array(W * Hh * 4);
  renderer.readRenderTargetPixels(occRT, 0, 0, W, Hh, buf);
  const v = new V();
  for (const el of model.elements) {
    if (el.id === 'woda') { el.occluded = false; continue; }
    v.copy(el.anchor).project(camera);
    const px = Math.round(((v.x + 1) / 2) * (W - 1)), py = Math.round(((v.y + 1) / 2) * (Hh - 1));
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy++) {
      for (let dx = -2; dx <= 2 && !hit; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
        const k = (y * W + x) * 4, id = buf[k] | (buf[k + 1] << 8);
        if (id && parts[id - 1].el === el) hit = true;
      }
    }
    el.occluded = !hit;
  }
}
controls.addEventListener('change', scheduleOcclusion);

// ---------- numery elementów ----------
for (const el of model.elements) {
  const div = document.createElement('div');
  div.className = 'pin';
  div.innerHTML = `<b>${el.no}</b><span>${el.name}</span>`;
  const obj = new CSS2DObject(div);
  obj.position.copy(el.anchor);
  scene.add(obj);
  el.pin = obj;
  el.pinDiv = div;
  div.addEventListener('pointerenter', () => setHover(el, true));
  div.addEventListener('pointerleave', () => setHover(null, true));
  div.addEventListener('click', (e) => { e.stopPropagation(); select(el); });
}

// ---------- panel: lista elementów ----------
const listBox = $('list');
{
  let group = null, ol = null;
  for (const el of model.elements) {
    if (el.group !== group) {
      group = el.group;
      const h = document.createElement('h3');
      h.textContent = group;
      listBox.appendChild(h);
      ol = document.createElement('div');
      ol.className = 'items';
      listBox.appendChild(ol);
    }
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<input type="checkbox" ${el.visible ? 'checked' : ''} aria-label="Pokaż: ${el.name}"><span class="no">${el.no}</span><span class="nm">${el.name}<small>${el.short}</small></span>`;
    const cb = row.querySelector('input');
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (el.variant) {
        const g = el.variant.group;
        setVariant(g, cb.checked ? el.variant.keys[0] : VARIANTS[g].def);
        return;
      }
      el.visible = cb.checked;
      syncVisibility();
    });
    row.addEventListener('click', () => { select(el); focusOn(el.anchor); });
    row.addEventListener('mouseenter', () => setHover(el, true));
    row.addEventListener('mouseleave', () => setHover(null, true));
    ol.appendChild(row);
    el.row = row;
    el.cb = cb;
  }
}

// ---------- opis wybranego elementu ----------
const info = $('info'), tip = $('tip');
const SRC = { p: ['', ''], est: ['≈ szac.', 'est'], calc: ['wyliczone', 'calc'], meas: ['Twój pomiar', 'meas'] };
function renderInfo() {
  for (const el of model.elements) el.row.classList.toggle('sel', el === selected);
  if (!selected) { info.hidden = true; return; }
  const e = selected;
  info.innerHTML = `
    <header><span class="no">${e.no}</span><h3>${e.name}</h3><button class="x" data-act="close" aria-label="Zamknij">×</button></header>
    <p>${e.desc}</p>
    <table>${e.params.map(([k, v, s]) => `<tr><th>${k}</th><td>${v}${SRC[s][0] ? ` <i class="${SRC[s][1]}">${SRC[s][0]}</i>` : ''}</td></tr>`).join('')}</table>
    ${e.leak ? `<p class="leak"><b>Przecieki:</b> ${e.leak}</p>` : ''}
    <div class="actions">
      <button data-act="focus">Przybliż</button>
      <button data-act="solo">${solo ? 'Pokaż wszystkie' : 'Tylko ten element'}</button>
      <button data-act="hide">Ukryj</button>
    </div>`;
  info.hidden = false;
}
info.addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (!act || !selected) return;
  if (act === 'close') select(null);
  if (act === 'focus') focusOn(selected.anchor, 900);
  if (act === 'solo') setSolo(!solo);
  if (act === 'hide') { selected.visible = false; selected.cb.checked = false; select(null); syncVisibility(); }
});

function setHover(el, fromPanel = false) {
  if (hovered !== el) {
    hovered = el;
    refreshPaint();
    for (const x of model.elements) x.row.classList.toggle('hov', x === el);
  }
  if (el && !fromPanel && mouse) {
    tip.innerHTML = `<b>${el.no}. ${el.name}</b><span>${el.short}</span>`;
    tip.hidden = false;
  } else {
    tip.hidden = true;
  }
}
function select(el) {
  selected = el;
  refreshPaint();
  renderInfo();
  if (solo) syncVisibility();
}
function setSolo(v) {
  solo = v;
  $('tSolo').checked = v;
  syncVisibility();
  renderInfo();
}

// ---------- ruch kamery ----------
let flight = null;
function flyTo(target, pos, ms = 650) {
  flight = { t0: performance.now(), ms, t1: controls.target.clone(), t2: target.clone(), p1: camera.position.clone(), p2: pos.clone() };
}
function focusOn(p, dist) {
  const dir = new V().subVectors(camera.position, controls.target).normalize();
  const d = dist ?? Math.min(camera.position.distanceTo(controls.target), 1500);
  flyTo(p, p.clone().addScaledVector(dir, d));
}
function setView(name, instant = false) {
  if (!VIEWS[name]) return;
  const [t, p] = viewPose(name);
  if (instant) {
    controls.target.copy(t);
    camera.position.copy(p);
  } else {
    flyTo(t, p);
  }
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------- panel: przekroje ----------
const keys = ['a', 'b', 'h'];
function syncSectionUI() {
  keys.forEach((k, i) => {
    const q = sec.p[i];
    $(`${k}On`).checked = q.on;
    $(`${k}Pos`).value = q.pos;
    $(`${k}Out`).textContent = `${q.pos} mm`;
    $(`${k}Flip`).classList.toggle('on', q.flip);
    $(`${k}Pos`).closest('.plane').classList.toggle('off', !q.on);
  });
  $('rot').value = sec.rot;
  $('rotOut').textContent = `${sec.rot}°`;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === sec.mode));
  document.querySelectorAll('#hChips button').forEach((b) => b.classList.toggle('on', sec.p[2].on && +b.dataset.y === sec.p[2].pos));
}
function updateAll() {
  updatePlanes();
  syncSectionUI();
}
keys.forEach((k, i) => {
  $(`${k}On`).addEventListener('change', (e) => { sec.p[i].on = e.target.checked; updateAll(); });
  $(`${k}Pos`).addEventListener('input', (e) => { sec.p[i].pos = +e.target.value; sec.p[i].on = true; updateAll(); });
  $(`${k}Flip`).addEventListener('click', () => { sec.p[i].flip = !sec.p[i].flip; sec.p[i].on = true; updateAll(); });
});
$('rot').addEventListener('input', (e) => { sec.rot = +e.target.value; updateAll(); });
document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { sec.mode = b.dataset.mode; updateAll(); }));
{
  const box = $('hChips');
  for (const [name, y] of heightChips()) {
    const b = document.createElement('button');
    b.dataset.y = y;
    b.innerHTML = `${name} <small>${y}</small>`;
    b.addEventListener('click', () => { sec.p[2].on = true; sec.p[2].pos = y; updateAll(); });
    box.appendChild(b);
  }
}
const PRESETS = {
  krocce: { mode: 'union', rot: 0, p: [[true, 0, true], [false, 0, false], [false, 800, false]], view: 'iso' },
  pc: { mode: 'union', rot: 135, p: [[true, 0, false], [false, 0, false], [false, 800, false]], view: 'isoBackLeft' },
  przod: { mode: 'union', rot: 0, p: [[false, 0, false], [true, 0, false], [false, 800, false]], view: 'isoFront' },
  cwiartka: { mode: 'corner', rot: 0, p: [[true, 0, true], [true, 0, false], [false, 800, false]], view: 'iso' },
  poziomy: { mode: 'union', rot: 0, p: [[false, 0, false], [false, 0, false], [true, 600, false]], view: 'isoTop' },
  calosc: { mode: 'union', rot: 0, p: [[false, 0, false], [false, 0, false], [false, 800, false]], view: 'iso' },
};
function applyPreset(name, instant = false) {
  const pr = PRESETS[name];
  if (!pr) return;
  sec.mode = pr.mode;
  sec.rot = pr.rot;
  pr.p.forEach(([on, pos, flip], i) => Object.assign(sec.p[i], { on, pos, flip }));
  updateAll();
  setView(pr.view, instant);
}
document.querySelectorAll('#presets button').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

// ---------- panel: widok ----------
const leakCard = $('leakCard');
leakCard.innerHTML = `
  <header><h3>Typowe miejsca przecieków</h3><button class="x" data-close aria-label="Zamknij">×</button></header>
  <p>Woda z nieszczelności powyżej dna spływa po stali pod pianką na dno i wychodzi otworem przy spuście albo przy dolnej krawędzi płaszcza (niebieska ścieżka to przykład). Miejsce kapania nie wskazuje miejsca dziury.</p>
  <ol>${model.leaks.map((L, i) => `<li data-i="${i}">${L.name}</li>`).join('')}</ol>
  <p class="note">Najpierw sprawdź uszczelkę rewizji, korki i mufy – te miejsca da się naprawić. Przeciek ze spawu albo z dna zwykle kończy się wymianą zasobnika.</p>`;
leakCard.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-close]')) { ui.leaks = false; $('tLeaks').checked = false; leakCard.hidden = true; return; }
  const li = ev.target.closest('li[data-i]');
  if (!li) return;
  const L = model.leaks[+li.dataset.i];
  const el = model.elements.find((e) => e.id === L.el);
  if (el) select(el);
  focusOn(L.rings[0].pos, 1000);
});
const toggles = { tPins: 'pins', tNames: 'names', tDims: 'dims', tLeaks: 'leaks', tAccess: 'access', tFrames: 'frames' };
function applyToggles() {
  document.body.classList.toggle('names', ui.names);
  leakCard.hidden = !ui.leaks;
  updatePlanes();
}
for (const [id, key] of Object.entries(toggles)) {
  $(id).checked = ui[key];
  $(id).addEventListener('change', (e) => {
    ui[key] = e.target.checked;
    applyToggles();
    if (key === 'access' && ui.access) focusOn(new V(0, 190, 140), 1400);
  });
}
$('tSolo').addEventListener('change', (e) => setSolo(e.target.checked));

// ---------- warianty: co siedzi w górnej mufie i w pokrywie rewizji ----------
const VARIANTS = {
  top: {
    def: 'anoda', seg: 'topSeg', note: 'topNote',
    opts: {
      anoda: { top: 1515, sel: 'anodaG', note: 'Fabrycznie: anoda magnezowa G 1½" – jedyna ochrona zbiornika (wymiana co 12 miesięcy).' },
      naczynie: { top: 2025, sel: 'naczynie', warn: true, note: '<b>Tak było u Ciebie: brak anody.</b> W S15 to jedyna mufa na anodę, więc zbiornik nie miał żadnej ochrony. Naczynie przeponowe podłącza się na rurze zimnej wody.' },
      zawor: { top: 1625, sel: 'zawor', warn: true, note: '<b>Brak anody.</b> Zawór bezpieczeństwa montuje się na rurze zimnej wody, tuż przed zasobnikiem.' },
    },
  },
  flange: {
    def: 'grzalka', seg: 'flangeSeg', note: 'flangeNote',
    opts: {
      grzalka: { sel: 'grzalka', note: 'Tak było u Ciebie: grzałka w mufie 6/4" pokrywy, bez anody – zgodnie z kartą S15.' },
      grzalkaAnoda: { sel: 'anodaR', note: 'Do rozważenia: pokrywa z mufą grzałki i anodą M8, jak w FISH S16. Dopasowanie do S15 potwierdź w Sunex.' },
      zaslepka: { sel: 'korekG', note: 'Mufa grzałki zamknięta korkiem 6/4".' },
    },
  },
};
const vstate = { top: 'anoda', flange: 'grzalka' };
const hasAnode = () => vstate.top === 'anoda' || vstate.flange === 'grzalkaAnoda';
const noAnode = (() => {
  const d = document.createElement('div');
  d.className = 'dim alert';
  d.textContent = 'brak anody – zbiornik bez ochrony';
  const o = new CSS2DObject(d);
  o.position.set(0, 820, 0);
  scene.add(o);
  return o;
})();
function setVariant(group, key, focus = true) {
  const g = VARIANTS[group], opt = g?.opts[key];
  if (!opt) return;
  vstate[group] = key;
  for (const el of model.elements) {
    if (el.variant?.group !== group) continue;
    el.visible = el.variant.keys.includes(key);
    el.cb.checked = el.visible;
  }
  if (group === 'top') {
    sceneTop = opt.top;
    TARGET.y = (DIM.floor + sceneTop) / 2;
  }
  $(g.note).innerHTML = opt.note;
  $(g.note).classList.toggle('warn', !!opt.warn);
  document.querySelectorAll(`#${g.seg} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === key));
  syncVisibility();
  if (focus) {
    select(model.elements.find((e) => e.id === opt.sel));
    if (group === 'top') focusOn(new V(0, (1100 + sceneTop) / 2, 0), key === 'naczynie' ? 2300 : 1900);
    else focusOn(new V(0, H.h12, 200), 1300);
  }
}
for (const [group, g] of Object.entries(VARIANTS)) {
  document.querySelectorAll(`#${g.seg} button`).forEach((b) => b.addEventListener('click', () => setVariant(group, b.dataset.v)));
}

// ---------- panel: własne pomiary wysokości ----------
{
  const box = $('meas');
  for (const [k, label] of Object.entries(H_LABELS)) {
    const row = document.createElement('label');
    row.className = `mrow${MEASURED.has(k) ? ' own' : ''}`;
    row.innerHTML = `<span>${label}</span><input type="number" min="150" max="1420" step="1" data-k="${k}" value="${H[k]}"><small>karta ${H_DEFAULT[k]}</small>`;
    box.appendChild(row);
  }
  const save = (s) => {
    try {
      if (s) localStorage.setItem(MEAS_KEY, s);
      else localStorage.removeItem(MEAS_KEY);
    } catch { /* przeglądarka bez dostępu do pamięci – zostaje sam adres */ }
  };
  const reloadWith = (s) => {
    const q2 = new URLSearchParams(location.search);
    q2.set('m', s);
    location.search = q2.toString();
  };
  $('measApply').addEventListener('click', () => {
    const pairs = [];
    for (const inp of box.querySelectorAll('input')) {
      const v = Math.round(Number(inp.value));
      if (Number.isFinite(v) && v !== H_DEFAULT[inp.dataset.k]) pairs.push(`${inp.dataset.k}:${v}`);
    }
    save(pairs.join(','));
    reloadWith(pairs.join(','));
  });
  $('measReset').addEventListener('click', () => { save(''); reloadWith(''); });
}

// ---------- mysz ----------
let mouse = null, pickPending = false, downAt = null;
const cvs = renderer.domElement;
cvs.addEventListener('pointermove', (e) => {
  const r = viewport.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top, buttons: e.buttons };
  pickPending = !e.buttons;
  if (e.buttons) tip.hidden = true;
});
cvs.addEventListener('pointerleave', () => { mouse = null; setHover(null); });
cvs.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
cvs.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 4 || e.button !== 0) return;
  const r = viewport.getBoundingClientRect();
  const p = pickAt(e.clientX - r.left, e.clientY - r.top);
  select(p ? p.el : null);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { select(null); if (solo) setSolo(false); } });

// ---------- pętla ----------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  scheduleOcclusion();
}
new ResizeObserver(resize).observe(viewport);
resize();

const clock = new THREE.Clock();
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.ms), e = ease(k);
    controls.target.lerpVectors(flight.t1, flight.t2, e);
    camera.position.lerpVectors(flight.p1, flight.p2, e);
    if (k >= 1) flight = null;
  }
  controls.update();
  if (ui.leaks) {
    const s = 1 + 0.14 * Math.sin(t * 4);
    for (const m of leakRings) m.scale.setScalar(s);
    drops.forEach((m, i) => m.position.copy(dripCurve.getPointAt((t * 0.07 + i / drops.length) % 1)));
  }
  if (pickPending && mouse) {
    pickPending = false;
    const p = pickAt(mouse.x, mouse.y);
    setHover(p ? p.el : null);
  }
  if (!tip.hidden && mouse) tip.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 18}px)`;
  updatePins();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// Stan startowy także z adresu, np. ?preset=cwiartka&view=isoFront&leaks=1&dims=1&show=woda&sel=uszczelka&focus=1
const q = new URLSearchParams(location.search);
updateAll();
setView('iso', true);
if (q.has('preset')) applyPreset(q.get('preset'), true);
if (q.has('view')) setView(q.get('view'), true);
if (q.has('h')) { sec.p[2].on = true; sec.p[2].pos = +q.get('h'); updateAll(); }
if (q.has('rot')) { sec.rot = +q.get('rot'); updateAll(); }
for (const [id, key] of Object.entries(toggles)) {
  if (q.has(key)) { ui[key] = q.get(key) === '1'; $(id).checked = ui[key]; }
}
for (const [param, vis] of [['show', true], ['hide', false]]) {
  for (const id of (q.get(param) ?? '').split(',')) {
    const el = model.elements.find((e) => e.id === id);
    if (el) { el.visible = vis; el.cb.checked = vis; }
  }
}
applyToggles();
setVariant('top', q.get('top') ?? 'anoda', q.has('top'));
setVariant('flange', q.get('flange') ?? 'grzalka', q.has('flange'));
const pre = model.elements.find((e) => e.id === q.get('sel'));
if (pre) {
  select(pre);
  if (q.get('focus') === '1') {
    const dir = new V().subVectors(camera.position, controls.target).normalize();
    controls.target.copy(pre.anchor);
    camera.position.copy(pre.anchor).addScaledVector(dir, 950);
  }
}
$('loading').remove();
window.__zasobnik = { model, parts, sec, updateAll, applyPreset, setView, select };
