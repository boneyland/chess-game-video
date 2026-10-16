# Browser Stockfish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stockfish 19 lite runs in the Chess Game Video page to evaluate the viewer's own moves and, on request, analyse a game with no evals into the same JSON `run_animator.py --analyze` writes; the page also names openings from Lichess's book, opens paused, and moves Ask Queen into the Analysis panel.

**Architecture:** Three new plain-script units with no React — `analysis-core.js` (pure port of the Python rating/stats/JSON logic), `openings-core.js` (pure port of `OpeningBook`), `sf-engine.js` (UCI-over-Worker wrapper with a priority queue) — each a `window.*` global like `ChessCore`, unit-tested in Node. A React unit `stockfish.jsx` holds the hooks that join them to the page. The engine gets positions as `position startpos moves …` (the page's own FENs lack castling and en-passant).

**Tech Stack:** Plain JS + React 18 (precompiled by `build.cjs` with @babel/standalone), stockfish.js v19.0.1 `lite-single`, `node --test` (Node 22) for JS tests, `unittest` in `.venv` for the Python-side check.

**Spec:** `artifact/docs/2026-10-16-browser-stockfish-design.md` (approved 2026-10-16). Read it first; this plan argues from it.

## Global Constraints

- `artifact/` is local only (`.git/info/exclude`). **Never `git add` anything under `artifact/` or `.superpowers/`.** There are no commits in this plan; each task ends with its tests green and `node build.cjs` succeeding.
- Engine: stockfish.js **v19.0.1** `stockfish-19-lite-single.js` (SHA-256 `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a`) + `.wasm` (`ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de`), vendored in `artifact/vendor/`; GPL-3.0.
- Search limits: full game `go depth 22 movetime 3000`; own moves `go depth 24 movetime 3000`; `setoption name Hash value 64` once; one engine instance per page.
- Engine label: `"Stockfish 19 lite (browser)"`; header text "Stockfish 19 lite · browser · depth 22, max 3s per position".
- Evals in centipawns from White's point of view; mate = `±(10000 − 10·N)`; the Python constants (`BEST_MAX_LOSS_CP = 5`, win-drop 0.10/0.20/0.30, `K = 0.00368208`, `MAX_EVAL_LOSS_FOR_ACCURACY = 1500`, `MATE_INACCURACY_CP = 999`, `MATE_MISTAKE_CP = 700`, `MATE_BAND_CP = 1000`, `MATE_STEP_CP = 10`, `BEST_LINE_MAX_PLIES = 12`, `MATE_LINE_MAX_PLIES = 9`, mate advice strings) copied verbatim from `chess_game_analyzer.py`.
- Buttons (Analyse, Stop, Ask Queen) render only while paused; the playing video looks exactly as today.
- Nothing engine-related loads until the first own move or Analyse press.
- Memory (this laptop freezes under pressure): one headless browser at a time, lite engine only; Node engine tests spawn one engine at a time.

## Review Focus

1. **A game that ends in checkmate or stalemate** — the final position has no legal move (`bestmove (none)`, `score mate 0` / `cp 0`); analysis must finish and rate the mating move like Python (no spurious blunder). Test in Task 1 (`rateMove` fixture rows with mates) and Task 4 (integration on a mating fixture).
2. **Castling and en-passant in own lines** — a line starting before castling must reach the engine with castling rights intact. Pinned by Task 3's `positionCommand` test and Task 6's browser check (castle in an own line, eval is sane).
3. **The viewer changes game mid-analysis** (loads another PGN, picks another game, "Back to sample") — the run must stop and must not write its result into the new game. Test in Task 4 (`runAnalysis` honours `signal.aborted`) and Task 5's browser check.
4. **Engine fails to start** (claude.ai CSP, wasm blocked, file missing on Netlify) — page shows the fallback note, never a spinner forever. Test in Task 3 (`ready()` rejects after timeout with a fake worker that never answers).
5. **Reload after analysis** — stored analysis comes back and the button doesn't reappear; `localStorage` full shows the existing "too large to remember" message. Covered by Task 5's browser check.

---

### Task 1: `analysis-core.js` — Python rating, stats and JSON, ported

**Files:**
- Create: `artifact/app/analysis-core.js`
- Create: `artifact/tests/analysis-core.test.cjs`
- Create: `artifact/tests/fixtures/` — copy `sample_game_analysis.json` and `games/soda-vs-neo_analysis.json` (10 mate-advice moves) as `byrne-fischer_analysis.json`, `soda-neo_analysis.json`
- Create: `artifact/tests/load.cjs` — test helper: `loadUnit(relPath)` sets `global.window = globalThis` and `require`s a plain-script unit

**Interfaces:**
- Produces `window.AnalysisCore`:
  - `infoToScore(line: string, sideToMove: 'w'|'b') → { cp: number /* White POV, mate-encoded */, depth: number, pv: string[] /* uci */ } | null` — parses a UCI `info` line with `score`; ignores `lowerbound`/`upperbound` lines (returns null).
  - `rateMove({ bestEval, currentEval, isWhite, playedIsBest, isCheckmate }) → { evalLoss: number, classification: ''|'best'|'inaccuracy'|'mistake'|'blunder', mateAdvice: string }`
  - `mateLine(beforeEval: number, pvSans: string[]) → string` — `"Mate in N: …"` with the `MATE_LINE_MAX_PLIES` cut and `" ..."`.
  - `playerStats(moves: MoveRecord[]) → { accuracy: number, ... }` (same keys as `_calculate_player_stats`)
  - `buildAnalysisJson({ headers, moves, opening, engine }) → object` — the `sample_game_analysis.json` shape (every top-level and per-move key present).
  - Constants exported as `AnalysisCore.C`.

- [ ] **Step 1: Write the failing tests** in `analysis-core.test.cjs`:
  - `rateMove reproduces Python on every move of both fixtures`: for each fixture move `m`, `rateMove({ bestEval: m.best_eval, currentEval: m.eval_after, isWhite: m.is_white_move, playedIsBest: m.move_uci === m.best_move_uci, isCheckmate: m.move_san.endsWith('#') })` deep-equals `{ evalLoss: m.eval_loss, classification: m.classification, mateAdvice: m.mate_advice }`.
  - `playerStats reproduces accuracy`: for each fixture and side, `Math.abs(playerStats(sideMoves).accuracy − fixture.white_stats.accuracy) < 1e-9` (same for black).
  - `infoToScore`: `('info depth 20 seldepth 30 score cp 35 nodes 1 pv e2e4 e7e5', 'b')` → `{ cp: -35, depth: 20, pv: ['e2e4','e7e5'] }`; `('… score mate 3 … pv …', 'w')` → `cp: 9970`; `('… score mate -2 …', 'w')` → `-9980`; `score mate 0` with side to move `'b'` (Black is mated) → `10000`; with `'w'` → `-10000`; a `lowerbound` line → `null`.
  - `buildAnalysisJson keys`: the result's top-level keys and the first move's keys equal those of the Byrne–Fischer fixture (order-insensitive).

- [ ] **Step 2: Run** `node --test artifact/tests/` — expected FAIL (`AnalysisCore` undefined).

- [ ] **Step 3: Implement** `analysis-core.js` as an IIFE assigning `window.AnalysisCore`, porting `winning_chances`, `_classify_move`, `mate_advice`, the `eval_loss` block of `analyze_game` (mate-in-N step adjustment, clamp, zero when played is best, cap 1500), `_calculate_player_stats`. `rateMove` skips mate rules when `playedIsBest` or `isCheckmate`, exactly as `analyze_game` does.

- [ ] **Step 4: Run** `node --test artifact/tests/` — expected PASS.

### Task 2: `openings-core.js` — the Lichess opening book, ported

**Files:**
- Create: `artifact/app/openings-core.js`
- Create: `artifact/tests/openings-core.test.cjs`
- Create: `artifact/tests/fixtures/openings-expected.json` — generated once by `artifact/tests/make_openings_expected.py` (run with `.venv/bin/python`): for each `games/*.pgn` game and `sample_game.pgn`, `{ ucis, byPly: [name|null…], identify: {eco,name}|null }` from `chess_openings.OpeningBook.load()`
- Modify: `artifact/build.cjs` — new unit `openings-data.js` = `window.OPENINGS_TSV = <JSON string of the five ../openings/*.tsv concatenated, header rows removed>`
- Modify: `artifact/app/chess-core.js` — export on `window.ChessCore`: `applySan(pos, san) → { pos, uci }` (wraps `sanToMove` + `applyMove`) and `applyUci(pos, uci) → { pos, san } | null` (null when illegal; SAN via the existing `sanOf`)

**Interfaces:**
- Produces `window.Openings`: `book() → Book` (lazy, cached; builds from `window.OPENINGS_TSV`), `Book.byPly(ucis: string[]) → ({eco,name}|null)[]`, `Book.identify(ucis) → {eco,name}|null`.
- Position key must equal python-chess `board.epd()` semantics: placement, side, castling rights (tracked: lost when the king moves or a rook leaves / is captured on its home square), and the en-passant square **only when a legal en-passant capture exists**.

- [ ] **Step 1: Write the failing tests**: `byPly and identify match Python on every fixture game` (deep-equal per game); `build time`: `book()` from cold under 300 ms (print the measured ms either way).
- [ ] **Step 2: Run** the generator, then `node --test artifact/tests/` — expected FAIL.
- [ ] **Step 3: Implement** `openings-core.js` (port of `OpeningBook.from_rows`: name the last position of each line; every position takes the deepest named position before it on its line, first in data on ties). Replay SAN with `ChessCore.applySan`; track castling rights and legal en passant in the key yourself.
- [ ] **Step 4: Run** tests — expected PASS. If the build time is over 300 ms, move the table build into `build.cjs` (emit the EPD→opening map instead of the TSV), re-run, and note the page-size change.

### Task 3: `sf-engine.js` — UCI over a Worker, with a priority queue

**Files:**
- Create: `artifact/vendor/stockfish-19-lite-single.js`, `artifact/vendor/stockfish-19-lite-single.wasm` (from the v19.0.1 release; verify the SHA-256s above)
- Create: `artifact/app/sf-engine.js`
- Create: `artifact/tests/sf-engine.test.cjs`, `artifact/tests/node-worker.cjs` (adapter: spawns `node vendor/stockfish-19-lite-single.js` with `detached: true`, exposes `postMessage(str)`, `onmessage = ({data})`, `terminate()`)

**Interfaces:**
- Consumes: `AnalysisCore.infoToScore`.
- Produces `window.SFEngine`:
  - `create(makeWorker: () => WorkerLike, { hashMB = 64, readyTimeoutMs = 10000 }) → Engine`
  - `Engine.ready() → Promise<void>` (sends `uci`, `setoption name Hash value 64`, `isready`; rejects on worker `error` or timeout)
  - `Engine.search({ moves: string[] /* uci from startpos */, depth, movetimeMs, priority: 'own'|'game', onInfo?: (score) => void }) → { promise: Promise<{ cp, depth, pv: string[], best: string|null }>, cancel(): void }` — one search at a time; an `'own'` request runs before queued `'game'` requests (never interrupts a running one); `cancel()` of the running search sends `stop` and resolves with what it had; cancelled queued requests never start.
  - `positionCommand(moves: string[]) → string` — `"position startpos"` or `"position startpos moves …"`.
  - `Engine.quit()`.

- [ ] **Step 1: Write the failing tests** with a scripted fake worker: `ready rejects after readyTimeoutMs when the worker is silent`; `own search jumps the queue` (enqueue game A, game B, own C while A runs → order A, C, B); `cancel of queued search never posts go`; `positionCommand([])` → `'position startpos'`. Integration (real engine via `node-worker.cjs`, one at a time): `castling rights survive` — `search({ moves: ['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6'], depth: 12 })` resolves with a legal best move and depth 12; `mated position` — after Fool's mate (`f2f3 e7e5 g2g4 d8h4`, White to move and mated) resolves with `best: null, cp: -10000`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `sf-engine.js`.
- [ ] **Step 4: Run** — PASS.

### Task 4: Full-game analysis runner

**Files:**
- Modify: `artifact/app/analysis-core.js` — add `runAnalysis`
- Modify: `artifact/tests/analysis-core.test.cjs`
- Create: `artifact/tests/check_browser_json.py` (unittest, run with `.venv/bin/python -m unittest artifact/tests/check_browser_json.py`)

**Interfaces:**
- Consumes: `Engine.search`, `rateMove`, `mateLine`, `playerStats`, `buildAnalysisJson`, `Openings.book()`, `ChessCore.applySan`, `ChessCore.applyUci` (SAN of best lines and PVs).
- Produces `AnalysisCore.runAnalysis({ engine, ucis: string[], sans: string[], headers: object, signal: { aborted: boolean }, onProgress: (done: number, total: number) => void }) → Promise<object|null>` — N+1 searches at `depth 22, movetime 3000, priority 'game'`; returns the analysis JSON, or `null` when `signal.aborted` became true (stops after the current search). `engine` block: `{ name: 'Stockfish 19 lite (browser)', depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64 }`. Opening: headers `Opening`/`ECO` unless empty/`?`/`Unknown`, else `Openings.book().identify(ucis)`.

- [ ] **Step 1: Write the failing tests**: `runAnalysis on a mating game` (real engine; the 8 plies of a short mate such as Scholar's mate) (Scholar's mate, 7 plies: `e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7`) returns 7 moves, the last with `eval_after` `10000` and `classification` not `'blunder'`; `abort` (fake engine) → resolves `null` and makes no further `search` calls; `progress` called `(0,N)` first and `(N,N)` last. Python: `check_browser_json.py` loads a JSON written by the integration test via `AnalysisData.from_json_file`, asserts `engine_summary()` starts with `"Stockfish 19 lite (browser) · depth 22"` and contains `"3s per position"`, and `len(moves) == N` (so `runAnalysis` must fill each move's `search_depth`/`search_depth_after` with the depth reached).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS) — both test commands.

### Task 5: Page wiring — analyse button, progress, keep & save

**Files:**
- Create: `artifact/app/stockfish.jsx` — hooks: `useEngine()` (lazy `SFEngine.create`, returns `{ get(): Promise<Engine>, status: 'idle'|'loading'|'ready'|'unavailable' }`), `useGameAnalysis(M, files, commit, engine)` → `{ state: 'idle'|'running'|'done', done, total, etaSec, start(), stop() }`
- Modify: `artifact/build.cjs` — units in order: `analysis-core.js`, `openings-data.js`, `openings-core.js`, `sf-engine.js` after `chess-core.js`; `stockfish.jsx` concatenated into the `game-video.jsx` unit before `game-app.jsx`; copy both `vendor/` files into `out/site/`
- Modify: `artifact/app/game-app.jsx` — wire the hooks; on finish `commit({ ...files, analysis: json, analysisName: '<White>_<Black>_analysis.json' })` (persists via the existing store); **Save analysis** button in Settings › Game next to "Save commentary as notes file", same download path as `downloadNotes`; changing `files` aborts a running analysis
- Modify: `artifact/app/game-video-core.jsx` — `Analysis` empty state: while paused, "No engine analysis for this game." + primary **Analyse with Stockfish · about N min** (N = ⌈plies × 1.3 s / 60⌉) + "Stockfish 19 lite runs in your browser."; while running: "Analysing d / N · about X left" + bar + **Stop** (paused only); when the engine is `unavailable`: "Stockfish can't run here." + link to `https://boneyland.netlify.app/files/chess-game-video.html` when `IN_CLAUDE`
- Modify: `artifact/app/chess-core.js` — engine label: with both `depth` and `time_limit`, `depth 22, max 3s per position` (Python `describe_search`)

- [ ] **Step 1: Build and serve:** `node artifact/build.cjs`; serve `artifact/out/site/` with `python3 -m http.server` from that directory.
- [ ] **Step 2: Browser check (Playwright, one browser):** load a PGN with no evals (`games/lichess_pgn_2026.09.28_boneyland_vs_Futur_ist.NWhLXQYC.pgn` stripped of `%eval` if present) → button shows only while paused → run completes → ratings, eval plot and accuracy appear; reload → analysis is back, no button; Save analysis downloads a file that `check_browser_json.py` accepts; start a run then "Back to sample game" → sample shows unchanged, no late write.
- [ ] **Step 3: Fix what failed, repeat Step 2.**

### Task 6: Own-move evaluation

**Files:**
- Modify: `artifact/app/stockfish.jsx` — `useMoveEval(engine, baseUcis: string[], line: {uci}[], upto: number)` → `{ before: Score|null, after: Score|null, pending: boolean }`; searches the positions before and after `line[upto]` at `depth 24, movetime 3000, priority 'own'`; caches by the move list joined with spaces; cancels on change; streams `onInfo`
- Modify: `artifact/app/game-video-core.jsx` — `Analysis` when `vline.src === 'you' && vline.upto >= 0`: the move in `lineAccent('you')`, "YOUR MOVE · −N CP vs <best SAN>" + rating colour (from `rateMove` on the two scores), **EVAL** (“…” until the first info), **Stockfish replies** chips (≤ 8 plies of `after.pv`, clickable through the existing `onLine` path)

- [ ] **Step 1: Browser check:** pause on the sample game, drag a move → eval appears within ~0.5 s and settles by 3 s; a reply chip plays the line; castle in an own line from the start position (1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.O-O) → sane eval; Esc returns to the game; a second move in the line is evaluated too; during a full-game analysis, an own move answers within ~3 s.
- [ ] **Step 2: Fix and repeat.**

### Task 7: Start paused, Ask Queen in the panel, per-ply book name

**Files:**
- Modify: `artifact/app/engine.jsx` — `Stage`: `playing` initial `false`; initial time = the value passed as a new prop `startTime` (when given) instead of the stored playhead; first Play on that untouched frame seeks to 0 then plays
- Modify: `artifact/app/game-video-core.jsx` / `game-app.jsx` — pass `startTime = settled(-1)` (`S.tp[0] − 0.3`); Ask Queen button in the `Analysis` panel header (paused only, every game), removed from `dockItems`; the existing opening line shows `Openings.book().byPly(ucis)[c]` while in book, nothing after
- Modify: `artifact/app/chess-core.js` `buildGame` — when the `Opening` header is missing/`?`/`Unknown`, fill `eco`/`opening` from `Openings.book().identify`

- [ ] **Step 1: Browser check** at 1280×800 and 390×844: page opens paused with all panels and both buttons; first Play starts at the title card; Ask Queen opens the Queen panel and is tappable at phone width; the dock has no Ask Queen; a PGN without `Opening` header shows the book name; the opening line changes ply by ply and disappears out of book.
- [ ] **Step 2: Fix and repeat.**

### Task 8: Ship — Netlify copy, artifact best effort, docs

**Files:**
- Modify: `artifact/app/sf-engine.js` / `stockfish.jsx` — `makeWorker` for claude.ai: Blob Worker from the inlined glue, wasm as a Blob URL passed in the hash (`new Worker(glueURL + '#' + encodeURIComponent(wasmURL))` — the glue reads `self.location.hash`), wasm bytes inlined as base64 by `build.cjs` in the artifact build only
- Modify: `artifact/README.md` — vendor files + SHA-256s, the three deploy files, the GPL note; Settings gets "Stockfish 19 (GPL-3.0) · source" linking https://github.com/nmrugg/stockfish.js

- [ ] **Step 1:** `node --test artifact/tests/` and the Python check — PASS; `node artifact/build.cjs`.
- [ ] **Step 2:** Ask the user before deploying: copy `out/site/chess-game-video.html` and both `stockfish-19-lite-single.*` into `~/Documents/Obsidian/personal/docs/files/`; after their Netlify deploy, `curl -I` the `.wasm` → `200` with `content-type: application/wasm`.
- [ ] **Step 3:** Publish `out/chess-game-video.html` to https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT; ask the user to try an own move there. If the engine doesn't start, confirm the fallback note shows, drop the inlined wasm from the artifact build (back to ~250 KB), and record the reason in the README.
