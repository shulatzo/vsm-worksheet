'use strict';
/* Defans Planı
   VolleyStation heatmap PDF'ini tarayıcıda açar, her sayfadaki heatmap'leri kart olarak ayırır (oyuncu başına bir sayfa),
   kartların üzerine numaralı defans daireleri koymaya izin verir. Heatmap görselleri değiştirilmez; daireler ayrı bir katmandır.
   Daireler saha (turuncu alan) koordinatında, PDF'in özeti + sayfa + kart sırasına bağlı saklanır. */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ——— küçük IndexedDB sarmalayıcısı ——— */
const idb = {
  db: null,
  open() {
    return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
      const r = indexedDB.open('vsm-defans', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};
/* Blob'lar bazı tarayıcılarda IndexedDB'de sorun çıkarabildiği için ArrayBuffer olarak saklanır. */
const pack = async b => b ? { b: await b.arrayBuffer(), t: b.type } : null;
const unpack = o => o ? new Blob([o.b], { type: o.t }) : null;

/* ——— durum ——— */
let deck = null;                         // {name, fp, players:[{id,name,cands,panels:[{key,blob,url,w,h,court}]}]}
let S = { courts: {}, size: 0.17, nums: false, cols: 4, pl: {}, refs: {}, codes: {} };   // pl[oyuncuId] = {name?, off?, hid:{kartAnahtarı:1}, mm?}
const photos = {};                       // oyuncuId -> {orig, cut, show, url}
let hist = [], redo = [];
let sel = { key: null, id: null };
let clip = null;
const courtEls = {};                     // anahtar -> {el, capEl}

const COLORS = { k: '#111111', r: '#D62839', b: '#1F5BEA', g: '#1F7A33' };
const CAPS = ['RIGHT TO RIGHT', 'RIGHT TO LEFT', 'LEFT TO LEFT', 'LEFT TO RIGHT'];
const FORMS = {
  f1: [[.30, .10, 'c'], [.70, .10, 'c'], [.13, .52, 'c'], [.40, .74, 'c'], [.62, .74, 'c'], [.88, .52, 'c']],
  f2: [[.50, .10, 'c'], [.14, .42, 'c'], [.86, .42, 'c'], [.30, .70, 'c'], [.50, .82, 'c'], [.70, .70, 'c']],
};
const pst = id => (S.pl[id] ||= { hid: {} });
const nameOf = p => (S.pl[p.id]?.name ?? p.name) || '';

function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  const n = document.querySelectorAll('.toast').length; t.style.bottom = (150 + n * 78) + 'px';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
let progEl = null;
function prog(msg) {
  if (msg == null) { progEl?.remove(); progEl = null; return; }
  if (!progEl) { progEl = document.createElement('div'); progEl.className = 'toast'; document.body.appendChild(progEl); }
  progEl.textContent = msg;
}
async function sha1(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
const toBlob = (cv, type = 'image/png') => new Promise(r => cv.toBlob(r, type));

/* ——— PDF okuma ——— */
/* Sayfadaki heatmap panellerini bulur: turuncu saha + etrafındaki mavi çerçeve + üstündeki istatistik şeridi. */
function detectPanels(cv) {
  const W = cv.width, H = cv.height;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const S4 = 4, gw = Math.ceil(W / S4), gh = Math.ceil(H / S4);
  const m = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let n = 0, t = 0;
    for (let y = gy * S4; y < Math.min(H, gy * S4 + S4); y++) for (let x = gx * S4; x < Math.min(W, gx * S4 + S4); x++) {
      const i = (y * W + x) * 4; t++;
      if (Math.abs(d[i] - 246) < 26 && Math.abs(d[i + 1] - 195) < 26 && Math.abs(d[i + 2] - 139) < 26) n++;
    }
    if (n >= t * 0.45) m[gy * gw + gx] = 1;
  }
  const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!m[y * gw + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) dil[yy * gw + xx] = 1; }
  }
  // bağlı bileşenler (dilate edilmiş maske üzerinde, kutu özgün maskeden)
  const lab = new Uint8Array(gw * gh); let boxes = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!dil[s] || lab[s]) continue;
    const st = [s]; lab[s] = 1; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (st.length) {
      const i = st.pop(), x = i % gw, y = (i / gw) | 0;
      if (m[i]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1]) if (j >= 0 && dil[j] && !lab[j]) { lab[j] = 1; st.push(j); }
    }
    if (n >= 40 && x1 - x0 >= 9 && y1 - y0 >= 7) boxes.push({ x0: x0 * S4, y0: y0 * S4, x1: (x1 + 1) * S4, y1: (y1 + 1) * S4 });
  }
  // sahayı bölen parçaları (ısı lekesi ya da çizgi yüzünden) birleştir
  for (let ch = true; ch;) {
    ch = false;
    outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j], wa = a.x1 - a.x0, wb = b.x1 - b.x0;
      const xo = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), yg = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (xo >= 0.6 * Math.min(wa, wb) && yg <= 0.3 * Math.max(wa, wb)) {
        boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
        boxes.splice(j, 1); ch = true; break outer;
      }
    }
  }
  boxes = boxes.filter(b => { const w = b.x1 - b.x0, h = b.y1 - b.y0; return w >= 40 && h >= 30 && w / h > 0.35 && w / h < 1.7; });

  const blue = i => d[i + 2] - d[i] > 55 && d[i + 2] > 120 && d[i + 2] - d[i + 1] > 15;
  const colBlue = (x, ya, yb) => { let n = 0, t = 0; for (let y = Math.max(0, ya); y <= Math.min(H - 1, yb); y += 2) { t++; if (blue((y * W + x) * 4)) n++; } return t ? n / t : 0; };
  const rowBlue = (y, xa, xb) => { let n = 0, t = 0; for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x += 2) { t++; if (blue((y * W + x) * 4)) n++; } return t ? n / t : 0; };
  const ink = (y, xa, xb) => { for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x++) { const i = (y * W + x) * 4; if (Math.min(d[i], d[i + 1], d[i + 2]) < 215) return true; } return false; };

  const out = boxes.map(b => {
    let { x0, y0, x1, y1 } = b; const cw = x1 - x0;
    // saha kenarını mavi çerçevenin başladığı yere kadar genişlet (ısı lekesi kenarı örtmüş olabilir)
    const lim = Math.ceil(cw * 0.06);
    const ch0 = y1 - y0, ya = y0 + Math.round(ch0 * 0.2), yb = y1 - Math.round(ch0 * 0.2), xa = x0 + Math.round(cw * 0.2), xb = x1 - Math.round(cw * 0.2);
    for (let k = 0; k < lim && x0 > 0 && colBlue(x0 - 1, ya, yb) < 0.5; k++) x0--;
    for (let k = 0; k < lim && x1 < W - 1 && colBlue(x1, ya, yb) < 0.5; k++) x1++;
    for (let k = 0; k < lim && y0 > 0 && rowBlue(y0 - 1, xa, xb) < 0.5; k++) y0--;
    for (let k = 0; k < lim && y1 < H - 1 && rowBlue(y1, xa, xb) < 0.5; k++) y1++;
    const cw2 = x1 - x0, chh = y1 - y0;
    // mavi çerçevenin dış sınırı
    let bx0 = x0, bx1 = x1, by0 = y0, by1 = y1;
    while (bx0 > 0 && x0 - bx0 < cw2 * 0.6 && colBlue(bx0 - 1, y0, y1) >= 0.35) bx0--;
    while (bx1 < W - 1 && bx1 - x1 < cw2 * 0.6 && colBlue(bx1, y0, y1) >= 0.35) bx1++;
    while (by0 > 0 && y0 - by0 < cw2 * 0.6 && rowBlue(by0 - 1, x0, x1) >= 0.35) by0--;
    while (by1 < H - 1 && by1 - y1 < cw2 * 0.6 && rowBlue(by1, x0, x1) >= 0.35) by1++;
    // geçerlilik: gerçek panelde saha, sol/sağ/altta mavi çerçeveyle sarılıdır (ten rengi gibi turuncuya yakın fotoğraf alanlarını eler)
    let bn = 0, bt = 0;
    for (let y = by0; y <= by1; y += 2) for (let x = bx0; x <= bx1; x += 2) { if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; bt++; if (blue((y * W + x) * 4)) bn++; }
    const side = Math.max(3, cw2 * 0.04);
    const ok = bt > 0 && bn / bt >= 0.4 && x0 - bx0 >= side && bx1 - x1 >= side && by1 - y1 >= side;
    return { ok, court: { x0, y0, x1, y1 }, blue: { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 }, cw: cw2, ch: chh };
  }).filter(p => p.ok);

  // üstteki istatistik şeridi: mavi çerçevenin üstünde, mürekkep olan satırlar (ardışık, küçük boşluklara izin)
  for (const p of out) {
    const { x0, x1 } = p.blue, pad = Math.round(p.cw * 0.02);
    let limit = Math.max(0, p.blue.y0 - Math.round(p.cw * 0.45));
    for (const q of out) if (q !== p && q.blue.y1 <= p.blue.y0 + 2 && Math.min(q.blue.x1, x1) - Math.max(q.blue.x0, x0) > 0.3 * p.cw) limit = Math.max(limit, q.blue.y1 + 2);
    const gapMax = Math.round(p.cw * 0.05); let top = p.blue.y0, gap = 0;
    for (let y = p.blue.y0 - 1; y >= limit; y--) {
      if (ink(y, x0 - pad, x1 + pad)) { top = y; gap = 0; } else if (++gap > gapMax) break;
    }
    p.strip = top;
    // şerit metni (soldaki kod etiketi, sağdaki yüzdeler) mavi çerçevenin biraz dışına taşabilir:
    // çerçeveden dışarı doğru, boş sütunlara ya da komşu panele varana kadar genişlet
    let lo = Math.round(p.cw * 0.15), hi = lo;
    for (const q of out) {
      if (q === p || q.blue.y1 < p.blue.y0 || q.blue.y0 > p.blue.y1) continue;
      if (q.blue.x0 >= p.blue.x1) hi = Math.min(hi, Math.max(0, q.blue.x0 - p.blue.x1 - 1));
      else if (q.blue.x1 <= p.blue.x0) lo = Math.min(lo, Math.max(0, p.blue.x0 - q.blue.x1 - 1));
    }
    const colInk = x => { for (let y = top; y < p.blue.y0; y++) { const i = (y * W + x) * 4; if (Math.min(d[i], d[i + 1], d[i + 2]) < 215) return true; } return false; };
    p.hx0 = p.blue.x0; p.hx1 = p.blue.x1;
    for (let x = p.blue.x0 - 1, blank = 0; x >= Math.max(0, p.blue.x0 - lo); x--) { if (colInk(x)) { p.hx0 = x; blank = 0; } else if (++blank > 4) break; }
    for (let x = p.blue.x1, blank = 0; x <= Math.min(W - 1, p.blue.x1 + hi); x++) { if (colInk(x)) { p.hx1 = x + 1; blank = 0; } else if (++blank > 4) break; }
  }
  // okuma sırası: satır satır, soldan sağa
  out.sort((a, b) => a.blue.y0 - b.blue.y0);
  const rows = [];
  for (const p of out) { const r = rows.find(r => Math.abs(r.cy - (p.blue.y0 + p.blue.y1) / 2) < 0.5 * p.ch); if (r) { r.items.push(p); } else rows.push({ cy: (p.blue.y0 + p.blue.y1) / 2, items: [p] }); }
  return rows.flatMap(r => r.items.sort((a, b) => a.blue.x0 - b.blue.x0));
}

