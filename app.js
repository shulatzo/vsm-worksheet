import { parseVsm, buildModel, top, ZONE_GRID } from './vsm.js';

/* ───────── yardımcılar ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const up = s => String(s || '').toLocaleUpperCase('tr');
const html = document.documentElement;

function toast(msg, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ───────── kalıcı ayarlar ve düzenlemeler (localStorage) ───────── */
const LS_KEY = 'vsmws.v1';
let store = {};
try { store = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { store = {}; }
store.edits ||= {}; store.sel ||= {}; store.hidden ||= {};
store.theme ||= 'light'; store.printTheme ||= 'light';
store.minAtt ??= true; store.cardsPer ||= 3; store.myTeam ??= '';
let saveTimer;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* depolama kapalı */ } }, 150);
};

// Sayfa kapanırken veya sekme arka plana giderken bekleyen kaydı hemen yaz.
const flush = () => { clearTimeout(saveTimer); try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* yoksay */ } };
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

/* ───────── ham dosyalar (IndexedDB) ───────── */
const idb = {
  db: null,
  async open() {
    if (!window.indexedDB) return;
    await new Promise((res, rej) => {
      const r = indexedDB.open('vsmws', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(mode, fn) {
    return new Promise((res, rej) => {
      if (!this.db) return res([]);
      const q = fn(this.db.transaction('files', mode).objectStore('files'));
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  all() { return this.req('readonly', s => s.getAll()); },
  put(v) { return this.req('readwrite', s => s.put(v)); },
  del(id) { return this.req('readwrite', s => s.delete(id)); },
};

/* ───────── durum ───────── */
let files = [];          // {id, name, text, use, parsed}
let teamCode = null;
let model = null;
const cardStats = new Map(); // kart anahtarı -> {s}
let selTok = null;       // {key, tid}

/* ───────── dosya ekleme ───────── */
async function addFiles(list) {
  let added = 0;
  for (const f of list) {
    try {
      const text = await f.text();
      const parsed = parseVsm(text, f.name);
      if (files.some(x => x.id === parsed.id)) { toast(`${f.name} zaten ekli.`); continue; }
      const rec = { id: parsed.id, name: f.name, text, use: true };
      files.push({ ...rec, parsed });
      try { await idb.put(rec); } catch { /* kalıcı depolama olmadan devam */ }
      added++;
    } catch (err) {
      toast(`${f.name}: ${err.message}`, 6000);
    }
  }
  if (added) { pickTeam(files[files.length - 1]); refresh(); toast(`${added} dosya eklendi.`); }
}

function teamsFound() {
  const m = {};
  files.filter(f => f.use).forEach(f => ['home', 'away'].forEach(s => {
    const t = f.parsed.teams[s];
    (m[t.code] ||= { code: t.code, name: t.name, n: 0 }).n++;
  }));
  return Object.values(m).sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
}

function pickTeam(file) {
  if (teamCode && teamsFound().some(t => t.code === teamCode)) return;
  teamCode = file ? file.parsed.teams.home.code : (teamsFound()[0] || {}).code || null;
}

/* ───────── ana yenileme ───────── */
function refresh() {
  const ts = teamsFound();
  if (!ts.some(t => t.code === teamCode)) teamCode = ts[0] ? ts[0].code : null;
  model = teamCode ? buildModel(files.filter(f => f.use).map(f => f.parsed), teamCode) : null;
  renderSide();
  renderSheet();
}

/* ───────── yan panel ───────── */
const isSelected = pl => {
  const o = (store.sel[teamCode] || {})[pl.no];
  if (o != null) return o;
  return !store.minAtt || pl.s.n >= 5;
};

function displayName(no) {
  const custom = store.edits[`name|${teamCode}|${no}`];
  if (custom != null) return custom;
  const r = (model && model.roster[no]) || { first: '', last: '' };
  return up(`${(r.first || '').split(/\s+/)[0]} ${r.last}`.trim());
}
const shortName = no => {
  const custom = store.edits[`name|${teamCode}|${no}`];
  if (custom != null) return custom.split(/\s+/)[0];
  const r = (model && model.roster[no]) || {};
  return up((r.first || r.last || '').trim().split(/\s+/)[0]);
};

function renderSide() {
  $('#fileList').innerHTML = files.map((f, i) => `
    <li><input type="checkbox" data-use="${i}" ${f.use ? 'checked' : ''} aria-label="Kullan">
      <span class="t" title="${esc(f.name)}">${esc(f.parsed.label)}</span>
      <button data-rm="${i}" aria-label="Dosyayı kaldır" title="Kaldır">×</button></li>`).join('');

  const ts = teamsFound();
  $('#teamSel').innerHTML = ts.map(t => `<option value="${esc(t.code)}" ${t.code === teamCode ? 'selected' : ''}>${esc(t.code)} · ${esc(t.name)} (${t.n} maç)</option>`).join('') || '<option>—</option>';

  $('#minAtt').checked = !!store.minAtt;
  $('#cardsPer').value = String(store.cardsPer);
  $('#playerList').innerHTML = model ? model.players.map(p => `
    <li><input type="checkbox" data-pl="${p.no}" ${isSelected(p) ? 'checked' : ''} aria-label="#${p.no}">
      <span>#${String(p.no).padStart(2, '0')} ${esc(displayName(p.no))}</span><span class="n">${p.s.n}</span></li>`).join('') : '';
  $('#empty').style.display = files.length ? 'none' : '';
}

/* ───────── sayfa ───────── */
const metaKey = () => `meta|${teamCode}`;
const getMeta = () => (store.edits[metaKey()] ||= { right: model ? model.code : '', date: '', strat: '', notes: '', lineup: 0 });

const TARGETS = [['F', '4 (smaçör)', 'k1'], ['C', 'Orta', 'k2'], ['B', 'Arka · 2', 'k3'], ['P', 'Pipe', 'k4'], ['S', 'Pasörün kendisi', 'k5']];
const CELLS = [
  ['front|sideout', 'Pasör ön sırada · karşılama sonrası'],
  ['front|transition', 'Pasör ön sırada · geçiş (savunma sonrası)'],
  ['back|sideout', 'Pasör arka sırada · karşılama sonrası'],
  ['back|transition', 'Pasör arka sırada · geçiş (savunma sonrası)'],
];

function stratHTML() {
  const bars = CELLS.map(([k, title]) => {
    const c = model.matrix[k];
    if (!c) return `<div><div class="bar-t">${title}<span>veri yok</span></div></div>`;
    const known = TARGETS.reduce((a, [t]) => a + (c.t[t] || 0), 0);
    const segs = TARGETS.filter(([t]) => c.t[t]).map(([t, lab, cls]) =>
      `<i class="${cls}" style="flex:${c.t[t]}" title="${lab}: ${c.t[t]}">${pct(c.t[t], known) >= 12 ? pct(c.t[t], known) + '%' : ''}</i>`).join('');
    return `<div><div class="bar-t">${title}<span>${c.n} set</span></div><div class="stack">${segs}</div></div>`;
  }).join('');
  const key = TARGETS.map(([, lab, cls]) => `<span><i class="${cls}"></i>${lab}</span>`).join('');
  const setters = model.setters.map(([no, n]) => `#${String(no).padStart(2, '0')} ${esc(shortName(no))} (${n} set)`).join(', ');
  return `
    <div class="tag">STRATEJİ</div>
    <div class="box">
      <div class="bar-t" style="margin-bottom:10px">Pasör: ${setters || '—'}</div>
      <div class="bars">${bars}</div>
      <div class="key">${key}</div>
      <textarea class="notes" data-meta="strat" style="margin-top:12px" placeholder="Strateji notları…">${esc(getMeta().strat)}</textarea>
    </div>`;
}

function lineupHTML() {
  if (!model.lineups.length) return '';
  const cell = (L, pos) => {
    const no = parseInt(L.positions[pos], 10);
    return `<div class="pl ${String(pos) === String(L.setterAt) ? 'set' : ''}"><b>${String(no).padStart(2, '0')}</b><span>${esc(shortName(no))}</span></div>`;
  };
  const scoreHTML = sc => sc
    ? `<span class="lu-sc"><span class="${sc.home > sc.away ? 'w' : ''}">${sc.home}</span>–<span class="${sc.away > sc.home ? 'w' : ''}">${sc.away}</span></span>`
    : '';
  const items = model.lineups.map(L => `
    <div class="lu">
      <div class="lu-t"><span>${esc(L.matchLabel)} · Set ${L.set}</span>${scoreHTML(L.score)}</div>
      <div class="lineup sm"><div class="netb"></div>
        <div class="grid">${[4, 3, 2].map(p => cell(L, p)).join('')}<div class="div"></div>${[5, 6, 1].map(p => cell(L, p)).join('')}</div>
      </div>
    </div>`).join('');
  return `
    <div class="tag">İLK ALTI</div>
    <div class="box" style="padding:10px">
      ${items}
      <p class="hint">Turuncu daire pasör. Libero: ${model.libs.map(n => '#' + n).join(', ') || '—'}.</p>
    </div>`;
}

const LEGEND = `
  <div class="legend" aria-label="Gösterge">
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><polygon points="11,2 2,16 22,16" fill="var(--accent)" opacity=".5"/></svg>Ana yön</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><line x1="3" y1="15" x2="17" y2="6" stroke="var(--alt)" stroke-width="3"/><polygon points="24,3 14,5 21,12" fill="var(--alt)"/></svg>Alternatif yön</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><rect x="2" y="2" width="22" height="14" fill="var(--accent)" opacity=".4"/></svg>Topun indiği bölge (kaç kez)</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><rect x="2" y="2" width="22" height="14" fill="var(--start)" opacity=".45"/><circle cx="13" cy="9" r="5" fill="var(--card)" stroke="var(--start)" stroke-width="2"/></svg>Hücumun başladığı bölge</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><rect x="3" y="2" width="9" height="14" rx="2" fill="var(--block)"/><rect x="14" y="2" width="9" height="14" rx="2" fill="var(--block)"/></svg>Blok (B1/B2/B3)</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><ellipse cx="13" cy="9" rx="11" ry="7" fill="none" stroke="var(--ringA)" stroke-width="2.5"/></svg>Savunma A</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><ellipse cx="13" cy="9" rx="11" ry="7" fill="none" stroke="var(--ringB)" stroke-width="2.5"/></svg>Savunma B</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><circle cx="13" cy="9" r="7" fill="none" stroke="var(--tok)" stroke-width="1.8" stroke-dasharray="3 2"/></svg>Tip kapama</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><line x1="2" y1="9" x2="16" y2="9" stroke="var(--tok)" stroke-width="2"/><polygon points="16,4 25,9 16,14" fill="var(--tok)"/></svg>Oyuncunun adımı</div>
    <div><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><polygon points="3,15 12,3 23,12" fill="var(--accent)" fill-opacity=".3" stroke="var(--accent)" stroke-width="2"/></svg>Bölge (çokgen)</div>
  </div>`;

function renderSheet() {
  const body = $('#sheetBody');
  cardStats.clear();
  if (!model || !model.players.length) {
    body.innerHTML = files.length ? '<div class="empty"><p>Seçili takım için hücum kaydı bulunamadı.</p></div>' : '';
    return;
  }
  const meta = getMeta();
  const left = store.myTeam;
  const chosen = model.players.filter(p => isSelected(p) && !p.isLibero);

  body.innerHTML = `
  <div class="paper">
    <div class="match-head">
      <div class="side-t" contenteditable="true" spellcheck="false" data-my data-ph="Takımınız">${esc(left)}</div>
      <div class="mid"><small>MAÇ GÜNÜ</small><b contenteditable="true" spellcheck="false" data-meta="date" data-ph="gg.aa.yyyy">${esc(meta.date)}</b></div>
      <div class="side-t" contenteditable="true" spellcheck="false" data-meta="right" data-ph="Rakip">${esc(meta.right)}</div>
    </div>
    <div class="cols">
      <div>${stratHTML()}</div>
      <div>${lineupHTML()}</div>
    </div>
    <div style="margin-top:18px"><div class="tag">NOTLAR</div><textarea class="notes" data-meta="notes" style="margin-top:8px" placeholder="Genel notlar…">${esc(meta.notes)}</textarea></div>
    <div style="margin-top:22px"><div class="tag">HÜCUM YÖNLERİ</div></div>
    ${LEGEND}
    ${chosen.map(playerHTML).join('')}
  </div>`;
}

/* ───────── oyuncu bölümü ve kartlar ───────── */
function playerHTML(pl) {
  let combos = pl.combos.filter(c => c.s.n >= 3).slice(0, store.cardsPer);
  if (!combos.length) combos = pl.combos.slice(0, 1);
  combos = combos.filter(c => !store.hidden[`${teamCode}|${pl.no}|${c.code}`]);
  const s = pl.s;
  return `
  <section class="player" data-no="${pl.no}">
    <div class="ph">
      <div class="hn">#${String(pl.no).padStart(2, '0')} <span contenteditable="true" spellcheck="false" data-name="${pl.no}">${esc(displayName(pl.no))}</span></div>
      ${pl.role ? `<span class="role">${esc(pl.role)}</span>` : ''}
      <span class="tot">${s.n} vuruş · sayı %${pct(s.k, s.n)} · hata %${pct(s.e, s.n)}</span>
    </div>
    <div class="grid3">${combos.map(c => cardHTML(pl, c)).join('')}</div>
  </section>`;
}

const POS_SUGGEST = ['Çizgide savunma', 'İçeride savunma', 'Savunma A', 'Savunma B', 'Tip kapama', 'Sağa adım', 'Sola adım', 'Saha ortası', 'Standart', 'Off line'];
const ADD_OPTS = [['def', 'Savunmacı'], ['blk', 'Blok'], ['set', 'Pasör'], ['ringA', 'Savunma A halkası'], ['ringB', 'Savunma B halkası'], ['tip', 'Tip kapama'], ['step', 'Adım oku'], ['lab', 'Etiket'], ['poly3', '△ Üçgen bölge'], ['poly4', '▭ Dörtgen bölge'], ['poly5', '⬠ Beşgen bölge'], ['poly6', '⬡ Altıgen bölge'], ['_style', '◐ Bölge rengini değiştir'], ['_big', '＋ Seçiliyi büyüt'], ['_small', '－ Seçiliyi küçült'], ['_rot', '↻ Seçiliyi döndür'], ['_del', '✕ Seçiliyi sil']];

function cardHTML(pl, c) {
  const key = `${teamCode}|${pl.no}|${c.code}`;
  const ed = getEdit(key, c.s);
  cardStats.set(key, { s: c.s, no: pl.no });
  const s = c.s;
  const sz = top(s.sz, 2).map(([z, n]) => `${z}. bölge %${pct(n, s.n)}`).join(', ') || '—';
  const bk = top(s.blk, 1)[0];
  const phN = s.phase.sideout + s.phase.transition + s.phase.free;
  const facts = [
    `<b>${s.n}</b> vuruş · sayı <b>%${pct(s.k, s.n)}</b> · hata <b>%${pct(s.e, s.n)}</b> · bloke <b>%${pct(s.b, s.n)}</b>`,
    `Çıkış: ${sz}`,
    bk ? `Karşıda: <b>B${bk[0]}</b> (%${pct(bk[1], s.blkN)})` : '',
    s.tip ? `Tip: %${pct(s.tip, s.n)}` : '',
    phN ? `Karşılama sonrası %${pct(s.phase.sideout, phN)} (${s.phase.sideout}) · savunma sonrası %${pct(s.phase.transition + s.phase.free, phN)} (${s.phase.transition + s.phase.free})` : '',
  ].filter(Boolean).join('<br>');
  const warn = s.lN < 5 ? `<div class="warn">Topun indiği bölge ${s.n} vuruşun yalnızca ${s.lN} tanesinde işaretlenmiş. Yönler az örneğe dayanıyor.</div>` : '';
  return `
  <article class="card" data-key="${esc(key)}">
    <div class="ct"><span class="nm" title="${esc(c.name)}">${esc(c.name)}</span><small>${esc(c.code)}</small></div>
    <div class="ctool">
      <select class="addtok" aria-label="Sembol ekle"><option value="">＋ Sembol ekle</option>${ADD_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="hide" aria-label="Kartı gizle">Kartı gizle</button></div>
    ${courtSVG(s, ed, pl.no)}
    <div class="rows">${[5, 1, 6].map(p => `<div class="r"><span class="p">POS.${p}</span><input type="text" list="posList" data-pos="${p}" value="${esc(ed.pos[p] || '')}" placeholder="…" aria-label="POS.${p}"></div>`).join('')}</div>
    <div class="facts">${facts}</div>
    ${warn}
    <textarea class="cnote" data-cnote placeholder="Kart notu…">${esc(ed.note || '')}</textarea>
  </article>`;
}

/* ───────── saha çizimi ───────── */
const X = m => 2 + m * 24;
const Y = m => 8 + m * (150 / 9);
const zc = z => { const g = ZONE_GRID[z]; return g ? [g[0] * 3 + 1.5, g[1] * 3 + 1.5] : null; };

// Rakip yarı saha, net hattının üstüne çizilir (yalnızca 2,3,4,7,8,9 bölgeleri).
const OFF = 100;           // rakip yarının yüksekliği
const MPX = 100 / 6;       // rakip yarıda metre başına piksel (6 m derinlik)
function startCell(z) {
  const g = ZONE_GRID[z];
  if (!g || g[1] > 1) return null;                 // arka sıra (5,6,1) çizilmez
  const col = 2 - g[0];                            // rakip bize bakar: sağ-sol ters
  const x0 = X(col * 3), y0 = 102 - (g[1] * 3 + 3) * MPX;
  return { z, x0, y0, w: 72, h: 3 * MPX, x: x0 + 36, y: y0 + 1.5 * MPX };
}

function originOf(s) {
  const main = top(Object.fromEntries(Object.entries(s.sz).filter(([z]) => startCell(+z))), 1)[0];
  const c = main && startCell(main[0]);
  return c ? { x: c.x, y: c.y - OFF, z: c.z } : { x: 110, y: -25, z: null };
}

function courtSVG(s, ed, no) {
  const o = originOf(s);
  const lz = top(s.lz, 9);
  const num = String(no).padStart(2, '0');

  // Rakip yarı saha ve hücumun başladığı bölgeler
  let opp = `<rect class="bg2" x="2" y="2" width="216" height="100"/>
    <line class="zl" x1="74" y1="2" x2="74" y2="102"/><line class="zl" x1="146" y1="2" x2="146" y2="102"/><line class="cl" x1="2" y1="52" x2="218" y2="52"/>`;
  [4, 3, 2, 7, 8, 9].forEach(z => { const c = startCell(z); opp += `<text class="zn" x="${c.x0 + 6}" y="${c.y0 + 13}">${z}</text>`; });
  const starts = top(s.sz, 9).filter(([z]) => startCell(z));
  const maxS = starts.length ? starts[0][1] : 1;
  starts.forEach(([z, n]) => {
    const c = startCell(z), main = z === o.z;
    opp += `<rect class="sheat" x="${c.x0}" y="${c.y0}" width="${c.w}" height="${c.h}" opacity="${(0.15 + 0.4 * n / maxS).toFixed(2)}"/>
      <circle class="sm${main ? ' main' : ''}" cx="${c.x}" cy="${c.y - 5}" r="11"/><text class="smt" x="${c.x}" y="${c.y - 1.5}">${num}</text>
      <text class="smn" x="${c.x}" y="${c.y + 19}">${n}×</text>`;
  });
  if (!starts.length) opp += `<text class="nodata" x="110" y="56">çıkış bölgesi işaretlenmemiş</text>`;

  // Bizim saha: iniş yoğunluğu, ana yön, alternatif yön
  let heat = '', dirs = '';
  if (s.lN) {
    heat = lz.map(([z, n]) => {
      const g = ZONE_GRID[z]; if (!g) return '';
      const x = X(g[0] * 3), y = Y(g[1] * 3), w = 72, h = 150 / 3;
      const op = (0.15 + 0.5 * (n / lz[0][1])).toFixed(2);
      return `<rect class="heat" x="${x}" y="${y}" width="${w}" height="${h}" opacity="${op}"/><text class="hl" x="${x + w / 2}" y="${y + h - 5}">${n}×</text>`;
    }).join('');
    const [m1, m2] = lz;
    if (s.lN >= 3 && m1 && zc(m1[0])) {
      const [zx, zy] = zc(m1[0]); const tx = X(zx), ty = Y(zy);
      dirs += `<polygon class="main" points="${o.x},${o.y} ${tx - 17},${ty} ${tx + 17},${ty}"/>`;
    }
    if (s.lN >= 4 && m2 && m2[1] / s.lN >= 0.2 && zc(m2[0])) {
      const [zx, zy] = zc(m2[0]); const tx = X(zx), ty = Y(zy);
      const a = Math.atan2(ty - o.y, tx - o.x), L = 9, W = 5;
      const bx = tx - Math.cos(a) * L, by = ty - Math.sin(a) * L;
      dirs += `<line class="altl" x1="${o.x}" y1="${o.y}" x2="${bx}" y2="${by}"/><polygon class="alth" points="${tx},${ty} ${bx - Math.sin(a) * W},${by + Math.cos(a) * W} ${bx + Math.sin(a) * W},${by - Math.cos(a) * W}"/>`;
    }
  } else {
    dirs = `<text class="nodata" x="110" y="96">topun indiği bölge işaretlenmemiş</text>`;
  }
  return `<svg class="court" viewBox="0 0 220 ${OFF + 162}" role="img" aria-label="Rakip hücum başlangıç bölgeleri ve bizim saha">
    ${opp}
    <g transform="translate(0 ${OFF})">
      <rect class="bg" x="2" y="8" width="216" height="150"/><rect class="netr" x="2" y="2" width="216" height="6"/>
      <line class="cl" x1="2" y1="${Y(3)}" x2="218" y2="${Y(3)}"/>
      ${heat}${dirs}
      <g class="toks">${ed.tokens.map(tokenSVG).join('')}</g>
    </g>
  </svg>`;
}

const r1 = v => Math.round(v * 10) / 10;
const tf = t => `translate(${t.x.toFixed(1)} ${t.y.toFixed(1)})${(t.type === 'step' || t.type === 'set') && t.rot ? ` rotate(${t.rot})` : ''}${t.s && t.s !== 1 ? ` scale(${t.s.toFixed(2)})` : ''}`;
const blkN = t => { const m = /^B(\d)/i.exec(String(t.text || '')); return m ? Math.min(3, Math.max(1, +m[1])) : 0; };
function handleAt(t) {
  const w = String(t.text || '').length;
  switch (t.type) {
    case 'blk': { const n = blkN(t); return [(n ? n * 17 + (n - 1) * 2 : Math.max(34, w * 8 + 12)) / 2, 12]; }
    case 'lab': return [Math.max(30, w * 6 + 12) / 2, 9];
    case 'set': return [11, 9];
    case 'ringA': case 'ringB': return [19, 16];
    case 'tip': return [15, 15];
    case 'step': return [22, 6];
    default: return [10, 10];
  }
}
function polySVG(t) {
  const sel = selTok && selTok.tid === t.id ? ' sel' : '';
  const P = t.pts.map(p => p.join(',')).join(' ');
  const eh = t.pts.map((p, i) => { const q = t.pts[(i + 1) % t.pts.length]; return `<circle class="eh" data-ei="${i}" cx="${(p[0] + q[0]) / 2}" cy="${(p[1] + q[1]) / 2}" r="4"/>`; }).join('');
  const vh = t.pts.map((p, i) => `<circle class="vh" data-vi="${i}" cx="${p[0]}" cy="${p[1]}" r="6"/>`).join('');
  return `<g class="tok t-poly st-${t.style || 'zone'}${sel}" data-tid="${t.id}"><polygon class="sh" points="${P}"/>${eh}${vh}</g>`;
}
function syncPoly(g, t) {
  g.querySelector('.sh').setAttribute('points', t.pts.map(p => p.join(',')).join(' '));
  g.querySelectorAll('.vh').forEach(c => { const p = t.pts[+c.dataset.vi]; c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); });
  g.querySelectorAll('.eh').forEach(c => { const i = +c.dataset.ei, a = t.pts[i], b = t.pts[(i + 1) % t.pts.length]; c.setAttribute('cx', (a[0] + b[0]) / 2); c.setAttribute('cy', (a[1] + b[1]) / 2); });
}

function tokenSVG(t) {
  if (t.type === 'poly') return polySVG(t);
  let inner = '';
  switch (t.type) {
    case 'def': inner = `<circle class="sh" r="10"/><text class="t">${esc(t.text)}</text>`; break;
    case 'blk': {
      const n = blkN(t);
      if (n) {
        const bw = 17, gap = 2, tot = n * bw + (n - 1) * gap;
        inner = Array.from({ length: n }, (_, i) => `<rect class="sh" x="${-tot / 2 + i * (bw + gap)}" y="-12" width="${bw}" height="24" rx="3"/>`).join('') + `<text class="t">${esc(t.text)}</text>`;
      } else {
        const w = Math.max(34, String(t.text).length * 8 + 12);
        inner = `<rect class="sh" x="${-w / 2}" y="-12" width="${w}" height="24" rx="3"/><text class="t">${esc(t.text)}</text>`;
      }
      break;
    }
    case 'set': inner = `<polygon class="sh" points="0,-11 11,9 -11,9"/>`; break;
    case 'ringA': case 'ringB': inner = `<ellipse class="sh" rx="19" ry="16"/>`; break;
    case 'tip': inner = `<circle class="sh" r="15"/>`; break;
    case 'step': inner = `<line class="sh" x1="-20" y1="0" x2="10" y2="0"/><polygon class="hd" points="10,-6 22,0 10,6"/>`; break;
    case 'lab': { const w = Math.max(30, String(t.text).length * 6 + 12); inner = `<rect class="sh" x="${-w / 2}" y="-9" width="${w}" height="18" rx="4"/><text class="t">${esc(t.text)}</text>`; break; }
  }
  const sel = selTok && selTok.tid === t.id ? ' sel' : '';
  const [hx, hy] = handleAt(t);
  const handle = `<g transform="translate(${hx} ${hy}) scale(${(1 / (t.s || 1)).toFixed(3)})"><circle class="rh" r="5.5"/></g>`;
  return `<g class="tok t-${t.type}${sel}" data-tid="${t.id}" transform="${tf(t)}">${inner}${handle}</g>`;
}

function getEdit(key, s) {
  if (store.edits[key]) return store.edits[key];
  const o = originOf(s);
  const bk = top(s.blk, 1)[0];
  const ed = {
    tokens: [
      { id: 't1', type: 'def', x: 40, y: 124, text: '5' },
      { id: 't2', type: 'def', x: 110, y: 138, text: '6' },
      { id: 't3', type: 'def', x: 180, y: 124, text: '1' },
      { id: 't4', type: 'blk', x: clamp(o.x, 26, 194), y: 22, text: bk ? `B${bk[0]}` : 'B2' },
    ],
    pos: {}, note: '', n: 4,
  };
  store.edits[key] = ed; save();
  return ed;
}

function redrawCard(key) {
  const art = [...document.querySelectorAll('.card')].find(a => a.dataset.key === key);
  const c = cardStats.get(key);
  if (!art || !c) return;
  const svg = art.querySelector('svg.court');
  svg.outerHTML = courtSVG(c.s, store.edits[key], c.no);
}

/* ───────── etkileşim ───────── */
const body = $('#sheetBody');
const svgPoint = (svg, e) => {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x, y: q.y - OFF };   // semboller bizim sahanın koordinatlarında tutulur
};
function select(key, tid) {
  document.querySelectorAll('.tok.sel').forEach(g => g.classList.remove('sel'));
  selTok = key ? { key, tid } : null;
  if (!key) return;
  const art = [...document.querySelectorAll('.card')].find(a => a.dataset.key === key);
  const g = art && [...art.querySelectorAll('.tok')].find(x => x.dataset.tid === tid);
  if (g) g.classList.add('sel');
}

let drag = null;
const cardOf = key => [...document.querySelectorAll('.card')].find(a => a.dataset.key === key);

body.addEventListener('pointerdown', e => {
  const g = e.target.closest('.tok');
  if (!g) { if (!e.target.closest('select,input,textarea,button,[contenteditable]')) select(null); return; }
  const key = g.closest('.card').dataset.key;
  const tok = store.edits[key].tokens.find(t => t.id === g.dataset.tid);
  if (!tok) return;
  const svg = g.ownerSVGElement, p = svgPoint(svg, e);
  const vh = e.target.closest('.vh'), eh = e.target.closest('.eh'), rh = e.target.closest('.rh');
  select(key, tok.id);

  if (tok.type === 'poly' && eh) {
    // kenar ortasından yeni köşe ekle ve hemen sürüklemeye başla
    const i = +eh.dataset.ei, a = tok.pts[i], b = tok.pts[(i + 1) % tok.pts.length];
    tok.pts.splice(i + 1, 0, [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)]);
    redrawCard(key); select(key, tok.id);
    const g2 = cardOf(key).querySelector(`.tok[data-tid="${tok.id}"]`);
    drag = { mode: 'vertex', tok, g: g2, svg: g2.ownerSVGElement, vi: i + 1, key };
    g2.querySelector(`.vh[data-vi="${i + 1}"]`).setPointerCapture(e.pointerId);
    e.preventDefault(); return;
  }
  if (tok.type === 'poly' && vh) {
    drag = { mode: 'vertex', tok, g, svg, vi: +vh.dataset.vi, key };
    vh.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  if (rh) {
    drag = { mode: 'scale', tok, g, svg, key, d0: Math.max(8, Math.hypot(p.x - tok.x, p.y - tok.y)), s0: tok.s || 1 };
    rh.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  drag = tok.type === 'poly'
    ? { mode: 'movepoly', tok, g, svg, key, p0: p, orig: tok.pts.map(q => q.slice()) }
    : { mode: 'move', tok, g, svg, key, dx: p.x - tok.x, dy: p.y - tok.y };
  g.setPointerCapture(e.pointerId);
  e.preventDefault();
});

body.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = svgPoint(drag.svg, e), t = drag.tok;
  if (drag.mode === 'move') {
    t.x = clamp(p.x - drag.dx, 4, 216); t.y = clamp(p.y - drag.dy, 6, 158);
    drag.g.setAttribute('transform', tf(t));
  } else if (drag.mode === 'scale') {
    t.s = clamp(drag.s0 * Math.hypot(p.x - t.x, p.y - t.y) / drag.d0, 0.4, 4);
    drag.g.setAttribute('transform', tf(t));
  } else if (drag.mode === 'vertex') {
    t.pts[drag.vi] = [r1(clamp(p.x, 0, 220)), r1(clamp(p.y, 0, 162))];
    syncPoly(drag.g, t);
  } else if (drag.mode === 'movepoly') {
    const xs = drag.orig.map(q => q[0]), ys = drag.orig.map(q => q[1]);
    const dx = clamp(p.x - drag.p0.x, -Math.min(...xs), 220 - Math.max(...xs));
    const dy = clamp(p.y - drag.p0.y, -Math.min(...ys), 162 - Math.max(...ys));
    t.pts = drag.orig.map(q => [r1(q[0] + dx), r1(q[1] + dy)]);
    syncPoly(drag.g, t);
  }
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null; save();
  if (d.mode === 'scale') { redrawCard(d.key); select(d.key, d.tok.id); }
};
body.addEventListener('pointerup', endDrag);
body.addEventListener('pointercancel', endDrag);

body.addEventListener('dblclick', e => {
  const g = e.target.closest('.tok'); if (!g) return;
  const key = g.closest('.card').dataset.key;
  const tok = store.edits[key].tokens.find(t => t.id === g.dataset.tid);
  if (tok && tok.type === 'poly') {
    const vh = e.target.closest('.vh');
    if (vh && tok.pts.length > 3) { tok.pts.splice(+vh.dataset.vi, 1); save(); redrawCard(key); select(key, tok.id); }
    return;
  }
  if (!tok || !['def', 'blk', 'lab'].includes(tok.type)) return;
  const v = prompt('Yazı:', tok.text);
  if (v != null && v.trim()) { tok.text = v.trim().slice(0, 14); save(); redrawCard(key); select(key, tok.id); }
});

body.addEventListener('change', e => {
  const el = e.target;
  if (el.classList.contains('addtok')) {
    const v = el.value; el.value = '';
    const key = el.closest('.card').dataset.key, ed = store.edits[key];
    if (v === '_del') { if (selTok && selTok.key === key) { ed.tokens = ed.tokens.filter(t => t.id !== selTok.tid); selTok = null; save(); redrawCard(key); } else toast('Önce sahadan bir sembole dokunun.'); return; }
    if (v === '_rot') { const t = selTok && selTok.key === key && ed.tokens.find(x => x.id === selTok.tid); if (t) { t.rot = ((t.rot || 0) + 45) % 360; save(); redrawCard(key); select(key, t.id); } else toast('Önce sahadan bir sembole dokunun.'); return; }
    if (!v) return;
    if (v === '_big' || v === '_small') {
      const t = selTok && selTok.key === key && ed.tokens.find(x => x.id === selTok.tid);
      if (!t) { toast('Önce sahadan bir sembole dokunun.'); return; }
      const f = v === '_big' ? 1.2 : 1 / 1.2;
      if (t.type === 'poly') {
        const cx = t.pts.reduce((a, q) => a + q[0], 0) / t.pts.length, cy = t.pts.reduce((a, q) => a + q[1], 0) / t.pts.length;
        t.pts = t.pts.map(q => [r1(clamp(cx + (q[0] - cx) * f, 0, 220)), r1(clamp(cy + (q[1] - cy) * f, 0, 162))]);
      } else t.s = clamp((t.s || 1) * f, 0.4, 4);
      save(); redrawCard(key); select(key, t.id); return;
    }
    if (v === '_style') {
      const t = selTok && selTok.key === key && ed.tokens.find(x => x.id === selTok.tid);
      if (!t || t.type !== 'poly') { toast('Önce bir çokgen bölgeye dokunun.'); return; }
      const order = ['zone', 'A', 'B', 'tip', 'hl'];
      t.style = order[(order.indexOf(t.style || 'zone') + 1) % order.length];
      save(); redrawCard(key); select(key, t.id); return;
    }
    if (v.startsWith('poly')) {
      const n = +v.slice(4), R = 30, a0 = n === 4 ? -Math.PI / 4 : -Math.PI / 2;
      const pts = Array.from({ length: n }, (_, i) => [r1(110 + R * Math.cos(a0 + 2 * Math.PI * i / n)), r1(100 + R * Math.sin(a0 + 2 * Math.PI * i / n))]);
      ed.n = (ed.n || ed.tokens.length) + 1;
      const t = { id: 't' + ed.n, type: 'poly', pts, style: 'zone' };
      ed.tokens.push(t); save(); redrawCard(key); select(key, t.id); return;
    }
    let text = '';
    if (v === 'def') text = prompt('Oyuncu / pozisyon:', '4');
    if (v === 'blk') text = prompt('Blok yazısı:', 'B2');
    if (v === 'lab') text = prompt('Etiket:', 'Not');
    if (['def', 'blk', 'lab'].includes(v) && !(text || '').trim()) return;
    ed.n = (ed.n || ed.tokens.length) + 1;
    const t = { id: 't' + ed.n, type: v, x: 110, y: v === 'blk' ? 22 : 80, text: (text || '').trim().slice(0, 14), rot: v === 'step' ? 90 : 0 };
    ed.tokens.push(t); save(); redrawCard(key); select(key, t.id);
  }
});

body.addEventListener('input', e => {
  const el = e.target;
  const card = el.closest('.card');
  if (el.matches('[data-pos]') && card) { store.edits[card.dataset.key].pos[el.dataset.pos] = el.value; save(); }
  else if (el.matches('[data-cnote]') && card) { store.edits[card.dataset.key].note = el.value; save(); }
  else if (el.dataset.meta) { getMeta()[el.dataset.meta] = el.isContentEditable ? el.textContent : el.value; save(); }
  else if (el.hasAttribute('data-my')) { store.myTeam = el.textContent; save(); }
  else if (el.dataset.name) { store.edits[`name|${teamCode}|${el.dataset.name}`] = el.textContent; save(); }
});
body.addEventListener('focusout', e => {
  if (e.target.dataset && e.target.dataset.name) { renderSideKeep(); refreshLineup(); }
});
body.addEventListener('keydown', e => {
  if (e.target.isContentEditable && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});
body.addEventListener('click', e => {
  const b = e.target.closest('.hide'); if (!b) return;
  const key = b.closest('.card').dataset.key;
  store.hidden[key] = true; save(); renderSheet(); updateHiddenBtn();
});

function renderSideKeep() { renderSide(); }
function refreshLineup() {
  const box = body.querySelector('.cols > div:nth-child(2)');
  if (box) box.innerHTML = lineupHTML();
}

document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selTok && !e.target.closest('input,textarea,[contenteditable],select')) {
    const ed = store.edits[selTok.key];
    ed.tokens = ed.tokens.filter(t => t.id !== selTok.tid);
    const k = selTok.key; selTok = null; save(); redrawCard(k); e.preventDefault();
  }
});

/* ───────── yan panel olayları ───────── */
$('#fileList').addEventListener('click', async e => {
  const rm = e.target.closest('[data-rm]');
  if (!rm) return;
  const f = files.splice(+rm.dataset.rm, 1)[0];
  try { await idb.del(f.id); } catch { /* yoksay */ }
  refresh();
});
$('#fileList').addEventListener('change', async e => {
  const u = e.target.dataset.use; if (u == null) return;
  const f = files[+u]; f.use = e.target.checked;
  try { await idb.put({ id: f.id, name: f.name, text: f.text, use: f.use }); } catch { /* yoksay */ }
  refresh();
});
$('#teamSel').addEventListener('change', e => { teamCode = e.target.value; refresh(); });
$('#playerList').addEventListener('change', e => {
  const n = e.target.dataset.pl; if (n == null) return;
  (store.sel[teamCode] ||= {})[n] = e.target.checked; save(); renderSheet();
});
$('#minAtt').addEventListener('change', e => { store.minAtt = e.target.checked; store.sel[teamCode] = {}; save(); renderSide(); renderSheet(); });
$('#cardsPer').addEventListener('change', e => { store.cardsPer = +e.target.value; save(); renderSheet(); });

function updateHiddenBtn() {
  const n = Object.keys(store.hidden).length;
  let b = $('#unhide');
  if (!n) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('button'); b.id = 'unhide'; b.className = 'ghost'; b.style.marginTop = '8px';
    b.addEventListener('click', () => { store.hidden = {}; save(); renderSheet(); updateHiddenBtn(); });
    $('#playerList').after(b);
  }
  b.textContent = `Gizlenen ${n} kartı geri getir`;
}

/* ───────── dosya girişi / sürükle-bırak ───────── */
$('#fileIn').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => window.addEventListener(t, e => { e.preventDefault(); $('#drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(t => window.addEventListener(t, e => { if (t === 'dragleave' && e.relatedTarget) return; $('#drop').classList.remove('over'); }));
window.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
$('#btnSide').addEventListener('click', () => $('#side').classList.toggle('open'));

/* ───────── tema, yazdırma, yedekleme ───────── */
function applyTheme() { html.dataset.theme = store.theme; $('#printTheme').value = store.printTheme; }
$('#btnTheme').addEventListener('click', () => { store.theme = store.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); });
$('#printTheme').addEventListener('change', e => { store.printTheme = e.target.value; save(); });
$('#btnPrint').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => { html.dataset.theme = store.printTheme; });
window.addEventListener('afterprint', () => { html.dataset.theme = store.theme; });

$('#btnExport').addEventListener('click', () => {
  const data = { app: 'vsm-worksheet', v: 1, exportedAt: new Date().toISOString(), edits: store.edits, sel: store.sel, hidden: store.hidden, myTeam: store.myTeam };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `vsm-worksheet-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Yedek indirildi. Maç dosyaları yedeğe dahil değildir.');
});
$('#importIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'vsm-worksheet') throw new Error('Bu bir VSM Worksheet yedeği değil.');
    Object.assign(store.edits, d.edits || {}); Object.assign(store.sel, d.sel || {}); Object.assign(store.hidden, d.hidden || {});
    if (d.myTeam) store.myTeam = d.myTeam;
    save(); refresh(); updateHiddenBtn(); toast('Yedek yüklendi.');
  } catch (err) { toast(err.message, 6000); }
});

/* ───────── PWA ───────── */
if ('serviceWorker' in navigator) {
  // Yeni sürüm devreye girince sayfayı bir kez kendisi yenilesin (ilk kurulumda yenilemez).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; flush(); location.reload(); }
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* çevrimdışı olmadan devam */ }));
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    const handles = params.files || [];
    const list = [];
    for (const h of handles) list.push(await h.getFile());
    if (list.length) addFiles(list);
  });
}

/* ───────── başlangıç ───────── */
(async function init() {
  applyTheme();
  const dl = document.createElement('datalist'); dl.id = 'posList';
  dl.innerHTML = POS_SUGGEST.map(v => `<option value="${esc(v)}">`).join('');
  document.body.appendChild(dl);
  try {
    await idb.open();
    const recs = await idb.all();
    for (const r of recs) {
      try { files.push({ ...r, parsed: parseVsm(r.text, r.name) }); } catch { /* bozuk kaydı atla */ }
    }
  } catch { /* IndexedDB yok */ }
  if (files.length) pickTeam(files[files.length - 1]);
  refresh();
  updateHiddenBtn();
})();
