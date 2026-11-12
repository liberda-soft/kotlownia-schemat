import * as THREE from 'three';
import { latheSolid, ellipseArc, hollowTube, smoothPath, cylinderBetween, merge, recessWall } from './geom.js';

// Model zasobnika SUNEX FISH S15 300 („ZASOBNIK TYPU MAXI 1xWS 300 LITRÓW EMALIA POLIURETAN SKAY”,
// 06/2017, nr S15-0160). Jednostki: mm, oś Y w górę, 0 = podłoga – Sunex podaje wysokości od podłogi.
// Przód (+Z): termometr i otwór rewizyjny z grzałką. Tył: dwie kolumny przyłączy – woda naprzeciw
// rewizji (φ = 180°) i pompa ciepła obok (φ = 135°), między nimi zamek płaszcza. φ liczone od przodu w stronę +X.
// Źródła: karta Sunex FISH S15 X (08/02/2022), tabliczka zasobnika (2017), zdjęcie przyłączy.

const V = THREE.Vector3;
export const P = (r, phi, y) => new V(r * Math.sin(phi), y, r * Math.cos(phi));
export const W_PHI = Math.PI, PC_PHI = (3 * Math.PI) / 4;
const ZIP_PHI = (W_PHI + PC_PHI) / 2;
const radialAxis = (phi) => new V(Math.sin(phi), 0, Math.cos(phi));

export const DIM = {
  L: 1500, yJb: 45, R: 325, Rj: 323.5, Rs: 275, Rsi: 272, Rei: 271,
  yBk: 220, yBa: 105, yTk: 1330, yTa: 1442, floor: 0,
};

// Wysokości osi przyłączy od podłogi (karta Sunex FISH S15 300 X); można je nadpisać własnymi pomiarami.
export const H_DEFAULT = { h1: 74, h2: 272, h3: 263, h4: 547, h6: 884, h7: 1032, h8: 1246, h9: 1229, h11: 1138, h12: 387 };
export const H = { ...H_DEFAULT };
export const MEASURED = new Set();
export const H_LABELS = {
  h9: 'h9 – ciepła woda', h8: 'h8 – pompa ciepła, zasilanie', h11: 'h11 – termometr (przód)', h7: 'h7 – tuleja „Termostat”',
  h6: 'h6 – cyrkulacja', h4: 'h4 – tuleja „Czujnik”', h12: 'h12 – oś rewizji (przód)', h2: 'h2 – zimna woda', h3: 'h3 – pompa ciepła, powrót',
};
export function setMeasurements(over) {
  for (const [k, v] of Object.entries(over)) {
    if (k in H_LABELS && Number.isFinite(v) && v >= 150 && v <= 1420) {
      H[k] = Math.round(v);
      MEASURED.add(k);
    }
  }
}
export const heightChips = () => [
  ['h1 spust', H.h1], ['h3 powrót PC', H.h3], ['h2 zimna', H.h2], ['rewizja', H.h12], ['h4 czujnik', H.h4],
  ['h6 cyrk.', H.h6], ['h7 termostat', H.h7], ['h11 termometr', H.h11], ['h9 c.w.u.', H.h9], ['h8 zasil. PC', H.h8],
].sort((a, b) => a[1] - b[1]);

const M = {
  jacket: { color: 0x9aa1a9, cap: 0x7b838c, rough: 0.75 },
  black: { color: 0x1f2124, cap: 0x3b3e43, rough: 0.6 },
  foam: { color: 0xe3bd55, cap: 0xf0d07a, rough: 1 },
  steel: { color: 0x6c737c, cap: 0xbcc3cb, metal: 0.6, rough: 0.42 },
  enamel: { color: 0x1f3d73, cap: 0x3d70c9, metal: 0.05, rough: 0.22 },
  coil: { color: 0x2b4f86, cap: 0xbcc3cb, metal: 0.2, rough: 0.3 },
  pipe: { color: 0xa3abb4, cap: 0xc9cfd6, metal: 0.65, rough: 0.33 },
  mg: { color: 0xc5c9cd, cap: 0xe6e8ea, metal: 0.25, rough: 0.75 },
  core: { color: 0x50565d, cap: 0x7b828a, metal: 0.6, rough: 0.4 },
  rubber: { color: 0x1c1d20, cap: 0x3a3c42, rough: 0.9 },
  plastic: { color: 0xe4e6e9, cap: 0xcdd1d6, rough: 0.55 },
  dark: { color: 0x3a3e44, cap: 0x5d6269, metal: 0.45, rough: 0.5 },
  brass: { color: 0xc8a24a, cap: 0xe3c77d, metal: 0.75, rough: 0.35 },
  white: { color: 0xf1f2f4, cap: 0xd3d8de, metal: 0.1, rough: 0.45 },
  red: { color: 0xd9342b, cap: 0xe8645d, rough: 0.5 },
  water: { color: 0x6faeff, cap: 0x9cc8ff, rough: 0.2 },
};
const part = (geo, mat, extra = {}) => ({ geo, ...mat, ...extra });

const radial = (phi, y, r0, r1, od, id, radialSegs = 28) => hollowTube([P(r1, phi, y), P(r0, phi, y)], od / 2, id / 2, radialSegs);
const alongZ = (y, z0, z1, od, id, segs = 48) => hollowTube([new V(0, y, z0), new V(0, y, z1)], od / 2, id / 2, segs);
const vertical = (y0, y1, od, id, segs = 36) => hollowTube([new V(0, y0, 0), new V(0, y1, 0)], od / 2, id / 2, segs);

