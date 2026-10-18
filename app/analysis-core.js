// Stockfish analysis in the browser: the rating, accuracy and JSON rules of chess_game_analyzer.py, ported.
// Evals are centipawns from White's point of view; a mate in N is ±(10000 − 10·N), as in _eval_to_cp.
(function () {
  const C = {
    WIN_CHANCES_K: 0.00368208, BEST_MAX_LOSS_CP: 5,
    WIN_DROP_INACCURACY: 0.10, WIN_DROP_MISTAKE: 0.20, WIN_DROP_BLUNDER: 0.30,
    MAX_EVAL_LOSS_FOR_ACCURACY: 1500,
    MATE_SCORE_CP: 10000, MATE_STEP_CP: 10, MATE_BAND_CP: 1000,
    MATE_INACCURACY_CP: 999, MATE_MISTAKE_CP: 700,
    MATE_CREATED: 'Checkmate is now unavoidable', MATE_LOST: 'Lost forced checkmate sequence', MATE_DELAYED: 'Not the best checkmate sequence',
    MATE_LINE_MAX_PLIES: 9, BEST_LINE_MAX_PLIES: 12,
  };
  const winningChances = (cp) => 2 / (1 + Math.exp(-C.WIN_CHANCES_K * cp)) - 1;

  // A UCI info line with a score → { cp (White POV), depth, pv } ; null for other lines and bound-only scores
  function infoToScore(line, sideToMove) {
    if (!/^info\b/.test(line) || !/\sscore\s/.test(line) || /\s(lowerbound|upperbound)\b/.test(line)) return null;
    const cp = line.match(/\sscore cp (-?\d+)/), mate = line.match(/\sscore mate (-?\d+)/);
    let v;
    if (cp) v = +cp[1];
    else if (mate) { const n = +mate[1]; v = n > 0 ? C.MATE_SCORE_CP - C.MATE_STEP_CP * n : -(C.MATE_SCORE_CP - C.MATE_STEP_CP * Math.abs(n)); }
    else return null;
    const depth = line.match(/\sdepth (\d+)/), pv = line.match(/\spv (.+)$/), nodes = line.match(/\snodes (\d+)/), time = line.match(/\stime (\d+)/);
    return { cp: sideToMove === 'w' ? v : -v, depth: depth ? +depth[1] : 0, pv: pv ? pv[1].trim().split(/\s+/) : [], nodes: nodes ? +nodes[1] : null, timeMs: time ? +time[1] : null };
  }

  // How far a search has got, from any info line with a depth (bound-only lines included): depth, nodes, time
  function infoStats(line) {
    const depth = /^info\b/.test(line) && line.match(/\sdepth (\d+)/);
    if (!depth) return null;
    const nodes = line.match(/\snodes (\d+)/), time = line.match(/\stime (\d+)/);
    return { depth: +depth[1], nodes: nodes ? +nodes[1] : null, timeMs: time ? +time[1] : null };
  }

  function classifyMove(evalLoss, winDrop) {
    if (evalLoss < C.BEST_MAX_LOSS_CP) return 'best';
    if (winDrop < C.WIN_DROP_INACCURACY) return '';
    if (winDrop < C.WIN_DROP_MISTAKE) return 'inaccuracy';
    if (winDrop < C.WIN_DROP_BLUNDER) return 'mistake';
    return 'blunder';
  }

  // Lichess's mate rules from the mover's point of view → [classification or null, advice]
  function mateAdvice(bestEval, currentEval, isWhite) {
    const sign = isWhite ? 1 : -1, before = sign * bestEval, after = sign * currentEval;
    const zone = C.MATE_SCORE_CP - C.MATE_BAND_CP;
    const hadMate = before >= zone, hasMate = after >= zone, wasMated = before <= -zone, isMated = after <= -zone;
    if (hadMate && !hasMate) return [after > C.MATE_INACCURACY_CP ? 'inaccuracy' : after > C.MATE_MISTAKE_CP ? 'mistake' : 'blunder', C.MATE_LOST];
    if (isMated && !(hadMate || wasMated)) return [before < -C.MATE_INACCURACY_CP ? 'inaccuracy' : before < -C.MATE_MISTAKE_CP ? 'mistake' : 'blunder', C.MATE_CREATED];
    if (hadMate && hasMate && after < before + C.MATE_STEP_CP) return ['', C.MATE_DELAYED];
    return [null, ''];
  }

  // One move: bestEval is the search before it, currentEval the search after it (analyze_game, steps D–E)
  function rateMove({ bestEval, currentEval, isWhite, playedIsBest, isCheckmate }) {
    const sign = isWhite ? 1 : -1;
    let bestAfter = bestEval;
    if (sign * bestEval >= C.MATE_SCORE_CP - C.MATE_BAND_CP) bestAfter += sign * C.MATE_STEP_CP;
    let raw = Math.max(0, isWhite ? bestAfter - currentEval : currentEval - bestAfter);
    if (playedIsBest) raw = 0;
    const evalLoss = Math.min(raw, C.MAX_EVAL_LOSS_FOR_ACCURACY);
    const winDrop = sign * (winningChances(bestEval) - winningChances(currentEval));
    let classification = classifyMove(evalLoss, Math.max(0, winDrop)), advice = '';
    if (!playedIsBest && !isCheckmate) {
      const [cls, adv] = mateAdvice(bestEval, currentEval, isWhite);
      if (cls !== null) classification = cls;
      advice = adv;
    }
    return { evalLoss, classification, mateAdvice: advice };
  }

  // "Mate in N: …" for a lost or delayed mate, from the line the mover had (pvSans starts with the mover's move)
  function mateLine(beforeEval, pvSans) {
    const n = Math.round((C.MATE_SCORE_CP - Math.abs(beforeEval)) / C.MATE_STEP_CP);
    let s = `Mate in ${n}: ${pvSans.slice(0, Math.min(2 * n - 1, C.MATE_LINE_MAX_PLIES)).join(' ')}`;
    if (2 * n - 1 > C.MATE_LINE_MAX_PLIES) s += ' ...';
    return s;
  }

  // _calculate_player_stats
  function playerStats(moves) {
    if (!moves.length) return { total_moves: 0, accuracy: 0, avg_centipawn_loss: 0, best_moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0 };
    const avg = moves.reduce((s, m) => s + m.eval_loss, 0) / moves.length;
    const n = (c) => moves.filter((m) => m.classification === c).length;
    return {
      total_moves: moves.length, avg_centipawn_loss: avg,
      accuracy: avg > 0 ? Math.max(0, 100 * Math.exp(-0.005 * avg)) : 100,
      best_moves: n('best'), inaccuracies: n('inaccuracy'), mistakes: n('mistake'), blunders: n('blunder'),
    };
  }

  const MISSING_OPENING = ['', '?', 'Unknown'];
  const MOVE_DEFAULTS = { is_capture: false, is_check: false, material_balance: 0, fen_after: '', pv_line: [], alternative_moves: [], mate_advice: '', mate_line: '', search_depth: 0, search_depth_after: 0, search_lines: 1, best_line: [] };

  // The JSON run_animator.py --analyze writes. opening: the book's {eco, name}, used when the PGN names none.
  function buildAnalysisJson({ headers, moves, opening, engine, startFen }) {
    const H = headers || {};
    const hasOpening = !MISSING_OPENING.includes(H.Opening || '');
    const elo = (v) => (/^\d+$/.test(v || '') ? v : '');
    const full = moves.map((m) => ({ ...MOVE_DEFAULTS, ...m }));
    return {
      white: H.White || 'Unknown', black: H.Black || 'Unknown',
      white_elo: elo(H.WhiteElo), black_elo: elo(H.BlackElo),
      event: H.Event || 'Unknown', site: H.Site || 'Unknown', date: H.Date || '????.??.??', round_num: H.Round || '?', result: H.Result || '*',
      opening_name: hasOpening ? H.Opening : opening ? opening.name : '',
      opening_eco: hasOpening ? H.ECO || '' : opening ? opening.eco : '',
      moves: full,
      white_stats: { accuracy: playerStats(full.filter((m) => m.is_white_move)).accuracy },
      black_stats: { accuracy: playerStats(full.filter((m) => !m.is_white_move)).accuracy },
      engine,
      ...(startFen && startFen !== window.ChessCore.START_FEN ? { start_fen: startFen } : {}),
    };
  }

  // A search's best move: the first move of the line it reports (as Python's pv[0]); a search cut short can
  // end on a bestmove token that isn't the start of its last complete line
  const bestOf = (r) => (r && r.pv && r.pv[0]) || (r && r.best) || null;

  const ENGINE = { name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 };
  // The engine settings a viewer can change (Settings → Engine), from the saved tweaks, kept in range; anything
  // missing or out of range falls back to the default. game: as ENGINE (written into the analysis JSON); own: the
  // search of the viewer's own moves
  const SEARCH_LIMITS = { depth: [16, 30], seconds: [0.5, 10] }, HASH_MB = [16, 32, 64, 128, 256];
  const OWN = { depth: 24, time_limit: 3 };
  function engineSettings(t = {}) {
    const pick = (v, [lo, hi], step, dflt) => { const x = +v; return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x / step) * step : dflt; };
    return {
      game: { ...ENGINE, depth: pick(t.sfDepth, SEARCH_LIMITS.depth, 1, ENGINE.depth), time_limit: pick(t.sfTime, SEARCH_LIMITS.seconds, 0.5, ENGINE.time_limit), hash_mb: HASH_MB.includes(+t.sfHash) ? +t.sfHash : ENGINE.hash_mb },
      own: { depth: pick(t.sfOwnDepth, SEARCH_LIMITS.depth, 1, OWN.depth), time_limit: pick(t.sfOwnTime, SEARCH_LIMITS.seconds, 0.5, OWN.time_limit) },
    };
  }
  // Rough seconds a game position takes: 1.3 s measured on a laptop at depth 22 / 3 s, each depth about 1.45 times
  // the one before, never more than the time limit. Only the first estimate; a run measures its own pace
  const secondsPerPosition = (g) => Math.min(g.time_limit, 1.3 * Math.pow(1.45, g.depth - 22));

  // A line of uci moves from pos → its SANs, stopping at the first illegal move
  function sansOf(pos, ucis, max) {
    const out = [];
    for (const u of ucis.slice(0, max)) { const r = window.ChessCore.applyUci(pos, u); if (!r) break; out.push(r.san); pos = r.pos; }
    return out;
  }

  // Analyse every position of a game (ucis/sans from the start, or from startFen; the JSON then records it as start_fen), as analyze_game does: the search after a
  // move is also the search before the next one. Returns the --analyze JSON, or null when signal.aborted.
  // earlier: searches of the first positions from a run that stopped, to resume from; onSearched gets every
  // search so far after each new one, so a run that stops can be resumed
  // settings: the engine settings to search with and to record (engineSettings().game)
  async function runAnalysis({ engine, ucis, sans, headers, signal, onProgress, earlier = [], onSearched, settings = ENGINE, startFen = window.ChessCore.START_FEN }) {
    const N = ucis.length, R = earlier.slice(0, N + 1);
    onProgress(Math.max(0, R.length - 1), N);
    for (let k = R.length; k <= N; k++) {
      if (signal.aborted) return null;
      const r = await engine.search({ moves: ucis.slice(0, k), fen: startFen, depth: settings.depth, movetimeMs: settings.time_limit * 1000, priority: 'game' }).promise;
      if (signal.aborted) return null;
      if (!r || r.cp == null) throw new Error('Stockfish stopped before the analysis finished');
      R.push(r);
      if (onSearched) onSearched(R.slice());
      if (k > 0) onProgress(k, N);
    }
    const CC = window.ChessCore;
    let pos = CC.parseFen(startFen).pos;
    const moves = ucis.map((uci, i) => {
      const before = R[i], after = R[i + 1], isWhite = pos.turn === 'w', best = bestOf(before);
      const played = CC.applyUci(pos, uci);
      const san = played ? played.san : sans[i];
      const bestLine = sansOf(pos, before.pv, C.BEST_LINE_MAX_PLIES);
      const rated = rateMove({ bestEval: before.cp, currentEval: after.cp, isWhite, playedIsBest: uci === best, isCheckmate: san.endsWith('#') });
      const m = {
        ply: i + 1, move_san: san, move_uci: uci, is_white_move: isWhite,
        eval_before: before.cp, eval_after: after.cp,
        best_move_san: best ? sansOf(pos, [best], 1)[0] || '-' : '-', best_move_uci: best || '-',
        best_eval: before.cp, eval_loss: rated.evalLoss, classification: rated.classification,
        is_capture: san.includes('x'), is_check: /[+#]$/.test(san),
        pv_line: played ? sansOf(played.pos, after.pv, 3) : [],
        mate_advice: rated.mateAdvice,
        mate_line: rated.mateAdvice === C.MATE_LOST || rated.mateAdvice === C.MATE_DELAYED ? mateLine(before.cp, bestLine) : '',
        search_depth: before.depth, search_depth_after: after.depth, search_lines: 1, best_line: bestLine,
        // what the search of the position after the move actually did (the Python video ignores these)
        search_maxdepth_after: after.maxDepth == null ? after.depth : after.maxDepth, search_time_after_ms: after.timeMs, search_nodes_after: after.nodes,
      };
      if (played) pos = played.pos;
      return m;
    });
    return buildAnalysisJson({ headers, moves, opening: window.Openings ? window.Openings.book().identify(ucis) : null, engine: { ...settings }, startFen });
  }

  window.AnalysisCore = { C, ENGINE, SEARCH_LIMITS, HASH_MB, engineSettings, secondsPerPosition, bestOf, winningChances, infoToScore, infoStats, rateMove, mateLine, playerStats, buildAnalysisJson, runAnalysis };
})();
