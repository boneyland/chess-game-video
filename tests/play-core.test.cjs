const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('play-core.js');
const B = window.BoardCore, P = window.PlayCore, CC = window.ChessCore;
const playAll = (b, ucis) => ucis.reduce((x, u) => B.play(x, CC.stepFromUci(B.pos(x), u)), b);

test('checkmate and stalemate', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen(), ['f2f3', 'e7e5', 'g2g4', 'd8h4'])), { result: '0-1', reason: 'checkmate' });
  const b = B.fromFen('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
  assert.deepEqual(P.outcome(playAll(b, ['f1f7'])), { result: '1/2-1/2', reason: 'stalemate' });
  assert.deepEqual(P.outcome(playAll(b, ['f1f8'])), { result: '1-0', reason: 'checkmate' });
  assert.equal(P.outcome(b), null);
});
test('threefold repetition, counted from the start', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  assert.equal(P.outcome(playAll(B.fromFen(), shuffle)), null, 'twice is not yet a draw');
  assert.deepEqual(P.outcome(playAll(B.fromFen(), shuffle.concat(shuffle))), { result: '1/2-1/2', reason: 'repetition' });
});
test('repetition ignores an en-passant square nobody can use', () => {
  const b = playAll(B.fromFen(), ['e2e4', 'g8f6', 'g1f3', 'f6g8', 'f3g1', 'g8f6', 'g1f3', 'f6g8', 'f3g1']);
  assert.deepEqual(P.outcome(b), { result: '1/2-1/2', reason: 'repetition' });
  // one a pawn could take on is part of the position
  const ep = CC.parseFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1').pos;
  assert.notEqual(P.positionKey(ep), P.positionKey({ ...ep, ep: -1 }));
});
test('the fifty-move rule counts the FEN\'s half-move clock', () => {
  const b = B.fromFen('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
  assert.deepEqual(P.outcome(playAll(b, ['a1a2'])), { result: '1/2-1/2', reason: 'fifty' });
  assert.equal(P.outcome(playAll(b, ['e2e3'])), null, 'a pawn move resets it');
  // mate on the hundredth half-move is mate
  assert.deepEqual(P.outcome(playAll(B.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80'), ['a1a8'])), { result: '1-0', reason: 'checkmate' });
});
test('insufficient material, and what still counts as mating material', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen('4k3/8/8/8/8/8/3r4/3BK3 w - - 0 1'), ['e1d2'])), { result: '1/2-1/2', reason: 'material' });
  const pos = (fen) => CC.parseFen(fen).pos;
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'w'), false, 'a lone king');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), false, 'K+N against K');
  assert.equal(P.canMate(pos('4k2n/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), true, 'K+N against K+N');
  assert.equal(P.canMate(pos('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w'), false, 'bishops on one colour');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'), 'w'), true, 'bishops on both colours');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 'w'), true, 'a pawn');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'w'), true, 'a rook');
  assert.equal(P.outcome(playAll(B.fromFen('4k2n/8/8/8/8/8/8/3NK3 w - - 0 1'), ['e1e2'])), null, 'K+N against K+N plays on');
});

// a game played from a list of [uci, ms] moves
const game = (tc, moves, fen) => moves.reduce((b, [u, at]) => P.move(b, CC.stepFromUci(B.pos(b), u), at), P.start(B.fromFen(fen), tc, '2026.10.19'));

test('a new game: no moves, full clocks, stopped until the first move', () => {
  const g = P.start(B.fromFen(), '10+0', '2026.10.19');
  assert.deepEqual(g.game, { mode: 'human', tc: '10+0', date: '2026.10.19', clock: { left: { w: 600000, b: 600000 }, since: null, clk: [] }, result: null });
  assert.equal(P.inProgress(g), true);
  assert.equal(P.timeLeft(g, 'w', 99999), 600000, 'not running before the first move');
  assert.equal(P.start(B.fromFen(), null).game.clock, null);
  // a FEN that is already mate is a finished game
  assert.deepEqual(P.start(B.fromFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), null).game.result, { result: '1-0', reason: 'checkmate' });
});
test('clocks start with the first move and add the increment', () => {
  const g = game('5+0', [['e2e4', 1000], ['e7e5', 4000]]);
  assert.deepEqual(g.game.clock.clk, [300000, 297000]);
  assert.equal(g.game.clock.since, 4000);
  assert.equal(P.timeLeft(g, 'w', 6000), 298000, 'White\'s clock runs');
  assert.equal(P.timeLeft(g, 'b', 6000), 297000);
  const h = game('15+10', [['e2e4', 0], ['e7e5', 5000], ['g1f3', 7000]]);
  assert.deepEqual(h.game.clock.clk, [910000, 905000, 918000]);
});
test('a flag fall loses unless the opponent can\'t mate', () => {
  const g = game('5+0', [['e1d1', 0]], '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(P.flag(g, 299999), g, 'still in time');
  assert.deepEqual(P.flag(g, 300000).game.result, { result: '1-0', reason: 'time', side: 'b' });
  assert.equal(P.flag(g, 300000).game.clock.left.b, 0);
  // Black, with a rook, flags against a lone king: a draw; White flagging against the rook loses
  const k = game('5+0', [['e1e2', 0]], '4k3/8/8/8/8/8/8/4K2r w - - 0 1');
  assert.deepEqual(P.flag(k, 300000).game.result, { result: '1/2-1/2', reason: 'time', side: 'b' });
  const kw = P.move(k, CC.stepFromUci(B.pos(k), 'h1h2'), 1000);
  assert.deepEqual(P.flag(kw, 400000).game.result, { result: '0-1', reason: 'time', side: 'w' });
  // a move made after the flag fell doesn't count
  const late = P.move(k, CC.stepFromUci(B.pos(k), 'h1h2'), 300001);
  assert.equal(late.steps.length, 1); assert.equal(late.game.result.reason, 'time');
});
test('takebacks only in a game in progress', () => {
  const g = game('15+10', [['e2e4', 0], ['e7e5', 5000]]);
  const t = P.takeback(g, 8000);
  assert.deepEqual(B.ucis(t), ['e2e4']); assert.equal(t.upto, 0);
  assert.equal(B.pos(t).turn, 'b');
  assert.deepEqual(t.game.clock.clk, [910000]);
  assert.deepEqual(t.game.clock.left, { w: 907000, b: 905000 - 10000 }, 'White\'s time used stays used; Black\'s increment goes');
  assert.equal(t.game.clock.since, 8000);
  const none = P.takeback(t, 9000);
  assert.equal(none.steps.length, 0); assert.equal(none.game.clock.since, null, 'every move taken back stops the clocks');
  assert.equal(P.takeback(none, 9000), none);
  const mate = game(null, [['f2f3', 0], ['e7e5', 0], ['g2g4', 0], ['d8h4', 0]]);
  assert.equal(mate.game.result.reason, 'checkmate');
  assert.equal(P.takeback(mate, 0), mate);
  const resigned = P.resign(g, 6000);
  assert.equal(P.takeback(resigned, 7000), resigned);
});
test('resign: the side to move resigns, and its clock stops', () => {
  const r = P.resign(game('5+0', [['e2e4', 0]]), 2500);
  assert.deepEqual(r.game.result, { result: '1-0', reason: 'resign', side: 'b' });
  assert.equal(r.game.clock.left.b, 297500); assert.equal(r.game.clock.since, null);
  assert.equal(P.move(r, CC.stepFromUci(B.pos(r), 'e7e5'), 3000), r, 'no moves after the end');
  assert.deepEqual(P.resultText(r.game.result), { score: '1–0', why: 'Black resigned' });
  assert.deepEqual(P.resultText({ result: '1/2-1/2', reason: 'time', side: 'w' }), { score: '½–½', why: 'White’s flag fell, but Black can’t mate' });
});
test('resume pauses the clocks and trims what doesn\'t fit', () => {
  const g = game('5+0', [['e2e4', 0], ['e7e5', 4000]]);
  const back = B.restore(JSON.parse(JSON.stringify(B.save(g))));
  assert.deepEqual(back.game, { ...g.game, clock: { ...g.game.clock, since: null } });
  assert.equal(P.timeLeft(back, 'w', 1e9), 300000, 'paused');
  const odd = B.restore({ fen: CC.START_FEN, moves: ['e2e4', 'e2e4'], upto: 0, game: { mode: 'human', tc: '5+0', date: 'x', clock: { left: { w: 'x' }, clk: [1, 2, 3], since: 5 }, result: { result: '1-0', reason: 'checkmate' } } });
  assert.equal(odd.steps.length, 1); assert.equal(odd.upto, 0);
  assert.deepEqual(odd.game.clock, { left: { w: 300000, b: 300000 }, since: null, clk: [1] });
  assert.equal(odd.game.result, null, 'a result the moves don\'t give is dropped');
  assert.match(odd.game.date, /^\d{4}\.\d\d\.\d\d$/);
  assert.equal(B.restore({ fen: CC.START_FEN, moves: [], upto: -1, game: 'junk' }).game, undefined);
  // a game in progress shows its last move
  assert.equal(B.restore({ ...B.save(g), upto: -1 }).upto, 1);
});
test('the PGN has the result, the time control and the clocks', () => {
  const g = P.resign(game('10+0', [['e2e4', 0], ['e7e5', 2000], ['g1f3', 3500]]), 9000);
  const text = P.pgn(g);
  assert.match(text, /\[Event "Play vs human"\]/); assert.match(text, /\[Date "2026\.10\.19"\]/);
  assert.match(text, /\[Result "1-0"\]/); assert.match(text, /\[TimeControl "600\+0"\]/); assert.match(text, /\[Termination "normal"\]/);
  assert.match(text, /1\. e4 \{ \[%clk 0:10:00\] \} 1\.\.\. e5 \{ \[%clk 0:09:58\] \} 2\. Nf3 \{ \[%clk 0:09:58\] \} 1-0/);
  const M = CC.buildGame({ pgn: text });
  assert.equal(M.plies.length, 3); assert.equal(M.hasClock, true); assert.equal(M.result, '1-0');
  const f = P.pgn(P.start(B.fromFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40'), null, '2026.10.19'));
  assert.match(f, /\[SetUp "1"\]\n\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 b - - 0 40"\]/); assert.match(f, /\n\n\*\n$/);
  assert.doesNotMatch(f, /TimeControl|Termination/);
});
test('a draw by agreement ends the game and survives a reload', () => {
  const g = game('5+0', [['e2e4', 0], ['e7e5', 3000]]);
  const d = P.agreeDraw(g, 5000);
  assert.deepEqual(d.game.result, { result: '1/2-1/2', reason: 'agreement' });
  assert.equal(d.game.clock.left.w, 298000); assert.equal(d.game.clock.since, null);
  assert.equal(P.agreeDraw(d, 6000), d, 'only in a game in progress');
  assert.deepEqual(P.resultText(d.game.result), { score: '½–½', why: 'Draw by agreement' });
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(d)))).game.result, d.game.result);
  assert.match(P.pgn(d), /\[Result "1\/2-1\/2"\][\s\S]*\[Termination "normal"\][\s\S]* 1\/2-1\/2\n$/);
});
