'use strict';
/* PowerPoint çıktısı: sıfırdan, oyuncu başına bir (gerekirse daha fazla) slayt.
   Fotoğraf, ad, heatmap kartları görsel olarak; daireler ve notlar düzenlenebilir şekil/metin olarak eklenir. */
(function () {
  const SW = 12192000, SH = 6858000, MM = 36000;
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const X = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex6 = c => (c || '#111111').replace('#', '').toUpperCase();
  const R = Math.round;
  const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

  function sp(id, name, o) {
    const rot = o.rot ? ` rot="${R(((o.rot % 360) + 360) % 360 * 60000)}"` : '';
    const ln = o.line ? `<a:ln w="${R(o.lw)}"><a:solidFill><a:srgbClr val="${hex6(o.line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
    const run = o.text ? `<a:r><a:rPr lang="tr-TR" sz="${R(o.sz / 12700 * 100)}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${hex6(o.color)}"/></a:solidFill><a:latin typeface="${o.font || 'Arial'}"/><a:cs typeface="${o.font || 'Arial'}"/></a:rPr><a:t>${X(o.text)}</a:t></a:r>` : '';
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${X(name)}"/><p:cNvSpPr${o.txBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm${rot}><a:off x="${R(o.x)}" y="${R(o.y)}"/><a:ext cx="${R(o.w)}" cy="${R(o.h)}"/></a:xfrm><a:prstGeom prst="${o.geom || 'rect'}"><a:avLst/></a:prstGeom><a:noFill/>${ln}</p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"${o.rot ? ' upright="1"' : ''}><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run}<a:endParaRPr lang="tr-TR" dirty="0"/></a:p></p:txBody></p:sp>`;
  }
  const pic = (id, name, rid, x, y, w, h) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${X(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${R(x)}" y="${R(y)}"/><a:ext cx="${R(w)}" cy="${R(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

  const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Defans"><a:themeElements><a:clrScheme name="Defans"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="14213D"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2><a:accent1><a:srgbClr val="2F5BEA"/></a:accent1><a:accent2><a:srgbClr val="D62839"/></a:accent2><a:accent3><a:srgbClr val="1F7A33"/></a:accent3><a:accent4><a:srgbClr val="F6C38B"/></a:accent4><a:accent5><a:srgbClr val="6B7280"/></a:accent5><a:accent6><a:srgbClr val="111111"/></a:accent6><a:hlink><a:srgbClr val="2F5BEA"/></a:hlink><a:folHlink><a:srgbClr val="6B7280"/></a:folHlink></a:clrScheme><a:fontScheme name="Defans"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Defans"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const MASTER = `${HDR}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const LAYOUT = `${HDR}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Boş"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = list => `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, t, tg]) => `<Relationship Id="${id}" Type="${REL}/${t}" Target="${tg}"/>`).join('')}</Relationships>`;

  /* kartları slayta yerleştirir; dönen liste: [{kind:'pic'|'text', …}] */
  function planSlides(pl, o) {
    const MX = 300000, GAP = 130000, cols = Math.max(1, o.cols || 4);
    const perSlide = cols * 2;
    const slides = [];
    const cards = pl.cards;
    for (let s = 0, k = 0; s === 0 || k < cards.length; s++) {
      const chunk = cards.slice(k, k + perSlide); k += perSlide;
      const first = s === 0;
      const items = [];
      let y = 160000;
      const ph = first && pl.photo ? Math.min(Math.max(pl.mm * MM, 500000), 1700000) : 0;
      if (ph) { const pw = ph * pl.photo.w / pl.photo.h; items.push({ k: 'photo', x: (SW - pw) / 2, y, w: pw, h: ph }); y += ph + 40000; }
      const nameH = 520000;
      items.push({ k: 'name', x: MX, y, w: SW - 2 * MX, h: nameH, text: pl.name + (first ? '' : ' (devam)') });
      y += nameH + 100000;
      const avail = SH - y - 160000;
      const rows = Math.max(1, Math.ceil(chunk.length / cols));
      const cw0 = (SW - 2 * MX - (cols - 1) * GAP) / cols;
      const ar = Math.max(...chunk.map(c => c.h / c.w), 0.5);
      const capExtra = 0;
      let cw = cw0; const need = rows * (cw * ar) + (rows - 1) * GAP;
      if (need > avail) cw = cw0 * (avail - (rows - 1) * GAP) / (rows * cw0 * ar);
      const cellH = cw * ar;
      chunk.forEach((c, i) => {
        const r = Math.floor(i / cols), col = i % cols;
        const inRow = Math.min(cols, chunk.length - r * cols);
        const rowW = inRow * cw + (inRow - 1) * GAP;
        const x = (SW - rowW) / 2 + col * (cw + GAP), yy = y + r * (cellH + GAP);
        items.push({ k: 'card', c, x, y: yy, w: cw, h: cw * c.h / c.w });
      });
      slides.push(items);
    }
    return slides;
  }

  async function build(o) {
    const zip = new JSZip();
    const media = []; let slideN = 0;
    const slideXml = [], slideRels = [];
    const addMedia = blob => { const n = 'image' + (media.length + 1) + (blob.type === 'image/jpeg' ? '.jpg' : '.png'); media.push({ n, blob }); return n; };
    const dotCol = { k: '#111111', r: '#D62839', b: '#1F5BEA', g: '#1F7A33' };
    let nDots = 0, nCaps = 0;
    for (const pl of o.players) {
      const photoName = pl.photo ? addMedia(pl.photo.blob) : null;
      const cardNames = new Map(); pl.cards.forEach(c => cardNames.set(c, addMedia(c.blob)));
      for (const items of planSlides(pl, o)) {
        slideN++;
        let id = 2, body = ''; const rl = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]; let rn = 2;
        const use = file => { const r = 'rId' + rn++; rl.push([r, 'image', '../media/' + file]); return r; };
        for (const it of items) {
          if (it.k === 'photo') body += pic(id++, 'Fotoğraf', use(photoName), it.x, it.y, it.w, it.h);
          else if (it.k === 'name') body += sp(id++, 'Oyuncu adı', { txBox: true, x: it.x, y: it.y, w: it.w, h: it.h, text: it.text, sz: 30 * 12700, color: '#14213D', font: 'Arial' });
          else {
            const c = it.c;
            body += pic(id++, 'Heatmap', use(cardNames.get(c)), it.x, it.y, it.w, it.h);
            const cx0 = it.x + c.court.x0 * it.w, cy0 = it.y + c.court.y0 * it.h, cw = (c.court.x1 - c.court.x0) * it.w, ch = (c.court.y1 - c.court.y0) * it.h;
            const d = o.size * cw;
            (c.dots || []).forEach((dt, i) => {
              const oval = dt.sh === 'o'; const w = oval ? d * 2 : d, h = d;
              const cx = cx0 + dt.x * cw, cy = cy0 + dt.y * ch;
              body += sp(id++, 'Defans daire ' + (dt.n || i + 1), { x: cx - w / 2, y: cy - h / 2, w, h, rot: oval ? dt.rot : 0, geom: 'ellipse', line: dotCol[dt.col] || dotCol.k,
                lw: Math.max(cw * 0.022, 19050), text: (o.nums !== false && String(dt.n) !== '') ? String(dt.n) : '', sz: d * (String(dt.n).length > 1 ? 0.46 : 0.58), color: dotCol[dt.col] || dotCol.k });
              nDots++;
            });
            if (c.cap) {
              const band = (1 - c.court.y1) * it.h, tall = band > 0.05 * it.w;
              body += sp(id++, 'Defans notu', { txBox: true, x: it.x, y: tall ? it.y + c.court.y1 * it.h : it.y + it.h, w: it.w, h: tall ? band : it.w * 0.07,
                text: c.cap.toUpperCase(), sz: tall ? Math.min(band * 0.55, it.w * 0.09) : it.w * 0.055, color: tall ? '#FFFFFF' : '#14213D' });
              nCaps++;
            }
          }
        }
        slideXml.push(`${HDR}<p:sld ${NS}><p:cSld><p:spTree>${GRP}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
        slideRels.push(rels(rl));
      }
    }
    if (!slideN) throw new Error('Slayt oluşturulacak oyuncu yok.');

    const ct = `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      Array.from({ length: slideN }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>';
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]));
    const sldIds = Array.from({ length: slideN }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
    zip.file('ppt/presentation.xml', `${HDR}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...Array.from({ length: slideN }, (_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`]), [`rId${slideN + 2}`, 'theme', 'theme/theme1.xml']]));
    zip.file('ppt/slideMasters/slideMaster1.xml', MASTER);
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
    zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
    zip.file('ppt/theme/theme1.xml', THEME);
    slideXml.forEach((x, i) => { zip.file(`ppt/slides/slide${i + 1}.xml`, x); zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels[i]); });
    for (const m of media) zip.file('ppt/media/' + m.n, m.blob);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    return { blob, slides: slideN, dots: nDots, caps: nCaps };
  }

  window.PptxOut = { build };
})();
