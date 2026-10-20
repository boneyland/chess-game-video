# Chess Replay

![The sample chess game playing: move rating, best line, commentary and eval graph](media/preview.webp)

A browser app for replaying and playing chess games, at https://chess-replay.onrender.com/. Everything runs in the browser, Stockfish included, and keeps working offline.

## Features

- **Replay a game**: load a PGN (a `[FEN]` start position too; Chess960 not yet) and step through it on an animated board, with an evaluation graph, a rating for every move, the best line and the opening name
- **Analysis in the browser**: Stockfish 19 analyses games that come without evals; drag a piece to try your own move from any position
- **Opening explorer**: the book moves from each position (Lichess's opening tables)
- **Play/Explore**: an empty board from the starting position or a pasted FEN, where Stockfish rates every move
- **Play vs human**: a game for two at one screen, from the starting position or a pasted one. The board turns to the side to move, moves can be taken back, and the game ends on mate, a draw by the rules or by agreement, or resignation, with optional clocks. Stockfish stays off until it ends
- **My games**: every game is kept in the browser from its first move; the 50 most recent are listed, to resume one in progress or replay a finished one like a loaded game (analysis, PGN and video export included)
- **Ask Queen**: a commentary on the position from queen-pawn-8, a chess language model on a Hugging Face Space (needs a connection)
- **Export**: any game, or a stretch of it, as an MP4 video or an animated WebP
- **Layouts for every screen**: a wide desktop frame and tall phone ones; full screen where the browser allows it, and Add to Home Screen opens it as an app
- **Move sounds**: a synthesized Wood set and four of Lichess's sets
- **Offline**: a service worker keeps the page, the engine and everything they load

## Build

Needs Node 22 or later; nothing to install (Babel and Stockfish are in the repo) and no network.

1. `git clone https://github.com/boneyland/chess-replay && cd chess-replay`
2. `node build.cjs`, which writes
   - `out/chess-game-video.html`: the [claude.ai artifact](https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT), ~3.9 MB with the engine and sounds inlined (base64 wasm, started from Blob URLs)
   - `out/site/`: the self-hosted copy, which Render builds from this repo (`render.yaml`) and serves at https://chess-replay.onrender.com/: `chess-game-video.html`, plus the Stockfish and WebP encoder files (`.js` and `.wasm`, loaded from next to the page), the service worker `sw.js`, a web app manifest with its icons (from `app/icons/`), so Add to Home Screen opens it without the browser's bars, and the link-preview image `og-image.png`
3. Serve `out/site/` over HTTP, e.g. `python3 -m http.server 8765 --directory out/site`, and open http://localhost:8765/chess-game-video.html (don't open the file directly: browsers won't load the engine from a `file://` page)

Hosting `out/site/` anywhere static works the same. Ask Queen's Hugging Face sign-in only returns to URLs registered with an OAuth app, so on your own host it calls Queen without signing in, unless you register an app and put its client ID in `HF_OAUTH` (`app/queen.jsx`); a static Hugging Face Space with `hf_oauth: true` in its README supplies its own.

## Tests

- `node --test --test-concurrency=1 tests/*.test.cjs`: the JS tests (GitHub Actions runs them on every push, and the Render build before building)
- `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py` (from the repo root, after the JS tests): checks the browser's analysis against the Python pipeline. It imports chess-animator, which must be checked out next to this repo; `make_rating_expected.py` and `make_openings_expected.py` regenerate the fixtures from the Python code. Building doesn't need chess-animator
- `node --test tests/live/site.test.cjs`: smoke tests of the live site (or `LIVE_URLS=local`, a local build) in Chromium and Firefox with Playwright; GitHub Actions runs them on each push against that commit's build

## Layout

What each file and folder is, the vendored files' sources and their SHA-256 checksums: see [LAYOUT.md](LAYOUT.md).

## Licence

GPL-3.0-or-later (`LICENSE`), the same as the bundled Stockfish. The Lichess sound files keep their own licence, the AGPL-3.0-or-later, which GPL-3.0 section 13 allows them to be combined with. The WebP encoder keeps libwebp's BSD-3-Clause and the Squoosh glue's Apache-2.0 licences, both compatible with the GPL-3.0.
