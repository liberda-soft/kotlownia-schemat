// Schemat hydrauliczny (SVG) – ten sam układ co ściana 3D, narysowany symbolami.
// Numery w kółkach odpowiadają numerom elementów na liście i w modelu.

export const C = {
  bIn: '#2f9e44', bOut: '#82c91e', hF: '#e03131', hR: '#1c7ed6', cS: '#f08c00', cR: '#7048e8',
  zw: '#15aabf', cwu: '#d6336c', odp: '#868e96', ink: '#2b3440', faint: '#868e96',
};

export function schematicSVG(no) {
  const n = (id) => no[id] ?? '';
  const o = [];
  const line = (pts, col, w = 4, dash = '') => o.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  const txt = (x, y, s, { size = 12, anchor = 'start', col = C.ink, weight = 400 } = {}) => o.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${col}" font-weight="${weight}">${s}</text>`);
  const tag = (x, y, id) => { if (!n(id)) return; o.push(`<g class="tag"><circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="${C.ink}" stroke-width="1.3"/><text x="${x}" y="${y + 4}" font-size="11" text-anchor="middle" font-weight="700" fill="${C.ink}">${n(id)}</text></g>`); };
  // symbole (oś x – poziomo, rot 90 – pionowo)
  const g = (x, y, rot, body) => o.push(`<g transform="translate(${x},${y}) rotate(${rot})">${body}</g>`);
  const valve = (x, y, rot = 0, col = C.ink) => g(x, y, rot, `<path d="M-11,-8 L11,8 L11,-8 L-11,8 Z" fill="#fff" stroke="${col}" stroke-width="2"/><circle r="3.2" fill="${col}"/>`);
  const check = (x, y, rot = 0) => g(x, y, rot, `<path d="M-10,-8 L8,0 L-10,8 Z" fill="#fff" stroke="${C.ink}" stroke-width="2"/><line x1="10" y1="-9" x2="10" y2="9" stroke="${C.ink}" stroke-width="2.4"/>`);
  const pump = (x, y, rot = 0, col = C.ink, dash = '') => g(x, y, rot, `<circle r="15" fill="#fff" stroke="${col}" stroke-width="2.2"${dash ? ` stroke-dasharray="${dash}"` : ''}/><path d="M-8,-10 L12,0 L-8,10" fill="none" stroke="${col}" stroke-width="2"/>`);
  const strainer = (x, y, rot = 0) => g(x, y, rot, `<path d="M-12,-8 L12,-8 L12,8 L-12,8 Z" fill="#fff" stroke="${C.ink}" stroke-width="2"/><path d="M-8,-8 L8,8 M0,-8 L12,4" stroke="${C.ink}" stroke-width="1.4"/>`);
  const fill = (x, y) => { valve(x, y); o.push(`<path d="M${x - 16},${y} v20 M${x + 16},${y} v20" stroke="${C.ink}" stroke-width="2"/><circle cx="${x - 16}" cy="${y + 24}" r="4" fill="#fff" stroke="${C.ink}" stroke-width="1.6"/><circle cx="${x + 16}" cy="${y + 24}" r="4" fill="#fff" stroke="${C.ink}" stroke-width="1.6"/>`); };
  const sv = (x, y, label, col = C.ink) => { o.push(`<path d="M${x},${y} v-14" stroke="${col}" stroke-width="2.2"/><path d="M${x - 9},${y - 14} L${x + 9},${y - 14} L${x},${y - 28} Z" fill="#fff" stroke="${col}" stroke-width="2"/><path d="M${x},${y - 28} l-5,-4 l10,-4 l-10,-4 l10,-4 l-5,-3" fill="none" stroke="${col}" stroke-width="1.6"/>`); if (label) txt(x + 12, y - 24, label, { size: 10.5, col }); };
  const gauge = (x, y) => o.push(`<path d="M${x},${y} v-12" stroke="${C.ink}" stroke-width="2"/><circle cx="${x}" cy="${y - 21}" r="9" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/><path d="M${x},${y - 21} l5,-5" stroke="#d0312d" stroke-width="1.6"/>`);
  const vent = (x, y) => o.push(`<path d="M${x},${y} v-12" stroke="${C.ink}" stroke-width="2"/><rect x="${x - 6}" y="${y - 26}" width="12" height="14" rx="2" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/><path d="M${x},${y - 26} v-6" stroke="${C.ink}" stroke-width="1.6"/>`);
  const thermo = (x, y, t = 'T') => o.push(`<path d="M${x},${y} v-10" stroke="${C.ink}" stroke-width="2"/><circle cx="${x}" cy="${y - 19}" r="9" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/><text x="${x}" y="${y - 15}" font-size="10" text-anchor="middle" fill="${C.ink}">${t}</text>`);
  const vessel = (x, y, col, h = 54) => o.push(`<path d="M${x},${y} v10" stroke="${C.ink}" stroke-width="2"/><rect x="${x - 17}" y="${y + 10}" width="34" height="${h}" rx="15" fill="${col}" stroke="${C.ink}" stroke-width="1.8"/><line x1="${x - 17}" y1="${y + 10 + h / 2}" x2="${x + 17}" y2="${y + 10 + h / 2}" stroke="#fff" stroke-width="1.6"/>`);
  const tundish = (x, y) => o.push(`<path d="M${x - 9},${y} L${x + 9},${y} L${x + 3},${y + 10} L${x - 3},${y + 10} Z" fill="#fff" stroke="${C.odp}" stroke-width="1.8"/><path d="M${x},${y + 10} v14" stroke="${C.odp}" stroke-width="2.4"/>`);
  const flex = (x, y, rot = 0) => g(x, y, rot, `<path d="M-12,0 q3,-7 6,0 t6,0 t6,0 t6,0" fill="none" stroke="${C.ink}" stroke-width="2"/>`);
  const mag = (x, y) => o.push(`<rect x="${x - 13}" y="${y - 10}" width="26" height="40" rx="6" fill="#fff" stroke="${C.ink}" stroke-width="2"/><path d="M${x - 6},${y + 4} h12 M${x - 6},${y + 12} h12 M${x - 6},${y + 20} h12" stroke="${C.ink}" stroke-width="1.4"/><text x="${x}" y="${y + 44}" font-size="9.5" text-anchor="middle" fill="${C.faint}">N S</text>`);
  const msv = (x, y, rot = 0) => g(x, y, rot, `<path d="M-11,-8 L11,8 L11,-8 L-11,8 Z" fill="#fff" stroke="${C.ink}" stroke-width="2"/><path d="M0,0 L0,-15 M-6,-15 h12" stroke="${C.ink}" stroke-width="2"/><path d="M-14,10 L14,-10" stroke="${C.ink}" stroke-width="1.4"/>`);
  const hop = (x, y, col, vertical = true) => (vertical
    ? o.push(`<path d="M${x},${y - 10} a10,10 0 0,1 0,20" fill="none" stroke="${col}" stroke-width="4"/><path d="M${x},${y - 10} v-0.1" stroke="#fff"/>`)
    : o.push(`<path d="M${x - 10},${y} a10,10 0 0,1 20,0" fill="none" stroke="${col}" stroke-width="4"/>`));

  o.push(`<svg viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  o.push(`<rect width="1200" height="800" fill="#fbfbfa"/>`);

  // ---------- dolne źródło ----------
  o.push(`<path d="M40,700 q20,-50 40,0 t40,0 t40,0 t40,0" fill="none" stroke="${C.bIn}" stroke-width="3"/><path d="M40,730 q20,-50 40,0 t40,0 t40,0 t40,0" fill="none" stroke="${C.bOut}" stroke-width="3"/>`);
  txt(40, 770, 'Kolektor gruntowy (glikol, rozdzielacz pętli poza kotłownią)', { size: 11.5, col: C.faint });
  line([[40, 700], [40, 470], [380, 470]], C.bIn);
  line([[200, 730], [215, 730], [215, 655], [380, 655]], C.bOut);
  valve(40, 560, 90); tag(18, 560, 'b-zawory');
  fill(95, 470); tag(95, 506, 'b-plukanie');
  strainer(135, 470); tag(135, 506, 'b-filtr');
  // grupa bezpieczeństwa solanki: zawór 3 bar, manometr, odpowietrznik na konsoli + naczynie
  line([[178, 470], [178, 446]], C.bIn, 2.4);
  o.push(`<rect x="160" y="440" width="44" height="6" fill="#e03131"/>`);
  gauge(166, 440); sv(182, 440, ''); vent(198, 440);
  txt(182, 392, 'wyrzut → kanister', { size: 9.5, anchor: 'middle', col: C.faint });
  line([[178, 470], [178, 488]], C.bIn, 2.4);
  vessel(178, 488, '#e03131', 44); tag(208, 520, 'b-grupa');
  pump(250, 470, 0, C.ink); tag(250, 440, 'b-pompa'); txt(250, 502, 'wspomagająca', { size: 9.5, anchor: 'middle', col: C.faint });
  valve(300, 470); flex(352, 470); tag(300, 440, 'b-zpc');
  thermo(326, 470);
  valve(300, 655); flex(352, 655); thermo(270, 655); vent(245, 655); tag(270, 690, 'b-term'); tag(245, 610, 'b-odp');
  txt(40, 360, 'DOLNE ŹRÓDŁO', { size: 13, weight: 700, col: C.bIn });
  txt(40, 376, 'glikol ≥ 25 % · 3,6 m³/h · otulina kauczukowa', { size: 10.5, col: C.faint });

  // ---------- pompa ciepła ----------
  o.push(`<rect x="380" y="380" width="200" height="330" rx="12" fill="#eef0f2" stroke="${C.ink}" stroke-width="2"/>`);
  txt(480, 404, 'SWC 170H', { size: 14, weight: 700, anchor: 'middle' });
  txt(480, 420, 'alpha innotec · 16,7 kW B0/W35', { size: 10.5, anchor: 'middle', col: C.faint });
  tag(560, 396, 'hp');
  o.push(`<rect x="400" y="440" width="70" height="250" rx="6" fill="#e3f2e6" stroke="${C.bIn}" stroke-dasharray="4 3"/><rect x="490" y="440" width="70" height="250" rx="6" fill="#fde8e8" stroke="${C.hF}" stroke-dasharray="4 3"/>`);
  txt(435, 455, 'parownik', { size: 9.5, anchor: 'middle', col: C.faint }); txt(525, 455, 'skraplacz', { size: 9.5, anchor: 'middle', col: C.faint });
  line([[380, 470], [435, 470], [435, 500]], C.bIn, 2.6); line([[435, 640], [435, 655], [380, 655]], C.bOut, 2.6);
  pump(435, 520, 90, C.bIn, '3 2'); txt(435, 552, 'VBO', { size: 9.5, anchor: 'middle', col: C.bIn, weight: 700 });
  o.push(`<rect x="415" y="572" width="40" height="50" rx="14" fill="#fff" stroke="${C.bIn}" stroke-dasharray="3 2"/>`); txt(435, 634, '18 l', { size: 9.5, anchor: 'middle', col: C.bIn });
  line([[580, 655], [525, 655], [525, 620]], C.hR, 2.6); line([[525, 480], [525, 450], [580, 450]], C.hF, 2.6);
  pump(525, 600, -90, C.hF, '3 2'); txt(525, 578, 'HUP→ZUP', { size: 9.5, anchor: 'middle', col: C.hF, weight: 700 });
  o.push(`<path d="M512,520 h26 M512,530 h26 M512,540 h26" stroke="${C.hF}" stroke-width="1.4"/>`); txt(525, 512, 'grzałka 9 kW', { size: 9, anchor: 'middle', col: C.hF });
  o.push(`<rect x="410" y="360" width="56" height="20" rx="4" fill="#fff" stroke="${C.ink}"/><rect x="494" y="360" width="56" height="20" rx="4" fill="#fff" stroke="${C.ink}"/>`);
  txt(438, 374, 'gr. sol.', { size: 9, anchor: 'middle' }); txt(522, 374, 'gr. c.o.', { size: 9, anchor: 'middle' }); tag(580, 366, 'hp-grupy');
  txt(480, 704, 'pompy i naczynie solanki w środku', { size: 9.5, anchor: 'middle', col: C.faint });

  // ---------- obieg pompy ciepła ----------
  line([[580, 450], [690, 450]], C.hF);
  flex(600, 450); valve(632, 450); tag(632, 422, 'p-zawory'); thermo(660, 450, 'p'); tag(660, 408, 'p-termoman');
  vent(682, 450); tag(682, 405, 'p-odp');
  // zawór trójdrogowy
  o.push(`<g transform="translate(715,450)"><path d="M-20,-9 L0,0 L-20,9 Z M20,-9 L0,0 L20,9 Z M-9,-20 L0,0 L9,-20 Z" fill="#fff" stroke="${C.ink}" stroke-width="2"/><rect x="-10" y="-40" width="20" height="14" rx="2" fill="${C.ink}"/><text x="-26" y="20" font-size="10" fill="${C.faint}">AB</text><text x="0" y="-46" font-size="10" text-anchor="middle" fill="${C.faint}">M</text></g>`);
  tag(690, 487, 'p-3d'); txt(722, 300, 'A → c.w.u.', { size: 9.5, col: C.faint }); txt(752, 472, 'B → c.o.', { size: 9.5, col: C.faint });
  line([[690, 450], [695, 450]], C.hF);
  line([[715, 430], [715, 160], [770, 160]], C.hF);
  vent(715, 160);
  line([[735, 450], [850, 450]], C.hF);
  msv(800, 450); tag(800, 418, 'p-msv');
  // sprzęgło
  o.push(`<rect x="850" y="420" width="44" height="210" rx="10" fill="#2b2e33"/>`);
  txt(872, 412, 'sprzęgło', { size: 10.5, anchor: 'middle', weight: 600 }); tag(905, 404, 'p-sprz');
  o.push(`<circle cx="864" cy="600" r="4" fill="#ffd43b"/>`); txt(838, 640, 'TRL', { size: 9.5, col: C.faint, anchor: 'end' });
  // powroty
  line([[850, 600], [820, 600], [820, 655], [580, 655]], C.hR);
  line([[770, 330], [745, 330], [745, 655]], C.hR);
  o.push(`<path d="M745,440 v20" stroke="#fbfbfa" stroke-width="8"/><path d="M745,440 a10,10 0 0,1 0,20" fill="none" stroke="${C.hR}" stroke-width="4"/>`);
  mag(698, 655); valve(724, 655); tag(698, 712, 'p-filtr');
  valve(632, 655); flex(600, 655); thermo(660, 655, 'p');
  txt(600, 760, 'OBIEG POMPY CIEPŁA', { size: 13, weight: 700, col: C.hF });
  txt(600, 777, 'Cu 35 · przez PC najwyżej 3,5 m³/h', { size: 10.5, col: C.faint });

  // ---------- c.o. domu ----------
  line([[894, 450], [1090, 450]], C.cS);
  pump(940, 450); tag(940, 420, 's-pompa'); valve(980, 450); thermo(1010, 450); tag(1010, 408, 's-term');
  line([[1090, 600], [894, 600]], C.cR);
  // grupa bezpieczeństwa c.o. i naczynie 35 l na powrocie
  line([[1040, 600], [1040, 625]], C.cR, 2.4);
  vessel(1040, 625, '#e03131', 58); tag(1075, 670, 's-grupa');
  sv(1040, 600, ''); gauge(1062, 600); vent(1018, 600);
  o.push(`<path d="M1040,572 h22 v86" stroke="${C.odp}" stroke-width="1.8" fill="none"/>`);
  tundish(1062, 700);
  o.push(`<rect x="1090" y="420" width="90" height="210" rx="8" fill="#fff" stroke="${C.ink}" stroke-width="1.6"/>`);
  for (let i = 0; i < 6; i++) o.push(`<path d="M${1102 + i * 13},432 v80" stroke="${C.cS}" stroke-width="3"/>`);
  o.push(`<path d="M1100,560 h70 v14 h-70 v14 h70 v14 h-70" fill="none" stroke="${C.cR}" stroke-width="2"/>`);
  txt(1135, 528, 'grzejniki /', { size: 10, anchor: 'middle', col: C.faint }); txt(1135, 541, 'podłogówka', { size: 10, anchor: 'middle', col: C.faint });
  txt(900, 760, 'C.O. DOMU (ZA SPRZĘGŁEM)', { size: 13, weight: 700, col: C.cS });
  txt(900, 777, 'przepływ ≤ 0,9 × przepływ PC', { size: 10.5, col: C.faint });

  // ---------- c.w.u. ----------
  o.push(`<rect x="770" y="60" width="120" height="300" rx="34" fill="#f1f3f5" stroke="${C.ink}" stroke-width="2"/>`);
  o.push(`<path d="M770,160 h20 q14,8 0,16 q-14,8 0,16 q14,8 0,16 q-14,8 0,16 q14,8 0,16 q-14,8 0,16 q14,8 0,16 q-14,8 0,16 q14,6 0,12 h-20" fill="none" stroke="${C.hF}" stroke-width="2.4"/>`);
  txt(830, 52, 'Sunex FISH S15 300', { size: 11.5, anchor: 'middle', weight: 700 }); tag(905, 64, 'tank');
  o.push(`<path d="M850,80 v120" stroke="#adb5bd" stroke-width="5"/>`); txt(856, 218, 'anoda', { size: 9.5, col: C.faint });
  o.push(`<circle cx="812" cy="250" r="5" fill="#ffd43b" stroke="${C.ink}"/>`); txt(818, 266, 'TBW', { size: 9.5, col: C.faint }); tag(800, 290, 'w-czujnik');
  line([[1190, 330], [890, 330]], C.zw);
  valve(1160, 330, 0, C.ink); tag(1160, 300, 'w-zawor');
  o.push(`<rect x="1108" y="318" width="26" height="24" rx="3" fill="#fff" stroke="${C.ink}" stroke-width="1.8"/><path d="M1114,330 h14 M1121,323 v14" stroke="${C.ink}" stroke-width="1.4"/>`); tag(1121, 300, 'w-fk06');
  // grupa bezpieczeństwa c.w.u.
  valve(1080, 330); check(1056, 330); sv(1036, 330, '6 bar'); tundish(1036, 344); tag(1056, 300, 'w-grupa');
  line([[990, 330], [990, 132]], C.zw, 3);
  line([[906, 330], [906, 348]], C.zw, 2.4); vessel(906, 338, '#f8f9fa', 40); tag(936, 372, 'w-naczynie');
  line([[800, 358], [800, 368]], C.zw, 2.4); valve(800, 378, 90); tag(778, 378, 'w-spust');
  line([[890, 100], [975, 100]], C.cwu);
  line([[1005, 100], [1190, 100]], C.cwu);
  o.push(`<g transform="translate(990,100)"><circle r="15" fill="#fff" stroke="${C.ink}" stroke-width="2"/><path d="M-8,6 L8,-6" stroke="${C.ink}" stroke-width="2"/><text x="0" y="-22" font-size="10" text-anchor="middle" fill="${C.faint}">TMV</text></g>`); tag(990, 62, 'w-mieszacz');
  valve(1040, 100); thermo(1075, 100); tag(1040, 132, 'w-zawor-cwu');
  txt(1196, 92, 'c.w.u. do kranów', { size: 10.5, anchor: 'end', col: C.cwu });
  txt(1196, 352, 'woda z sieci', { size: 10.5, anchor: 'end', col: C.zw });
  txt(1002, 236, 'C.W.U.', { size: 13, weight: 700, col: C.zw });
  txt(1002, 252, 'reduktor 3,5 bar · zawór 6 bar', { size: 10.5, col: C.faint });
  txt(1002, 267, 'naczynie między grupą', { size: 10.5, col: C.faint });
  txt(1002, 282, 'a zasobnikiem', { size: 10.5, col: C.faint });

  // ---------- legenda ----------
  const leg = [['bIn', 'solanka z gruntu'], ['bOut', 'solanka do gruntu'], ['hF', 'zasilanie z PC'], ['hR', 'powrót do PC'], ['cS', 'zasilanie c.o. domu'], ['cR', 'powrót c.o. domu'], ['zw', 'woda zimna'], ['cwu', 'c.w.u.'], ['odp', 'wyrzut zaworów']];
  leg.forEach(([k, s], i) => { const x = 40 + (i % 5) * 150, y = 22 + Math.floor(i / 5) * 18; o.push(`<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${C[k]}" stroke-width="4"/>`); txt(x + 32, y + 4, s, { size: 11 }); });
  txt(40, 76, 'Sterowanie Luxtronik 2.0: zawór 3D → BUP · czujnik TRL w sprzęgle (tryb „Trennspeicher”) · pompy wg instrukcji ait (patrz opis pomp)', { size: 10.5, col: C.faint });
  o.push('</svg>');
  return o.join('');
}