/* Metin katmanından oyuncu adı adayları: panellerin dışındaki satırlar, en büyük yazı önde. */
function textCandidates(items, vp, boxes) {
  const lines = [];
  for (const it of items) {
    const s = (it.str || '').trim(); if (!s) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const x = t[4], y = t[5], h = Math.hypot(t[2], t[3]) || it.height * vp.scale;
    if (boxes.some(b => x >= b.x0 - 4 && x <= b.x1 + 4 && y >= b.y0 - 4 && y <= b.y1 + 4)) continue;
    let ln = lines.find(l => Math.abs(l.y - y) < Math.max(2, 0.4 * l.h) && Math.abs(l.h - h) < 0.35 * l.h);
    if (!ln) lines.push(ln = { y, h, parts: [] });
    ln.parts.push({ x, s, w: (it.width || 0) * vp.scale });
  }
  const res = lines.map(l => {
    l.parts.sort((a, b) => a.x - b.x);
    let txt = '', end = null;
    for (const p of l.parts) { if (end != null && p.x - end > l.h * 0.15 && !/\s$/.test(txt)) txt += ' '; txt += p.s; end = p.x + p.w; }
    return { t: txt.replace(/\s+/g, ' ').trim(), h: l.h, y: l.y };
  }).filter(l => /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(l.t) && !/^(Tot|Pts|Err|Blo|E)\b[:\s]/i.test(l.t));
  res.sort((a, b) => b.h - a.h || a.y - b.y);
  return res.map(l => l.t).filter((t, i, a) => a.indexOf(t) === i).slice(0, 8);
}


/* VolleyStation raporunun başlık sayfası: "Players  3 ERTEK" satırı. Bulunursa oyuncu adı döner. */
function playersFromHeader(items, vp) {
  const its = items.map(it => { const t = pdfjsLib.Util.transform(vp.transform, it.transform); return { s: (it.str || '').trim(), x: t[4], y: t[5], w: (it.width || 0) * vp.scale }; }).filter(i => i.s);
  const k = its.find(i => /^Players?$/i.test(i.s));
  if (!k) return null;
  const same = its.filter(i => i !== k && Math.abs(i.y - k.y) < 3 && i.x > k.x).sort((a, b) => a.x - b.x);
  let txt = '', end = null;
  for (const p of same) { if (end != null && p.x - end > 2 && !/\s$/.test(txt)) txt += ' '; txt += p.s; end = p.x + p.w; }
  txt = txt.replace(/\s+/g, ' ').trim();
  return txt || null;
}

