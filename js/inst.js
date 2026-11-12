import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildInstallation, WALL } from './inst-layout.js';

const $ = (id) => document.getElementById(id);
const V = THREE.Vector3;
const viewport = $('viewport');

// ---------- scena ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (err) {
  $('loading').textContent = 'Ta przeglądarka nie udostępnia WebGL. Otwórz stronę w Chrome, Safari albo Firefoksie.';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
viewport.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8f969e, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-900, 3200, 2600);
const fill = new THREE.DirectionalLight(0xdfe7ff, 0.6);
fill.position.set(2600, 1200, 1800);
scene.add(sun, fill);

const camera = new THREE.PerspectiveCamera(30, 1, 10, 40000);
const TARGET = new V(WALL.W / 2, WALL.H / 2 - 80, 250);
const VIEWS = {
  front: [TARGET, new V(0, 0.02, 1)],
  iso: [TARGET, new V(-0.45, 0.28, 0.85)],
  isoR: [TARGET, new V(0.5, 0.28, 0.82)],
  top: [new V(WALL.W / 2, 400, 500), new V(0, 1, 0.32)],
};
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 300;
controls.maxDistance = 12000;
function fitDist() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max((WALL.H / 2 + 200) / t, (WALL.W / 2 + 260) / (t * camera.aspect));
}
let flight = null;
function flyTo(target, pos, ms = 650) {
  flight = { t0: performance.now(), ms, t1: controls.target.clone(), t2: target.clone(), p1: camera.position.clone(), p2: pos.clone() };
}
function setView(name, instant = false) {
  const [t, d] = VIEWS[name];
  const p = t.clone().addScaledVector(d.clone().normalize(), fitDist() * (name === 'top' ? 1.35 : 1));
  if (instant) { controls.target.copy(t); camera.position.copy(p); } else flyTo(t, p);
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}
function focusOn(p, dist = 1100) {
  const dir = new V().subVectors(camera.position, controls.target).normalize();
  flyTo(p, p.clone().addScaledVector(dir, dist));
}
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

// ---------- model ----------
const inst = buildInstallation();
const parts = [];
const idColor = (id) => new THREE.Color().setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, THREE.LinearSRGBColorSpace);
const nonPickable = [];
for (const el of inst.elements) {
  el.rt = [];
  el.visible = el.visible ?? true;
  for (const spec of el.parts) {
    const mat = new THREE.MeshStandardMaterial({
      color: spec.mat.color, metalness: spec.mat.metal ?? 0, roughness: spec.mat.rough ?? 0.6,
      map: spec.mat.map ?? null, transparent: !!spec.mat.opacity, opacity: spec.mat.opacity ?? 1,
    });
    const mesh = new THREE.Mesh(spec.geo, mat);
    if (spec.layer) mesh.userData.layer = spec.layer;
    scene.add(mesh);
    const p = { el, mesh, mat, id: parts.length + 1, base: new THREE.Color(0, 0, 0), layer: spec.layer };
    p.pickMat = new THREE.MeshBasicMaterial({ color: idColor(p.id), toneMapped: false });
    parts.push(p);
    el.rt.push(p);
  }
}
for (const s of inst.static) {
  const mesh = new THREE.Mesh(s.geo, new THREE.MeshStandardMaterial({ color: s.mat.color, roughness: s.mat.rough ?? 0.9, metalness: s.mat.metal ?? 0, map: s.mat.map ?? null, transparent: !!s.mat.opacity, opacity: s.mat.opacity ?? 1, side: s.side ?? THREE.FrontSide }));
  scene.add(mesh);
  nonPickable.push(mesh);
}
const decals = [];
for (const d of inst.decals) {
  const mesh = new THREE.Mesh(d.geo, new THREE.MeshBasicMaterial({ map: d.map, transparent: true }));
  mesh.renderOrder = 2;
  scene.add(mesh);
  decals.push({ mesh, el: d.el });
}

