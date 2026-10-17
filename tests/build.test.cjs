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
