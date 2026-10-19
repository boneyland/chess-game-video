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
