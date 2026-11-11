'use strict';
/* Defans Planı
   .pptx dosyasını tarayıcıda açar, slaytları sunumdaki konumlarıyla çizer ve heatmap görsellerinin
   üzerine numaralı daireler koymaya izin verir. Görseller değiştirilmez; daireler ayrı bir katmandır.
   Daireler saha (turuncu alan) koordinatında, görselin içeriğinin özetine (SHA-1) bağlı saklanır. */

const $ = s => document.querySelector(s);
const kids = (n, ln) => n ? [...n.children].filter(c => c.localName === ln) : [];
const kid = (n, ln) => kids(n, ln)[0] || null;
const desc = (n, ln) => n ? [...n.getElementsByTagNameNS('*', ln)] : [];
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PT = 12700;

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

/* ——— durum ——— */
let deck = null;                         // {W,H,slides:[…],name}
let A = { courts: {}, size: 0.15, nums: true };      // {courts:{anahtar:{c:[daire],cap:''}}, size}
let hist = [], redo = [];
let sel = { key: null, id: null };
let clip = null;
const courtEls = {};                     // anahtar -> {el, cap}

const COLORS = { k: '#111111', r: '#D62839', b: '#1F5BEA', g: '#1F7A33' };
const CAPS = ['RIGHT TO RIGHT', 'RIGHT TO LEFT', 'LEFT TO LEFT', 'LEFT TO RIGHT'];
const FORMS = {
  f1: [[.30, .10, 'c'], [.70, .10, 'c'], [.13, .52, 'c'], [.40, .74, 'c'], [.62, .74, 'c'], [.88, .52, 'c']],
  f2: [[.50, .10, 'c'], [.14, .42, 'c'], [.86, .42, 'c'], [.30, .70, 'c'], [.50, .82, 'c'], [.70, .70, 'c']],
};

/* ——— yardımcılar ——— */
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function normPath(p) {
  const out = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}
