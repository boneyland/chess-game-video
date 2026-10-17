# Chess Game Video

Browser player for annotated chess games: the claude.ai artifact, https://chess-replay.netlify.app/ and https://chess-replay.onrender.com/. Split out of `~/projects/chess-animator` (Python/Manim renderer) on 2026-10-17; that repo must stay checked out next to this one.

## Commands
- `node build.cjs` - writes `out/chess-game-video.html` (artifact, engine inlined) and `out/site/` (page + two Stockfish files)
- `node --test --test-concurrency=1 tests/*.test.cjs` - JS tests (also writes `tests/out/`)
- `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py` - checks the browser's analysis JSON against the Python pipeline; run after the JS tests
- Preview: `python3 -m http.server 8765 --bind 127.0.0.1 --directory out/site` with the sandbox disabled (a sandboxed server is unreachable from Playwright, and `file://` is blocked); phone layout = 390×844 viewport

## Publishing (only when asked)
1. Artifact: publish `out/chess-game-video.html` to https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT (Artifact tool, `url` set). In a new session the first publish is refused and returns the live diff; check it holds only your changes. The next unchanged resend is refused too (a deliberate double-check); send it a third time and it goes through
2. Netlify: the app has its own Netlify site (chess-replay), built from this repo by `netlify.toml` on every push to `main` (pushes that touch nothing in the page are skipped by its `ignore` rule). Production publishing is locked: a push builds a deploy, and the user publishes it from the Deploys page; deploy previews are cheap. Say a push is ready to publish, don't poll the live site. The notes site (Obsidian vault, boneyland.netlify.app) only embeds it now, and redirects the old `/files/chess-game-video.html` here
3. Render: a static site (chess-replay) built from this repo on every push to `main` (`node build.cjs`, publish `out/site`); its rewrite `/` → `/chess-game-video.html`, Cache-Control header and build filters are set in the Render dashboard, not in the repo. Auto-deploy is on, so a push that touches the page goes live there at once

## Workflow
- Small commits on `main`; remote is `origin` (github.com/boneyland/chess-game-video), push only when asked
- Visual changes: screenshot desktop (1440×900) and phone layouts and show the PNG paths before committing; the user usually tweaks sizes
- Board/overlay checks: drive with real `page.mouse` input, not `dispatchEvent` (synthetic events once hid an overlay swallowing taps)

## Gotchas
- Layout lives in `app/game-video-core.jsx`: `LAYOUTS.wide` is the 1920×1080 frame, `tallLayout(H)` the 840-wide phone frame (scaled to fit, so phone text reads smaller); the frame's outer padding is `.stage-tall` in `app/shell.html`
- Settings defaults are `window.TWEAK_DEFAULTS` in `app/shell.html`; viewers' changed settings persist in localStorage and override new defaults
- Hugging Face sign-in returns to the folder the page is served from (`HF_OAUTH.redirect` in `app/queen.jsx`); every such URL must also be listed in the HF OAuth app's redirect URLs (huggingface.co/settings/applications), exactly, trailing slash included
- Ask Queen calls the user's HF Space boneyland/queen-pawn-8 (`gr3_queen_pawn_8_analyse_position`, `{fen, moves}`) via the artifact's `mcp` capability; its answer is a Python dict repr (`pyParse` in `app/queen.jsx`). ZeroGPU quota is small (~20–33 s per position): never suggest whole-game Queen runs without the cost
- Not on Codeberg: its Terms of Use (§ 2 (1) 7) forbid projects mostly written by generative AI, which this one is (tried and taken down 2026-10-17)
- `vendor/` is stockfish.js v19.0.1 lite-single (GPL-3.0), pinned by SHA-256 in README; `openings/` is a copy of chess-animator's Lichess tables
- `docs/` (browser Stockfish design/plan) predates the split: its `artifact/...` paths are now repo-root paths
- `games/` (local PGNs) and `.superpowers/` (scratch) are untracked; never commit them
