const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUnit } = require('./load.cjs');
loadUnit('sfx-core.js');
const X = window.Sfx;

test('kinds: a move or a capture, then a check on checks and mates', () => {
  assert.deepEqual(X.kinds('Nf3'), ['move']);
  assert.deepEqual(X.kinds('O-O'), ['move']);
  assert.deepEqual(X.kinds('exd5'), ['capture']);
  assert.deepEqual(X.kinds('Qxf7#'), ['capture', 'check']);
  assert.deepEqual(X.kinds('e8=Q+'), ['move', 'check']);
  assert.deepEqual(X.kinds(''), ['move']);
});

test('endKind: decisive results ring victory, draws ring draw, unfinished games nothing', () => {
  assert.equal(X.endKind('1-0'), 'victory');
  assert.equal(X.endKind('0-1'), 'victory');
  assert.equal(X.endKind('1/2-1/2'), 'draw');
  assert.equal(X.endKind('*'), null);
  assert.equal(X.endKind(undefined), null);
});

// three plies starting at 1, 2 and 3 s, each taking 0.5 s to land
const S = { N: 3, tp: [1, 2, 3], md: [0.5, 0.5, 0.5] };
test('landed: the last ply whose piece has reached its square', () => {
  assert.equal(X.landed(0, S), -1);
  assert.equal(X.landed(1.2, S), -1); // still moving
  assert.equal(X.landed(1.5, S), 0);
  assert.equal(X.landed(2.9, S), 1);
  assert.equal(X.landed(9, S), 2);
});

const M = { result: '1-0', plies: [{ san: 'e4' }, { san: 'exd5' }, { san: 'Qh5#' }] };
test('cue: the sound of the move now on the board, and the end of the game when playback reaches it', () => {
  assert.equal(X.cue(M, 0, 0, true), null);
  assert.equal(X.cue(M, 0, -1, false), null); // back to the start position
  assert.deepEqual(X.cue(M, -1, 0, true), { kinds: ['move'], end: null });
  assert.deepEqual(X.cue(M, 0, 1, false), { kinds: ['capture'], end: null });
  assert.deepEqual(X.cue(M, 2, 1, false), { kinds: ['capture'], end: null }); // stepping back plays the move now shown
  assert.deepEqual(X.cue(M, 1, 2, true), { kinds: ['move', 'check'], end: 'victory' });
  assert.deepEqual(X.cue(M, 1, 2, false), { kinds: ['move', 'check'], end: null }); // stepping onto the last move
  assert.deepEqual(X.cue({ ...M, result: '*' }, 1, 2, true), { kinds: ['move', 'check'], end: null });
});

test('every set but the built-in one has its five sounds in the page data', () => {
  assert.equal(X.SETS[0], 'Lichess sfx'); // the default, also for a stored set that no longer exists
  assert.deepEqual(X.SETS.filter((s) => s !== 'Wood').map((s) => X.SET_DIR[s]).sort(), ['futuristic', 'nes', 'piano', 'sfx']);
  assert.deepEqual(X.KINDS, ['move', 'capture', 'check', 'victory', 'draw']);
});

test('synth: every Wood sound is short, audible, never clips, and the same every time', () => {
  for (const k of X.KINDS) {
    const a = X.synth(k, 48000), b = X.synth(k, 48000);
    assert.ok(a instanceof Float32Array, k);
    assert.ok(a.length > 48000 * 0.05 && a.length <= 48000 * 1.6, `${k}: ${a.length} samples`);
    let peak = 0;
    for (const v of a) { assert.ok(Number.isFinite(v), k); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.2 && peak <= 0.9, `${k}: peak ${peak}`);
    assert.ok(Math.abs(a[a.length - 1]) < 1e-3, `${k} ends in silence`);
    assert.deepEqual(a, b, k);
  }
  assert.throws(() => X.synth('nope', 48000));
});

// a quick run of sounds (browsing fast, dragging the playhead) masks each one's tail behind the next one's click
test('runs: the first sound of a quick run plays at once, the rest wait, and only the last one plays when it stops', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const heard = [];
  const ask = X.runs((x) => heard.push(x), 400);
  ask(false, 'a'); assert.deepEqual(heard, ['a']);
  t.mock.timers.tick(300); ask(false, 'b');
  t.mock.timers.tick(300); ask(false, 'c');
  t.mock.timers.tick(300); ask(false, 'd');
  assert.deepEqual(heard, ['a']); // the run goes on: nothing yet
  t.mock.timers.tick(399); assert.deepEqual(heard, ['a']);
  t.mock.timers.tick(1); assert.deepEqual(heard, ['a', 'd']); // it stopped: the move it stopped on
  t.mock.timers.tick(700); ask(false, 'e'); assert.deepEqual(heard, ['a', 'd', 'e']); // slow steps each play at once
  t.mock.timers.tick(500); ask(false, 'f'); assert.deepEqual(heard, ['a', 'd', 'e', 'f']);
  t.mock.timers.tick(1000); assert.deepEqual(heard, ['a', 'd', 'e', 'f']); // and nothing plays twice
});

// a held arrow key or a fast drag: the stop sound comes soon after it ends, not a whole gap later
test('runs: a fast run stops sooner, twice its last gap but no less than 100 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const heard = [];
  const ask = X.runs((x) => heard.push(x), 400);
  ask(false, 'a'); for (const x of 'bcdefg') { t.mock.timers.tick(30); ask(false, x); }
  assert.deepEqual(heard, ['a']);
  t.mock.timers.tick(99); assert.deepEqual(heard, ['a']);
  t.mock.timers.tick(1); assert.deepEqual(heard, ['a', 'g']);
  t.mock.timers.tick(1000); ask(false, 'h'); t.mock.timers.tick(150); ask(false, 'i'); // a 150 ms gap: stops after 300
  t.mock.timers.tick(299); assert.deepEqual(heard, ['a', 'g', 'h']);
  t.mock.timers.tick(1); assert.deepEqual(heard, ['a', 'g', 'h', 'i']);
});

// playback can be 0.275 s per move: its sounds are steady, each plays at once, and one ends a run still waiting
test('runs: steady sounds always play at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const heard = [];
  const ask = X.runs((x) => heard.push(x), 400);
  ask(true, 'a'); t.mock.timers.tick(275); ask(true, 'b'); t.mock.timers.tick(275); ask(true, 'c');
  assert.deepEqual(heard, ['a', 'b', 'c']);
  t.mock.timers.tick(1000); ask(false, 'd'); t.mock.timers.tick(100); ask(false, 'e'); // a run, 'e' waiting
  t.mock.timers.tick(100); ask(true, 'f');
  t.mock.timers.tick(1000); assert.deepEqual(heard, ['a', 'b', 'c', 'd', 'f']);
});