// Strzałki kierunku przepływu (animowane wzdłuż rur).
const flowGroup = new THREE.Group();
scene.add(flowGroup);
nonPickable.push(flowGroup);
const flowItems = [];
{
  const cone = new THREE.ConeGeometry(11, 34, 12);
  cone.rotateX(Math.PI / 2);
  for (const f of inst.flows) {
    const curve = new THREE.CatmullRomCurve3(f.path, false, 'centripetal', 0);
    const len = curve.getLength();
    const n = Math.max(1, Math.floor(len / 260));
    const mat = new THREE.MeshBasicMaterial({ color: f.color, depthTest: false, transparent: true, opacity: 0.95 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(cone, mat);
      m.renderOrder = 10;
      flowGroup.add(m);
      flowItems.push({ m, curve, u0: i / n, r: f.r ?? 0 });
    }
  }
}

// ---------- podświetlenie, wybór, widoczność ----------
let hovered = null, selected = null, solo = false;
const HL = new THREE.Color(0xff7a1a);
const ui = { pins: true, names: false, flow: true, insul: true, labels: true };
function refreshPaint() {
  for (const el of inst.elements) {
    const k = el === selected ? 0.42 : el === hovered ? 0.24 : 0;
    for (const p of el.rt) p.mat.emissive.copy(HL).multiplyScalar(k);
  }
}
const shown = (el) => el.visible && (!solo || !selected || el === selected);
function syncVisibility() {
  for (const p of parts) p.mesh.visible = shown(p.el) && !(p.layer === 'insul' && !ui.insul);
  for (const d of decals) d.mesh.visible = !d.el || shown(d.el);
  flowGroup.visible = ui.flow;
  for (const o of zoneLabels) o.visible = ui.labels;
  scheduleOcclusion();
}

// ---------- numery i opisy stref ----------
for (const el of inst.elements) {
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
const zoneLabels = inst.labels.map((l) => {
  const d = document.createElement('div');
  d.className = `zone ${l.cls ?? ''}`;
  d.textContent = l.text;
  const o = new CSS2DObject(d);
  o.position.copy(l.pos);
  scene.add(o);
  return o;
});

// ---------- render identyfikatorów (wskazywanie, zasłanianie numerów) ----------
const pickRT = new THREE.WebGLRenderTarget(1, 1);
const occRT = new THREE.WebGLRenderTarget(2, 2);
const pickBuf = new Uint8Array(4);
function idRender(target, offset) {
  const off = nonPickable.filter((o) => o.visible);
  off.forEach((o) => (o.visible = false));
  const dOn = decals.filter((d) => d.mesh.visible);
  dOn.forEach((d) => (d.mesh.visible = false));
  for (const p of parts) p.mesh.material = p.pickMat;
  if (offset) camera.setViewOffset(...offset);
  renderer.setRenderTarget(target);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  if (offset) camera.clearViewOffset();
  for (const p of parts) p.mesh.material = p.mat;
  off.forEach((o) => (o.visible = true));
  dOn.forEach((d) => (d.mesh.visible = true));
}
function pickAt(x, y) {
  idRender(pickRT, [viewport.clientWidth, viewport.clientHeight, x, y, 1, 1]);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  const id = pickBuf[0] | (pickBuf[1] << 8);
  return id ? parts[id - 1] : null;
}
let occTimer = 0;
function scheduleOcclusion() { clearTimeout(occTimer); occTimer = setTimeout(runOcclusion, 160); }
function runOcclusion() {
  const W = Math.max(2, Math.round(viewport.clientWidth / 3)), Hh = Math.max(2, Math.round(viewport.clientHeight / 3));
  occRT.setSize(W, Hh);
  idRender(occRT, null);
  const buf = new Uint8Array(W * Hh * 4);
  renderer.readRenderTargetPixels(occRT, 0, 0, W, Hh, buf);
  const p = new V();
  for (const el of inst.elements) {
    p.copy(el.anchor).project(camera);
    const px = Math.round(((p.x + 1) / 2) * (W - 1)), py = Math.round(((p.y + 1) / 2) * (Hh - 1));
    let hit = false;
    for (let dy = -3; dy <= 3 && !hit; dy++) {
      for (let dx = -3; dx <= 3 && !hit; dx++) {
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

// ---------- panel: lista elementów ----------
const listBox = $('list');
{
  let group = null, box = null;
  for (const el of inst.elements) {
    if (el.group !== group) {
      group = el.group;
      const g = inst.groups[group] ?? { name: group, color: '#888' };
      const h = document.createElement('h3');
      h.innerHTML = `<i class="sw-c" style="background:${g.color}"></i>${g.name}`;
      listBox.appendChild(h);
      box = document.createElement('div');
      box.className = 'items';
      listBox.appendChild(box);
    }
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<input type="checkbox" ${el.visible ? 'checked' : ''} aria-label="Pokaż: ${el.name}"><span class="no">${el.no}</span><span class="nm">${el.name}<small>${el.short}</small></span>`;
    const cb = row.querySelector('input');
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => { el.visible = cb.checked; syncVisibility(); });
    row.addEventListener('click', () => { select(el); focusOn(el.anchor); });
    row.addEventListener('mouseenter', () => setHover(el, true));
    row.addEventListener('mouseleave', () => setHover(null, true));
    box.appendChild(row);
    el.row = row;
    el.cb = cb;
  }
}

// ---------- karta opisu ----------
const info = $('info'), tip = $('tip');
function renderInfo() {
  for (const el of inst.elements) el.row.classList.toggle('sel', el === selected);
  if (!selected) { info.hidden = true; return; }
  const e = selected;
  const models = (e.models ?? []).map((m) => (m.url ? `<a href="${m.url}" target="_blank" rel="noopener">${m.name}</a>` : m.name)).join('<br>');
  info.innerHTML = `
    <header><span class="no">${e.no}</span><h3>${e.name}</h3><button class="x" data-act="close" aria-label="Zamknij">×</button></header>
    <p>${e.desc}</p>
    <table>${(e.params ?? []).map(([k, val]) => `<tr><th>${k}</th><td>${val}</td></tr>`).join('')}
    ${models ? `<tr><th>Przykładowe modele</th><td>${models}</td></tr>` : ''}</table>
    ${e.note ? `<p class="leak"><b>Montaż:</b> ${e.note}</p>` : ''}
    <div class="actions"><button data-act="focus">Przybliż</button><button data-act="solo">${solo ? 'Pokaż wszystkie' : 'Tylko ten element'}</button></div>`;
  info.hidden = false;
}
info.addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (!act || !selected) return;
  if (act === 'close') select(null);
  if (act === 'focus') focusOn(selected.anchor, 900);
  if (act === 'solo') { solo = !solo; $('tSolo').checked = solo; syncVisibility(); renderInfo(); }
});
function setHover(el, fromPanel = false) {
  if (hovered !== el) {
    hovered = el;
    refreshPaint();
    for (const x of inst.elements) x.row.classList.toggle('hov', x === el);
  }
  if (el && !fromPanel && mouse) {
    tip.innerHTML = `<b>${el.no}. ${el.name}</b><span>${el.short}</span>`;
    tip.hidden = false;
  } else tip.hidden = true;
}
function select(el) {
  selected = el;
  refreshPaint();
  renderInfo();
  if (solo) syncVisibility();
}

// ---------- lista zakupów i schemat ----------
{
  const rows = inst.elements.filter((e) => e.bom).map((e) => `<tr><td>${e.no}</td><td>${e.bom.item}</td><td>${e.bom.spec}</td><td>${e.bom.qty}</td><td>${(e.models ?? []).map((m) => (m.url ? `<a href="${m.url}" target="_blank" rel="noopener">${m.name}</a>` : m.name)).join('<br>')}</td></tr>`).join('');
  const extra = (inst.bomExtra ?? []).map((b) => `<tr><td>–</td><td>${b.item}</td><td>${b.spec}</td><td>${b.qty}</td><td>${b.models ?? ''}</td></tr>`).join('');
  $('bomTable').innerHTML = `<thead><tr><th>Nr</th><th>Element</th><th>Parametry</th><th>Ilość</th><th>Przykładowe modele</th></tr></thead><tbody>${rows}${extra}</tbody>`;
  $('schemaBox').innerHTML = inst.schematic;
  const LEG = { bIn: 'solanka z gruntu', bOut: 'solanka do gruntu', hF: 'zasilanie z PC', hR: 'powrót do PC', cS: 'zasilanie c.o. domu', cR: 'powrót c.o. domu', zw: 'woda zimna', cwu: 'ciepła woda', odp: 'wyrzut zaworów' };
  $('legend').innerHTML = Object.entries(LEG).map(([k, s]) => `<span><i style="background:${inst.lines[k]}"></i>${s}</span>`).join('');
  $('srcNote').innerHTML = `<p><b>Źródła:</b> instrukcja i rysunki ait dla SWC 170H (art. 10038602: wymiary, króćce, odstępy, osprzęt wbudowany i w komplecie), dane techniczne 813174-d, krzywe pomp 823005, instrukcja Luxtronik 2.0; karta Sunex FISH S15 X; karty producentów armatury podane przy elementach. Naczynia, rury i izolacje przeliczone dla ok. 320 l wody grzewczej, 420 l solanki i 300 l c.w.u.</p>
    <p>Przyjęte założenia: rury z kolektora wchodzą przez ścianę 230 mm nad posadzką, instalacja domu i woda – przez strop. Wysokości króćców zasobnika z karty (sprawdź na swoim egzemplarzu). Rzeczy oznaczone „potwierdź” zależą od ustawień Luxtronik albo od napisu na zaworze.</p>`;
  const open = (id) => { $(id).hidden = false; };
  $('openBom').addEventListener('click', () => open('bomCard'));
  $('openSchema').addEventListener('click', () => open('schemaCard'));
  for (const id of ['bomCard', 'schemaCard']) $(id).addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) $(id).hidden = true; });
  $('copyBom').addEventListener('click', async () => {
    const txt = [...$('bomTable').querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\n/g, ' / ')).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(txt); $('copyBom').textContent = 'Skopiowano'; } catch { $('copyBom').textContent = 'Nie udało się skopiować'; }
    setTimeout(() => ($('copyBom').textContent = 'Kopiuj listę'), 1800);
  });
}

// ---------- przełączniki ----------
const toggles = { tPins: 'pins', tNames: 'names', tFlow: 'flow', tInsul: 'insul', tLabels: 'labels' };
for (const [id, key] of Object.entries(toggles)) {
  $(id).checked = ui[key];
  $(id).addEventListener('change', (e) => { ui[key] = e.target.checked; document.body.classList.toggle('names', ui.names); syncVisibility(); });
}
$('tSolo').addEventListener('change', (e) => { solo = e.target.checked; syncVisibility(); renderInfo(); });

// ---------- mysz ----------
let mouse = null, pickPending = false, downAt = null;
const cvs = renderer.domElement;
cvs.addEventListener('pointermove', (e) => {
  const r = viewport.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
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
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { select(null); for (const id of ['bomCard', 'schemaCard']) $(id).hidden = true; } });

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
const tmp = new V(), tmp2 = new V();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.ms), e = ease(k);
    controls.target.lerpVectors(flight.t1, flight.t2, e);
    camera.position.lerpVectors(flight.p1, flight.p2, e);
    if (k >= 1) flight = null;
  }
  controls.update();
  if (ui.flow) {
    for (const f of flowItems) {
      const u = (f.u0 + t * 0.06) % 1;
      f.curve.getPointAt(u, tmp);
      f.curve.getTangentAt(u, tmp2);
      f.m.position.copy(tmp);
      f.m.lookAt(tmp.clone().add(tmp2));
    }
  }
  if (pickPending && mouse) {
    pickPending = false;
    const p = pickAt(mouse.x, mouse.y);
    setHover(p ? p.el : null);
  }
  if (!tip.hidden && mouse) tip.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 18}px)`;
  for (const el of inst.elements) {
    el.pin.visible = ui.pins && shown(el);
    el.pinDiv.classList.toggle('occluded', !!el.occluded);
    el.pinDiv.classList.toggle('sel', el === selected);
    el.pinDiv.classList.toggle('hov', el === hovered);
  }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

const q = new URLSearchParams(location.search);
setView(q.get('view') ?? 'iso', true);
syncVisibility();
if (q.get('names') === '1') { ui.names = true; $('tNames').checked = true; document.body.classList.add('names'); }
if (q.get('flow') === '0') { ui.flow = false; $('tFlow').checked = false; syncVisibility(); }
for (const [k, id] of [['pins', 'tPins'], ['insul', 'tInsul'], ['labels', 'tLabels']]) if (q.get(k) === '0') { ui[k] = false; $(id).checked = false; syncVisibility(); }
if (q.get('cam')) {
  const [x, y, z, tx, ty, tz] = q.get('cam').split(',').map(Number);
  controls.target.set(tx, ty, tz);
  camera.position.set(x, y, z);
}
const pre = inst.elements.find((e) => e.id === q.get('sel'));
if (pre) select(pre);
if (q.get('bom') === '1') $('bomCard').hidden = false;
if (q.get('schema') === '1') $('schemaCard').hidden = false;
$('loading').remove();
window.__inst = { inst, parts, setView, select };