async function parsePdf(buf, name) {
  if (!window.pdfjsLib) throw new Error('PDF okuyucu yüklenemedi (vendor/pdf.min.js).');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const bytes = new Uint8Array(buf);
  const fp = (await sha1(bytes)).slice(0, 10);
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; }
  catch (e) { throw new Error('Bu dosya okunamadı. Geçerli bir PDF mi?'); }
  const players = [], pages = []; const warns = [];
  for (let pn = 1; pn <= pdf.numPages; pn++) {
    prog(`PDF okunuyor… sayfa ${pn}/${pdf.numPages}`);
    const page = await pdf.getPage(pn);
    const v0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, Math.max(1.5, 2600 / Math.max(v0.width, v0.height))) });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const found = detectPanels(cv);
    const d3 = found.length ? g.getImageData(0, 0, cv.width, cv.height).data : null;
    let cands = [], tcItems = [];
    try { const tc = await page.getTextContent(); tcItems = tc.items; cands = textCandidates(tc.items, vp, found.map(f => ({ x0: f.hx0, y0: f.strip, x1: f.hx1, y1: f.blue.y1 }))); } catch (_) { }
    const panels = [];
    for (let i = 0; i < found.length; i++) {
      const f = found[i];
      const full = f.ch / f.cw > 1.4;           // VolleyStation'ın tam saha görünümü: file ortada, iki yarı
      let c2, courtRel, btRel;
      if (!full) {
        const bx0 = Math.max(0, f.hx0 - 3), by0 = Math.max(0, f.strip - 3), bx1 = Math.min(cv.width, f.hx1 + 3), by1 = Math.min(cv.height, f.blue.y1 + 3);
        const w = bx1 - bx0, h = by1 - by0;
        c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        c2.getContext('2d').drawImage(cv, bx0, by0, w, h, 0, 0, w, h);
        courtRel = { x0: (f.court.x0 - bx0) / w, y0: (f.court.y0 - by0) / h, x1: (f.court.x1 - bx0) / w, y1: (f.court.y1 - by0) / h }; btRel = (f.blue.y0 - by0) / h;
      } else {
        // alt yarı: şerit (kod + istatistik) + ince mavi üst bant + file çizgisinin altındaki yarı saha
        const cw = f.court.x1 - f.court.x0, mid = Math.round((f.court.y0 + f.court.y1) / 2);
        const white = y => { let n = 0, t = 0; for (let x = f.court.x0 + Math.round(cw * 0.15); x < f.court.x1 - Math.round(cw * 0.15); x += 2) { const q = (y * cv.width + x) * 4; t++; if (d3[q] > 235 && d3[q + 1] > 235 && d3[q + 2] > 235) n++; } return n / t > 0.7; };
        let h0 = mid; for (let y = mid - 8; y <= mid + 10; y++) if (white(y)) h0 = y + 1;
        const sx0 = Math.max(0, f.hx0 - 3), sx1 = Math.min(cv.width, f.hx1 + 3), w = sx1 - sx0;
        const sTop = Math.max(0, f.strip - 3), stripH = Math.max(0, f.blue.y0 - sTop), band = Math.round(cw * 0.035);
        const by1 = Math.min(cv.height, f.blue.y1 + 3), lowH = by1 - h0, h = stripH + band + lowH;
        c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        const g2 = c2.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, w, h);
        if (stripH > 0) g2.drawImage(cv, sx0, sTop, w, stripH, 0, 0, w, stripH);
        const bp = (Math.round(h0 + 6) * cv.width + f.blue.x0 + 3) * 4;
        g2.fillStyle = `rgb(${d3[bp]},${d3[bp + 1]},${d3[bp + 2]})`; g2.fillRect(f.blue.x0 - sx0, stripH, f.blue.x1 - f.blue.x0, band + 1);
        g2.drawImage(cv, sx0, h0, w, lowH, 0, stripH + band, w, lowH);
        courtRel = { x0: (f.court.x0 - sx0) / w, y0: (stripH + band) / h, x1: (f.court.x1 - sx0) / w, y1: (stripH + band + (f.court.y1 - h0)) / h }; btRel = stripH / h;
      }
      const w = c2.width, h = c2.height;
      const blob = await toBlob(c2);
      panels.push({ key: `${fp}:${pn}:${i + 1}`, blob, url: URL.createObjectURL(blob), w, h, bt: btRel, court: courtRel, half: full });
    }
    cv.width = cv.height = 1;
    // atak kodu: önce metin katmanı (2 harf/rakam, kartın sol üstünde), yoksa etiket görselinin parmak izi
    for (let i = 0; i < panels.length; i++) {
      const f = found[i], c = panels[i];
      let code = null;
      for (const it of tcItems) {
        const s = (it.str || '').trim(); if (!/^[A-Z][A-Z0-9]$/.test(s)) continue;
        const t = pdfjsLib.Util.transform(vp.transform, it.transform);
        if (t[4] >= f.hx0 - 6 && t[4] <= f.blue.x0 + f.cw * 0.3 && t[5] >= f.strip - 6 && t[5] <= f.blue.y0 + f.cw * 0.12) { code = s; break; }
      }
      if (!code) { try { code = matchCode(await labelSig(c), window.DEFANS_REFS); } catch (_) { } }
      c.code = code || '';
    }
    pages.push({ pn, hdr: playersFromHeader(tcItems, vp), cands, panels });
  }
  // oyuncuları kur: VolleyStation raporunda her oyuncu "Players …" filtreli bir başlık sayfasıyla başlar;
  // bu yoksa her sayfa bir oyuncudur (aynı adlı ardışık sayfalar birleşir).
  const report = pages.some(p => p.hdr);
  for (const pg of pages) {
    if (report) {
      if (pg.hdr) players.push({ id: `${fp}:p${pg.pn}`, name: pg.hdr, cands: [], page: pg.pn, panels: [] });
      else if (!players.length) players.push({ id: `${fp}:p${pg.pn}`, name: '', cands: pg.cands, page: pg.pn, panels: [] });
      players[players.length - 1].panels.push(...pg.panels);
    } else {
      const nm = pg.cands[0] || '', prev = players[players.length - 1];
      if (prev && nm && prev.name === nm) prev.panels.push(...pg.panels);
      else players.push({ id: `${fp}:p${pg.pn}`, name: nm, cands: pg.cands, page: pg.pn, panels: pg.panels });
    }
    if (!pg.panels.length && !pg.hdr) warns.push(`Sayfa ${pg.pn}: heatmap bulunamadı`);
  }
  prog(null);
  return { name, fp, players, warns, pages: pdf.numPages };
}


/* ——— atak kodu (kartın sol üstündeki etiket: C1, XS, PP …) ——— */
const SG_W = 24, SG_H = 12;
async function labelSig(c) {
  const bmp = await createImageBitmap(c.blob);
  const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const x1 = Math.round(c.w * 0.24), y1 = Math.min(c.h, Math.round(((c.bt || 0.15) + 0.09) * c.h));
  if (x1 < 8 || y1 < 6) return null;
  const d = g.getImageData(0, 0, x1, y1).data;
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, n = 0; const dark = new Uint8Array(x1 * y1);
  for (let y = 0; y < y1; y++) for (let x = 0; x < x1; x++) {
    const i = (y * x1 + x) * 4, lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    if (lum < 115 && d[i + 2] - d[i] < 90) { dark[y * x1 + x] = 1; n++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  if (n < 12) return null;
  // bağlı bileşenler: çerçeve kenarındaki ince çizgileri ve lekeleri at, yalnızca harf boyutundakileri tut
  const lb = new Uint8Array(x1 * y1); bx0 = 1e9; by0 = 1e9; bx1 = -1; by1 = -1; n = 0;
  for (let s = 0; s < x1 * y1; s++) {
    if (!dark[s] || lb[s]) continue;
    const st = [s]; lb[s] = 1; const cells = []; let cx0 = 1e9, cy0 = 1e9, cx1 = -1, cy1 = -1;
    while (st.length) {
      const i = st.pop(), x = i % x1, y = (i / x1) | 0; cells.push(i);
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= x1 || yy >= y1) continue; const j = yy * x1 + xx; if (dark[j] && !lb[j]) { lb[j] = 1; st.push(j); } }
    }
    const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;
    if (cells.length < 6 || (w <= 3 && h >= 8) || (h <= 3 && w >= 8)) { cells.forEach(i => { dark[i] = 0; }); continue; }
    n += cells.length; if (cx0 < bx0) bx0 = cx0; if (cx1 > bx1) bx1 = cx1; if (cy0 < by0) by0 = cy0; if (cy1 > by1) by1 = cy1;
  }
  if (n < 12) return null;
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1; if (bh < 5 || bw < 4) return null;
  let s = '';
  for (let gy = 0; gy < SG_H; gy++) for (let gx = 0; gx < SG_W; gx++) {
    const xa = bx0 + gx * bw / SG_W, xb = bx0 + (gx + 1) * bw / SG_W, ya = by0 + gy * bh / SG_H, yb = by0 + (gy + 1) * bh / SG_H;
    let sum = 0, cnt = 0;
    for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); y++) for (let x = Math.floor(xa); x < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); x++) { cnt++; if (dark[Math.min(y1 - 1, y) * x1 + Math.min(x1 - 1, x)]) sum++; }
    s += Math.min(9, Math.round(sum / cnt * 9));
  }
  return { s, ar: bw / bh };
}
function sigDist(a, b) {
  let t = 0; for (let i = 0; i < a.s.length; i++) t += Math.abs(a.s.charCodeAt(i) - b.s.charCodeAt(i));
  return t / (a.s.length * 9) + Math.abs(Math.log(a.ar / b.ar)) * 0.3;
}
/* En yakın referans koduna eşler; yeterince yakın değilse ya da ikinci aday çok yakınsa null. */
function matchCode(sig, refs) {
  if (!sig || !refs) return null;
  let best = null, second = Infinity;
  for (const code in refs.sigs) {
    let dmin = Infinity; for (const r of refs.sigs[code]) dmin = Math.min(dmin, sigDist(sig, r));
    if (!best || dmin < best.d) { if (best) second = best.d; best = { code, d: dmin }; } else if (dmin < second) second = dmin;
  }
  return best && best.d < 0.12 && second - best.d > 0.02 ? best.code : null;
}


