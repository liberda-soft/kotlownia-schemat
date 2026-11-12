import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cylinderBetween, merge } from './geom.js';
import { MAT, dialDisc } from './inst-parts.js';
import { dialTexture } from './inst-tank.js';

// Pompa ciepła alpha innotec SWC 170H wg rysunku DE819248b (Baugröße 1) z instrukcji 83050000b:
// obudowa 650 × 500 × 1550 mm, osłona frontu wystaje do 565 mm od tylnej ściany, listwy Sylomer ok. 10 mm.
// Króćce G 1¼" AG wychodzą poziomo z tyłu i kończą się 50 mm za tylną ścianą.

const V = THREE.Vector3;
const v = (x, y, z) => new V(x, y, z);

export const HP = { W: 650, D: 500, H: 1550, S: 10 };
// [x od lewej krawędzi patrząc od przodu, z od spodu urządzenia]
export const HP_PORTS = { bIn: [242, 1417], bOut: [422, 1253], hRet: [497, 1305], hFlow: [577, 1390] };

const rbox = (w, h, d, c, r = 6) => {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.5, h / 2 - 0.5, d / 2 - 0.5));
  g.deleteAttribute('uv');
  g.translate(c.x, c.y, c.z);
  return g;
};

// Nadruk na osłonie frontu: łuki, panel Luxtronik 2.0, logo i pionowy napis.
function visorTexture() {
  const k = 1.6, w = 285, h = 1205;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  g.fillStyle = '#7b7f84';
  g.fillRect(0, 0, w, h);
  const shade = (y0, y1) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.10)'); return gr; };
  g.fillStyle = shade(0, h);
  g.fillRect(0, 0, w, h);
  // górny łuk
  g.fillStyle = '#676b70';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, 30); g.quadraticCurveTo(w / 2, 110, 0, 30); g.closePath(); g.fill();
  // dolny łuk (wnęka)
  g.fillStyle = '#5d6166';
  g.beginPath(); g.moveTo(0, h); g.lineTo(0, 1040); g.bezierCurveTo(10, 930, 90, 890, w / 2, 890); g.bezierCurveTo(w - 90, 890, w - 10, 930, w, 1040); g.lineTo(w, h); g.closePath(); g.fill();
  // panel Luxtronik: wyświetlacz i pokrętło
  g.fillStyle = '#eef0f1'; g.fillRect(82, 130, 123, 130);
  g.strokeStyle = '#4a4e53'; g.lineWidth = 1.5; g.strokeRect(82, 130, 123, 130);
  g.fillStyle = '#9fb7a3'; g.fillRect(92, 142, 103, 48);
  g.fillStyle = '#26352a'; g.font = '600 9px monospace';
  g.fillText('Temp. 34.8°C', 96, 158); g.fillText('Heizen  Auto', 96, 171); g.fillText('WW  48.0°C', 96, 184);
  // kwadrat z logo „e” i pusty kwadrat
  g.fillStyle = '#6a6e73'; g.fillRect(82, 278, 123, 128); g.fillRect(82, 420, 123, 128);
  g.strokeStyle = '#555a5f'; g.lineWidth = 2; g.strokeRect(82, 278, 123, 128); g.strokeRect(82, 420, 123, 128); g.strokeRect(82, 562, 123, 300);
  g.strokeStyle = '#9ca0a5'; g.lineWidth = 6;
  g.beginPath(); g.arc(143.5, 342, 38, 0.15 * Math.PI, 1.9 * Math.PI); g.stroke();
  g.beginPath(); g.moveTo(108, 342); g.lineTo(180, 342); g.stroke();
  // pionowy napis
  g.save(); g.translate(158, 840); g.rotate(-Math.PI / 2);
  g.fillStyle = '#c9ccd0'; g.font = '600 40px system-ui, sans-serif';
  g.fillText('alpha innoTec', 0, 0);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// x0 – lewa krawędź obudowy, zBack – tylna ściana obudowy (odległość od ściany pomieszczenia).
