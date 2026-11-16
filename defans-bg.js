'use strict';
/* Fotoğraf arka planı temizleme (yapay zekâ değil, renk tabanlı).
   - Otomatik: görselin kenarındaki baskın zemin renklerinden başlayıp benzer renkli, bitişik alanı siler.
   - Tıkla-sil: tıklanan noktanın rengine benzer alanı siler.
   - Fırça: elle sil / geri getir.
   Her şey tarayıcıda olur; fotoğraf hiçbir yere gönderilmez. */
(function () {
  const MAXSIDE = 1200;

  async function decode(blob) {
    const bmp = await createImageBitmap(blob);
    const sc = Math.min(1, MAXSIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, w, h);
    return { w, h, cv, g };
  }
  const toBlob = (cv, type = 'image/png', q) => new Promise(r => cv.toBlob(r, type, q));

  /* Yüklenen fotoğrafı küçültüp saklanacak "orijinal" biçime getirir (en uzun kenar 1200 px). */
  async function prepare(file) {
    const { cv } = await decode(file);
    return toBlob(cv, 'image/jpeg', 0.92);
  }

  function open(origBlob, cutBlob) {
    return new Promise(async (resolve) => {
      const o = await decode(origBlob);
      const W = o.w, H = o.h;
      const orig = o.g.getImageData(0, 0, W, H).data;                 // asıl görüntü (tam opak)
      let cur;
      if (cutBlob) { const c = await decode(cutBlob); cur = c.cv.width === W && c.cv.height === H ? c.g.getImageData(0, 0, W, H) : o.g.getImageData(0, 0, W, H); }
      else cur = o.g.getImageData(0, 0, W, H);
      const px = cur.data;
      const N = W * H;

      const root = document.createElement('div'); root.className = 'bgEd';
      root.innerHTML = `
        <div class="bgBox" role="dialog" aria-label="Arka planı temizle">
          <div class="bgTop">
            <b>Arka planı temizle</b>
            <span class="bgHint" id="bgHint">Önce “Otomatik temizle”ye basın; kalan yerleri araçlarla düzeltin.</span>
          </div>
          <div class="bgBody">
            <div class="bgStage" id="bgStage"><canvas id="bgCv"></canvas></div>
            <div class="bgSide">
              <button class="chip" id="bgAuto">✨ Otomatik temizle</button>
              <div class="bgTools" id="bgTools">
                <button class="chip on" data-t="wand">Tıkla-sil</button>
                <button class="chip" data-t="erase">Fırça: sil</button>
                <button class="chip" data-t="keep">Fırça: geri getir</button>
              </div>
              <label class="bgL">Tolerans <output id="bgTolV">28</output><input type="range" id="bgTol" min="6" max="140" value="28"></label>
              <label class="bgL">Fırça boyutu <output id="bgBrV">28</output><input type="range" id="bgBr" min="4" max="140" value="28"></label>
              <label class="chk bgG"><input type="checkbox" id="bgGlobal"> Tıkla-sil: görseldeki benzer renklerin hepsini sil</label>
              <div class="bgBg" id="bgBgSel"><span>Zemin</span><button class="chip on" data-b="chk">▦</button><button class="chip" data-b="#fff">Beyaz</button><button class="chip" data-b="#1a1a1a">Siyah</button><button class="chip" data-b="#2F5BEA">Mavi</button></div>
              <div class="bgRow"><button class="chip" id="bgUndo">↶ Geri al</button><button class="chip" id="bgReset">Orijinale dön</button></div>
            </div>
          </div>
          <div class="bgFoot"><button class="chip" id="bgCancel">Vazgeç</button><button class="chip on" id="bgOk">Uygula</button></div>
        </div>`;
      document.body.appendChild(root);
      const $ = s => root.querySelector(s);
      const cv = $('#bgCv'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const stage = $('#bgStage');
      let tool = 'wand', hist = [];

      const draw = () => { g.putImageData(cur, 0, 0); };
      const snap = () => { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = px[i * 4 + 3]; hist.push(a); if (hist.length > 30) hist.shift(); };
      const restoreSnap = () => {
        const a = hist.pop(); if (!a) return;
        for (let i = 0; i < N; i++) { px[i * 4 + 3] = a[i]; if (a[i]) { px[i * 4] = orig[i * 4]; px[i * 4 + 1] = orig[i * 4 + 1]; px[i * 4 + 2] = orig[i * 4 + 2]; } }
        draw();
      };
      const hint = t => { $('#bgHint').textContent = t; };
      const tol = () => +$('#bgTol').value;
      const d2 = (i, r, gg, b) => { const dr = orig[i * 4] - r, dg = orig[i * 4 + 1] - gg, db = orig[i * 4 + 2] - b; return Math.sqrt(dr * dr + dg * dg + db * db); };

      function fit() {
        const bw = stage.clientWidth - 8, bh = stage.clientHeight - 8;
        const s = Math.min(bw / W, bh / H, 1.6);
        cv.style.width = Math.round(W * s) + 'px'; cv.style.height = Math.round(H * s) + 'px';
      }
      new ResizeObserver(fit).observe(stage); fit();
      draw();

      /* — otomatik — */
      function borderSeeds() {
        // zemin rengi: kenarın en az 3 kenarında (üst/alt/sol/sağ) görülen baskın renk; nesne genelde 1-2 kenara değer
        const bins = new Map(); const sideN = [0, 0, 0, 0];
        const R = 2;
        const add = (i, side) => {
          if (!px[i * 4 + 3]) return;
          const k = (orig[i * 4] >> 4) << 8 | (orig[i * 4 + 1] >> 4) << 4 | (orig[i * 4 + 2] >> 4);
          const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0, s: [0, 0, 0, 0] }; b.n++; b.r += orig[i * 4]; b.g += orig[i * 4 + 1]; b.b += orig[i * 4 + 2]; b.s[side]++; bins.set(k, b); sideN[side]++;
        };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (y < R) add(y * W + x, 0); else if (y >= H - R) add(y * W + x, 1);
          if (x < R) add(y * W + x, 2); else if (x >= W - R) add(y * W + x, 3);
        }
        const all = [...bins.values()].sort((a, b) => b.n - a.n);
        const multi = all.filter(b => b.s.filter((v, s) => sideN[s] && v >= sideN[s] * 0.03).length >= 3).slice(0, 4);
        const arr = (multi.length ? multi : all.slice(0, 2)).filter(b => b.n > 20);
        return arr.map(b => [b.r / b.n, b.g / b.n, b.b / b.n]);
      }
      function fill(seedsXY, seedCols, T, global, startTol = T) {
        const seen = new Uint8Array(N); const stack = [];
        const stepMax = Math.max(5, T * 0.3);
        const near = (i, cols, k) => { let m = 1e9; for (const c of cols) { const v = d2(i, c[0], c[1], c[2]); if (v < m) m = v; } return m <= k; };
        if (global) {
          let n = 0;
          for (let i = 0; i < N; i++) if (px[i * 4 + 3] && near(i, seedCols, T)) { px[i * 4 + 3] = 0; n++; }
          return n;
        }
        for (const i of seedsXY) if (!seen[i] && px[i * 4 + 3] && near(i, seedCols, startTol)) { seen[i] = 1; stack.push(i); }
        let n = 0;
        while (stack.length) {
          const i = stack.pop(); px[i * 4 + 3] = 0; n++;
          const x = i % W, y = (i / W) | 0;
          const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
          for (const j of nb) {
            if (j < 0 || seen[j] || !px[j * 4 + 3]) continue;
            // aynı zemin rengine yakın, ya da komşusuna çok yakın (yumuşak geçişli zemin)
            // kenar engeli: komşuyla renk farkı büyükse (nesnenin sınırı) geçilmez; böylece beyaz forma gibi zemine yakın renkler sızmaz
            const dc = d2(j, orig[i * 4], orig[i * 4 + 1], orig[i * 4 + 2]);
            if (dc <= stepMax && (near(j, seedCols, T) || (dc <= T * 0.12 && near(j, seedCols, T * 1.9)))) { seen[j] = 1; stack.push(j); }
          }
        }
        return n;
      }
      function edgeClean(seedCols, T) {
        // 1) zemine çok benzeyen kenar pikselleri (zemin halesi) 1 kez soyulur
        const kill = [];
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x; if (!px[i * 4 + 3]) continue;
          if (!px[(i - 1) * 4 + 3] || !px[(i + 1) * 4 + 3] || !px[(i - W) * 4 + 3] || !px[(i + W) * 4 + 3]) {
            let m = 1e9; for (const c of seedCols) m = Math.min(m, d2(i, c[0], c[1], c[2]));
            if (m <= T) kill.push(i);
          }
        }
        kill.forEach(i => { px[i * 4 + 3] = 0; });
        // 2) kenarı 1 piksel yumuşat
        const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = px[i * 4 + 3];
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x; if (!a[i]) continue;
          let s = 0, z = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = a[i + dy * W + dx]; s += v; if (!v) z = true; }
          if (z) px[i * 4 + 3] = Math.round(s / 9);
        }
      }
      $('#bgAuto').addEventListener('click', () => {
        snap();
        // temiz başlangıç: tüm görüntü (daha önce silinenler geri gelmesin diye mevcut alfa korunur)
        const seeds = borderSeeds();
        if (!seeds.length) { hint('Kenarlarda baskın bir zemin rengi bulunamadı. “Tıkla-sil” ile zemine dokunun.'); return; }
        const T = tol();
        const edge = []; for (let x = 0; x < W; x++) { edge.push(x, (H - 1) * W + x); } for (let y = 0; y < H; y++) { edge.push(y * W, y * W + W - 1); }
        const n = fill(edge, seeds, T, false, T * 0.6);
        edgeClean(seeds, T); draw();
        hint(n ? `Temizlendi (%${Math.round(n / N * 100)} alan). Kalan zemin için “Tıkla-sil”, fazla silinen yer için “Fırça: geri getir”.` : 'Zemin bulunamadı; toleransı artırın.');
      });

      /* — fare/dokunma — */
      const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
      let drag = null, last = null;
      function brushAt(p, erase) {
        const r = +$('#bgBr').value / 2 * (W / cv.getBoundingClientRect().width);   // ekran pikseli → görüntü pikseli
        const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(W - 1, Math.ceil(p.x + r)), y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(H - 1, Math.ceil(p.y + r));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
          const i = y * W + x;
          if (erase) px[i * 4 + 3] = 0;
          else { px[i * 4] = orig[i * 4]; px[i * 4 + 1] = orig[i * 4 + 1]; px[i * 4 + 2] = orig[i * 4 + 2]; px[i * 4 + 3] = 255; }
        }
      }
      function stroke(a, b, erase) {
        const rs = +$('#bgBr').value / 2 * (W / cv.getBoundingClientRect().width);
        const dist = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(dist / Math.max(1, rs / 2)));
        for (let s = 1; s <= steps; s++) brushAt({ x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps }, erase);
      }
      cv.addEventListener('pointerdown', e => {
        const p = pos(e); e.preventDefault();
        if (tool === 'wand') {
          const x = Math.round(p.x), y = Math.round(p.y); if (x < 0 || y < 0 || x >= W || y >= H) return;
          const i = y * W + x; if (!px[i * 4 + 3]) { hint('Orası zaten silinmiş.'); return; }
          // 5x5 ortalama renk
          let r = 0, gg = 0, b = 0, n = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; r += orig[j * 4]; gg += orig[j * 4 + 1]; b += orig[j * 4 + 2]; n++; }
          snap();
          const cols = [[r / n, gg / n, b / n]];
          const cnt = fill([i], cols, tol(), $('#bgGlobal').checked);
          draw(); hint(cnt ? 'Silindi. Yanlış olduysa “Geri al”.' : 'Bu noktada silinecek benzer alan yok; toleransı artırın.');
          return;
        }
        snap(); drag = { erase: tool === 'erase' }; last = p; cv.setPointerCapture(e.pointerId);
        brushAt(p, drag.erase); draw();
      });
      cv.addEventListener('pointermove', e => { if (!drag) return; const p = pos(e); stroke(last, p, drag.erase); last = p; draw(); });
      const end = e => { if (!drag) return; drag = null; try { cv.releasePointerCapture(e.pointerId); } catch (_) { } };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

      /* — araç çubuğu — */
      $('#bgTools').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tool = b.dataset.t; $('#bgTools').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); cv.style.cursor = tool === 'wand' ? 'crosshair' : 'cell'; });
      $('#bgTol').addEventListener('input', e => { $('#bgTolV').textContent = e.target.value; });
      $('#bgBr').addEventListener('input', e => { $('#bgBrV').textContent = e.target.value; });
      $('#bgBgSel').addEventListener('click', e => {
        const b = e.target.closest('[data-b]'); if (!b) return;
        $('#bgBgSel').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
        stage.style.background = b.dataset.b === 'chk' ? '' : b.dataset.b; stage.classList.toggle('chk', b.dataset.b === 'chk');
      });
      stage.classList.add('chk');
      $('#bgUndo').addEventListener('click', () => { restoreSnap(); });
      $('#bgReset').addEventListener('click', () => { snap(); for (let i = 0; i < N * 4; i++) px[i] = orig[i]; draw(); hint('Orijinale dönüldü.'); });

      const close = v => { root.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(null); else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreSnap(); } };
      document.addEventListener('keydown', onKey);
      $('#bgCancel').addEventListener('click', () => close(null));
      $('#bgOk').addEventListener('click', async () => {
        // tam çerçeveli kesik (yeniden düzenlemek için) + kırpılmış gösterim
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) { hint('Her şey silinmiş görünüyor. “Orijinale dön” ile geri alın.'); return; }
        draw();
        const cut = await toBlob(cv);
        const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
        t.getContext('2d').drawImage(cv, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
        const show = await toBlob(t);
        close({ cut, show });
      });
    });
  }

  window.BgEditor = { open, prepare };
})();