const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
function parseXML(t) { return t ? new DOMParser().parseFromString(t, 'application/xml') : null; }
async function sha1(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ——— pptx okuma ——— */
async function parseDeck(buf, name) {
  const zip = await JSZip.loadAsync(buf);
  const xml = async p => { const f = zip.file(p); return f ? parseXML(await f.async('string')) : null; };
  const rels = async p => {
    const d = await xml(dirOf(p) + '_rels/' + p.slice(p.lastIndexOf('/') + 1) + '.rels');
    const m = {};
    desc(d, 'Relationship').forEach(r => {
      const t = r.getAttribute('Target');
      m[r.getAttribute('Id')] = { type: r.getAttribute('Type'), path: t.startsWith('/') ? t.slice(1) : normPath(dirOf(p) + t) };
    });
    return m;
  };
  const pres = await xml('ppt/presentation.xml');
  if (!pres) throw new Error('Bu dosya bir PowerPoint (.pptx) sunumu gibi görünmüyor.');
  const sz = desc(pres, 'sldSz')[0];
  const W = +sz.getAttribute('cx'), H = +sz.getAttribute('cy');
  const prels = await rels('ppt/presentation.xml');
  const slidePaths = desc(pres, 'sldId').map(e => prels[e.getAttributeNS(R_NS, 'id')]?.path).filter(Boolean);

  // tema renkleri
  const themeColors = {};
  const themeDoc = await xml('ppt/theme/theme1.xml');
  const cs = desc(themeDoc, 'clrScheme')[0];
  if (cs) [...cs.children].forEach(c => {
    const v = c.firstElementChild; if (!v) return;
    themeColors[c.localName] = '#' + (v.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : (v.getAttribute('lastClr') || '000000'));
  });
  const schemeMap = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
  const colorOf = node => {                      // node: solidFill içeren eleman
    const sf = kid(node, 'solidFill'); if (!sf) return null;
    const c = sf.firstElementChild; if (!c) return null;
    if (c.localName === 'srgbClr') return '#' + c.getAttribute('val');
    if (c.localName === 'schemeClr') { const v = c.getAttribute('val'); return themeColors[schemeMap[v] || v] || null; }
    if (c.localName === 'sysClr') return '#' + (c.getAttribute('lastClr') || '000000');
    return null;
  };

  const mediaCache = {};
  const media = async path => {
    if (mediaCache[path]) return mediaCache[path];
    const f = zip.file(path); if (!f) return null;
    const bytes = await f.async('uint8array');
    const ext = path.split('.').pop().toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
    const blob = new Blob([bytes], { type });
    return (mediaCache[path] = { blob, url: URL.createObjectURL(blob), hash: await sha1(bytes) });
  };

  const seenHash = {};
  const slides = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const sp = slidePaths[i];
    const doc = await xml(sp);
    const srels = await rels(sp);
    const layoutPath = Object.values(srels).find(r => /\/slideLayout$/.test(r.type))?.path;
    const layoutDoc = layoutPath ? await xml(layoutPath) : null;
    const lrels = layoutPath ? await rels(layoutPath) : {};
    const masterPath = Object.values(lrels).find(r => /\/slideMaster$/.test(r.type))?.path;
    const masterDoc = masterPath ? await xml(masterPath) : null;

    const phKey = nv => { const ph = desc(nv, 'ph')[0]; return ph ? { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') } : null; };
    const findPh = (root, ph) => {
      if (!root || !ph) return null;
      const sps = desc(root, 'sp');
      return sps.find(s => { const p = phKey(kid(s, 'nvSpPr')); return p && ((ph.idx != null && p.idx === ph.idx) || (ph.idx == null && p.type === ph.type)); })
        || sps.find(s => { const p = phKey(kid(s, 'nvSpPr')); return p && p.type === ph.type; }) || null;
    };
    const xfrmOf = spPr => {
      const x = spPr && kid(spPr, 'xfrm'); if (!x) return null;
      const off = kid(x, 'off'), ext = kid(x, 'ext'); if (!off || !ext) return null;
      return { x: +off.getAttribute('x'), y: +off.getAttribute('y'), w: +ext.getAttribute('cx'), h: +ext.getAttribute('cy'),
        rot: +(x.getAttribute('rot') || 0) / 60000, fh: x.getAttribute('flipH') === '1', fv: x.getAttribute('flipV') === '1' };
    };
    const inherit = ph => {
      const r = {};
      const take = lst => {
        const l1 = lst && kid(lst, 'lvl1pPr'); if (!l1) return;
        if (r.algn == null && l1.getAttribute('algn')) r.algn = l1.getAttribute('algn');
        const d = kid(l1, 'defRPr'); if (!d) return;
        if (r.sz == null && d.getAttribute('sz')) r.sz = +d.getAttribute('sz') / 100;
        if (r.b == null && d.getAttribute('b') != null) r.b = d.getAttribute('b') === '1';
        if (r.color == null) r.color = colorOf(d);
      };
      const lsp = findPh(layoutDoc, ph); if (lsp) take(kid(kid(lsp, 'txBody'), 'lstStyle'));
      const msp = findPh(masterDoc, ph); if (msp) take(kid(kid(msp, 'txBody'), 'lstStyle'));
      const ts = desc(masterDoc, 'txStyles')[0];
      if (ts) take(kid(ts, ph && /title/i.test(ph.type) ? 'titleStyle' : (ph ? 'bodyStyle' : 'otherStyle')));
      return r;
    };

    const items = [], warns = [];
    const walk = (parent, t) => {
      for (const n of parent.children) {
        const ln = n.localName;
        if (ln === 'grpSp') {
          const gx = kid(kid(n, 'grpSpPr'), 'xfrm');
          if (gx) {
            const off = kid(gx, 'off'), ext = kid(gx, 'ext'), co = kid(gx, 'chOff'), ce = kid(gx, 'chExt');
            const sx = t.sx * (+ext.getAttribute('cx')) / (+ce.getAttribute('cx') || 1), sy = t.sy * (+ext.getAttribute('cy')) / (+ce.getAttribute('cy') || 1);
            walk(n, { sx, sy, ox: t.ox + t.sx * +off.getAttribute('x') - sx * +co.getAttribute('x'), oy: t.oy + t.sy * +off.getAttribute('y') - sy * +co.getAttribute('y') });
          } else walk(n, t);
        } else if (ln === 'pic') items.push({ node: n, t, kind: 'pic' });
        else if (ln === 'sp') items.push({ node: n, t, kind: 'sp' });
        else if (ln === 'nvGrpSpPr' || ln === 'grpSpPr' || ln === 'extLst') continue;
        else warns.push(ln === 'graphicFrame' ? 'tablo/grafik' : ln === 'cxnSp' ? 'çizgi' : ln);
      }
    };
    walk(desc(doc, 'spTree')[0], { sx: 1, sy: 1, ox: 0, oy: 0 });

    const out = [];
    for (const it of items) {
      const n = it.node, t = it.t;
      const spPr = kid(n, 'spPr');
      let xf = xfrmOf(spPr);
      const nv = kid(n, it.kind === 'pic' ? 'nvPicPr' : 'nvSpPr');
      const ph = phKey(nv);
      if (!xf && ph) { const lsp = findPh(layoutDoc, ph) || findPh(masterDoc, ph); xf = lsp && xfrmOf(kid(lsp, 'spPr')); }
      if (!xf) { warns.push('konumu okunamayan öğe'); continue; }
      const box = { x: t.ox + t.sx * xf.x, y: t.oy + t.sy * xf.y, w: t.sx * xf.w, h: t.sy * xf.h, rot: xf.rot, fh: xf.fh, fv: xf.fv };
      const nm = kid(nv, 'cNvPr')?.getAttribute('name') || '';

      if (it.kind === 'pic') {
        const emb = desc(kid(n, 'blipFill'), 'blip')[0]?.getAttributeNS(R_NS, 'embed');
        const mp = emb && srels[emb]?.path; const m = mp && await media(mp);
        if (!m) { warns.push('görsel (' + nm + ') okunamadı'); continue; }
        const sr = desc(kid(n, 'blipFill'), 'srcRect')[0];
        const crop = { l: 0, t: 0, r: 0, b: 0 };
        if (sr) for (const k of ['l', 't', 'r', 'b']) crop[k] = (+sr.getAttribute(k) || 0) / 100000;
        const dup = seenHash[m.hash] = (seenHash[m.hash] || 0) + 1;
        out.push({ kind: 'pic', box, url: m.url, blob: m.blob, hash: m.hash, key: m.hash + '#' + dup, crop, name: nm });
        continue;
      }

      // metin kutusu / şekil
      const tb = kid(n, 'txBody');
      const paras = [];
      if (tb) {
        const inh = inherit(ph);
        const bp = kid(tb, 'bodyPr');
        const fs = desc(bp, 'normAutofit')[0]?.getAttribute('fontScale');
        const scale = fs ? +fs / 100000 : 1;
        for (const p of kids(tb, 'p')) {
          const pPr = kid(p, 'pPr');
          const runs = [];
          for (const r of p.children) {
            if (r.localName === 'br') { runs.push({ t: '\n' }); continue; }
            if (r.localName !== 'r' && r.localName !== 'fld') continue;
            const rp = kid(r, 'rPr'); const tx = kid(r, 't')?.textContent || '';
            runs.push({ t: tx,
              sz: (rp?.getAttribute('sz') ? +rp.getAttribute('sz') / 100 : (inh.sz || 18)) * scale,
              b: rp?.getAttribute('b') != null ? rp.getAttribute('b') === '1' : !!inh.b,
              i: rp?.getAttribute('i') === '1',
              u: rp?.getAttribute('u') && rp.getAttribute('u') !== 'none',
              color: (rp && colorOf(rp)) || inh.color || '#000000' });
          }
          const epr = kid(p, 'endParaRPr');
          paras.push({ algn: pPr?.getAttribute('algn') || inh.algn || 'l', runs,
            sz: (epr?.getAttribute('sz') ? +epr.getAttribute('sz') / 100 : inh.sz || 18) * scale });
        }
        const hasText = paras.some(p => p.runs.some(r => r.t.trim()));
        if (hasText) {
          const bp2 = bp || { getAttribute: () => null };
          out.push({ kind: 'text', box, paras, anchor: bp2.getAttribute('anchor') || 't',
            ins: { l: +(bp2.getAttribute('lIns') ?? 91440), r: +(bp2.getAttribute('rIns') ?? 91440), t: +(bp2.getAttribute('tIns') ?? 45720), b: +(bp2.getAttribute('bIns') ?? 45720) },
            wrapNone: bp2.getAttribute('wrap') === 'none' });
          continue;
        }
      }
      // metinsiz şekil
      const geom = kid(spPr, 'prstGeom')?.getAttribute('prst');
      const fill = spPr && colorOf(spPr);
      const ln = spPr && kid(spPr, 'ln'); const lnColor = ln && colorOf(ln);
      if (!fill && !lnColor) continue;                       // görünmez: önemsiz
      if (['rect', 'roundRect', 'ellipse', 'oval'].includes(geom)) out.push({ kind: 'shape', box, geom, fill, line: lnColor, lw: ln?.getAttribute('w') ? +ln.getAttribute('w') : 12700 });
      else warns.push('şekil (' + (geom || nm) + ')');
    }

    const firstText = out.find(o => o.kind === 'text');
    const nameTxt = firstText ? firstText.paras.map(p => p.runs.map(r => r.t).join('')).join(' ').trim() : '';
    slides.push({ idx: i, path: sp, name: nameTxt || ('Slayt ' + (i + 1)), items: out, warns: [...new Set(warns)] });
  }

  // saha (turuncu alan) tespiti
  for (const s of slides) for (const it of s.items) if (it.kind === 'pic') it.court = await detectCourt(it.blob);
  return { W, H, slides, name, buf };
}

/* Heatmap görselindeki turuncu saha alanını bulur. Bulunamazsa null (o görsele daire konmaz). */
async function detectCourt(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const sc = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const rows = new Uint32Array(h), cols = new Uint32Array(w); let tot = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(d[i] - 246) < 16 && Math.abs(d[i + 1] - 195) < 16 && Math.abs(d[i + 2] - 139) < 16 && d[i + 3] > 200) { rows[y]++; cols[x]++; tot++; }
    }
    if (tot < 0.1 * w * h) return null;
    const mr = Math.max(...rows), mc = Math.max(...cols);
    let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
    while (y0 < h && rows[y0] < 0.25 * mr) y0++; while (y1 > 0 && rows[y1] < 0.25 * mr) y1--;
    while (x0 < w && cols[x0] < 0.25 * mc) x0++; while (x1 > 0 && cols[x1] < 0.25 * mc) x1--;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1; if (cw < 20 || ch < 20) return null;
    const ar = cw / ch; if (ar < 0.75 || ar > 1.3) return null;
    return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  } catch (e) { return null; }
}

