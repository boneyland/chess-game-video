# Chess Game Video (artifact sources)

The browser player behind the claude.ai artifact, https://chess-replay.netlify.app/ and its Codeberg Pages copy. Migrated from the Claude Design project "Chess Game Video"; split out of [chess-animator](../chess-animator) (the Python/Manim renderer) on 2026-10-17.

- `app/`: page sources (`shell.html`, JSX components, `chess-core.js`, trimmed `sample-analysis.js`; `analysis-core.js`, `openings-core.js`, `sf-engine.js`, `stockfish.jsx` for Stockfish in the browser)
- `src/`: files from the original Claude Design project (`pieces.js`, `sample-game.js`, `game-data.js` go into the build); `pieces/cburnett/` are Colin M.L. Burnett's pieces (GPL-2.0-or-later, as in Lichess)
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
- `out/site/`: the self-hosted copy, which Netlify builds from this repo (`netlify.toml`) and serves at https://chess-replay.netlify.app/:
  - `chess-game-video.html`
  - `stockfish-19-lite-single.js`, `stockfish-19-lite-single.wasm` (loaded from next to the page)

Codeberg Pages: `./pages.sh` builds, commits `out/site/` to the `pages` branch (the page renamed `index.html`, plus `LICENSE`) and pushes `main` and `pages` to the `codeberg` remote (`--no-push` to only commit). Codeberg's git-pages server deploys the branch when a Forgejo webhook on the repo (target `https://boneyland.codeberg.page/chess-replay`, branch filter `pages`) reports a push; the site is https://boneyland.codeberg.page/chess-replay/.

Licence: GPL-3.0-or-later (`LICENSE`), the same as the bundled Stockfish.
