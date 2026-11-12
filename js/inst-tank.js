import * as THREE from 'three';
import { latheSolid, hollowTube, cylinderBetween, merge } from './geom.js';
import { DIM, H_DEFAULT, W_PHI, PC_PHI } from './model.js';
import { MAT } from './inst-parts.js';

// Zasobnik Sunex FISH S15 300 z zewnątrz (bez wnętrza) – wymiary i kąty króćców jak w modelu zasobnika.
// Tył zasobnika (kolumna wody φ = 180°) zwrócony do ściany, czyli w stronę -Z świata.

const V = THREE.Vector3;
const MJ = { color: 0x9aa1a9, rough: 0.75 };

export function tankExterior(cx, cz) {
  const { L, yJb, R } = DIM;
  const H = H_DEFAULT;
  const W = (r, phi, y) => new V(cx + r * Math.sin(phi), y, cz + r * Math.cos(phi));
  const radial = (phi, y, r0, r1, od, id, segs = 28) => hollowTube([W(r1, phi, y), W(r0, phi, y)], od / 2, id / 2, segs);
  const lathe = (strips, segs = 96) => latheSolid(strips, segs).translate(cx, 0, cz);

  const jacket = lathe([[[R - 1.5, yJb], [R, yJb]], [[R, yJb], [R, L - 10]], [[R, L - 10], [R - 1.5, L - 10]], [[R - 1.5, L - 10], [R - 1.5, yJb]]]);
  const lid = lathe([[[0, L - 10], [R, L - 10]], [[R, L - 10], [R, L - 40]], [[R, L - 40], [R + 2.5, L - 40]], [[R + 2.5, L - 40], [R + 2.5, L]], [[R + 2.5, L], [0, L]], [[0, L], [0, L - 10]]]);
  const band = lathe([[[R, yJb], [R + 2.5, yJb]], [[R + 2.5, yJb], [R + 2.5, yJb + 30]], [[R + 2.5, yJb + 30], [R, yJb + 30]], [[R, yJb + 30], [R, yJb]]]);
  const zipPhi = (W_PHI + PC_PHI) / 2;
  const zipper = cylinderBetween(W(R + 1.2, zipPhi, yJb + 30), W(R + 1.2, zipPhi, L - 40), 4.5, 4);
  const bottom = new THREE.CylinderGeometry(R - 1.5, R - 1.5, 4, 64).translate(cx, yJb + 2, cz);
  bottom.deleteAttribute('uv');

  // króćce: [faza, wysokość, średnica zewn. mufy]
  const stubs = [[W_PHI, H.h9, 42], [W_PHI, H.h7, 21.3], [W_PHI, H.h4, 21.3], [W_PHI, H.h2, 42], [W_PHI, 74, 48], [PC_PHI, H.h8, 42], [PC_PHI, H.h6, 34], [PC_PHI, H.h3, 42]];
  const stubGeo = merge(stubs.map(([f, y, od]) => radial(f, y, R - 20, R + 27, od, od - 9)));
  const ros = merge(stubs.map(([f, y, od]) => radial(f, y, R - 1.5, R + 1.5, od + 36, od + 1, 36)));
  const legs = merge([0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((f) => merge([cylinderBetween(W(215, f, 0), W(215, f, 6), 22, 24), cylinderBetween(W(215, f, 5), W(215, f, yJb + 2), 6, 12)])));

  // przód: termometr i pokrywa rewizji z anodą 6/4" w miejscu grzałki
  const thermo = merge([cylinderBetween(W(R - 10, 0, H.h11), W(R + 8, 0, H.h11), 31.5, 40), radial(0, H.h11, R + 6, R + 26, 69, 61, 40)]);
  const cover = merge([
    hollowTube([new V(cx, H.h12, cz + R - 30), new V(cx, H.h12, cz + R + 2)], 120, 112, 64),
    cylinderBetween(new V(cx, H.h12, cz + R + 2), new V(cx, H.h12, cz + R + 14), 90, 64),
    cylinderBetween(new V(cx, H.h12 + 15, cz + R + 14), new V(cx, H.h12 + 15, cz + R + 26), 30, 6),
  ]);
  const topPlug = cylinderBetween(new V(cx, L, cz), new V(cx, L + 12, cz), 36, 6);

  const port = (phi, y) => ({ p: W(R + 27, phi, y), d: new V(Math.sin(phi), 0, Math.cos(phi)) });
  return {
    parts: [
      { geo: jacket, mat: MJ }, { geo: lid, mat: MAT.black }, { geo: band, mat: MAT.black }, { geo: zipper, mat: MAT.rubber }, { geo: bottom, mat: MAT.black },
      { geo: stubGeo, mat: MAT.steel }, { geo: ros, mat: MAT.rubber }, { geo: legs, mat: MAT.cast }, { geo: thermo, mat: MAT.white },
      { geo: cover, mat: MAT.steel }, { geo: topPlug, mat: MAT.cast },
    ],
    dial: { p: W(R + 26.5, 0, H.h11), d: new V(0, 0, 1) },
    ports: {
      cwu: port(W_PHI, H.h9), zimna: port(W_PHI, H.h2), pcZas: port(PC_PHI, H.h8), pcPow: port(PC_PHI, H.h3),
      cyrk: port(PC_PHI, H.h6), czujnik: port(W_PHI, H.h4), termostat: port(W_PHI, H.h7), spust: port(W_PHI, 74),
    },
    W,
  };
}

// Tekstury tarcz: manometr (bar) i termometr (°C).
export function dialTexture(kind = 'bar', max = 4, mark = 1.5, label = 'bar') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbf8';
  g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#25282c'; g.fillStyle = '#25282c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const ang = (val) => Math.PI * (0.75 + (1.5 * val) / max);
  const step = max <= 6 ? 0.5 : 10;
  for (let val = 0; val <= max + 1e-6; val += step) {
    const a = ang(val), major = Math.abs(val % (step * 2)) < 1e-6;
    g.lineWidth = major ? 4 : 2;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * (major ? 90 : 100), 128 + Math.sin(a) * (major ? 90 : 100)); g.lineTo(128 + Math.cos(a) * 113, 128 + Math.sin(a) * 113); g.stroke();
    if (major) { g.font = '600 24px system-ui, sans-serif'; g.fillText(String(val), 128 + Math.cos(a) * 66, 128 + Math.sin(a) * 66); }
  }
  if (kind === 'bar') {
    g.strokeStyle = '#d0312d'; g.lineWidth = 6;
    g.beginPath(); g.arc(128, 128, 106, ang(max * 0.75), ang(max)); g.stroke();
  }
  g.fillStyle = '#25282c';
  g.font = '600 22px system-ui, sans-serif';
  g.fillText(label, 128, 186);
  const a = ang(mark);
  g.strokeStyle = '#d0312d'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); g.stroke();
  g.fillStyle = '#333';
  g.beginPath(); g.arc(128, 128, 9, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Płaski napis (np. logo na obudowie pompy ciepła, opis wyświetlacza pompy).
export function textTexture(lines, { w = 512, h = 128, bg = null, color = '#1d2227', font = '600 44px system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((ln, i) => {
    const f = typeof ln === 'object' ? ln.font : font;
    g.font = f;
    g.fillText(typeof ln === 'object' ? ln.text : ln, 16, (h / (arr.length + 1)) * (i + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
