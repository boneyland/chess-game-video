// A game on the free board (Play vs human or vs Stockfish): its clocks, takebacks, resignation, agreed draws, end and the
// critique of the player's moves. A game is a BoardCore board with a game record, board.game = { mode, id, tc, date, clock,
// result } for mode 'human', { mode: 'stockfish', you, id, tc, date, clock, result, critique } against Stockfish: id names it
// in My games (GamesCore), tc a time control ('10+0') or null, clock { left: { w, b } ms at `since`, since: when the side to
// move's clock started (null: stopped), clk: the mover's time left after each move }, result null while the game goes on,
// else { result, reason, side } (side: who resigned or whose flag fell; none for a draw by agreement); you the player's side
// ('w' or 'b'), critique the player's flagged moves [{ j, cls, best }] (j the step, cls inaccuracy, mistake or blunder,
// best Stockfish's move instead, in UCI). Like boards, games are never mutated; `now` is a time in ms.
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

  const TIME_CONTROLS = ['5+0', '10+0', '15+10', '30+0'];
  const parseTc = (tc) => { const m = /^(\d+)\+(\d+)$/.exec(tc || ''); return m ? { base: +m[1] * 60000, inc: +m[2] * 1000 } : null; };
  const B = () => window.BoardCore;
  const other = (side) => (side === 'w' ? 'b' : 'w');
  const inProgress = (b) => !!(b && b.game && !b.game.result);
  const withGame = (b, game) => ({ ...b, game: { ...b.game, ...game } });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

  const isSf = (b) => !!(b && b.game && b.game.mode === 'stockfish');
  // who played step j: the side to move before it, from the positions (a start may have Black to move)
  const moverOf = (b, j) => (j === 0 ? b.start.pos : b.steps[j - 1].pos).turn;
  const CLASSES = ['inaccuracy', 'mistake', 'blunder'];
  const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

  // A new game from the board's start: no moves yet, the clocks full and stopped (they start with the first move).
  // opts { mode: 'human' | 'stockfish', you: 'w' | 'b' } (vs human by default; you only against Stockfish)
  function start(board, tc, date, { mode = 'human', you = 'w' } = {}) {
    const t = parseTc(tc), b = { ...board, steps: [], upto: -1 };
    const clock = t ? { left: { w: t.base, b: t.base }, since: null, clk: [] } : null;
    const head = mode === 'stockfish' ? { mode, you: you === 'b' ? 'b' : 'w' } : { mode: 'human' };
    return { ...b, game: { ...head, id: newId(), tc: t ? tc : null, date: date || today(), clock, result: outcome(b), ...(head.you ? { critique: [] } : {}) } };
  }

  // the side to move's time left at `now`; null without clocks
  function timeLeft(b, side, now) {
    const c = b.game && b.game.clock;
    if (!c) return null;
    return c.left[side] - (c.since != null && side === B().pos(b).turn && !b.game.result ? now - c.since : 0);
  }
  // the clock with the side to move charged up to `now`, and stopped
  const charged = (b, now) => {
    const c = b.game.clock, side = B().pos(b).turn;
    return { ...c, left: { ...c.left, [side]: timeLeft(b, side, now) }, since: null };
  };

  // The side to move out of time: a loss, or a draw when the other side has no mating material. The board as it was otherwise
  function flag(b, now) {
    if (!inProgress(b) || !b.game.clock || b.game.clock.since == null) return b;
    const side = B().pos(b).turn;
    if (timeLeft(b, side, now) > 0) return b;
    const c = charged(b, now), opp = other(side);
    const result = canMate(B().pos(b), opp) ? (opp === 'w' ? '1-0' : '0-1') : '1/2-1/2';
    return withGame(b, { clock: { ...c, left: { ...c.left, [side]: 0 } }, result: { result, reason: 'time', side } });
  }

  // A move in the game, after its last move: the mover's clock is charged and gets the increment, the other side's starts
  function move(b, step, now) {
    if (!inProgress(b)) return b;
    const flagged = flag(b, now);
    if (flagged !== b) return flagged;
    const side = B().pos(b).turn, next = B().play(B().go(b, b.steps.length - 1), step);
    let clock = b.game.clock;
    if (clock) {
      const c = charged(b, now), left = c.left[side] + parseTc(b.game.tc).inc;
      clock = { left: { ...c.left, [side]: left }, since: now, clk: [...c.clk, left] };
    }
    const result = outcome(next);
    if (result && clock) clock = { ...clock, since: null };
    return withGame(next, { clock, result });
  }

  // Whether a takeback can go: in a game in progress, with a move to take back (against Stockfish, one of the player's)
  function canTakeback(b) {
    if (!inProgress(b) || !b.steps.length) return false;
    return !isSf(b) || b.steps.some((s, j) => moverOf(b, j) === b.game.you);
  }

  // The last move taken back, while the game goes on: the time used stays used, the move's increment goes with it,
  // and taking back every move stops the clocks again
  function takeOne(b, now) {
    const flagged = flag(b, now);
    if (flagged !== b) return flagged;
    const prev = { ...b, steps: b.steps.slice(0, -1), upto: b.steps.length - 2 };
    let clock = b.game.clock;
    if (clock) {
      const c = charged(b, now), mover = other(B().pos(b).turn);
      clock = { left: { ...c.left, [mover]: c.left[mover] - parseTc(b.game.tc).inc }, since: prev.steps.length ? now : null, clk: c.clk.slice(0, -1) };
    }
    return withGame(prev, { clock });
  }
  // Against Stockfish, moves go until one of the player's has (its reply and the player's move, or just the player's move
  // while it thinks), so it is the player's turn again; their critique goes with them. A flag fall on the way ends it there
  function takeback(b, now) {
    if (!canTakeback(b)) return b;
    if (!isSf(b)) return takeOne(b, now);
    let x = b;
    for (;;) {
      const mine = moverOf(x, x.steps.length - 1) === x.game.you, y = takeOne(x, now);
      if (y.game.result) return y;
      x = y;
      if (mine) break;
    }
    return withGame(x, { critique: x.game.critique.filter((c) => c.j < x.steps.length) });
  }

  // Stockfish's time for its move: 2 s, or with a clock a share of its time left (and half its increment) capped there,
  // so it never flags; at least 0.1 s
  function thinkMs(b, now) {
    const left = timeLeft(b, other(b.game.you), now);
    if (left == null) return 2000;
    return Math.round(Math.max(100, Math.min(2000, left / 30 + parseTc(b.game.tc).inc / 2)));
  }

  // The board with a player's move flagged ({ j, cls, best }): only in a Stockfish game, for a step still on the board that
  // the player played, once per step; the board as it was otherwise. A rating that lands after the end still counts
  function addCritique(b, e) {
    if (!isSf(b) || !e || !Number.isInteger(e.j) || e.j < 0 || e.j >= b.steps.length || moverOf(b, e.j) !== b.game.you) return b;
    if (!CLASSES.includes(e.cls) || b.game.critique.some((c) => c.j === e.j)) return b;
    return withGame(b, { critique: [...b.game.critique, { j: e.j, cls: e.cls, best: e.best }] });
  }

  // A short line on why the player's move was bad, without the better move: pos the position after it, pv Stockfish's reply
  // line (UCI). When the line's first four plies win the player's material net, the most valuable piece taken is named;
  // else a mate against the player; else a line for the class
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const PIECE = { p: 'a pawn', n: 'the knight', b: 'the bishop', r: 'the rook', q: 'the queen' };
  function critiqueText(pos, pv, you, cls, mateAgainst) {
    let p = pos, lost = 0, won = 0, top = null;
    for (const u of (pv || []).slice(0, 4)) {
      const m = /^([a-h][1-8])([a-h][1-8])/.exec(u || ''), r = m && CC().applyUci(p, u);
      if (!r) break;
      const from = CC().sqIndex(m[1]), to = CC().sqIndex(m[2]), mover = p.b[from];
      // en passant: a pawn moving sideways onto an empty square
      const taken = p.b[to] || (mover.toLowerCase() === 'p' && from % 8 !== to % 8 ? (p.turn === 'w' ? 'p' : 'P') : null);
      if (taken) {
        const t = taken.toLowerCase(), v = VALUE[t] || 0;
        if (colorOf(taken) === you) { lost += v; if (!top || v > VALUE[top]) top = t; } else won += v;
      }
      p = r.pos;
    }
    if (lost > won && top) return 'that drops ' + PIECE[top];
    if (mateAgainst) return 'that allows mate';
    return { inaccuracy: 'there was a better move', mistake: 'that gives Stockfish the edge', blunder: 'that should lose' }[cls] || '';
  }

  // The side to move resigns
  function resign(b, now) {
    if (!inProgress(b)) return b;
    const side = B().pos(b).turn;
    return withGame(b, { clock: b.game.clock && charged(b, now), result: { result: side === 'w' ? '0-1' : '1-0', reason: 'resign', side } });
  }

  // A draw both players agree to
  function agreeDraw(b, now) {
    if (!inProgress(b)) return b;
    return withGame(b, { clock: b.game.clock && charged(b, now), result: { result: '1/2-1/2', reason: 'agreement' } });
  }

  // The result for people: the score and why
  const NAME = { w: 'White', b: 'Black' };
  function resultText(r) {
    const score = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' }[r.result];
    const why = {
      checkmate: 'Checkmate', stalemate: 'Stalemate', repetition: 'Draw by threefold repetition', fifty: 'Draw by the fifty-move rule',
      material: 'Draw: neither side can mate', agreement: 'Draw by agreement', resign: `${NAME[r.side]} resigned`,
      time: r.result === '1/2-1/2' ? `${NAME[r.side]}’s flag fell, but ${NAME[other(r.side)]} can’t mate` : `${NAME[r.side]}’s flag fell`,
    }[r.reason];
    return { score, why };
  }

  // A stored game back on its board (BoardCore.restore): whatever localStorage held, a game that plays on. The clocks
  // are paused (the time away isn't charged; they run again from the next move), clk fits the moves, and the result
  // comes from the moves unless it was a resignation, a flag fall or an agreed draw. A game stored without an id gets one
  function resume(board, g) {
    if (!g || typeof g !== 'object' || (g.mode !== 'human' && g.mode !== 'stockfish')) return board;
    const tc = TIME_CONTROLS.includes(g.tc) ? g.tc : null, t = parseTc(tc), n = board.steps.length;
    let clock = null;
    if (t) {
      const c = g.clock || {}, ms = (x) => (Number.isFinite(x) ? Math.max(0, x) : t.base);
      clock = { left: { w: ms(c.left && c.left.w), b: ms(c.left && c.left.b) }, since: null, clk: (Array.isArray(c.clk) ? c.clk : []).filter(Number.isFinite).slice(0, n) };
    }
    const r = g.result, kept = !r ? null : r.reason === 'agreement' && r.result === '1/2-1/2' ? { result: r.result, reason: r.reason }
      : ['resign', 'time'].includes(r.reason) && ['1-0', '0-1', '1/2-1/2'].includes(r.result) && (r.side === 'w' || r.side === 'b') ? { result: r.result, reason: r.reason, side: r.side } : null;
    const result = kept || outcome(board);
    const b = result ? board : B().go(board, n - 1);
    const id = typeof g.id === 'string' && /^[\w-]{1,40}$/.test(g.id) ? g.id : newId();
    const date = typeof g.date === 'string' && /^\d{4}\.\d\d\.\d\d$/.test(g.date) ? g.date : today();
    if (g.mode === 'human') return { ...b, game: { mode: 'human', id, tc, date, clock, result } };
    // a flagged move must still be one of the player's on the board, once each
    const you = g.you === 'b' ? 'b' : 'w', seen = new Set();
    const critique = (Array.isArray(g.critique) ? g.critique : []).filter((c) => c && Number.isInteger(c.j) && c.j >= 0 && c.j < n && moverOf(board, c.j) === you
      && CLASSES.includes(c.cls) && typeof c.best === 'string' && UCI_RE.test(c.best) && !seen.has(c.j) && seen.add(c.j)).map((c) => ({ j: c.j, cls: c.cls, best: c.best }));
    return { ...b, game: { mode: 'stockfish', you, id, tc, date, clock, result, critique } };
  }

  // The game as a PGN (for saving, step 4 of the free-board design): the result, the start when it isn't the standard
  // one, the time control and each move's clock
  function pgn(b) {
    const g = b.game, t = parseTc(g.tc), res = g.result ? g.result.result : '*';
    const sf = g.mode === 'stockfish', name = (side) => (!sf ? NAME[side] : side === g.you ? 'You' : 'Stockfish 19');
    const tags = [['Event', sf ? 'Play vs Stockfish' : 'Play vs human'], ['Site', 'chess-replay'], ['Date', g.date], ['White', name('w')], ['Black', name('b')], ['Result', res]];
    if (b.fen !== CC().START_FEN) tags.push(['SetUp', '1'], ['FEN', b.fen]);
    if (t) tags.push(['TimeControl', `${t.base / 1000}+${t.inc / 1000}`]);
    if (g.result) tags.push(['Termination', g.result.reason === 'time' ? 'time forfeit' : 'normal']);
    const clk = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const moves = b.steps.map((s, j) => {
      const ply = b.start.ply0 + j, n = Math.floor(ply / 2) + 1;
      const no = ply % 2 === 0 ? `${n}. ` : j === 0 || (t && g.clock.clk[j - 1] != null) ? `${n}... ` : '';
      return no + s.san + (t && g.clock.clk[j] != null ? ` { [%clk ${clk(g.clock.clk[j])}] }` : '');
    });
    return tags.map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n' + moves.concat(res).join(' ') + '\n';
  }

  window.PlayCore = {
    canMate, positionKey, outcome, TIME_CONTROLS, parseTc, start, inProgress, move, canTakeback, takeback, thinkMs, addCritique, critiqueText,
    resign, agreeDraw, flag, timeLeft, resultText, resume, pgn,
  };
})();
