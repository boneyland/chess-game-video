# Browser Stockfish for the Chess Game Video page

Date: 2026-10-16. Sources: `artifact/` in the chess-animator repo (local only, never committed; build with `node build.cjs`).

## Intent

The Chess Game Video page shows Stockfish's verdicts only when they were computed beforehand: by `run_animator.py --analyze` (an analysis JSON) or by Lichess (`[%eval]` in the PGN). Two things have no engine at all today:

1. **Your own moves.** You can drag pieces to try a move from any position, but the page says nothing about the move.
2. **PGNs without evals.** The Analysis panel says "No engine analysis loaded", and getting one means installing Python, Stockfish and running `--analyze`.

Running Stockfish in the browser fixes both. The page is now public on Netlify (https://boneyland.netlify.app/files/chess-game-video.html), so visitors without the Python tooling benefit too.

## Goals

- Evaluate the viewer's own moves automatically, as soon as a piece is dropped: the eval score and Stockfish's best reply line.
- Analyse a whole game without evals in the browser, **only when the viewer asks**, producing the same data `--analyze` produces (evals, move ratings, best lines, accuracy) so the rest of the page works unchanged.
- Keep the result: remembered in the browser, and downloadable as an analysis JSON that `run_animator.py` accepts.
- Start the page paused on the starting position so the controls are visible straight away.
- Move Ask Queen from the dock into the Analysis panel.
- Name the opening (ECO + name) from Lichess's opening data for any game whose PGN doesn't, like the Python video does.

## Non-goals

- Replacing evals a game already has. The bundled sample and PGNs with `[%eval]` keep theirs; the Analyse button appears only when a game has no evals at all.
- The full Stockfish net (99 MB wasm) or multi-threaded builds (need COOP/COEP headers, which complicate the iframe embed in the MkDocs note).
- Multiple lines (MultiPV), alternatives, or an always-on "live engine" while the video plays.

## Anti-goals (a failure even if it works)

- Anything engine-related showing up in the *playing* video. The buttons and progress line are for the paused page only; the video frames must look as they do today while playing.
- Analysis starting by itself, or the 1.8 MB engine downloading before it is needed.
- Breaking the claude.ai artifact. If the engine can't run there, the artifact must behave exactly as today, minus the Analyse/own-move-eval features, with a plain note.
- Numbers in the downloaded JSON that don't mean what the Python pipeline's numbers mean (same sign convention, same mate encoding, same rating and accuracy formulas).

## Decisions the user made

| Topic | Decision |
|---|---|
| Engine | nmrugg/stockfish.js **v19.0.1, `stockfish-19-lite-single`** (`.js` 28 KB + `.wasm` 1.8 MB, GPL-3.0). Not lichess-org/stockfish-web. |
| Search limit | Whichever comes first. **Full-game analysis: depth 22 or 3 s per position** (`go depth 22 movetime 3000`). **Own moves: depth 24 or 3 s** (`go depth 24 movetime 3000`). One engine, **Hash 64 MB**. Chosen after the benchmarks below; the user wants the full game not to take too long. |
| Full-game trigger | A button; never automatic. A couple of minutes for a 40-move game is acceptable. |
| Button placement | **Inside the empty Analysis panel** (mockup option A), replacing the "No engine analysis loaded" text. While running, the panel shows progress there. |
| Ask Queen | ~~Moves from the dock into the Analysis panel header~~ — superseded after review: **stays in the dock and the phone menu**; the Analysis panel has no room for it on small screens. |
| When buttons show | **Only while paused.** Hidden while the video plays (same rule as today's "Tip: drag a piece" line). |
| Own moves | Evaluated automatically on drop; show **eval score + Stockfish's best reply line**. |
| Start state | Page opens **paused on the starting position** with all panels visible (today's `settled(-1)` frame). The **first** Play press starts from 0:00 (title card). |
| Keeping results | **Both:** remembered in the browser for that game, and a **Save analysis** download in the `--analyze` JSON format. |
| Where | Netlify copy for sure; the claude.ai artifact **best effort** ("OK if it can't be done"). |

## What the viewer sees

Mockups: `.superpowers/brainstorm/676508-1792149661/content/analysis-panel.html` (states 1–3) and `analyse-button.html` (option A).

**Game with no evals, paused** — Analysis panel:
- Header: "Analysis" on the left; on the right, the engine (see "Changes after approval").
- Body: "No engine analysis for this game." and a primary button **Analyse with Stockfish · about N min** (see the time estimate under Engine plumbing), with a small line "Stockfish 19 lite runs in your browser."
- While playing: only the text, no buttons.

**While analysing** (paused or playing — the video can keep playing):
- The panel body shows "Analysing 31 / 80 · about 1 min left" with a progress bar and a **Stop** control (Stop only while paused, per the paused-only rule; the progress text itself may show while playing since it is not a button — builder's call whether to hide it while playing).
- Stop discards the partial run (my call: no partial results; a half-rated game would mislead).
- When finished, the game is rebuilt with the new analysis: move ratings, best lines, eval bar and plot, accuracy on the end card all appear as they do for a `--analyze` file. The Analysis panel header shows the search behind the current move's eval, e.g. "Stockfish 19 lite · depth 22 · 1.6 s · 797k nodes" (superseded the settings label; see "Changes after approval").

**Game with evals, paused** — unchanged except Ask Queen in the header.

**Own move** (state 3 in the mockup), after dropping a piece:
- Large: the move (e.g. `23.Qe3`) in the "you" colour, and the **EVAL** on the right. Until the search reports, the eval shows "…"; it then updates as depth increases (my call: stream `info` lines so something shows within ~0.5 s, final at depth 24 or 3 s, whichever comes first).
- Under the move: "YOUR MOVE · −41 CP vs a4" and the rating colour (inaccuracy / mistake / blunder by the same rules as the game's moves) My call: the comparison always uses the browser engine on both sides — the page also searches the position before the move (cached), even when the game has a precomputed eval there. Comparing the lite engine's eval after your move with the full engine's 4 s eval before it would invent or hide losses.
- A **Stockfish replies** row of chips (up to 8 plies of the PV after the move). Clicking a chip plays the line on the board, like today's best-line chips.
- Every further own move in the line is evaluated the same way. Moving away (Esc, new move, step) cancels a search in progress.

**Saved analysis:**
- A **Save analysis** button appears once a browser analysis exists (my call: in Settings › Game, next to "Save commentary as notes file", using the same download path: the `downloads` capability on claude.ai, a plain file download elsewhere). Filename `<White>-<Black>_analysis.json` (builder's call on exact naming).
- The analysis is stored with the loaded files in the existing `localStorage` store (`files.analysis`), so a reload keeps it — exactly as if the viewer had dropped an analysis JSON. "Back to sample game" and loading another PGN replace it as today.

## Changes after approval (as built, 2026-10-16/17)

Asked for by the user after trying the published page, or found by the final review:

- **Board highlights** (user): last move gets Lichess's green tint (`rgba(155,199,0,0.41)`); a rated move gets a solid fill in its rating colour at 60%. Everything drawn on the board (highlights, badges, arrows, check glow, selection, explored-line squares) uses the dark palette's colours in **both themes**, so the board looks the same in light and dark.
- **Analysis header shows actual search stats** (user): engine name, then this position's depth, time and nodes (game analysis: the search after the move; own moves: live while it searches). No "browser" suffix; the portrait frame shows only the numbers. The analysis JSON keeps `search_time_after_ms` and `search_nodes_after` per move (the Python video ignores them). Analyses without these show the depth only; PGN evals and the sample keep the settings label.
- **Whole-search stats** (user, 2026-10-17): the eval and line come from the last complete depth, but time and nodes are the whole search's, and a depth cut off by the 3 s cap shows as "depth 20 (21 unfinished) · 3.0 s". The analysis JSON adds `search_maxdepth_after`.
- **Ask Queen**: in the dock (landscape) and the phone menu; not in the Analysis panel.
- **Book name** next to the Commentary heading, also for explored lines (see Opening names).
- **Start frame**: the empty Analysis panel says "Press play to watch the game, or drag a piece to try your own move", and offers Analyse there when the game has variations but no evals.
- **Fixes from the final review**: positions track castling rights (no castling after the king or rook moved); a run is abandoned only when the game changes, and results merge into the current files; slow engine starts get 30 s, the timed-out worker is terminated and "Try again" retries; a game with PGN variations but no evals offers Analyse; a dead engine is reported ("Stockfish stopped · play a move to restart it") and replaced on next use; the self-hosted copy checks the wasm is there before starting (a missing file reports in under a second); the best move is the first move of the reported line (Python's `pv[0]`).
- **Fix after publishing** (user report): own moves after the first didn't register — the explored-line board's pieces sat above the touch layer; it now ignores the pointer. Browser checks must use real mouse input.
- **Reload** opens on the starting position; the playhead is no longer saved.

## How analysis must work (parity with Python)

The reference is `chess_game_analyzer.py` in this repo: `analyze_game`, `_classify_move`, `mate_advice`, `_calculate_player_stats`, `winning_chances`, `_eval_to_cp`. Port, don't reinvent:

- Search every position once: the starting position, then after each ply (N+1 searches). The search after ply i is the "before" search of ply i+1.
- Evals in centipawns **from White's point of view**; UCI reports side-to-move, so negate for Black to move. Mates encoded as `±(10000 − 10·N)` (`_eval_to_cp`).
- `eval_loss` with the mate-in-N adjustment, clamp ≥ 0, zero when the move played is the engine's move, cap 1500 for accuracy.
- Ratings: `best` if loss < 5 cp, else Lichess win-chance drop thresholds 0.10 / 0.20 / 0.30 (K = 0.00368208); mate rules override (`mate_advice`, including `mate_advice`/`mate_line` text).
- Accuracy per side: `100·exp(−0.005·avg_loss)`.
- `best_line`: up to the same max plies as Python (`BEST_LINE_MAX_PLIES`), SAN, stopping at the first illegal move.
- Output JSON shape: the same top-level and per-move keys as `sample_game_analysis.json` (`white`, `black`, `*_elo`, `event`, `site`, `date`, `round_num`, `result`, `opening_name`, `opening_eco`, `moves[]`, `white_stats`, `black_stats`, `engine`). `engine` = `{name: "Stockfish 19 lite (browser)", depth: 22, time_limit: 3, lines: 1, threads: 1, hash_mb: 64}`. Player names, Elos, event, date and result come from the PGN headers (empty when absent). `opening_name`/`opening_eco` follow Python's `AnalysisData.name_opening`: the PGN's `Opening`/`ECO` headers when present, otherwise the opening book (next section). Fields only the LaTeX report uses (e.g. `material_balance`, `alternative_moves`) may be empty but present.
- The page's engine label (`chess-core.js` `buildGame`) currently prefers `time_limit` over `depth`; with both set it should read like Python's `describe_search`: "depth 22, max 3s per position".

## Opening names (user-approved addition)

The repo's `openings/*.tsv` is Lichess's chess-openings data (CC0, 3,820 lines, 389 KB raw, ~53 KB gzip / ~44 KB brotli). The page gets the same opening book the Python video uses (`chess_openings.py`):

- **Port `OpeningBook`**: replay each TSV line with the page's own move code (`chess-core.js`), key positions by EPD (board, side to move, castling, en passant — no move counters), name the last position of each line, and give every position on a line the deepest named position before it (ties: first in the data). Then `openingsByPly(moves)` and `identify(moves)` (last in-book position's opening).
- **When it's used** (parity with `name_opening`): any loaded game whose PGN lacks an `Opening` header (also `?`/empty) gets its name and ECO from `identify` — for every game, not just browser-analysed ones. The saved analysis JSON carries those values.
- **Per move** (mirrors the Python video's "Book:" line): the book name of the position after that ply, while in book, sits on the right of the **Commentary** heading (moved there from the Analysis panel after approval). While a line is explored on the board (own moves, best line, Queen line) it names the position on the board instead.
- **Bundling**: the TSV content is embedded in the page (Netlify and claude.ai alike). Builder's call on format: trimming to `eco\tname\tmoves` without move numbers saves ~15%; the hosts compress it anyway.
- **Cost**: build the table lazily, the first time a game needs it, and cache it for the session. Measure the build time; if it's over ~300 ms on this laptop, precompute the EPD table at build time instead (`build.cjs`) and check the size.
- Do not change the data: the files stay a verbatim copy of Lichess's; updating them updates both Python and the page.

## Engine plumbing

- Vendor the two release files from v19.0.1 into `vendor/` (pinned; record the SHA-256 in the README). Include the GPL notice: a "Stockfish 19 (GPL-3.0) · source" link in the page's Settings or end-of-panel note, pointing to the nmrugg repo.
- **Netlify copy:** `build.cjs` copies both files into `out/site/` beside `chess-game-video.html`; deploying means copying all three into the vault's `docs/files/`. The page creates `new Worker('stockfish-19-lite-single.js')` relative to itself, lazily on the first own move or Analyse press.
- **claude.ai artifact (best effort):** Workers must be same-origin there, so try a blob Worker with the glue inlined and the wasm passed as bytes (base64 inlined, ~2.5 MB, within the 16 MB limit) — e.g. via the Emscripten `wasmBinary`/`locateFile` hooks. If it can't be made to run, detect failure (worker error or no `uciok` within a timeout) and show: "Stockfish can't run inside claude.ai. Open the self-hosted copy to analyse." with a link to the Netlify URL. Own-move evals are then simply absent.
- One engine instance for the page. Own-move searches and the full-game analysis share it: while an analysis runs, an own-move search goes next after the current position (≤ 3 s wait) — my call.
- `setoption name Hash value 64`, set once; no `ucinewgame` between positions of one analysis (the table carries over between positions).
- Benchmarks (2026-10-16, Node 22 on this laptop, every position of the game in order; scripts in `.superpowers/hashtest/`). Reference: native Stockfish 19, full net, 4 s × 7 threads (the games' `--analyze` JSONs). Game 1 = `sample_game.pgn` (Byrne–Fischer, 83 positions, native marks 6 moves); game 2 = a Lichess bullet game (Saif_2004_JOR–JurgenSanchez97, 63 positions, 4 marks).

  | Setting | Game 1 time | Game 2 time | Eval gap to native (g1 / g2) | Native marks rated exactly (g1 / g2) |
  |---|---|---|---|---|
  | depth 20 / 3 s | 58 s | 76 s | 66 / 54 cp | 2/6 / 2/4 |
  | **depth 22 / 3 s (chosen)** | **106 s** | **112 s** | **48 / 49 cp** | **2/6 / 1/4** |
  | depth 24 / 5 s | 180 s | 189 s | 48 / 46 cp | 2/6 / 1/4 |
  | depth 24, no cap | 243 s | 275 s | 44 / 46 cp | 4/6 / 2/4 |

  Every setting flags all of game 2's blunders (sometimes one grade lower) and none finds 30.Qf8?! or 35.Kg1?! (the lite net, not depth). Deeper search mostly narrows the eval gap; rating differences of one mark are within run-to-run noise (two identical runs differ in ~10 of 83 best moves). A time cap ends a search at a shallower completed depth — the eval isn't corrupted — but the two positions a rating compares can end at different depths. Hash: 16–128 MB made no difference at depth 20; at depth 24 uncapped, 32 MB filled to 95%, so 64 MB (≤ 32% full with a 3–5 s cap). Peak process RSS ~210 MB at 64 MB.
- Time estimate on the button: about 1.3 s per position on a laptop (≈ 2 min for 80 plies), so "Analyse with Stockfish · about N min"; the ETA during the run comes from the measured rate. Slower devices (phones, Firefox) will hit the 3 s cap more often; the worst case is 3 s × positions.
- Own moves at depth 24 / 3 s: in game 2 half the positions use the full 3 s without reaching depth 24, so the streamed eval appears within ~0.5 s but often settles only at 3 s.

## Start paused

- `engine.jsx` timeline: initial `playing` false (today `!reducedMotion()`), initial time = the starting-position frame (`settled(-1)` in `GameVideo`, i.e. `S.tp[0] − 0.3`).
- First Play press while still on that untouched opening frame: jump to 0:00 and play (title card). Any later Play resumes from where it is.

## Constraints

- No regressions to the playing video's look, timing, or the sample game.
- Mobile/narrow layout: Ask Queen must remain reachable (it is now in the panel, which is in the scaled frame; check it is tappable at phone width).
- Testing on this machine: only the lite engine; one headless browser at a time; watch memory (see `~/.claude/CLAUDE.md`).
- External scripts in the artifact only from the allowed CDNs; the engine is vendored, not CDN-loaded.

## Left to the builder

- Component structure, the engine wrapper API, UCI parsing details.
- Exact progress/ETA wording and the time estimate formula once real per-position times are measured.
- Whether the progress line hides while playing.
- How the `vline` own-move state stores eval results (per position FEN cache is suggested; repeated positions shouldn't re-search).
- Test approach (the Python side: load a browser-produced JSON through `run_animator.py`'s analysis loading; the JS side: compare a few positions' ratings with the Python formulas on fixed evals).
