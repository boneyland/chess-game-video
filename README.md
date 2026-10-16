# Chess Game Video (artifact sources)

The browser player behind the claude.ai artifact and boneyland.netlify.app. Migrated from the Claude Design project "Chess Game Video"; split out of [chess-animator](../chess-animator) (the Python/Manim renderer) on 2026-10-17.

- `app/`: page sources (`shell.html`, JSX components, `chess-core.js`, trimmed `sample-analysis.js`; `analysis-core.js`, `openings-core.js`, `sf-engine.js`, `stockfish.jsx` for Stockfish in the browser)
- `src/`: original Claude Design files (`support.js` is the Claude Design runtime; not used by the build)
- `babel/babel.min.js`: @babel/standalone 7.29.0, used only to precompile the JSX
- `vendor/`: stockfish.js v19.0.1 `lite-single` (GPL-3.0, https://github.com/nmrugg/stockfish.js), unchanged release files
  - `stockfish-19-lite-single.js` sha256 `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`
  - `stockfish-19-lite-single.wasm` sha256 `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`
- `openings-data.cjs`: embeds `openings/*.tsv` (Lichess chess-openings, CC0; a copy of chess-animator's) into the page
- `docs/`: design and plan for browser Stockfish (2026-10-16; paths in them predate the split, when this was `artifact/`)
- `games/`: local PGNs (not committed)
- `tests/`: `node --test --test-concurrency=1 tests/*.test.cjs`, then `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py` (from the repo root). The Python checks import chess-animator, which must be checked out next to this repo. `make_rating_expected.py` and `make_openings_expected.py` regenerate the fixtures from the Python code.

Build: `node build.cjs` writes
- `out/chess-game-video.html`: the claude.ai artifact (https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT), ~3.2 MB with the engine inlined (base64 wasm, started from Blob URLs)
- `out/site/`: the self-hosted copy — copy all three files into `~/Documents/Obsidian/personal/docs/files/` (https://boneyland.netlify.app/files/chess-game-video.html):
  - `chess-game-video.html`
  - `stockfish-19-lite-single.js`, `stockfish-19-lite-single.wasm` (loaded from next to the page)