/* ——— çizim ——— */
const pct = (v, T) => (v / T * 100) + '%';
const cq = v => `calc(${v / deck.W * 100}cqw)`;
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderDeck() {
  const host = $('#slides'); host.innerHTML = '';
  for (const k in courtEls) delete courtEls[k];
  const css = document.createElement('style'); css.id = 'pageCss';
  css.textContent = `@page{size:${(deck.W / 914400).toFixed(4)}in ${(deck.H / 914400).toFixed(4)}in;margin:0}:root{--pw:${(deck.W / 914400).toFixed(4)}in;--ph:${(deck.H / 914400).toFixed(4)}in}`;
  document.getElementById('pageCss')?.remove(); document.head.appendChild(css);

  deck.slides.forEach(s => {
    const sec = document.createElement('section'); sec.className = 'sl'; sec.id = 'sl' + s.idx;
    const head = document.createElement('div'); head.className = 'sl-head';
    head.innerHTML = `<b>${s.idx + 1}. ${esc(s.name)}</b>` + (s.warns.length ? `<span class="warn" title="Bu öğeler burada çizilemedi; orijinal sunumla karşılaştırın">⚠ çizilemeyen: ${esc(s.warns.join(', '))}</span>` : '');
    sec.appendChild(head);
    const sl = document.createElement('div'); sl.className = 'slide'; sl.style.setProperty('--ar', deck.W + ' / ' + deck.H);
    sec.appendChild(sl);

    for (const it of s.items) {
      const b = it.box;
      const el = document.createElement('div');
      el.style.cssText = `left:${pct(b.x, deck.W)};top:${pct(b.y, deck.H)};width:${pct(b.w, deck.W)};height:${pct(b.h, deck.H)};`;
      const tf = []; if (b.rot) tf.push(`rotate(${b.rot}deg)`); if (b.fh) tf.push('scaleX(-1)'); if (b.fv) tf.push('scaleY(-1)');
      if (tf.length) el.style.transform = tf.join(' ');
      if (it.kind === 'text') {
        el.className = 'tx';
        el.style.justifyContent = it.anchor === 'ctr' ? 'center' : it.anchor === 'b' ? 'flex-end' : 'flex-start';
        el.style.padding = `${cq(it.ins.t)} ${cq(it.ins.r)} ${cq(it.ins.b)} ${cq(it.ins.l)}`;
        for (const p of it.paras) {
          const pe = document.createElement('p');
          pe.style.textAlign = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[p.algn] || 'left';
          if (!p.runs.length) { pe.style.fontSize = cq(p.sz * PT); pe.innerHTML = '&nbsp;'; }
          for (const r of p.runs) {
            if (r.t === '\n') { pe.appendChild(document.createElement('br')); continue; }
            const sp = document.createElement('span'); sp.textContent = r.t;
            sp.style.cssText = `font-size:${cq(r.sz * PT)};color:${r.color};font-weight:${r.b ? 700 : 400};${r.i ? 'font-style:italic;' : ''}${r.u ? 'text-decoration:underline;' : ''}`;
            pe.appendChild(sp);
          }
          el.appendChild(pe);
        }
        if (it.wrapNone) el.style.whiteSpace = 'nowrap';
      } else if (it.kind === 'shape') {
        el.className = 'shape';
        if (it.fill) el.style.background = it.fill;
        if (it.line) el.style.border = `${cq(it.lw)} solid ${it.line}`;
        if (it.geom === 'ellipse' || it.geom === 'oval') el.style.borderRadius = '50%';
        if (it.geom === 'roundRect') el.style.borderRadius = '8%';
      } else {
        el.className = 'pic';
        const cr = it.crop, vw = 1 - cr.l - cr.r, vh = 1 - cr.t - cr.b;
        const clip = document.createElement('div'); clip.className = 'clip';
        const img = document.createElement('img'); img.src = it.url; img.alt = '';
        img.style.cssText = `left:${-cr.l / vw * 100}%;top:${-cr.t / vh * 100}%;width:${100 / vw}%;height:${100 / vh}%;`;
        clip.appendChild(img); el.appendChild(clip);
        if (it.court) {
          if (b.rot || b.fh || b.fv) { s.warns.push('döndürülmüş/çevrilmiş heatmap'); }
          else addCourt(el, it, vw, vh);
        }
      }
      sl.appendChild(el);
    }
    host.appendChild(sec);
  });
  buildNav(); refreshAll();
}

