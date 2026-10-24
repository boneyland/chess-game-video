// PGN / analysis / notes → normalized game model for game-video.jsx
(function () {
  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const START_FEN = START + ' w KQkq - 0 1';
  const sqIdx = (s) => (8 - +s[1]) * 8 + (s.charCodeAt(0) - 97);
  const idxSq = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
  const fx = (i) => i % 8, fy = (i) => Math.floor(i / 8);
  const at = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1);
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);

  function fromFen(f) {
    const b = new Array(64).fill(null); let i = 0;
    for (const ch of f.split(' ')[0]) { if (ch === '/') continue; if (/\d/.test(ch)) { i += +ch; continue; } b[i++] = ch; }
    return b;
  }
  function geo(b, from, to, type) {
    const dx = fx(to) - fx(from), dy = fy(to) - fy(from), ax = Math.abs(dx), ay = Math.abs(dy);
    if (type === 'n') return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    if (type === 'k') return Math.max(ax, ay) === 1;
    if (type === 'r' && dx && dy) return false;
    if (type === 'b' && ax !== ay) return false;
    if (type === 'q' && !(dx === 0 || dy === 0 || ax === ay)) return false;
    if (!dx && !dy) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    let x = fx(from) + sx, y = fy(from) + sy;
    while (x !== fx(to) || y !== fy(to)) { if (b[at(x, y)]) return false; x += sx; y += sy; }
    return true;
  }
  function canReach(b, from, to, type, color, ep) {
    const target = b[to];
    if (target && colorOf(target) === color) return false;
    if (type === 'p') {
      const dir = color === 'w' ? -1 : 1, dx = fx(to) - fx(from), dy = fy(to) - fy(from);
      if (dx === 0 && !target) {
        if (dy === dir) return true;
        return fy(from) === (color === 'w' ? 6 : 1) && dy === 2 * dir && !b[at(fx(from), fy(from) + dir)];
      }
      return Math.abs(dx) === 1 && dy === dir && (!!target || to === ep);
    }
    return geo(b, from, to, type);
  }
  function attacked(b, sq, by) {
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== by) continue;
      const t = p.toLowerCase();
      if (t === 'p') { if (fy(sq) - fy(i) === (by === 'w' ? -1 : 1) && Math.abs(fx(sq) - fx(i)) === 1) return true; continue; }
      if (geo(b, i, sq, t)) return true;
    }
    return false;
  }
  const CASTLE_LOSS = { 60: /[KQ]/g, 4: /[kq]/g, 63: /K/g, 56: /Q/g, 7: /k/g, 0: /q/g }; // e1 e8 h1 a1 h8 a8
  function applyMove(pos, from, to, promo) {
    const b = pos.b.slice(), p = b[from], t = p.toLowerCase(), color = colorOf(p);
    let ep = -1, epCap = -1;
    if (t === 'p' && to === pos.ep && !b[to]) { epCap = at(fx(to), fy(from)); b[epCap] = null; }
    if (t === 'p' && Math.abs(fy(to) - fy(from)) === 2) ep = at(fx(from), (fy(from) + fy(to)) / 2);
    if (t === 'k' && Math.abs(fx(to) - fx(from)) === 2) {
      const y = fy(from);
      if (fx(to) === 6) { b[at(5, y)] = b[at(7, y)]; b[at(7, y)] = null; } else { b[at(3, y)] = b[at(0, y)]; b[at(0, y)] = null; }
    }
    b[to] = promo ? (color === 'w' ? promo.toUpperCase() : promo.toLowerCase()) : p; b[from] = null;
    // castling rights go when the king or a rook leaves its square, or a rook is taken there
    let castle = pos.castle == null ? 'KQkq' : pos.castle;
    for (const sq of [from, to]) castle = castle.replace(CASTLE_LOSS[sq] || /^$/, '');
    return { b, ep, epCap, turn: color === 'w' ? 'b' : 'w', castle };
  }
  function toFen(pos) {
    const rows = [];
    for (let y = 0; y < 8; y++) { let s = '', e = 0; for (let x = 0; x < 8; x++) { const p = pos.b[y * 8 + x]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; } if (e) s += e; rows.push(s); }
    return rows.join('/') + ' ' + pos.turn;
  }
  const kingIdx = (b, color) => b.findIndex((p) => p === (color === 'w' ? 'K' : 'k'));
  const inCheck = (b, color) => { const k = kingIdx(b, color); return k >= 0 && attacked(b, k, color === 'w' ? 'b' : 'w'); };
  function hasLegal(pos) {
    for (let i = 0; i < 64; i++) {
      const p = pos.b[i]; if (!p || colorOf(p) !== pos.turn) continue;
      for (let j = 0; j < 64; j++) {
        if (!canReach(pos.b, i, j, p.toLowerCase(), pos.turn, pos.ep)) continue;
        if (!inCheck(applyMove(pos, i, j, null).b, pos.turn)) return true;
      }
    }
    return false;
  }
  // ---------- board facts for commentary (static rules, no search) ----------
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const tOf = (p) => p.toLowerCase();
  const nm = (b, i) => (tOf(b[i]) === 'p' ? 'pawn ' : b[i].toUpperCase()) + idxSq(i);
  const sideName = (c) => (c === 'w' ? 'White' : 'Black');
  function attackersOf(b, sq, by) {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== by || i === sq) continue;
      const t = tOf(p);
      if (t === 'p') { if (fy(sq) - fy(i) === (by === 'w' ? -1 : 1) && Math.abs(fx(sq) - fx(i)) === 1) out.push(i); }
      else if (geo(b, i, sq, t)) out.push(i);
    }
    return out;
  }
  const targetsOf = (b, i) => { const c = colorOf(b[i]), out = []; for (let j = 0; j < 64; j++) if (b[j] && colorOf(b[j]) !== c && attackersOf(b, j, c).includes(i)) out.push(j); return out; };
  function hanging(b, color) {
    const out = [], opp = color === 'w' ? 'b' : 'w';
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== color || tOf(p) === 'k') continue;
      const att = attackersOf(b, i, opp); if (!att.length) continue;
      const def = attackersOf(b, i, color), minAtt = Math.min(...att.map((a) => VAL[tOf(b[a])]));
      if (!def.length || minAtt < VAL[tOf(p)]) out.push({ i, att, def: def.length });
    }
    return out;
  }
  const LINES = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
  LINES.q = LINES.r.concat(LINES.b);
  function lineTactics(b, color) {
    const pins = [], skewers = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== color || !LINES[tOf(p)]) continue;
      LINES[tOf(p)].forEach(([dx, dy]) => {
        let x = fx(i) + dx, y = fy(i) + dy, first = -1;
        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
          const j = at(x, y);
          if (b[j]) {
            if (colorOf(b[j]) === color) break;
            if (first < 0) { first = j; } else {
              const v1 = VAL[tOf(b[first])], v2 = VAL[tOf(b[j])];
              if (v2 > v1 && v2 > VAL[tOf(p)] - (tOf(b[j]) === 'k' ? 99 : 0)) pins.push({ by: i, pinned: first, to: j });
              else if (v1 > v2 && (tOf(b[first]) === 'k' || tOf(b[first]) === 'q') && tOf(b[j]) !== 'p' && (v2 > VAL[tOf(p)] || !attackersOf(b, j, colorOf(b[j])).length)) skewers.push({ by: i, front: first, back: j });
              break;
            }
          }
          x += dx; y += dy;
        }
      });
    }
    return { pins, skewers };
  }
  function passedPawns(b, color) {
    const out = [];
    for (let i = 0; i < 64; i++) {
      if (b[i] !== (color === 'w' ? 'P' : 'p')) continue;
      let passed = true;
      for (let j = 0; j < 64 && passed; j++) {
        if (b[j] !== (color === 'w' ? 'p' : 'P') || Math.abs(fx(j) - fx(i)) > 1) continue;
        if (color === 'w' ? fy(j) < fy(i) : fy(j) > fy(i)) passed = false;
      }
      if (passed) out.push(i);
    }
    return out;
  }
  const mobility = (b, i) => { let n = 0; const p = b[i], t = tOf(p), col = colorOf(p); for (let j = 0; j < 64; j++) if (j !== i && canReach(b, i, j, t, col, -1)) n++; return n; };
  const sideMobility = (b, col) => { let n = 0; for (let i = 0; i < 64; i++) if (b[i] && colorOf(b[i]) === col && tOf(b[i]) !== 'p') n += mobility(b, i); return n; };
  const fileName = (x) => FILES[x] + '-file';
  function positional(before, b, mv, me, opp, moved) {
    const out = [], x = fx(mv.to), y = fy(mv.to), fwd = me === 'w' ? -1 : 1;
    const pawnsOn = (col, fx_) => { let n = 0; for (let yy = 0; yy < 8; yy++) if (b[at(fx_, yy)] === (col === 'w' ? 'P' : 'p')) n++; return n; };
    if (moved !== 'p' && moved !== 'k') {
      const m0 = mobility(before.b, mv.from), m1 = mobility(b, mv.to);
      if (m1 - m0 >= 3) out.push(`more active: ${m0} → ${m1} squares`);
      else if (m0 - m1 >= 4) out.push(`less active: ${m0} → ${m1} squares`);
      const rel = me === 'w' ? 8 - y : y + 1;
      const ownPawnDef = [x - 1, x + 1].some((xx) => b[at(xx, y - fwd)] === (me === 'w' ? 'P' : 'p'));
      let kickable = false;
      for (const xx of [x - 1, x + 1]) for (let yy = 0; yy < 8; yy++) if (b[at(xx, yy)] === (opp === 'w' ? 'P' : 'p') && (me === 'w' ? yy < y : yy > y)) kickable = true;
      if (rel >= 4 && rel <= 6 && ownPawnDef && !kickable) out.push('outpost on ' + idxSq(mv.to) + ': protected by a pawn and no enemy pawn can chase it away');
      if (moved === 'r' || moved === 'q') {
        const own = pawnsOn(me, x), theirs = pawnsOn(opp, x);
        if (!own && !theirs) out.push('on the open ' + fileName(x));
        else if (!own) out.push('on the half-open ' + fileName(x) + ' facing Black'.replace('Black', opp === 'w' ? 'White' : 'Black') + "'s pawns");
        if (rel === 7) out.push('reaches the 7th rank, behind the enemy pawns');
        for (let yy = 0; yy < 8; yy++) { const j = at(x, yy); if (j !== mv.to && b[j] && colorOf(b[j]) === me && 'rq'.includes(tOf(b[j])) && geo(b, j, mv.to, 'r')) out.push('lines up with ' + nm(b, j) + ' on the ' + fileName(x)); }
      }
      if ((moved === 'n' || moved === 'b') && x >= 2 && x <= 5 && y >= 2 && y <= 5 && !(x >= 2 && x <= 5 && fy(mv.from) >= 2 && fy(mv.from) <= 5)) out.push('centralised');
      const eyes = targetsOf(b, mv.to).filter((j) => tOf(b[j]) === 'p');
      if (eyes.length) out.push('eyes pawn' + (eyes.length > 1 ? 's ' : ' ') + eyes.map((j) => idxSq(j)).join(', '));
    }
    if (moved === 'p') {
      const rel = me === 'w' ? 8 - y : y + 1;
      if (rel === 5 && x >= 2 && x <= 5) out.push('gains space in the centre');
      const hits = [x - 1, x + 1].map((xx) => at(xx, y + fwd)).filter((j) => j >= 0 && b[j] === (opp === 'w' ? 'P' : 'p'));
      if (hits.length) out.push('pawn break: challenges ' + hits.map((j) => 'pawn ' + idxSq(j)).join(' and '));
      const k = kingIdx(b, me);
      if (k >= 0 && Math.abs(fx(k) - fx(mv.from)) <= 1 && Math.abs(fy(k) - fy(mv.from)) <= 2 && (fx(k) <= 2 || fx(k) >= 5)) out.push('moves a pawn in front of its own king (loosens the shelter)');
    }
    for (const col of ['w', 'b']) {
      const P = col === 'w' ? 'P' : 'p';
      for (let xx = 0; xx < 8; xx++) {
        const isoNow = pawnsOn(col, xx) && !pawnsOn(col, xx - 1 < 0 ? 9 : xx - 1) && !pawnsOn(col, xx + 1 > 7 ? 9 : xx + 1);
        const cnt0 = before.b.filter((p, i) => p === P && fx(i) === xx).length;
        const iso0 = cnt0 && ![xx - 1, xx + 1].some((f) => f >= 0 && f < 8 && before.b.some((p, i) => p === P && fx(i) === f));
        if (isoNow && !iso0) out.push(sideName(col) + ' now has an isolated pawn on the ' + fileName(xx));
        if (pawnsOn(col, xx) >= 2 && cnt0 < 2) out.push(sideName(col) + ' now has doubled pawns on the ' + fileName(xx));
      }
    }
    const om0 = sideMobility(before.b, opp), om1 = sideMobility(b, opp);
    if (om0 - om1 >= 4) out.push(`restricts ${sideName(opp)}: their pieces have ${om0 - om1} fewer squares`);
    return out;
  }
  const material = (b) => b.reduce((s, p) => (p && tOf(p) !== 'k' ? s + (colorOf(p) === 'w' ? 1 : -1) * VAL[tOf(p)] : s), 0);
  function boardFacts(before, after, mv) {
    const b = after.b, me = colorOf(b[mv.to]), opp = me === 'w' ? 'b' : 'w', facts = [];
    const moved = tOf(b[mv.to]);
    const cap = before.b[mv.to] || (after.epCap >= 0 ? before.b[after.epCap] : null);
    if (cap) facts.push('captures ' + PNAME[tOf(cap)]);
    if (mv.promo) facts.push('promotes to ' + PNAME[mv.promo]);
    if (moved === 'k' && Math.abs(fx(mv.to) - fx(mv.from)) === 2) facts.push(fx(mv.to) === 6 ? 'castles kingside' : 'castles queenside');
    const k = kingIdx(b, opp);
    if (k >= 0) {
      const checkers = attackersOf(b, k, me);
      if (checkers.length > 1) facts.push('double check');
      else if (checkers.length === 1 && checkers[0] !== mv.to) facts.push('discovered check by ' + nm(b, checkers[0]));
    }
    const forkT = targetsOf(b, mv.to).filter((j) => tOf(b[j]) === 'k' || (VAL[tOf(b[j])] >= 3 && (VAL[tOf(b[j])] > VAL[moved] || !attackersOf(b, j, opp).length)));
    if (forkT.length >= 2) facts.push('fork: ' + nm(b, mv.to) + ' attacks ' + forkT.map((j) => nm(b, j)).join(' and '));
    else {
      const threat = targetsOf(b, mv.to).filter((j) => tOf(b[j]) !== 'k' && (VAL[tOf(b[j])] > VAL[moved] || !attackersOf(b, j, opp).length));
      if (threat.length) facts.push(nm(b, mv.to) + ' now attacks ' + threat.map((j) => nm(b, j) + (attackersOf(b, j, opp).length ? '' : ' (undefended)')).join(', '));
    }
    const key = (o) => Object.values(o).join('-');
    const lb = lineTactics(before.b, me), la = lineTactics(b, me);
    la.pins.filter((p) => !lb.pins.some((q) => key(q) === key(p))).forEach((p) => facts.push('pin: ' + nm(b, p.by) + ' pins ' + nm(b, p.pinned) + ' to ' + nm(b, p.to)));
    la.skewers.filter((p) => !lb.skewers.some((q) => key(q) === key(p))).forEach((p) => facts.push('skewer: ' + nm(b, p.by) + ' hits ' + nm(b, p.front) + ' with ' + nm(b, p.back) + ' behind'));
    const oppPins = lineTactics(b, opp).pins.filter((p) => colorOf(b[p.pinned]) === me);
    oppPins.forEach((p) => facts.push(sideName(me) + "'s " + nm(b, p.pinned) + ' is pinned to ' + nm(b, p.to) + ' by ' + nm(b, p.by)));
    const hMine = hanging(b, me);
    const movedHang = hMine.find((h) => h.i === mv.to);
    if (movedHang) {
      const by = movedHang.att.map((a) => nm(b, a)).join(' or ');
      const gain = cap ? VAL[tOf(cap)] : 0;
      if (gain >= VAL[moved] - (movedHang.def ? 1 : 0)) facts.push('can be recaptured by ' + by + ' (a trade)');
      else facts.push('the moved piece can be taken by ' + by + (movedHang.def ? ' (it is defended)' : ' (undefended)') + ' — a sacrifice or an oversight');
    }
    hMine.filter((h) => h.i !== mv.to && !hanging(before.b, me).some((x) => x.i === h.i)).forEach((h) => facts.push(sideName(me) + ' leaves ' + nm(b, h.i) + ' en prise to ' + h.att.map((a) => nm(b, a)).join(' or ')));
    const hOpp = hanging(b, opp).filter((h) => VAL[tOf(b[h.i])] >= 3);
    if (hOpp.length) facts.push(sideName(opp) + ' pieces under attack: ' + hOpp.map((h) => nm(b, h.i)).join(', '));
    const pb = passedPawns(before.b, me), pa = passedPawns(b, me);
    pa.filter((i) => !pb.includes(i) && !(moved === 'p' && i === mv.to && pb.includes(mv.from))).forEach((i) => facts.push('new passed pawn on ' + idxSq(i)));
    if (moved === 'p' && pa.includes(mv.to)) { const r = me === 'w' ? 8 - fy(mv.to) : fy(mv.to) + 1; if (r >= 6) facts.push('passed pawn reaches the ' + r + 'th rank'); }
    try { positional(before, b, mv, me, opp, moved).forEach((f) => facts.push(f)); } catch (e) {}
    const m = material(b);
    facts.push('material ' + (m === 0 ? 'level' : (m > 0 ? 'White +' : 'Black +') + Math.abs(m)));
    return facts;
  }

  function sanToMove(pos, san) {
    let s = san.replace(/[+#!?]+$/, '');
    if (/^0-0/.test(s)) s = s.replace(/0/g, 'O');
    const color = pos.turn;
    if (/^O-O(-O)?$/.test(s)) { const y = color === 'w' ? 7 : 0; return { from: at(4, y), to: at(s.length > 3 ? 2 : 6, y), promo: null }; }
    const m = s.match(/^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/);
    if (!m) throw new Error(`Can't read the move "${san}"`);
    const type = (m[1] || 'P').toLowerCase(), to = sqIdx(m[4]), promo = m[5] ? m[5].toLowerCase() : null;
    const cands = [];
    for (let i = 0; i < 64; i++) {
      const p = pos.b[i];
      if (!p || colorOf(p) !== color || p.toLowerCase() !== type) continue;
      if (m[2] && FILES[fx(i)] !== m[2]) continue;
      if (m[3] && String(8 - fy(i)) !== m[3]) continue;
      if (!canReach(pos.b, i, to, type, color, pos.ep)) continue;
      if (inCheck(applyMove(pos, i, to, promo).b, color)) continue;
      cands.push(i);
    }
    if (cands.length !== 1) throw new Error(`"${san}" is not a legal move here`);
    return { from: cands[0], to, promo };
  }

  function splitGames(text) {
    const games = []; let cur = [], inMoves = false;
    text.replace(/\r/g, '').split('\n').forEach((line) => {
      const hdr = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
      if (hdr && inMoves) { games.push(cur.join('\n')); cur = []; inMoves = false; }
      if (!hdr && line.trim()) inMoves = true;
      cur.push(line);
    });
    if (cur.join('').trim()) games.push(cur.join('\n'));
    return games.filter((g) => /\S/.test(g));
  }
  const NAG = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
  function parsePGN(text) {
    const headers = {};
    const body = text.replace(/\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g, (_, k, v) => { headers[k] = v; return ' '; });
    const plies = []; let intro = '', depth = 0, varPly = -1, varSans = null, varAt = 0, i = 0;
    const addComment = (raw) => {
      if (depth > 0) return;
      const ev = raw.match(/\[%eval\s+([^\]\s]+)/), ck = raw.match(/\[%clk\s+([\d:.]+)/);
      // cutechess engine comments: {+0.25/20 1.2s}, {+M5/30 0.8s} (M counts plies), {book}; cutechess
      // stores them for the side that just moved (its whitepov option only fixes engines that report White's view)
      const ae = ev ? null : raw.match(/^\s*([+-]?)(?:(\d+(?:\.\d+)?)|M(\d+))\/\d+(?:\s+[\d.]+s\b)?/);
      const txt = (ae ? raw.slice(ae[0].length) : raw).replace(/\[%[^\]]*\]/g, '').replace(/^\s*book\s*$/, '').replace(/\s+/g, ' ').trim();
      const t = plies[plies.length - 1];
      if (!t) { if (txt) intro = (intro + ' ' + txt).trim(); return; }
      if (ev) { if (ev[1][0] === '#') t.mate = parseInt(ev[1].slice(1), 10); else t.cp = Math.round(parseFloat(ev[1]) * 100); }
      if (ae) {
        const sign = (ae[1] === '-' ? -1 : 1) * ((plies.length - 1) % 2 ? -1 : 1);
        if (ae[3]) t.mate = sign * Math.ceil(parseInt(ae[3], 10) / 2); else t.cp = sign * Math.round(parseFloat(ae[2]) * 100);
      }
      if (ck) t.clk = ck[1].split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
      if (txt) t.comment = (t.comment ? t.comment + ' ' : '') + txt;
    };
    while (i < body.length) {
      const ch = body[i];
      if (ch === '{') { const j = body.indexOf('}', i); addComment(body.slice(i + 1, j < 0 ? body.length : j)); i = j < 0 ? body.length : j + 1; continue; }
      if (ch === ';') { const j = body.indexOf('\n', i); i = j < 0 ? body.length : j + 1; continue; }
      if (ch === '(') { depth++; if (depth === 1) { varPly = plies.length - 1; varSans = []; varAt = i; } i++; continue; }
      if (ch === ')') {
        if (depth === 1 && varPly >= 0) {
          const P = plies[varPly];
          if (!P.variation) P.variation = varSans;
          // every variation as written, nested ones and comments included, so an annotated PGN keeps them
          (P.vars = P.vars || []).push(body.slice(varAt, i + 1));
        }
        depth = Math.max(0, depth - 1); i++; continue;
      }
      if (/\s/.test(ch)) { i++; continue; }
      let j = i; while (j < body.length && !/[\s{}();]/.test(body[j])) j++;
      // a stray } (a comment with a { inside it) has no token: skip it, or the loop never moves on
      if (j === i) { i++; continue; }
      let tok = body.slice(i, j); i = j;
      if (/^\$\d+$/.test(tok)) {
        const P = depth === 0 && plies[plies.length - 1], n = +tok.slice(1);
        // $1–$6 are the move's mark; the rest ($14 White is slightly better, …) are kept as they are
        if (P) { if (NAG[n]) P.mark = NAG[n]; else (P.nags = P.nags || []).push(n); }
        continue;
      }
      tok = tok.replace(/^\d+\.+/, '');
      if (!tok || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
      const mm = tok.match(/^(.*?)([!?]{1,2})?$/);
      if (depth === 0) plies.push({ san: mm[1], mark: mm[2] || null });
      else if (depth === 1) varSans.push(mm[1]);
    }
    return { headers, plies, intro };
  }
  function parseNotes(text) {
    const out = { plies: {} }, re = /^\s*\[(\d+|INTRO|RESULT|CONCLUSION)\]/gim, keys = []; let m;
    while ((m = re.exec(text))) keys.push({ k: m[1].toUpperCase(), s: m.index, e: m.index + m[0].length });
    keys.forEach((k, i) => {
      const txt = text.slice(k.e, i + 1 < keys.length ? keys[i + 1].s : text.length).replace(/\s+/g, ' ').trim();
      if (/^\d+$/.test(k.k)) out.plies[+k.k] = txt; else out[k.k.toLowerCase()] = txt;
    });
    return out;
  }

  const MARK_CLASS = { '?!': 'inaccuracy', '?': 'mistake', '??': 'blunder', '!': 'good', '!!': 'brilliant', '!?': 'interesting' };
  const ENGINE_MARK = { inaccuracy: '?!', mistake: '?', blunder: '??' };
  const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const fmtDate = (d) => { const m = (d || '').match(/^(\d{4})\.(\d{2})\.(\d{2})$/); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (d || '').replace(/\.\?\?/g, ''); };
  const surname = (n) => (n || '').split(',')[0].trim();
  const clean = (v) => (v && v !== '?' && v !== '-' ? v : '');

  function classifyFile(name, text) {
    try { const j = JSON.parse(text); if (j && j.format === 'queen-answers') return 'queen'; if (j && Array.isArray(j.moves)) return 'analysis'; } catch (e) {}
    if (/_notes\.txt$/i.test(name) || (/^\s*\[(\d+|INTRO|RESULT|CONCLUSION)\]/im.test(text) && !/^\s*\[\w+\s+"/m.test(text))) return 'notes';
    return 'pgn';
  }

  // "12." for White's ply, "12…" for Black's; absPly counts half-moves from the standard start (Black's first move is 1)
  const moveNo = (absPly) => Math.floor(absPly / 2) + 1 + (absPly % 2 ? '…' : '.');

  // A FEN → { pos, ply0, fen }: fen is the six-field form, ply0 the half-moves before the position (so the move
  // number of the next move is moveNo(ply0)). Throws an Error a reader can act on.
  function parseFen(fen) {
    const f = String(fen).trim().split(/\s+/);
    const bad = () => new Error(`That isn't a FEN: ${String(fen).trim().slice(0, 80)}`);
    const ranks = f[0].split('/');
    const width = (r) => [...r].reduce((s, c) => s + (/\d/.test(c) ? +c : 1), 0);
    if (f.length > 6 || ranks.length !== 8 || !ranks.every((r) => /^[pnbrqkPNBRQK1-8]+$/.test(r) && width(r) === 8)) throw bad();
    const turn = f[1] || 'w', castle = f[2] || '-', ep = f[3] || '-', half = f[4] || '0', full = f[5] || '1';
    if (!/^[wb]$/.test(turn) || !/^\d+$/.test(half) || !/^\d+$/.test(full) || !/^(-|[a-h][1-8])$/.test(ep)) throw bad();
    const b = fromFen(f[0]);
    const count = (ch) => b.filter((p) => p === ch).length;
    if (count('K') !== 1 || count('k') !== 1) throw new Error('A position needs one king of each colour');
    if (b.some((p, i) => (p === 'P' || p === 'p') && (i < 8 || i > 55))) throw new Error("A pawn can't stand on the first or last rank");
    if (inCheck(b, turn === 'w' ? 'b' : 'w')) throw new Error('The side not to move is in check');
    if (/[A-Ha-h]/.test(castle)) throw new Error("Chess960 positions aren't supported yet");
    if (castle !== '-' && !/^K?Q?k?q?$/.test(castle)) throw new Error("Castling rights don't match the pieces");
    const rights = castle === '-' ? '' : castle;
    for (const [r, king, rook] of [['K', 60, 63], ['Q', 60, 56], ['k', 4, 7], ['q', 4, 0]]) {
      const white = r === r.toUpperCase();
      if (rights.includes(r) && !(b[king] === (white ? 'K' : 'k') && b[rook] === (white ? 'R' : 'r'))) throw new Error("Castling rights don't match the pieces");
    }
    let epIdx = -1;
    if (ep !== '-') {
      epIdx = sqIdx(ep);
      // the pawn that just moved two stands in front of the square, and the square it left behind is empty
      const dir = turn === 'w' ? 1 : -1;
      if (+ep[1] !== (turn === 'w' ? 6 : 3) || b[epIdx] || b[epIdx - 8 * dir] || b[epIdx + 8 * dir] !== (turn === 'w' ? 'p' : 'P')) throw new Error("The en passant square doesn't match the pieces");
    }
    const fullmove = Math.max(1, +full);
    return {
      pos: { b, ep: epIdx, turn, castle: rights },
      ply0: (fullmove - 1) * 2 + (turn === 'b' ? 1 : 0),
      fen: [f[0], turn, castle, ep, +half, fullmove].join(' '),
    };
  }

  // The six-field FEN of the position reached by playing `sans` from `startFen`: pos is that position (castling rights
  // and en passant square from it), the half-move clock counted on from the start's, the move number from its ply0
  function fenAfter(startFen, sans, pos) {
    const s = parseFen(startFen);
    let half = +s.fen.split(' ')[4];
    for (const san of sans) half = /^[a-h]/.test(san) || san.includes('x') ? 0 : half + 1;
    const castle = pos.castle == null ? 'KQkq' : pos.castle || '-';
    return [toFen(pos), castle, pos.ep >= 0 ? idxSq(pos.ep) : '-', half, Math.floor((s.ply0 + sans.length) / 2) + 1].join(' ');
  }

  const ends = (N) => ({ intro: (N && N.intro) || '', conclusion: (N && (N.conclusion || N.result)) || '' });
  const SAY_ORDER = ['notes', 'claude', 'pgn']; // a notes file wins over Claude, Claude over the PGN's comments

  // the sources of commentary this game has
  const commentarySources = (M) => SAY_ORDER.filter((k) => M.says && (M.says[k].intro || M.says[k].conclusion || M.plies.some((p) => p.says && p.says[k])));

  // M with only the commentary of the sources show leaves on ({ pgn, claude, notes }; a missing key is on)
  function withCommentary(M, show) {
    if (!M.says || SAY_ORDER.every((k) => show[k] !== false)) return M;
    const on = SAY_ORDER.filter((k) => show[k] !== false);
    const first = (f) => { for (const k of on) { const v = f(k); if (v) return v; } return ''; };
    return {
      ...M, intro: first((k) => M.says[k].intro), conclusion: first((k) => M.says[k].conclusion),
      plies: M.plies.map((p) => ({ ...p, comment: p.says ? first((k) => p.says[k]) : p.comment })),
    };
  }

  function buildGame(files) {
    const { pgn, analysis, notes } = files;
    const gameIndex = files.gameIndex || 0;
    let P = null, gameCount = 1;
    if (pgn) { const games = splitGames(pgn); if (!games.length) throw new Error('The PGN has no games'); gameCount = games.length; P = parsePGN(games[Math.min(gameIndex, games.length - 1)]); }
    const A = analysis ? (typeof analysis === 'string' ? JSON.parse(analysis) : analysis) : null;
    // commentary layers, lowest priority first: bundled sample notes, AI-written, user's notes file; each source is
    // kept apart too (ply.says, M.says), so withCommentary can show some of them
    const merge = (ls) => (ls.length ? ls.reduce((acc, n) => ({ ...acc, ...n, plies: { ...acc.plies, ...n.plies } }), { plies: {} }) : null);
    const NC = files.aiNotes ? parseNotes(files.aiNotes) : null;
    const NF = merge([files.sampleNotes, notes].filter(Boolean).map(parseNotes));
    const NT = merge([files.sampleNotes, files.aiNotes, notes].filter(Boolean).map(parseNotes));
    const pgnHasEval = !!P && P.plies.some((p) => p.cp != null || p.mate != null);
    const useA = !!A && !(files.evalSource === 'pgn' && pgnHasEval);
    const H = P ? P.headers : {};
    // a PGN's [FEN] header, else the analysis file's start; both are normalised, so equal starts compare equal
    const start = parseFen(H.FEN || (!P && A && A.start_fen) || START_FEN);
    const ply0 = start.ply0, stdStart = start.fen === START_FEN;
    const sans = P ? P.plies.map((p) => p.san) : A ? A.moves.map((m) => m.move_san) : [];
    if (!sans.length) throw new Error('No moves found');
    if (A && P && A.moves.length && A.moves[0].move_san.replace(/[+#]/g, '') !== sans[0].replace(/[+#]/g, '')) throw new Error("The analysis file doesn't match this PGN");
    // chess-animator's analysis JSON never has start_fen (its moves come from the PGN's [FEN] board): then the per-ply SAN match and the side to move decide
    if (A && P && A.start_fen && parseFen(A.start_fen).fen !== start.fen) throw new Error("The analysis file doesn't match this PGN");
    if (A && P && A.moves.length && typeof A.moves[0].is_white_move === 'boolean' && A.moves[0].is_white_move !== (start.pos.turn === 'w')) throw new Error("The analysis file doesn't match this PGN");

    let pos = start.pos;
    const plies = [];
    sans.forEach((san, i) => {
      const am = useA && A.moves[i];
      if (A && P && am && am.move_san.replace(/[+#]/g, '') !== san.replace(/[+#]/g, '')) throw new Error(`The analysis file doesn't match this PGN at ply ${i + 1}`);
      const before = pos, mv = sanToMove(pos, san);
      pos = applyMove(pos, mv.from, mv.to, mv.promo);
      let facts = [];
      try { facts = boardFacts(before, pos, mv); } catch (e) {}
      const pp = P ? P.plies[i] : {};
      const check = inCheck(pos.b, pos.turn);
      const ply = { san: san.replace(/[#+]/g, '') + (check ? (hasLegal(pos) ? '+' : '#') : ''), uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || ''), side: (ply0 + i) % 2 ? 'b' : 'w' };
      ply.checkmate = ply.san.endsWith('#');
      if (check) ply.checkSq = idxSq(kingIdx(pos.b, pos.turn));
      ply.fen = toFen(pos);
      ply.castle = pos.castle;
      ply.ep = pos.ep; // the FEN carries neither, so positions rebuilt from it need both
      ply.facts = ply.checkmate ? ['checkmate'] : facts;
      ply.capture = !!before.b[mv.to] || pos.epCap >= 0;
      // analysis files encode mate in N as ±(10000 − 10·N), White's point of view
      if (am && typeof am.eval_after === 'number') { if (Math.abs(am.eval_after) >= 9000) ply.mate = Math.sign(am.eval_after) * Math.max(1, Math.round((10000 - Math.abs(am.eval_after)) / 10)); else ply.cp = am.eval_after; }
      else if (pp.cp != null) ply.cp = pp.cp;
      else if (pp.mate != null) ply.mate = pp.mate;
      if (ply.checkmate) { ply.mate = ply.side === 'w' ? 0.5 : -0.5; delete ply.cp; }
      const eng = am ? am.classification || '' : '';
      ply.mark = pp.mark || ENGINE_MARK[eng] || null;
      ply.cls = ply.mark ? MARK_CLASS[ply.mark] : eng === 'best' ? 'best' : 'none';
      if (am && am.eval_loss) ply.loss = Math.round(am.eval_loss);
      if (am && am.best_move_uci && am.best_move_uci !== ply.uci) ply.best = { uci: am.best_move_uci, line: am.best_line || [] };
      // the move played was the engine's choice: keep its line, which starts with that move
      else if (am && am.best_line && am.best_line.length) ply.line = am.best_line;
      else if (!useA && pp.variation && pp.variation.length) {
        try { const bm = sanToMove(before, pp.variation[0]); ply.best = { uci: idxSq(bm.from) + idxSq(bm.to) + (bm.promo || ''), line: pp.variation }; } catch (e) {}
      }
      if (am && am.mate_advice) ply.advice = am.mate_advice;
      // the search of the position after the move, as it actually ran
      if (am && am.search_depth_after) ply.search = { depth: am.search_depth_after, maxDepth: am.search_maxdepth_after || am.search_depth_after, timeMs: am.search_time_after_ms == null ? null : am.search_time_after_ms, nodes: am.search_nodes_after == null ? null : am.search_nodes_after };
      const nextA = useA && A.moves[i + 1];
      if (nextA && nextA.best_line && nextA.best_line.length) ply.expect = nextA.best_line.slice(0, 6);
      if (pp.clk != null) ply.clk = pp.clk;
      const note = NT && NT.plies[i + 1];
      if (pp.vars) ply.pgnVars = pp.vars;
      if (pp.nags) ply.nags = pp.nags;
      ply.pgnComment = pp.comment || '';
      ply.comment = note || pp.comment || '';
      ply.says = { pgn: pp.comment || '', claude: (NC && NC.plies[i + 1]) || '', notes: (NF && NF.plies[i + 1]) || '' };
      plies.push(ply);
    });
    // PGN-only evals: rate unmarked moves by win-chance drop (Lichess thresholds)
    if (!useA) {
      const known = (p) => p && (p.cp != null || (p.mate != null && !p.checkmate));
      const cpv = (p) => (p.mate != null ? Math.sign(p.mate) * 10000 : p.cp);
      plies.forEach((p, i) => {
        const prev = i ? plies[i - 1] : stdStart ? { cp: 20 } : null; // no known eval before a custom start's first move
        if (p.mark || !known(p) || !known(prev) || p.mate != null || prev.mate != null) return;
        const sgn = p.side === 'w' ? 1 : -1;
        const drop = sgn * (winChance(cpv(prev)) - winChance(cpv(p)));
        const mk = drop >= 0.3 ? '??' : drop >= 0.2 ? '?' : drop >= 0.1 ? '?!' : null;
        if (mk) { p.mark = mk; p.cls = MARK_CLASS[mk]; }
        const loss = Math.round(sgn * (cpv(prev) - cpv(p)));
        if (loss > 0) p.loss = loss;
      });
    }
    // carry evals forward so the plot has no gaps
    const aStart = useA && A.moves[0] && typeof A.moves[0].eval_before === 'number';
    const first = plies.find((p) => p.cp != null || (p.mate != null && !p.checkmate));
    // the +0.20 first-move edge is the standard start's; a custom start has only its first known eval
    let lastCp = aStart ? A.moves[0].eval_before : stdStart ? 20 : first ? (first.mate != null ? Math.sign(first.mate) * 10000 : first.cp) : 20;
    const evalStart = lastCp, evalStartKnown = aStart || stdStart;
    plies.forEach((p) => { if (p.cp == null && p.mate == null) p.cpFill = lastCp; else lastCp = p.mate != null ? Math.sign(p.mate) * 10000 : p.cp; });
    // the checkmate on the last move is a fact of the game, not an engine eval
    const hasEval = plies.some((p) => p.cp != null || (p.mate != null && !p.checkmate));
    const hasClock = plies.some((p) => p.clk != null);
    const tc = (H.TimeControl || '').match(/^(\d+)/);
    const clockStart = tc ? +tc[1] : hasClock ? Math.ceil(Math.max(plies[0].clk || 0, (plies[1] && plies[1].clk) || 0) / 60) * 60 : 0;
    const eng = useA && A.engine;
    // search as Python's describe_search; one line and one thread (the browser engine) go unsaid
    const search = eng && (eng.depth && eng.time_limit ? `depth ${eng.depth}, max ${eng.time_limit}s per position` : eng.time_limit ? `${eng.time_limit}s per position` : eng.depth ? `depth ${eng.depth}` : '');
    const single = eng && eng.lines === 1 && eng.threads === 1;
    const engine = eng ? [eng.name, search, !single && eng.lines ? `${eng.lines} line${eng.lines > 1 ? 's' : ''}` : '', !single && eng.threads ? `${eng.threads} thread${eng.threads > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : pgnHasEval ? 'Evaluations from the PGN' : '';
    const player = (side) => {
      const S = side === 'w' ? 'White' : 'Black', s = side === 'w' ? 'white' : 'black';
      const name = clean(H[S]) || (A && A[s]) || S;
      return { name, named: name !== S, short: surname(name), title: clean(H[S + 'Title']), elo: clean(H[S + 'Elo']) || (A && clean(A[s + '_elo'])) || '', team: clean(H[S + 'Team']), acc: useA && A[s + '_stats'] && A[s + '_stats'].accuracy };
    };
    const result = clean(H.Result) || (A && A.result) || '*';
    // the PGN's opening, else the analysis file's, else Lichess's opening book (as AnalysisData.name_opening)
    const known = (n) => clean(n) && n !== 'Unknown';
    let opening = known(H.Opening) ? { eco: clean(H.ECO), name: H.Opening } : A && known(A.opening_name) ? { eco: A.opening_eco || '', name: A.opening_name } : null;
    if (!opening && window.Openings) { try { opening = window.Openings.book().identify(plies.map((p) => p.uci), start.fen); } catch (e) {} }
    if (!opening) opening = { eco: clean(H.ECO), name: '' };
    const round = clean(H.Round) || (A && clean(A.round_num)) || '';
    return {
      white: player('w'), black: player('b'),
      event: clean(H.Event) || (A && A.event) || '', round, site: clean(H.Site) || (A && A.site) || '', date: fmtDate(clean(H.Date) || (A && A.date)), pgnDate: clean(H.Date) || (A && clean(A.date)) || '',
      eco: opening.eco, opening: opening.name,
      result, intro: (NT && NT.intro) || (P && P.intro) || '', conclusion: (NT && (NT.conclusion || NT.result)) || '',
      says: { pgn: { intro: (P && P.intro) || '', conclusion: '' }, claude: ends(NC), notes: ends(NF) },
      engine, engineName: eng ? eng.name || '' : '', start: { fen: start.fen, pos: start.pos }, ply0, plies, evalStart, evalStartKnown, hasEval, hasClock, clockStart, gameCount, hasAnalysis: !!A, hasNotes: !!notes, hasAiNotes: !!files.aiNotes, headers: H, evalSource: useA ? 'analysis' : pgnHasEval ? 'pgn' : 'none', canChooseSource: !!A && pgnHasEval,
    };
  }

  const winChance = (cp) => 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  const plyCp = (p) => (p.mate != null ? Math.sign(p.mate) * 10000 : p.cp != null ? p.cp : p.cpFill);

  // Split plies across the timeline sections: opening / middlegame / critical window around the biggest swing / endgame
  function plan(M) {
    const N = M.plies.length;
    let crit = -1;
    if (M.hasEval) {
      let best = 0;
      M.plies.forEach((p, i) => { const d = Math.abs(winChance(plyCp(p)) - winChance(i ? plyCp(M.plies[i - 1]) : M.evalStart)); if (d > best) { best = d; crit = i; } });
    }
    if (crit < 0) { crit = M.plies.findIndex((p) => p.cls === 'blunder' || p.cls === 'brilliant'); if (crit < 0) crit = Math.floor(N * 0.65); }
    let cs = Math.max(0, crit - 3), ce = Math.min(N - 1, crit + 5);
    const oe = Math.round(cs * 0.45) - 1;
    return [['Opening', 0, oe], ['Middlegame', oe + 1, cs - 1], ['Critical', cs, ce], ['Endgame', ce + 1, N - 1]];
  }

  // Per-ply hold times and the resulting scene list. Lead/tail values must match the schedule in game-video.jsx.
  const KEY_CLS = ['blunder', 'mistake', 'inaccuracy', 'brilliant', 'good', 'interesting'];
  const MAX_TOTAL = 300, TITLE = 5, OUTRO = 7, READ_CAP = 6;
  function timing(M, o) {
    const spm = o.secondsPerMove || 1.6, hold = o.keyHold == null ? 1.5 : o.keyHold, read = o.readSpeed || 22; // characters a second
    const ranges = plan(M);
    let d = M.plies.map((p) => {
      // reading time for the comment and Queen's sentence together, at most READ_CAP s; on a marked move it stands in
      // for the extra hold, which only a marked move with nothing to read gets
      const chars = (p.comment || '').length + (p.queenText || '').length;
      if (chars) return Math.max(spm, Math.min(READ_CAP, chars / read));
      return KEY_CLS.includes(p.cls) || p.checkmate ? spm + hold * (p.cls === 'blunder' || p.checkmate ? 1.3 : 1) : spm;
    });
    if (o.fastOpening) { const [, a, b] = ranges[0]; for (let i = a; i <= b; i++) if (!M.plies[i].comment && !M.plies[i].mark) d[i] *= 0.55; }
    const live = ranges.filter((r) => r[2] >= r[1]);
    const lt = (name) => { const gi = live.findIndex((r) => r[0] === name); return gi < 0 ? 0 : (gi === 0 ? 1.2 : 0.6) + (gi === live.length - 1 ? 2.6 : 0.5); };
    const fixed = TITLE + OUTRO + ranges.reduce((s, r) => s + (r[2] >= r[1] ? lt(r[0]) : 0.1), 0);
    const sum = d.reduce((s, x) => s + x, 0);
    const capped = fixed + sum > MAX_TOTAL;
    if (capped) { const k = (MAX_TOTAL - fixed - 0.5) / sum; d = d.map((x) => x * k); }
    const mv = (i) => Math.floor(((M.ply0 || 0) + i) / 2) + 1;
    const DESC = { Opening: 'The opening moves', Middlegame: 'Middlegame moves leading up to the critical moment', Critical: 'The biggest eval swing and the moves around it, with camera push', Endgame: 'The rest of the game to the final move' };
    const scenes = [{ name: 'Title', dur: TITLE, desc: 'Title card from the PGN headers: players, event, opening' }];
    ranges.forEach(([name, a, b]) => {
      let dur = 0.1;
      if (b >= a) { dur = lt(name); for (let i = a; i <= b; i++) dur += d[i]; }
      scenes.push({ name, dur: Math.round(dur * 10) / 10, desc: b >= a ? `${DESC[name]} (moves ${mv(a)}–${mv(b)})` : 'Empty for this game' });
    });
    scenes.push({ name: 'Outro', dur: OUTRO, desc: 'End card: result, accuracy, engine settings, fade out' });
    return { d, scenes, capped, total: scenes.reduce((s, x) => s + x.dur, 0) };
  }

  // When each ply plays on the timeline (tp) and how long its move animates (md). CUES is each scene's start time.
  const AFTER = { Opening: 'Middlegame', Middlegame: 'Critical', Critical: 'Endgame', Endgame: 'Outro' };
  function schedule(M, CUES, d) {
    const N = M.plies.length, tp = new Array(N), groups = [];
    let pendingStart = null;
    plan(M).forEach(([name, a, b]) => {
      if (b >= a) { groups.push({ a, b, start: pendingStart != null ? pendingStart : CUES[name], end: CUES[AFTER[name]] }); pendingStart = null; }
      else if (groups.length) groups[groups.length - 1].end = CUES[AFTER[name]];
      else if (pendingStart == null) pendingStart = CUES[name];
    });
    groups.forEach((g, gi) => {
      const lead = gi === 0 ? 1.2 : 0.6, tail = gi === groups.length - 1 ? 2.6 : 0.5;
      let tot = 0; for (let i = g.a; i <= g.b; i++) tot += d[i];
      const span = g.end - g.start - lead - tail; let acc = 0;
      for (let i = g.a; i <= g.b; i++) { tp[i] = g.start + lead + (acc / tot) * span; acc += d[i]; }
    });
    const md = tp.map((t, i) => Math.min(0.5, 0.6 * ((i + 1 < N ? tp[i + 1] : t + 1) - t)));
    const blunders = M.plies.map((p, i) => i).filter((i) => M.plies[i].cls === 'blunder');
    return { tp, md, N, blunders };
  }
  // the scene start times the stage derives from timing()'s scenes (deriveCues in engine.jsx)
  function cues(scenes) {
    let start = 0; const table = {};
    scenes.forEach((s) => { if (!(s.name in table)) table[s.name] = Math.round(start * 1000) / 1000; start += s.dur; });
    return table;
  }
  // Seconds of the video to export for plies from..to: from -1 starts on the title card, to N ends after the end card.
  // A move's clip starts just before it is played and ends once it has settled, as the player shows it on a jump.
  // Returns a function of (from, to), so that the schedule is worked out once.
  function clipRange(M, TM) {
    const CUES = cues(TM.scenes), S = schedule(M, CUES, TM.d), N = S.N;
    return (from, to) => {
      const start = from < 0 ? 0 : Math.max(0, S.tp[from] - 0.3);
      const end = to >= N ? TM.total : to + 1 < N ? S.tp[to + 1] - 0.12 : Math.min(S.tp[to] + S.md[to] + 3, CUES.Outro - 0.1);
      return { start, end: Math.max(start, end) };
    };
  }

  // ---------- AI commentary ----------
  const fmtCp = (p) => (p.checkmate ? 'checkmate' : p.mate != null ? (p.mate > 0 ? '+M' : '-M') + Math.abs(p.mate) : p.cp != null ? (p.cp >= 0 ? '+' : '') + (p.cp / 100).toFixed(2) : 'n/a');
  const fmtClk = (s) => (s == null ? '' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));
  const numbered = (start, line, ply0) => line.map((m, j) => { const ply = (ply0 || 0) + start + j, w = ply % 2 === 0, n = Math.floor(ply / 2) + 1; return (w ? n + '. ' : j === 0 ? n + '... ' : '') + m; }).join(' ');
  function commentaryPrompt(M, o) {
    const tone = { Broadcast: 'lively live-broadcast commentary: vivid, confident, a little dramatic, but never hype for its own sake', Lesson: 'a coach teaching club players: explain the idea and the lesson behind each moment', Concise: 'terse, precise annotation in the style of a chess magazine' }[o.tone] || 'lively broadcast commentary';
    const audience = { Beginners: 'viewers who know how the pieces move but not much strategy. Avoid jargon; when you must use a term (outpost, pin, open file, passed pawn), explain it in a few plain words', 'Club players': 'club players who know common terms (pins, outposts, open files) but want the ideas made clear', Experts: 'strong players; you may use technical language freely' }[o.audience || 'Beginners'];
    const density = o.density === 'Detailed' ? 'about one comment every 2-3 moves on average, plus every critical moment' : 'only the key moments: roughly 10-18 comments for a typical game';
    const system = [
      'You write on-screen commentary captions for an animated chess game-review video.',
      'Style: ' + tone + '.',
      'Ground every claim in the data provided (moves, FEN positions, engine evals in pawns from White\'s point of view, move ratings, best lines, clocks, annotator notes). Do not invent facts about the players, the event or its history beyond the headers. If you are not sure a tactic exists, describe the evaluation change instead of guessing.',
      '"board facts" are computed from each position by simple static rules (captures, checks, forks, pins, skewers, pieces left en prise, passed pawns, material). They are accurate statements about the position, but they do not prove a tactic works: a piece "en prise" may be a deliberate sacrifice, and a "fork" may be met by a counter-attack. Use the evals and best lines to judge which facts actually matter, and build the explanation around them. Never claim a tactic that is not in the board facts or best lines.',
      'Audience: ' + audience + '.',
      'Quiet moves (no capture, no check) are often the most confusing for viewers. When a quiet move matters — the engine rates it best and the eval rises, or it starts a plan, or it looks odd — explain its purpose: which square, file or rank it takes, what it attacks or prepares (use the "engine expects next" line to see the plan), and what it stops the opponent from doing. Use the positional board facts (activity, outposts, open files, pawn breaks, restriction) as your evidence.',
      'Choose moments that matter: every rated mistake, the largest eval swings, sacrifices, decisive captures and checks, time trouble visible from the clocks, and the final move. Coverage: ' + density + '.',
      'Each comment: at most 120 characters (up to 160 when explaining a quiet move), one or two short sentences, plain English. Explain the idea (why the move is good or bad, what it threatens, what was better) rather than just restating the number. For mistakes, name the better move from the best line. Refer to moves in SAN with their number, e.g. 28.Qxb5?? or 20...Qb7?!.',
      'Also write an intro (at most 140 characters, shown on the title card before move 1) and a conclusion (at most 140 characters, shown on the end card).',
      'Reply with JSON only, no prose, in this exact shape: {"intro":"...","conclusion":"...","comments":[{"ply":12,"text":"..."}]}. ply counts half-moves: 1 is the first move listed, 2 the next.',
    ].join('\n');
    const head = ['White: ' + [M.white.name, M.white.title, M.white.elo].filter(Boolean).join(' '), 'Black: ' + [M.black.name, M.black.title, M.black.elo].filter(Boolean).join(' '), 'Event: ' + [M.event, M.round && 'round ' + M.round, M.site, M.date].filter(Boolean).join(', '), 'Opening: ' + [M.eco, M.opening].filter(Boolean).join(' '), 'Result: ' + M.result].join('\n');
    const lines = M.plies.map((p, i) => {
      const mv = moveNo((M.ply0 || 0) + i).replace('…', '...') + p.san + (p.mark || '');
      const prev = i ? M.plies[i - 1] : null;
      const parts = ['ply ' + (i + 1), mv + ' (' + (p.side === 'w' ? 'White' : 'Black') + ')'];
      if (M.hasEval) parts.push('eval ' + (prev ? fmtCp(prev) : M.start.fen === START_FEN ? '+0.20' : M.evalStartKnown ? fmtCp({ cp: M.evalStart }) : '?') + ' -> ' + fmtCp(p));
      if (p.cls && p.cls !== 'none' && p.cls !== 'best') parts.push(p.cls + (p.loss ? ' (-' + p.loss + 'cp)' : ''));
      if (p.best && p.cls !== 'best') parts.push('best: ' + numbered(i, p.best.line.slice(0, 8), M.ply0));
      if (p.clk != null) parts.push('clock after move ' + fmtClk(p.clk));
      if (p.expect) parts.push('engine expects next: ' + numbered(i + 1, p.expect, M.ply0));
      if (p.facts && p.facts.length) parts.push('board facts: ' + p.facts.join('; '));
      if (p.pgnComment) parts.push('annotator: "' + p.pgnComment.slice(0, 160) + '"');
      parts.push('FEN ' + p.fen);
      return parts.join(' | ');
    });
    return { system, user: head + '\n\nMoves:\n' + lines.join('\n') };
  }
  function parseCommentary(text, N) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error('no JSON in the reply');
    const j = JSON.parse(text.slice(s, e + 1));
    const one = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const out = [];
    if (j.intro) out.push('[INTRO]\n' + one(j.intro));
    (j.comments || []).filter((x) => x && +x.ply >= 1 && +x.ply <= N && x.text).sort((a, b) => a.ply - b.ply).forEach((x) => out.push('[' + +x.ply + '] ' + one(x.text)));
    if (j.conclusion) out.push('[CONCLUSION]\n' + one(j.conclusion));
    if (out.length < 2) throw new Error('the reply had no comments');
    return out.join('\n\n') + '\n';
  }

  // ---------- annotated PGN ----------
  const NB = '\u00a0';
  const NAG_OF = Object.fromEntries(Object.entries(NAG).map(([n, m]) => [m, +n]));
  const pgnEsc = (t) => String(t).replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\s+/g, ' ').trim();
  // a variation as written, on one line: ; comments become { } ones, whitespace collapses (also inside comments)
  function flatVar(raw) {
    let out = '', i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '{') { const j = raw.indexOf('}', i); const e = j < 0 ? raw.length : j; out += '{' + pgnEsc(raw.slice(i + 1, e)) + '}'; i = e + 1; continue; }
      if (ch === ';') { const j = raw.indexOf('\n', i); const e = j < 0 ? raw.length : j; out += ' {' + pgnEsc(raw.slice(i + 1, e)) + '} '; i = e + 1; continue; }
      out += /\s/.test(ch) ? ' ' : ch; i++;
    }
    return out.replace(/ +/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  }
  // clock as h:mm:ss, keeping tenths (Lichess writes them under 10 s)
  const pgnClk = (s) => {
    const t = Math.round(s * 10) / 10, sec = t % 60;
    return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${Number.isInteger(t) ? String(sec).padStart(2, '0') : sec.toFixed(1).padStart(4, '0')}`;
  };
  // the game as PGN: marks and the source's other NAGs, evals and clocks as [%eval]/[%clk], commentary (and
  // Queen's sentence) as comments, the source's variations as written plus the engine's better line on ?!/?/??
  // moves; wrapped at 80 columns
  function annotatedPgn(M) {
    const H = { ...(M.headers || {}) };
    const set = (k, v) => { if (!H[k] && v) H[k] = v; };
    set('Event', M.event || '?'); set('Site', M.site || '?'); set('Date', String(M.pgnDate || '').replace(/-/g, '.') || '????.??.??'); set('Round', M.round || '?');
    set('White', M.white.named ? M.white.name : '?'); set('Black', M.black.named ? M.black.name : '?');
    set('WhiteElo', M.white.elo); set('BlackElo', M.black.elo); set('ECO', M.eco); set('Opening', M.opening);
    H.Result = M.result || '*';
    delete H.SetUp; delete H.FEN;
    if (M.start && M.start.fen !== START_FEN) { H.SetUp = '1'; H.FEN = M.start.fen; }
    const order = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
    const keys = order.filter((k) => H[k] != null).concat(Object.keys(H).filter((k) => !order.includes(k)));
    const head = keys.map((k) => `[${k} "${String(H[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
    const toks = [];
    if (M.intro) toks.push(`{${pgnEsc(M.intro)}}`);
    M.plies.forEach((p, i) => {
      const abs = (M.ply0 || 0) + i, n = Math.floor(abs / 2) + 1;
      // a move number and its move stay on one line (NB is a no-break space until the wrap)
      const num = abs % 2 === 0 ? n + '.' + NB : !i || /[})]$/.test(toks[toks.length - 1]) ? n + '...' + NB : '';
      toks.push(num + p.san);
      (NAG_OF[p.mark] ? [NAG_OF[p.mark]] : []).concat(p.nags || []).forEach((g) => toks.push('$' + g));
      const tags = [];
      if (!p.checkmate && p.mate != null) tags.push(`[%eval #${p.mate}]`);
      else if (!p.checkmate && p.cp != null) tags.push(`[%eval ${(p.cp / 100).toFixed(2)}]`);
      if (p.clk != null) tags.push(`[%clk ${pgnClk(p.clk)}]`);
      const words = tags.concat([p.comment, p.queenText ? 'Queen: ' + p.queenText : ''].filter(Boolean).map(pgnEsc));
      if (words.length) toks.push(`{${words.join(' ')}}`);
      (p.pgnVars || []).forEach((v) => toks.push(flatVar(v)));
      // without an analysis file the better line is the source's first variation, written just above
      const fromPgn = p.pgnVars && M.evalSource !== 'analysis';
      if (!fromPgn && p.best && p.best.line && p.best.line.length && ['inaccuracy', 'mistake', 'blunder'].includes(p.cls)) {
        const before = i ? M.plies[i - 1] : null;
        const line = playLine(before ? before.fen : M.start.fen, p.best.line, before ? before.castle : M.start.pos.castle, before ? before.ep : M.start.pos.ep);
        const v = line.map((m, j) => { const k = abs + j; return (k % 2 === 0 ? Math.floor(k / 2) + 1 + '.' + NB : j === 0 ? Math.floor(k / 2) + 1 + '...' + NB : '') + m.san; });
        if (v.length) toks.push('(' + v.join(' ') + ')');
      }
    });
    if (M.conclusion) toks.push(`{${pgnEsc(M.conclusion)}}`);
    toks.push(H.Result);
    // break on spaces, comments included; a line never starts with % (in column 1 it makes an escape line)
    const lines = []; let cur = '';
    toks.join(' ').split(' ').forEach((w) => {
      if (cur && cur.length + 1 + w.length > 80 && w[0] !== '%') { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return head + '\n\n' + lines.join('\n').replace(/\u00a0/g, ' ') + '\n';
  }

  // castle: the castling rights before the line (the page's FENs don't carry them); omitted = all
  function playLine(fen, sans, castle, ep) {
    let pos = { b: fromFen(fen), ep: ep == null ? -1 : ep, turn: fen.split(' ')[1] || 'w', castle: castle == null ? 'KQkq' : castle };
    const out = [];
    for (const raw of sans) {
      const san = String(raw).replace(/^\d+\.+/, '');
      if (!san) continue;
      let mv;
      try { mv = sanToMove(pos, san); } catch (e) { break; }
      pos = applyMove(pos, mv.from, mv.to, mv.promo);
      const check = inCheck(pos.b, pos.turn);
      out.push({ san, uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || ''), board: pos.b.slice(), checkSq: check ? idxSq(kingIdx(pos.b, pos.turn)) : null, pos });
    }
    return out;
  }

  // ---------- moves the viewer plays on the board ----------
  // castling rights from the FEN's third field; a FEN without one (the page's own) allows every castle
  const posFromFen = (fen) => { const f = fen.split(' '); return { b: fromFen(fen), ep: -1, turn: f[1] || 'w', castle: f[2] == null ? 'KQkq' : f[2].replace('-', '') }; };
  // A legal move from `from` to `to` (square indices, 0 = a8), or null. A pawn reaching the last rank becomes `promo`
  // (q, r, b or n; a queen by default).
  function legalMove(pos, from, to, promo = 'q') {
    const p = pos.b[from];
    if (!p || colorOf(p) !== pos.turn || from === to) return null;
    const t = tOf(p), color = pos.turn, opp = color === 'w' ? 'b' : 'w';
    if (t === 'k' && fy(from) === fy(to) && Math.abs(fx(to) - fx(from)) === 2) {
      const y = color === 'w' ? 7 : 0, king = fx(to) === 6;
      if (fy(from) !== y || fx(from) !== 4 || pos.b[at(king ? 7 : 0, y)] !== (color === 'w' ? 'R' : 'r')) return null;
      const right = color === 'w' ? (king ? 'K' : 'Q') : (king ? 'k' : 'q');
      if (pos.castle != null && !pos.castle.includes(right)) return null;
      if ((king ? [5, 6] : [1, 2, 3]).some((x) => pos.b[at(x, y)])) return null;
      if ([4, king ? 5 : 3, king ? 6 : 2].some((x) => attacked(pos.b, at(x, y), opp))) return null;
    } else if (!canReach(pos.b, from, to, t, color, pos.ep)) return null;
    const pr = t === 'p' && (fy(to) === 0 || fy(to) === 7) ? promo : null;
    if (pr && !'qrbn'.includes(pr)) return null;
    const after = applyMove(pos, from, to, pr);
    return inCheck(after.b, color) ? null : { from, to, promo: pr, after };
  }
  const legalTargets = (pos, from) => { const out = []; for (let to = 0; to < 64; to++) if (legalMove(pos, from, to)) out.push(to); return out; };
  function sanOf(pos, mv) {
    const p = pos.b[mv.from], t = tOf(p), cap = !!pos.b[mv.to] || (t === 'p' && mv.to === pos.ep);
    let san;
    if (t === 'k' && Math.abs(fx(mv.to) - fx(mv.from)) === 2) san = fx(mv.to) === 6 ? 'O-O' : 'O-O-O';
    else if (t === 'p') san = (cap ? FILES[fx(mv.from)] + 'x' : '') + idxSq(mv.to) + (mv.promo ? '=' + mv.promo.toUpperCase() : '');
    else {
      const others = [];
      for (let i = 0; i < 64; i++) if (i !== mv.from && pos.b[i] === p && legalMove(pos, i, mv.to)) others.push(i);
      const dis = !others.length ? '' : !others.some((i) => fx(i) === fx(mv.from)) ? FILES[fx(mv.from)] : !others.some((i) => fy(i) === fy(mv.from)) ? String(8 - fy(mv.from)) : idxSq(mv.from);
      san = t.toUpperCase() + dis + (cap ? 'x' : '') + idxSq(mv.to);
    }
    if (inCheck(mv.after.b, mv.after.turn)) san += hasLegal(mv.after) ? '+' : '#';
    return san;
  }
  // whether the move from `from` to `to` is legal and promotes, so the viewer picks the piece
  const isPromotion = (pos, from, to) => { const mv = legalMove(pos, from, to); return !!(mv && mv.promo); };
  // The viewer's move as a line step (same shape as playLine's), or null when it isn't legal; promo as legalMove's
  function userMove(pos, from, to, promo) {
    const mv = legalMove(pos, from, to, promo);
    if (!mv) return null;
    const check = inCheck(mv.after.b, mv.after.turn);
    return { san: sanOf(pos, mv), uci: idxSq(from) + idxSq(to) + (mv.promo || ''), board: mv.after.b.slice(), checkSq: check ? idxSq(kingIdx(mv.after.b, mv.after.turn)) : null, pos: mv.after };
  }

  // A SAN move → { pos after it, uci }; throws when it isn't legal
  function applySan(pos, san) {
    const mv = sanToMove(pos, san);
    return { pos: applyMove(pos, mv.from, mv.to, mv.promo), uci: idxSq(mv.from) + idxSq(mv.to) + (mv.promo || '') };
  }
  // A UCI move (e2e4, e7e8n) → { pos after it, san }, or null when it isn't legal
  function applyUci(pos, uci) {
    const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci || '');
    if (!m) return null;
    const from = sqIdx(m[1]), to = sqIdx(m[2]), mv = legalMove(pos, from, to);
    if (!mv) return null;
    const promo = mv.promo ? m[3] || 'q' : null;
    const full = promo === mv.promo ? mv : { from, to, promo, after: applyMove(pos, from, to, promo) };
    return { pos: full.after, san: sanOf(pos, full) };
  }

  // A UCI move as a line step (same shape as userMove's), or null when it isn't legal
  function stepFromUci(pos, uci) {
    const r = applyUci(pos, uci);
    if (!r) return null;
    const check = inCheck(r.pos.b, r.pos.turn);
    return { san: r.san, uci, board: r.pos.b.slice(), checkSq: check ? idxSq(kingIdx(r.pos.b, r.pos.turn)) : null, pos: r.pos };
  }

  // move-number gridlines for the eval plot: multiples of `step` among the absolute move numbers, at their offset in plies from the first move
  function evalTicks(ply0, N) {
    const step = N > 120 ? 20 : 10, ticks = [];
    for (let m = step; 2 * m - ply0 <= N; m += step) if (2 * (m - 1) - ply0 >= 0) ticks.push({ m, at: 2 * (m - 1) - ply0 });
    return ticks;
  }
  window.ChessCore = { START_FEN, fmtDate, hasLegal, inCheck, evalTicks, parseFen, fenAfter, moveNo, sqIndex: sqIdx, applySan, applyUci, stepFromUci, toFen, playLine, posFromFen, legalTargets, isPromotion, userMove, commentaryPrompt, parseCommentary, buildGame, withCommentary, commentarySources, classifyFile, plan, timing, schedule, cues, clipRange, winChance, plyCp, MARK_CLASS, annotatedPgn };
})();