/* ——— atak koduna göre başlangıç daireleri ——— */
const cardCode = c => String(S.codes?.[c.key] ?? c.code ?? '').trim().toUpperCase();
function refFor(code) {
  if (!code) return null;
  const u = S.refs?.[code]; if (u?.length) return u;
  const b = window.DEFANS_REFS?.circles?.[code]; return b ? b.map(p => ({ x: p[0], y: p[1], sh: 'c' })) : null;
}
const dotsFromRef = tpl => tpl.map((p, i) => ({ id: i + 1, n: i + 1, x: +p.x.toFixed(4), y: +p.y.toFixed(4), col: 'k', sh: p.sh || 'c', ...(p.rot ? { rot: p.rot } : {}) }));
/* Daha önce hiç dokunulmamış (kayıtsız) kartlara, kodu tanınıyorsa referans daireleri koyar. */
function autoPlace(d) {
  let cards = 0, dots = 0; const unk = {};
  for (const p of d.players) for (const c of p.panels) {
    if (S.courts[c.key]) continue;
    const code = cardCode(c), tpl = refFor(code);
    if (!tpl) { const k = code || '?'; unk[k] = (unk[k] || 0) + 1; continue; }
    S.courts[c.key] = { c: dotsFromRef(tpl), cap: '', auto: true }; cards++; dots += tpl.length;
  }
  return { cards, dots, unk };
}

/* ——— çizim ——— */
const courtEl = (key) => courtEls[key]?.el;
function photoURL(pid) {
  const ph = photos[pid]; if (!ph) return null;
  const b = ph.show || ph.orig; if (!b) return null;
  if (ph._src !== b) { if (ph.url) URL.revokeObjectURL(ph.url); ph.url = URL.createObjectURL(b); ph._src = b; }
  return ph.url;
}
const visPanels = p => p.panels.filter(c => !pst(p.id).hid[c.key]);

function renderPlayers() {
  const host = $('#players'); host.innerHTML = '';
  for (const k in courtEls) delete courtEls[k];
  if (!deck) { buildNav(); refreshAll(); return; }
  deck.players.forEach((p, pi) => {
    const st = pst(p.id); if (st.off) return;
    const sec = document.createElement('section'); sec.className = 'player'; sec.id = 'pl' + pi; sec.dataset.pid = p.id;
    sec.style.setProperty('--cols', S.cols); sec.style.setProperty('--phmm', (st.mm || 38) + 'mm');
    const url = photoURL(p.id), has = !!photos[p.id];
    const top = document.createElement('div'); top.className = 'pl-top';
    top.innerHTML =
      `<div class="photo">${url ? `<img src="${url}" alt="">` : `<label class="ph-empty" for="phIn${pi}">Fotoğraf eklemek için dokunun</label>`}</div>` +
      `<div class="pctl">` +
        `<label class="chip" for="phIn${pi}">${has ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle'}</label><input type="file" id="phIn${pi}" accept="image/*" hidden data-act="photo">` +
        (has ? `<button class="chip" data-act="cut">✨ Arka planı temizle</button>` : '') +
        (photos[p.id]?.show ? `<button class="chip" data-act="uncut" title="Silinen arka planı geri getir">Arka planı geri getir</button>` : '') +
        (has ? `<label class="sz">Boyut <input type="range" min="20" max="80" step="1" value="${st.mm || 38}" data-act="size" aria-label="Fotoğraf boyutu"></label><button class="chip danger" data-act="rmphoto">Fotoğrafı kaldır</button>` : '') +
        `<button class="chip danger" data-act="rmplayer" title="Bu oyuncuyu sayfadan kaldır (Kaldırılanlar’dan geri getirilir)">Oyuncuyu kaldır</button>` +
      `</div>` +
      `<div class="pname"><h2 class="hn" contenteditable="true" spellcheck="false" data-act="name" aria-label="Oyuncu adı" data-ph="Oyuncu adı">${esc(nameOf(p))}</h2>` +
        (p.cands.length > 1 ? `<select data-act="cand" aria-label="Sayfadaki diğer yazılar"><option value="">Ad seç…</option>${p.cands.map(c => `<option>${esc(c)}</option>`).join('')}</select>` : '') + `</div>`;
    sec.appendChild(top);
    const vis = visPanels(p);
    if (!p.panels.length) { const w = document.createElement('div'); w.className = 'pwarn'; w.textContent = `PDF’in ${p.page}. sayfasında heatmap bulunamadı. Orijinal PDF’i kontrol edin.`; sec.appendChild(w); }
    const grid = document.createElement('div'); grid.className = 'pgrid';
    vis.forEach(c => grid.appendChild(cardEl(c)));
    sec.appendChild(grid);
    host.appendChild(sec);
  });
  buildNav(); refreshAll();
}

function cardEl(c) {
  const f = document.createElement('figure'); f.className = 'pcard'; f.dataset.key = c.key;
  const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.title = 'Bu kartı kaldır'; x.setAttribute('aria-label', 'Kartı kaldır'); x.textContent = '✕'; x.dataset.act = 'rmcard';
  f.appendChild(x);
  const fig = document.createElement('div'); fig.className = 'pfig';
  const img = document.createElement('img'); img.src = c.url; img.alt = ''; img.width = c.w; img.height = c.h; fig.appendChild(img);
  const ct = c.court;
  const el = document.createElement('div'); el.className = 'court'; el.dataset.key = c.key;
  el.style.cssText = `left:${ct.x0 * 100}%;top:${ct.y0 * 100}%;width:${(ct.x1 - ct.x0) * 100}%;height:${(ct.y1 - ct.y0) * 100}%;--cw:${((ct.x1 - ct.x0) * 100).toFixed(3)}cqw;`;
  fig.appendChild(el);
  // not: mavi alt şeritte yeterli yer varsa orada, yoksa kartın altında
  const bandCq = (1 - ct.y1) * (c.h / c.w) * 100;
  let capEl;
  if (bandCq >= 5) {
    capEl = document.createElement('div'); capEl.className = 'cap';
    capEl.style.cssText = `top:${ct.y1 * 100}%;height:${(1 - ct.y1) * 100}%;font-size:${Math.min(bandCq * 0.55, 6.5).toFixed(2)}cqw;`;
    fig.appendChild(capEl);
  }
  f.appendChild(fig);
  let below = null;
  if (!capEl) { below = document.createElement('div'); below.className = 'capb'; fig.appendChild(below); capEl = below; }
  courtEls[c.key] = { el, capEl, below, panel: c };
  return f;
}