// Powłoka naczynia (walec z dennicami, oś Y) z otworem przyłącza w dolnej dennicy.
function vesselShell(R, th, bBot, bTop, yk1, yk2, holeR) {
  const outer = ellipseArc(R, bBot, yk1, -1, Math.asin(holeR / R), Math.PI / 2, 20);
  const inner = ellipseArc(R - th, bBot - th, yk1, -1, Math.asin(holeR / (R - th)), Math.PI / 2, 20).reverse();
  return latheSolid([
    outer, [[R, yk1], [R, yk2]], ellipseArc(R, bTop, yk2, 1, 0, Math.PI / 2, 20).reverse(),
    [[0, yk2 + bTop], [0, yk2 + bTop - th]],
    ellipseArc(R - th, bTop - th, yk2, 1, 0, Math.PI / 2, 20), [[R - th, yk2], [R - th, yk1]],
    inner, [[holeR, inner[inner.length - 1][1]], [holeR, outer[0][1]]],
  ], 96);
}

// Woda wypełniająca wnętrze takiej powłoki (zamknięta płaskim denkiem nad otworem).
function vesselWater(R, bBot, bTop, yk1, yk2, holeR) {
  const bottom = ellipseArc(R, bBot, yk1, -1, Math.asin(holeR / R), Math.PI / 2, 20);
  const y0 = bottom[0][1];
  return latheSolid([
    [[0, y0], [holeR, y0]], bottom, [[R, yk1], [R, yk2]],
    ellipseArc(R, bTop, yk2, 1, 0, Math.PI / 2, 20).reverse(), [[0, yk2 + bTop], [0, y0]],
  ], 96);
}

// Wężownica: przy 3,6 m² z rury Ø33,7 wychodzi ok. 34 m rury, więc przyjęto dwie współosiowe spirale
// (jak w innych zasobnikach do pomp ciepła): zasilanie h8 → spirala zewnętrzna w dół → wewnętrzna w górę
// → rura środkowa w dół → powrót h3. Przebieg wewnątrz jest orientacyjny.
function coilPath() {
  const rO = 205, rI = 148, turns = 14.5, step = THREE.MathUtils.degToRad(12), s = PC_PHI;
  const yTop = Math.min(H.h8 - 40, 1215), yBot = Math.max(H.h12 + 95, 470);
  const pts = [P(305, s, H.h8), P(272, s, H.h8), P(246, s, H.h8 - 3), P(222, s + 0.14, yTop + 12)];
  const helix = (r, f0, f1, y0, y1) => {
    const k = Math.round(Math.abs(f1 - f0) / step);
    for (let i = 0; i <= k; i++) {
      const u = i / k;
      pts.push(P(r, f0 + (f1 - f0) * u, y0 + (y1 - y0) * u));
    }
  };
  const f0 = s + 0.36, f1 = f0 + turns * 2 * Math.PI;
  helix(rO, f0, f1, yTop, yBot);
  pts.push(P(rO - 20, f1 + 0.17, yBot), P(rI + 18, f1 + 0.31, yBot));
  const g0 = f1 + 0.47, g1 = g0 + turns * 2 * Math.PI, yIn = yTop - 15;
  helix(rI, g0, g1, yBot, yIn);
  const fc = g1 + 0.53, yR = Math.max(H.h3 + 40, 290);
  pts.push(P(122, g1 + 0.22, yIn + 13), P(100, g1 + 0.4, yIn + 9), P(88, g1 + 0.5, yIn - 7), P(85, fc, yIn - 32));
  for (let y = yIn - 80; y > yR + 25; y -= 60) pts.push(P(85, fc, y));
  pts.push(
    P(87, fc - 0.05, yR), P(112, fc - 0.3, yR - 12), P(150, fc - 0.65, yR - 22),
    P(195, s + 0.32, H.h3 + 8), P(232, s + 0.06, H.h3 + 1), P(262, s, H.h3), P(305, s, H.h3),
  );
  return smoothPath(pts, 12);
}