function addCourt(picEl, it, vw, vh) {
  const c = it.court, cr = it.crop;
  // saha dikdörtgeni, görünen kutu içinde (0..1)
  const bx0 = (c.x0 - cr.l) / vw, bx1 = (c.x1 - cr.l) / vw, by0 = (c.y0 - cr.t) / vh, by1 = (c.y1 - cr.t) / vh;
  const el = document.createElement('div'); el.className = 'court'; el.dataset.key = it.key;
  el.style.cssText = `left:${bx0 * 100}%;top:${by0 * 100}%;width:${(bx1 - bx0) * 100}%;height:${(by1 - by0) * 100}%;`;
  // saha genişliği (slayt genişliğinin yüzdesi)
  const cwCq = it.box.w * (bx1 - bx0) / deck.W * 100;
  el.style.setProperty('--cw', cwCq + 'cqw');
  picEl.appendChild(el);
  // alt şerit notu: sahanın altındaki mavi bant
  const cap = document.createElement('div'); cap.className = 'cap';
  const bandTop = by1, bandH = 1 - by1;
  if (bandH * it.box.h > 130000) { cap.style.cssText = `top:${bandTop * 100}%;height:${bandH * 100}%;font-size:calc(${Math.min(bandH * it.box.h * 0.5, 150000) / deck.W * 100}cqw);`; }
  else { cap.classList.add('below'); cap.style.cssText = `top:100%;height:${cq(190000)};font-size:${cq(150000)};`; }
  picEl.appendChild(cap);
  it.rect = { x: it.box.x + bx0 * it.box.w, y: it.box.y + by0 * it.box.h, w: (bx1 - bx0) * it.box.w, h: (by1 - by0) * it.box.h, bandTop: by1, bandH: bandH, bx: it.box.x, by: it.box.y, bw: it.box.w, bh: it.box.h };
  courtEls[it.key] = { el, cap, slide: it.name };
}