function dotEl(c, key) {
  const d = document.createElement('div');
  d.className = 'dot' + (c.sh === 'o' ? ' oval' : '') + (sel.key && sel.id === c.id && sel.key === key ? ' sel' : '');
  d.dataset.id = c.id;
  const base = `calc(var(--cw) * ${S.size})`;
  const col = COLORS[c.col] || COLORS.k;
  d.style.cssText = `left:${c.x * 100}%;top:${c.y * 100}%;color:${col};border-color:${col};border-width:max(2px, calc(var(--cw) * 0.022));` +
    (c.sh === 'o' ? `width:calc(${base} * 2);height:${base};` : `width:${base};height:${base};`) +
    `font-size:calc(${base} * ${String(c.n).length > 1 ? 0.46 : 0.58});` +
    (c.rot ? `transform:translate(-50%,-50%) rotate(${c.rot}deg);` : '');
  if (S.nums === true && String(c.n) !== '') {
    const sp = document.createElement('span'); sp.className = 'dn'; sp.textContent = c.n;
    if (c.rot) sp.style.transform = `rotate(${-c.rot}deg)`;
    d.appendChild(sp);
  }
  if (c.sh === 'o' && sel.key === key && sel.id === c.id && !$('#lock').checked) {
    const h = document.createElement('div'); h.className = 'rot-h'; h.title = 'Döndürmek için sürükleyin'; d.appendChild(h);
  }
  return d;
}

function refreshCourt(key) {
  const ce = courtEls[key]; if (!ce) return;
  ce.el.querySelectorAll('.dot').forEach(n => n.remove());
  const data = S.courts[key];
  (data?.c || []).forEach(c => ce.el.appendChild(dotEl(c, key)));
  ce.capEl.textContent = data?.cap || '';
  if (ce.below) ce.below.style.display = data?.cap ? '' : 'none';
  ce.el.classList.toggle('sel-c', sel.key === key);
}
function removedList() {
  const out = [];
  if (!deck) return out;
  for (const p of deck.players) {
    const st = pst(p.id);
    if (st.off) out.push({ kind: 'player', p });
    else for (const c of p.panels) if (st.hid[c.key]) out.push({ kind: 'card', p, c });
  }
  return out;
}
function refreshAll() {
  for (const k in courtEls) refreshCourt(k);
  if (deck) deck.players.forEach((p, pi) => {
    const n = visPanels(p).reduce((a, c) => a + (S.courts[c.key]?.c?.length || 0), 0);
    const badge = document.querySelector(`#nav a[data-i="${pi}"] .ct`); if (badge) { badge.textContent = n || ''; badge.style.display = n ? '' : 'none'; }
  });
  const nr = removedList().length;
  $('#btnRestore').hidden = !nr; $('#nRem').textContent = nr; if (!nr) $('#rmPanel').hidden = true;
  $('#btnUndo').disabled = !hist.length; $('#btnRedo').disabled = !redo.length;
  updateTray();
}

function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '<h2>Oyuncular</h2>';
  if (!deck) return;
  deck.players.forEach((p, pi) => {
    if (pst(p.id).off) return;
    const a = document.createElement('a'); a.href = '#pl' + pi; a.dataset.i = pi;
    a.innerHTML = `<span class="no">${pi + 1}</span><span class="nm">${esc(nameOf(p) || 'Oyuncu ' + (pi + 1))}</span><span class="ct" style="display:none"></span>`;
    a.addEventListener('click', e => { e.preventDefault(); document.getElementById('pl' + pi)?.scrollIntoView({ behavior: 'smooth' }); if (innerWidth <= 900) nav.classList.add('hidden'); });
    nav.appendChild(a);
  });
}

/* ——— düzenleme ——— */
function mutate(fn, full = false) {
  hist.push(JSON.stringify(S)); if (hist.length > 300) hist.shift(); redo = [];
  fn(); persist(); full ? renderPlayers() : refreshAll();
}
function restoreFrom(json) { const keep = { size: S.size, nums: S.nums, cols: S.cols }; S = Object.assign(JSON.parse(json), keep); fixSel(); syncControls(); persist(); renderPlayers(); }
function undo() { if (!hist.length) return; redo.push(JSON.stringify(S)); restoreFrom(hist.pop()); }
function redoIt() { if (!redo.length) return; hist.push(JSON.stringify(S)); restoreFrom(redo.pop()); }
function fixSel() { if (sel.id != null && !(S.courts[sel.key]?.c || []).some(c => c.id === sel.id)) sel.id = null; if (sel.key && !courtEls[sel.key]) { sel = { key: null, id: null }; } }
function syncControls() { $('#size').value = String(S.size); $('#showNums').checked = S.nums === true; $('#cols').value = String(S.cols || 4); }
let saveT = null;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => idb.set('st2', S).catch(() => toast('Kaydedilemedi: tarayıcı depolaması dolu olabilir.')), 150); }
const court = key => (S.courts[key] ||= { c: [], cap: '' });
const nextNo = key => { const used = new Set((S.courts[key]?.c || []).map(c => String(c.n))); for (let i = 1; i <= 6; i++) if (!used.has(String(i))) return i; return (S.courts[key]?.c || []).length + 1; };
const nextId = key => Math.max(0, ...(S.courts[key]?.c || []).map(c => c.id)) + 1;
const curDot = () => (S.courts[sel.key]?.c || []).find(c => c.id === sel.id) || null;

function selectCourt(key) { const prev = sel.key; sel.key = key; if (prev !== key) sel.id = null; }
function selectDot(key, id) { sel.key = key; sel.id = id; }
function clearSel() { sel = { key: null, id: null }; refreshAll(); }

function pointIn(el, e) {
  const r = el.getBoundingClientRect();
  return { x: Math.min(1.08, Math.max(-0.08, (e.clientX - r.left) / r.width)), y: Math.min(1.08, Math.max(-0.08, (e.clientY - r.top) / r.height)) };
}

let drag = null;
$('#stage').addEventListener('pointerdown', e => {
  const ct = e.target.closest('.court');
  if (!ct) { if (sel.key && !e.target.closest('.pcard,.pl-top')) clearSel(); return; }
  const key = ct.dataset.key; const dot = e.target.closest('.dot');
  const locked = $('#lock').checked;
  if (e.target.closest('.rot-h') && dot && !locked) {
    drag = { key, id: +dot.dataset.id, ct, rotate: true, moved: true, dotEl: dot, ang: null };
    ct.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  selectCourt(key);
  if (dot) {
    selectDot(key, +dot.dataset.id); refreshAll();
    if (locked) return;
    drag = { key, id: +dot.dataset.id, ct, moved: false, sx: e.clientX, sy: e.clientY, pos: null };
    ct.setPointerCapture(e.pointerId); e.preventDefault();
  } else {
    sel.id = null; refreshAll();
    if (locked) return;
    drag = { key, tap: true, ct, moved: false, sx: e.clientX, sy: e.clientY };
    ct.setPointerCapture(e.pointerId);
  }
});
$('#stage').addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.rotate) {
    const r = drag.dotEl.getBoundingClientRect();
    let a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    a = Math.round(a / 5) * 5; if (a === -180) a = 180; drag.ang = a;
    drag.dotEl.style.transform = `translate(-50%,-50%) rotate(${a}deg)`;
    const n = drag.dotEl.querySelector('.dn'); if (n) n.style.transform = `rotate(${-a}deg)`;
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
  if (drag.id != null && drag.moved) {
    const p = pointIn(drag.ct, e); drag.pos = p;
    const d = drag.ct.querySelector(`.dot[data-id="${drag.id}"]`); if (d) { d.style.left = p.x * 100 + '%'; d.style.top = p.y * 100 + '%'; }
  }
});
const endDrag = e => {
  if (!drag) return; const d = drag; drag = null;
  try { d.ct.releasePointerCapture(e.pointerId); } catch (_) { }
  if (e.type === 'pointercancel') { refreshAll(); return; }
  if (d.rotate) { if (d.ang != null) mutate(() => { const c = (S.courts[d.key].c).find(c => c.id === d.id); if (c) c.rot = d.ang; }); return; }
  if (d.tap && !d.moved) {
    const p = pointIn(d.ct, e); if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    mutate(() => { const cd = court(d.key); const id = nextId(d.key); cd.c.push({ id, n: nextNo(d.key), x: +p.x.toFixed(4), y: +p.y.toFixed(4), col: 'k', sh: 'c' }); sel.key = d.key; sel.id = id; });
  } else if (d.id != null && d.moved && d.pos) {
    mutate(() => { const c = (S.courts[d.key].c).find(c => c.id === d.id); if (c) { c.x = +d.pos.x.toFixed(4); c.y = +d.pos.y.toFixed(4); } });
  }
};
$('#stage').addEventListener('pointerup', endDrag);
$('#stage').addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
  if (document.querySelector('.bgEd')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoIt() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoIt(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && curDot()) { e.preventDefault(); delDot(); }
});