export function buildModel() {
  const { L, yJb, R, Rj, Rs, Rsi, Rei, yBk, yBa, yTk, yTa } = DIM;
  const bo = yBk - yBa, to = yTa - yTk, t = Rs - Rsi, te = Rsi - Rei;
  const yG = H.h12 + 15, yAn = H.h12 - 35; // mufa grzałki i trzpień anody na pokrywie (rozstaw jak w FISH S16)
  const hp = (k, label = 'Wysokość od podłogi') => [label, `${H[k]} mm`, MEASURED.has(k) ? 'meas' : 'p'];

  // Otwory w warstwach (płaszcz, pianka, stal, emalia) w miejscach przejść króćców.
  const bores = { jacket: [], foam: [], steel: [], enamel: [] };
  const ALL = ['jacket', 'foam', 'steel', 'enamel'];
  const addBore = (layers, a, b, r) => layers.forEach((l) => bores[l].push({ a, b, r }));
  const sideBore = (phi, y, od) => addBore(ALL, P(200, phi, y), P(372, phi, y), od / 2 + 0.3);
  sideBore(W_PHI, H.h9, 42); sideBore(W_PHI, H.h7, 21.3); sideBore(W_PHI, H.h4, 21.3); sideBore(W_PHI, H.h2, 42);
  sideBore(PC_PHI, H.h8, 42); sideBore(PC_PHI, H.h6, 34); sideBore(PC_PHI, H.h3, 42);
  sideBore(0, H.h11, 28);
  addBore(['jacket', 'foam'], new V(0, H.h12, 150), new V(0, H.h12, 372), 112);
  addBore(['steel', 'enamel'], new V(0, H.h12, 200), new V(0, H.h12, 300), 72.8);
  addBore(ALL, new V(0, 1380, 0), new V(0, 1560, 0), 30.3);
  addBore(['foam'], new V(0, 20, 0), new V(0, 112, 0), 45);
  addBore(['steel', 'enamel'], new V(0, 80, 0), new V(0, 130, 0), 30.3);

  const jacket = latheSolid([[[Rj, yJb], [R, yJb]], [[R, yJb], [R, L - 10]], [[R, L - 10], [Rj, L - 10]], [[Rj, L - 10], [Rj, yJb]]]);
  const lid = latheSolid([
    [[0, L - 10], [R, L - 10]], [[R, L - 10], [R, L - 40]], [[R, L - 40], [R + 2.5, L - 40]],
    [[R + 2.5, L - 40], [R + 2.5, L]], [[R + 2.5, L], [0, L]], [[0, L], [0, L - 10]],
  ]);
  const band = latheSolid([[[R, yJb], [R + 2.5, yJb]], [[R + 2.5, yJb], [R + 2.5, yJb + 30]], [[R + 2.5, yJb + 30], [R, yJb + 30]], [[R, yJb + 30], [R, yJb]]]);
  const zipper = cylinderBetween(P(R + 1.2, ZIP_PHI, yJb + 30), P(R + 1.2, ZIP_PHI, L - 40), 4.5, 4);
  const foam = latheSolid([
    [[0, yJb], [Rj, yJb]], [[Rj, yJb], [Rj, L - 10]], [[Rj, L - 10], [0, L - 10]], [[0, L - 10], [0, yTa]],
    ellipseArc(Rs, to, yTk, 1), [[Rs, yTk], [Rs, yBk]], ellipseArc(Rs, bo, yBk, -1).reverse(), [[0, yBa], [0, yJb]],
  ]);
  const shell = (ao, ai, bOut, tOut, th) => latheSolid([
    ellipseArc(ao, bOut, yBk, -1), [[ao, yBk], [ao, yTk]], ellipseArc(ao, tOut, yTk, 1).reverse(),
    [[0, yTk + tOut], [0, yTk + tOut - th]],
    ellipseArc(ai, tOut - th, yTk, 1), [[ai, yTk], [ai, yBk]], ellipseArc(ai, bOut - th, yBk, -1).reverse(),
    [[0, yBk - bOut + th], [0, yBk - bOut]],
  ]);
  const steel = shell(Rs, Rsi, bo, to, t);
  const enamel = shell(Rsi, Rei, bo - t, to - t, te);
  const lugs = merge([0, Math.PI].map((f) => {
    const c = P(230, f, yTk + to * Math.sqrt(1 - (230 / Rs) ** 2) + 21), tan = new V(Math.cos(f), 0, -Math.sin(f));
    return hollowTube([c.clone().addScaledVector(tan, -4), c.clone().addScaledVector(tan, 4)], 22, 9, 24);
  }));

  const wa = Rei - 0.5, wb = bo - t - te - 0.5, wt = to - t - te - 0.5;
  const water = latheSolid([
    ellipseArc(wa, wb, yBk, -1), [[wa, yBk], [wa, yTk]], ellipseArc(wa, wt, yTk, 1).reverse(), [[0, yTk + wt], [0, yBk - wb]],
  ], 96);
  {
    // kolor wody wg temperatury: zimna na dole, gorąca pod górną dennicą
    const pos = water.attributes.position, col = [], cold = new THREE.Color(0x3d8bfd), hot = new THREE.Color(0xff5436), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const u = THREE.MathUtils.clamp((pos.getY(i) - 200) / 1200, 0, 1);
      c.copy(cold).lerp(hot, u * u * (3 - 2 * u));
      col.push(c.r, c.g, c.b);
    }
    water.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  const coil = coilPath();
  const els = [];
  const el = (o) => { const e = { visible: true, params: [], decor: [], ...o }; els.push(e); return e; };
  const sock = (phi, y, od, id) => radial(phi, y, 268, 352, od, id);
  const rosette = (phi, y, od) => part(radial(phi, y, R - 1.5, R + 1.5, od + 36, od + 1, 36), M.rubber);
  const sleeve = (phi, y) => merge([radial(phi, y, 232, 352, 21.3, 16), cylinderBetween(P(232, phi, y), P(235, phi, y), 10.65, 20)]);
  const legPhis = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  const bolts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8, x = 77.5 * Math.cos(a), y = H.h12 + 77.5 * Math.sin(a);
    bolts.push(cylinderBetween(new V(x, y, 295), new V(x, y, 322), 5, 12), cylinderBetween(new V(x, y, 322), new V(x, y, 329), 9.5, 6));
  }
  const pin = [];
  for (let z = 300; z >= 40; z -= 26) pin.push(new V(-14, yG, z));
  for (let k = 1; k < 8; k++) { const a = (Math.PI * k) / 8; pin.push(new V(-14 * Math.cos(a), yG, 40 - 14 * Math.sin(a))); }
  for (let z = 40; z <= 300; z += 26) pin.push(new V(14, yG, z));
  const access = Math.round(new V(0, H.h12 - 30, 300).distanceTo(new V(0, yBa + 10, 32)) / 10);

  el({
    id: 'plaszcz', no: 1, group: 'Konstrukcja', name: 'Płaszcz PVC (skay) z zamkiem', short: 'Ø650, wymienny',
    anchor: new V(0, 1000, R),
    parts: [part(jacket, M.jacket, { bores: 'jacket' }), part(lid, M.black, { bores: 'jacket' }), part(band, M.black), part(zipper, M.rubber)],
    desc: 'Wymienny płaszcz z folii PVC zapinany na zamek, z czarną pokrywą górną i obrzeżem na dole. Pod nim jest sztywna pianka przyklejona do zbiornika. Płaszcz nie jest szczelny – woda spod pianki wychodzi najniżej.',
    params: [['Średnica z izolacją', 'Ø 650 mm (tabliczka)', 'p'], ['Wysokość', '1500 mm (tabliczka)', 'p'], ['Materiał', 'folia PVC (skay), wymienna', 'p'], ['Zamek', 'między kolumnami przyłączy (zdjęcie)', 'est']],
  });
  el({
    id: 'izolacja', no: 2, group: 'Konstrukcja', name: 'Izolacja – sztywna pianka PU', short: '50 mm, także pod dnem',
    anchor: new V(0, 800, 300), parts: [part(foam, M.foam, { bores: 'foam' }), part(recessWall(H.h12, 112, 113.6, Rs, Rj), M.foam)],
    desc: 'Twarda pianka poliuretanowa bez freonu, przyklejona do zbiornika – także pod dolną dennicą, gdzie ma otwór na spust. Woda z nieszczelności płynie po stali w dół, zbiera się na dnie i może wyjść właśnie tym otworem. Miejsce kapania nie musi być miejscem dziury.',
    params: [['Grubość', '50 mm', 'p'], ['Materiał', 'twarda pianka PU bez freonu', 'p'], ['Pod dnem', '≈ 60 mm, z otworem na spust (rysunek)', 'est']],
  });
  el({
    id: 'zbiornik', no: 3, group: 'Konstrukcja', name: 'Zbiornik stalowy S235JR', short: 'Ø550, emaliowany',
    anchor: new V(0, 640, Rs - 1.5), parts: [part(steel, M.steel, { bores: 'steel' }), part(lugs, M.steel)],
    desc: 'Zbiornik ciśnieniowy z blachy S235JR spawanej automatycznie, z dwiema wyoblonymi dennicami. Na górnej dennicy są dwa uszy transportowe.',
    params: [['Średnica bez izolacji', 'Ø 550 mm', 'p'], ['Materiał', 'stal S235JR', 'p'], ['Grubość blachy', '≈ 3 mm (brak w karcie)', 'est'], ['Pojemność', '300 l (tabliczka)', 'p'], ['Ciśnienie maks. / próbne', '10 / 15 bar (tabliczka)', 'p'], ['Temperatura maks.', '95 °C (tabliczka)', 'p'], ['Waga pustego', '131 kg (karta 2022)', 'p']],
    leak: 'Bez anody stal rdzewieje w porach emalii – najszybciej na dnie pod osadem i przy spawach króćców.',
  });
  el({
    id: 'emalia', no: 4, group: 'Konstrukcja', name: 'Emalia (wewnątrz)', short: 'wg DIN 4753',
    anchor: new V(0, 520, Rei + 0.5), parts: [part(enamel, M.enamel, { bores: 'enamel' })],
    desc: 'Szkliwo wypalane na wewnętrznej powierzchni zbiornika, oddziela stal od wody. Pory i mikropęknięcia emalii chroni anoda. Bez anody stal zaczyna w nich rdzewieć.',
    params: [['Norma', 'DIN 4753 (karta)', 'p'], ['Grubość rzeczywista', 'ok. 0,2–0,5 mm (typowo)', 'est'], ['Grubość w modelu', '1 mm (pogrubiona)', 'est']],
  });
  el({
    id: 'wezownica', no: 5, group: 'Konstrukcja', name: 'Wężownica do pompy ciepła', short: '3,6 m², płyn PG',
    anchor: new V(0, 760, 205), parts: [part(hollowTube(coil.pts, 16.85, 13.65, 14), M.coil)],
    desc: 'Wymiennik z rury stalowej S235JR dla pompy ciepła. Woda z glikolem wchodzi górnym króćcem (zasilanie, h8) i wychodzi dolnym (powrót, h3). Przy tej powierzchni rury jest ok. 34 m, więc najpewniej to dwie współosiowe spirale. Przebieg wewnątrz jest orientacyjny.',
    params: [['Powierzchnia', '3,6 m² (tabliczka; karta 2022: 3,2 m²)', 'p'], ['Płyn roboczy', 'PG – glikol propylenowy (tabliczka)', 'p'], ['Ciśnienie / temp. maks.', '16 bar / 110 °C', 'p'], ['Moc 80/10/45 °C', '83 kW (karta 2022)', 'p'], ['Rura', '≈ Ø33,7 × 3,2 mm (z 3,2 m² i 17,6 l w karcie)', 'calc'], ['Długość rury w modelu', `≈ ${(coil.length / 1000).toFixed(1).replace('.', ',')} m`, 'calc']],
    leak: 'Dziurawa wężownica nie kapie na zewnątrz. Widać to po ubytku glikolu w obiegu pompy ciepła albo po glikolu w wodzie użytkowej.',
  });

  el({
    id: 'cwu', no: 6, group: 'Tył – kolumna wody (prawa na zdjęciu)', name: 'Ciepła woda', short: `Rp 1", h9 = ${H.h9} mm`, anchor: P(345, W_PHI, H.h9),
    parts: [
      part(merge([sock(W_PHI, H.h9, 42, 33.2), hollowTube(smoothPath([P(270, W_PHI, H.h9), P(240, W_PHI, H.h9), P(210, W_PHI, H.h9 + 33), P(70, W_PHI, Math.min(H.h9 + 163, 1392))], 6).pts, 16.85, 13.65, 20)]), M.pipe),
      rosette(W_PHI, H.h9, 42),
    ],
    desc: 'Wyjście ciepłej wody do kranów. W środku rurka wznosi się pod górną dennicę i pobiera najcieplejszą wodę.',
    params: [hp('h9'), ['Gwint', 'Rp 1"', 'p'], ['Położenie', 'tył, naprzeciw rewizji (rysunek, zdjęcie)', 'est']],
  });
  el({
    id: 'termostat', no: 7, group: 'Tył – kolumna wody (prawa na zdjęciu)', name: 'Tuleja czujnika „Termostat”', short: `Rp ½", h7 = ${H.h7} mm`, anchor: P(345, W_PHI, H.h7),
    parts: [part(sleeve(W_PHI, H.h7), M.pipe), part(cylinderBetween(P(338, W_PHI, H.h7), P(362, W_PHI, H.h7), 11, 6), M.plastic), rosette(W_PHI, H.h7, 21.3)],
    desc: 'Zaślepiona tuleja na czujnik, u Ciebie z dławnicą kablową i opisem „Termostat”. Czujnik wsuwa się do środka i nie ma kontaktu z wodą.',
    params: [hp('h7'), ['Gwint', 'Rp ½"', 'p'], ...(MEASURED.has('h7') ? [] : [['Na zdjęciu', 'wygląda na wyżej, ok. 1100–1150 mm – zmierz', 'est']])],
  });
  el({
    id: 'czujnik', no: 8, group: 'Tył – kolumna wody (prawa na zdjęciu)', name: 'Tuleja czujnika „Czujnik”', short: `Rp ½", h4 = ${H.h4} mm`, anchor: P(345, W_PHI, H.h4),
    parts: [part(sleeve(W_PHI, H.h4), M.pipe), rosette(W_PHI, H.h4, 21.3)],
    desc: 'Dolna tuleja na czujnik temperatury wody. Karta 2022 podaje jeszcze trzecią tuleję (h5 = 795 mm), której nie widać na Twoim zdjęciu.',
    params: [hp('h4'), ['Gwint', 'Rp ½"', 'p']],
    leak: 'Na zdjęciu tuż obok tego króćca jest plama rdzy na płaszczu.',
  });
  el({
    id: 'zimna', no: 9, group: 'Tył – kolumna wody (prawa na zdjęciu)', name: 'Zimna woda', short: `Rp 1", h2 = ${H.h2} mm`, anchor: P(345, W_PHI, H.h2),
    parts: [
      part(merge([sock(W_PHI, H.h2, 42, 33.2), hollowTube(smoothPath([P(270, W_PHI, H.h2), P(228, W_PHI, H.h2), P(204, W_PHI, H.h2 - 8), P(193, W_PHI, H.h2 - 24)], 4).pts, 16.85, 13.65, 20)]), M.pipe),
      rosette(W_PHI, H.h2, 42),
    ],
    desc: 'Wlot wody z wodociągu, rurka w środku kieruje zimną wodę w dół. Na tej rurze montuje się zawór bezpieczeństwa i naczynie przeponowe c.w.u.',
    params: [hp('h2'), ['Gwint', 'Rp 1"', 'p']],
    leak: 'Spaw króćca leży nisko, blisko osadu na dnie.',
  });
  el({
    id: 'pcZas', no: 10, group: 'Tył – kolumna pompy ciepła (lewa na zdjęciu)', name: 'Pompa ciepła – zasilanie', short: `Rp 1", h8 = ${H.h8} mm`, anchor: P(345, PC_PHI, H.h8),
    parts: [part(sock(PC_PHI, H.h8, 42, 33.2), M.pipe), rosette(PC_PHI, H.h8, 42)],
    desc: 'Wejście gorącego czynnika z pompy ciepła do wężownicy.',
    params: [hp('h8'), ['Gwint', 'Rp 1"', 'p'], ['Położenie', '45° od kolumny wody (rysunek, zdjęcie)', 'est']],
  });
  el({
    id: 'cyrkulacja', no: 11, group: 'Tył – kolumna pompy ciepła (lewa na zdjęciu)', name: 'Cyrkulacja', short: `Rp ¾", h6 = ${H.h6} mm`, anchor: P(345, PC_PHI, H.h6),
    parts: [part(sock(PC_PHI, H.h6, 34, 26.4), M.pipe), rosette(PC_PHI, H.h6, 34)],
    desc: 'Powrót z pętli cyrkulacyjnej c.w.u. Gdy cyrkulacji nie ma, przyłącze jest zakorkowane.',
    params: [hp('h6'), ['Gwint', 'Rp ¾"', 'p'], ...(MEASURED.has('h6') ? [] : [['Na zdjęciu', 'wygląda na wyżej, ok. 1000–1050 mm – zmierz', 'est']])],
    leak: 'Na zdjęciu od tego króćca biegnie w dół płaszcza rdzawy zaciek – sprawdź jego połączenie i spaw.',
  });
  el({
    id: 'pcPow', no: 12, group: 'Tył – kolumna pompy ciepła (lewa na zdjęciu)', name: 'Pompa ciepła – powrót', short: `Rp 1", h3 = ${H.h3} mm`, anchor: P(345, PC_PHI, H.h3),
    parts: [part(sock(PC_PHI, H.h3, 42, 33.2), M.pipe), rosette(PC_PHI, H.h3, 42)],
    desc: 'Wyjście czynnika z wężownicy z powrotem do pompy ciepła.',
    params: [hp('h3'), ['Gwint', 'Rp 1"', 'p']],
    leak: 'Spaw przejścia rury wężownicy przez ściankę, nisko nad dnem.',
  });

  el({
    id: 'termometr', no: 13, group: 'Przód', name: 'Termometr', short: `Rp ½", h11 = ${H.h11} mm`, anchor: P(351, 0, H.h11),
    parts: [
      part(merge([radial(0, H.h11, 268, 334, 28, 21.3), cylinderBetween(P(232, 0, H.h11), P(300, 0, H.h11), 4, 12)]), M.pipe),
      part(cylinderBetween(P(332, 0, H.h11), P(348, 0, H.h11), 31.5, 40), M.plastic),
      part(radial(0, H.h11, 332, 351, 69, 61, 40), M.dark),
    ],
    decor: [{ kind: 'dial', pos: P(348.4, 0, H.h11), r: 30 }],
    desc: 'Termometr tarczowy z przodu, nad otworem rewizyjnym.',
    params: [hp('h11'), ['Gwint', 'Rp ½"', 'p']],
  });
  el({
    id: 'rewizja', no: 14, group: 'Przód', name: 'Otwór rewizyjny – kołnierz z pokrywą', short: 'Ø125 / Ø180, mufa 6/4"', anchor: new V(0, H.h12 + 72, 318),
    parts: [
      part(merge([alongZ(H.h12, 255, 295, 145, 125), alongZ(H.h12, 295, 307, 180, 125, 64)]), M.steel),
      part(merge([cylinderBetween(new V(0, H.h12, 310), new V(0, H.h12, 322), 90, 64), alongZ(yG, 322, 338, 60, 47.8, 40)]), M.steel),
      part(merge(bolts), M.dark),
    ],
    desc: 'Otwór do czyszczenia zbiornika z osadu. W pokrywie jest mufa 6/4" na grzałkę – w karcie „Revisionsöffnung/Heizmuffe” mają tę samą wysokość. Według karty S15 na pokrywie nie ma anody.',
    params: [['Otwór / kołnierz', 'Ø125 / Ø180 mm', 'p'], hp('h12', 'Wysokość osi'), ['Mufa grzałki', 'Rp 1½" (6/4")', 'p'], ['Śruby', '8 szt.', 'est']],
  });
  el({
    id: 'uszczelka', no: 15, group: 'Przód', name: 'Uszczelka rewizji', short: 'kołnierz – pokrywa', anchor: new V(0, H.h12 - 64, 308.5),
    parts: [part(alongZ(H.h12, 307, 310, 140, 127, 64), M.rubber)],
    desc: 'Płaska uszczelka między kołnierzem a pokrywą. Z wiekiem twardnieje i pęka. Wymieniaj ją przy każdym otwieraniu rewizji.',
    params: [['Wymiary w modelu', 'Ø140 / Ø127 × 3 mm', 'est']],
    leak: 'Po zdjęciu pokrywy sprawdź, czy woda nie sączyła się spod uszczelki.',
  });
  el({
    id: 'grzalka', no: 16, group: 'Przód', name: 'Grzałka elektryczna 6/4" w pokrywie', short: 'tak było u Ciebie', anchor: new V(0, yG, 392),
    variant: { group: 'flange', keys: ['grzalka', 'grzalkaAnoda'] },
    parts: [
      part(merge([cylinderBetween(new V(0, yG, 300), new V(0, yG, 338), 23.6, 32), cylinderBetween(new V(0, yG, 338), new V(0, yG, 350), 35, 6)]), M.brass),
      part(cylinderBetween(new V(0, yG, 350), new V(0, yG, 396), 34, 32), M.white),
      part(cylinderBetween(new V(0, yG, 396), new V(0, yG, 404), 14, 24), M.dark),
      part(hollowTube(smoothPath(pin, 4).pts, 4.25, 0, 10), M.pipe),
    ],
    desc: 'Grzałka wkręcona w mufę 6/4" pokrywy rewizji – tak było w Twoim zasobniku i zgadza się to z kartą S15. Sprawdź materiał osłony grzałki: miedziana w zbiorniku bez anody przyspiesza rdzewienie stali.',
    params: [['Gwint', 'G 1½" (6/4")', 'p'], ['Długość w modelu', '≈ 300 mm', 'est'], ['Mufa nad osią rewizji', '≈ 15 mm (jak w FISH S16)', 'est']],
    leak: 'Uszczelnienie gwintu grzałki potrafi sączyć – woda spływa wtedy pod pianką na dno.',
  });
  el({
    id: 'korekG', no: 17, group: 'Przód', name: 'Korek mufy grzałki', short: 'gdy bez grzałki', anchor: new V(0, yG, 346), visible: false,
    variant: { group: 'flange', keys: ['zaslepka'] },
    parts: [part(merge([cylinderBetween(new V(0, yG, 300), new V(0, yG, 338), 23.6, 32), cylinderBetween(new V(0, yG, 338), new V(0, yG, 349), 35, 6)]), M.dark)],
    desc: 'Korek 6/4" zamykający mufę, gdy grzałka nie jest zamontowana.',
    params: [['Gwint', 'G 1½" (6/4")', 'p']],
  });
  el({
    id: 'anodaR', no: 18, group: 'Przód', name: 'Anoda na pokrywie M8 (do rozważenia)', short: 'jak w FISH S16', anchor: new V(0, yAn, 200), visible: false,
    variant: { group: 'flange', keys: ['grzalkaAnoda'] },
    parts: [part(cylinderBetween(new V(0, yAn, 105), new V(0, yAn, 308), 16.5, 28), M.mg), part(cylinderBetween(new V(0, yAn, 110), new V(0, yAn, 312), 4, 12), M.core)],
    desc: 'Możliwe ulepszenie: pokrywa z mufą grzałki i trzpieniem M8 na anodę, jak w siostrzanym FISH S16 (otwór 122/179 mm). Daje drugą anodę tuż nad dnem, gdzie był przeciek. Czy pasuje do S15, potwierdź w Sunex.',
    params: [['Mocowanie', 'trzpień M8 (instrukcja S16)', 'p'], ['Wysokość', `≈ ${yAn} mm (35 mm pod osią, jak w S16)`, 'est'], ['Wymiar w modelu', 'Ø33 × 200 mm', 'est']],
  });

  el({
    id: 'mufaG', no: 19, group: 'Góra – mufa Rp 1½"', name: 'Mufa górna Rp 1½" (6/4")', short: 'jedyne miejsce na anodę', anchor: new V(0, 1470, 30),
    parts: [part(vertical(1434, 1502, 60, 47.8, 40), M.pipe)],
    desc: 'Gniazdo na szczycie górnej dennicy. Według karty to jedyne miejsce na anodę magnezową w S15. Pasuje do niego każda anoda z gwintem G 1½".',
    params: [['Gwint', 'Rp 1½" (6/4")', 'p'], ['Wysokość', 'h10 = 1444 mm', 'p']],
    leak: 'Gwint złączki uszczelnia się pakułami albo taśmą. Sączenie stąd spływa po dennicy pod pianką.',
  });
  el({
    id: 'anodaG', no: 20, group: 'Góra – mufa Rp 1½"', name: 'Anoda magnezowa (fabrycznie)', short: 'G 1½", jedyna w S15', anchor: new V(0, 1250, 0),
    variant: { group: 'top', keys: ['anoda'] },
    parts: [
      part(cylinderBetween(new V(0, 1070, 0), new V(0, 1470, 0), 16.5, 32), M.mg),
      part(cylinderBetween(new V(0, 1075, 0), new V(0, 1475, 0), 4, 12), M.core),
      part(merge([cylinderBetween(new V(0, 1470, 0), new V(0, 1502, 0), 23.6, 32), cylinderBetween(new V(0, 1502, 0), new V(0, 1513, 0), 36, 6)]), M.dark),
    ],
    desc: 'Jedyna fabryczna anoda zasobnika. Rozpuszcza się zamiast stali i chroni pory emalii. Tabliczka: wymiana co 12 miesięcy. Karta dopuszcza też anodę tytanową.',
    params: [['Gwint', 'G 1½" (6/4")', 'p'], ['Wymiar w modelu', 'Ø33 × 400 mm (z rysunku)', 'est'], ['Wymiana', 'co 12 miesięcy (tabliczka)', 'p'], ['Alternatywa', 'anoda tytanowa (karta)', 'p']],
  });
  el({
    id: 'naczynie', no: 21, group: 'Góra – mufa Rp 1½"', name: 'Naczynie przeponowe w miejscu anody', short: 'tak było u Ciebie', anchor: new V(0, 1800, 135), visible: false,
    variant: { group: 'top', keys: ['naczynie'] },
    parts: [
      part(merge([
        vertical(1470, 1502, 47, 21), vertical(1502, 1516, 70, 21, 6), vertical(1516, 1590, 26.9, 21),
        vertical(1572, 1590, 46, 26.9, 6), vertical(1590, 1633, 26.9, 21.6),
      ]), M.brass),
      part(vesselShell(135, 1.5, 50, 50, 1678, 1938, 13.4), M.white),
      part(vesselShell(127, 2, 44, 55, 1678, 1793, 13.4), M.rubber),
      part(vesselWater(125, 42, 53, 1678, 1793, 13.4), M.water),
      part(merge([cylinderBetween(new V(0, 1987, 0), new V(0, 2006, 0), 6, 16), cylinderBetween(new V(0, 2006, 0), new V(0, 2016, 0), 8, 6)]), M.dark),
    ],
    desc: 'Tak było w Twoim zasobniku: zamiast anody w mufę 6/4" wkręcone przyłącze naczynia przeponowego. W S15 to jedyna mufa na anodę, więc zbiornik nie miał żadnej ochrony.',
    params: [['Pojemność w modelu', '18 l', 'est'], ['Złączki w modelu', 'redukcja 6/4" × 3/4", nypel, śrubunek', 'est'], ['Właściwe miejsce', 'rura zimnej wody przy grupie bezpieczeństwa', 'est']],
    leak: 'Bez anody zbiornik rdzewieje w porach emalii – to najbardziej prawdopodobna przyczyna przecieku.',
  });
  el({
    id: 'zawor', no: 22, group: 'Góra – mufa Rp 1½"', name: 'Zawór bezpieczeństwa w miejscu anody', short: 'wariant', anchor: new V(0, 1597, 16), visible: false,
    variant: { group: 'top', keys: ['zawor'] },
    parts: [
      part(merge([
        vertical(1470, 1502, 47, 15), vertical(1502, 1516, 66, 15, 6), vertical(1516, 1547, 21.3, 15),
        cylinderBetween(new V(0, 1545, 0), new V(0, 1589, 0), 17, 32), hollowTube([new V(0, 1567, 6), new V(0, 1567, 58)], 12, 8.5, 20),
      ]), M.brass),
      part(merge([cylinderBetween(new V(0, 1589, 0), new V(0, 1611, 0), 16, 32), cylinderBetween(new V(0, 1611, 0), new V(0, 1617, 0), 11, 24)]), M.red),
    ],
    desc: 'Możliwy wariant montażu: zamiast anody w mufę wkręcony zawór bezpieczeństwa. Zadziała przy nadciśnieniu, ale zbiornik zostaje bez anody.',
    params: [['Właściwe miejsce', 'rura zimnej wody, tuż przed zasobnikiem', 'p'], ['Złączki w modelu', 'redukcja 6/4" × 1/2"', 'est']],
    leak: 'Bez rurki odpływowej woda z zaworu leje się po płaszczu.',
  });

  el({
    id: 'spust', no: 23, group: 'Dół', name: 'Spust Rp 1½" z korkiem', short: 'środek dna – tu był przeciek', anchor: new V(0, 62, 30.5),
    parts: [
      part(vertical(55, 111, 60, 47.8, 40), M.pipe),
      part(merge([cylinderBetween(new V(0, 58, 0), new V(0, 100, 0), 23.6, 32), cylinderBetween(new V(0, 46, 0), new V(0, 58, 0), 36, 6)]), M.dark),
    ],
    desc: 'Mufa spustowa przyspawana na środku dolnej dennicy, zamknięta korkiem. Dostęp od spodu przez otwór w piance. Tu zlokalizowałeś przeciek.',
    params: [['Gwint', 'Rp 1½" (6/4")', 'p'], ['Wysokość', 'h1 = 74 mm', 'p'], ['Od rewizji do spawu (w środku)', `≈ ${access} cm`, 'calc']],
    leak: 'Spaw tej mufy leży w najniższym punkcie, pod osadem. Pamiętaj, że woda z wyższej dziury też spływa po dnie do tego otworu.',
  });
  el({
    id: 'nogi', no: 24, group: 'Dół', name: 'Nóżki regulowane', short: '3 szt.', anchor: P(215, 0, 20),
    parts: [
      part(merge(legPhis.flatMap((f) => [cylinderBetween(P(215, f, 22), P(215, f, 150), 15, 24), cylinderBetween(P(215, f, 5), P(215, f, 24), 5, 12)])), M.dark),
      part(merge(legPhis.map((f) => cylinderBetween(P(215, f, 0), P(215, f, 6), 22, 24))), M.rubber),
    ],
    desc: 'Nóżki przyspawane do dolnej dennicy. Sunex podaje wysokości przyłączy od podłogi, razem z nóżkami.',
    params: [['Liczba', '3 (rysunek)', 'est']],
    leak: 'Spawy nóżek z dnem to miejsca, gdzie pod osadem często zaczyna się korozja.',
  });
  el({
    id: 'woda', no: 25, group: 'Woda', name: 'Woda użytkowa (warstwy temperatury)', short: '300 l nominalnie', anchor: new V(0, 1150, -120), visible: false,
    parts: [part(water, { color: 0xffffff, cap: 0xffffff }, { noCap: true, noPick: true, transparent: true, opacity: 0.2, vertexColors: true, side: THREE.DoubleSide })],
    desc: 'Woda układa się warstwami: najcieplejsza na górze (tam pobiera ją rurka ciepłej wody), zimna na dole, gdzie wpływa woda z sieci.',
    params: [['Pojemność', '300 l (tabliczka)', 'p']],
  });

  // Typowe miejsca nieszczelności (pierścienie) i przykładowa droga wody pod izolacją.
  const Z = new V(0, 0, 1), Y = new V(0, 1, 0);
  const leaks = [
    { name: 'Spaw mufy spustu na dnie – tu znalazłeś przeciek', el: 'spust', rings: [{ pos: new V(0, yBa + 1, 0), axis: Y, r: 38 }] },
    { name: 'Uszczelka rewizji (z przodu)', el: 'uszczelka', rings: [{ pos: new V(0, H.h12, 308.5), axis: Z, r: 80 }] },
    { name: 'Uszczelnienie grzałki w mufie 6/4"', el: 'grzalka', rings: [{ pos: new V(0, yG, 340), axis: Z, r: 34 }] },
    { name: 'Dno zbiornika pod osadem', el: 'zbiornik', rings: [{ pos: new V(0, 128, 0), axis: Y, r: 150 }] },
    { name: 'Spawy króćców zimnej wody i powrotu PC', el: 'zimna', rings: [{ pos: P(277, W_PHI, H.h2), axis: radialAxis(W_PHI), r: 27 }, { pos: P(277, PC_PHI, H.h3), axis: radialAxis(PC_PHI), r: 27 }] },
    { name: 'Cyrkulacja – na zdjęciu rdzawy zaciek w dół', el: 'cyrkulacja', rings: [{ pos: P(277, PC_PHI, H.h6), axis: radialAxis(PC_PHI), r: 23 }] },
    { name: 'Tuleja „Czujnik” – na zdjęciu plama rdzy obok', el: 'czujnik', rings: [{ pos: P(277, W_PHI, H.h4), axis: radialAxis(W_PHI), r: 16 }] },
    {
      name: 'Spawy pozostałych króćców i termometru', el: 'cwu',
      rings: [[W_PHI, H.h9, 27], [W_PHI, H.h7, 16], [PC_PHI, H.h8, 27], [0, H.h11, 19]].map(([f, y, r]) => ({ pos: P(277, f, y), axis: radialAxis(f), r })),
    },
    { name: 'Spawy nóżek z dnem', el: 'nogi', rings: legPhis.map((f) => ({ pos: P(215, f, 150), axis: Y, r: 21 })) },
    { name: 'Mufa górna 6/4" (anoda albo naczynie)', el: 'mufaG', rings: [{ pos: new V(0, yTa + 2, 0), axis: Y, r: 37 }] },
  ];
  const dripPhi = PC_PHI + 0.25, drip = [];
  for (let y = 860; y > yBk; y -= 20) drip.push(P(Rs + 1, dripPhi, y));
  for (const [r, y] of ellipseArc(Rs + 1, bo + 1, yBk, -1, Math.asin(46 / (Rs + 1)), Math.PI / 2, 16).reverse()) drip.push(P(r, dripPhi, y));
  drip.push(P(40, dripPhi, yBa - 4), P(36, dripPhi, yJb + 5), P(36, dripPhi, yJb - 20), P(36, dripPhi, 4));

  return { elements: els, bores, leaks, drip, pinhole: P(Rs + 1, dripPhi, 860), yG, access };
}
