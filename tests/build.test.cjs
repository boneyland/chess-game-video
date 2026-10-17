const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
require('./load.cjs'); // sets window
const ROOT = path.join(__dirname, '..');

// The sample game the page opens with: its PGN, analysis and commentary all come from separate units
test('the built page defines the sample game, its analysis and its commentary', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'build.cjs')], { cwd: ROOT });
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  for (const name of ['SAMPLE_PGN', 'SAMPLE_ANALYSIS', 'SAMPLE_NOTES']) assert.match(page, new RegExp('window\\.' + name + ' = '), name);
});

test('the sample commentary has an intro and comments on moves', () => {
  require(path.join(ROOT, 'src', 'game-data.js'));
  assert.match(window.SAMPLE_NOTES, /^\[INTRO\]\n/);
  assert.ok((window.SAMPLE_NOTES.match(/^\[\d+\] /gm) || []).length >= 5);
});

// String.replace would expand $' or $& in a script; both pages must carry each unit's code as written
test('the built pages inline the units verbatim', () => {
  const unit = fs.readFileSync(path.join(ROOT, 'app', 'chess-core.js'), 'utf8');
  assert.match(unit, /'\$' \+ nag/);
  for (const f of [['out', 'site', 'chess-game-video.html'], ['out', 'chess-game-video.html']]) assert.ok(fs.readFileSync(path.join(ROOT, ...f), 'utf8').includes(unit), f.join('/'));
});

// The self-hosted page keeps a Hugging Face token in localStorage, so no CDN script may run unchecked
test('every script from a CDN is pinned by an integrity hash', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'site', 'chess-game-video.html'), 'utf8');
  const tags = page.match(/<script\b[^>]*\ssrc="https:[^"]*"[^>]*>/g) || [];
  assert.ok(tags.length >= 2);
  for (const tag of tags) assert.match(tag, /\sintegrity="sha384-[\w+/=]+"\s+crossorigin="anonymous"/, tag);
  const importmap = JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  for (const url of page.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^'"]+\.mjs/g)) assert.match(importmap.integrity[url] || '', /^sha384-/, url);
  assert.match(page, /\.integrity = EXPORT_LIBS\.html2canvasHash/);
});

// The Lichess sound sets travel inside the page (the artifact can't load files next to it)
test('the built page carries the four Lichess sound sets as MP3s, and the Wood set needs no data', () => {
  const page = fs.readFileSync(path.join(ROOT, 'out', 'chess-game-video.html'), 'utf8');
  const data = JSON.parse(page.match(/window\.SFX_DATA = (\{.*?\});\n/)[1]);
  assert.deepEqual(Object.keys(data), ['futuristic', 'nes', 'piano', 'sfx']);
  for (const [set, sounds] of Object.entries(data)) {
    assert.deepEqual(Object.keys(sounds), ['move', 'capture', 'check', 'victory', 'draw'], set);
    for (const [kind, b64] of Object.entries(sounds)) assert.equal(Buffer.from(b64, 'base64').subarray(0, 3).toString(), 'ID3', `${set}/${kind}`);
  }
});
