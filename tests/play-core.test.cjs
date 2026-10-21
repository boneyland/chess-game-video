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
  assert.deepEqual(g.game, { mode: 'human', id: g.game.id, tc: '10+0', date: '2026.10.19', clock: { left: { w: 600000, b: 600000 }, since: null, clk: [] }, result: null });
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

// a Stockfish game played from a list of [uci, ms] moves
const sfGame = (you, tc, moves, fen) => moves.reduce((b, [u, at]) => P.move(b, CC.stepFromUci(B.pos(b), u), at), P.start(B.fromFen(fen), tc, '2026.10.21', { mode: 'stockfish', you }));

test('a Stockfish game carries the player\'s side and an empty critique; vs human stays as it was', () => {
  const g = P.start(B.fromFen(), null, '2026.10.21', { mode: 'stockfish', you: 'b' });
  assert.deepEqual(g.game, { mode: 'stockfish', you: 'b', id: g.game.id, tc: null, date: '2026.10.21', clock: null, result: null, critique: [] });
  assert.equal(P.start(B.fromFen(), null, null, { mode: 'stockfish' }).game.you, 'w', 'White by default');
  const h = P.start(B.fromFen(), null, '2026.10.21', { mode: 'human', you: 'b' });
  assert.deepEqual(Object.keys(h.game).sort(), ['clock', 'date', 'id', 'mode', 'result', 'tc']);
});
test('a Stockfish takeback goes back to the player\'s turn, one of the player\'s moves gone', () => {
  const g = sfGame('w', '15+10', [['e2e4', 0], ['e7e5', 5000], ['g1f3', 7000], ['b8c6', 9000]]);
  assert.equal(P.canTakeback(g), true);
  const t = P.takeback(g, 12000);
  assert.deepEqual(B.ucis(t), ['e2e4', 'e7e5'], 'its reply and the player\'s move');
  assert.equal(B.pos(t).turn, 'w'); assert.equal(t.upto, 1);
  assert.deepEqual(t.game.clock.clk, [910000, 905000]);
  assert.deepEqual(t.game.clock.left, { w: 918000 - 3000 - 10000, b: 913000 - 10000 }, 'each removed move\'s increment goes; White\'s 3 s since stays used');
  assert.equal(t.game.clock.since, 12000);
  // while Stockfish thinks, only the player's move goes
  const thinking = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['g1f3', 0]]);
  assert.deepEqual(B.ucis(P.takeback(thinking, 0)), ['e2e4', 'e7e5']);
  // the last of the player's moves: back to the start
  const first = P.takeback(sfGame('w', '5+0', [['e2e4', 0], ['e7e5', 1000]]), 2000);
  assert.equal(first.steps.length, 0); assert.equal(first.game.clock.since, null);
  assert.equal(P.canTakeback(first), false); assert.equal(P.takeback(first, 3000), first);
});
test('as Black, Stockfish\'s first move alone can\'t be taken back; from a FEN with Black to move, sides come from the positions', () => {
  const g = sfGame('b', null, [['e2e4', 0]]);
  assert.equal(P.canTakeback(g), false); assert.equal(P.takeback(g, 0), g);
  const h = sfGame('b', null, [['e2e4', 0], ['e7e5', 0], ['g1f3', 0]]);
  assert.deepEqual(B.ucis(P.takeback(h, 0)), ['e2e4'], 'back to Black\'s turn, Stockfish\'s first move kept');
  const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', f = sfGame('b', null, [['e8d7', 0], ['e1d1', 0]], fen);
  assert.equal(P.canTakeback(f), true);
  assert.equal(P.takeback(f, 0).steps.length, 0, 'Black moved first, so both go');
  const fw = sfGame('w', null, [['e8d7', 0]], fen);
  assert.equal(P.canTakeback(fw), false, 'only Stockfish (Black) has moved');
  assert.equal(P.canTakeback(P.resign(h, 0)), false, 'not after the end');
});
test('thinkMs: 2 s without a clock, a share of Stockfish\'s time left with one, at least 0.1 s', () => {
  assert.equal(P.thinkMs(sfGame('w', null, [['e2e4', 0]]), 0), 2000);
  const g = sfGame('w', '5+0', [['e2e4', 0]]);
  assert.equal(P.thinkMs(g, 0), 2000, '300 s / 30 is over the cap');
  const low = { ...g, game: { ...g.game, clock: { ...g.game.clock, left: { w: 300000, b: 30000 }, since: 0 } } };
  assert.equal(P.thinkMs(low, 0), 1000);
  assert.equal(P.thinkMs(low, 27000), 100, 'its clock runs while it thinks');
  const inc = sfGame('b', '15+10', []);
  assert.equal(P.thinkMs({ ...inc, game: { ...inc.game, clock: { ...inc.game.clock, left: { w: 3000, b: 1000 } } } }, 0), 2000, 'half the increment');
});
test('critique: only the player\'s moves, once each, dropped with their moves, kept through a reload', () => {
  const g = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['d1h5', 0], ['b8c6', 0]]);
  const c = P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3' });
  assert.deepEqual(c.game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
  assert.equal(P.addCritique(c, { j: 2, cls: 'blunder', best: 'g1f3' }), c, 'once per move');
  assert.equal(P.addCritique(c, { j: 1, cls: 'blunder', best: 'g8f6' }), c, 'Stockfish\'s move');
  assert.equal(P.addCritique(c, { j: 4, cls: 'blunder', best: 'g8f6' }), c, 'not on the board');
  assert.equal(P.addCritique(c, { j: 0, cls: 'good', best: 'd2d4' }), c);
  const human = game(null, [['e2e4', 0]]);
  assert.equal(P.addCritique(human, { j: 0, cls: 'mistake', best: 'd2d4' }), human);
  const ended = P.addCritique(P.resign(c, 0), { j: 0, cls: 'inaccuracy', best: 'd2d4' });
  assert.deepEqual(ended.game.critique.map((x) => x.j), [2, 0], 'a rating after the end still lands');
  assert.deepEqual(P.takeback(c, 0).game.critique, [], 'taken back with its move');
  const back = B.restore(JSON.parse(JSON.stringify(B.save(ended))));
  assert.deepEqual(back.game, ended.game);
  // a Black player's moves, from a FEN with Black to move
  const f = sfGame('b', null, [['e8d7', 0], ['e1d1', 0]], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
  assert.equal(P.addCritique(f, { j: 0, cls: 'blunder', best: 'e8f7' }).game.critique.length, 1);
  assert.equal(P.addCritique(f, { j: 1, cls: 'blunder', best: 'e1f1' }), f);
});
test('resume a Stockfish game: the side, and a critique that fits the moves', () => {
  const g = sfGame('b', '5+0', [['e2e4', 0], ['e7e5', 1000], ['g1f3', 2000]]);
  const saved = B.save(g);
  const critique = [{ j: 1, cls: 'blunder', best: 'c7c5' }, { j: 1, cls: 'mistake', best: 'c7c5' }, { j: 0, cls: 'mistake', best: 'd2d4' }, { j: 3, cls: 'mistake', best: 'b8c6' },
    { j: 1.5, cls: 'mistake', best: 'a7a6' }, { j: 1, cls: 'awful', best: 'a7a6' }, { j: 1, cls: 'mistake', best: 'nope' }, null, 'x'];
  const back = B.restore({ ...saved, game: { ...saved.game, you: 'x', critique } });
  assert.equal(back.game.mode, 'stockfish'); assert.equal(back.game.you, 'w', 'a bad side reads as White');
  assert.deepEqual(back.game.critique, [{ j: 0, cls: 'mistake', best: 'd2d4' }], 'only White\'s moves now');
  const asBlack = B.restore({ ...saved, game: { ...saved.game, critique } });
  assert.deepEqual(asBlack.game.critique, [{ j: 1, cls: 'blunder', best: 'c7c5' }]);
  assert.deepEqual(B.restore({ ...saved, game: { ...saved.game, critique: 'junk' } }).game.critique, []);
  assert.equal(B.restore({ ...saved, game: { ...saved.game, mode: 'other' } }).game, undefined);
});
test('critique text: critiqueText\'s line is kept with its move and through a reload, a bad one dropped', () => {
  const g = sfGame('w', null, [['e2e4', 0], ['e7e5', 0], ['d1h5', 0], ['b8c6', 0]]);
  const c = P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 'that drops the queen' });
  assert.deepEqual(c.game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3', text: 'that drops the queen' }]);
  assert.deepEqual(P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 'x'.repeat(121) }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }], 'too long');
  assert.deepEqual(P.addCritique(g, { j: 2, cls: 'mistake', best: 'g1f3', text: 7 }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
  assert.deepEqual(B.restore(JSON.parse(JSON.stringify(B.save(c)))).game.critique, c.game.critique);
  const saved = B.save(c);
  assert.deepEqual(B.restore({ ...saved, game: { ...saved.game, critique: [{ j: 2, cls: 'mistake', best: 'g1f3', text: {} }] } }).game.critique, [{ j: 2, cls: 'mistake', best: 'g1f3' }]);
});
test('resign: against Stockfish the player can resign while it is to move', () => {
  const g = sfGame('w', '5+0', [['e2e4', 0]]);
  assert.deepEqual(P.resign(g, 1000, 'w').game.result, { result: '0-1', reason: 'resign', side: 'w' });
  assert.equal(P.resign(g, 1000, 'w').game.clock.left.b, 299000, 'the running clock is charged');
  assert.deepEqual(P.resign(g, 1000).game.result.side, 'b', 'the side to move by default');
});
test('critiqueText: a piece dropped in the reply line, a mate allowed, else a line for the class', () => {
  const after = (fen, u) => CC.applyUci(CC.parseFen(fen).pos, u).pos;
  // 1. e4 e5 2. ... d6, and Qg4?? hangs the queen to ...Bxg4
  const q = after('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', 'd1g4');
  assert.equal(P.critiqueText(q, ['c8g4'], 'w', 'blunder', false), 'that drops the queen');
  assert.equal(P.critiqueText(q, ['g8f6', 'g4c8'], 'w', 'blunder', false), 'that should lose', 'a line that wins Black\'s bishop drops nothing');
  // a knight for a pawn: the knight is named
  const n = after('4k3/8/3p4/8/8/8/8/4K1N1 w - - 0 1', 'g1f3');
  assert.equal(P.critiqueText(CC.parseFen('4k3/8/8/3p4/4N3/8/8/4K3 b - - 0 1').pos, ['d5e4'], 'w', 'mistake', false), 'that drops the knight');
  assert.equal(P.critiqueText(n, ['e8d7'], 'w', 'mistake', false), 'that gives Stockfish the edge');
  // a piece not won back is a drop, an even trade isn't; a pawn is "a pawn"
  const gone = CC.parseFen('4k3/8/8/3p4/4N3/5N2/8/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(gone, ['d5e4', 'f3d4'], 'w', 'inaccuracy', false), 'that drops the knight', 'not won back');
  const pawn = CC.parseFen('4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(pawn, ['d5e4'], 'w', 'inaccuracy', false), 'that drops a pawn');
  const even = CC.parseFen('4k3/8/8/3p4/4P3/8/5N2/4K3 b - - 0 1').pos;
  assert.equal(P.critiqueText(even, ['d5e4', 'f2e4'], 'w', 'inaccuracy', false), 'there was a better move', 'a pawn each');
  // en passant counts; an illegal move ends the line
  const ep = CC.parseFen('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1').pos;
  assert.equal(P.critiqueText(ep, ['d5e6'], 'b', 'mistake', false), 'that drops a pawn');
  assert.equal(P.critiqueText(pawn, ['a1a2', 'd5e4'], 'w', 'mistake', false), 'that gives Stockfish the edge');
  assert.equal(P.critiqueText(n, ['e8d7'], 'w', 'blunder', true), 'that allows mate');
  assert.equal(P.critiqueText(q, ['c8g4'], 'w', 'blunder', true), 'that drops the queen', 'the piece first');
  // only four plies count
  assert.equal(P.critiqueText(pawn, ['e8d8', 'e1d1', 'd8e8', 'd1e1', 'd5e4'], 'w', 'mistake', false), 'that gives Stockfish the edge');
});
test('a Stockfish game\'s PGN names the players', () => {
  const w = P.pgn(sfGame('w', null, [['e2e4', 0]]));
  assert.match(w, /\[Event "Play vs Stockfish"\][\s\S]*\[White "You"\]\n\[Black "Stockfish 19"\]/);
  const b = P.pgn(sfGame('b', null, [['e2e4', 0]]));
  assert.match(b, /\[White "Stockfish 19"\]\n\[Black "You"\]/);
  assert.equal(CC.buildGame({ pgn: b }).plies.length, 1);
});