function dotEl(c, key) {
  const d = document.createElement('div');
  d.className = 'dot' + (c.sh === 'o' ? ' oval' : '') + (sel.key && sel.id === c.id && sel.key === key ? ' sel' : '');
  d.dataset.id = c.id;
  const base = `calc(var(--cw) * ${A.size})`;
  const col = COLORS[c.col] || COLORS.k;
  d.style.cssText = `left:${c.x * 100}%;top:${c.y * 100}%;color:${col};border-color:${col};border-width:max(2px, calc(var(--cw) * 0.022));` +
    (c.sh === 'o' ? `width:calc(${base} * 2);height:${base};` : `width:${base};height:${base};`) +
    `font-size:calc(${base} * ${String(c.n).length > 1 ? 0.46 : 0.58});` +
    (c.rot ? `transform:translate(-50%,-50%) rotate(${c.rot}deg);` : '');
  if (A.nums !== false && String(c.n) !== '') {
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
  const data = A.courts[key];
  (data?.c || []).forEach(c => ce.el.appendChild(dotEl(c, key)));
  ce.cap.textContent = data?.cap || '';
  ce.el.classList.toggle('sel-c', sel.key === key);
}
function refreshAll() {
  for (const k in courtEls) refreshCourt(k);
  deck?.slides.forEach(s => {
    const n = s.items.filter(i => i.kind === 'pic' && i.court).reduce((a, i) => a + (A.courts[i.key]?.c?.length || 0) + (A.courts[i.key]?.cap ? 1 : 0), 0);
    s.marked = n; const sec = document.getElementById('sl' + s.idx); if (sec) sec.classList.toggle('blank', !n);
    const badge = document.querySelector(`#nav a[data-i="${s.idx}"] .ct`); if (badge) { badge.textContent = n ? '●' : ''; badge.style.display = n ? '' : 'none'; }
  });
  $('#btnUndo').disabled = !hist.length; $('#btnRedo').disabled = !redo.length;
  updateTray();
}

function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '<h2>Slaytlar</h2>';
  deck.slides.forEach(s => {
    const a = document.createElement('a'); a.href = '#sl' + s.idx; a.dataset.i = s.idx;
    a.innerHTML = `<span class="no">${s.idx + 1}</span><span class="nm">${esc(s.name)}</span><span class="ct" style="display:none"></span>`;
    a.addEventListener('click', e => { e.preventDefault(); document.getElementById('sl' + s.idx).scrollIntoView({ behavior: 'smooth' }); if (innerWidth <= 900) nav.classList.add('hidden'); });
    nav.appendChild(a);
  });
  const live = new Set(deck.slides.flatMap(s => s.items.filter(i => i.kind === 'pic').map(i => i.key)));
  const orph = Object.keys(A.courts).filter(k => !live.has(k) && A.courts[k].c?.length).length;
  if (orph) { const d = document.createElement('div'); d.className = 'orph'; d.textContent = `${orph} saha kaydı bu sunumdaki hiçbir görselle eşleşmedi (görsel değişmiş ya da silinmiş olabilir). Kayıtlar silinmedi.`; nav.appendChild(d); }
}

