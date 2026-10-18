// Opening names from Lichess's chess-openings data (window.OPENINGS_TSV), ported from chess_openings.py.
// Positions are matched rather than move orders, so a game that transposes into a named line still gets
// its name; a position that isn't named itself takes the deepest named position before it on its line.
(function () {
  const CC = () => window.ChessCore;
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
  const HOME = { e1: 'KQ', e8: 'kq', h1: 'K', a1: 'Q', h8: 'k', a8: 'q' };
  const FILES = 'abcdefgh';
  const sq = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));

  // A line of moves from the start, with each position's key: placement, side to move, castling rights
  // and the en-passant square only when a capture there is legal (python-chess's epd())
  function tracker(startFen) {
    const from = startFen ? CC().parseFen(startFen) : null;
    let pos = from ? from.pos : CC().posFromFen(START), rights = from ? from.fen.split(' ')[2].replace('-', '') : 'KQkq';
    const key = () => {
      let ep = '-';
      if (pos.ep >= 0) {
        const pawn = pos.turn === 'w' ? 'P' : 'p', row = pos.turn === 'w' ? 1 : -1; // capturing pawns stand one rank behind the ep square
        for (const dx of [-1, 1]) {
          const x = (pos.ep % 8) + dx, from = pos.ep + row * 8 + dx;
          if (x >= 0 && x < 8 && pos.b[from] === pawn && CC().applyUci(pos, sq(from) + sq(pos.ep))) { ep = sq(pos.ep); break; }
        }
      }
      return CC().toFen(pos) + ' ' + (rights || '-') + ' ' + ep;
    };
    const lose = (s) => { if (HOME[s]) rights = rights.replace(new RegExp('[' + HOME[s] + ']', 'g'), ''); };
    return {
      key,
      san(s) { const r = CC().applySan(pos, s); lose(r.uci.slice(0, 2)); lose(r.uci.slice(2, 4)); pos = r.pos; return key(); },
      uci(u) { const r = CC().applyUci(pos, u); if (!r) return null; lose(u.slice(0, 2)); lose(u.slice(2, 4)); pos = r.pos; return key(); },
    };
  }

  function build() {
    const lines = [], named = new Map();
    for (const row of (window.OPENINGS_TSV || '').split('\n')) {
      if (!row) continue;
      const [eco, name, pgn] = row.split('\t'), t = tracker(), line = [];
      for (const tok of pgn.split(/\s+/)) if (tok && !/^\d/.test(tok)) line.push(t.san(tok));
      lines.push(line);
      named.set(line[line.length - 1], { eco, name });
    }
    const deepest = new Map();
    for (const line of lines) {
      let last = null;
      line.forEach((k, i) => {
        if (named.has(k)) last = [i + 1, named.get(k)];
        if (last && (!deepest.has(k) || last[0] > deepest.get(k)[0])) deepest.set(k, last);
      });
    }
    const table = new Map([...deepest].map(([k, v]) => [k, v[1]]));
    const byPly = (ucis, startFen) => {
      const t = tracker(startFen), out = [];
      let ok = true;
      for (const u of ucis) {
        const k = ok ? t.uci(u) : null;
        if (k === null) ok = false;
        out.push(k !== null && table.has(k) ? table.get(k) : null);
      }
      return out;
    };
    return { byPly, identify: (ucis, startFen) => byPly(ucis, startFen).filter(Boolean).pop() || null, size: table.size };
  }

  let cached = null;
  // The book, built on first use and kept for the session; { fresh: true } rebuilds it (for timing)
  function book(opts) { if (!cached || (opts && opts.fresh)) cached = build(); return cached; }

  // The book key of the position after these moves (for tests): python-chess epd() fields
  function positionKey(ucis) { const t = tracker(); let k = t.key(); for (const u of ucis) k = t.uci(u); return k; }

  window.Openings = { book, positionKey };
})();
