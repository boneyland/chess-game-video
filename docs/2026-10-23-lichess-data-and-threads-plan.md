# Lichess data and multi-threaded Stockfish: plan

Scope: the self-hosted site (Render) only. The claude.ai artifact keeps today's single-thread engine and gets none of this: its build is unchanged and the new UI is hidden there (`window.SF_MAKE_WORKER` is set only in the artifact build, so it is the switch).

Each PR below is app-affecting, so each goes on a `claude/<topic>` branch as small commits with a pull request against `main` (PR preview on Render before merge). Unverified facts are marked **verify**.

## Order and dependencies

| # | PR | Depends on | Risk |
|---|----|-----------|------|
| 1 | `claude/multipv` : Lines setting, multi-line engine panel and arrows | none | low |
| 2 | `claude/tablebase` : endgame tablebase | none | low |
| 3 | `claude/cloud-eval` : Lichess cloud evaluation | 1 (shares the lines UI) | low |
| 4 | `claude/lichess-explorer` : opening explorer (and Lichess sign-in if needed) | none | medium |
| 5 | `claude/threads` : cross-origin isolation, multi-thread engine, Threads setting | 1 | high |

Ship 1 to 4 first. Do 5 last and alone, because the COOP/COEP headers affect every external load on the page.

## Shared groundwork (in PR 2, reused by 3 and 4)

- New `app/lichess-core.js` (plain `window.LichessCore`, unit-tested in Node like `queen-core.js`): URL builders, response parsers, a per-key LRU cache, a rate-limit gate (one request at a time per endpoint, back off on HTTP 429 for 60 s as Lichess asks), an `AbortController` per request, and a debounce helper (about 300 ms after the last position change).
- Positions are sent as FEN. The page's own FENs lack castling and en passant (see `sf-engine.js`), so build the FEN from the move list through `ChessCore` with real castling rights, or use the `play` parameter (UCI move list from the standard start) where the endpoint has one.
- Network failures never show an error screen. Each panel has three quiet states: loading, "not available" (offline, 404, 429, blocked) and data. A failed request must not block the local engine.
- `sw.js`: leave `lichess.org`, `explorer.lichess.ovh`, `tablebase.lichess.ovh` out of `KEEP_HOSTS` (live data, never cached or served stale); check the worker passes them through when offline.
- README: a short "Lichess data" note (what is requested, that positions are sent to Lichess, the endpoints). Remember the privacy angle: the player's positions leave the browser, so each feature is a Settings toggle (**default off** for explorer and cloud eval; tablebase can default on since it only fires at 7 pieces or fewer).

## PR 1: Lines (MultiPV)

Engine already supports it; nothing to replace.

