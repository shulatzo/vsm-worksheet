'use strict';
/* Isı Haritası
   VolleyStation .vsm dosyalarından (JSON) bir takımın ataklarını okur; oyuncu ve atak kombinasyonu başına, topun düştüğü yeri
   savunan yarı sahada ısı haritası olarak çizer. Düşüş noktası, atağın travelPath'inin son noktasıdır (VolleyStation'da elle çizilen yön).
   Koordinat birimi cm: x 0–900 (soldan sağa), y 900 = file, y 1800 = arka çizgi. Sahaya file üstte olacak şekilde bakılır.
   Top tipleri (skillType): H sert, P soft, T tip. Her tip ayrı renkte, üst üste binince katman olarak karışır. */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ——— IndexedDB ——— */
const idb = {
  db: null,
  open() {
    return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
      const r = indexedDB.open('vsm-heat', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  async del(k) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};

/* ——— sabitler ——— */
/* VolleyStation'da seçili atak kombinasyonları. Üst sıra (C1 C2 CC CF C7) ve diğerleri. */
const DEF_COMBOS = 'C1 C2 CC CF C7 XX XS XH X3 V3 WW P9 PP P7 WS P5 P1 WH PH P8 C3 XO WO'.split(' ');
const TYPES = [
  { k: 'H', n: 'Sert', c: [26, 168, 52] },
  { k: 'P', n: 'Soft', c: [226, 48, 48] },
  { k: 'T', n: 'Tip', c: [112, 48, 200] },
];
const OUTS = [
  { k: 'S', n: 'Sayı', f: e => e === '#' },
  { k: 'E', n: 'Hata', f: e => e === '=' },
  { k: 'B', n: 'Blok', f: e => e === '/' },
  { k: 'D', n: 'Savunuldu', f: e => e !== '#' && e !== '=' && e !== '/' },
];
const SZ = [{ k: '4', n: '4 (sol)' }, { k: '3', n: '3 (orta)' }, { k: '2', n: '2 (sağ)' }, { k: 'B', n: 'Arka sıra' }];
const szKey = z => z === 4 ? '4' : z === 3 ? '3' : z === 2 ? '2' : 'B';
const outKey = e => e === '#' ? 'S' : e === '=' ? 'E' : e === '/' ? 'B' : 'D';
/* Savunan yarı sahada bölge hücresi [sütun, satır]; satır 0 file yanı. */
const ZC = { 2: [0, 0], 3: [1, 0], 4: [2, 0], 9: [0, 1], 8: [1, 1], 7: [2, 1], 1: [0, 2], 6: [1, 2], 5: [2, 2] };
const ZG = [[2, 3, 4], [9, 8, 7], [1, 6, 5]];
const SUBF = { A: [.25, .75], B: [.25, .25], C: [.75, .25], D: [.75, .75] };

/* ——— durum ——— */
let matches = [];            // [{id,label,date,home,away,pl:{'*':{no:ad},'a':{...}},atk:[...]}]
let S = defaults();
function defaults() {
  return { team: '', mOff: {}, pSel: null, cb: {}, out: { S: 1, E: 1, B: 1, D: 1 }, sz: { 4: 1, 3: 1, 2: 1, B: 1 }, sets: {},
    approx: true, pal: 'vs', sigma: 70, sat: 3, cols: 4, merge: false, zonePct: false, ty: {} };
}
let sideHidden = false;

/* ——— .vsm okuma ——— */
function parseVsm(text, fname) {
  const j = JSON.parse(text);
  if (!j || !j.scout || !j.team || !j.team.home) throw new Error('VolleyStation (.vsm) dosyası değil');
  const info = side => {
    const t = j.team[side === '*' ? 'home' : 'away'] || {};
    const pl = {};
    (t.players || []).forEach(p => { pl[String(p.shirtNumber).padStart(2, '0')] = ((p.firstName || '') + ' ' + (p.lastName || '')).trim(); });
    return { name: String(t.name || '').trim(), pl };
  };
  const th = info('*'), ta = info('a');
  const atk = [];
  (j.scout.sets || []).forEach((st, si) => (st.events || []).forEach(ev => ((ev.exchange || {}).plays || []).forEach(p => {
    if (p.skill !== 'A') return;
    const tp = Array.isArray(p.travelPath) && p.travelPath.length >= 2 ? p.travelPath : null;
    atk.push({
      t: p.team === '*' ? '*' : 'a', p: String(p.player), c: p.combination || '', h: p.skillType || '', e: p.effect || '',
      sz: p.startZone || 0, ssz: p.startSubZone || '', ez: p.endZone || 0, esz: p.endSubZone || '',
      sx: tp ? tp[0].x : null, sy: tp ? tp[0].y : null, ex: tp ? tp[tp.length - 1].x : null, ey: tp ? tp[tp.length - 1].y : null,
      st: si + 1, bl: p.players || 0,
    });
  })));
  const date = String(j.startDate || '').slice(0, 10) || (fname.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const id = [j.startDate || '', th.name, ta.name, j.createdAt || '', atk.length].join('|');
  return { id, file: fname, date, home: th.name, away: ta.name, pl: { '*': th.pl, a: ta.pl }, atk };
}

/* Takım adına göre bu takımın ataklarını (hangi taraf olursa olsun) döndürür. */
function teamSide(m, team) { return m.home === team ? '*' : m.away === team ? 'a' : null; }
function teamAttacks(team) {
  const out = [];
  matches.forEach(m => {
    if (S.mOff[m.id]) return;
    const sd = teamSide(m, team); if (!sd) return;
    m.atk.forEach(a => { if (a.t === sd) out.push(Object.assign({ m: m.id }, a)); });
  });
  return out;
}
function playerName(team, no) {
  for (const m of matches) { const sd = teamSide(m, team); if (sd) { const n = m.pl[sd][no] || m.pl[sd][String(no).padStart(2, '0')]; if (n) return n; } }
  return '';
}
function opp(m, team) { return m.home === team ? m.away : m.home; }
function fmtDate(d) { const m = String(d).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}` : ''; }

/* ——— nokta ——— */
function endPt(a) {
  if (a.ex != null) return { x: a.ex, y: a.ey, ap: 0 };
  const zc = ZC[a.ez]; if (!zc) return null;
  const f = SUBF[a.esz] || [.5, .5];
  return { x: (zc[0] + f[0]) * 300, y: 900 + (zc[1] + f[1]) * 300, ap: 1 };
}
function filtered(all) {
  const ok = a => {
    if (!(S.cb[a.c] ?? DEF_COMBOS.includes(a.c))) return false;
    if (!S.out[outKey(a.e)]) return false;
    if (!S.sz[szKey(a.sz)]) return false;
    if (S.sets[a.st]) return false;
    return true;
  };
  const res = []; let noPt = 0, apx = 0;
  all.forEach(a => {
    if (!ok(a)) return;
    const p = endPt(a);
    if (!p) { noPt++; return; }
    if (p.ap && !S.approx) { apx++; return; }
    res.push(Object.assign({}, a, p));
  });
  return { list: res, noPt, apx };
}

/* ——— çizim ——— */
/* VolleyStation görünümü: mavi çevre, turuncu saha, beyaz çizgiler. Yalnızca savunan yarı saha (file üstte). */
const X0 = -200, X1 = 1100, Y0 = 870, Y1 = 2000, CELL = 12;
const CW = 480, K = CW / (X1 - X0), CH = Math.round((Y1 - Y0) * K);
const GW = Math.ceil((X1 - X0) / CELL), GH = Math.ceil((Y1 - Y0) / CELL);
const tmp = document.createElement('canvas'); tmp.width = GW; tmp.height = GH;
const tctx = tmp.getContext('2d');
const cx = x => (x - X0) * K, cy = y => (y - Y0) * K;
const BLUE = '#3374c4', ORANGE = '#f6c68f';
/* VolleyStation heatmap skalası (PDF'ten örneklenmiş): [yoğunluk, R, G, B, opaklık] */
const VSR = [[0, 106, 85, 192, 0], [.05, 106, 85, 192, .55], [.14, 120, 205, 100, .95], [.22, 115, 226, 62, 1], [.40, 177, 239, 37, 1], [.52, 249, 241, 21, 1], [.64, 254, 200, 16, 1], [.76, 254, 150, 11, 1], [1, 254, 105, 8, 1]];

function drawCourt(cv, pts, tyS, o) {
  const sc = o.scale || 1;
  cv.width = CW * sc; cv.height = CH * sc;
  const g = cv.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0);
  const on = t => tyS[t].on;
  g.fillStyle = BLUE; g.fillRect(0, 0, CW, CH);
  g.fillStyle = ORANGE; g.fillRect(cx(0), cy(900), 900 * K, 900 * K);
  const sg = o.sigma, r = Math.ceil(3 * sg / CELL), inv = 1 / (2 * sg * sg);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (o.pal !== 'type') {
    /* VolleyStation renk skalası: mor hale → yeşil → sarı → turuncu/kırmızı çekirdek. Seçili tipler tek yoğunlukta toplanır; opaklık çubuğu tipin ağırlığıdır. */
    const L = new Float32Array(GW * GH);
    pts.forEach(p => {
      if (!on(p.h)) return;
      const wgt = tyS[p.h].op / 100, gx = (p.x - X0) / CELL, gy = (p.y - Y0) / CELL;
      const i0 = Math.max(0, Math.floor(gx - r)), i1 = Math.min(GW - 1, Math.ceil(gx + r));
      const j0 = Math.max(0, Math.floor(gy - r)), j1 = Math.min(GH - 1, Math.ceil(gy + r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + .5 - gx) * CELL, dy = (j + .5 - gy) * CELL;
        L[j * GW + i] += wgt * Math.exp(-(dx * dx + dy * dy) * inv);
      }
    });
    const img = tctx.createImageData(GW, GH), d = img.data;
    for (let q = 0; q < L.length; q++) {
      const u = 1 - Math.exp(-L[q] / o.sat);
      if (u < .01) { d[q * 4 + 3] = 0; continue; }
      let k = 1; while (k < VSR.length - 1 && u > VSR[k][0]) k++;
      const A = VSR[k - 1], B = VSR[k], f = Math.min(1, Math.max(0, (u - A[0]) / (B[0] - A[0])));
      for (let c = 0; c < 4; c++) d[q * 4 + c] = A[c + 1] + (B[c + 1] - A[c + 1]) * f;
      d[q * 4 + 3] = Math.round(255 * (A[4] + (B[4] - A[4]) * f));
    }
    tctx.putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0, GW, GH, 0, 0, GW * CELL * K, GH * CELL * K);
  } else TYPES.forEach(t => {
    if (!on(t.k)) return;
    const L = new Float32Array(GW * GH); let any = false;
    pts.forEach(p => {
      if (p.h !== t.k) return; any = true;
      const gx = (p.x - X0) / CELL, gy = (p.y - Y0) / CELL;
      const i0 = Math.max(0, Math.floor(gx - r)), i1 = Math.min(GW - 1, Math.ceil(gx + r));
      const j0 = Math.max(0, Math.floor(gy - r)), j1 = Math.min(GH - 1, Math.ceil(gy + r));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + .5 - gx) * CELL, dy = (j + .5 - gy) * CELL;
        L[j * GW + i] += Math.exp(-(dx * dx + dy * dy) * inv);
      }
    });
    if (!any) return;
    const img = tctx.createImageData(GW, GH), d = img.data, op = tyS[t.k].op / 100;
    /* yoğunluğa göre iç renk: kenar açık ton, orta tipin rengi, çekirdek koyu ve doygun */
    const lo = t.c.map(v => v + (255 - v) * .55), hi = t.c.map(v => v * .62);
    for (let q = 0; q < L.length; q++) {
      const u = 1 - Math.exp(-L[q] / o.sat);
      if (u < .004) { d[q * 4 + 3] = 0; continue; }
      const a = u < .5 ? u / .5 : (u - .5) / .5, from = u < .5 ? lo : t.c, to = u < .5 ? t.c : hi;
      d[q * 4] = from[0] + (to[0] - from[0]) * a; d[q * 4 + 1] = from[1] + (to[1] - from[1]) * a; d[q * 4 + 2] = from[2] + (to[2] - from[2]) * a;
      d[q * 4 + 3] = Math.round(255 * Math.min(1, u * 2.4) * op);
    }
    tctx.putImageData(img, 0, 0);
    g.drawImage(tmp, 0, 0, GW, GH, 0, 0, GW * CELL * K, GH * CELL * K);
  });
  /* çizgiler (VolleyStation gibi) */
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([]);
  g.strokeRect(cx(0), cy(900), 900 * K, 900 * K);
  g.lineWidth = 3; g.beginPath(); g.moveTo(cx(0), cy(900)); g.lineTo(cx(900), cy(900)); g.stroke();          // file
  g.lineWidth = 2; g.beginPath(); g.moveTo(cx(-60), cy(1200)); g.lineTo(cx(960), cy(1200)); g.stroke();      // 3 m çizgisi (sahanın dışına taşar)
  g.beginPath(); g.moveTo(cx(450), cy(1800)); g.lineTo(cx(450), cy(1800) - 7); g.stroke();                    // orta işareti
  g.lineWidth = 1.2; g.setLineDash([2, 2]); g.beginPath();
  [300, 600].forEach(x => { g.moveTo(cx(x), cy(1200)); g.lineTo(cx(x), cy(1800)); });
  g.moveTo(cx(0), cy(1500)); g.lineTo(cx(900), cy(1500));
  g.stroke(); g.setLineDash([]);
  /* istenirse bölge yüzdeleri */
  if (o.zonePct) {
    const cnt = {}; let tot = 0;
    pts.forEach(p => { if (!on(p.h)) return; tot++; if (p.ez) cnt[p.ez] = (cnt[p.ez] || 0) + 1; });
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 20px Roboto, "Segoe UI", sans-serif';
    ZG.forEach((row, ri) => row.forEach((z, ci) => {
      if (!tot) return;
      const s = Math.round(100 * (cnt[z] || 0) / tot) + '%', mx = cx(ci * 300 + 150), my = cy(900 + ri * 300 + 150);
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4; g.strokeText(s, mx, my); g.fillStyle = '#1b2a44'; g.fillText(s, mx, my);
    }));
  }
}

/* ——— arayüz ——— */
let raf = 0;
function persist() { clearTimeout(persist.t); persist.t = setTimeout(() => idb.set('st', S).catch(() => {}), 200); }
function toast(msg, ms = 3500) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function teams() {
  const c = {}; matches.forEach(m => { [m.home, m.away].forEach(n => { if (n) c[n] = (c[n] || 0) + 1; }); });
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
function ensureState() {
  const tl = teams();
  if (!S.team || !tl.find(t => t[0] === S.team)) S.team = tl.length ? tl[0][0] : '';
  /* oyuncu seçimi hiç yapılmadıysa en az 10 atak yapanlar seçilir */
  if (S.pSel == null && S.team) {
    const c = {}; teamAttacks(S.team).forEach(a => { c[a.p] = (c[a.p] || 0) + 1; });
    S.pSel = Object.keys(c).filter(p => c[p] >= 10);
  }
}
function tyState(key) {
  if (!S.ty[key]) S.ty[key] = { H: { on: 1, op: 100 }, P: { on: 1, op: 100 }, T: { on: 1, op: 100 } };
  return S.ty[key];
}

function chip(label, pressed, attrs, extra) {
  return `<button class="hchip${extra || ''}" aria-pressed="${pressed ? 'true' : 'false'}" ${attrs}>${label}</button>`;
}

function renderSide() {
  const side = $('#side'); if (!matches.length) { side.innerHTML = ''; return; }
  const tl = teams(), all = teamAttacks(S.team);
  let h = `<h2>Takım</h2><select id="fTeam" class="wide">${tl.map(t => `<option value="${esc(t[0])}"${t[0] === S.team ? ' selected' : ''}>${esc(t[0])} (${t[1]} maç)</option>`).join('')}</select>`;
  h += `<h2>Maçlar <span class="mini"><button data-mall="1">Hepsi</button><button data-mall="0">Hiçbiri</button></span></h2>`;
  matches.filter(m => teamSide(m, S.team)).sort((a, b) => a.date < b.date ? -1 : 1).forEach(m => {
    const n = m.atk.filter(a => a.t === teamSide(m, S.team)).length;
    h += `<label class="hrow"><input type="checkbox" data-m="${esc(m.id)}"${S.mOff[m.id] ? '' : ' checked'}><span class="no" style="width:auto">${fmtDate(m.date)}</span><span class="nm" title="${esc(opp(m, S.team))}">${esc(opp(m, S.team))}</span><span class="ct">${n}</span><button class="rm" data-mrm="${esc(m.id)}" title="Bu maçı kaldır" aria-label="Maçı kaldır">✕</button></label>`;
  });
  /* oyuncular: kombinasyon/sonuç süzgeçleri uygulanmadan, toplam atak sayısı */
  const pc = {}; all.forEach(a => { pc[a.p] = (pc[a.p] || 0) + 1; });
  const plist = Object.keys(pc).sort((a, b) => pc[b] - pc[a]);
  h += `<h2>Oyuncular <span class="mini"><button data-pall="1">Hepsi</button><button data-pall="0">Hiçbiri</button></span></h2>`;
  plist.forEach(p => {
    h += `<label class="hrow"><input type="checkbox" data-p="${esc(p)}"${S.pSel.includes(p) ? ' checked' : ''}><span class="no">${esc(p)}</span><span class="nm">${esc(playerName(S.team, p))}</span><span class="ct">${pc[p]}</span></label>`;
  });
  h += `<label class="hrow"><input type="checkbox" id="fMerge"${S.merge ? ' checked' : ''}><span class="nm">Seçilenleri tek sahada birleştir</span></label>`;
  /* kombinasyonlar */
  const cc = {}; all.forEach(a => { cc[a.c] = (cc[a.c] || 0) + 1; });
  const cl = Object.keys(cc).filter(Boolean).sort((a, b) => {
    const ia = DEF_COMBOS.indexOf(a), ib = DEF_COMBOS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  h += `<h2>Kombinasyonlar <span class="mini"><button data-call="vs" title="VolleyStation’da seçtiğiniz liste">VS listesi</button><button data-call="all">Hepsi</button></span></h2><div class="hchips">`;
  cl.forEach(c => { const on = S.cb[c] ?? DEF_COMBOS.includes(c); h += chip(`${esc(c)}<small>${cc[c]}</small>`, on, `data-c="${esc(c)}"`, DEF_COMBOS.includes(c) ? '' : ' dim'); });
  h += `</div><p class="hnote">Soluk olanlar VS listenizde seçili olmayan kombinasyonlardır.</p>`;
  h += `<h2>Sonuç</h2><div class="hchips">${OUTS.map(o => chip(o.n, S.out[o.k], `data-o="${o.k}"`)).join('')}</div>`;
  h += `<h2>Atağın başladığı yer</h2><div class="hchips">${SZ.map(o => chip(o.n, S.sz[o.k], `data-z="${o.k}"`)).join('')}</div>`;
  const sets = [...new Set(all.map(a => a.st))].sort();
  h += `<h2>Set</h2><div class="hchips">${sets.map(s => chip('Set ' + s, !S.sets[s], `data-s="${s}"`)).join('')}</div>`;
  h += `<label class="hrow" style="margin-top:10px"><input type="checkbox" id="fApprox"${S.approx ? ' checked' : ''}><span class="nm">Elle çizilmemiş ataklar da (yaklaşık)</span></label>`;
  side.innerHTML = h;
}

function renderCtl() {
  const c = $('#ctl'); c.hidden = !matches.length; if (!matches.length) return;
  c.innerHTML = `
    <span class="seg2" role="group" aria-label="Renk skalası">${[['vs', 'VolleyStation renkleri'], ['type', 'Tip renkleri']].map(([k, n]) => `<button data-pal="${k}" aria-pressed="${S.pal === k}">${n}</button>`).join('')}</span>
    <label title="Her atağın etrafında ısının ne kadar yayılacağı">Yayılım <input type="range" id="fSigma" min="30" max="160" step="5" value="${S.sigma}"><span class="v" id="vSigma">${S.sigma} cm</span></label>
    <label title="Tam renk için aynı yere kaç atağın üst üste gelmesi gerektiği">Doygunluk <input type="range" id="fSat" min="1" max="10" step="0.5" value="${S.sat}"><span class="v" id="vSat">${S.sat}</span></label>
    <label title="Yan yana saha sayısı">Sırada <select id="fCols">${[2, 3, 4, 5].map(n => `<option${S.cols === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="chk" style="min-height:0"><input type="checkbox" id="fZonePct"${S.zonePct ? ' checked' : ''}> Bölge %</label>
    <span class="hleg">${S.pal === 'type' ? TYPES.map(t => `<span><i style="background:rgb(${t.c})"></i>${t.k} ${t.n.toLowerCase()}</span>`).join('') : 'Renk: yeşil az, sarı orta, turuncu/kırmızı çok atak · H/P/T tikiyle tip seçilir, çubuk ağırlığıdır'}</span>`;
}

function sectionDefs(list) {
  /* [{key,title,no,pts}] */
  const sel = S.pSel || [];
  const by = {}; list.forEach(a => { (by[a.p] = by[a.p] || []).push(a); });
  if (S.merge && sel.length > 1) {
    const pts = sel.flatMap(p => by[p] || []);
    return [{ key: 'ALL', no: '', title: 'Seçilen oyuncular: ' + sel.map(p => p).join(', '), pts }];
  }
  return sel.filter(p => by[p] || true).sort((a, b) => (by[b] || []).length - (by[a] || []).length)
    .map(p => ({ key: p, no: p, title: playerName(S.team, p), pts: by[p] || [] }));
}

function typeCounts(pts) { const c = { H: 0, P: 0, T: 0 }; pts.forEach(p => { if (c[p.h] != null) c[p.h]++; }); return c; }

function renderSections() {
  const host = $('#sections'); const empty = $('#empty');
  empty.hidden = matches.length > 0;
  if (!matches.length) { host.innerHTML = ''; return; }
  const all = teamAttacks(S.team);
  const f = filtered(all);
  const defs = sectionDefs(f.list);
  let h = '';
  if (!defs.length) h = `<p class="hnone">Soldan en az bir oyuncu seçin.</p>`;
  defs.forEach(d => {
    const ts = tyState(d.key), tc = typeCounts(d.pts);
    const byC = {}; d.pts.forEach(p => { (byC[p.c] = byC[p.c] || []).push(p); });
    const cl = Object.keys(byC).sort((a, b) => byC[b].length - byC[a].length || a.localeCompare(b));
    h += `<section class="hpl" data-k="${esc(d.key)}"><header><h2>${d.no ? `<span class="no">${esc(d.no)}</span>` : ''}${esc(d.title)}</h2><span class="tot">${d.pts.length} atak · ${cl.length} kombinasyon</span>
      <div class="hty">${TYPES.map(t => `<span class="tyc" style="--c:rgb(${t.c})"><input type="checkbox" data-ton="${t.k}"${ts[t.k].on ? ' checked' : ''} aria-label="${t.k} göster"><span class="sw"></span>${t.k} <small>${tc[t.k]}</small><input type="range" data-top="${t.k}" min="5" max="100" step="5" value="${ts[t.k].op}" aria-label="${t.k} opaklığı"><span class="pc">%${ts[t.k].op}</span></span>`).join('')}</div></header>`;
    if (!cl.length) h += `<p class="hnone">Bu süzgeçlerle atak yok.</p>`;
    h += `<div class="hgrid" style="--cols:${S.cols}">`;
    cl.forEach(c => {
      h += `<figure class="hc" data-c="${esc(c)}"><figcaption><div class="l"><span class="cd">${esc(c)}</span><span class="ty"></span></div><div class="r"></div></figcaption><canvas aria-label="${esc(c)} ısı haritası"></canvas></figure>`;
    });
    h += `</div></section>`;
  });
  host.innerHTML = h;
  host._defs = defs; host._f = f;
  drawAll();
  const bits = [];
  if (f.noPt) bits.push(`${f.noPt} atakta düşüş yeri yok (atlandı)`);
  if (f.apx) bits.push(`${f.apx} elle çizilmemiş atak gizli`);
  const a = f.list.filter(p => p.ap).length; if (a) bits.push(`${a} atak yaklaşık (bölge/alt bölge merkezi)`);
  $('#hnote').textContent = bits.length ? bits.join(' · ') : '';
}

function statsFor(pts, ts) {
  const on = pts.filter(p => ts[p.h] && ts[p.h].on);
  const n = on.length; const c = { S: 0, E: 0, B: 0, D: 0 }; on.forEach(p => { c[outKey(p.e)]++; });
  const tc = typeCounts(pts);
  const pc = v => n ? Math.round(100 * v / n) : 0;
  return { n, tc, pts: pc(c.S), err: pc(c.E), blo: pc(c.B), eff: n ? Math.round(100 * (c.S - c.E - c.B) / n) : 0, ap: on.filter(p => p.ap).length };
}

/* VolleyStation başlığı: Tot / Pts solda, E / Err / Blo sağda; Err ve Blo 0 ise yazılmaz. */
function vsStats(st) {
  const r = (l, v, u) => `<span class="k">${l}</span><span class="v">${v}${u ? `<small>%</small>` : ''}</span>`;
  const c1 = r('Tot:', st.n) + (st.pts ? r('Pts:', st.pts, 1) : '');
  const c2 = r('E:', st.eff, 1) + (st.err ? r('Err:', st.err, 1) : '') + (st.blo ? r('Blo:', st.blo, 1) : '');
  return `<div class="col">${c1}</div><div class="col">${c2}</div>`;
}
function drawSection(sec, def) {
  const ts = tyState(def.key);
  const byC = {}; def.pts.forEach(p => { (byC[p.c] = byC[p.c] || []).push(p); });
  sec.querySelectorAll('figure.hc').forEach(fg => {
    const pts = byC[fg.dataset.c] || [];
    const st = statsFor(pts, ts);
    fg.querySelector('.ty').innerHTML = TYPES.map(t => `<b style="color:rgb(${t.c})">${t.k}</b> ${st.tc[t.k]}`).join(' · ');
    fg.querySelector('.r').innerHTML = vsStats(st);
    fg.classList.toggle('few', st.n > 0 && st.n < 5);
    let fw = fg.querySelector('.fw');
    if (st.n > 0 && st.n < 5) { if (!fw) { fw = document.createElement('span'); fw.className = 'fw'; fg.appendChild(fw); } fw.textContent = 'Az veri (5’ten az atak)'; }
    else if (fw) fw.remove();
    drawCourt(fg.querySelector('canvas'), pts, ts, { sigma: S.sigma, sat: S.sat, zonePct: S.zonePct, pal: S.pal });
  });
}
function drawAll() {
  const host = $('#sections'); if (!host._defs) return;
  host.querySelectorAll('section.hpl').forEach(sec => {
    const def = host._defs.find(d => d.key === sec.dataset.k); if (def) drawSection(sec, def);
  });
}
function redrawSoon(only) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const host = $('#sections');
    if (only) { const sec = host.querySelector(`section.hpl[data-k="${CSS.escape(only)}"]`), def = host._defs && host._defs.find(d => d.key === only); if (sec && def) drawSection(sec, def); }
    else drawAll();
  });
}
function renderAll() { ensureState(); renderSide(); renderCtl(); renderSections(); persist(); }

/* ——— olaylar ——— */
$('#side').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.mall != null) { const on = t.dataset.mall === '1'; matches.forEach(m => { if (teamSide(m, S.team)) S.mOff[m.id] = on ? 0 : 1; }); S.pSel = null; return renderAll(); }
  if (t.dataset.mrm) { if (!confirm('Bu maç listeden kaldırılsın mı?')) return; matches = matches.filter(m => m.id !== t.dataset.mrm); idb.set('data', matches).catch(() => {}); S.pSel = null; return renderAll(); }
  if (t.dataset.pall != null) { const all = [...new Set(teamAttacks(S.team).map(a => a.p))]; S.pSel = t.dataset.pall === '1' ? all : []; return renderAll(); }
  if (t.dataset.call) { if (t.dataset.call === 'vs') S.cb = {}; else { const cc = new Set(teamAttacks(S.team).map(a => a.c)); S.cb = {}; cc.forEach(c => { S.cb[c] = true; }); } return renderAll(); }
  if (t.dataset.c) { const c = t.dataset.c; S.cb[c] = !(S.cb[c] ?? DEF_COMBOS.includes(c)); return renderAll(); }
  if (t.dataset.o) { S.out[t.dataset.o] = S.out[t.dataset.o] ? 0 : 1; return renderAll(); }
  if (t.dataset.z) { S.sz[t.dataset.z] = S.sz[t.dataset.z] ? 0 : 1; return renderAll(); }
  if (t.dataset.s) { S.sets[t.dataset.s] = S.sets[t.dataset.s] ? 0 : 1; return renderAll(); }
});
$('#side').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fTeam') { S.team = t.value; S.pSel = null; return renderAll(); }
  if (t.dataset.m) { S.mOff[t.dataset.m] = t.checked ? 0 : 1; return renderAll(); }
  if (t.dataset.p) { const p = t.dataset.p, s = new Set(S.pSel); t.checked ? s.add(p) : s.delete(p); S.pSel = [...s]; return renderAll(); }
  if (t.id === 'fMerge') { S.merge = t.checked; return renderAll(); }
  if (t.id === 'fApprox') { S.approx = t.checked; return renderAll(); }
});
$('#ctl').addEventListener('click', e => { const b = e.target.closest('button[data-pal]'); if (b) { S.pal = b.dataset.pal; renderCtl(); drawAll(); persist(); } });
$('#ctl').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'fSigma') { S.sigma = +t.value; $('#vSigma').textContent = S.sigma + ' cm'; redrawSoon(); persist(); }
  if (t.id === 'fSat') { S.sat = +t.value; $('#vSat').textContent = S.sat; redrawSoon(); persist(); }
});
$('#ctl').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fCols') { S.cols = +t.value; document.querySelectorAll('.hgrid').forEach(g => g.style.setProperty('--cols', S.cols)); persist(); }
  if (t.id === 'fZonePct') { S.zonePct = t.checked; drawAll(); persist(); }
});
$('#sections').addEventListener('input', e => {
  const t = e.target, sec = t.closest('section.hpl'); if (!sec) return;
  const key = sec.dataset.k, ts = tyState(key);
  if (t.dataset.top) { ts[t.dataset.top].op = +t.value; t.parentNode.querySelector('.pc').textContent = '%' + t.value; redrawSoon(key); persist(); }
});
$('#sections').addEventListener('change', e => {
  const t = e.target, sec = t.closest('section.hpl'); if (!sec) return;
  const key = sec.dataset.k, ts = tyState(key);
  if (t.dataset.ton) { ts[t.dataset.ton].on = t.checked ? 1 : 0; redrawSoon(key); persist(); }
});

