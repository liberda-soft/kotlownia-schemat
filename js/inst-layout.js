import * as THREE from 'three';
import { hollowTube, cylinderBetween, merge, latheSolid } from './geom.js';
import * as K from './inst-parts.js';
import { tankExterior, dialTexture } from './inst-tank.js';
import { heatPump } from './inst-hp.js';
import { schematicSVG } from './inst-schema.js';

// Ściana kotłowni 2000 × 2500 mm: X od lewej krawędzi ściany, Y od posadzki, Z od ściany w stronę pomieszczenia.
// Rury główne biegną 90 mm od ściany (ZB), sprzęgło z zaworem trójdrogowym i podejściami do domu – 220 mm (ZF),
// dzięki czemu przewody, które muszą się minąć, przechodzą jeden za drugim zamiast krzyżować się w jednej płaszczyźnie.

const { MAT } = K;
const V = THREE.Vector3;
const v = (x, y, z) => new V(x, y, z);
export const WALL = { W: 2000, H: 2500 };

const ZB = 90, ZF = 220;
const TX = 345, TZ = 505;          // oś zasobnika
const HPX = 1330, HPZ = 270;       // lewa krawędź i tylna ściana pompy ciepła

const CU = { color: 0xb87333, metal: 0.85, rough: 0.33 };
const ARMA = { color: 0x26282c, rough: 0.92 };
const PEI = { color: 0xc5c9ce, rough: 0.9 };
const PP = { color: 0x8f969c, rough: 0.6 };
const WHITE_V = { color: 0xf3f4f5, metal: 0.05, rough: 0.4 };

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const LN = {
  bIn: { color: 0x2f9e44, od: 42, ins: 19, im: ARMA },
  bOut: { color: 0x82c91e, od: 42, ins: 19, im: ARMA },
  hF: { color: 0xe03131, od: 35, ins: 25, im: PEI },
  hR: { color: 0x1c7ed6, od: 35, ins: 25, im: PEI },
  cS: { color: 0xf08c00, od: 35, ins: 25, im: PEI },
  cR: { color: 0x7048e8, od: 35, ins: 25, im: PEI },
  zw: { color: 0x15aabf, od: 28, ins: 13, im: ARMA },
  cwu: { color: 0xd6336c, od: 28, ins: 20, im: PEI },
  odp: { color: 0x868e96, od: 32, ins: 0, mat: PP },
  hose: { color: 0x868e96, od: 20, ins: 0, mat: { color: 0x4a4f55, rough: 0.7 } },
};

// ---------- rejestr ----------
const EL = [], STATIC = [], DECALS = [], FLOWS = [], LABELS = [];
export const ALL_RUNS = [];   // wszystkie przewody (oś + promień z izolacją) – do sprawdzania odstępów
const el = (o) => { o.parts = o.parts ?? []; EL.push(o); return o; };

// ---------- rury z izolacją, opaskami i obejmami ----------
function arcLen(path) {
  const s = [0];
  for (let i = 1; i < path.length; i++) s.push(s[i - 1] + path[i].distanceTo(path[i - 1]));
  return s;
}
function pointAt(path, sAt, s) {
  let i = 1;
  while (i < path.length - 1 && sAt[i] < s) i++;
  const t = THREE.MathUtils.clamp((s - sAt[i - 1]) / Math.max(1e-6, sAt[i] - sAt[i - 1]), 0, 1);
  return path[i - 1].clone().lerp(path[i], t);
}
function subPath(path, sAt, s0, s1) {
  const out = [pointAt(path, sAt, s0)];
  for (let i = 0; i < path.length; i++) if (sAt[i] > s0 + 0.5 && sAt[i] < s1 - 0.5) out.push(path[i].clone());
  out.push(pointAt(path, sAt, s1));
  return out;
}
function nearestS(path, sAt, p) {
  let best = Infinity, bs = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], ab = path[i].clone().sub(a), L = ab.length();
    if (L < 1e-6) continue;
    const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / (L * L), 0, 1);
    const d = a.clone().addScaledVector(ab, t).distanceTo(p);
    if (d < best) { best = d; bs = sAt[i - 1] + t * L; }
  }
  return bs;
}
function ringGeo(p, dir, r, w = 16, t = 2.5) {
  const g = latheSolid([[[r, -w / 2], [r + t, -w / 2]], [[r + t, -w / 2], [r + t, w / 2]], [[r + t, w / 2], [r, w / 2]], [[r, w / 2], [r, -w / 2]]], 32);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir.clone().normalize()));
  g.translate(p.x, p.y, p.z);
  return g;
}

// cuts: [[punkt na osi, połowa długości przerwy w izolacji], …] – w miejscach armatury.
function run(key, pts, { cuts = [], od, ins, flow = true, clamps = true, start = 0, end = 0 } = {}) {
  const c = LN[key];
  od = od ?? c.od;
  ins = ins ?? c.ins;
  const path = K.bendPath(pts, Math.max(1.5 * od, 40));
  const sAt = arcLen(path), L = sAt[sAt.length - 1];
  const parts = [{ geo: hollowTube(path, od / 2, 0, 18), mat: c.mat ?? CU }];
  const gaps = cuts.map(([p, h]) => { const s = nearestS(path, sAt, p); return [s - h, s + h]; });
  if (start) gaps.push([-1, start]);
  if (end) gaps.push([L - end, L + 1]);
  gaps.sort((a, b) => a[0] - b[0]);
  const keep = [];
  let s0 = 0;
  for (const [a, b] of gaps) { if (a > s0) keep.push([s0, a]); s0 = Math.max(s0, b); }
  if (s0 < L) keep.push([s0, L]);
  if (ins > 0) {
    const tubes = [], bands = [];
    const rIns = od / 2 + ins;
    for (const [a, b] of keep) {
      if (b - a < 6) continue;
      tubes.push(hollowTube(subPath(path, sAt, a, b), rIns, 0, 22));
      if (b - a > 160) {
        const marks = [a + 45, b - 45];
        for (let s = a + 600; s < b - 300; s += 600) marks.push(s);
        for (const s of marks) {
          const p = pointAt(path, sAt, s), q = pointAt(path, sAt, s + 2);
          bands.push(ringGeo(p, q.sub(p), rIns + 0.3, 22, 2));
        }
      }
    }
    if (tubes.length) parts.push({ geo: merge(tubes), mat: c.im, layer: 'insul' });
    if (bands.length) parts.push({ geo: merge(bands), mat: { color: c.color, rough: 0.5 }, layer: 'insul' });
  }
  if (clamps) {
    const rr = od / 2 + ins, list = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = b.clone().sub(a), len = d.length();
      if (len < 280 || Math.abs(d.z) > 1 || a.z > 260) continue;
      d.normalize();
      const n = Math.max(1, Math.round(len / 650));
      for (let k = 0; k < n; k++) {
        const p = a.clone().addScaledVector(d, (len * (k + 0.5)) / n);
        if (cuts.some(([q, h]) => q.distanceTo(p) < h + 70)) continue;
        list.push(ringGeo(p, d, rr + 0.5, 18, 3.5), cylinderBetween(v(p.x, p.y, 0), v(p.x, p.y, p.z - rr - 2), 5, 10), cylinderBetween(v(p.x, p.y, 0), v(p.x, p.y, 4), 16, 16));
      }
    }
    if (list.length) parts.push({ geo: merge(list), mat: MAT.steel });
  }
  if (flow) FLOWS.push({ path, color: c.color, r: od / 2 + ins });
  ALL_RUNS.push({ key, path, r: od / 2 + ins });
  return parts;
}