export function heatPump(x0, zBack) {
  const { W, D, H, S } = HP;
  const xc = x0 + W / 2, zc = zBack + D / 2;
  const body = merge([
    rbox(W, H - 56, D, v(xc, S + 56 + (H - 56) / 2, zc), 9),
    rbox(W + 4, 16, D + 4, v(xc, S + H - 8, zc), 5),
  ]);
  const plinth = rbox(W - 24, 50, D - 24, v(xc, S + 31, zc), 3);
  const strips = merge([rbox(40, S, D - 10, v(x0 + 28, S / 2, zc), 2), rbox(40, S, D - 10, v(x0 + W - 28, S / 2, zc), 2)]);
  const vx = x0 + 180 + 285 / 2, vy = S + 320 + 1205 / 2, vz = zBack + D + 30;
  const visor = rbox(285, 1205, 70, v(vx, vy, vz), 26);
  const knob = merge([cylinderBetween(v(x0 + 262 + 61.5, S + 1525 - 130 - 87, vz + 35), v(x0 + 262 + 61.5, S + 1525 - 130 - 87, vz + 41), 22, 32)]);
  const screws = merge([-1, 1].map((s) => cylinderBetween(v(xc + s * (W / 2 - 55), S + H - 120, zBack + D), v(xc + s * (W / 2 - 55), S + H - 120, zBack + D + 3), 5, 12)));

  // Króćce G 1¼" (mosiądz) i przepusty kabli z tyłu.
  const port = (key) => {
    const [x, z] = HP_PORTS[key];
    return { p: v(x0 + x, S + z, zBack - 50), d: v(0, 0, -1) };
  };
  const ports = { bIn: port('bIn'), bOut: port('bOut'), hRet: port('hRet'), hFlow: port('hFlow') };
  const stubs = merge(Object.values(ports).flatMap(({ p }) => [
    cylinderBetween(v(p.x, p.y, zBack + 4), v(p.x, p.y, p.z), 21, 24),
    cylinderBetween(v(p.x, p.y, zBack - 8), v(p.x, p.y, zBack + 2), 30, 6),
  ]));
  const grommets = merge([67, 127].map((x) => cylinderBetween(v(x0 + x, S + 1470, zBack + 2), v(x0 + x, S + 1470, zBack - 10), 16, 20)));

  // Fabryczne grupy bezpieczeństwa na pokrywie (w izolacyjnych skrzynkach z manometrem).
  const lidY = S + H, boxH = 130;
  const boxes = [[316, 455], [508, 642]].map(([a, b]) => ({ x: x0 + (a + b) / 2, w: b - a }));
  const lid = merge(boxes.map((b) => rbox(b.w, boxH, 120, v(b.x, lidY + boxH / 2, zBack + 95), 10)));
  const lidPipes = merge(boxes.map((b) => cylinderBetween(v(b.x + 30, lidY + 40, zBack + 34), v(b.x + 30, lidY + 40, zBack - 6), 9, 12)));
  const dials = boxes.map((b) => ({ p: v(b.x, lidY + 72, zBack + 155.6), d: v(0, 0, 1) }));
  const bezel = merge(boxes.map((b) => cylinderBetween(v(b.x, lidY + 72, zBack + 150), v(b.x, lidY + 72, zBack + 155), 30, 32)));

  const visorDecal = new THREE.PlaneGeometry(285, 1205);
  visorDecal.translate(vx, vy, vz + 35.4);

  return {
    casing: [
      { geo: body, mat: { color: 0xe4e6e8, metal: 0.15, rough: 0.5 } },
      { geo: plinth, mat: { color: 0xb9bdc2, rough: 0.6 } },
      { geo: strips, mat: MAT.rubber },
      { geo: visor, mat: { color: 0x7b7f84, metal: 0.2, rough: 0.45 } },
      { geo: knob, mat: MAT.pumpHead },
      { geo: screws, mat: MAT.chrome },
      { geo: stubs, mat: MAT.brass },
      { geo: grommets, mat: MAT.rubber },
    ],
    lid: [
      { geo: lid, mat: { color: 0xc9cdd1, rough: 0.8 } },
      { geo: lidPipes, mat: MAT.brass },
      { geo: bezel, mat: MAT.chrome },
    ],
    decals: [{ geo: visorDecal, map: visorTexture() }, ...dials.map((d) => ({ geo: dialDisc(d.p, d.d, 27), map: dialTexture('bar', 4, 1.6, 'bar') }))],
    ports,
    lidBoxes: boxes.map((b) => ({ x: b.x, y: lidY + boxH, z: zBack + 95 })),
    front: v(vx, S + 1250, vz + 40),
  };
}
