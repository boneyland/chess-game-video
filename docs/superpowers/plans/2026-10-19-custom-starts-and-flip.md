# Custom Starts and Board Flipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A game can start from any legal FEN (Black to move included) and replay, analyse, name its opening and export like any other; and the board can be flipped.

**Architecture:** `ChessCore` learns a game's start (`M.start`, `M.ply0`) from a PGN's `[FEN]`; every place that numbers moves or decides the side from `i % 2` goes through `ply0`. The engine gets `position fen …` and every cache keyed on a move list includes the start FEN. Flipping is one module-level orientation in `game-video-core.jsx`, set per render like `setLayout`, applied where squares become pixels.

**Tech Stack:** plain JS units (`app/*.js`) and JSX (`app/*.jsx`, precompiled by `build.cjs`), `node --test`, Playwright live tests (`tests/live/site.test.cjs`), stockfish.js 19 lite.

**Spec:** `docs/superpowers/specs/2026-10-19-free-board-design.md` (this plan is the spec's step 1 of 6: "Custom starts underneath … and board flipping")

## Global Constraints

- Only the Render site matters; `node build.cjs` must still build the artifact without errors, nothing more.
- Loaded games from the standard start must replay, analyse and export exactly as before (anti-goal: "The replay of a loaded game getting worse").
- An illegal or malformed FEN gets a plain message, never a crash (anti-goal).
- Chess960 is not in this plan (spec step 6); a FEN whose castling rights need it is rejected with a message.
- Long one-line statements: split only lines you change (CLAUDE.md).
- Visual changes: screenshots of desktop (1440×900) and phone (390×844), Chromium and Firefox, shown before committing.
- Run after JS changes: `node --test --test-concurrency=1 tests/*.test.cjs`, then `../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py`; the live suite with `LIVE_URLS=local` (sandbox disabled, `NODE_PATH=/home/yh/.npm/_npx/9833c18b2d85bc59/node_modules`).

## Review Focus

1. A PGN with `[FEN]`, Black to move and `%clk` comments: the clocks, player bars and move numbers must agree on who moved (Task 1 test `a FEN start with Black to move numbers and sides its plies`, Task 4 live test).
2. A FEN whose castling rights don't match the pieces (`KQkq` with the h1 rook missing) or whose en-passant square is impossible: rejected or corrected with a message, not a crash or a wrong castle later (Task 1 test `parseFen rejects …`).
3. A stored game in localStorage from before this change (no `ply0`, no `[FEN]`) still loads unchanged (Task 1 test `a standard game is unchanged`).
4. An analysis JSON made for a different start position: `The analysis file doesn't match this PGN`, never analysis applied to the wrong moves (Task 1 test).
5. A drag and the promotion picker on a flipped board: the piece lands on the square under the pointer, and the picker's column runs from the promotion square towards the middle of the board as seen (Task 5 live test).

---

### Task 1: Custom starts in ChessCore

**Files:**
- Modify: `app/chess-core.js` (`posFromFen` ~691, `buildGame` 354–460, plies' `side` 382, `commentaryPrompt` move numbers ~505/558/577, `annotatedPgn` ~630–660)
- Test: `tests/chess-core.test.cjs`

**Interfaces:**
- Produces:
  - `ChessCore.parseFen(fen: string) -> { pos: {b, turn, castle, ep}, ply0: number, fen: string }` — `fen` normalised to six fields; throws `Error` with a reader-facing message.
  - `ChessCore.START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'`
  - `ChessCore.moveNo(absPly: number) -> string` — `'12.'` for White's ply, `'12…'` for Black's (`absPly = (fullmove − 1)·2 + (Black ? 1 : 0)`).
  - `M.start: { fen: string, pos }` and `M.ply0: number` on every built game (`START_FEN` and `0` for standard games). `ply.side` is `(ply0 + i) % 2 ? 'b' : 'w'`.

- [ ] **Step 1: Write the failing tests**

```js
test('parseFen reads a full FEN and its move number', () => {
  const f = CC.parseFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  assert.equal(f.pos.turn, 'w'); assert.equal(f.pos.castle, 'KQkq'); assert.equal(f.ply0, 4);
  assert.equal(CC.parseFen('8/8/8/8/8/8/4k3/4K3 b - - 0 40').ply0, 79);
  assert.equal(CC.parseFen('8/8/8/8/8/8/4k3/4K3 w').fen, '8/8/8/8/8/8/4k3/4K3 w - - 0 1'); // missing fields default
});
test('parseFen rejects what is not a legal position', () => {
  for (const [fen, msg] of [
    ['8/8/8/8/8/8/8/4K3 w - - 0 1', /king/i],          // no black king
    ['4k2R/8/8/8/8/8/8/4K3 w - - 0 1', /not to move is in check/i], // Black, not to move, is in check
    ['P3k3/8/8/8/8/8/8/4K3 w - - 0 1', /pawn/i],        // a pawn on the back rank
    ['4k3/8/8/8/8/8/8/4K3 w KQ - 0 1', /castling/i],    // rights without the rooks
    ['4k3/8/8/8/8/8/8/1R2K1R1 w BG - 0 1', /Chess960/], // Shredder-FEN rights by file: Chess960
    ['4k3/8/8/8/8/8/8/4K3 w - e3 0 1', /en passant/i],  // no pawn behind e3
    ['not a fen', /FEN/],
  ]) assert.throws(() => CC.parseFen(fen), msg, fen);
  assert.doesNotThrow(() => CC.parseFen('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1')); // White to move in check is legal
});
test('a FEN start with Black to move numbers and sides its plies', () => {
  const M = CC.buildGame({ pgn: '[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3"]\n\n3... Nf6 4. Nc3 { [%clk 0:04:50] } Bc5 *' });
  assert.equal(M.ply0, 5);
  assert.deepEqual(M.plies.map((p) => p.side), ['b', 'w', 'b']);
  assert.deepEqual(M.plies.map((p, i) => CC.moveNo(M.ply0 + i)), ['3…', '4.', '4…']);
  assert.match(CC.annotatedPgn(M), /\[SetUp "1"\][\s\S]*\[FEN "r1bqkbnr\/pppp1ppp\/2n5\/4p3\/4P3\/5N2\/PPPP1PPP\/RNBQKB1R b KQkq - 3 3"\][\s\S]*3\.\.\.\s?Nf6 4\.\s?Nc3/);
});
test('a standard game is unchanged', () => {
  const M = CC.buildGame({ pgn: '1. e4 e5 2. Nf3 *' });
  assert.equal(M.ply0, 0); assert.equal(M.start.fen, CC.START_FEN);
  assert.doesNotMatch(CC.annotatedPgn(M), /\[FEN /);
});
test('an analysis file for another start does not attach', () => {
  const A = JSON.stringify({ moves: [{ move_san: 'e4', move_uci: 'e2e4' }] });
  assert.throws(() => CC.buildGame({ pgn: '[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *', analysis: A }), /doesn't match/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/chess-core.test.cjs`
Expected: FAIL (`CC.parseFen is not a function`, and the FEN game throws "not supported yet")

- [ ] **Step 3: Implement `parseFen`, `START_FEN`, `moveNo`, and custom starts in `buildGame`**

`parseFen` checks, in order, with these messages: six or fewer space-separated fields and eight ranks of eight squares (`"That isn't a FEN: …"`); exactly one king per side (`"A position needs one king of each colour"`); no pawn on rank 1 or 8 (`"A pawn can't stand on the first or last rank"`); the side not to move not in check (`"The side not to move is in check"`); each castling right has its king on e1/e8 and rook on its corner (`"Castling rights don't match the pieces"`; rights given as files, `A`–`H`/`a`–`h` (Shredder-/X-FEN), are Chess960: `"Chess960 positions aren't supported yet"`); the en-passant square is on rank 3/6 behind a pawn that just moved two (`"The en passant square doesn't match the pieces"`). In `buildGame`, replace the "not supported yet" throw with `parseFen(H.FEN)` when `[FEN]` is present, start `pos` from it, and compute `ply.side` from `ply0`. When an analysis is attached to a FEN game, also require `A.headers && A.headers.FEN === start.fen` (else the existing mismatch error). Route every `Math.floor(i / 2) + 1` / `i % 2` in `commentaryPrompt` and `annotatedPgn` through `moveNo(M.ply0 + i)`; `annotatedPgn` writes `[SetUp "1"]` and `[FEN …]` for non-standard starts and starts the movetext with `N...` when Black moves first. `playLine` calls that use `START + ' w'` for "before the first ply" use `M.start.pos` instead.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/chess-core.test.cjs`
Expected: PASS, and `node --test --test-concurrency=1 tests/*.test.cjs` all pass.

- [ ] **Step 5: Commit**

```bash
git add app/chess-core.js tests/chess-core.test.cjs
git commit -m "ChessCore: games from a FEN start, Black to move included"
```

### Task 2: Stockfish and its caches from a start FEN

**Files:**
- Modify: `app/sf-engine.js:4,24,41`, `app/analysis-core.js:135-185`, `app/stockfish.jsx` (`readSfPartial`/`writeSfPartial` 44–53, `useGameAnalysis` 55–100, `useMoveEval` 154–182), `app/queen.jsx` (calls at ~58 and ~160), `app/game-video-core.jsx` (`ownBefore`/`ownAfter` ~810)
- Test: `tests/sf-engine.test.cjs`, `tests/analysis-core.test.cjs`

**Interfaces:**
- Consumes: `M.start.fen`, `M.ply0` (Task 1).
- Produces:
  - `SF.positionCommand(moves: string[], fen?: string) -> string` — `'position fen <fen> moves …'` when `fen` is given and isn't `START_FEN`, else today's `startpos` form.
  - `engine.search({ moves, fen, depth, movetimeMs, priority, onInfo })` — `fen` optional; scores stay from White's point of view using the FEN's side to move.
  - `AnalysisCore.runAnalysis({ …, startFen })` — positions from `startFen`; the JSON's `headers` carry `FEN`/`SetUp` when non-standard.
  - `useMoveEval(engine, before, after, own, fen)` — the cache key starts with `fen`.

- [ ] **Step 1: Write the failing tests**

```js
test('positionCommand with a start FEN', () => {
  assert.equal(SF.positionCommand([], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1'), 'position fen 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1');
  assert.equal(SF.positionCommand(['e8d7'], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1'), 'position fen 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1 moves e8d7');
  assert.equal(SF.positionCommand(['e2e4'], window.ChessCore.START_FEN), 'position startpos moves e2e4');
});
test('onInfo is from White\'s point of view when the FEN has Black to move', async () => {
  // built like the existing 'onInfo streams scores' test: search({ moves: [], fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1' }),
  // the fake worker answers 'info depth 5 score cp 50 pv e8d7'; assert the streamed and resolved cp are -50
});
test('real engine: a FEN start with Black to move finds the mate', { timeout: 60000 }, async () => {
  // r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1: Ra1# (checked with ChessCore.userMove on 2026-10-19)
  // search({ moves: [], fen, depth: 10, movetimeMs: 3000 }); assert r.cp <= -9990 and r.pv[0] === 'a8a1'
});
```

In `tests/analysis-core.test.cjs`: `runAnalysis from a start FEN rates Black's first move as Black's` — a fake engine (as the file's existing ones) answering a fixed cp per position; with `startFen` Black to move and `ucis: ['e8d7']`, assert `moves[0].is_white_move === false` and `json.headers.FEN === startFen`.


- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/sf-engine.test.cjs tests/analysis-core.test.cjs`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

`search` stores `fen` on the queue entry; `infoToScore`'s side is the side to move after `moves` from the FEN's turn. `runAnalysis` starts `pos` from `startFen` and takes `isWhite` from `pos.turn` per ply. `readSfPartial`/`writeSfPartial` and `SF_EVAL_CACHE` keys gain the start FEN in front of the move list (a standard game's key stays as today, so saved partial runs still resume). Queen gets `fen: M.start.fen` when it isn't the standard start (its tool takes `{ fen, moves }`).

- [ ] **Step 4: Run all JS tests and the Python cross-check**

Run: `node --test --test-concurrency=1 tests/*.test.cjs && ../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/sf-engine.js app/analysis-core.js app/stockfish.jsx app/queen.jsx app/game-video-core.jsx tests/sf-engine.test.cjs tests/analysis-core.test.cjs
git commit -m "Stockfish: search and cache from a game's start FEN"
```

### Task 3: Opening names from a start FEN

**Files:**
- Modify: `app/openings-core.js` (`tracker` 13–31, `byPly`/`identify` 50–62), callers in `app/game-app.jsx:246`, `app/game-video-core.jsx` (`lineBook` ~828), `app/chess-core.js:456`, `app/analysis-core.js:185`
- Test: `tests/openings-core.test.cjs`

**Interfaces:**
- Produces: `Openings.book().byPly(ucis: string[], startFen?: string)` and `identify(ucis, startFen?)`; `tracker(startFen?)` starts from the FEN's position and castling rights.

- [ ] **Step 1: Write the failing test**

```js
test('a FEN start inside the book is named', () => {
  // the position after 1. e4 e5 2. Nf3 Nc6, given as a FEN, then 3. Bb5
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.match(O.book().identify(['f1b5'], fen).name, /^Ruy Lopez/);
  assert.equal(O.book().byPly(['e2e4']).length, 1); // the standard start still works without a FEN
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/openings-core.test.cjs`
Expected: FAIL (`identify` ignores the FEN and names nothing, or throws on the illegal move).

- [ ] **Step 3: Implement** — `tracker(startFen)` uses `ChessCore.parseFen(startFen).pos` and its castling rights; callers pass `M.start.fen`.

- [ ] **Step 4: Run all JS tests** — `node --test --test-concurrency=1 tests/*.test.cjs`, expected all pass.

- [ ] **Step 5: Commit**

```bash
git add app/openings-core.js app/game-app.jsx app/game-video-core.jsx app/chess-core.js app/analysis-core.js tests/openings-core.test.cjs
git commit -m "Openings: name positions reached from a start FEN"
```

### Task 4: The replay from a custom start

**Files:**
- Modify: `app/game-video-core.jsx` (`label` 95, `simulate` 105–133, `START_FEN`/`playLineCached` 273–279, `lineLabel` 281, `LineChips` 355, Analysis "Your moves" 551/615, `MoveList` 455–501, `gamePos` ~797), `app/queen.jsx` (`plyLabel` 30, `white` 232), `app/stockfish.jsx` (resume label 141, `OwnMoveAnalysis` `isWhite` 192), `app/game-app.jsx` (`plyTag` 272, resume label 382)
- Test: `tests/live/site.test.cjs`

**Interfaces:**
- Consumes: `M.start`, `M.ply0`, `ChessCore.moveNo` (Task 1).
- Produces: `lineLabel(M, c, j, san)` (gains `M`; every caller passes it).

- [ ] **Step 1: Write the failing live test** `desktop: a game from a FEN with Black to move replays and takes own moves`

Load (as the promotion test does, in a fresh context) `[SetUp "1"]\n[FEN "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3"]\n\n3... Nf6 4. Nc3 Bc5 *`. Assert: `boardBox(page).n === 32`; the Moves panel's text matches `/3\.\s*…\s*Nf6\s*4\.\s*Nc3\s*Bc5/`; after `End`, `.plabel` reads `4… Bc5`; a mouse drag `d2→d3` gives `.plabel` matching `/5\. d3/`; `errors` is empty.

- [ ] **Step 2: Run it to see it fail**

Run: `LIVE_URLS=local LIVE_BROWSERS=chromium node --test tests/live/site.test.cjs` (sandbox disabled, `NODE_PATH` as in Global Constraints)
Expected: FAIL (pieces drawn from the standard start; numbering from 1.)

- [ ] **Step 3: Implement**

`simulate` starts from `M.start.pos.b` (piece ids stay their starting squares). `MoveList` lays out absolute plies `ply0 … ply0 + N − 1` in pairs, with an empty White cell and `n.` for a first row that starts on Black's move. `gamePos(-1)` and `playLineCached` with no ply use `M.start`. All labels go through `ChessCore.moveNo`.

- [ ] **Step 4: Run the live suite in both browsers and the JS tests**

Run: `LIVE_URLS=local node --test tests/live/site.test.cjs` and `node --test --test-concurrency=1 tests/*.test.cjs`
Expected: all pass; screenshot of the FEN game's desktop view in `tests/out/live/`.

- [ ] **Step 5: Commit**

```bash
git add app/game-video-core.jsx app/queen.jsx app/stockfish.jsx app/game-app.jsx tests/live/site.test.cjs
git commit -m "Replay: games from a custom start position"
```

### Task 5: Flip the board

**Files:**
- Modify: `app/game-video-core.jsx` (`sqXY`/`sqC` ~92, `Board` squares and coordinates 220–232, `LineBoard`, `BoardTouch` + `boardXY` ~830, `EvalBar` 370–386, `PlayerBar` top 418, `GameVideo` render), `app/game-app.jsx` (Settings toggle, key handler), `app/shell.html` (`TWEAK_DEFAULTS.flip = false`)
- Test: `tests/live/site.test.cjs`

**Interfaces:**
- Produces: tweak `flip: boolean`; `GameVideo` prop `orient: 'w' | 'b'` (the side at the bottom; later plans set it per move for games); module-level `setOrient(o)` and `view(x, y) -> [x, y]` in `game-video-core.jsx`, which every square→pixel conversion uses.

- [ ] **Step 1: Write the failing live test** `desktop: Flip board turns the board and keeps moves under the pointer`

With the sample game at the start: check the Settings switch `Flip board`; assert the white king's image is above the black king's on screen (compare `getBoundingClientRect().top` of the two king images); the eval bar's white part is at its top; the "White" player bar is above the board. Drag `e2→e4` by mouse using flipped square centres (`square()` gets a `flipped` argument: `x0 + (7 − file + 0.5)·sq`, `y0 + (rank − 1 + 0.5)·sq`) and assert `.plabel` reads `You 1. e4`. Load the promotion PGN of the promotion test, flip, drag `b7→a8`, and assert the four `Promote to …` buttons' tops increase upward on screen from a8 (a8 is at the bottom when flipped: queen lowest, bishop highest). Reload: the board is still flipped. Screenshots: `-flipped.png` desktop, and phone (390×844) in a second context.

- [ ] **Step 2: Run it to see it fail** — as Task 4 Step 2. Expected: FAIL (no `Flip board` switch).

- [ ] **Step 3: Implement**

`setOrient` is called at the top of `GameVideo`'s render from its `orient` prop, as `setLayout` is. `view` mirrors both axes when `orient === 'b'`; `sqXY`, `Board`'s square loop, `BoardTouch`'s `boardXY` (pixel → square) and its overlays, `LineBoard` and `Arrow` (via `sqC`) use it. Rank numbers go on the left column and file letters on the bottom row as seen. `EvalBar` fills White from the top when flipped and moves its number to match; `PlayerBar` puts `orient`'s side below the board. `game-app.jsx` passes `orient={t.flip ? 'b' : 'w'}`, adds the `Flip board` switch to Settings beside the other board options, and `F` toggles it (my call, in the keydown handler that ignores inputs). The video export draws what is shown, so a flipped board exports flipped (the spec allowed this where trivial).

- [ ] **Step 4: Run the live suite in both browsers and the JS tests** — expected all pass. Show the desktop and phone screenshots (Chromium and Firefox) to the user before committing.

- [ ] **Step 5: Commit**

```bash
git add app/game-video-core.jsx app/game-app.jsx app/shell.html tests/live/site.test.cjs
git commit -m "Board: Flip board in Settings, and F"
```

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (Gotchas: games from a FEN, `ply0`, orientation), `README.md` (what the page accepts)

- [ ] **Step 1:** Add one Gotchas line: "Move numbers and sides come from `M.ply0` (`ChessCore.moveNo`), never `i % 2`; squares become pixels only through `view()` (the board can be flipped)". In README, note that PGNs with `[FEN]` load.
- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Docs: custom starts and flipping"
```