// ---------- drobna armatura ----------
const cyl = (a, b, r, s = 24) => cylinderBetween(a, b, r, s);
const P = (geo, mat) => ({ geo, mat });
function teeBody(p, r = 24) {
  const g = new THREE.SphereGeometry(r, 18, 12);
  g.deleteAttribute('uv');
  g.translate(p.x, p.y, p.z);
  return P(g, MAT.brass);
}
function kfe(p, dir, rPipe = 18) {
  const d = dir.clone().normalize(), a = p.clone().addScaledVector(d, rPipe - 4);
  return [
    P(merge([cyl(a, a.clone().addScaledVector(d, 42), 10, 16), cyl(a.clone().addScaledVector(d, 18), a.clone().addScaledVector(d, 34), 14, 16), cyl(a.clone().addScaledVector(d, 42), a.clone().addScaledVector(d, 66), 7, 12)]), MAT.brass),
    P(cyl(a.clone().addScaledVector(d, 62), a.clone().addScaledVector(d, 74), 9, 12), MAT.levBlue),
    P(K.roundedBox(10, 10, 40, a.clone().addScaledVector(d, 26).add(v(0, 0, 18)), 2), MAT.levRed),
  ];
}
function airVent(base, rPipe = 18) {
  const a = base.clone().add(v(0, rPipe - 4, 0));
  return [
    P(merge([cyl(a, a.clone().add(v(0, 24, 0)), 10, 16), cyl(a.clone().add(v(0, 20, 0)), a.clone().add(v(0, 62, 0)), 16, 24)]), MAT.brass),
    P(cyl(a.clone().add(v(0, 62, 0)), a.clone().add(v(0, 74, 0)), 11, 16), MAT.black),
  ];
}
// Termometr / termomanometr na tulei, tarcza do przodu.
function dial(p, rPipe, kind = 't') {
  const t = K.thermometer({ o: p, pipeR: rPipe });
  DECALS.push({ geo: K.dialDisc(t.dial.p, t.dial.d, 30), map: kind === 'p' ? dialTexture('bar', 4, 1.5, 'bar · °C') : kind === 'b' ? dialTexture('t', 60, 8, '°C') : dialTexture('t', 120, 45, '°C'), el: null });
  return t.parts;
}
function balancingValve(o, axis) {
  const m = K.frame(o, axis);
  const parts = [
    P(merge([cyl(v(0, -48, 0), v(0, 48, 0), 23, 24), cyl(v(0, -48, 0), v(0, -34, 0), 28, 6), cyl(v(0, 34, 0), v(0, 48, 0), 28, 6), cyl(v(0, 0, 0), v(0, 0, 40), 16, 20), cyl(v(-18, -20, 0), v(-18, -20, 30), 6, 10), cyl(v(-18, 20, 0), v(-18, 20, 30), 6, 10)]), MAT.brass),
    P(cyl(v(0, 0, 40), v(0, 0, 70), 26, 28), MAT.pumpHead),
    P(merge([cyl(v(-18, -20, 30), v(-18, -20, 40), 7, 10), cyl(v(-18, 20, 30), v(-18, 20, 40), 7, 10)]), MAT.levRed),
  ];
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
}
// Filtr magnetyczny na poziomej rurze (DIRTMAG 1¼": 124 mm między przyłączami, 219 mm pod osią).
function magFilter(o) {
  return [
    P(merge([cyl(v(o.x - 62, o.y, o.z), v(o.x + 62, o.y, o.z), 23, 24), cyl(v(o.x - 62, o.y, o.z), v(o.x - 48, o.y, o.z), 28, 6), cyl(v(o.x + 48, o.y, o.z), v(o.x + 62, o.y, o.z), 28, 6), cyl(v(o.x, o.y + 49, o.z), v(o.x, o.y, o.z), 18, 20)]), MAT.brass),
    P(cyl(v(o.x, o.y - 18, o.z), v(o.x, o.y - 196, o.z), 41, 36), MAT.brass),
    P(merge([cyl(v(o.x, o.y - 80, o.z), v(o.x, o.y - 120, o.z), 44, 36), cyl(v(o.x, o.y + 49, o.z), v(o.x, o.y + 60, o.z), 10, 12)]), MAT.black),
    P(merge([cyl(v(o.x, o.y - 196, o.z), v(o.x, o.y - 219, o.z), 10, 12)]), MAT.brass),
    P(K.roundedBox(36, 8, 10, v(o.x + 14, o.y - 210, o.z + 12), 2), MAT.levRed),
  ];
}
// Filtr z reduktorem na poziomej rurze (FK06: 180 mm z holendrami, 111 nad osią, 180 pod osią, kubek Ø61).
function filterReducer(o) {
  const parts = [
    P(merge([cyl(v(o.x - 90, o.y, o.z), v(o.x + 90, o.y, o.z), 17, 24), cyl(v(o.x - 90, o.y, o.z), v(o.x - 72, o.y, o.z), 22, 6), cyl(v(o.x + 72, o.y, o.z), v(o.x + 90, o.y, o.z), 22, 6), cyl(v(o.x - 50, o.y, o.z), v(o.x + 50, o.y, o.z), 25, 24), cyl(v(o.x, o.y, o.z), v(o.x, o.y + 60, o.z), 30, 28), cyl(v(o.x, o.y - 30, o.z), v(o.x, o.y, o.z), 30, 28)]), MAT.brass),
    P(cyl(v(o.x, o.y + 60, o.z), v(o.x, o.y + 111, o.z), 26, 28), MAT.levBlue),
    P(cyl(v(o.x, o.y - 30, o.z), v(o.x, o.y - 160, o.z), 30.5, 28), { color: 0xdbe9f2, rough: 0.15, metal: 0.05, opacity: 0.55 }),
    P(cyl(v(o.x, o.y - 160, o.z), v(o.x, o.y - 180, o.z), 12, 16), MAT.brass),
    P(cyl(v(o.x + 30, o.y + 10, o.z), v(o.x + 30, o.y + 10, o.z + 38), 6, 10), MAT.brass),
    P(cyl(v(o.x + 30, o.y + 10, o.z + 38), v(o.x + 30, o.y + 10, o.z + 52), 25, 32), MAT.chrome),
  ];
  DECALS.push({ geo: K.dialDisc(v(o.x + 30, o.y + 10, o.z + 52.6), v(0, 0, 1), 22), map: dialTexture('bar', 10, 3.5, 'bar'), el: null });
  return parts;
}
// Grupa bezpieczeństwa c.w.u. w pionie (przepływ w dół): odcięcie, zwrotny, zawór 6 bar z boku, wylot w dół do lejka.
function dhwGroup(o, side = -1) {
  const s = side;
  const parts = [
    P(merge([cyl(v(o.x, o.y - 70, o.z), v(o.x, o.y + 70, o.z), 21, 24), cyl(v(o.x, o.y - 70, o.z), v(o.x, o.y - 54, o.z), 27, 6), cyl(v(o.x, o.y + 54, o.z), v(o.x, o.y + 70, o.z), 27, 6),
      cyl(v(o.x, o.y - 10, o.z), v(o.x + s * 44, o.y - 10, o.z), 16, 20), cyl(v(o.x + s * 60, o.y - 30, o.z), v(o.x + s * 60, o.y + 34, o.z), 19, 24), cyl(v(o.x + s * 60, o.y - 30, o.z), v(o.x + s * 60, o.y - 52, o.z), 12, 16),
      cyl(v(o.x, o.y + 35, o.z), v(o.x, o.y + 35, o.z + 30), 9, 12)]), MAT.brass),
    P(cyl(v(o.x + s * 60, o.y + 34, o.z), v(o.x + s * 60, o.y + 58, o.z), 21, 24), MAT.levBlue),
    P(K.roundedBox(16, 76, 8, v(o.x, o.y + 54, o.z + 34), 3), MAT.levBlue),
    P(cyl(v(o.x, o.y - 30, o.z + 18), v(o.x, o.y - 30, o.z + 26), 13, 16), MAT.black),
  ];
  return { parts, a: v(o.x, o.y + 70, o.z), b: v(o.x, o.y - 70, o.z), discharge: v(o.x + s * 60, o.y - 52, o.z) };
}
// Lejek z przerwą powietrzną (wyrzut zaworu bezpieczeństwa) – górna krawędź w punkcie p.
function tundish(p) {
  const cone = new THREE.CylinderGeometry(30, 13, 50, 24, 1, false);
  cone.deleteAttribute('uv');
  cone.translate(p.x, p.y - 25, p.z);
  return [P(cone, MAT.white)];
}
// Grupa bezpieczeństwa na czerwonej konsoli: rozdzielacz poziomy, manometr, zawór 3 bar, odpowietrznik;
// wejście z boku (side = −1 z lewej, +1 z prawej), naczynie pod środkiem.
function redGroup(o, side = -1, wallZ = 0, dz = 1) {
  const s = side, back = o.z - wallZ;
  const parts = [
    P(merge([cyl(v(o.x - 80, o.y, o.z), v(o.x + 80, o.y, o.z), 15, 6), cyl(v(o.x, o.y - 30, o.z), v(o.x, o.y, o.z), 14, 6),
      cyl(v(o.x - s * 50, o.y, o.z), v(o.x - s * 50, o.y + 50, o.z), 8, 12), cyl(v(o.x + 5, o.y, o.z), v(o.x + 5, o.y + 58, o.z), 17, 24), cyl(v(o.x + 5, o.y + 30, o.z), v(o.x + 5, o.y + 30, o.z + 42 * dz), 11, 18),
      cyl(v(o.x + s * 55, o.y, o.z), v(o.x + s * 55, o.y + 52, o.z), 16, 24)]), MAT.brass),
    P(merge([K.roundedBox(190, 10, back + 40, v(o.x, o.y - 22, o.z - back / 2 + 20), 2), K.roundedBox(190, 120, 8, v(o.x, o.y - 70, wallZ + 4), 2)]), MAT.red),
    P(cyl(v(o.x - s * 50, o.y + 86, o.z - 10), v(o.x - s * 50, o.y + 86, o.z + 14), 33, 36), MAT.chrome),
    P(cyl(v(o.x + 5, o.y + 58, o.z), v(o.x + 5, o.y + 82, o.z), 19, 24), MAT.red),
    P(cyl(v(o.x + s * 55, o.y + 52, o.z), v(o.x + s * 55, o.y + 70, o.z), 12, 18), MAT.black),
  ];
  DECALS.push({ geo: K.dialDisc(v(o.x - s * 50, o.y + 86, o.z + 14.6), v(0, 0, 1), 29), map: dialTexture('bar', 4, 1.5, 'bar'), el: null });
  return { parts, in: v(o.x + s * 80, o.y, o.z), vessel: v(o.x, o.y - 30, o.z), discharge: v(o.x + 5, o.y + 30, o.z + 42 * dz) };
}
function sleeve(p, dir, r) {
  const d = dir.clone().normalize();
  return P(merge([cyl(p.clone().addScaledVector(d, -12), p.clone().addScaledVector(d, 14), r + 7, 28), cyl(p.clone().addScaledVector(d, -2), p.clone().addScaledVector(d, 2), r + 18, 28)]), { color: 0x9aa0a6, rough: 0.8 });
}