async function addFiles(files) {
  let ok = 0, bad = [];
  for (const f of files) {
    try {
      const m = parseVsm(await f.text(), f.name);
      const i = matches.findIndex(x => x.id === m.id);
      if (i >= 0) matches[i] = m; else matches.push(m);
      ok++;
    } catch (err) { bad.push(f.name + ': ' + err.message); }
  }
  if (ok) { await idb.set('data', matches).catch(() => {}); renderAll(); }
  toast(ok ? `${ok} maç eklendi.` + (bad.length ? ` ${bad.length} dosya okunamadı.` : '') : 'Dosya okunamadı: ' + bad.join(' | '), 5000);
}
$('#vsmIn').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
const drop = $('#drop');
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const fs = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (fs.length) addFiles(fs); });

/* ——— Defans planına aktar ——— */
/* Her saha, VolleyStation heatmap kartı gibi bir resim olur: üstte kod ve istatistik şeridi, altında mavi çevreli yarı saha.
   Defans Planı sayfası bu kartların üstüne daireleri koyar (atak koduna göre referans daireleri otomatik gelir). */
const HH = 54, ES = 2;
function cardCanvas(code, pts, ts) {
  const st = statsFor(pts, ts);
  const cv = document.createElement('canvas'), court = document.createElement('canvas');
  drawCourt(court, pts, ts, { sigma: S.sigma, sat: S.sat, zonePct: S.zonePct, pal: S.pal, scale: ES });
  cv.width = CW * ES; cv.height = (HH + CH) * ES;
  const g = cv.getContext('2d'); g.setTransform(ES, 0, 0, ES, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(0, 0, CW, HH + CH);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = '#1f2b47'; g.font = '700 26px Roboto, "Segoe UI", Arial, sans-serif'; g.fillText(code, 10, 40);
  const rows = (x0, x1, list) => list.forEach(([l, v, u], i) => {
    const y = 18 + i * 14;
    g.font = '400 12px Roboto, "Segoe UI", Arial, sans-serif'; g.fillStyle = '#8590a8'; g.textAlign = 'left'; g.fillText(l, x0, y);
    g.fillStyle = '#26324d'; g.font = '600 12.5px Roboto, "Segoe UI", Arial, sans-serif'; g.textAlign = 'right';
    if (u) { g.fillText(String(v), x1 - 8, y); g.font = '500 9px Roboto, Arial, sans-serif'; g.fillText('%', x1, y); } else g.fillText(String(v), x1, y);
  });
  rows(CW - 215, CW - 122, [['Tot:', st.n, 0]].concat(st.pts ? [['Pts:', st.pts, 1]] : []));
  rows(CW - 100, CW - 10, [['E:', st.eff, 1]].concat(st.err ? [['Err:', st.err, 1]] : [], st.blo ? [['Blo:', st.blo, 1]] : []));
  g.textAlign = 'left'; g.font = '600 11px Roboto, "Segoe UI", Arial, sans-serif'; let x = 12;
  TYPES.forEach((t, i) => { const a = t.k + ' ', b = String(st.tc[t.k]) + (i < 2 ? '   ' : ''); g.fillStyle = `rgb(${t.c})`; g.fillText(a, x, 53 - 2); x += g.measureText(a).width; g.fillStyle = '#6f7b95'; g.fillText(b, x, 53 - 2); x += g.measureText(b).width; });
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(court, 0, HH * ES);
  const H = HH + CH;
  return { cv, w: cv.width, h: cv.height, bt: HH / H, court: { x0: cx(0) / CW, y0: (HH + cy(900)) / H, x1: cx(900) / CW, y1: (HH + cy(1800)) / H } };
}
const toBlob = (cv, type = 'image/png') => new Promise(r => cv.toBlob(r, type));
async function sendToDefans() {
  const host = $('#sections'); const defs = host._defs || [];
  if (!defs.length) { toast('Önce soldan en az bir oyuncu seçin.'); return; }
  const btn = $('#btnDefans'); btn.disabled = true; const old = btn.textContent;
  try {
    const players = []; let n = 0;
    for (const d of defs) {
      const ts = tyState(d.key), byC = {}; d.pts.forEach(p => { (byC[p.c] = byC[p.c] || []).push(p); });
      const cl = Object.keys(byC).sort((a, b) => byC[b].length - byC[a].length || a.localeCompare(b));
      const panels = [];
      for (const c of cl) {
        btn.textContent = `Hazırlanıyor… ${++n}`; await new Promise(r => setTimeout(r));
        const cc = cardCanvas(c, byC[c], ts), blob = await toBlob(cc.cv);
        panels.push({ key: `heat:${d.key}:${c}`, b: { b: await blob.arrayBuffer(), t: blob.type }, w: cc.w, h: cc.h, bt: cc.bt, code: c, court: cc.court });
        cc.cv.width = cc.cv.height = 1;
      }
      if (panels.length) players.push({ id: `heat:${d.key}`, name: d.key === 'ALL' ? 'Seçilen oyuncular' : (d.title || '#' + d.no), panels });
    }
    if (!players.length) { toast('Bu süzgeçlerle atak yok.'); return; }
    const db = await new Promise((res, rej) => { const r = indexedDB.open('vsm-defans', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ players, at: Date.now() }, 'heatDeck'); t.oncomplete = res; t.onerror = () => rej(t.error); });
    db.close();
    location.href = 'defans.html?from=heat';
  } catch (err) { console.error(err); toast('Defans planı hazırlanamadı: ' + (err.message || err), 6000); }
  finally { btn.disabled = false; btn.textContent = old; }
}
$('#btnDefans').addEventListener('click', sendToDefans);
$('#btnPrint').addEventListener('click', () => window.print());
$('#btnSide').addEventListener('click', () => { sideHidden = !sideHidden; $('#side').classList.toggle('hidden', sideHidden); });

(async function init() {
  try {
    matches = (await idb.get('data')) || [];
    const st = await idb.get('st'); if (st) S = Object.assign(defaults(), st);
  } catch (_) { /* depolama kapalıysa sıfırdan başlar */ }
  renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__hm = { cardCanvas, sendToDefans, get S() { return S; }, get matches() { return matches; }, parseVsm, addFiles, filtered, teamAttacks, renderAll };
})();
