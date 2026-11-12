import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Wszystkie bryły muszą być zamknięte i mieć przód na zewnątrz – wymaga tego
// zaślepianie przekroju buforem stencil (zliczanie ścian przednich i tylnych).

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vn = new THREE.Vector3();

// Odwraca trójkąty, których kolejność wierzchołków nie zgadza się z normalnymi.
function orient(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    va.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
    vb.set(pos[i1], pos[i1 + 1], pos[i1 + 2]).sub(va);
    vc.set(pos[i2], pos[i2 + 1], pos[i2 + 2]).sub(va);
    vb.cross(vc);
    if (vb.lengthSq() < 1e-10) continue;
    vn.set(nor[i0] + nor[i1] + nor[i2], nor[i0 + 1] + nor[i1 + 1] + nor[i2 + 1], nor[i0 + 2] + nor[i1 + 2] + nor[i2 + 2]);
    if (vb.dot(vn) < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
}

export function buildGeometry(pos, nor, idx) {
  orient(pos, nor, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Punkty łuku elipsy dennicy (r = a·sin t, y = yk ± b·cos t) dla t od t0 do t1.
export function ellipseArc(a, b, yk, sign, t0 = 0, t1 = Math.PI / 2, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push([a * Math.sin(t), yk + sign * b * Math.cos(t)]);
  }
  return pts;
}

// Bryła obrotowa wokół osi Y z zamkniętego profilu (r, y), obchodzonego tak, by materiał
// był po lewej stronie. Profil to lista pasów; każdy pas ma własne normalne (ostre krawędzie).
export function latheSolid(strips, segments = 144) {
  const pos = [], nor = [], idx = [];
  for (const pts of strips) {
    const n = pts.length;
    const n2 = pts.map((_, k) => {
      const p = pts[Math.max(0, k - 1)], q = pts[Math.min(n - 1, k + 1)];
      const dr = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    const base = pos.length / 3;
    for (let s = 0; s <= segments; s++) {
      const f = (s / segments) * Math.PI * 2, c = Math.cos(f), si = Math.sin(f);
      for (let k = 0; k < n; k++) {
        pos.push(pts[k][0] * si, pts[k][1], pts[k][0] * c);
        nor.push(n2[k][0] * si, n2[k][1], n2[k][0] * c);
      }
    }
    for (let s = 0; s < segments; s++) {
      for (let k = 0; k < n - 1; k++) {
        const a = base + s * n + k, b = a + n;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
  return buildGeometry(pos, nor, idx);
}

// Ramki wzdłuż ścieżki przenoszone równolegle (bez skręcania przekroju rury).
function frames(path) {
  const n = path.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const ref = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const nrm = new THREE.Vector3().crossVectors(T[0], ref).normalize();
  const ax = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      ax.crossVectors(T[i - 1], T[i]);
      const s = ax.length();
      if (s > 1e-9) nrm.applyAxisAngle(ax.divideScalar(s), Math.atan2(s, T[i - 1].dot(T[i])));
      nrm.addScaledVector(T[i], -nrm.dot(T[i])).normalize();
    }
    N.push(nrm.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], nrm).normalize());
  }
  return { T, N, B };
}

// Rura o ściance rOut–rIn wzdłuż ścieżki (gęsta lista punktów), z pierścieniami na końcach.
// rIn = 0 daje pełny pręt.
export function hollowTube(path, rOut, rIn = 0, radial = 16) {
  const n = path.length;
  const { T, N, B } = frames(path);
  const pos = [], nor = [], idx = [];
  const dir = (i, j) => {
    const th = (j / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    return new THREE.Vector3().addScaledVector(N[i], c).addScaledVector(B[i], s);
  };
  const shell = (r, sign) => {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= radial; j++) {
        const d = dir(i, j);
        pos.push(path[i].x + d.x * r, path[i].y + d.y * r, path[i].z + d.z * r);
        nor.push(d.x * sign, d.y * sign, d.z * sign);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  };
  const end = (i, sign) => {
    const t = T[i];
    const base = pos.length / 3;
    for (let j = 0; j <= radial; j++) {
      const d = dir(i, j);
      pos.push(path[i].x + d.x * rOut, path[i].y + d.y * rOut, path[i].z + d.z * rOut);
      pos.push(path[i].x + d.x * rIn, path[i].y + d.y * rIn, path[i].z + d.z * rIn);
      nor.push(t.x * sign, t.y * sign, t.z * sign, t.x * sign, t.y * sign, t.z * sign);
    }
    for (let j = 0; j < radial; j++) {
      const a = base + j * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  };
  shell(rOut, 1);
  if (rIn > 0) shell(rIn, -1);
  end(0, -1);
  end(n - 1, 1);
  return buildGeometry(pos, nor, idx);
}

export function smoothPath(points, spacing = 10) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, points.length * 40);
  const len = curve.getLength();
  return { pts: curve.getSpacedPoints(Math.max(2, Math.round(len / spacing))), length: len };
}

const UP = new THREE.Vector3(0, 1, 0);

// Pełny walec między dwoma punktami (segs = 6 daje łeb sześciokątny).
export function cylinderBetween(p0, p1, r, segs = 24, rTop = r) {
  const d = new THREE.Vector3().subVectors(p1, p0);
  const g = new THREE.CylinderGeometry(rTop, r, d.length(), segs, 1, false);
  g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export function merge(list) {
  const clean = list.map((x) => (x.attributes.uv ? (x.deleteAttribute('uv'), x) : x));
  // RoundedBoxGeometry nie ma indeksu – przy mieszance wszystko zamieniamy na nieindeksowane.
  const mixed = clean.some((x) => x.index) && clean.some((x) => !x.index);
  const g = mergeGeometries(mixed ? clean.map((x) => (x.index ? x.toNonIndexed() : x)) : clean);
  g.computeBoundingSphere();
  return g;
}

// Tarcza dopasowana do walca obudowy (oś Y), na azymucie 0 (przód, +Z), środek na wysokości yc.
export function curvedDisk(yc, rho, Ri, Ro, bulge = 0, rings = 10, segs = 64) {
  const pos = [], nor = [], idx = [];
  const face = (R, sign, bul) => {
    const base = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const rr = (i / rings) * rho;
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const x = rr * Math.cos(th), y = yc + rr * Math.sin(th);
        const Rb = R + bul * (1 - (rr / rho) ** 2);
        const z = Math.sqrt(Rb * Rb - x * x);
        pos.push(x, y, z);
        nor.push((sign * x) / Rb, 0, (sign * z) / Rb);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * (segs + 1) + j, b = a + segs + 1;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  };
  face(Ro, 1, bulge);
  face(Ri, -1, 0);
  const base = pos.length / 3;
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    const x = rho * c, y = yc + rho * s;
    pos.push(x, y, Math.sqrt(Ro * Ro - x * x), x, y, Math.sqrt(Ri * Ri - x * x));
    nor.push(c, s, 0, c, s, 0);
  }
  for (let j = 0; j < segs; j++) {
    const a = base + j * 2;
    idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  return buildGeometry(pos, nor, idx);
}

// Cienka ścianka wnęki w izolacji (pierścień rho0–rho1 wokół osi Z na wysokości yc),
// rozpięta od powierzchni zbiornika (walec Ri) do obudowy (walec Ro).
export function recessWall(yc, rho0, rho1, Ri, Ro, segs = 72) {
  const pos = [], nor = [], idx = [];
  const z = (R, x) => Math.sqrt(R * R - x * x);
  const strip = (pa, pb, na, nb) => {
    const base = pos.length / 3;
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const A = pa(c, s), Bp = pb(c, s), NA = na(c, s), NB = nb(c, s);
      pos.push(...A, ...Bp);
      nor.push(...NA, ...NB);
    }
    for (let j = 0; j < segs; j++) {
      const a = base + j * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  };
  const P = (rho, R) => (c, s) => [rho * c, yc + rho * s, z(R, rho * c)];
  const radial = (sign) => (c, s) => [sign * c, sign * s, 0];
  const cyl = (rho, R, sign) => (c, s) => { const x = rho * c, zz = z(R, x); return [(sign * x) / R, 0, (sign * zz) / R]; };
  strip(P(rho0, Ri), P(rho0, Ro), radial(-1), radial(-1));
  strip(P(rho1, Ri), P(rho1, Ro), radial(1), radial(1));
  strip(P(rho0, Ri), P(rho1, Ri), cyl(rho0, Ri, -1), cyl(rho1, Ri, -1));
  strip(P(rho0, Ro), P(rho1, Ro), cyl(rho0, Ro, 1), cyl(rho1, Ro, 1));
  return buildGeometry(pos, nor, idx);
}