// ---------- budowa ----------
export function buildInstallation() {
  EL.length = STATIC.length = DECALS.length = FLOWS.length = LABELS.length = ALL_RUNS.length = 0;

  // ===== ściana, posadzka, strop =====
  const wallTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e5de'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 5); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const floorTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#cfcbc3'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#b5b0a6'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2.4); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const wall = new THREE.BoxGeometry(WALL.W, WALL.H, 30);
  wall.translate(WALL.W / 2, WALL.H / 2, -15);
  STATIC.push({ geo: wall, mat: { color: 0xffffff, map: wallTex, rough: 0.95 } });
  const floor = new THREE.BoxGeometry(WALL.W + 200, 30, 1200);
  floor.translate(WALL.W / 2, -15, 600 - 30);
  STATIC.push({ geo: floor, mat: { color: 0xffffff, map: floorTex, rough: 0.9 } });
  const ceil = new THREE.BoxGeometry(WALL.W, 40, 340);
  ceil.translate(WALL.W / 2, WALL.H + 20, 170 - 30);
  STATIC.push({ geo: ceil, mat: { color: 0xd9d6cf, rough: 0.95, opacity: 0.55 } });
  // linie wymiarowe
  const dimMat = { color: 0x495057, rough: 0.6 };
  STATIC.push({ geo: merge([cyl(v(0, 4, 1150), v(WALL.W, 4, 1150), 2.2, 8), cyl(v(0, 4, 1120), v(0, 4, 1180), 2.2, 8), cyl(v(WALL.W, 4, 1120), v(WALL.W, 4, 1180), 2.2, 8)]), mat: dimMat, dim: true });
  STATIC.push({ geo: merge([cyl(v(-60, 0, 20), v(-60, WALL.H, 20), 2.2, 8), cyl(v(-90, 0, 20), v(-30, 0, 20), 2.2, 8), cyl(v(-90, WALL.H, 20), v(-30, WALL.H, 20), 2.2, 8)]), mat: dimMat, dim: true });
  LABELS.push({ text: '2000 mm – szerokość ściany', pos: v(WALL.W / 2, 30, 1150), cls: 'dimz' });
  LABELS.push({ text: '2500 mm', pos: v(-60, WALL.H / 2, 20), cls: 'dimz' });

  // ===== zasobnik =====
  const T = tankExterior(TX, TZ);
  const TP = T.ports;
  const tankParts = [...T.parts];
  // zaślepka cyrkulacji h6 i czujnik PC w tulei h7
  const cy = TP.cyrk;
  tankParts.push(P(cyl(cy.p, cy.p.clone().addScaledVector(cy.d, 14), 19, 6), MAT.brass));
  DECALS.push({ geo: K.dialDisc(T.dial.p, T.dial.d, 31), map: dialTexture('t', 120, 48, '°C') });
  // taca ociekowa z czujnikiem zalania pod zasobnikiem
  const tray = latheSolid([[[0, 1], [380, 1]], [[380, 1], [380, 32]], [[380, 32], [372, 32]], [[372, 32], [372, 6]], [[372, 6], [0, 6]]], 64);
  tray.translate(TX, 0, TZ);
  tankParts.push(P(tray, { color: 0x9aa0a6, metal: 0.3, rough: 0.5 }), P(cyl(v(TX + 300, 6, TZ + 160), v(TX + 300, 22, TZ + 160), 22, 20), MAT.white));
  el({
    id: 'tank', group: 'dev', name: 'Zasobnik c.w.u. Sunex FISH S15 300', short: '300 l · wężownica 3,2–3,6 m²', anchor: v(TX - 120, 1080, TZ + 330), parts: tankParts,
    desc: 'Stoi w lewym rogu, 180 mm od ściany, w tacy ociekowej z czujnikiem zalania. Kolumna przyłączy wody patrzy prosto na ścianę, a kolumna wężownicy (pod kątem 45° w prawo) – w stronę sprzęgła, więc rury wężownicy idą prosto do obiegu pompy ciepła. Front z termometrem i pokrywą rewizji jest od strony pomieszczenia – anodę wymienisz bez odsuwania zasobnika. Pamiętaj: ten zasobnik już przeciekał przy spawie dna i latami pracował bez anody. Po naprawie zrób próbę szczelności, a na dłuższą metę rozważ wymianę na zasobnik do PC z większą wężownicą.',
    params: [['Przyłącza (Rp 1")', 'zimna h2 272 · c.w.u. h9 1229 · wężownica: zasilanie h8 1246, powrót h3 263'], ['Czujnik c.w.u. PC', 'tuleja h5 ≈ 795 mm (połowa wysokości); jeśli Twój egzemplarz jej nie ma – h7 1032'], ['Cyrkulacja h6 884', 'zaślepiona korkiem ¾" (można później dołożyć pompę ZIP)'], ['Spust h1 74', 'zawór spustowy wyprowadzony w prawo'], ['Anody', 'magnezowe w obu mufach: górnej Rp 1½" i w pokrywie rewizji 6/4" (zamiast grzałki); sprawdzaj co rok'], ['Po naprawie spawu', 'próba szczelności (np. 1,5 × ciśnienie robocze), potem taca ociekowa z czujnikiem zalania'], ['Wężownica a moc PC', '3,2–3,6 m² to mniej niż zalecane dla 16,7 kW (ok. 4–7 m²). PC dogrzeje wodę do ok. 50–55 °C, wyżej dogrzewa grzałka w PC.'], ['Zasobnik / wężownica', '10 bar 95 °C / 16 bar 110 °C']],
    models: [{ name: 'Karta Sunex FISH S15 X', url: 'https://cdn.shopify.com/s/files/1/0405/5370/9736/files/Waermepumpenspeicher_X.pdf' }, { name: 'Model zasobnika z przekrojami', url: 'zasobnik.html' }],
    note: 'Pod zasobnikiem posadzka musi wytrzymać ok. 450 kg (300 l wody + zasobnik). Tył 180 mm od ściany – rury z tyłu mieszczą się bez krzyżowania.',
  });

  // ===== pompa ciepła =====
  const H = heatPump(HPX, HPZ);
  const HPp = H.ports;
  DECALS.push(...H.decals.map((d) => ({ ...d, el: null })));
  el({
    id: 'hp', group: 'dev', name: 'Pompa ciepła alpha innotec SWC 170H', short: '16,7 kW solanka/woda · pompy w środku', anchor: H.front.clone().add(v(0, 180, 0)), parts: H.casing,
    desc: 'Kompaktowa gruntowa pompa ciepła (tabliczka: art. 100386-0002, nr 181027-093, 16,7 kW i COP 4,6 przy B0/W35, R407C 3,8 kg). W obudowie ma już pompę solanki, pompę obiegu grzewczego, naczynie solanki 18 l, zawór przelewowy i grzałkę przepływową 9 kW. Wszystkie cztery przyłącza (G 1¼" AG) wychodzą poziomo z tyłu na wysokości 1263–1427 mm – dlatego pompa stoi 270 mm od ściany (ait wymaga co najmniej 250 mm), a rury idą za nią.',
    params: [['Wymiary', '650 × 500 × 1550 mm; front 565; z grupami na pokrywie 1690'], ['Masa', '220 kg'], ['Przepływ c.o.', 'min 1,4 · nom. 2,9 · max 3,5 m³/h'], ['Przepływ solanki', 'min 2,7 · nom. 3,6 · max 5,0 m³/h'], ['Zapas ciśnienia pomp', 'c.o. ≈ 0,40 bar przy 2,9 m³/h · solanka ≈ 0,19 bar przy 3,6 m³/h'], ['Zasilanie', 'sterowanie 1~ 230 V B10 · sprężarka 3~ 400 V C13 · grzałka 3~ 400 V C16 (prawoskrętne pole wirujące)'], ['Odstępy', 'tył ≥ 250 · boki ≥ 20 · z przodu 800 mm na serwis'], ['Sterownik', 'Luxtronik 2.0']],
    models: [{ name: 'ait – dokumenty dla art. 10038602', url: 'https://kundendienst.ait-group.net/alpha-innotec/Products/10038602/index.html' }, { name: 'Instrukcja SWC (wymiary, odstępy, montaż)', url: 'https://kundendienst.ait-group.net/alpha-innotec/ef8abc0a-c03f-eb11-bf68-000d3a2c5ed7/83050000bDE_SWC.pdf' }, { name: 'Dane techniczne 813174-d', url: 'https://kundendienst.ait-group.net/alpha-innotec/f5c49040-c03f-eb11-bf68-000d3a2c5ed7/813174-d%20TechDat%20SWC%20170H(K).pdf' }],
    note: 'Postaw na dostarczonych listwach Sylomer i wypoziomuj. Przy dokręcaniu złączek przytrzymuj króćce kluczem. Przed napełnianiem podłącz wyrzuty grup na pokrywie. Płukanie najwyżej 2,5 bar.',
  });
  el({
    id: 'hp-pompy', group: 'dev', name: 'Pompy obiegowe w pompie ciepła', short: 'pompa solanki i pompa c.o. są fabrycznie w środku', anchor: H.front.clone().add(v(0, -420, 0)), parts: [],
    desc: 'To są pompa obiegowa dolnego źródła i pompa obiegowa c.o. z Twojej listy – w SWC 170H siedzą fabrycznie w obudowie (stara pompa ze zdjęcia ich nie miała, stąd pompy na rurach). Drugiej pompy c.o. przed sprzęgłem nie dokładam: w szeregu z wbudowaną wypchnęłaby przez skraplacz więcej niż dopuszczalne 3,5 m³/h. Pompa wbudowana pcha wodę przez zawór trójdrogowy do sprzęgła albo do wężownicy zasobnika. Pompa solanki ma przy 3,6 m³/h tylko ok. 0,19 bar zapasu – dlatego na dolnym źródle jest pompa wspomagająca.',
    params: [['Pompa solanki (VBO)', '0,25 kW · 0,36 bar przy 2,7 m³/h'], ['Pompa c.o. (HUP)', '0,20 kW · 0,58 bar przy 2,05 m³/h'], ['Luxtronik ze sprzęgłem', 'tryb „Trennspeicher” z czujnikiem TRL; wg schematu ait pompę wbudowaną przepina się na ZUP, a pompę za sprzęgłem podłącza do HUP, zawór przelewowy w PC zamyka – potwierdź u serwisu ait przed przepinaniem']],
    models: [{ name: 'Instrukcja Luxtronik 2.0 (instalator)', url: 'https://www.alpha-innotec.ch/fileadmin/content/downloads/Lux_Fachhandwerker_de.pdf' }, { name: 'Krzywe pomp i oporów SWC 170H', url: 'https://kundendienst.ait-group.net/alpha-innotec/5d8cbc0a-c03f-eb11-bf68-000d3a2c5ed7/823005%20Leistungs-Druckverlustkurven%20SWC170H(K).pdf' }],
  });
  const hpGroups = el({
    id: 'hp-grupy', group: 'dev', name: 'Grupy bezpieczeństwa na pokrywie PC', short: 'fabryczne: c.o. i solanka', anchor: v(HPX + 480, 1700, HPZ + 150), parts: H.lid,
    desc: 'Dwie szare skrzynki z manometrami na tylnej części pokrywy to fabryczne grupy bezpieczeństwa ait (część 60327301): zawór bezpieczeństwa, manometr i odpowietrznik – lewa dla solanki, prawa dla c.o. Są połączone z pompą bez żadnego zaworu po drodze, więc chronią ją także wtedy, gdy zamkniesz zawory odcinające na ścianie. Zostaw je; czerwone grupy na ścianie chronią resztę instalacji.',
    params: [['Ciśnienie otwarcia', 'w dokumentacji brak – najpewniej 3 bar, sprawdź napis na zaworze'], ['Wyrzut c.o.', 'wąż ¾" za pompą, ze spadkiem, do lejka po lewej stronie PC (0,95 m) – tego samego co grupa c.o. na ścianie'], ['Wyrzut solanki', 'wąż za pompą przy posadzce do kanistra (glikolu nie wolno do kanalizacji)']],
  });

  // ===== węże PC (ćwierćłuk) =====
  const hoses = [];
  const hose = (a, da, b, db, ins) => {
    const h = K.flexHose(a, da, b, db, 18);
    hoses.push(...h.parts);
    const L = a.distanceTo(b);
    const curve = new THREE.CubicBezierCurve3(a, a.clone().addScaledVector(da, L * 0.45), b.clone().addScaledVector(db, L * 0.45), b);
    hoses.push({ geo: hollowTube(curve.getPoints(30).slice(3, -3), 18 + ins, 0, 20), mat: ins === 19 ? ARMA : PEI, layer: 'insul' });
  };
  const eFlow = v(1940, 1550, ZB), eRet = v(1800, 1440, ZB), eBIn = v(HPp.bIn.p.x, 1277, ZB), eBOut = v(HPp.bOut.p.x, 1113, ZB);
  hose(HPp.hFlow.p, v(0, 0, -1), eFlow, v(0, -1, 0), 20);
  hose(HPp.hRet.p, v(0, 0, -1), eRet, v(0, -1, 0), 20);
  hose(HPp.bIn.p, v(0, 0, -1), eBIn, v(0, 1, 0), 19);
  hose(HPp.bOut.p, v(0, 0, -1), eBOut, v(0, 1, 0), 19);
  el({
    id: 'hp-weze', group: 'dev', name: 'Węże przyłączeniowe PC', short: '4 szt. z kompletu, w ćwierćłuk', anchor: v(1700, 1340, 150), parts: hoses,
    desc: 'Cztery węże antywibracyjne dostajesz w komplecie z pompą (2 do c.o. z kolorowym oznaczeniem, 2 do solanki). ait wymaga ułożenia ich w ćwierćłuk – nie na prosto i nie naciągnięte. Węże c.o. idą łukiem w górę, węże solanki łukiem w dół, więc oba obiegi rozchodzą się za pompą i nigdzie się nie krzyżują. Węże solanki izoluj paroszczelnie jak rury.',
    params: [['Gwint', 'G 1¼" płaska uszczelka'], ['Promień łuku', 'ok. 150 mm']],
  });

  // ===== obieg pompy ciepła: zasilanie =====
  const fCuts = [], fParts = [];
  // odpowietrznik w najwyższym punkcie za PC
  const ventF = v(1940, 1660, ZB);
  fParts.push(P(cyl(ventF, ventF.clone().add(v(0, 30, 0)), 17.5, 18), CU), ...airVent(ventF.clone().add(v(0, 12, 0))));
  const vF = v(1265, 1660, ZB), kfF = v(1318, 1660, ZB), tmF = v(1100, 1660, ZB);
  fCuts.push([vF, 52], [kfF, 16], [tmF, 12], [ventF, 22]);
  const V3 = K.threeWay({ o: v(880, 1820, ZF), axis: v(0, 1, 0) });
  const fPts = [eFlow, v(1940, 1660, ZB), v(880, 1660, ZB), v(880, 1660, ZF), V3.ports.ab.p];
  const rF = run('hF', fPts, { cuts: fCuts, end: 6 });
  el({
    id: 'p-zawory', group: 'prim', name: 'Zawory odcinające PC + kurki płuczące', short: 'DN32 na zasilaniu i powrocie', anchor: v(1290, 1600, 150),
    parts: [...K.ballValve({ o: vF, axis: v(-1, 0, 0), dn: 32 }).parts, ...kfe(kfF, v(0, 0, 1)), ...K.ballValve({ o: v(1290, 1500, ZB), axis: v(1, 0, 0), dn: 32 }).parts, ...kfe(v(1345, 1500, ZB), v(0, -1, 0))],
    desc: 'ait wymaga zaworów odcinających na obu przewodach c.o. i możliwości przepłukania skraplacza. Kurek KFE stoi między pompą a zaworem: zamykasz oba zawory, podpinasz węże do kurków i płuczesz samą pompę ciepła. Zawory stoją po lewej stronie pompy, na wysokości 1,5–1,7 m. Odcinają PC od naczynia 35 l, dlatego muszą być zabezpieczone przed przypadkowym zamknięciem (EN 12828): kulowe z blokadą albo ze zdjętą dźwignią. Zamykaj je tylko przy wyłączonej PC i grzałce.',
    params: [['Zawór', 'kulowy DN32 pełnoprzelotowy, PN10'], ['Kurek', 'KFE ½" z końcówką na wąż'], ['Uwaga', 'przy obu zamkniętych PC zostaje bez naczynia – rozgrzana wyrzuci wodę zaworem na pokrywie']],
    models: [{ name: 'Afriso KFE 42 407 (katalog Afriso, rozdz. 1)', url: 'https://afriso.pl/pobieranie/katalog_techniczny_rozdzial_1_wyposazenie_instalacji_i_zrodla_ciepla_AFRISO.pdf' }],
    bom: { item: 'Zawór kulowy DN32 (1¼") z blokadą + kurek KFE ½" z trójnikiem', spec: 'PN10, pełne przejście, zabezpieczony przed zamknięciem', qty: '2 + 2' },
  });
  el({
    id: 'p-termoman', group: 'prim', name: 'Termomanometr zasilania', short: '0–4 bar, 20–120 °C', anchor: v(1100, 1700, 170),
    parts: [...dial(tmF, 17.5, 'p')],
    desc: 'Na jednym zegarze widać ciśnienie i temperaturę zasilania z PC. Temperaturę powrotu pokazuje Luxtronik. Różnica przy pełnej mocy powinna wynosić ok. 5 K – tak sprawdzisz, czy zawór równoważący ustawia właściwy przepływ.',
    models: [{ name: 'Afriso TM 80 (63341)', url: 'https://afriso.pl/product/print-to-pdf/karta_produktowa_Termomanometr-TM-80-fi80-mm-0-4-bar-20-120-C-G1-4-ax-kl-2-5_63341_2024_06_AFRISO.pdf' }],
    bom: { item: 'Termomanometr Ø80 z zaworkiem', spec: '0–4 bar, 20–120 °C, G½ osiowy', qty: '1' },
  });
  el({
    id: 'p-odp', group: 'prim', name: 'Odpowietrzniki zasilania', short: 'za PC i na górze gałęzi wężownicy', anchor: v(1940, 1760, 120), parts: [...fParts, ...airVent(v(700, 1820, ZF))],
    desc: 'ait każe stawiać odpowietrzniki w najwyższych punktach zasilania. Pierwszy siedzi w narożu za PC, gdzie przewód idzie w górę i skręca w lewo. Drugi stoi na górze gałęzi do wężownicy (1820 mm), bo za zaworem trójdrogowym przewód znów się wznosi. Sprzęgło ma własny odpowietrznik.',
    models: [{ name: 'Afriso 77 735 00 + zawór odcinający ½"', url: 'https://afriso.pl/pobieranie/katalog_techniczny_rozdzial_1_wyposazenie_instalacji_i_zrodla_ciepla_AFRISO.pdf' }],
    bom: { item: 'Odpowietrznik automatyczny z zaworkiem odcinającym', spec: 'G⅜ / R½', qty: '2' },
  });
  el({
    id: 'p-3d', group: 'prim', name: 'Zawór trójdrogowy c.w.u.', short: 'DN32, siłownik 230 V z wyjścia BUP', anchor: v(880, 1900, ZF + 130), parts: V3.parts,
    desc: 'Przełącza wodę z pompy ciepła. Wspólne wejście AB od dołu (z PC). Bez napięcia płynie w prawo, przez zawór równoważący do sprzęgła i c.o. Kiedy Luxtronik woła o ciepłą wodę (wyjście BUP), zawór przełącza w lewo, do wężownicy zasobnika. Stoi na zasilaniu, przed sprzęgłem – tak jak wymaga ait. Siłownik jest z przodu, nigdy pod zaworem.',
    params: [['Średnica', 'DN32, Kvs ≥ 13 (spadek ciśnienia ≤ 0,05 bar)'], ['Siłownik', '230 V, 2-punktowy, 15–40 s'], ['Uwaga', 'przypisanie A/B zależy od producenta – sprawdź w instrukcji, który port jest otwarty bez napięcia']],
    models: [{ name: 'ESBE VRG232 DN32 + ARA635', url: 'https://esbe.eu/group/products/rotary-valves/vrg230' }, { name: 'Danfoss AMZ 113 DN32 (082G5421)', url: 'https://store.danfoss.com/en/p/082G5421' }, { name: 'alpha innotec USV 5/4" (15023101)', url: 'https://assets.heizung-billiger.de/documents/80518900ade_ma_usv.pdf' }],
    bom: { item: 'Zawór trójdrogowy przełączający z siłownikiem', spec: 'DN32 / 1¼", Kvs ≥ 13, 230 V 2-pkt', qty: '1' },
  });

  // ===== sprzęgło i jego podejścia =====
  const S = K.separator({ o: v(1200, 1840, ZF), H: 680, D: 130, portOff: 220, stub: 70, wallZ: 0, arms: [0.3, 0.02] });
  const msvO = v(1000, 1890, ZF);
  const rVB = run('hF', [V3.ports.b.p, v(1000, 1820, ZF), v(1000, 1960, ZF), S.ports.lt.p], { cuts: [[msvO, 52]], start: 4, end: 4 });
  const tS = v(975, 1500, ZB);
  const rP2 = run('hR', [S.ports.lb.p, v(975, 1720, ZF), v(975, 1560, ZF), v(975, 1560, ZB), tS], { start: 4 });
  // czujnik TRL w dolnej tulei sprzęgła
  const trl = [P(merge([cyl(v(1200, 1650, ZF + 60), v(1200, 1650, ZF + 92), 7, 12)]), MAT.brass), P(cyl(v(1200, 1650, ZF + 92), v(1200, 1650, ZF + 110), 9, 12), MAT.black)];
  el({
    id: 'p-sprz', group: 'prim', name: 'Sprzęgło hydrauliczne', short: '1¼", do 4 m³/h, odpowietrznik i spust', anchor: v(1200, 2060, ZF + 100), parts: [...S.parts, ...trl],
    desc: 'Rozdziela obieg pompy ciepła (lewa strona sprzęgła) od obiegu domu (prawa strona): każda pompa pracuje na swoim przepływie i nie przeszkadza drugiej. U góry odpowietrznik, u dołu zawór spustowy – przez niego raz na sezon spuszczasz osad. W dolnej tulei siedzi czujnik TRL, którego Luxtronik wymaga przy układzie z buforem rozdzielającym. Sprzęgło wisi na konsoli 220 mm od ściany, przed rurami PC – dzięki temu powrót z dolnego króćca przechodzi przed rurą zasilania zamiast się z nią krzyżować.',
    params: [['Dobór', 'max 4 m³/h ≥ 2,9 m³/h z PC'], ['Pojemność', '2,6 l'], ['Wymiary', 'ok. Ø130 w izolacji, wys. 680 mm, króćce co 240 mm'], ['Czujnik TRL', 'osprzęt ait, w dolnej tulei ½" sprzęgła'], ['Uwaga', 'sprzęgło ma tylko 2,6 l: jeśli termostaty pokojowe zamykają pętle, zostaw część obiegów zawsze otwartych albo zamiast sprzęgła daj bufor rozdzielający 100–200 l – inaczej PC będzie często startować']],
    models: [{ name: 'Caleffi 548007 (1¼")', url: 'https://www.caleffi.com/sites/default/files/media/external-file/01404_EN.pdf' }, { name: 'Afriso BLH 801 (90 801 10)', url: 'https://afriso.pl/product/print-to-pdf/karta_produktowa__9080110_2024_07_AFRISO.pdf' }],
    note: 'Pionowo. Pod spodem zostaw ok. 150 mm na zawór spustowy i wąż.',
    bom: { item: 'Sprzęgło hydrauliczne z izolacją, odpowietrznikiem, spustem i tuleją', spec: '1¼", do 4 m³/h', qty: '1' },
  });
  el({
    id: 'p-msv', group: 'prim', name: 'Zawór równoważący obiegu sprzęgła', short: 'DN32, nastawa ok. Kv 5,8', anchor: v(1040, 1890, ZF + 80), parts: balancingValve(msvO, v(0, 1, 0)),
    desc: 'Dławi przepływ z pompy ciepła do sprzęgła. Sprzęgło prawie nie stawia oporu, więc bez tego zaworu pompa wbudowana przepchnęłaby ok. 3,6–3,8 m³/h, czyli więcej niż dopuszczalne 3,5 m³/h. Ustaw go na 2,9 m³/h, tak żeby przy pełnej mocy różnica zasilanie–powrót wynosiła ok. 5 K. W trybie c.w.u. woda idzie przez wężownicę i zawór nie dławi ładowania.',
    models: [{ name: 'Danfoss MSV-BD DN32 (003Z4004)', url: 'https://assets.danfoss.com/documents/317591/AI144986479776en-011303.pdf' }],
    bom: { item: 'Zawór równoważący z króćcami pomiarowymi', spec: 'DN32, Kvs 18', qty: '1' },
  });

  // ===== powrót do PC (od wężownicy, przez sprzęgło, filtr) =====
  const filtO = v(1165, 1500, ZB);
  const rR = run('hR', [TP.pcPow.p, v(660, 263, 190), v(660, 263, ZB), v(660, 1500, ZB), v(1800, 1500, ZB), eRet], { cuts: [[v(1050, 1500, ZB), 52], [filtO, 64], [v(1290, 1500, ZB), 52], [v(1345, 1500, ZB), 16]], end: 6 });
  const rC1 = run('hF', [V3.ports.a.p, v(700, 1820, ZF), v(700, 1246, ZF), v(TP.pcZas.p.x + 36.1, 1246, ZF), TP.pcZas.p], { cuts: [[v(700, 1820, ZF), 22]], start: 4 });
  const tees = [teeBody(tS, 25), teeBody(v(1500, 2440, ZF), 25), teeBody(v(1500, 1780, ZF), 25)];
  el({
    id: 'p-filtr', group: 'prim', name: 'Filtr magnetyczny na powrocie do PC', short: '1¼", siatka 0,8 mm + magnes, z zaworami', anchor: v(1165, 1340, 170), parts: [...magFilter(filtO), ...K.ballValve({ o: v(1050, 1500, ZB), axis: v(1, 0, 0), dn: 32 }).parts],
    desc: 'Łapie magnetyt i szlam z całej instalacji – z c.o. domu i z wężownicy – zanim trafią do skraplacza. Stoi na wspólnym powrocie, za trójnikiem sprzęgła; powrót z wężownicy jest tym samym przewodem, więc też przez niego przechodzi. Z obu stron ma zawory, więc do czyszczenia zamykasz tylko te dwa, bez spuszczania instalacji. Czyszczenie: wyjmij magnes i spuść osad zaworem na dole – pod spodem jest ok. 140 mm do rury solanki, korpusu nie trzeba zdejmować.',
    params: [['Spadek ciśnienia', '≤ 0,03 bar przy 2,9 m³/h'], ['Czyszczenie', 'po 1. tygodniu, potem 1–2× w roku']],
    models: [{ name: 'Afriso ADS 181 HP (77 181 00)', url: 'https://afriso.pl/product/print-to-pdf/karta_produktowa__7718100_2024_07_AFRISO.pdf' }, { name: 'Caleffi DIRTMAG 546307', url: 'https://www.caleffi.com/sites/default/files/media/external-file/01137_EN.pdf' }],
    bom: { item: 'Separator zanieczyszczeń z magnesem + zawór kulowy DN32 przed nim', spec: '1¼", ≥ 3 m³/h, do 90 °C', qty: '1 + 1' },
  });
  el({
    id: 'r-prim', group: 'prim', name: 'Rury obiegu PC i wężownicy', short: 'Cu 35 × 1,5 w otulinie 25 mm', anchor: v(1560, 1600, 120), parts: [...rF, ...rR, ...rC1, ...rVB, ...rP2, ...tees],
    desc: 'Zasilanie z PC (czerwone opaski) wychodzi wężem w górę, przez odpowietrznik w narożu biegnie w lewo na wysokości 1660 mm do zaworu trójdrogowego. Z niego jedna gałąź idzie do sprzęgła, druga – z przodu, 220 mm od ściany – w dół do górnego króćca wężownicy (1246 mm). Powrót (niebieskie opaski) zaczyna się od dolnego króćca wężownicy, wchodzi za zasobnik, idzie w górę i na wysokości 1500 mm w prawo. Po drodze przyjmuje powrót ze sprzęgła i przechodzi przez filtr i zawór do PC.',
    params: [['Przepływ', '2,9 m³/h, ok. 1,0 m/s w Cu 35'], ['Izolacja', 'otulina PE 25 mm (WT 2021: 30 mm na zewnątrz kotłowni)'], ['Alternatywa', 'PP-R z wkładką aluminiową 50 mm albo stal DN32; nie PP-R z włóknem szklanym (nie jest tlenoszczelny)']],
    bom: { item: 'Rura miedziana 35 × 1,5 + kształtki + otulina 25 mm', spec: 'obieg PC i wężownicy', qty: 'ok. 9 m' },
  });

  // ===== c.o. domu =====
  const pumpS = K.pump({ o: v(1400, 2150, ZF), axis: v(0, 1, 0), L: 140 });
  const rS1 = run('cS', [S.ports.rt.p, v(1400, 1960, ZF), v(1400, 2500, ZF)], { cuts: [[v(1400, 2150, ZF), 116], [v(1400, 2300, ZF), 52], [v(1400, 2400, ZF), 12]], start: 4 });
  const rS2 = run('cR', [v(1500, 2500, ZF), v(1500, 1720, ZF), S.ports.rb.p], { cuts: [[v(1500, 2440, ZF), 26], [v(1500, 1780, ZF), 26], [v(1500, 2340, ZF), 12]], end: 4 });
  el({
    id: 's-pompa', group: 'sec', name: 'Pompa c.o. za sprzęgłem', short: 'na zasilaniu domu · ok. 2,6 m³/h', anchor: v(1400, 2150, ZF + 190), parts: [...pumpS.parts, ...K.ballValve({ o: v(1400, 2300, ZF), axis: v(0, 1, 0), dn: 32 }).parts],
    desc: 'Pompa za sprzęgłem z Twojej listy: tłoczy wodę z górnego prawego króćca sprzęgła do instalacji domu. Ustaw przepływ najwyżej 0,9 × przepływ pompy ciepła, czyli ok. 2,6 m³/h. Przy większym sprzęgło domiesza wodę z powrotu do zasilania domu i PC zacznie grzać goręcej, niż trzeba. Nad pompą zawór odcinający; pompa ma własne zawory na holenderkach.',
    params: [['Dobór', '2,6 m³/h przy 3,5–4 m (podłogówka do 35 kPa)'], ['Sterowanie', 'z Luxtronik – wg schematu ait przy buforze rozdzielającym wyjście HUP (patrz „Pompy obiegowe w PC”)'], ['Zawór zwrotny', 'niepotrzebny przy jednym obiegu; dołóż sprężynowy DN32 przy drugim obiegu']],
    models: [{ name: 'Grundfos ALPHA2 25-80 180', url: 'https://api.grundfos.com/literature/Grundfosliterature-6014960.pdf' }, { name: 'Wilo Yonos PICO 25/1-8 180', url: 'https://anglianpumping.com/app/uploads/2024/06/4215517.pdf' }, { name: 'gdy opory > 35 kPa: Grundfos MAGNA3 25-80', url: 'https://www.lenntech.com/uploads/grundfos/97924251/Grundfos_MAGNA3-25-80.pdf' }],
    note: 'Wał pompy poziomo. Zostaw ok. 100 mm wolnego miejsca wokół głowicy.',
    bom: { item: 'Pompa obiegowa c.o. + 2 zawory kulowe z holenderką', spec: '180 mm, G1½, 2,6 m³/h / 4 m', qty: '1 kpl.' },
  });
  el({
    id: 's-term', group: 'sec', name: 'Termometry c.o. domu', short: 'zasilanie i powrót', anchor: v(1450, 2440, ZF + 80), parts: [...dial(v(1400, 2400, ZF), 17.5), ...dial(v(1500, 2340, ZF), 17.5)],
    bom: { item: 'Termometr tarczowy Ø63 z tuleją', spec: '0–120 °C', qty: '2' },
    desc: 'Pokazują, jaką temperaturę dostaje dom i z jaką wraca. Jeśli zasilanie domu jest wyraźnie chłodniejsze niż zasilanie z PC, pompa za sprzęgłem ma za duży przepływ.',
  });
  // grupa bezpieczeństwa c.o. + naczynie 35 l na powrocie z domu
  const RG = redGroup(v(1640, 1780, ZF), -1, 0, -1);
  const vesCO = K.vessel({ o: v(1795, 2375, ZF), D: 376, H: 466, mat: MAT.red, clampTo: ZF });
  const rGrp = run('cR', [v(1500, 1780, ZF), RG.in], { od: 22, ins: 9, flow: false, clamps: false });
  const rVesCO = run('cR', [v(1500, 2440, ZF), v(1795, 2440, ZF), vesCO.ports.top.p], { od: 22, ins: 9, flow: false, clamps: false, cuts: [[v(1690, 2440, ZF), 30]], end: 3 });
  const capCO = [P(merge([cyl(v(1660, 2440, ZF), v(1720, 2440, ZF), 16, 6), cyl(v(1690, 2440, ZF), v(1690, 2440, ZF + 34), 12, 16)]), MAT.brass), P(cyl(v(1690, 2440, ZF + 34), v(1690, 2440, ZF + 50), 15, 16), MAT.red)];
  // wspólny lejek wyrzutów c.o. (grupa na ścianie + grupa na pokrywie PC) po lewej stronie PC, ok. 0,95 m
  const tunCO = v(1300, 950, 230);
  const rOutCO = run('odp', [RG.discharge, v(RG.discharge.x, 1005, RG.discharge.z), v(RG.discharge.x, 1005, 215), v(1312, 990, 215)], { od: 28, flow: false, clamps: false });
  const rDrCO = run('odp', [v(1300, 902, 230), v(1300, -20, 230)], { od: 32, flow: false, clamps: false });
  el({
    id: 's-grupa', group: 'sec', name: 'Grupa bezpieczeństwa c.o. (czerwona) z naczyniem 35 l', short: 'zawór 3 bar, manometr, odpowietrznik + naczynie z kompletu PC', anchor: v(1795, 2150, ZF + 210), parts: [...RG.parts, ...vesCO.parts, ...rGrp, ...rVesCO, ...capCO, ...tundish(tunCO), ...rOutCO, ...rDrCO],
    desc: 'Obie części stoją na powrocie z domu, tuż przed sprzęgłem – w najzimniejszym miejscu obiegu, a sprzęgło jest punktem neutralnym dla obu pomp. Grupa (zawór, manometr, odpowietrznik) jest nisko, na 1,8 m. Naczynie 35 l z kompletu PC wisi wyżej, pod stropem: ma pod sobą ponad 200 mm do grup na pokrywie, więc do nich sięgniesz. Podłączone jest przez zawór kapturkowy. Chronią dom i sprzęgło także wtedy, gdy pompa ciepła jest odcięta zaworami. Wyrzut zaworu bezpieczeństwa idzie rurą ze spadkiem za pompą ciepła do lejka po jej lewej stronie (0,95 m), z przerwą powietrzną 25 mm.',
    params: [['Naczynie', '35 l z kompletu ait: ciśnienie wstępne ustaw na 1,0 bar, napełniaj do 1,3 bar na zimno'], ['Obliczenie', 'ok. 320 l wody, 10 → 70 °C: potrzeba 23,8 l, więc 35 l ma zapas (wystarczy do ok. 535 l)'], ['Zawór bezpieczeństwa', '3 bar, przepustowość ≥ 26 kW (PC + grzałka)']],
    models: [{ name: 'Afriso BSS 90 610 00 (grupa z przyłączem naczynia)', url: 'https://budujemydom.pl/files/ggv/13893-ulotka_grupa_bezpieczenstwa_c.o._z_przylaczem_do_naczynia_przeponowego_bss_AFRISO.pdf' }, { name: 'Afriso KSG 77 938', url: 'https://afriso.pl/pobieranie/katalog_techniczny_rozdzial_1_wyposazenie_instalacji_i_zrodla_ciepla_AFRISO.pdf' }, { name: 'zamiennik naczynia: Reflex N 35', url: 'https://a.storyblok.com/f/180632/x/a92c2eeea7/cennik_pl_2026_01.pdf' }],
    note: 'Zawór kapturkowy (np. Reflex SU ¾") pozwala sprawdzić ciśnienie wstępne bez spuszczania instalacji – mierz je przy pustej wodzie po stronie naczynia. Ciśnienie wstępne 1,0 bar zakłada najwyżej ok. 8 m instalacji nad naczyniem.',
    bom: { item: 'Grupa bezpieczeństwa c.o. z konsolą + zawór kapturkowy ¾" + lejek z syfonem', spec: '3 bar, ¾", manometr 0–4 bar', qty: '1 kpl.' },
  });
  el({
    id: 'r-sec', group: 'sec', name: 'Rury c.o. domu', short: 'Cu 35 w otulinie 25 mm, w strop', anchor: v(1450, 2470, ZF + 40), parts: [...rS1, ...rS2, sleeve(v(1400, WALL.H, ZF), v(0, 1, 0), 42), sleeve(v(1500, WALL.H, ZF), v(0, 1, 0), 42)],
    desc: 'Zasilanie domu (pomarańczowe opaski) wychodzi z górnego prawego króćca sprzęgła, idzie w górę przez pompę i w strop. Powrót (fioletowe opaski) schodzi ze stropu obok, przyjmuje grupę z naczyniem i wchodzi w dolny prawy króciec sprzęgła. Przejście przez strop w tulejach.',
    bom: { item: 'Rura miedziana 35 × 1,5 + kształtki + otulina 25 mm', spec: 'obieg domu do stropu', qty: 'ok. 2,5 m' },
  });
  LABELS.push({ text: 'c.o. domu: zasilanie ↑ powrót ↓', pos: v(1450, WALL.H - 30, ZF + 80), cls: 'c-heat' });

  // ===== dolne źródło =====
  const XBI = 1070, XBO = 1230, YE = 230;
  const pumpB = K.pump({ o: v(XBI, 940, ZB), axis: v(0, 1, 0), L: 140 });
  const fillB = K.fillSet({ o: v(XBI, 520, ZB), axis: v(0, 1, 0) });
  const strB = K.yStrainer({ o: v(XBI, 720, ZB), axis: v(0, 1, 0), dn: 32 });
  const tB = v(1145, 1100, ZB);
  const bInCuts = [[v(XBI, 330, ZB), 50], [v(XBI, 520, ZB), 122], [v(XBI, 720, ZB), 62], [v(XBI, 940, ZB), 116], [v(1215, 1100, ZB), 50], [v(1300, 1100, ZB), 12]];
  const rBIn = run('bIn', [v(XBI, YE, -20), v(XBI, YE, ZB), v(XBI, 1100, ZB), v(eBIn.x, 1100, ZB), eBIn], { cuts: bInCuts, end: 6 });
  const ventB = v(XBO, 960, ZB);
  const rBOut = run('bOut', [eBOut, v(eBOut.x, 960, ZB), v(XBO, 960, ZB), v(XBO, YE, ZB), v(XBO, YE, -20)], { cuts: [[v(XBO, 820, ZB), 50], [v(XBO, 650, ZB), 12], [ventB, 22]], start: 6 });
  // grupa solanki z naczyniem (wejście z prawej) – nad naczyniem c.w.u., za pompą wspomagającą
  const BG = redGroup(v(870, 1260, 180), 1, 0);
  const vesB = K.vessel({ o: v(870, 1208, 180), D: 280, H: 400, mat: MAT.red, clampTo: 180 });
  const rBG = run('bIn', [tB, v(1145, 1260, ZB), v(1145, 1260, 180), BG.in], { od: 22, ins: 9, flow: false, clamps: false });
  // wąż wyrzutu z grupy solanki na pokrywie PC: za pompą przy posadzce do kanistra
  const lb = H.lidBoxes[0];
  const rLidB = run('hose', [v(lb.x, 1630, HPZ + 35), v(lb.x, 1630, 190), v(1690, 1630, 190), v(1690, 140, 190), v(1000, 140, 190)], { flow: false, clamps: false });
  const hoseLidB = K.flexHose(v(1000, 140, 190), v(-1, 0, 0), v(880, 252, 455), v(0, 1, 0), 9);
  // wąż wyrzutu z grupy c.o. na pokrywie PC: za pompą ze spadkiem do lejka po lewej stronie PC
  const lh = H.lidBoxes[1];
  const rLidH = run('hose', [v(lh.x, 1630, HPZ + 35), v(lh.x, 1630, 255), v(1965, 1630, 255), v(1965, 1015, 255), v(1288, 1000, 255)], { flow: false, clamps: false });
  hpGroups.parts.push(...rLidB, ...hoseLidB.parts, ...rLidH);
  const can = K.canister({ o: v(868, 0, 470) });
  const hoseB = K.flexHose(BG.discharge, v(0, 0, 1), v(908, 252, 470), v(0, 1, 0), 7);
  el({
    id: 'b-zawory', group: 'brine', name: 'Zawory odcinające kolektor', short: 'DN32 przy przepustach', anchor: v(1150, 330, 170),
    parts: [...K.ballValve({ o: v(XBI, 330, ZB), axis: v(0, 1, 0), dn: 32 }).parts, ...K.ballValve({ o: v(XBO, 820, ZB), axis: v(0, -1, 0), dn: 32 }).parts],
    desc: 'Odcinają kolektor gruntowy od kotłowni (np. do wymiany filtra albo pompy bez spuszczania glikolu z pętli). Dolny na dopływie z gruntu, drugi na powrocie do gruntu, nad termometrem.',
    params: [['Zawór', 'kulowy DN32 pełnoprzelotowy, do −10 °C']],
    bom: { item: 'Zawór kulowy DN32 (1¼") do glikolu', spec: 'PN10, −10…+110 °C', qty: '2' },
  });
  el({
    id: 'b-plukanie', group: 'brine', name: 'Zestaw do napełniania i płukania', short: 'zawór w linii + 2 kurki', anchor: v(XBI + 80, 520, 200), parts: fillB.parts,
    desc: 'Przez ten zestaw napełniasz dolne źródło gotowym roztworem glikolu i płuczesz pętle stacją z pompą. Zamykasz zawór w linii; pompa stacji tłoczy przez jeden kurek, a powrót wraca drugim do beczki, aż przestaną lecieć bąble (≥ 0,6 m/s w pętli). Glikol mieszaj przed wlaniem.',
    params: [['Płyn wg ait', 'glikol etylenowy ≥ 25 % (do −13 °C); przy glikolu propylenowym ok. 30 %'], ['Ciśnienie po napełnieniu', '1,5 bar na zimno (sprawdź zalecenie ait)'], ['Kierunek płukania', 'stacja tłoczy do górnego kurka (w stronę PC), powrót z kolektora wraca dolnym kurkiem – brud z pętli nie przechodzi przez parownik']],
    models: [{ name: 'Afriso KFE 42 407 ×2 + zawór DN32', url: 'https://afriso.pl/pobieranie/katalog_techniczny_rozdzial_1_wyposazenie_instalacji_i_zrodla_ciepla_AFRISO.pdf' }, { name: 'NIBE KB R32 (zestaw z filtrem)', url: 'https://www.ahlsell.se/en/products/heating-and-sanitation/heating/heat-pumps/accessories-heat-pumps/6246527' }],
    bom: { item: 'Zestaw napełniania i płukania dolnego źródła', spec: 'DN32 + 2 kurki ½"', qty: '1' },
  });
  el({
    id: 'b-filtr', group: 'brine', name: 'Filtr siatkowy solanki', short: 'Rp 1¼", siatka ≤ 0,6–0,9 mm', anchor: v(XBI + 80, 720, 190), parts: strB.parts,
    desc: 'ait wymaga filtra na wejściu solanki do pompy – chroni płytowy parownik i pompy. Stoi przed pompą wspomagającą, więc ją też chroni. Po pierwszym tygodniu pracy wyczyść siatkę: wtedy łapie najwięcej piasku i opiłków z budowy kolektora.',
    models: [{ name: 'Resideo FY30-1¼A (podwójne sito 0,35 mm)', url: 'https://www.resideo.com/gb/en/products/water/water-treatment/strainers/fy30-1a-double-sieve-y-strainer-mesh-size-approximately-035-mm-fy30-1a/' }],
    bom: { item: 'Filtr siatkowy skośny', spec: 'Rp 1¼", siatka ≤ 0,6 mm, Kvs ≥ 20', qty: '1' },
  });
  el({
    id: 'b-grupa', group: 'brine', name: 'Grupa bezpieczeństwa dolnego źródła (czerwona) z naczyniem', short: 'zawór 3 bar, manometr, odpowietrznik + 18 l', anchor: v(870, 1380, 290), parts: [...BG.parts, ...vesB.parts, ...rBG, ...can.parts, ...hoseB.parts],
    desc: 'Grupa z Twojej listy, po stronie instalacji: za pompą wspomagającą, przed zaworem odcinającym pompy ciepła. Razem z naczyniem 18 l w pompie ciepła trzyma ciśnienie solanki i chroni kolektor także wtedy, gdy pompa ciepła jest odcięta zaworami (pompę ciepła chroni jej grupa na pokrywie). Manometr przy ścianie pokazuje ciśnienie solanki. Wyrzut zaworu bezpieczeństwa leci wężem do kanistra – glikolu nie wolno wylewać do kanalizacji.',
    params: [['Zawór bezpieczeństwa', '3 bar (jak na pokrywie PC – sprawdź napis)'], ['Naczynie', '18 l do glikolu i −10 °C, przez zawór kapturkowy / szybkozłączkę'], ['Ciśnienia', 'napełnianie 1,5 bar na zimno; ciśnienie wstępne tego naczynia 1,2 bar (0,3 bar poniżej), naczynie w PC zostaw fabryczne 0,5 bar'], ['Obliczenie', 'ok. 420 l solanki, −5 → +25 °C: ok. 4,2 l rozszerzalności; przy 1,5 → 2,5 bar oba naczynia przyjmą ok. 7,5 l'], ['Odpowietrznik', 'po odpowietrzeniu zakręć zaworek (glikol)']],
    models: [{ name: 'Afriso BSS 90 610 00', url: 'https://budujemydom.pl/files/ggv/13893-ulotka_grupa_bezpieczenstwa_c.o._z_przylaczem_do_naczynia_przeponowego_bss_AFRISO.pdf' }, { name: 'naczynie: Zilmet Cal-pro 18 (czerwone)', url: 'https://www.zilmet.it/en/products/cal-pro' }],
    bom: { item: 'Grupa bezpieczeństwa z konsolą + naczynie 18 l + zawór kapturkowy + kanister', spec: '3 bar, ¾", glikol ≤ 50 %', qty: '1 kpl.' },
  });
  el({
    id: 'b-pompa', group: 'brine', name: 'Pompa obiegowa dolnego źródła (wspomagająca)', short: 'w szeregu z wbudowaną · do glikolu i −10 °C', anchor: v(XBI, 1010, ZB + 230), parts: pumpB.parts,
    desc: 'Pompa z Twojej listy. Pracuje w szeregu z pompą wbudowaną i dodaje jej ciśnienia: wbudowana przy 3,6 m³/h ma tylko ok. 0,19 bar zapasu, a typowy kolektor 4 × 100 m potrzebuje 0,25–0,30 bar. Zasilaj ją równolegle z wyjściem VBO, żeby zawsze chodziła razem z wbudowaną. Ustaw stałe obroty tak, żeby różnica temperatur solanki przy pełnej pracy wynosiła ok. 3 K. Jeśli bez niej przepływ jest już ≥ 3,6 m³/h, możesz ją pominąć.',
    params: [['Przepływ', '3,6 m³/h'], ['Wysokość', '1,5–3 m (zależy od kolektora)'], ['Zasilanie', '230 V z VBO przez przekaźnik (płyta Luxtronik max 6 A)'], ['Nie nadaje się', 'Grundfos ALPHA2 – dopuszczona od +2 °C']],
    models: [{ name: 'Grundfos MAGNA3 25-60 180 (−10…110 °C)', url: 'https://www.lenntech.com/uploads/grundfos/97924251/Grundfos_MAGNA3-25-80.pdf' }, { name: 'Wilo Yonos PICO 25/1-8 (gdy brakuje ≤ 0,2 bar)', url: 'https://anglianpumping.com/app/uploads/2024/06/4215517.pdf' }],
    note: 'Wał poziomo, puszka kablem w dół, izolacja chłodnicza producenta na korpusie – głowicy z elektroniką nie izoluj.',
    bom: { item: 'Pompa obiegowa do glikolu + 2 zawory z holenderką', spec: '180 mm, G1½, −10 °C, 3,6 m³/h', qty: '1 kpl.' },
  });
  el({
    id: 'b-zpc', group: 'brine', name: 'Zawór odcinający i termometr solanki przy PC', short: 'na dopływie do PC', anchor: v(1235, 1170, 180),
    parts: [...K.ballValve({ o: v(1215, 1100, ZB), axis: v(1, 0, 0), dn: 32 }).parts, ...dial(v(1300, 1100, ZB), 21, 'b')],
    desc: 'Zawór odcina pompę ciepła od strony solanki (razem z zaworem na powrocie do gruntu) – do płukania parownika i serwisu. Termometr pokazuje temperaturę solanki wchodzącej do PC.',
    bom: { item: 'Zawór kulowy DN32 + termometr −30…+50 °C', spec: 'do glikolu', qty: '1 + 2' },
  });
  el({
    id: 'b-odp', group: 'brine', name: 'Odpowietrznik solanki', short: 'z zaworem odcinającym', anchor: v(XBO + 40, 1030, 150), parts: airVent(ventB, 21),
    desc: 'W narożu powrotu do gruntu, za pompą ciepła. Po napełnieniu i odpowietrzeniu zakręć zaworek pod odpowietrznikiem – przy glikolu automat lubi przeciekać.',
    bom: { item: 'Odpowietrznik automatyczny z zaworkiem', spec: 'glikol do 50 %', qty: '1' },
  });
  el({
    id: 'b-term', group: 'brine', name: 'Termometr powrotu do gruntu', short: '−30…+50 °C', anchor: v(XBO + 60, 650, 170), parts: dial(v(XBO, 650, ZB), 21, 'b'),
    desc: 'Razem z termometrem przy PC pokazuje, ile ciepła PC bierze z gruntu. Przy pełnej mocy różnica powinna wynosić ok. 3 K.',
  });
  el({
    id: 'r-brine', group: 'brine', name: 'Rury solanki i przepusty', short: 'Cu 42 × 1,5 w kauczuku 19 mm', anchor: v(1400, 1180, 130),
    parts: [...rBIn, ...rBOut, teeBody(tB, 27), sleeve(v(XBI, YE, 0), v(0, 0, 1), 40), sleeve(v(XBO, YE, 0), v(0, 0, 1), 40)],
    desc: 'Rury z kolektora wchodzą przez ścianę 230 mm nad posadzką, w tulejach (jeśli u Ciebie wchodzą gdzie indziej, przesuwa się tylko ten odcinek). Dopływ z gruntu (zielone opaski) idzie w górę przez całą armaturę, na 1180 mm skręca za pompę ciepła i wężem łukiem w dół wchodzi w króciec 1. Powrót (jasnozielone opaski) wychodzi z króćca 2 łukiem w dół, biegnie na 1040 mm w lewo i schodzi do ściany. Cała solanka, z armaturą i wężami, ma otulinę paroszczelną – inaczej rury będą się pocić.',
    params: [['Przepływ', '3,6 m³/h, ok. 0,84 m/s w Cu 42'], ['Do kolektora', 'PE 50 × 4,6 (nie stal ocynkowana – glikol)'], ['Izolacja', 'Armaflex XG / K-Flex ST 19 mm, przy dużej wilgotności 25 mm; szwy klejone']],
    bom: { item: 'Rura Cu 42 × 1,5 + kształtki + otulina kauczukowa 19 mm + 2 tuleje', spec: 'solanka', qty: 'ok. 5 m' },
  });
  LABELS.push({ text: 'z kolektora', pos: v(XBI - 70, YE - 40, 40), cls: 'c-brine' });
  LABELS.push({ text: 'do kolektora', pos: v(XBO + 70, YE - 40, 40), cls: 'c-brine' });

  // ===== woda użytkowa =====
  const YH = 2370;
  const FR = filterReducer(v(290, YH, ZB));
  const DG = dhwGroup(v(430, 2120, ZB), -1);
  const vesW = K.vessel({ o: v(860, 260, 170), D: 280, H: 500, mat: WHITE_V, clampTo: 170, up: true });
  const MX = K.mixingValve({ o: v(570, 1850, ZB), side: -1 });
  const rCold = run('zw', [v(50, WALL.H, ZB), v(50, YH, ZB), v(430, YH, ZB), DG.a], { cuts: [[v(140, YH, ZB), 50], [v(290, YH, ZB), 92]], end: 4 });
  const rCold2 = run('zw', [DG.b, v(430, 1550, ZB), v(100, 1550, ZB), v(100, 272, ZB), v(TX, 272, ZB), TP.zimna.p], { start: 4 });
  const rMixC = run('zw', [v(430, 1850, ZB), MX.ports.cold.p], { flow: false, clamps: false, end: 4 });
  const rVes = run('zw', [v(TX, 272, ZB), v(TX, 150, ZB), v(860, 150, ZB), v(860, 150, 170), vesW.ports.top.p], { od: 22, flow: false, clamps: false, end: 3 });
  const rDrainT = run('zw', [TP.spust.p, v(TX, 74, ZB), v(700, 74, ZB), v(700, 74, 608)], { od: 22, ins: 0, flow: false, clamps: false, end: 2 });
  const rHot = run('cwu', [TP.cwu.p, v(TX, 1229, ZB), v(570, 1229, ZB), MX.ports.hot.p], { end: 4 });
  const rHot2 = run('cwu', [MX.ports.mix.p, v(570, WALL.H, ZB)], { cuts: [[v(570, 2050, ZB), 50], [v(570, 2200, ZB), 12]], start: 4 });
  const rDhwOut = run('odp', [DG.discharge, v(DG.discharge.x, 2045, ZB)], { od: 22, flow: false, clamps: false });
  const tunW = v(370, 2020, ZB);
  const rDhwDrain = run('odp', [v(370, 1970, ZB), v(370, 1970, 25), v(370, 30, 25), v(370, 30, -10)], { flow: false, clamps: false });
  el({
    id: 'w-zawor', group: 'dhw', name: 'Zawór główny zimnej wody', short: 'Rp 1", niebieska dźwignia', anchor: v(140, YH + 60, 160), parts: K.ballValve({ o: v(140, YH, ZB), axis: v(1, 0, 0), dn: 25, lever: MAT.levBlue }).parts,
    desc: 'Odcina wodę z sieci do zasobnika. Zimna woda przychodzi ze stropu w lewym górnym rogu i od razu idzie poziomo – na poziomym odcinku musi stać filtr z reduktorem.',
    bom: { item: 'Zawór kulowy 1" do wody pitnej', spec: 'PN16', qty: '1' },
  });
  el({
    id: 'w-fk06', group: 'dhw', name: 'Filtr z reduktorem ciśnienia', short: '1", nastawa 3,5 bar', anchor: v(290, YH + 140, 160), parts: FR,
    desc: 'Filtr 100 µm i reduktor ciśnienia w jednym korpusie. Nastaw 3,5 bar: reduktor musi trzymać ciśnienie wyraźnie poniżej 6 bar zaworu bezpieczeństwa (najwyżej 0,8 × 6 bar), inaczej zawór będzie kapał przy każdym grzaniu. Montaż poziomo, kubkiem w dół, za nim co najmniej 5 średnic prostej rury.',
    params: [['Spadek ciśnienia', 'ok. 0,13 bar przy 2,2 m³/h (kvs 6)'], ['Zakres nastawy', '1,5–6 bar']],
    models: [{ name: 'Resideo FK06-1AA', url: 'https://res.cloudinary.com/dzhpkjoqj/Resideo/fk06-pd-en0h1126ge23.pdf' }, { name: 'Resideo FF06-1AA (filtr) + osobny reduktor', url: 'https://homecomfort-techlit.resideo.com/emeadocuments/pim%20-%20renamed/ff06-pd-en0h1115ge23.pdf' }],
    bom: { item: 'Filtr z reduktorem ciśnienia i manometrem', spec: '1", 100 µm, nastawa 3,5 bar', qty: '1' },
  });
  el({
    id: 'w-grupa', group: 'dhw', name: 'Grupa bezpieczeństwa zasobnika (niebieska)', short: 'odcięcie + zwrotny + zawór 6 bar + lejek', anchor: v(430, 2120, ZB + 150), parts: [...DG.parts, ...rDhwOut, ...tundish(tunW), ...rDhwDrain],
    desc: 'Grupa z Twojej listy, na dopływie zimnej wody. Między nią a zasobnikiem nie ma żadnego zaworu odcinającego, tylko trójniki zaworu mieszającego i naczynia – tak wymagają przepisy, bo zasobnika nie wolno odciąć od zaworu bezpieczeństwa. Wylot zaworu leci do lejka z przerwą powietrzną, dalej rurą za zasobnikiem do kanalizacji. Stoi nad zasobnikiem, więc wkładkę zaworu wymienisz bez spuszczania wody.',
    params: [['Zawór bezpieczeństwa', '6 bar, DN20 (zasobnik 200–1000 l) – sprawdź w karcie, że sam zawór ma DN20'], ['Przerwa powietrzna', 'wylot 25 mm nad lejkiem'], ['Sprawdzanie', 'co pół roku przekręć kołpak – zawór musi puścić i się zamknąć']],
    models: [{ name: 'Resideo SG160S-¾AA', url: 'https://homecomfort-techlit.resideo.com/emeadocuments/pim%20-%20renamed/sg160s-pd-en0h1346ge23.pdf' }, { name: 'albo: kulowy + zwrotny + Afriso MSW ¾" 6 bar 42 425', url: 'https://onninen.pl/en/product/AFRISO-MSW-safety-valve-3-4-x1-6-bar-for-domestic-hot-water-installations-42425,94078' }],
    bom: { item: 'Grupa bezpieczeństwa c.w.u. z lejkiem + syfon', spec: '¾", 6 bar', qty: '1' },
  });
  el({
    id: 'w-naczynie', group: 'dhw', name: 'Naczynie przeponowe c.w.u.', short: '25 l na trójniku przy wejściu zimnej wody', anchor: v(860, 600, 330), parts: [...vesW.parts, ...rVes, teeBody(v(TX, 272, ZB), 21)],
    desc: 'Przeniesione z górnej mufy anody na wejście zimnej wody: trójnik siedzi przy samym króćcu zimnej wody zasobnika (h2, 272 mm), od niego krótka rura idzie nisko za zasobnikiem w prawo do naczynia na ścianie obok zasobnika. Jest po stronie zasobnika względem zaworu zwrotnego grupy bezpieczeństwa – tak musi być. Przyjmuje wodę, która rozszerza się przy grzaniu, więc zawór bezpieczeństwa nie kapie.',
    params: [['Ciśnienie wstępne', '3,3 bar (0,2 bar poniżej nastawy reduktora), sprawdzaj co rok przy zamkniętej wodzie'], ['Obliczenie', 'zasobnik do 65 °C: ok. 23 l → 25 l; jeśli grzejesz do 70 °C – 33 l'], ['Podłączenie', 'trójnik 1" na króćcu zimnej wody, rura Cu 22 do naczynia; bez zaworu po drodze (najwyżej zawór kapturkowy z blokadą do serwisu)']],
    models: [{ name: 'Reflex Refix DD 25 (biały, do wody pitnej)', url: 'https://a.storyblok.com/f/180632/x/a92c2eeea7/cennik_pl_2026_01.pdf' }, { name: 'Ferro M35+ (gdy do 70 °C)', url: 'https://ik.pl/pliki/FERRO/naczynia_uniwersalne_3xA5_PL_web.pdf' }],
    bom: { item: 'Naczynie przeponowe do wody pitnej + trójnik 1" + uchwyt ścienny', spec: '25 l, 10 bar', qty: '1' },
  });
  el({
    id: 'w-mieszacz', group: 'dhw', name: 'Termostatyczny zawór mieszający', short: '45–65 °C, nastaw 50–55 °C', anchor: v(640, 1850, 190), parts: [...MX.parts, ...rMixC, teeBody(v(430, 1850, ZB), 19)],
    desc: 'Chroni przed poparzeniem, gdy PC albo grzałka podgrzeje zasobnik wyżej (np. przy dezynfekcji). Ciepła woda wchodzi od dołu, zimną bierze z odgałęzienia za grupą bezpieczeństwa – wtedy zawór zwrotny grupy pilnuje, żeby ciepła woda nie wróciła do sieci.',
    models: [{ name: 'ESBE VTA522 (31621100) z zaworami zwrotnymi', url: 'https://www.kazanwebshop.hu/shop_ordered/15757/pic/pros_vta_320_520_keveroszelepek.pdf' }],
    note: 'Przy cyrkulacji c.w.u. podłączenie mieszacza musi być jak w schemacie ESBE z cyrkulacją.',
    bom: { item: 'Termostatyczny zawór mieszający', spec: 'R1, 45–65 °C, Kvs ≥ 3', qty: '1' },
  });
  el({
    id: 'w-zawor-cwu', group: 'dhw', name: 'Zawór i termometr c.w.u.', short: 'na wyjściu do domu', anchor: v(640, 2120, 170), parts: [...K.ballValve({ o: v(570, 2050, ZB), axis: v(0, 1, 0), dn: 25 }).parts, ...dial(v(570, 2200, ZB), 14)],
    bom: { item: 'Zawór kulowy 1" + termometr 0–120 °C', spec: 'woda pitna', qty: '1 + 1' },
    desc: 'Zawór pozwala wymienić mieszacz bez spuszczania zasobnika. Termometr pokazuje, ile stopni idzie do kranów.',
  });
  el({
    id: 'w-spust', group: 'dhw', name: 'Spust zasobnika', short: 'z króćca h1, zawór z końcówką na wąż', anchor: v(700, 130, 680), parts: [...rDrainT, ...K.ballValve({ o: v(700, 74, 640), axis: v(0, 0, 1), dn: 15 }).parts],
    desc: 'Z własnego króćca spustowego zasobnika h1 (74 mm, 1½") rura idzie przy samej posadzce za zasobnikiem w prawo i wzdłuż jego boku do przodu – zawór z końcówką na wąż jest przy prawym przednim boku zasobnika. Przez króciec zimnej wody (272 mm) spuściłbyś tylko część wody, na dnie zostałoby ok. 60 l razem z osadem.',
    bom: { item: 'Redukcja 1½" × ¾" + rura Cu 22 + zawór spustowy z końcówką na wąż', spec: 'spust h1', qty: '1 kpl.' },
  });
  el({
    id: 'w-czujnik', group: 'dhw', name: 'Czujnik c.w.u. pompy ciepła (TBW)', short: 'w tulei zasobnika', anchor: v(TX - 60, 1032, 120),
    parts: [P(merge([cyl(TP.termostat.p, TP.termostat.p.clone().add(v(0, 0, -16)), 13, 12), cyl(TP.termostat.p.clone().add(v(0, 0, -16)), v(TX, 1032, 40), 3, 8), cyl(v(TX, 1032, 40), v(TX, 1229 - 60, 40), 3, 8)]), MAT.black)],
    desc: 'Czujnik temperatury c.w.u. z Luxtronik (osprzęt ait, 6 mm) wsuń do tulei w połowie wysokości zasobnika – w S15 300 to h5 ok. 795 mm; jeśli jej nie ma, użyj h7 1032 mm (narysowany). Bez niego PC nie wie, kiedy ładować zasobnik. Przewód prowadź z dala od przewodów zasilających.',
  });
  el({
    id: 'r-dhw', group: 'dhw', name: 'Rury wody zimnej i ciepłej', short: 'Cu 28 × 1, otulina 13 / 20 mm', anchor: v(100, 900, 130),
    parts: [...rCold, ...rCold2, ...rHot, ...rHot2, sleeve(v(50, WALL.H, ZB), v(0, 1, 0), 27), sleeve(v(570, WALL.H, ZB), v(0, 1, 0), 34)],
    desc: 'Zimna woda (niebieskie opaski) przychodzi ze stropu, poziomo przez zawór i filtr z reduktorem, w dół przez grupę bezpieczeństwa i trójnik mieszacza, nad zasobnikiem w lewo, w dół przy lewej krawędzi i na dole do króćca zimnej wody – tam trójnik z naczyniem. Ciepła woda (różowe opaski) wychodzi z króćca 1229 mm, idzie w prawo za zasobnikiem, w górę do mieszacza i w strop. Obie trasy nigdzie się nie krzyżują.',
    params: [['Przepływ szczytowy', 'ok. 2,2 m³/h, ok. 1,1 m/s w Cu 28'], ['Izolacja', 'zimna – kauczuk 13 mm (przeciw roszeniu), ciepła – 20 mm']],
    bom: { item: 'Rura Cu 28 × 1 + kształtki + otuliny', spec: 'woda pitna', qty: 'ok. 8 m' },
  });
  LABELS.push({ text: 'woda z sieci ↓', pos: v(110, WALL.H - 30, ZB + 70), cls: 'c-dhw' });
  LABELS.push({ text: 'c.w.u. do kranów ↑', pos: v(600, WALL.H - 30, ZB + 70), cls: 'c-dhw' });

  // ===== odpływy =====
  el({
    id: 'm-odplyw', group: 'misc', name: 'Odpływ z zaworów bezpieczeństwa', short: 'lejki z przerwą powietrzną → kanalizacja', anchor: v(360, 700, 120), parts: [],
    desc: 'Wyrzut każdego zaworu bezpieczeństwa wody (c.w.u. i c.o.) wpada do lejka z przerwą powietrzną – widać, że zawór puszcza – a dalej rura PP ze spadkiem prowadzi do kanalizacji przez syfon. Rura wyrzutowa nie może być węższa niż wylot zaworu, może mieć najwyżej 2 m i 2 kolana (o rozmiar większa: 4 m i 3 kolana), zawsze ze spadkiem i bez zaworów. Wyrzuty solanki idą do kanistra, nie do kanalizacji.',
    bom: { item: 'Lejek z syfonem + rura PP 32 + mufy', spec: 'do kanalizacji', qty: '2 kpl.' },
  });

  // ===== strefy =====
  LABELS.push({ text: 'C.W.U.', pos: v(330, 2230, 330), cls: 'c-dhw' });
  LABELS.push({ text: 'OBIEG POMPY CIEPŁA', pos: v(735, 2080, 330), cls: 'c-heat' });
  LABELS.push({ text: 'DOLNE ŹRÓDŁO', pos: v(800, 1190, 360), cls: 'c-brine' });

  // ===== numeracja, legenda, schemat =====
  const order = ['dev', 'brine', 'prim', 'sec', 'dhw', 'misc'];
  EL.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  EL.forEach((e, i) => { e.no = i + 1; });
  const no = Object.fromEntries(EL.map((e) => [e.id, e.no]));
  for (const e of EL) e.desc = e.desc.replace(/\{(\w[\w-]*)\}/g, (_, id) => no[id] ?? '?');
  for (const d of DECALS) if (d.el === undefined) d.el = null;

  return {
    elements: EL,
    static: STATIC,
    decals: DECALS,
    flows: FLOWS.map((f) => ({ ...f, path: f.path.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 2 === 0) })),
    labels: LABELS,
    groups: {
      dev: { name: 'Urządzenia', color: '#495057' },
      brine: { name: 'Dolne źródło – glikol', color: hex(LN.bIn.color) },
      prim: { name: 'Obieg pompy ciepła', color: hex(LN.hF.color) },
      sec: { name: 'C.o. domu (za sprzęgłem)', color: hex(LN.cS.color) },
      dhw: { name: 'Woda użytkowa', color: hex(LN.zw.color) },
      misc: { name: 'Odpływy', color: '#868e96' },
    },
    lines: Object.fromEntries(Object.entries(LN).map(([k, c]) => [k, hex(c.color)])),
    schematic: schematicSVG(no),
    bomExtra: [
      { item: 'Glikol (gotowy roztwór lub koncentrat)', spec: 'etylenowy ≥ 25 % wg ait / propylenowy ok. 30 %', qty: 'na ok. 420 l', models: '' },
      { item: 'Zawór napełniania c.o. z zabezpieczeniem BA', spec: '½" (woda z inhibitorem)', qty: '1', models: '<a href="https://res.cloudinary.com/dzhpkjoqj/Resideo/nk300s-pd-en0h1556ge23.pdf" target="_blank" rel="noopener">Resideo NK300S-½A</a>' },
      { item: 'Obejmy z wkładką gumową, kołki, szyny', spec: 'Cu 22–42', qty: 'ok. 30' },
      { item: 'Korek ¾" (cyrkulacja h6)', spec: 'zasobnik', qty: '1' },
      { item: 'Przewody: zasilanie pomp, siłownika, czujnik TRL', spec: 'wg schematu Luxtronik, przekaźnik dla pompy solanki', qty: '' },
    ],
  };
}