function delDot() { const c = curDot(); if (!c) return; mutate(() => { const cd = S.courts[sel.key]; cd.c = cd.c.filter(x => x.id !== c.id); sel.id = null; }); }

/* ——— alt çubuk ——— */
function buildTray() {
  $('#trNums').innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<button class="chip" data-n="${n}">${n}</button>`).join('');
  $('#trCols').innerHTML = Object.entries(COLORS).map(([k, v]) => `<button class="chip col" data-col="${k}" aria-label="Renk ${k}"><i style="background:${v}"></i></button>`).join('');
  $('#trCaps').innerHTML = CAPS.map(c => `<button class="chip cap-chip" data-cap="${c}">${c}</button>`).join('') + '<button class="chip cap-chip" data-cap="">Notu sil</button>';
}
function updateTray() {
  const tray = $('#tray'); const has = !!sel.key && courtEls[sel.key];
  tray.hidden = !has; if (!has) return;
  const c = curDot();
  $('#trDot').hidden = !c;
  if (c) {
    $('#trNums').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', String(c.n) === b.dataset.n));
    $('#trCols').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', c.col === b.dataset.col));
    $('#trShape').classList.toggle('on', c.sh === 'o');
    $('#trRot').hidden = c.sh !== 'o'; $('#trRotV').textContent = (c.rot || 0) + '°';
  }
  const cd = S.courts[sel.key];
  $('#trCap').value !== (cd?.cap || '') && document.activeElement !== $('#trCap') && ($('#trCap').value = cd?.cap || '');
  $('#trCaps').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.cap !== '' && (cd?.cap || '') === b.dataset.cap));
  const code = cardCode(courtEls[sel.key].panel);
  if (document.activeElement !== $('#trCode')) $('#trCode').value = code;
  $('#trRef').disabled = !code || !cd?.c?.length; $('#trApplyRef').disabled = !refFor(code);
  $('#trRef').style.opacity = $('#trRef').disabled ? .45 : 1; $('#trApplyRef').style.opacity = $('#trApplyRef').disabled ? .45 : 1;
  $('#trPaste').disabled = !clip; $('#trPaste').style.opacity = clip ? 1 : .45;
}
$('#trNums').addEventListener('click', e => { const b = e.target.closest('[data-n]'); const c = curDot(); if (!b || !c) return; mutate(() => { c.n = +b.dataset.n; }); });
$('#trNumCustom').addEventListener('click', () => { const c = curDot(); if (!c) return; const v = prompt('Daire üzerinde ne yazsın? (en çok 3 karakter)', c.n); if (v != null && v.trim()) mutate(() => { c.n = v.trim().slice(0, 3); }); });
$('#trCols').addEventListener('click', e => { const b = e.target.closest('[data-col]'); const c = curDot(); if (!b || !c) return; mutate(() => { c.col = b.dataset.col; }); });
$('#trShape').addEventListener('click', () => { const c = curDot(); if (!c) return; mutate(() => { c.sh = c.sh === 'o' ? 'c' : 'o'; }); });
$('#trRot').addEventListener('click', e => {
  const b = e.target.closest('[data-rot]'); const c = curDot(); if (!b || !c) return;
  mutate(() => { let a = b.dataset.rot === '0' ? 0 : (c.rot || 0) + (+b.dataset.rot); a = ((a + 180) % 360 + 360) % 360 - 180; c.rot = a === -180 ? 180 : a; });
});
$('#trDel').addEventListener('click', delDot);
$('#trForm').addEventListener('change', e => {
  const f = FORMS[e.target.value]; e.target.value = ''; if (!f || !sel.key) return;
  const cd0 = S.courts[sel.key]?.c || [];
  if (cd0.length && !confirm('Bu sahadaki mevcut daireler formasyonla değiştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  mutate(() => { court(sel.key).c = f.map((p, i) => ({ id: i + 1, n: i + 1, x: p[0], y: p[1], col: 'k', sh: p[2] })); sel.id = null; });
});
$('#trCopy').addEventListener('click', () => { const cd = S.courts[sel.key]; if (!cd?.c?.length) { toast('Kopyalanacak daire yok.'); return; } clip = JSON.parse(JSON.stringify(cd.c)); updateTray(); toast(cd.c.length + ' daire kopyalandı. Başka sahaya dokunup “Yapıştır”a basın.'); });
$('#trPaste').addEventListener('click', () => {
  if (!clip || !sel.key) return;
  if ((S.courts[sel.key]?.c || []).length && !confirm('Bu sahadaki mevcut daireler yapıştırılanlarla değiştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  mutate(() => { court(sel.key).c = JSON.parse(JSON.stringify(clip)); sel.id = null; });
});
$('#trCode').addEventListener('input', e => {
  if (!sel.key) return; const key = sel.key, v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3); e.target.value = v;
  clearTimeout($('#trCode')._t); $('#trCode')._t = setTimeout(() => { if ((S.codes[key] ?? courtEls[key]?.panel.code ?? '') !== v) mutate(() => { (S.codes ||= {})[key] = v; }); updateTray(); }, 400);
});
$('#trRef').addEventListener('click', () => {
  const key = sel.key; if (!key) return; const code = cardCode(courtEls[key].panel); const cd = S.courts[key];
  if (!code) { toast('Önce kartın atak kodunu yazın (örn. XS).'); $('#trCode').focus(); return; }
  if (!cd?.c?.length) { toast('Bu kartta daire yok; referans yapılamaz.'); return; }
  mutate(() => { (S.refs ||= {})[code] = cd.c.map(c => ({ x: c.x, y: c.y, sh: c.sh, ...(c.rot ? { rot: c.rot } : {}) })); });
  toast(`${code} kodunun referansı bu kartın daireleri oldu. Sonraki PDF’lerde ${code} kodlu kartlara böyle yerleşir.`, 5000);
});
$('#trApplyRef').addEventListener('click', () => {
  const key = sel.key; if (!key) return; const code = cardCode(courtEls[key].panel), tpl = refFor(code);
  if (!tpl) { toast(code ? `${code} için kayıtlı referans yok.` : 'Önce kartın atak kodunu yazın.'); return; }
  if ((S.courts[key]?.c || []).length && !confirm('Bu kartın daireleri kodun referansıyla değiştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  mutate(() => { court(key).c = dotsFromRef(tpl); sel.id = null; });
});
$('#trClear').addEventListener('click', () => { if (!S.courts[sel.key]?.c?.length) return; mutate(() => { S.courts[sel.key].c = []; sel.id = null; }); });
$('#trCaps').addEventListener('click', e => { const b = e.target.closest('[data-cap]'); if (!b || !sel.key) return; mutate(() => { court(sel.key).cap = b.dataset.cap; }); $('#trCap').value = b.dataset.cap; });
$('#trCap').addEventListener('input', e => { if (!sel.key) return; const key = sel.key; const v = e.target.value.toUpperCase(); clearTimeout($('#trCap')._t); $('#trCap')._t = setTimeout(() => { if ((S.courts[key]?.cap || '') !== v) mutate(() => { court(key).cap = v; }); }, 400); });

/* ——— oyuncu başlığı: fotoğraf, ad, kart/oyuncu kaldırma ——— */
const pidOf = el => el.closest('.player')?.dataset.pid;
const playerById = id => deck?.players.find(p => p.id === id);
async function savePhotos() {
  const o = {};
  for (const id in photos) o[id] = { orig: await pack(photos[id].orig), cut: await pack(photos[id].cut), show: await pack(photos[id].show) };
  await idb.set('photos', o).catch(() => toast('Fotoğraflar kaydedilemedi: tarayıcı depolaması dolu olabilir.'));
}
async function setPhoto(pid, file) {
  try {
    const orig = await BgEditor.prepare(file);
    photos[pid] = { orig, cut: null, show: null };
    await savePhotos(); renderPlayers();
  } catch (err) { console.error(err); toast('Fotoğraf okunamadı: ' + (err.message || 'desteklenmeyen biçim')); }
}
async function cutPhoto(pid) {
  const ph = photos[pid]; if (!ph) return;
  const res = await BgEditor.open(ph.orig, ph.cut);
  if (!res) return;
  ph.cut = res.cut; ph.show = res.show; await savePhotos(); renderPlayers(); toast('Arka plan temizlendi.');
}

$('#players').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, pid = pidOf(b);
  if (act === 'rmcard') {
    const key = b.closest('.pcard').dataset.key;
    mutate(() => { pst(pid).hid[key] = 1; if (sel.key === key) sel = { key: null, id: null }; }, true);
  } else if (act === 'rmplayer') {
    const p = playerById(pid); if (!confirm(`“${nameOf(p) || 'Bu oyuncu'}” sayfadan kaldırılsın mı? (Üstteki “Kaldırılanlar”dan geri getirebilirsiniz.)`)) return;
    mutate(() => { pst(pid).off = true; sel = { key: null, id: null }; }, true);
  } else if (act === 'cut') cutPhoto(pid);
  else if (act === 'uncut') { const ph = photos[pid]; if (ph) { ph.cut = null; ph.show = null; await savePhotos(); renderPlayers(); } }
  else if (act === 'rmphoto') { if (!confirm('Fotoğraf kaldırılsın mı?')) return; delete photos[pid]; await savePhotos(); renderPlayers(); }
});
$('#players').addEventListener('change', async e => {
  const t = e.target, act = t.dataset?.act; if (!act) return;
  const pid = pidOf(t);
  if (act === 'photo') { const f = t.files[0]; t.value = ''; if (f) await setPhoto(pid, f); }
  else if (act === 'cand') { const v = t.value; if (!v) return; mutate(() => { pst(pid).name = v; }, true); }
  else if (act === 'size') { mutate(() => { pst(pid).mm = +t.value; }); }
});
$('#players').addEventListener('input', e => {
  const t = e.target; if (t.dataset?.act !== 'size') return;
  t.closest('.player').style.setProperty('--phmm', t.value + 'mm');          // sürüklerken anında göster, kayıt 'change'de
});
$('#players').addEventListener('focusout', e => {
  const t = e.target; if (t.dataset?.act !== 'name') return;
  const pid = pidOf(t), p = playerById(pid), v = t.textContent.replace(/\s+/g, ' ').trim();
  if (v !== nameOf(p)) { mutate(() => { pst(pid).name = v; }); buildNav(); refreshAll(); }
});
$('#players').addEventListener('keydown', e => { if (e.target.dataset?.act === 'name' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

/* Kaldırılanlar paneli */
$('#btnRestore').addEventListener('click', () => { $('#rsPanel').hidden = true; const r = removedList(); if (!r.length) return; const p = $('#rmPanel'); p.hidden = !p.hidden; if (!p.hidden) renderRemoved(); });
function renderRemoved() {
  const p = $('#rmPanel'); const r = removedList();
  p.innerHTML = `<h3>Kaldırılanlar</h3>` + r.map((x, i) => x.kind === 'card'
    ? `<div class="it"><img src="${x.c.url}" alt=""><span>${esc(nameOf(x.p) || 'Oyuncu')} · kart ${x.p.panels.indexOf(x.c) + 1}</span><button class="chip" data-i="${i}">Geri getir</button></div>`
    : `<div class="it"><span><b>${esc(nameOf(x.p) || 'Oyuncu')}</b> (tüm oyuncu)</span><button class="chip" data-i="${i}">Geri getir</button></div>`).join('') +
    `<div class="it"><button class="chip" id="rmAll">Hepsini geri getir</button></div>`;
}
$('#rmPanel').addEventListener('click', e => {
  const all = e.target.closest('#rmAll'), b = e.target.closest('[data-i]');
  if (!all && !b) return;
  const r = removedList();
  mutate(() => { for (const x of (all ? r : [r[+b.dataset.i]])) { if (!x) continue; if (x.kind === 'player') pst(x.p.id).off = false; else delete pst(x.p.id).hid[x.c.key]; } }, true);
  if (!$('#rmPanel').hidden && removedList().length) renderRemoved();
});

/* ——— üst çubuk ——— */
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redoIt);
$('#btnNav').addEventListener('click', () => $('#nav').classList.toggle('hidden'));
$('#lock').addEventListener('change', e => { document.body.classList.toggle('locked', e.target.checked); try { localStorage.setItem('defansLock', e.target.checked ? '1' : ''); } catch (_) { } refreshAll(); });
$('#showNums').addEventListener('change', e => { S.nums = e.target.checked; persist(); refreshAll(); });
$('#size').addEventListener('change', e => { S.size = +e.target.value; persist(); refreshAll(); });
$('#cols').addEventListener('change', e => { S.cols = +e.target.value; persist(); document.querySelectorAll('.player').forEach(p => p.style.setProperty('--cols', S.cols)); });
$('#btnPrint').addEventListener('click', () => {
  if (!deck) { toast('Önce bir heatmap PDF’i açın.'); return; }
  clearSel(); setTimeout(() => window.print(), 50);
});

const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataURLToBlob = u => { const [h, d] = u.split(','); const t = /data:([^;]+)/.exec(h)[1]; const bin = atob(d); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: t }); };
$('#btnExport').addEventListener('click', async () => {
  const ph = {};
  for (const id in photos) ph[id] = { orig: await blobToDataURL(photos[id].orig), cut: photos[id].cut ? await blobToDataURL(photos[id].cut) : null, show: photos[id].show ? await blobToDataURL(photos[id].show) : null };
  const blob = new Blob([JSON.stringify({ app: 'vsm-defans', v: 2, size: S.size, nums: S.nums === true, cols: S.cols, courts: S.courts, pl: S.pl, refs: S.refs, codes: S.codes, photos: ph })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'defans-plani-yedek.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#importIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'vsm-defans' || !j.courts) throw new Error();
    mutate(() => {
      Object.assign(S.courts, j.courts);
      if (j.pl) for (const id in j.pl) S.pl[id] = Object.assign(pst(id), j.pl[id]);
      if (j.refs) Object.assign(S.refs ||= {}, j.refs); if (j.codes) Object.assign(S.codes ||= {}, j.codes);
      if (j.size) S.size = j.size; if (j.cols) S.cols = j.cols; if (typeof j.nums === 'boolean') S.nums = j.nums;
    }, true);
    if (j.photos) { for (const id in j.photos) { const o = j.photos[id]; photos[id] = { orig: dataURLToBlob(o.orig), cut: o.cut ? dataURLToBlob(o.cut) : null, show: o.show ? dataURLToBlob(o.show) : null }; } await savePhotos(); renderPlayers(); }
    syncControls();
    toast(j.v === 2 ? 'Yedek yüklendi.' : 'Eski biçimli yedek yüklendi. Daireler yeni PDF’teki kartlarla eşleşmeyebilir.');
  } catch (_) { toast('Bu dosya bir Defans Planı yedeği değil.'); }
});

/* ——— PDF açma ——— */
async function persistDeck() {
  const players = [];
  for (const p of deck.players) players.push({ id: p.id, name: p.name, cands: p.cands, page: p.page, panels: await Promise.all(p.panels.map(async c => ({ key: c.key, b: await pack(c.blob), w: c.w, h: c.h, bt: c.bt, code: c.code, court: c.court }))) });
  await idb.set('deck2', { name: deck.name, fp: deck.fp, players, warns: deck.warns, pages: deck.pages, at: Date.now() });
}
function loadDeckRecord(r) {
  return { name: r.name, fp: r.fp, warns: r.warns || [], pages: r.pages, players: r.players.map(p => ({ ...p, panels: p.panels.map(c => { const blob = unpack(c.b); return { key: c.key, blob, url: URL.createObjectURL(blob), w: c.w, h: c.h, bt: c.bt, code: c.code, court: c.court }; }) })) };
}
async function openPdf(file) {
  if (!file) return false;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Bu bir PDF dosyası değil. VolleyStation heatmap PDF’ini seçin.'); return false; }
  try {
    const buf = await file.arrayBuffer();
    const d = await parsePdf(buf, file.name);
    const nPan = d.players.reduce((a, p) => a + p.panels.length, 0);
    if (!nPan) { toast('Bu PDF’te heatmap bulunamadı (turuncu saha + mavi çerçeve aranır). Dosyayı bana gönderirseniz okuyucuyu ona göre ayarlarım.', 7000); return false; }
    deck = d; hist = []; redo = []; sel = { key: null, id: null };
    const ap = autoPlace(d); persist();
    $('#empty').hidden = true; renderPlayers();
    persistDeck().catch(() => toast('PDF tarayıcıya kaydedilemedi (depolama dolu olabilir); sayfa yenilenince yeniden açmanız gerekir.'));
    document.title = file.name + ' · Defans Planı';
    const unkL = Object.keys(ap.unk).filter(k => k !== '?');
    toast(`PDF açıldı: ${d.players.length} oyuncu, ${nPan} kart. ` + (ap.cards ? `${ap.cards} karta referans daireleri yerleşti.` : 'Referansı olan kod bulunamadı.') +
      (unkL.length ? ` Referansı olmayan kodlar boş bırakıldı: ${unkL.join(', ')}. (Hata değil; bu kartlara daireleri elle koyup “Referans yap”a basabilirsiniz.)` : '') + (d.warns.length ? ' Uyarı: ' + d.warns.join('; ') : ''), 9000);
    return true;
  } catch (err) { prog(null); console.error(err); toast('PDF açılamadı: ' + (err.message || err), 6000); return false; }
}
$('#pdfIn').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await openPdf(f); });
const drop = $('#drop');
['dragover', 'dragenter'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', async e => { const f = [...(e.dataTransfer?.files || [])].find(f => /\.pdf$/i.test(f.name) || /pdf$/i.test(f.type)); if (f) await openPdf(f); });

/* ——— PowerPoint çıktısı ——— */
$('#btnPptx').addEventListener('click', async () => {
  if (!deck) { toast('Önce bir heatmap PDF’i açın.'); return; }
  const btn = $('#btnPptx'); btn.disabled = true;
  try {
    const players = [];
    for (const p of deck.players) {
      const st = pst(p.id); if (st.off) continue;
      const cards = visPanels(p).map(c => ({ blob: c.blob, w: c.w, h: c.h, court: c.court, dots: S.courts[c.key]?.c || [], cap: S.courts[c.key]?.cap || '' }));
      if (!cards.length) continue;
      let photo = null; const pb = photos[p.id]?.show || photos[p.id]?.orig;
      if (pb) { const bmp = await createImageBitmap(pb); photo = { blob: pb, w: bmp.width, h: bmp.height }; }
      players.push({ name: nameOf(p), photo, mm: st.mm || 38, cards });
    }
    const r = await PptxOut.build({ players, size: S.size, nums: S.nums, cols: S.cols });
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob);
    a.download = (deck.name || 'defans').replace(/\.pdf$/i, '') + '-defans.pptx'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`PowerPoint hazır: ${r.slides} slayt, ${r.dots} daire${r.caps ? ', ' + r.caps + ' not' : ''}.`, 5000);
  } catch (err) { console.error(err); toast('PowerPoint oluşturulamadı: ' + (err.message || err)); }
  finally { btn.disabled = false; }
});


/* ——— sıfırlama ——— */
$('#btnReset').addEventListener('click', () => { $('#rmPanel').hidden = true; const p = $('#rsPanel'); p.hidden = !p.hidden; $('#rsCircles').disabled = !deck; });
$('#rsClose').addEventListener('click', () => { $('#rsPanel').hidden = true; });
$('#rsCircles').addEventListener('click', () => {
  if (!deck) return;
  if (!confirm('Tüm daireler ve notlar silinip referans daireleri baştan yerleştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  let ap; mutate(() => { S.courts = {}; S.codes = {}; sel = { key: null, id: null }; ap = autoPlace(deck); });
  $('#rsPanel').hidden = true; toast(`Baştan yerleştirildi: ${ap.cards} karta referans daireleri konuldu.`);
});
$('#rsAll').addEventListener('click', async () => {
  if (!confirm('PDF, kartlar, daireler, adlar ve fotoğraflar bu tarayıcıdan silinecek. Geri alınamaz. Devam edilsin mi?')) return;
  const keepRefs = !$('#rsRefs').checked, refs = keepRefs ? S.refs : {};
  deck?.players.forEach(p => p.panels.forEach(c => URL.revokeObjectURL(c.url)));
  for (const id in photos) { if (photos[id].url) URL.revokeObjectURL(photos[id].url); delete photos[id]; }
  deck = null; hist = []; redo = []; sel = { key: null, id: null }; clip = null;
  S = { courts: {}, size: 0.17, nums: false, cols: 4, pl: {}, refs, codes: {} };
  try { await idb.set('st2', S); await idb.set('deck2', null); await idb.set('photos', {}); } catch (_) { }
  $('#rsPanel').hidden = true; $('#rmPanel').hidden = true;
  syncControls(); renderPlayers(); $('#empty').hidden = false; document.title = 'Defans Planı · VSM Worksheet';
  toast('Sıfırlandı. Yeni bir heatmap PDF’i açabilirsiniz.');
});

/* ——— açılış ——— */
(async function init() {
  buildTray();
  if (innerWidth <= 900) $('#nav').classList.add('hidden');
  try { if (localStorage.getItem('defansLock')) { $('#lock').checked = true; document.body.classList.add('locked'); } } catch (_) { }
  try { const saved = await idb.get('st2'); if (saved?.courts) S = { courts: saved.courts, size: saved.size || 0.17, nums: saved.nums === true, cols: saved.cols || 4, pl: saved.pl || {}, refs: saved.refs || {}, codes: saved.codes || {} }; } catch (_) { }
  syncControls();
  try { const ph = await idb.get('photos'); if (ph) for (const id in ph) photos[id] = { orig: unpack(ph[id].orig), cut: unpack(ph[id].cut), show: unpack(ph[id].show) }; } catch (_) { }
  try { const r = await idb.get('deck2'); if (r?.players) { deck = loadDeckRecord(r); $('#empty').hidden = true; renderPlayers(); document.title = deck.name + ' · Defans Planı'; } } catch (_) { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__defans = { get deck() { return deck; }, get S() { return S; }, photos, openPdf, parsePdf, labelSig, sigDist, matchCode, autoPlace };
})();