/* ——— düzenleme ——— */
function mutate(fn) {
  hist.push(JSON.stringify(A.courts)); if (hist.length > 300) hist.shift(); redo = [];
  fn(); persist(); refreshAll();
}
function undo() { if (!hist.length) return; redo.push(JSON.stringify(A.courts)); A.courts = JSON.parse(hist.pop()); fixSel(); persist(); refreshAll(); }
function redoIt() { if (!redo.length) return; hist.push(JSON.stringify(A.courts)); A.courts = JSON.parse(redo.pop()); fixSel(); persist(); refreshAll(); }
function fixSel() { if (sel.id != null && !(A.courts[sel.key]?.c || []).some(c => c.id === sel.id)) sel.id = null; }
let saveT = null;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => idb.set('ann', A).catch(() => toast('Kaydedilemedi: tarayıcı depolaması dolu olabilir.')), 150); }
const court = key => (A.courts[key] ||= { c: [], cap: '' });
const nextNo = key => { const used = new Set((A.courts[key]?.c || []).map(c => String(c.n))); for (let i = 1; i <= 6; i++) if (!used.has(String(i))) return i; return (A.courts[key]?.c || []).length + 1; };
const nextId = key => Math.max(0, ...(A.courts[key]?.c || []).map(c => c.id)) + 1;
const curDot = () => (A.courts[sel.key]?.c || []).find(c => c.id === sel.id) || null;

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
  if (!ct) { if (sel.key) clearSel(); return; }
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
  if (d.rotate) { if (d.ang != null) mutate(() => { const c = (A.courts[d.key].c).find(c => c.id === d.id); if (c) c.rot = d.ang; }); return; }
  if (d.tap && !d.moved) {
    const p = pointIn(d.ct, e); if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    mutate(() => { const cd = court(d.key); const id = nextId(d.key); cd.c.push({ id, n: nextNo(d.key), x: +p.x.toFixed(4), y: +p.y.toFixed(4), col: 'k', sh: 'c' }); sel.key = d.key; sel.id = id; });
  } else if (d.id != null && d.moved && d.pos) {
    mutate(() => { const c = (A.courts[d.key].c).find(c => c.id === d.id); if (c) { c.x = +d.pos.x.toFixed(4); c.y = +d.pos.y.toFixed(4); } });
  }
};
$('#stage').addEventListener('pointerup', endDrag);
$('#stage').addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoIt() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoIt(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && curDot()) { e.preventDefault(); delDot(); }
});

