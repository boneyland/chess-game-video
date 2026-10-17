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
