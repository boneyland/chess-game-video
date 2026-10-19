// A free board's state: a start position, the moves played from it and the move shown. Boards are plain
// objects { fen, start: { pos, ply0 }, steps, upto }, never mutated; steps are ChessCore line steps and
// upto is the index of the step shown (-1 for the start). Moves after upto stay until a new move replaces them.
(function () {
  const CC = () => window.ChessCore;
  const clamp = (b, upto) => Math.max(-1, Math.min(b.steps.length - 1, Math.floor(Number(upto)) || 0));

  // Pasted text as a FEN: trimmed, a PGN tag [FEN "…"] unwrapped, runs of spaces collapsed; parseFen's messages pass on
  function fenFromInput(text) {
    let t = String(text == null ? '' : text).trim();
    const tag = /^\[\s*FEN\s+"([^"]*)"\s*\]$/i.exec(t);
    if (tag) t = tag[1].trim();
    t = t.replace(/\s+/g, ' ');
    if (!t) throw new Error('Paste a FEN first');
    return CC().parseFen(t).fen;
  }

  function fromFen(fen) {
    const s = CC().parseFen(fen == null ? CC().START_FEN : fen);
    return { fen: s.fen, start: { pos: s.pos, ply0: s.ply0 }, steps: [], upto: -1 };
  }

  const pos = (b) => (b.upto >= 0 ? b.steps[b.upto].pos : b.start.pos);
  const ucis = (b, n = b.upto + 1) => b.steps.slice(0, Math.max(0, n)).map((s) => s.uci);
  const label = (b, j) => CC().moveNo(b.start.ply0 + j) + ' ' + b.steps[j].san;
  const play = (b, step) => ({ ...b, steps: [...b.steps.slice(0, b.upto + 1), step], upto: b.upto + 1 });
  const go = (b, upto) => ({ ...b, upto: clamp(b, upto) });
  const save = (b) => ({ fen: b.fen, moves: b.steps.map((s) => s.uci), upto: b.upto });

  // A stored board back: the legal prefix of its moves, upto clamped (a missing one shows the last move);
  // null when the FEN doesn't parse. Never throws, whatever localStorage held.
  function restore(saved) {
    try {
      if (!saved || typeof saved !== 'object' || typeof saved.fen !== 'string') return null;
      let b = fromFen(saved.fen);
      for (const u of Array.isArray(saved.moves) ? saved.moves : []) {
        let step = null;
        try { step = typeof u === 'string' ? CC().stepFromUci(pos(b), u) : null; } catch (e) {}
        if (!step) break;
        b = play(b, step);
      }
      return go(b, typeof saved.upto === 'number' ? saved.upto : b.steps.length - 1);
    } catch (e) {
      return null;
    }
  }

  window.BoardCore = { fenFromInput, fromFen, restore, save, play, go, pos, ucis, label };
})();