function delDot() { const c = curDot(); if (!c) return; mutate(() => { const cd = A.courts[sel.key]; cd.c = cd.c.filter(x => x.id !== c.id); sel.id = null; }); }

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
  const cd = A.courts[sel.key];
  $('#trCap').value !== (cd?.cap || '') && document.activeElement !== $('#trCap') && ($('#trCap').value = cd?.cap || '');
  $('#trCaps').querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.cap !== '' && (cd?.cap || '') === b.dataset.cap));
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
  const cd0 = A.courts[sel.key]?.c || [];
  if (cd0.length && !confirm('Bu sahadaki mevcut daireler formasyonla değiştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  mutate(() => { court(sel.key).c = f.map((p, i) => ({ id: i + 1, n: i + 1, x: p[0], y: p[1], col: 'k', sh: p[2] })); sel.id = null; });
});
$('#trCopy').addEventListener('click', () => { const cd = A.courts[sel.key]; if (!cd?.c?.length) { toast('Kopyalanacak daire yok.'); return; } clip = JSON.parse(JSON.stringify(cd.c)); updateTray(); toast(cd.c.length + ' daire kopyalandı. Başka sahaya dokunup “Yapıştır”a basın.'); });
$('#trPaste').addEventListener('click', () => {
  if (!clip || !sel.key) return;
  if ((A.courts[sel.key]?.c || []).length && !confirm('Bu sahadaki mevcut daireler yapıştırılanlarla değiştirilsin mi? (Geri al ile dönebilirsiniz.)')) return;
  mutate(() => { court(sel.key).c = JSON.parse(JSON.stringify(clip)); sel.id = null; });
});
$('#trClear').addEventListener('click', () => { if (!A.courts[sel.key]?.c?.length) return; mutate(() => { A.courts[sel.key].c = []; sel.id = null; }); });
$('#trCaps').addEventListener('click', e => { const b = e.target.closest('[data-cap]'); if (!b || !sel.key) return; mutate(() => { court(sel.key).cap = b.dataset.cap; }); $('#trCap').value = b.dataset.cap; });
$('#trCap').addEventListener('input', e => { if (!sel.key) return; const key = sel.key; const v = e.target.value.toUpperCase(); clearTimeout($('#trCap')._t); $('#trCap')._t = setTimeout(() => { if ((A.courts[key]?.cap || '') !== v) mutate(() => { court(key).cap = v; }); }, 400); });

/* ——— üst çubuk ——— */
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redoIt);
$('#btnNav').addEventListener('click', () => $('#nav').classList.toggle('hidden'));
$('#lock').addEventListener('change', e => { document.body.classList.toggle('locked', e.target.checked); try { localStorage.setItem('defansLock', e.target.checked ? '1' : ''); } catch (_) { } });
$('#showNums').addEventListener('change', e => { A.nums = e.target.checked; persist(); refreshAll(); });
$('#size').addEventListener('change', e => { A.size = +e.target.value; persist(); refreshAll(); });
$('#onlyMarked').addEventListener('change', e => { document.body.classList.toggle('only-marked', e.target.checked); try { localStorage.setItem('defansOnly', e.target.checked ? '1' : '0'); } catch (_) { } });
$('#btnPrint').addEventListener('click', () => {
  if (!deck) { toast('Önce bir .pptx açın.'); return; }
  if ($('#onlyMarked').checked && !deck.slides.some(s => s.marked)) { toast('Hiç daire ya da not yok. “PDF: yalnız işaretliler” seçeneğini kapatarak tüm slaytları alabilirsiniz.'); return; }
  clearSel(); setTimeout(() => window.print(), 50);
});
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'vsm-defans', v: 1, size: A.size, nums: A.nums !== false, courts: A.courts })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'defans-plani-yedek.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#importIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'vsm-defans' || !j.courts) throw new Error();
    mutate(() => { Object.assign(A.courts, j.courts); if (j.size) A.size = j.size; if (typeof j.nums === 'boolean') A.nums = j.nums; });
    $('#showNums').checked = A.nums !== false;
    $('#size').value = String(A.size); if (deck) buildNav(); toast('Yedek yüklendi.');
  } catch (_) { toast('Bu dosya bir Defans Planı yedeği değil.'); }
});