- `analysis-core.js`: `ENGINE.lines` already exists (1). Add `LINES = [1, 2, 3, 4, 5]`, `sfLines` to `engineSettings(t)` for the live engine (`own`); the batch game analysis keeps `lines: 1` and its JSON is unchanged (the Python check must stay green).
- `sf-engine.js`: `search({ lines })`. Before each search send `setoption name MultiPV value N` when it differs from the last one set (same pattern as `hashWant`/`hashSet`, applied in `pump()` between searches). Parse `multipv k` in `info` lines (`AnalysisCore.infoToScore` and `infoStats` get a `multipv` field, default 1). Keep the last complete line per `k` in `cur.lines[k]`; `onInfo` and the result gain `lines: [{ k, cp, depth, pv }]` (sorted by k), while `cp`, `pv`, `best` stay line 1 so every existing caller works unchanged.
- Note on `bestmove`: with MultiPV the final `bestmove` is line 1.
- `tweaks.jsx` / `game-app.jsx`: Settings, Engine: "Lines" select (1 to 5), `TWEAK_DEFAULTS.sfLines = 1`. Persisted like the other `sf*` keys.
- `engine.jsx` / `free-board.jsx`: the engine panel lists all lines (eval, first moves in SAN, depth). Best-move arrows: line 1 as today, lines 2 to N thinner and fainter; clicking a line plays its first move or previews it. The Play vs Stockfish board never shows lines (the spec's anti-goal), and the Stockfish opponent search always uses `lines: 1`.
- A search with N lines is slower to the same depth, so the panel notes "more lines search slower".
- Tests: `tests/sf-engine.test.cjs` (fake worker: MultiPV option sent once, only on change; lines collected per `k`; stale lines from a previous depth dropped), `tests/analysis-core.test.cjs` (parser, settings range), real-Stockfish test with `lines: 3` returning three distinct first moves in the start position. Live test: set Lines to 3 and see three rows.

## PR 2: Endgame tablebase

`https://tablebase.lichess.ovh/standard?fen=<FEN>` (no auth, 7 pieces or fewer) **verify** the response fields (`category`, `dtz`, `dtm`, `moves[]` with `uci`, `san`, `category`, `dtz`).

- `LichessCore.tablebase(fen)` returns `{ category, dtz, dtm, moves }` or `null` (404/over 7 pieces/error). Do not call it when `pieceCount(fen) > 7`.
- UI: in the engine panel of the replay and the free board, when the position qualifies: a "Tablebase" block with the verdict (win, draw, loss, "cursed win", "blessed loss" as Lichess names them), DTZ/DTM, and the moves ranked by result. Arrows can mark the winning moves in a distinct colour. Not shown during a Play vs Stockfish game.
- Eval bar: a tablebase result overrides the engine eval for display (win shows as mate-like, draw as 0.00) with a small "TB" tag; the stored analysis JSON is untouched.
- Optional later: use it to cut engine searches short in the batch analysis (not in this PR).
- Tests: parser fixtures from real responses (`tests/fixtures/`), piece-count gate, cache hit, 429 back-off with a fake `fetch`.

## PR 3: Cloud evaluation

`https://lichess.org/api/cloud-eval?fen=<FEN>&multiPv=<N>` (no auth, 404 when the position was never analysed, rate limited) **verify** `variant`, `multiPv` limits and the response shape (`depth`, `knodes`, `pvs[{ moves, cp | mate }]`).

- `LichessCore.cloudEval(fen, lines)` returns the same shape as an engine result (`lines: [{ k, cp, depth, pv }]`, moves converted from UCI strings), tagged `source: 'cloud'`. Mate scores map to the existing `±(10000 − 10·N)` convention.
- Use: when the Settings toggle is on, a position first asks the cloud (debounced); a hit shows at once with a "Lichess cloud, depth 40" label, and the local search still runs (or is skipped when "Prefer cloud" is on and the cloud depth is at least the local limit). A miss silently falls back to local Stockfish. The panel shows which source each line came from.
- Never used for: the batch game analysis (its depth/time settings are part of the JSON), the Play vs Stockfish opponent or its critique.
- The local search must not wait for the cloud: fire both, show whichever arrives first, let the better depth replace it.
- Tests: parser, mate mapping, 404 → null with no retry loop, debounce, toggle off sends nothing (assert `fetch` is never called).

## PR 4: Opening explorer

`https://explorer.lichess.ovh/lichess?fen=<FEN>&moves=12&topGames=4&recentGames=0` (also `/masters`) **verify** current auth requirement. If a Bearer token is required (as understood now), the user needs a Lichess token.

Auth decision (see open questions): Lichess supports OAuth2 PKCE with no client registration and no scopes for public data **verify**. That mirrors the HF sign-in (`HF_OAUTH.redirect` in `queen.jsx`) and also lays the ground for a possible Play on Lichess later. A fallback "paste a personal API token" field is simpler and has no redirect URLs to register.

- `LichessCore.explorer(fen, { db: 'lichess' | 'masters', ratings, speeds })` returns `{ white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], topGames, opening }`.
- UI: an "Explorer" panel (replay and free board, not during a game): a table of moves with games count, a white/draw/black bar and a click to play the move on the free board; opening name and ECO from the response, with the local `openings/` name as the fallback and as the default when the toggle is off. Database picker (Lichess, Masters) and rating/speed filters stored in settings.
- Token handling: stored in `localStorage` under its own key, never sent anywhere except `lichess.org` hosts, cleared by "Sign out", and excluded from the crash screen's Clear saved data wording like the HF token (check how that is handled in `queen.jsx`). Add the redirect URL(s) to README next to the HF note, and a CLAUDE.md gotcha line.
- Tests: parser, token header only present when signed in, 401 → "Sign in to use the explorer" state, filters change the cache key.

## PR 5: Multi-threaded Stockfish lite, Threads and Lines options

Engine: stockfish.js v19.0.1 multi-thread lite build **verify** exact file names, sizes and whether it is a single `.js` plus `.wasm` (the single-thread build is 1.8 MB wasm). Vendor it in `vendor/`, pin by SHA-256 in README as for the current files, keep GPL-3.0 notes. The single-thread files stay: they remain the artifact engine and the site's fallback.

### Cross-origin isolation (the real cost)

- `render.yaml` headers on `/*`: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`, which is gentler for third-party loads but not in Safari; start with `require-corp`). `render.yaml` is the source of truth (Blueprint sync), so the change goes there, not in the dashboard.
- Every cross-origin resource must then be CORS-enabled or send `Cross-Origin-Resource-Policy`:
  - React, ReactDOM, mediabunny on cdnjs/jsdelivr already use `crossorigin="anonymous"` with SRI; confirm they still load.
  - Google Fonts: the stylesheet link and font files need `crossorigin` on the `<link>`; check the `preconnect` pair.
  - Lichess calls are `fetch` with CORS, fine. Hugging Face sign-in is a top-level redirect, but the popup/redirect with COOP `same-origin` can sever `window.opener`; confirm the redirect flow (not popup) is used, otherwise switch.
  - Ask Queen `mcp` call and any `<img>` from other origins: audit with a grep for `https://` in `app/`.
- `sw.js`: responses it re-serves must keep the isolation headers (a cached copy of the page needs them too) and the new engine files join `LOCAL`; `VERSION` hash picks them up through `build.cjs`.
- `tests/live/serve.cjs` must send the same two headers, or the live tests exercise a different page from production. Add an assertion that `crossOriginIsolated === true` on the served page.
- Fallback: `crossOriginIsolated` false or the threaded engine failing to start leads to the single-thread engine with no error, and the Threads setting is disabled with the reason ("This browser/page is not cross-origin isolated").

### Engine selection and options

- `stockfish.jsx`: `sfFiles()` chooses `stockfish-19-lite` when `crossOriginIsolated && SharedArrayBuffer` and not the artifact, else `stockfish-19-lite-single`. Keep `sfFilesPresent` HEAD check for the chosen file; fall back to single if the threaded file is missing or `ready()` times out.
- Settings, Engine:
  - **Threads**: 1 up to `min(navigator.hardwareConcurrency − 1, 8)`; default `min(max(1, hwc / 2), 4)` (leave cores for the UI and audio; mobile defaults to 1 or 2). Persist as `sfThreads`.
  - **Lines**: from PR 1.
  - Hash selector stays; note that the hash is shared by all threads.
- `sf-engine.js`: `setoption name Threads value N` handled like Hash and MultiPV (applied in `pump()` between searches; changing it mid-search waits). A thread change on the lite multi-thread build may require re-initialising the worker **verify**; if so, `create` restarts the worker on a Threads change when idle, reusing the same `ready()` path.
- `analysis-core.js`: `ENGINE.threads` becomes a setting. Because threads change search results (non-deterministic with more than one thread) the batch analysis JSON records the threads used and the partial-run key (`sfPartialKey`) includes them so a resumed run never mixes thread counts. The Python check (`check_browser_json.py`) is run with `threads: 1`; document that multi-thread JSON is not reproducible to the node.
- Pace estimates (`secondsPerPosition`, `paceFactor`) assume one thread; scale the factor by a measured speedup (about 0.6 × threads, capped) or just let the device-pace learner (`sf-pace`) absorb it, keyed by thread count.
- The Play vs Stockfish opponent uses the same engine, so strength/time behaviour changes with threads; keep its `play` movetime logic and check the critique timing (`play-core.js` 3 s rule) still holds.

### Tests and checks

- Unit: fake-worker tests for Threads option ordering and restart; settings range and defaults; engine file choice.
- Node: a real multi-thread engine test is awkward (needs `SharedArrayBuffer` workers in Node); run the engine file under Node's worker threads if the build allows it, otherwise cover it in the live browser test only.
- Live (`tests/live/site.test.cjs`, Chromium then Firefox, locally and in GitHub Actions): page is cross-origin isolated; set Threads 4 and Lines 3, start analysis on the free board, see three lines and nps greater than the 1-thread run; reload offline (service worker) still gets isolation headers; fonts and React load; Hugging Face sign-in redirect still returns.
- Manual: phone layout, iOS Safari (threaded wasm there is restricted; the fallback must be silent), Firefox desktop (the user's browser) before merging.

### Rollback

The headers live in `render.yaml` alone. If isolation breaks something not caught by tests, removing the two header lines restores the old behaviour, and the fallback keeps the single engine working.

## Cross-cutting

- Settings page grows an "Online data" section (Lichess toggles, token/sign-in, database filters) and the Engine section (Threads, Lines, Hash). Keep defaults in `TWEAK_DEFAULTS`; existing users' stored settings override new defaults, which is fine since all new switches default to the conservative value.
- Docs: README (features, privacy note, endpoints, engine file hashes), CLAUDE.md gotchas (explorer token, isolation headers, engine fallback). Docs go straight to `main`.
- Visual changes follow the repo rule: screenshots at 1440×900 and phone (390×844), Chromium and Firefox, in the PR description via the `pr-screenshots` branch.
- Offline: all four features degrade to "not available" with no error and the app works as today with no network.

## Decisions (2026-10-23)

1. Explorer sign-in: Lichess OAuth (PKCE), with a pasted personal token as the fallback.
2. Cloud eval and the explorer default to off.
3. Threads default: half the cores, up to 4.
4. `COEP`: `require-corp`.
