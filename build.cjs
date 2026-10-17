// Assemble the artifact: plain scripts inlined as-is, JSX precompiled with Babel, each unit in its own scope.
const fs = require('fs'), path = require('path');
const dir = __dirname, src = path.join(dir, 'src'), app = path.join(dir, 'app');
const Babel = require(path.join(dir, 'babel', 'babel.min.js'));
const jsx = (code, name) => Babel.transform(code, { filename: name, presets: ['react'] }).code;
const read = (p) => fs.readFileSync(p, 'utf8');
// Lichess's Enigmahack sound sets (AGPL-3.0-or-later, vendor/sounds), inlined as base64 MP3s: { sfx: { move: '…' }, … }
const SOUNDS = path.join(dir, 'vendor', 'sounds');
const soundsData = () => Object.fromEntries(['futuristic', 'nes', 'piano', 'sfx'].map((set) => [set, Object.fromEntries(['Move', 'Capture', 'Check', 'Victory', 'Draw'].map((f) => [f.toLowerCase(), fs.readFileSync(path.join(SOUNDS, set, f + '.mp3')).toString('base64')]))]));
const units = [
  ['pieces.js', read(path.join(src, 'pieces.js'))],
  ['chess-core.js', read(path.join(app, 'chess-core.js'))],
  ['analysis-core.js', read(path.join(app, 'analysis-core.js'))],
  ['openings-data.js', 'window.OPENINGS_TSV = ' + JSON.stringify(require('./openings-data.cjs').openingsTsv()).replace(/</g, '\\u003c') + ';'],
  ['openings-core.js', read(path.join(app, 'openings-core.js'))],
  ['sf-engine.js', read(path.join(app, 'sf-engine.js'))],
  ['queen-core.js', read(path.join(app, 'queen-core.js'))],
  ['sounds-data.js', 'window.SFX_DATA = ' + JSON.stringify(soundsData()) + ';'],
  ['sfx-core.js', read(path.join(app, 'sfx-core.js'))],
  ['sample-game.js', read(path.join(src, 'sample-game.js'))],
  ['game-data.js', read(path.join(src, 'game-data.js'))],
  ['sample-analysis.js', read(path.join(app, 'sample-analysis.js'))],
  ['engine.jsx', jsx(read(path.join(app, 'engine.jsx')), 'engine.jsx')],
  ['tweaks.jsx', jsx(read(path.join(app, 'tweaks.jsx')), 'tweaks.jsx')],
  ['game-video.jsx', jsx(read(path.join(app, 'game-video-core.jsx')) + '\n' + read(path.join(app, 'queen.jsx')) + '\n' + read(path.join(app, 'stockfish.jsx')) + '\n' + read(path.join(app, 'sfx.jsx')) + '\n' + read(path.join(app, 'export.jsx')) + '\n' + read(path.join(app, 'game-app.jsx')), 'game-video.jsx')],
];
const scripts = units.map(([name, code]) => {
  if (/<\/script/i.test(code)) throw new Error(name + ' contains </script');
  return `<script>\n// ${name}\n(function () {\n${code}\n})();\n</script>`;
}).join('\n');
const page = read(path.join(app, 'shell.html'));
const out = page.replace('<!--SCRIPTS-->', () => scripts); // a function, so $' or $& in the code stay as they are
// claude.ai can't load a worker from a file next to the page: the artifact carries the engine inline and
// starts it from Blob URLs (the glue reads its wasm URL from the worker's #hash)
const esc = (str) => JSON.stringify(str).replace(/</g, '\\u003c');
const sfInline = `<script>
// stockfish.js v19.0.1 lite-single (GPL-3.0, https://github.com/nmrugg/stockfish.js), inlined
(function () {
  const GLUE = ${esc(read(path.join(dir, 'vendor', 'stockfish-19-lite-single.js')))};
  const WASM = ${esc(fs.readFileSync(path.join(dir, 'vendor', 'stockfish-19-lite-single.wasm')).toString('base64'))};
  window.SF_MAKE_WORKER = () => {
    const bytes = Uint8Array.from(atob(WASM), (ch) => ch.charCodeAt(0));
    const wasm = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    const glue = URL.createObjectURL(new Blob([GLUE], { type: 'text/javascript' }));
    return new Worker(glue + '#' + encodeURIComponent(wasm));
  };
})();
</script>`;
const artifactOut = page.replace('<!--SCRIPTS-->', () => sfInline + '\n' + scripts);
fs.mkdirSync(path.join(dir, 'out', 'site'), { recursive: true });
fs.writeFileSync(path.join(dir, 'out', 'chess-game-video.html'), artifactOut);
// Self-hosted copy: claude.ai wraps artifacts in this document shell itself, so a standalone file needs its own
const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${out}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'out', 'site', 'chess-game-video.html'), site);
// the engine, served next to the self-hosted page
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) fs.copyFileSync(path.join(dir, 'vendor', f), path.join(dir, 'out', 'site', f));
console.log('wrote', artifactOut.length, 'bytes (artifact),', site.length, 'bytes (site)');
