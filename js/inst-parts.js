import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hollowTube, cylinderBetween, merge, latheSolid, ellipseArc } from './geom.js';

// Biblioteka armatury do modelu ściany kotłowni. Każdy element budowany jest w lokalnym układzie
// (oś przepływu = lokalne +Y, przód od ściany = lokalne +Z) i przenoszony macierzą frame().
// Zwraca { parts: [{ geo, mat }], ports: { nazwa: { p: Vector3, d: Vector3 } } } w układzie świata (mm).

const V = THREE.Vector3;
const v = (x, y, z) => new V(x, y, z);
const Z = v(0, 0, 1);

export const MAT = {
  brass: { color: 0xc8a24a, metal: 0.75, rough: 0.35 },
  chrome: { color: 0xc9ced4, metal: 0.85, rough: 0.25 },
  steel: { color: 0x8d949c, metal: 0.6, rough: 0.4 },
  cast: { color: 0x3b3f45, metal: 0.4, rough: 0.55 },
  pumpRed: { color: 0xc62828, metal: 0.1, rough: 0.45 },
  pumpHead: { color: 0x22252a, metal: 0.2, rough: 0.5 },
  black: { color: 0x1d1f22, rough: 0.85 },
  white: { color: 0xf1f2f4, metal: 0.05, rough: 0.45 },
  red: { color: 0xd23b30, rough: 0.5 },
  blue: { color: 0x2f6fd1, rough: 0.5 },
  levRed: { color: 0xd8262c, rough: 0.45 },
  levBlue: { color: 0x2563c9, rough: 0.45 },
  rubber: { color: 0x1b1c1f, rough: 0.9 },
  plastic: { color: 0xe7e8ea, rough: 0.55 },
  hpBody: { color: 0xb9bec4, metal: 0.35, rough: 0.45 },
  hpFront: { color: 0xeef0f2, metal: 0.1, rough: 0.4 },
};

export function frame(o, axis, front = Z) {
  const y = axis.clone().normalize();
  let z = front.clone().sub(y.clone().multiplyScalar(front.dot(y)));
  if (z.lengthSq() < 1e-6) z = Math.abs(y.x) < 0.9 ? v(1, 0, 0) : v(0, 0, 1);
  z.normalize();
  const x = new V().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

function finish(parts, ports, m) {
  const rot = new THREE.Matrix3().setFromMatrix4(m);
  for (const p of parts) p.geo.applyMatrix4(m);
  const out = {};
  for (const [k, pt] of Object.entries(ports)) out[k] = { p: pt.p.clone().applyMatrix4(m), d: pt.d.clone().applyMatrix3(rot).normalize() };
  return { parts, ports: out };
}
const cyl = (a, b, r, segs = 24) => cylinderBetween(a, b, r, segs);
const boxAt = (w, h, d, c, rad = 0) => {
  const g = rad > 0 ? new RoundedBoxGeometry(w, h, d, 3, rad) : new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.translate(c.x, c.y, c.z);
  return g;
};
const P = (geo, mat) => ({ geo, mat });

// Zewnętrzny promień rury wg średnicy nominalnej (dla armatury gwintowanej).
export const R_DN = { 15: 10.7, 20: 13.4, 25: 16.9, 32: 21.2, 40: 24.2 };

// Rura po łamanej z łukami kolan; zwraca gęste punkty osi.
export function bendPath(points, bendR) {
  const out = [points[0].clone()];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const d1 = p1.clone().sub(p0).normalize(), d2 = p2.clone().sub(p1).normalize();
    const cos = THREE.MathUtils.clamp(d1.dot(d2), -1, 1);
    if (cos > 0.9999) { out.push(p1.clone()); continue; }
    const ang = Math.acos(cos);
    const t = Math.min(bendR * Math.tan(ang / 2), p1.distanceTo(p0) * 0.5, p2.distanceTo(p1) * 0.5);
    const r = t / Math.tan(ang / 2);
    const a = p1.clone().addScaledVector(d1, -t), b = p1.clone().addScaledVector(d2, t);
    const n = d2.clone().sub(d1.clone().multiplyScalar(cos)).normalize();
    const c = a.clone().addScaledVector(n, r);
    const va = a.clone().sub(c), vb = b.clone().sub(c);
    const ax = new V().crossVectors(va, vb).normalize();
    const steps = Math.max(5, Math.ceil(ang / (Math.PI / 18)));
    for (let k = 0; k <= steps; k++) out.push(c.clone().add(va.clone().applyAxisAngle(ax, (ang * k) / steps)));
  }
  out.push(points[points.length - 1].clone());
  return out;
}