/* ——— dosya açma ——— */
async function openDeck(buf, name, save = true) {
  try {
    deck = await parseDeck(buf, name);
  } catch (err) { console.error(err); toast('Sunum açılamadı: ' + (err.message || err)); return false; }
  $('#empty').hidden = true;
  renderDeck();
  const nc = deck.slides.reduce((a, s) => a + s.items.filter(i => i.kind === 'pic' && i.court).length, 0);
  if (save) { idb.set('deck', { name, buf, at: Date.now() }).catch(() => { }); toast(`${deck.slides.length} slayt, ${nc} heatmap sahası bulundu.`); }
  document.title = name + ' · Defans Planı';
  return true;
}
$('#pptIn').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await openDeck(await f.arrayBuffer(), f.name); });
const drop = $('#drop');
['dragover', 'dragenter'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', async e => { const f = [...(e.dataTransfer?.files || [])].find(f => /\.pptx$/i.test(f.name)); if (f) await openDeck(await f.arrayBuffer(), f.name); });

/* ——— PowerPoint çıktısı: özgün sunumun kopyasına, düzenlenebilir şekiller olarak eklenir ——— */
const xesc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex6 = c => (c || '#111111').replace('#', '').toUpperCase();
function spXml(id, name, o) {
  const rot = o.rot ? ` rot="${Math.round(((o.rot % 360) + 360) % 360 * 60000)}"` : '';
  const geom = `<a:prstGeom prst="${o.geom || 'rect'}"><a:avLst/></a:prstGeom>`;
  const ln = o.line ? `<a:ln w="${Math.round(o.lw)}"><a:solidFill><a:srgbClr val="${hex6(o.line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  const run = o.text ? `<a:r><a:rPr lang="tr-TR" sz="${Math.round(o.sz / 12700 * 100)}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${hex6(o.color)}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xesc(o.text)}</a:t></a:r>` : '';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xesc(name)}"/><p:cNvSpPr${o.txBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm${rot}><a:off x="${Math.round(o.x)}" y="${Math.round(o.y)}"/><a:ext cx="${Math.round(o.w)}" cy="${Math.round(o.h)}"/></a:xfrm>${geom}<a:noFill/>${ln}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"${o.rot ? ' upright="1"' : ''}><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run}<a:endParaRPr lang="tr-TR" dirty="0"/></a:p></p:txBody></p:sp>`;
}
async function exportPptx() {
  if (!deck?.buf) { toast('Önce bir .pptx açın.'); return; }
  const btn = $('#btnPptx'); btn.disabled = true;
  try {
    const zip = await JSZip.loadAsync(deck.buf);
    let nDots = 0, nCaps = 0;
    for (const s of deck.slides) {
      const marked = s.items.filter(i => i.kind === 'pic' && i.rect && (A.courts[i.key]?.c?.length || A.courts[i.key]?.cap));
      if (!marked.length) continue;
      const f = zip.file(s.path); if (!f) continue;
      let xml = await f.async('string');
      let id = Math.max(1, ...[...xml.matchAll(/<p:cNvPr[^>]*\sid="(\d+)"/g)].map(m => +m[1])) + 1;
      let add = '';
      for (const it of marked) {
        const r = it.rect, data = A.courts[it.key];
        const d = A.size * r.w;
        (data.c || []).forEach((c, i) => {
          const oval = c.sh === 'o'; const w = oval ? d * 2 : d, h = d;
          const cx = r.x + c.x * r.w, cy = r.y + c.y * r.h;
          add += spXml(id++, 'Defans daire ' + (c.n || i + 1), { x: cx - w / 2, y: cy - h / 2, w, h, rot: oval ? c.rot : 0, geom: 'ellipse', line: COLORS[c.col] || COLORS.k,
            lw: Math.max(r.w * 0.022, 19050), text: (A.nums !== false && String(c.n) !== '') ? String(c.n) : '', sz: d * (String(c.n).length > 1 ? 0.46 : 0.58), color: COLORS[c.col] || COLORS.k });
          nDots++;
        });
        if (data.cap) {
          const bandPx = r.bandH * r.bh;
          const tall = bandPx > 130000;
          const sz = tall ? Math.min(bandPx * 0.5, 150000) : 150000;
          add += spXml(id++, 'Defans notu', { txBox: true, x: r.bx, y: tall ? r.by + r.bandTop * r.bh : r.by + r.bh, w: r.bw, h: tall ? bandPx : 190000,
            text: data.cap.toUpperCase(), sz, color: tall ? '#FFFFFF' : '#14213D' });
          nCaps++;
        }
      }
      xml = xml.replace(/<\/p:spTree>/, add + '</p:spTree>');
      zip.file(s.path, xml);
    }
    if (!nDots && !nCaps) { toast('Eklenecek daire ya da not yok.'); return; }
    const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(out);
    a.download = (deck.name || 'sunum').replace(/\.pptx$/i, '') + '-defans.pptx'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`PowerPoint hazır: ${nDots} daire${nCaps ? ', ' + nCaps + ' not' : ''} eklendi. Özgün sunum değişmedi.`, 5000);
  } catch (err) { console.error(err); toast('PowerPoint oluşturulamadı: ' + (err.message || err)); }
  finally { btn.disabled = false; }
}
$('#btnPptx').addEventListener('click', exportPptx);

/* ——— açılış ——— */
(async function init() {
  buildTray();
  if (innerWidth <= 900) $('#nav').classList.add('hidden');
  try { document.body.classList.toggle('only-marked', localStorage.getItem('defansOnly') !== '0'); $('#onlyMarked').checked = localStorage.getItem('defansOnly') !== '0'; if (localStorage.getItem('defansLock')) { $('#lock').checked = true; document.body.classList.add('locked'); } } catch (_) { document.body.classList.add('only-marked'); }
  try { const saved = await idb.get('ann'); if (saved?.courts) A = { courts: saved.courts, size: saved.size || 0.15, nums: saved.nums !== false }; } catch (_) { }
  $('#size').value = String(A.size); $('#showNums').checked = A.nums !== false;
  try { const d = await idb.get('deck'); if (d?.buf) await openDeck(d.buf, d.name, false); } catch (_) { }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__defans = { get deck() { return deck; }, get A() { return A; }, openDeck };
})();
