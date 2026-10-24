# Chess Replay: spec

The one spec for the app: what it does now, what is planned, and the decisions behind both. Merged on 2026-10-23 from three specs (browser Stockfish, 2026-10-16; free board, 2026-10-19; Lichess data and threads, 2026-10-23), which are in git history under `docs/`. Implementation plans for the built parts are in `docs/plans/`.

**Scope.** Only the Render site (https://chess-replay.onrender.com/) matters since 2026-10-18. The claude.ai artifact still builds, but needs no parity: new features may be missing there, as long as it doesn't break.

## Contents

- [Principles](#principles)
- [Built](#built): replay and browser analysis, opening names, custom starts and flip, free board and explorer, play vs human, My games, play vs Stockfish
- [Roadmap](#roadmap): Lichess data and multi-threaded Stockfish, player names, Chess960, typed commentary, Maia3, background music
- [Known gaps](#known-gaps)
- [Decisions log](#decisions-log)

## Principles

These hold across every feature; a change that breaks one is a failure even if it works.

- **Nothing leaves the browser** unless the viewer turns it on (Ask Queen, and the planned Lichess features, each behind a toggle or button). No accounts of our own, no online play.
- **The playing video stays clean.** Buttons, progress lines and engine controls are for the paused page; the frames of a playing video look as they always have.
- **Nothing heavy starts by itself.** The engine (1.8 MB) loads on first use; whole-game analysis runs only when asked.
- **No hints in a game.** During Play vs human or Play vs Stockfish no eval bar, arrows, verdicts, book moves or engine lines show.
- **Replay doesn't regress.** A loaded game's title card, timeline, export and own-move exploration are untouched by free-board and game features (which is why the free board is a separate view).
- **Bad input explains itself.** An illegal FEN or broken PGN gets a plain message, never a crash.
- **Numbers mean what the Python pipeline's mean.** The browser's analysis JSON uses chess-animator's sign convention, mate encoding, rating and accuracy formulas.
- **Offline works.** The service worker keeps the page and all it loads; online-only features degrade quietly to "not available".

## Built

### Replay and browser analysis

The page replays a game (the sample, or a loaded PGN) as an animated video with an eval bar and graph, move ratings, best lines, commentary and the opening name. Stockfish runs in the browser for two things the precomputed data can't cover:

- **Own moves.** Drag a piece (or tap-tap) from any position. Stockfish evaluates the move as soon as it's dropped: the move in the "you" colour, the eval (streamed from ~0.5 s, final at the "Your moves" depth/time limit), "YOUR MOVE · −41 CP vs a4" with its rating colour, and a **Stockfish replies** row of up to 8 plies, clickable to play the line. Both sides of the comparison come from the browser engine (it searches the position before the move too, cached by position), so the lite engine's eval is never compared with the full engine's. Esc, a new move or stepping cancels a search.
- **Games without evals.** The empty Analysis panel offers **Analyse with Stockfish · about N min** (only while paused). While it runs the panel shows "Analysing 31 / 80 · about 1 min left", a progress bar and Stop (Stop discards the partial run: a half-rated game would mislead). When done, the game is rebuilt as if an `--analyze` JSON had been loaded. Games that already have evals (the sample, Lichess `[%eval]` PGNs) keep them; a game with PGN variations but no evals still offers Analyse.
- **Keeping it.** The result is stored with the loaded files (`files.analysis` in localStorage), so a reload keeps it, and **Save analysis** (in Settings) downloads it as `<White>-<Black>_analysis.json` in `--analyze` format.
- **Start state.** The page opens paused on the starting position with every panel visible; the empty Analysis panel says "Press play to watch the game, or drag a piece to try your own move". The first Play from that frame starts at 0:00 (title card). Reload opens on the starting position (the playhead isn't saved).
- **Analysis header** shows the actual search behind the current eval: engine, depth, time and nodes of the whole search, e.g. "Stockfish 19 lite · depth 20 (21 unfinished) · 3.0 s · 797k nodes"; the portrait frame shows only the numbers. Analyses without these show the depth only; PGN evals and the sample show the settings label.
- **Board highlights**: last move in Lichess's green (`rgba(155,199,0,0.41)`); a rated move filled in its rating colour at 60%. Everything on the board uses the dark palette's colours in both themes.
- **Ask Queen** stays in the dock (landscape) and the phone menu, not the Analysis panel (no room on small screens).

**Parity with Python** (`chess_game_analyzer.py` in chess-animator: `analyze_game`, `_classify_move`, `mate_advice`, `_calculate_player_stats`, `winning_chances`, `_eval_to_cp`). Ported, not reinvented:

- Every position searched once (start, then after each ply: N+1 searches); the search after ply i is the "before" of ply i+1.
- Centipawns from White's point of view (UCI's side-to-move score negated for Black); mates as `±(10000 − 10·N)`.
- `eval_loss` with the mate-in-N adjustment, ≥ 0, zero when the played move is the engine's, capped at 1500 for accuracy.
- Ratings: `best` under 5 cp, else Lichess win-chance drops 0.10 / 0.20 / 0.30 (K = 0.00368208); mate rules override, with `mate_advice`/`mate_line` text.
- Accuracy per side `100·exp(−0.005·avg_loss)`; `best_line` up to `BEST_LINE_MAX_PLIES` in SAN, stopping at the first illegal move; the best move is `pv[0]`.
- JSON shape as `sample_game_analysis.json`; `engine` = `{name: "Stockfish 19 lite (browser)", depth, time_limit, lines: 1, threads: 1, hash_mb}`. Per move it adds `search_time_after_ms`, `search_nodes_after`, `search_maxdepth_after` (Python ignores them). Header fields come from the PGN (empty when absent); report-only fields may be empty but present. The engine label reads like Python's `describe_search`: "depth 22, max 3s per position".
- Checked by `tests/check_browser_json.py`.

**Engine plumbing.**

- nmrugg/stockfish.js **v19.0.1 `stockfish-19-lite-single`** (28 KB `.js` + 1.8 MB `.wasm`, GPL-3.0), vendored in `vendor/`, SHA-256 pinned in README, with a GPL source link in the page. The site serves it next to the page and starts `new Worker(...)` lazily; the artifact inlines it as a blob Worker with the wasm in base64.
- One engine for the page (`SFEngine`), Hash 64 MB set once, no `ucinewgame` within an analysis. Priorities: the Stockfish opponent's `play`, then own moves, then game analysis; a running search is never interrupted.
- Search limits are Settings sliders (Game analysis, Your moves), defaults in `TWEAK_DEFAULTS`.
- Robustness: 30 s start timeout, then the worker is terminated and "Try again" retries; a dead engine reports "Stockfish stopped · play a move to restart it" and is replaced on next use; the site checks the wasm exists first; a run is dropped only when the game changes, and results merge into the current files.
- Time estimate: ~1.3 s per position on a laptop; the ETA during a run comes from the measured rate; the worst case is the time cap × positions.

Benchmarks behind the limits (2026-10-16, Node 22 on this laptop, reference native Stockfish 19 full net 4 s × 7 threads; game 1 Byrne–Fischer, 83 positions, 6 native marks; game 2 a Lichess bullet game, 63 positions, 4 marks):

| Setting | Game 1 | Game 2 | Eval gap to native (g1 / g2) | Native marks matched (g1 / g2) |
|---|---|---|---|---|
| depth 20 / 3 s | 58 s | 76 s | 66 / 54 cp | 2/6 / 2/4 |
| depth 22 / 3 s | 106 s | 112 s | 48 / 49 cp | 2/6 / 1/4 |
| depth 24 / 5 s | 180 s | 189 s | 48 / 46 cp | 2/6 / 1/4 |
| depth 24, no cap | 243 s | 275 s | 44 / 46 cp | 4/6 / 2/4 |

Every setting flags all of game 2's blunders; none finds 30.Qf8?! or 35.Kg1?! (the lite net, not depth). Deeper search mostly narrows the eval gap; one-mark rating differences are run-to-run noise. Hash 16–128 MB made no difference at depth 20; at depth 24 uncapped 32 MB filled to 95%, hence 64 MB. Peak RSS ~210 MB.

### Opening names

`openings/*.tsv` is a verbatim copy of Lichess's chess-openings tables (CC0), shared with chess-animator; updating it updates both. `openings-core.js` ports chess-animator's `OpeningBook`: positions keyed by EPD (so move orders and FEN starts both match), each named by the deepest named position on its line.

- A game whose PGN has no `Opening` header (or `?`/empty) gets its name and ECO from the book; the saved analysis JSON carries them.
- The book name of the current position sits right of the **Commentary** heading while in book, also for explored lines.
- The table is embedded in the page and built lazily on first need.

### Custom starts and flip

- `ChessCore.buildGame` accepts a `[FEN]` start: Black may move first, castling rights come from the FEN. Move numbers and sides come from `M.ply0` (`ChessCore.moveNo`), never `i % 2`.
- The engine sends `position fen <fen> moves …`; caches (`SF_EVAL_CACHE`, partial runs) key on the start FEN too.
- **Flip** turns the board, coordinates, player bars and eval bar, for loaded games and the free board; remembered like other settings. Squares become pixels only through `view()`.

### Free board and explorer

A plain board with Stockfish, separate from the replay (`app/free-board.jsx`, state in `BoardCore`), reached from the dock's **Play/Explore** menu (and the phone menu): Starting position, Paste FEN…, Copy FEN, Play vs human, Play vs Stockfish, My games.

- **Explore**: every move by either side gets Stockfish's verdict, as own moves do; the eval bar follows; Stockfish's eval and best line show before the first move too. Moves are numbered correctly from a FEN. Undo/redo with ← →.
- **Paste FEN**: one text field; the first two fields required, castling, en passant and counters used when present. Malformed or illegal FENs (including the side not to move in check) get a plain message and change nothing.
- **Copy FEN**: copies the six-field FEN of the position on the board, in the replay (a line being shown included) or on the free board; the half-move clock and move number count on from the start's. A note shows the FEN for 4 s; where the clipboard is refused it stays up, the FEN selectable with one click.
- **Opening explorer** in the Commentary box: the opening's name and the book moves that continue from the position (`openings-core.js` continuations), each clickable; a short note once out of book. No win rates or game counts (that is the Lichess explorer on the roadmap).
- **Replay these moves as a game** (Settings) opens the board's moves as a loaded game for replay, analysis and MP4/WebP export, with "Back to the free board" to return.
- The board (start FEN, moves, position in the line) survives a reload: `{ board: { fen, moves, upto } }` in the stored files.

### Play vs human

- Two players at one screen, from the starting position or the board's set-up position. The board turns to the side to move after each move. No eval, arrows, verdicts, engine replies or book moves; Stockfish starts no search.
- Ends on checkmate, stalemate, insufficient material, a dead position behind locked pawns, resignation (asks first), a draw by agreement or a claimed draw, with the result in the Analysis box and Play again / Analyse there. As in FIDE's rules, a threefold repetition or fifty moves without a capture or pawn move let the side to move **Claim a draw** (the button replaces Offer a draw); a fivefold repetition or 75 moves end the game by themselves.
- **Take back** is a button by Resign; no limit, nothing recorded. Time already spent stays used (a takeback never buys time); the move's increment comes off.
- **Time control** (optional, off by default): 5+3, 10+0, 15+10, 30+0, shown in the player bars; a flag fall loses unless the opponent has no mating material (draw). A reload charges the running clock for the time away (a flag can fall meanwhile); a game left (for another board or by closing the page) is kept in My games with the side to move's time so far used, and resumed from there with its clock running from when it opens (the time away isn't charged).
- Rules and clocks live in `PlayCore` (`app/play-core.js`); the game record is `board.game`, stored with the board.
- Leaving a game in progress asks first (and says the game is kept).

### My games

- Every game (`board.game.id`) is kept from its first move under `chess-video.games.v1` (`GamesCore`), the 50 newest, written on each move, takeback or result.
- The My games list resumes a game in progress or opens a finished one as a loaded game from `PlayCore.pgn` (replay, own moves, Analyse, Queen, Save PGN, video export). Each can be deleted. The crash screen's Clear saved data leaves the list alone.
- PGN headers: players, date, result, `[FEN]`/`[SetUp]` for custom starts, `[TimeControl]` and `%clk` when clocked.

### Play vs Stockfish

- The player picks White, Black or random; the board is drawn from the player's side and never turns. Stockfish plays at full strength (no strength setting: "prepare to get crushed") at the engine's `play` priority, after a short pause; its think time is capped so its clock doesn't flag.
- Same ends, Take back (back to the player's previous turn, Stockfish's reply included) and time controls as vs human, minus draw offers and claims: threefold repetition and the fifty-move rule end the game by themselves.
- Stockfish quietly rates the player's moves (`critique`: `{ j, cls, best, text }`); an inaccuracy, mistake or blunder is flagged in the Commentary box with a short line, and the better move and evals show only after the game.

## Roadmap

Planned, roughly in this order; each item gets its own PR(s) on a `claude/<topic>` branch. Items marked *needs design* have open questions to settle with the user before a plan.

### Lichess data and multi-threaded Stockfish

Site only; the artifact's build is unchanged and the new UI is hidden there (`window.SF_MAKE_WORKER` is set only in the artifact build, so it is the switch). Unverified facts are marked **verify**.

| # | PR | Depends on | Risk |
|---|----|-----------|------|
| 1 | `claude/multipv`: Lines setting, multi-line engine panel and arrows | none | low |
| 2 | `claude/tablebase`: endgame tablebase | none | low |
| 3 | `claude/cloud-eval`: Lichess cloud evaluation | 1 | low |
| 4 | `claude/lichess-explorer`: opening explorer and Lichess sign-in | none | medium |
| 5 | `claude/threads`: cross-origin isolation, multi-thread engine, Threads setting | 1 | high |

Ship 1 to 4 first; 5 last and alone, since its headers affect every external load.

**Shared groundwork** (built in PR 2, reused by 3 and 4):

- `app/lichess-core.js` (`window.LichessCore`, unit-tested in Node like `queen-core.js`): URL builders, parsers, a per-key LRU cache, a rate-limit gate (one request at a time per endpoint, 60 s back-off on HTTP 429 as Lichess asks), an `AbortController` per request, ~300 ms debounce after the last position change.
- Positions go as FEN built through `ChessCore` with real castling rights (the page's own FENs lack castling and en passant, see `sf-engine.js`), or as the `play` UCI list where an endpoint has one.
- Each panel has three quiet states: loading, "not available" (offline, 404, 429, blocked), data. A failed request never blocks the local engine or shows an error screen.
- `sw.js`: `lichess.org`, `explorer.lichess.ovh`, `tablebase.lichess.ovh` stay out of `KEEP_HOSTS` (live data, never served stale); check they pass through offline.
- Privacy: the player's positions leave the browser, so each feature is a Settings toggle under a new **Online data** section. Explorer and cloud eval default **off**; tablebase may default on (it only fires at 7 pieces or fewer). README gets a "Lichess data" note (what is sent, endpoints).

**PR 1: Lines (MultiPV).**

- `analysis-core.js`: `LINES = [1..5]`, `sfLines` in `engineSettings(t)` for the live engine (`own`); batch analysis keeps `lines: 1`, its JSON unchanged (Python check stays green).
- `sf-engine.js`: `search({ lines })` sends `setoption name MultiPV value N` only on change, between searches in `pump()` (like `hashWant`/`hashSet`). Parse `multipv k` in `info` (`infoToScore`, `infoStats` get `multipv`, default 1); keep the last complete line per k; results gain `lines: [{ k, cp, depth, pv }]` while `cp`, `pv`, `best` stay line 1. `bestmove` is line 1.
- Settings › Engine: "Lines" (1–5), `TWEAK_DEFAULTS.sfLines = 1`.
- Engine panel lists all lines (eval, first moves in SAN, depth); arrows: line 1 as now, others thinner and fainter; clicking a line plays or previews it; a note that more lines search slower. Never during Play vs Stockfish; the opponent always searches 1 line.
- Tests: fake-worker (option sent once on change, lines per k, stale depths dropped), parser and settings range, real Stockfish with 3 distinct first moves at the start, live test with Lines 3.

**PR 2: Endgame tablebase.** `https://tablebase.lichess.ovh/standard?fen=<FEN>` (no auth, ≤ 7 pieces) **verify** fields (`category`, `dtz`, `dtm`, `moves[]` with `uci`, `san`, `category`, `dtz`).

- `LichessCore.tablebase(fen)` → `{ category, dtz, dtm, moves }` or `null`; never called above 7 pieces.
- Engine panel (replay and free board, not in a Stockfish game): a Tablebase block with the verdict in Lichess's words (win, draw, loss, cursed win, blessed loss), DTZ/DTM, moves ranked by result; winning moves may get their own arrow colour.
- The eval bar shows the tablebase result (win as mate-like, draw 0.00) with a "TB" tag; stored analysis untouched. Cutting batch searches short with it is a later option.
- Tests: fixtures from real responses (`tests/fixtures/`), piece-count gate, cache hit, 429 back-off with a fake `fetch`.

**PR 3: Cloud evaluation.** `https://lichess.org/api/cloud-eval?fen=<FEN>&multiPv=<N>` (no auth, 404 when never analysed, rate limited) **verify** `variant`, `multiPv` limits and shape (`depth`, `knodes`, `pvs[{ moves, cp | mate }]`).

- `LichessCore.cloudEval(fen, lines)` returns the engine-result shape tagged `source: 'cloud'`; mates mapped to `±(10000 − 10·N)`.
- With the toggle on, each position asks the cloud (debounced) and runs the local search at the same time; whichever arrives first shows, the deeper replaces it, labelled "Lichess cloud, depth 40". "Prefer cloud" skips the local search when the cloud depth meets the local limit. A miss falls back silently.
- Never used for batch analysis, the Stockfish opponent or its critique.
- Tests: parser, mate mapping, 404 → null without retry loops, debounce, toggle off sends nothing.

**PR 4: Opening explorer.** `https://explorer.lichess.ovh/lichess?fen=<FEN>&moves=12&topGames=4&recentGames=0` (and `/masters`) **verify** whether a Bearer token is required.

- Sign-in: Lichess OAuth2 PKCE (no client registration, no scopes for public data **verify**), like the HF sign-in (`HF_OAUTH.redirect` in `queen.jsx`), with a pasted personal token as the fallback. The token is kept in its own localStorage key, sent only to Lichess hosts, cleared by Sign out, treated like the HF token by Clear saved data. Redirect URLs in README next to the HF note, plus a CLAUDE.md gotcha.
- `LichessCore.explorer(fen, { db, ratings, speeds })` → totals, `moves: [{ uci, san, white, draws, black, averageRating }]`, `topGames`, `opening`.
- An Explorer panel (replay and free board, not in games): moves with game counts and a white/draw/black bar, click to play on the free board; name and ECO from the response, the local book as fallback and as the default when off. Database (Lichess, Masters) and rating/speed filters in settings.
- Tests: parser, token header only when signed in, 401 → "Sign in to use the explorer", filters change the cache key.

**PR 5: Multi-threaded Stockfish lite.** stockfish.js v19.0.1 multi-thread lite **verify** file names and sizes; vendored and pinned as now. The single-thread files stay as the artifact's engine and the site's fallback.

- Cross-origin isolation: `render.yaml` headers on `/*`: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`. Then audit every cross-origin load (`grep https:// app/`): cdnjs/jsdelivr scripts (already `crossorigin` with SRI), Google Fonts (`crossorigin` on the links), Lichess `fetch` (CORS), the HF sign-in (must be a redirect, not a popup, under COOP), the Queen `mcp` call.
- `sw.js` re-serves responses with the isolation headers and keeps the new engine files; `tests/live/serve.cjs` sends the same headers and the live suite asserts `crossOriginIsolated`.
- `stockfish.jsx` `sfFiles()` picks the threaded build when `crossOriginIsolated && SharedArrayBuffer` and not the artifact; any failure falls back silently to single-thread, with Threads disabled and the reason shown.
- Settings › Engine: **Threads** 1 to `min(hardwareConcurrency − 1, 8)`, default half the cores up to 4 (`sfThreads`); `setoption Threads` applied between searches like Hash/MultiPV, restarting the worker when idle if the build needs it **verify**. Hash is shared by all threads.
- Batch JSON records threads; `sfPartialKey` includes them; the Python check runs with 1 thread (multi-thread results aren't reproducible). Pace estimates keyed by thread count. Check the Stockfish opponent's movetime and critique timing.
- Tests: fake-worker option order and restart, settings, file choice; live: isolated page, Threads 4 + Lines 3 shows three lines and higher nps, offline reload keeps the headers, fonts/React load, HF sign-in returns. Manual: phone, iOS Safari (silent fallback), desktop Firefox.
- Rollback: delete the two header lines in `render.yaml`.

**Cross-cutting**: Settings gains Online data (toggles, sign-in, filters) and Engine (Threads, Lines, Hash) sections, defaults conservative in `TWEAK_DEFAULTS`; README and CLAUDE.md updated (straight to `main`); screenshots per the repo rule; every feature degrades to "not available" offline.

### Player names (*needs design*)

In Play vs human set White's and Black's names; in Play vs Stockfish the player's (Stockfish is "Stockfish 19"). Open: asked in the Play dialog or set later; whether the last names are remembered; where they show (player bars, My games rows, the PGN's `White`/`Black`, where `PlayCore.pgn` writes "White"/"Black" today).

### Chess960

From a FEN with X-FEN or Shredder-FEN castling, using Stockfish's `UCI_Chess960`; today `buildGame` rejects it ("Chess960 positions aren't supported yet"). The only variant: three-check, King of the Hill, crazyhouse, atomic, horde, antichess and racing kings are out of scope (another rules engine and a variant Stockfish). Must also read Lichess 960 exports (`[Variant "Chess960"]`, `KQkq` with the king off e1) and reordered rights (`kqKQ`), which today get "Castling rights don't match the pieces".

### Typed commentary (*needs design*)

The user types their own comment on a move. Open: where (replay, free board, a game from My games, all); how it sits with PGN comments, Claude's commentary, the notes file and Queen in the Commentary box (each now a Settings toggle) and in the video; whether Save PGN writes it as `{ }`; where it is kept (with the loaded game, with a My games entry, which ties in with replayed games losing their analysis and commentary today).

### Maia3 (*needs design*)

Maia predicts human moves at a chosen rating, unlike Stockfish's best move. Open: what for (an opponent in Play vs Maia, "what a human would play" beside Stockfish, or both); whether it runs in the browser (weights, runtime, size, licence) or would need a server (which the principles rule out without the user's say); which ratings.

### Background music

Music that plays under the page, chosen from a few bundled tracks or the viewer's own file. Added 2026-10-23.

Decided by the user:

- **Plays on the replay page, playing or paused, and on the free board and in games** (Play vs human, Play vs Stockfish).
- **Not in exported videos**: MP4 export keeps the move sounds only.
- **Sources**: a small set of bundled free tracks, and an audio file from the viewer's device.

Proposed (my calls, to confirm when designing):

- **Settings › Sound**, beside the move sounds: a **Music** select (Off, each bundled track, "Your file…") and its own volume slider. Defaults in `TWEAK_DEFAULTS`: `music: 'Off'`, `musicVolume` around 40, so existing viewers hear nothing new until they choose. The move-sound toggle doesn't touch music.
- **One player for the whole app**, so music carries on when switching between the replay and the free board, and isn't restarted by loading a game. The chosen track loops.
- **Autoplay rules**: browsers start audio only after a user gesture. Choosing a track in Settings starts it; after a reload it starts on the first click or key on the page. No "tap to play music" prompt.
- **Pauses while the tab is hidden** and resumes on return (battery on phones).
- **Bundled tracks**: 3 to 5 calm instrumental loops, licences that allow redistribution with a GPL-3.0 app (CC0 preferred; CC-BY credited in README and Settings), listed with source and licence in README like the Lichess sounds. MP3 or AAC (plays on iOS Safari), ~96–128 kbps, a few MB each, in `vendor/music/` and served next to the page, never inlined; a track downloads only when chosen. The service worker keeps a track once played, so it works offline after that; tracks aren't precached.
- **Viewer's file**: a file picker for `audio/*`, played locally and never uploaded. Kept in IndexedDB (too big for localStorage), one file at a time, with a size cap (e.g. 30 MB) and a plain message when it's over or won't decode. Clear saved data removes it.
- **Not on the artifact.**

Open questions:

1. Which mood or genre for the bundled tracks (piano, lo-fi, classical, ambient), and does the user have tracks in mind?
2. One track looped, or play the bundled tracks in turn (with shuffle)?
3. A quick mute in the dock or phone menu, or Settings only?
4. Should music duck (drop in volume) under move sounds, Queen, or a game's end?

## Known gaps

Deferred by the per-plan reviews; each was true when recorded and may since have been fixed.

**Custom starts and flip** (2026-10-19)
- The player bars' "+N" counts captures during the game only, so a FEN start with a material edge shows none.
- `LineChips` numbers moves itself rather than through `ChessCore.moveNo`.
- Untested by the live suite: the sideways phone layout flipped, flipped arrows and line board, a flipped or FEN-start video export, and the F key's guards.

**Free board** (2026-10-19)
- A Stockfish reply played from the reply chips is labelled "Your move" after a reload: the stored board keeps UCI moves only, not who played them.
- On the free board Settings still shows the "Game analysis" sliders, which apply only to loaded games.
- Desktop board mode leaves empty space under the board where the eval graph was.
- After Enter plays an explorer row, focus drops to the page; the next Tab lands on the new list's first row.
- Playwright's Firefox drops mouse drags when `hasTouch` is on, so the phone parts of the free-board live tests tap or check layout only.

**Play vs human** (2026-10-19)
- A draw can only be claimed in the position on the board, not by announcing the move that would make the repetition or the fiftieth move.
- Dead positions are found only behind locked pawns (an en-passant capture on offer counts as a pawn break), with kings, pawns and bishops all on one colour of square (`PlayCore.lockedDead`: every pawn blocked, no capture possible, neither king nor any bishop able to reach an enemy pawn it could take; a king a bishop can reach always has a square of the other colour to step to, and the kings never meet). Knights, rooks, queens, bishops on both colours, a pawn break either king could make, or a position dead for other reasons (a forced line) play on; finding those needs a helpmate search (CHA-style).
- A flag fall in a dead position the check can't prove (see above) still loses: the flag rule looks at material only. Positions it proves dead have already ended the game.
- Play again and Analyse in the Analysis box scale with the frame on the phone.

**My games** (2026-10-20)
- A replayed game's Stockfish analysis, Queen answers and commentary stay with the loaded game: opening it from My games again starts without them.
- Leaving a game in progress still asks, though the game is kept.
- The same game open in two tabs is one entry; each tab's moves replace the other's.

**Play vs Stockfish** (2026-10-21)
- Playing Black, if the engine dies before Stockfish's first move there is nothing to take back: only Resign or a reload restarts it.
- A move played before the "before" search reaches depth 15 (just after the engine loads), and the move before a reload, go unrated.
- On the phone the Commentary box cuts the how-it-works text short (it scrolls).
- The header's site line says "from a FEN" where the Commentary box says "From a set-up position" (vs human too).
- Settings still shows the "Your moves" sliders during a Stockfish game, where they don't apply.
- No draw offers against Stockfish; the player can resign while Stockfish thinks.

## Decisions log

- 2026-10-16: browser Stockfish approved: lite single-thread v19.0.1 (not lichess-org/stockfish-web), depth 22 / 3 s for games and 24 / 3 s for own moves (later Settings sliders), Hash 64 MB; Analyse is a button in the empty Analysis panel, shown only while paused; start paused; keep results both in the browser and as a download; site for sure, artifact best effort. Lichess opening names added.
- 2026-10-16/17, after trying it: Ask Queen stays in the dock; header shows the real search stats; board highlight colours; book name by the Commentary heading; own moves after the first fixed (live checks use real mouse input from then on).
- 2026-10-18: the Render site is the only target; Netlify dropped.
- 2026-10-19: free board approved, including the "my call" items; separate view from the replay; clock presets under 5 minutes dropped; Chess960 the only variant; Stockfish at full strength.
- 2026-10-19, after the free-board PR preview: Stockfish's eval and line before the first move; Replay these moves as a game.
- 2026-10-19, after the vs-human PR: New board renamed Play/Explore; Take back a button by Resign; Resign asks first; draw by agreement added.
- 2026-10-20: Maia3, typed commentary and player names added to the roadmap.
- 2026-10-21, after the vs-Stockfish PR: the Clock row is Time control; 5+0 became 5+3 (a game stored at 5+0 keeps its clock).
- 2026-10-23: Lichess data and threads planned: explorer sign-in by Lichess OAuth (PKCE) with a pasted token fallback; cloud eval and explorer default off; Threads default half the cores up to 4; COEP `require-corp`.
- 2026-10-23: vs human, threefold repetition and the fifty-move rule are claimed (fivefold and 75 moves automatic); a reload charges the running clock; a game resumed from My games runs its clock from then. Against Stockfish they stay automatic. A takeback giving back the time spent was tried and dropped: it felt like cheating.
- 2026-10-23: dead positions behind locked pawns end the game (both modes), proven by flood fills, not a search: a position it can't prove plays on. Bishops of one colour count too (after a game reached one with a dark bishop walled in behind its own pawns).
- 2026-10-23: specs merged into this file. Background music added: plays on the replay (also paused), free board and games; not in exports; bundled tracks plus the viewer's own file.
