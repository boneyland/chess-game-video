const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js');
const CC = window.ChessCore;
const PGN = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 *';
const analysis = (engine) => ({ white: 'A', black: 'B', engine, moves: [
  { ply: 1, move_san: 'e4', move_uci: 'e2e4', eval_before: 20, eval_after: 30, classification: 'best', eval_loss: 0, best_move_uci: 'e2e4', best_line: ['e4'] },
  { ply: 2, move_san: 'e5', move_uci: 'e7e5', eval_before: 30, eval_after: 25, classification: 'best', eval_loss: 0, best_move_uci: 'e7e5', best_line: ['e5'] }] });

test('engine label for a depth search with a time cap reads like describe_search', () => {
  const M = CC.buildGame({ pgn: PGN, analysis: analysis({ name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 }) });
  assert.equal(M.engine, 'Stockfish 19 lite (browser) · depth 22, max 3s per position');
});

test('engine label for a timed native search is unchanged', () => {
  const M = CC.buildGame({ pgn: PGN, analysis: analysis({ name: 'Stockfish 19', depth: null, time_limit: 4, lines: 1, threads: 7, hash_mb: 256 }) });
  assert.equal(M.engine, 'Stockfish 19 · 4s per position · 1 line · 7 threads');
});

test('a game without evals that ends in checkmate has no evals', () => {
  const M = CC.buildGame({ pgn: '[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0' });
  assert.equal(M.plies[6].checkmate, true);
  assert.equal(M.hasEval, false);
});

test('stepFromUci builds a line step like userMove, keeping under-promotion', () => {
  const s = CC.stepFromUci(CC.posFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'), 'e2e4');
  assert.equal(s.san, 'e4');
  assert.equal(s.uci, 'e2e4');
  assert.equal(s.pos.turn, 'b');
  assert.equal(s.board.length, 64);
  assert.equal(s.checkSq, null);
  const p = CC.stepFromUci(CC.posFromFen('8/P5k1/8/8/8/8/8/4K3 w'), 'a7a8n');
  assert.equal(p.san, 'a8=N');
  assert.equal(p.board[0], 'N');
  assert.equal(CC.stepFromUci(CC.posFromFen('8/8/8/8/8/8/8/4K2k w'), 'e1e5'), null);
});

test('buildGame names the opening from the book when the PGN has none', () => {
  window.OPENINGS_TSV = require('../openings-data.cjs').openingsTsv();
  loadUnit('openings-core.js');
  const M = CC.buildGame({ pgn: '[White "A"]\n[Black "B"]\n[Opening "?"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0' });
  assert.equal(M.opening, "King's Pawn Game: Wayward Queen Attack");
  assert.equal(M.eco, 'C20');
  const named = CC.buildGame({ pgn: '[ECO "B00"]\n[Opening "My name"]\n\n1. e4 e5 *' });
  assert.equal(named.opening, 'My name');
});

test('castling needs the right: lost after the rook or king has moved', () => {
  let pos = CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w K');
  assert.ok(CC.applyUci(pos, 'e1g1'), 'O-O with the right');
  for (const u of ['h1g1', 'e8d8', 'g1h1', 'd8e8']) pos = CC.applyUci(pos, u).pos;
  assert.equal(CC.applyUci(pos, 'e1g1'), null);
  assert.ok(!CC.legalTargets(pos, CC.sqIndex('e1')).includes(CC.sqIndex('g1')));
  assert.equal(CC.applyUci(CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w -'), 'e1g1'), null);
});

test('game positions carry castling rights from the moves played', () => {
  const M = CC.buildGame({ pgn: '1. Nf3 Nf6 2. Rg1 Rg8 3. Rh1 Rh8 *' });
  assert.equal(M.plies[5].castle, 'Qq');
  assert.equal(M.plies[0].castle, 'KQkq');
});

test('playLine keeps the castling rights it is given', () => {
  const steps = CC.playLine('4k3/8/8/8/8/8/8/4K2R w', ['Rg1', 'Kd8', 'Rh1', 'Ke8'], 'K');
  assert.equal(steps[3].pos.castle, '');
  assert.equal(CC.applyUci(steps[3].pos, 'e1g1'), null);
  assert.ok(CC.applyUci(CC.playLine('4k3/8/8/8/8/8/8/4K2R w', ['Kf1', 'Kd8'], 'K')[0].pos, 'e8d7')); // sanity: lines still play
});

test('buildGame keeps the actual search stats of each move', () => {
  const A = analysis({ name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 });
  Object.assign(A.moves[0], { search_depth_after: 21, search_maxdepth_after: 22, search_time_after_ms: 1432, search_nodes_after: 812345 });
  const M = CC.buildGame({ pgn: PGN, analysis: A });
  assert.deepEqual(M.plies[0].search, { depth: 21, maxDepth: 22, timeMs: 1432, nodes: 812345 });
  assert.equal(M.plies[1].search, undefined);
  assert.equal(M.engineName, 'Stockfish 19 lite (browser)');
});

test('analysis mate scores keep their distance (±(10000 − 10·N) is mate in N)', () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, 'fixtures');
  const M = CC.buildGame({ pgn: fs.readFileSync(path.join(dir, 'byrne-fischer.pgn'), 'utf8'), analysis: fs.readFileSync(path.join(dir, 'byrne-fischer_analysis.json'), 'utf8') });
  const at = (san) => M.plies.findLast((p) => p.san === san); // the final mating sequence
  assert.equal(at('Kd1').mate, -4);   // eval_after -9960
  assert.equal(at('Bb3+').mate, -3);  // -9970
  assert.equal(at('Nc3+').mate, -1);  // -9990
  assert.equal(at('Rc2#').checkmate, true);
});

// formats from cutechess's MoveEvaluation::scoreText and evalString: M is plies to mate (UCI mate 3 → +M5, mate -2 → -M4)
test('cutechess engine comments give evals, turned to White’s point of view', () => {
  const M = CC.buildGame({ pgn: '[Result "*"]\n\n1. e4 {book} e5 {book} 2. Nf3 {+0.31/20 1.2s} Nc6 {-0.25/18 0.95s} 3. Bc4 {-M4/12 0.081s} Nf6 {+M5/30 2.0s Book exit} 4. d3 {0.00/1 0s} *' });
  assert.deepEqual(M.plies.map((p) => p.cp ?? (p.mate != null ? 'M' + p.mate : null)), [null, null, 31, 25, 'M-2', 'M-3', 0]);
  assert.ok(!M.plies[0].comment);
  assert.equal(M.hasEval, true);
});

test('an engine comment is not shown as commentary, the text after it is', () => {
  const P = CC.buildGame({ pgn: '[Result "*"]\n\n1. e4 {+0.31/20 1.2s Book exit} e5 {Played 1/2 the time} *' });
  assert.equal(P.plies[0].comment, 'Book exit');
  assert.equal(P.plies[1].cp, undefined);
});
