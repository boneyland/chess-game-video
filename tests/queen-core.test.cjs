const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('queen-core.js');
const Q = window.QueenCore;

test('pyParse reads a Python dict repr: quotes, escapes, None/True/False, numbers, nesting', () => {
  const v = Q.pyParse(`{'best_move_uci': 'e2e4', "analysis": 'It\\'s "fine"\\nreally', 'x': None, 'ok': True, 'no': False, 'n': -1.5e2, 'l': [1, 'a', {'k': 2},], 'u': '\\u00e9\\x41'}`);
  assert.deepEqual(v, { best_move_uci: 'e2e4', analysis: 'It\'s "fine"\nreally', x: null, ok: true, no: false, n: -150, l: [1, 'a', { k: 2 }], u: 'éA' });
});

test('pyParse throws on truncated input', () => {
  assert.throws(() => Q.pyParse("{'a': 'b"));
  assert.throws(() => Q.pyParse("{'a': 1"));
  assert.throws(() => Q.pyParse("{'a' 1}"));
});

test('queenPayload takes JSON, a Python repr or an object, and rejects other shapes', () => {
  assert.equal(Q.queenPayload({ payload: '{"best_move_uci": "d2d4"}' }).best_move_uci, 'd2d4');
  assert.equal(Q.queenPayload({ payload: " {'analysis': 'x', 'best_move_uci': None} " }).analysis, 'x');
  assert.equal(Q.queenPayload({ analysis: 'y' }).analysis, 'y');
  assert.throws(() => Q.queenPayload({ payload: 'GPU quota exceeded' }), (e) => e.code === 'bad_answer' && e.raw === '"GPU quota exceeded"');
  assert.throws(() => Q.queenPayload({ payload: { foo: 1 } }), (e) => e.code === 'bad_answer');
});

test("queenEval turns Queen's evaluation sentence into pawns from White's side", () => {
  assert.equal(Q.queenEval('White is better by approximately 1.37 pawns.'), 1.37);
  assert.equal(Q.queenEval('White is losing by 5.24 pawns'), -5.24);
  assert.equal(Q.queenEval('Black is down about 0.5 pawns'), 0.5);
  assert.equal(Q.queenEval('Black has an edge of 0.8 pawns'), -0.8);
  assert.equal(Q.queenEval("+0.26 pawns from Black's perspective"), -0.26);
  assert.equal(Q.queenEval('Black is better by approx. 0.9 pawns'), -0.9);
  assert.equal(Q.queenEval('White is ahead by −0.3 pawns'), -0.3);
  assert.equal(Q.queenEval('The position is roughly equal.'), 0);
  assert.equal(Q.queenEval('Unclear.'), null);
  assert.equal(Q.queenEval(''), null);
});

test('queenProse keeps the analysis paragraphs and drops the labelled sections after them', () => {
  const text = 'ANALYSIS: First   paragraph\nwraps.\n\nSecond one.\nBEST_MOVE: e4\nCRITICAL_LINE: e4 e5';
  assert.deepEqual(Q.queenProse(text), ['First paragraph wraps.', 'Second one.']);
  assert.deepEqual(Q.queenProse(''), []);
});

test('readSse finds the complete event, or the error event as JSON or text', () => {
  const ok = 'event: generating\ndata: null\n\nevent: complete\ndata: [{"best_move_uci": "e2e4"}]\n\n';
  assert.deepEqual(Q.readSse(ok), { result: [{ best_move_uci: 'e2e4' }], error: null });
  const quota = 'event: error\ndata: {"error": "You have exceeded your ZeroGPU runs limit.", "title": "ZeroGPU quota"}\n\n';
  assert.equal(Q.readSse(quota).error.error, 'You have exceeded your ZeroGPU runs limit.');
  assert.deepEqual(Q.readSse('event: error\ndata: plain text\n\n'), { result: null, error: 'plain text' });
  assert.deepEqual(Q.readSse(''), { result: null, error: null });
});

test('capQueenCache drops the oldest answers until the JSON fits, keeping the newest even when it alone is too big', () => {
  const c = {}; for (let i = 0; i < 10; i++) c['k' + i] = { prose: 'x'.repeat(90) };
  assert.equal(Q.capQueenCache(c), c);
  const kept = Q.capQueenCache(c, 500);
  assert.ok(JSON.stringify(kept).length <= 500);
  assert.deepEqual(Object.keys(kept), ['k6', 'k7', 'k8', 'k9']);
  assert.deepEqual(Object.keys(Q.capQueenCache(c, 10)), ['k9']);
  assert.deepEqual(Q.capQueenCache({}, 10), {});
});
