const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit, fixture } = require('./load.cjs');
const { openingsTsv } = require('../openings-data.cjs');
loadUnit('chess-core.js');
window.OPENINGS_TSV = openingsTsv();
loadUnit('openings-core.js');
const CC = window.ChessCore;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';

test('applySan returns the next position and the move in uci', () => {
  const r = CC.applySan(CC.posFromFen(START), 'Nf3');
  assert.equal(r.uci, 'g1f3');
  assert.equal(r.pos.turn, 'b');
});

test('applyUci returns SAN, castles, promotes, and rejects illegal moves', () => {
  let pos = CC.posFromFen(START);
  assert.equal(CC.applyUci(pos, 'e2e4').san, 'e4');
  assert.equal(CC.applyUci(pos, 'e2e5'), null);
  pos = CC.posFromFen('4k3/8/8/8/8/8/8/4K2R w');
  assert.equal(CC.applyUci(pos, 'e1g1').san, 'O-O');
  pos = CC.posFromFen('8/P6k/8/8/8/8/8/4K3 w');
  assert.equal(CC.applyUci(pos, 'a7a8q').san, 'a8=Q');
});

test('byPly and identify match Python on every fixture game', () => {
  const book = window.Openings.book();
  for (const c of fixture('openings-expected.json')) {
    assert.deepEqual(book.byPly(c.ucis), c.byPly, c.name);
    assert.deepEqual(book.identify(c.ucis), c.identify, c.name);
  }
});

// The page builds the book after the first paint; ~200–250 ms in Chromium (2026-10-16). The bound only catches a
// large regression: run beside the engine tests it measured 312 ms.
test('book builds from cold within 600 ms', () => {
  const t0 = performance.now();
  window.Openings.book({ fresh: true });
  const ms = performance.now() - t0;
  console.log(`opening book build: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 600, `${ms.toFixed(0)} ms`);
});

test('positionKey keeps castling rights and only a legal en-passant square, like epd()', () => {
  const key = (u) => window.Openings.positionKey(u.split(' '));
  assert.ok(key('e2e4 g8f6 e4e5 d7d5').endsWith(' w KQkq d6'), key('e2e4 g8f6 e4e5 d7d5'));
  assert.ok(key('e2e4 d7d5').endsWith(' w KQkq -'), key('e2e4 d7d5'));
  assert.ok(key('e2e4 e7e5 e1e2 e8e7 e2e1 e7e8').endsWith(' w - -'), key('e2e4 e7e5 e1e2 e8e7 e2e1 e7e8'));
});

test('a FEN start inside the book is named', () => {
  const O = window.Openings;
  // the position after 1. e4 e5 2. Nf3 Nc6, given as a FEN, then 3. Bb5
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.match(O.book().identify(['f1b5'], fen).name, /^Ruy Lopez/);
  assert.equal(O.book().byPly(['e2e4']).length, 1); // the standard start still works without a FEN
  assert.equal(O.book().identify(['e1g1'], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), null); // outside the book: no name
});
