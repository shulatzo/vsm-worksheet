// VolleyStation (.vsm) okuyucu ve özet motoru.
// .vsm dosyaları düz JSON'dur. Burada sadece okuma ve sayma yapılır, tarayıcıdan dışarı hiçbir şey gönderilmez.

const FRONT = [2, 3, 4];

// Set skoru: önce setin kendi skoru, yoksa son skor olayı.
function setScore(set) {
  let sc = set.score;
  if (!sc || sc.home == null) {
    const last = (set.events || []).filter(e => e.score).pop();
    sc = last && last.score;
  }
  return sc && sc.home != null && sc.away != null ? { home: Number(sc.home), away: Number(sc.away) } : null;
}

// Vuruşun iniş bölgesi işaretlenmemişse, hemen ardından rakibin savunma (D) kaydındaki bölge kullanılır.
// Savunmacının kaydı kendi saha numarasıyla tutulur, bu yüzden iniş bölgesiyle aynı sistemdedir.
function digZone(p, next) {
  if (p.skill !== 'A' || p.endZone || !next || next.team === p.team || next.skill !== 'D') return null;
  return next.startZone ? null : (next.endZone || null);
}

// Vuruşun başlangıç bölgesi işaretlenmemişse, hücum kodunun tanımındaki başlangıç bölgesi kullanılır
// (VolleyStation'da kod eklenirken seçilen "start" bölgesi, örneğin CF için 2B).
function comboStart(combos, p) {
  const c = p.skill === 'A' && p.combination && combos[p.combination];
  return c && c.start ? c.start.zone : null;
}

export function parseVsm(text, fileName) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Dosya okunamadı (JSON değil).'); }
  if (!d || !d.team || !d.team.home || !d.team.away || !d.scout || !Array.isArray(d.scout.sets)) {
    throw new Error('VolleyStation maç dosyası gibi görünmüyor.');
  }

  const combos = {};
  (d.attackCombinations || []).forEach(c => { combos[c.code] = { code: c.code, name: c.name, hit: c.hitType, target: c.targetAttacker, start: c.start && c.start.zone ? { zone: +c.start.zone, sub: c.start.subZone || null } : null }; });

  const teamInfo = side => {
    const t = d.team[side];
    const roster = {};
    (t.players || []).forEach(p => {
      const no = parseInt(p.shirtNumber, 10);
      roster[no] = { no, last: (p.lastName || '').trim(), first: (p.firstName || '').trim() };
    });
    return { side, code: t.shortCode || t.code || side, name: t.name || t.shortCode || side, roster, libero: (t.libero || []).map(Number) };
  };
  const teams = { home: teamInfo('home'), away: teamInfo('away') };

  const plays = [];
  const lineups = [];

  d.scout.sets.forEach((set, si) => {
    ['home', 'away'].forEach(side => {
      const l = set.startingLineup && set.startingLineup[side];
      if (l && l.positions) lineups.push({ set: si + 1, side, positions: l.positions, setterAt: l.setterAt, score: setScore(set) });
    });

    (set.events || []).forEach(ev => {
      const ps = ev.exchange && ev.exchange.plays;
      if (!ps) return;
      const phaseBy = { home: null, away: null };

      ps.forEach((p, pi) => {
        const side = p.team === '*' ? 'home' : 'away';
        const lu = ev.lineup && ev.lineup[side];
        const prev = ps[pi - 1];
        const next = ps[pi + 1];
        const prevSame = prev && prev.team === p.team ? prev.skill : null;
        const fromPrev = prevSame === 'R' ? 'sideout' : (prevSame === 'D' || prevSame === 'B') ? 'transition' : prevSame === 'F' ? 'free' : null;

        let phase = null;
        if (p.skill === 'E') { phase = fromPrev; phaseBy[side] = phase; }
        else if (p.skill === 'A') { phase = phaseBy[side] || fromPrev; }

        plays.push({
          set: si + 1, side, team: teams[side].code,
          no: parseInt(p.player, 10),
          skill: p.skill, effect: p.effect || null, hit: p.hitType || null,
          comb: p.combination || null, sz: p.startZone || comboStart(combos, p) || null, ez: p.endZone || digZone(p, next) || null,
          target: p.targetAttacker || null,
          blockers: typeof p.players === 'number' ? p.players : null,
          st: p.skillType || null, phase,
          setterAt: lu ? lu.setterAt : null,
          setterNo: lu && lu.positions && lu.setterAt ? parseInt(lu.positions[lu.setterAt], 10) : null,
        });
      });
    });
  });

  const date = (d.startDate || d.createdAt || '').slice(0, 10);
  const id = fileName + ':' + text.length;
  const label = `${teams.home.code} – ${teams.away.code}${date ? ' · ' + date : ''}`;
  return { id, file: fileName, date, label, teams, combos, plays, lineups, video: d.scout.video && d.scout.video.path || null };
}

// Tek bir vuruş listesinden sayılar çıkarır.
export function summarize(list) {
  const s = { n: list.length, k: 0, e: 0, b: 0, sz: {}, lz: {}, lN: 0, blk: {}, blkN: 0, tip: 0, phase: { sideout: 0, transition: 0, free: 0 } };
  for (const p of list) {
    if (p.effect === '#') s.k++;
    else if (p.effect === '=') s.e++;
    else if (p.effect === '/') s.b++;
    if (p.sz) s.sz[p.sz] = (s.sz[p.sz] || 0) + 1;
    if (p.ez) { s.lz[p.ez] = (s.lz[p.ez] || 0) + 1; s.lN++; }
    if (p.blockers != null) { s.blk[p.blockers] = (s.blk[p.blockers] || 0) + 1; s.blkN++; }
    if (p.st === 'T') s.tip++;
    if (p.phase && s.phase[p.phase] != null) s.phase[p.phase]++;
  }
  return s;
}