export function pipe(points, od, mat, insul = 0, insulMat = MAT.black) {
  const path = bendPath(points, Math.max(1.5 * od, 40));
  const parts = [P(hollowTube(path, od / 2, 0, 20), mat)];
  if (insul > 0) parts.push(P(hollowTube(path, od / 2 + insul, 0, 24), insulMat));
  return { parts, path };
}

// Wąż elastyczny w oplocie (łuk S między dwoma punktami).
export function flexHose(a, da, b, db, r = 19) {
  const L = a.distanceTo(b);
  const c = new THREE.CubicBezierCurve3(a, a.clone().addScaledVector(da, L * 0.45), b.clone().addScaledVector(db, L * 0.45), b);
  const pts = c.getPoints(36);
  return {
    parts: [
      P(hollowTube(pts, r, 0, 18), MAT.chrome),
      P(merge([cyl(a.clone().addScaledVector(da, -2), a.clone().addScaledVector(da, 26), r + 10, 6), cyl(b.clone().addScaledVector(db, -2), b.clone().addScaledVector(db, 26), r + 10, 6)]), MAT.brass),
    ],
  };
}

export function ballValve({ o, axis, front = Z, dn = 32, lever = MAT.levRed, side = 1 }) {
  const r = R_DN[dn] ?? 21, L = dn >= 32 ? 96 : dn >= 25 ? 82 : 66;
  const parts = [
    P(merge([cyl(v(0, -L / 2, 0), v(0, -L / 2 + 18, 0), r + 8, 6), cyl(v(0, L / 2 - 18, 0), v(0, L / 2, 0), r + 8, 6), cyl(v(0, -L / 2 + 16, 0), v(0, L / 2 - 16, 0), r + 6, 24), cyl(v(0, 0, -r - 7), v(0, 0, r + 7), r + 7, 24), cyl(v(0, 0, r + 5), v(0, 0, r + 20), 6, 12)]), MAT.brass),
    P(boxAt(18, 110, 9, v(0, side * 38, r + 25), 3), lever),
  ];
  return finish(parts, { a: { p: v(0, -L / 2, 0), d: v(0, -1, 0) }, b: { p: v(0, L / 2, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}

export function checkValve({ o, axis, front = Z, dn = 32 }) {
  const r = R_DN[dn] ?? 21, L = 86;
  const parts = [P(merge([cyl(v(0, -L / 2, 0), v(0, L / 2, 0), r + 6, 6), cyl(v(0, -L / 2 + 14, 0), v(0, L / 2 - 14, 0), r + 8, 24)]), MAT.brass), P(arrow(v(0, -16, r + 8.5), v(0, 1, 0), 26, 6), MAT.black)];
  return finish(parts, { a: { p: v(0, -L / 2, 0), d: v(0, -1, 0) }, b: { p: v(0, L / 2, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}

function arrow(base, dir, len, w) {
  const g = new THREE.ConeGeometry(w, len, 3);
  g.deleteAttribute('uv');
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir.clone().normalize()));
  g.translate(base.x + dir.x * len * 0.5, base.y + dir.y * len * 0.5, base.z + dir.z * len * 0.5);
  return g;
}
export const flowArrow = arrow;

// Pompa obiegowa z mokrym wirnikiem: przyłącza w osi Y, wał (silnik) w stronę +Z.
export function pump({ o, axis, front = Z, L = 180, body = MAT.pumpRed }) {
  const parts = [
    P(merge([cyl(v(0, -L / 2, 0), v(0, L / 2, 0), 25, 24), cyl(v(0, 0, -38), v(0, 0, 34), 56, 36)]), MAT.cast),
    P(merge([cyl(v(0, -L / 2 - 22, 0), v(0, -L / 2, 0), 34, 6), cyl(v(0, L / 2, 0), v(0, L / 2 + 22, 0), 34, 6)]), MAT.brass),
    P(cyl(v(0, 0, 34), v(0, 0, 118), 50, 36), body),
    P(merge([cyl(v(0, 0, 118), v(0, 0, 150), 52, 36), boxAt(70, 46, 32, v(0, 52, 96), 6)]), MAT.pumpHead),
    P(arrow(v(56.5, -22, 0), v(0, 1, 0), 40, 9), MAT.white),
  ];
  return finish(parts, { a: { p: v(0, -L / 2 - 22, 0), d: v(0, -1, 0) }, b: { p: v(0, L / 2 + 22, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}
export const PUMP_DISPLAY_Z = 150;

// Sprzęgło hydrauliczne: pionowy walec, po dwa króćce z lewej (-X) i prawej (+X), odpowietrznik i spust.
export function separator({ o, H = 600, D = 114, portOff = 95, stub = 70, insul = true, wallZ = 0, arms = [0.3, -0.3] }) {
  const R = D / 2, b = 30, back = o.z - wallZ;
  const shell = latheSolid([
    ellipseArc(R, b, -H / 2 + b, -1), [[R, -H / 2 + b], [R, H / 2 - b]], ellipseArc(R, b, H / 2 - b, 1).reverse(), [[0, H / 2], [0, -H / 2]],
  ], 48);
  const ports = {}, stubs = [];
  for (const [k, sx, sy] of [['lt', -1, 1], ['lb', -1, -1], ['rt', 1, 1], ['rb', 1, -1]]) {
    const y = sy * (H / 2 - portOff);
    stubs.push(cyl(v(sx * (R - 5), y, 0), v(sx * (R + stub), y, 0), 21.2, 24), cyl(v(sx * (R + stub - 18), y, 0), v(sx * (R + stub), y, 0), 27, 6));
    ports[k] = { p: v(sx * (R + stub), y, 0), d: v(sx, 0, 0) };
  }
  const parts = [
    P(shell, insul ? MAT.black : MAT.steel),
    P(merge(stubs), MAT.chrome),
    P(merge([cyl(v(0, H / 2 - 4, 0), v(0, H / 2 + 34, 0), 15, 6), cyl(v(0, H / 2 + 34, 0), v(0, H / 2 + 62, 0), 19, 24)]), MAT.brass),
    P(cyl(v(0, H / 2 + 62, 0), v(0, H / 2 + 74, 0), 14, 18), MAT.black),
    P(merge([cyl(v(0, -H / 2 + 4, 0), v(0, -H / 2 - 70, 0), 13, 6), cyl(v(0, -H / 2 - 70, 0), v(0, -H / 2 - 92, 0), 9, 16)]), MAT.brass),
    P(boxAt(60, 12, 8, v(18, -H / 2 - 36, 16), 2), MAT.levRed),
    P(merge(arms.map((f) => merge([latheSolid([[[R + 1, f * H - 12], [R + 4, f * H - 12]], [[R + 4, f * H - 12], [R + 4, f * H + 12]], [[R + 4, f * H + 12], [R + 1, f * H + 12]], [[R + 1, f * H + 12], [R + 1, f * H - 12]]], 40), boxAt(24, 20, back - R, v(0, f * H, -(R + back) / 2), 2)]))), MAT.steel),
  ];
  return finish(parts, ports, frame(o, v(0, 1, 0)));
}

// Naczynie przeponowe na króćcu: wiszące pod przyłączem (domyślnie) albo stojące nad nim (up = true).
// clampTo – odległość osi od ściany, do której dochodzi obejma.
export function vessel({ o, D, H, mat, clampTo = 0, up = false }) {
  const R = D / 2, b = Math.min(R * 0.55, 75);
  const shell = latheSolid([
    ellipseArc(R, b, -H + b, -1), [[R, -H + b], [R, -b - 30]], ellipseArc(R, b, -b - 30, 1).reverse(), [[0, -30], [0, -H]],
  ], 64);
  const parts = [
    P(shell, mat),
    P(merge([cyl(v(0, -34, 0), v(0, 0, 0), 12, 6), cyl(v(0, -6, 0), v(0, 22, 0), 15, 6)]), MAT.brass),
    P(boxAt(26, 22, 16, v(0, 4, 18), 3), MAT.blue),
  ];
  if (clampTo > 0) {
    const y = -H * 0.48;
    parts.push(P(merge([
      latheSolid([[[R + 0.5, y - 14], [R + 3.5, y - 14]], [[R + 3.5, y - 14], [R + 3.5, y + 14]], [[R + 3.5, y + 14], [R + 0.5, y + 14]], [[R + 0.5, y + 14], [R + 0.5, y - 14]]], 64),
      boxAt(30, 24, clampTo - R, v(0, y, -(clampTo + R) / 2), 2),
    ]), MAT.steel));
  }
  return finish(parts, { top: { p: v(0, 22, 0), d: v(0, 1, 0) } }, frame(o, v(0, up ? -1 : 1, 0)));
}

// Grupa bezpieczeństwa kotłowa na konsoli: zawór bezpieczeństwa, manometr, odpowietrznik; pod spodem naczynie.
export function safetyGroup({ o, bracket = MAT.red, wallZ = 0 }) {
  const parts = [
    P(merge([cyl(v(-80, 0, 0), v(80, 0, 0), 15, 6), cyl(v(0, -30, 0), v(0, 0, 0), 14, 6)]), MAT.brass),
    P(merge([boxAt(190, 10, o.z - wallZ + 40, v(0, -22, -(o.z - wallZ) / 2 + 20), 2), boxAt(190, 120, 8, v(0, -70, -(o.z - wallZ) + 4), 2)]), bracket),
    P(merge([cyl(v(-50, 0, 0), v(-50, 50, 0), 8, 12)]), MAT.brass),
    P(merge([cyl(v(-50, 86, -10), v(-50, 86, 14), 33, 36)]), MAT.chrome),
    P(merge([cyl(v(5, 0, 0), v(5, 58, 0), 17, 24), cyl(v(5, 30, 0), v(5, 30, 42), 11, 18)]), MAT.brass),
    P(cyl(v(5, 58, 0), v(5, 82, 0), 19, 24), MAT.red),
    P(merge([cyl(v(55, 0, 0), v(55, 52, 0), 16, 24)]), MAT.brass),
    P(cyl(v(55, 52, 0), v(55, 70, 0), 12, 18), MAT.black),
  ];
  return finish(parts, {
    in: { p: v(-80, 0, 0), d: v(-1, 0, 0) }, vessel: { p: v(0, -30, 0), d: v(0, -1, 0) }, discharge: { p: v(5, 30, 42), d: v(0, 0, 1) },
    dial: { p: v(-50, 86, 14.5), d: v(0, 0, 1) },
  }, frame(o, v(0, 1, 0)));
}

// Grupa bezpieczeństwa podgrzewacza (w linii zimnej wody): zawór odcinający, zwrotny, bezpieczeństwa 6 bar, spust.
export function dhwSafetyGroup({ o, axis = v(0, -1, 0), front = Z }) {
  const parts = [
    P(merge([cyl(v(0, -70, 0), v(0, 70, 0), 21, 24), cyl(v(0, -70, 0), v(0, -54, 0), 27, 6), cyl(v(0, 54, 0), v(0, 70, 0), 27, 6), cyl(v(0, 10, 0), v(36, 10, 0), 17, 24), cyl(v(0, -30, 0), v(0, -30, 34), 10, 16)]), MAT.brass),
    P(merge([cyl(v(36, 10, 0), v(60, 10, 0), 21, 24), cyl(v(60, 10, 0), v(60, -40, 0), 12, 16)]), MAT.brass),
    P(boxAt(16, 70, 8, v(0, 40, 34), 3), MAT.levBlue),
    P(cyl(v(36, 10, 0), v(36, 10, 24), 11, 18), MAT.blue),
  ];
  return finish(parts, { a: { p: v(0, -70, 0), d: v(0, -1, 0) }, b: { p: v(0, 70, 0), d: v(0, 1, 0) }, discharge: { p: v(60, -40, 0), d: v(0, -1, 0) } }, frame(o, axis, front));
}

// Zawór trójdrogowy przełączający z siłownikiem: AB (wspólne) w -Y, A w -X, B w +X.
export function threeWay({ o, axis = v(0, 1, 0), front = Z }) {
  const parts = [
    P(merge([cyl(v(-66, 0, 0), v(66, 0, 0), 23, 24), cyl(v(0, -66, 0), v(0, 0, 0), 23, 24), cyl(v(0, 0, -26), v(0, 0, 26), 30, 24), cyl(v(-66, 0, 0), v(-50, 0, 0), 28, 6), cyl(v(50, 0, 0), v(66, 0, 0), 28, 6), cyl(v(0, -66, 0), v(0, -50, 0), 28, 6)]), MAT.brass),
    P(merge([cyl(v(0, 0, 26), v(0, 0, 44), 12, 16), boxAt(92, 92, 72, v(0, 0, 82), 8)]), MAT.pumpHead),
  ];
  return finish(parts, { ab: { p: v(0, -66, 0), d: v(0, -1, 0) }, a: { p: v(-66, 0, 0), d: v(-1, 0, 0) }, b: { p: v(66, 0, 0), d: v(1, 0, 0) } }, frame(o, axis, front));
}

// Filtr magnetyczny (korpus pionowy pod przyłączami w osi X).
export function magFilter({ o }) {
  const parts = [
    P(merge([cyl(v(-95, 0, 0), v(95, 0, 0), 22, 24), cyl(v(-95, 0, 0), v(-78, 0, 0), 28, 6), cyl(v(78, 0, 0), v(95, 0, 0), 28, 6)]), MAT.brass),
    P(cyl(v(0, -230, 0), v(0, 22, 0), 46, 36), MAT.cast),
    P(merge([cyl(v(0, 22, 0), v(0, 52, 0), 49, 36), cyl(v(0, -246, 0), v(0, -230, 0), 30, 24)]), MAT.black),
  ];
  return finish(parts, { a: { p: v(-95, 0, 0), d: v(-1, 0, 0) }, b: { p: v(95, 0, 0), d: v(1, 0, 0) } }, frame(o, v(0, 1, 0)));
}

// Filtr siatkowy skośny (w linii osi Y, odstojnik w dół i do przodu).
export function yStrainer({ o, axis, front = Z, dn = 32 }) {
  const r = R_DN[dn] ?? 21;
  const parts = [P(merge([cyl(v(0, -60, 0), v(0, 60, 0), r + 5, 24), cyl(v(0, -60, 0), v(0, -44, 0), r + 9, 6), cyl(v(0, 44, 0), v(0, 60, 0), r + 9, 6), cyl(v(0, -8, 0), v(0, -54, 44), r - 2, 20), cyl(v(0, -54, 44), v(0, -64, 54), r + 2, 6)]), MAT.brass)];
  return finish(parts, { a: { p: v(0, -60, 0), d: v(0, -1, 0) }, b: { p: v(0, 60, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}

// Separator powietrza (mikropęcherzyki) – korpus pionowy, przyłącza w osi X, odpowietrznik u góry.
export function airSeparator({ o }) {
  const parts = [
    P(merge([cyl(v(-90, 0, 0), v(90, 0, 0), 22, 24), cyl(v(-90, 0, 0), v(-74, 0, 0), 28, 6), cyl(v(74, 0, 0), v(90, 0, 0), 28, 6)]), MAT.brass),
    P(cyl(v(0, -110, 0), v(0, 80, 0), 38, 32), MAT.cast),
    P(merge([cyl(v(0, 80, 0), v(0, 115, 0), 16, 18)]), MAT.brass),
    P(cyl(v(0, 115, 0), v(0, 130, 0), 12, 16), MAT.black),
  ];
  return finish(parts, { a: { p: v(-90, 0, 0), d: v(-1, 0, 0) }, b: { p: v(90, 0, 0), d: v(1, 0, 0) } }, frame(o, v(0, 1, 0)));
}

// Zestaw do napełniania/płukania: zawór główny w linii + dwa odejścia z zaworami i końcówkami do węża.
export function fillSet({ o, axis = v(0, 1, 0), front = Z }) {
  const parts = [
    P(merge([cyl(v(0, -120, 0), v(0, 120, 0), 22, 24), cyl(v(0, -120, 0), v(0, -104, 0), 28, 6), cyl(v(0, 104, 0), v(0, 120, 0), 28, 6), cyl(v(0, 0, -26), v(0, 0, 26), 29, 24),
      ...[-80, 80].map((y) => merge([cyl(v(0, y, 0), v(0, y, 70), 14, 18), cyl(v(0, y, 70), v(0, y, 96), 10, 6)]))]), MAT.brass),
    P(merge([boxAt(18, 100, 9, v(0, 36, 34), 3), boxAt(14, 60, 7, v(0, -80 + 24, 58), 3), boxAt(14, 60, 7, v(0, 80 + 24, 58), 3)]), MAT.levRed),
  ];
  return finish(parts, { a: { p: v(0, -120, 0), d: v(0, -1, 0) }, b: { p: v(0, 120, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}

// Termostatyczny zawór mieszający: ciepła od dołu (-Y), zmieszana do góry (+Y), zimna z boku (side = 1 → +X, -1 → -X).
export function mixingValve({ o, side = 1 }) {
  const parts = [
    P(merge([cyl(v(0, -62, 0), v(0, 62, 0), 20, 24), cyl(v(0, 0, 0), v(62 * side, 0, 0), 18, 24), cyl(v(0, 0, -24), v(0, 0, 24), 27, 24),
      cyl(v(0, -62, 0), v(0, -48, 0), 26, 6), cyl(v(0, 48, 0), v(0, 62, 0), 26, 6), cyl(v(48 * side, 0, 0), v(62 * side, 0, 0), 24, 6)]), MAT.brass),
    P(cyl(v(0, 0, 24), v(0, 0, 52), 24, 24), MAT.levBlue),
  ];
  return finish(parts, { hot: { p: v(0, -62, 0), d: v(0, -1, 0) }, mix: { p: v(0, 62, 0), d: v(0, 1, 0) }, cold: { p: v(62 * side, 0, 0), d: v(side, 0, 0) } }, frame(o, v(0, 1, 0)));
}

// Reduktor ciśnienia z manometrem (w linii osi Y).
export function reducer({ o, axis, front = Z }) {
  const parts = [
    P(merge([cyl(v(0, -66, 0), v(0, 66, 0), 22, 24), cyl(v(0, -66, 0), v(0, -50, 0), 28, 6), cyl(v(0, 50, 0), v(0, 66, 0), 28, 6), cyl(v(0, 0, -20), v(0, 0, 40), 34, 32)]), MAT.brass),
    P(cyl(v(0, 0, 40), v(0, 0, 70), 26, 24), MAT.blue),
  ];
  return finish(parts, { a: { p: v(0, -66, 0), d: v(0, -1, 0) }, b: { p: v(0, 66, 0), d: v(0, 1, 0) } }, frame(o, axis, front));
}

// Lejek ze syfonem pod wyrzut zaworu bezpieczeństwa i odpływ do kanalizacji (do podłogi).
export function funnel({ o, floorY = 0 }) {
  const cone = new THREE.CylinderGeometry(34, 14, 60, 24, 1, false);
  cone.deleteAttribute('uv');
  cone.translate(o.x, o.y, o.z);
  return { parts: [P(cone, MAT.white), P(hollowTube(bendPath([v(o.x, o.y - 30, o.z), v(o.x, floorY + 40, o.z), v(o.x, floorY + 40, o.z - 60)], 40), 16, 0, 16), MAT.plastic)] };
}

// Kanister na wyrzut glikolu z zaworu bezpieczeństwa dolnego źródła.
export function canister({ o }) {
  return { parts: [P(boxAt(170, 230, 110, o.clone().add(v(0, 115, 0)), 12), MAT.white), P(cyl(o.clone().add(v(40, 230, 0)), o.clone().add(v(40, 252, 0)), 18, 18), MAT.levBlue)] };
}

// Tarcza manometru / termometru jako płaskie koło do teksturowania.
export function dialDisc(pos, normal, r) {
  const g = new THREE.CircleGeometry(r, 40);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, normal.clone().normalize()));
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// Termometr tarczowy na tulei (od rury w stronę +Z).
export function thermometer({ o, pipeR = 25 }) {
  const parts = [P(cyl(o.clone().add(v(0, 0, pipeR - 4)), o.clone().add(v(0, 0, pipeR + 30)), 7, 12), MAT.brass), P(cyl(o.clone().add(v(0, 0, pipeR + 30)), o.clone().add(v(0, 0, pipeR + 48)), 33, 36), MAT.chrome)];
  return { parts, dial: { p: o.clone().add(v(0, 0, pipeR + 48.5)), d: v(0, 0, 1) } };
}

// Obejma rury z kołkiem do ściany.
export function clamp(pos, r, wallZ = 0) {
  const ring = latheSolid([[[r + 0.5, -9], [r + 4, -9]], [[r + 4, -9], [r + 4, 9]], [[r + 4, 9], [r + 0.5, 9]], [[r + 0.5, 9], [r + 0.5, -9]]], 32);
  ring.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return merge([ring.translate(pos.x, pos.y, pos.z), cyl(v(pos.x, pos.y, wallZ), v(pos.x, pos.y, pos.z - r - 2), 6, 12)]);
}

export function roundedBox(w, h, d, c, rad) { return boxAt(w, h, d, c, rad); }
