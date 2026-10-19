// A game on the free board (Play vs human): when it ends. A game is a BoardCore board whose moves are the game's.
(function () {
  const CC = () => window.ChessCore;
  const sqColor = (i) => ((i % 8) + Math.floor(i / 8)) % 2; // a8 (0) is light: 0 light, 1 dark
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

  // Whether `color` has the material to mate at all: not with a lone king, nor a king and one minor piece against a lone
  // king, nor when the only pieces besides the kings are bishops all on squares of one colour
  function canMate(pos, color) {
    const own = [], all = [];
    pos.b.forEach((p, i) => { if (p && p.toLowerCase() !== 'k') { all.push({ t: p.toLowerCase(), i }); if (colorOf(p) === color) own.push(p.toLowerCase()); } });
    if (!own.length) return false;
    if (all.every((x) => x.t === 'b') && new Set(all.map((x) => sqColor(x.i))).size === 1) return false;
    return !(own.length === 1 && (own[0] === 'n' || own[0] === 'b') && all.length === 1);
  }

  // A position for repetition: the pieces, the side to move, the castling rights, and the en-passant square only when a
  // pawn of the side to move can take there
  function positionKey(pos) {
    let ep = '-';
    if (pos.ep >= 0) {
      const pawn = pos.turn === 'w' ? 'P' : 'p';
      for (let i = 0; i < 64 && ep === '-'; i++) if (pos.b[i] === pawn && CC().legalTargets(pos, i).includes(pos.ep)) ep = String(pos.ep);
    }
    return CC().toFen(pos) + ' ' + (pos.castle || '-') + ' ' + ep;
  }

  // The end of the game in the position after the board's last move, or null while it goes on
  function outcome(board) {
    const steps = board.steps, last = steps.length ? steps[steps.length - 1] : null, pos = last ? last.pos : board.start.pos;
    if (!CC().hasLegal(pos)) {
      if (CC().inCheck(pos.b, pos.turn)) return { result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
      return { result: '1/2-1/2', reason: 'stalemate' };
    }
    const draw = (reason) => ({ result: '1/2-1/2', reason });
    if (!canMate(pos, 'w') && !canMate(pos, 'b')) return draw('material');
    let half = +board.fen.split(' ')[4] || 0;
    for (const s of steps) half = /^[a-h]/.test(s.san) || s.san.includes('x') ? 0 : half + 1;
    if (half >= 100) return draw('fifty');
    const key = positionKey(pos);
    let seen = positionKey(board.start.pos) === key ? 1 : 0;
    for (const s of steps) if (positionKey(s.pos) === key) seen++;
    return seen >= 3 ? draw('repetition') : null;
  }

  window.PlayCore = { canMate, positionKey, outcome };
})();