export const top = (obj, n = 3) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [+k || k, v]);

function guessRole(sz, isSetter, tg = {}) {
  if (isSetter) return 'PASÖR';
  // Önce hücum kodunun hedef oyuncusuna bakılır (F = 4. bölge, C = orta, B = 2. bölge, S = pasör).
  // Orta oyuncunun hızlı vuruşu 2. bölgeden başlasa da (örn. CF, One Leg) orta oyuncudur.
  const t = Object.entries(tg).filter(([k]) => 'FCBS'.includes(k)).sort((a, b) => b[1] - a[1])[0];
  if (t) return { F: 'SMAÇÖR · OH', C: 'ORTA · MB', B: 'ÇAPRAZ · OPP', S: 'PASÖR' }[t[0]];
  const main = top(Object.fromEntries(Object.entries(sz).filter(([z]) => z !== '8')), 1)[0];
  if (!main) return top(sz, 1)[0] && top(sz, 1)[0][0] === 8 ? 'ARKA SIRA' : '';
  return { 4: 'SMAÇÖR · OH', 2: 'ÇAPRAZ · OPP', 3: 'ORTA · MB' }[main[0]] || '';
}

function roleTargets(list, combos) {
  const tg = {};
  list.forEach(p => { const t = p.comb && combos[p.comb] && combos[p.comb].target; if (t) tg[t] = (tg[t] || 0) + 1; });
  return tg;
}

// Bir takım kodu için tüm maçlardan model kurar.
export function buildModel(matches, code) {
  const mm = matches.filter(m => m.teams.home.code === code || m.teams.away.code === code);
  const roster = {}; const libs = new Set(); const comboNames = {};
  const plays = []; const lineups = [];
  let teamName = code;

  for (const m of mm) {
    const side = m.teams.home.code === code ? 'home' : 'away';
    const T = m.teams[side];
    teamName = T.name;
    Object.values(T.roster).forEach(r => { if (!roster[r.no]) roster[r.no] = r; });
    T.libero.forEach(n => libs.add(n));
    Object.assign(comboNames, m.combos);
    m.plays.filter(p => p.side === side).forEach(p => plays.push(p));
    m.lineups.filter(l => l.side === side).forEach(l => lineups.push({ ...l, matchId: m.id, matchLabel: m.label }));
  }

  // Pasörler: oyun başına sahadaki pasör
  const setterCount = {};
  plays.filter(p => p.skill === 'E' && p.setterNo).forEach(p => { setterCount[p.setterNo] = (setterCount[p.setterNo] || 0) + 1; });
  const setters = new Set(Object.keys(setterCount).map(Number));

  const byNo = {};
  plays.filter(p => p.skill === 'A' && Number.isFinite(p.no)).forEach(p => { (byNo[p.no] ||= []).push(p); });

  const players = Object.entries(byNo).map(([no, list]) => {
    no = +no;
    const total = summarize(list);
    const byComb = {};
    list.forEach(p => { (byComb[p.comb || '?'] ||= []).push(p); });
    const combos = Object.entries(byComb).map(([c, l]) => ({
      code: c, name: (comboNames[c] && comboNames[c].name) || (c === '?' ? 'Kodsuz vuruş' : c),
      hit: comboNames[c] && comboNames[c].hit, list: l, s: summarize(l),
    })).sort((a, b) => b.s.n - a.s.n);
    const r = roster[no] || { no, last: '', first: '' };
    return { no, last: r.last, first: r.first, list, s: total, combos, role: guessRole(total.sz, setters.has(no) && setterCount[no] > 20, roleTargets(list, comboNames)), isLibero: libs.has(no) };
  }).sort((a, b) => b.s.n - a.s.n);

  // Pasör dağılımı: pasörün sırası (ön/arka) x faz (side-out/transition) x hedef
  const sets = plays.filter(p => p.skill === 'E');
  const matrix = {};
  for (const p of sets) {
    const row = p.setterAt ? (FRONT.includes(p.setterAt) ? 'front' : 'back') : null;
    const ph = p.phase === 'sideout' ? 'sideout' : p.phase === 'transition' ? 'transition' : null;
    if (!row || !ph) continue;
    const cell = (matrix[row + '|' + ph] ||= { n: 0, t: {} });
    cell.n++;
    // Arka sağ hücum: pas 9. bölgeye gittiyse "1" olarak ayrı sayılır.
    const t = p.target === 'B' && p.ez === 9 ? 'B9' : (p.target || '-');
    cell.t[t] = (cell.t[t] || 0) + 1;
  }

  return { code, name: teamName, matches: mm.map(m => m.id), players, roster, libs: [...libs], setters: top(setterCount, 3).filter(([, n]) => n >= 5), matrix, lineups, setCount: sets.length };
}

export const ZONE_GRID = { 4: [0, 0], 3: [1, 0], 2: [2, 0], 7: [0, 1], 8: [1, 1], 9: [2, 1], 5: [0, 2], 6: [1, 2], 1: [2, 2] };
