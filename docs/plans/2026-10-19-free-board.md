# Free Board and Opening Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any state, one or two clicks reach an empty board (the starting position or a pasted FEN) where every move, by either side, gets Stockfish's verdict, and the Commentary box names the opening and offers its book continuations.

**Architecture:** A separate view, `FreeBoard`, rendered inside the same `CompositionStage` instead of `GameVideo` when the loaded "files" are a board (`files.board = { fen, moves, upto }`), so the replay's timeline is never asked to handle a zero-ply game. It reuses the replay's pieces: `LineBoard` for drawing, `BoardTouch` and a `useBoardInput` hook (extracted from `GameVideo`) for drag, tap-tap and the promotion picker, `useMoveEval` and `OwnMoveAnalysis` for Stockfish, `MoveList`, `Header`, the panel boxes of `LAYOUTS`, `view()` for flipping. The board's state (start FEN, moves, the move shown) is a small pure unit, `BoardCore`, unit-tested in Node. The opening book gains a continuations query.

**Tech Stack:** plain JS units (`app/*.js`) and JSX (`app/*.jsx`, precompiled by `build.cjs`), `node --test`, Playwright live tests (`tests/live/site.test.cjs`), stockfish.js 19 lite.

**Spec:** `docs/superpowers/specs/2026-10-19-free-board-design.md` (this plan is its step 2 of 6: "Free board: New board, Paste FEN, explore with Stockfish, the opening explorer")

## Global Constraints

- Only the Render site matters; `node build.cjs` must still build the artifact without errors, nothing more.
- Loaded games must replay, analyse and export exactly as before (anti-goal: "The replay of a loaded game getting worse"). Task 3 is a refactor of `GameVideo`'s input with no behaviour change; the existing live tests (own move, promotion, flip, FEN start) are its guard.
- An illegal or malformed FEN gets a plain message in the dialog and nothing changes, never a crash (anti-goal).
- Stockfish on the free board uses the "Your moves" engine settings and the `own` priority, as own moves do now. One `useMoveEval` per board; a move played while a search runs cancels it (the hook already does).
- Not in this plan: Play vs human/Stockfish, clocks, My games, Chess960 (steps 3–6). The New board menu is built so those items can join it later.
- Long one-line statements: split only lines you change (CLAUDE.md).
- Visual changes: screenshots of desktop (1440×900) and phone (390×844), Chromium and Firefox, shown before committing.
- Run after JS changes: `node --test --test-concurrency=1 tests/*.test.cjs`; the live suite with `LIVE_URLS=local`. This cloud machine has no `../chess-animator` (so `tests/check_browser_json.py` can't run; nothing here touches the analysis JSON) and no stock Firefox: run the live suite as `LIVE_URLS=local FIREFOX_PATH=playwright LIVE_CDN_DIR=/tmp/claude-0/-home-user-chess-replay/66d2b936-ee1d-5efa-8a40-e38231f02592/scratchpad/cdn node --test tests/live/site.test.cjs` (Playwright's own Chromium and Firefox; Firefox here can't reach cdnjs, so React comes from local npm packages). Baseline 2026-10-19: all 19 pass in both.

## Decisions made here (the spec left them to the builder)

- **Entering**: one dock button, **New board**, opens a small menu: *Starting position*, *Paste FEN…* (later plans add *Play vs human*, *Play vs Stockfish*, *My games*). On the phone the two items sit in the folded menu under a "New board" label, no nested menu.
- **Board mode hides what needs a game**: Ask Queen, the eval graph strip, and in Settings the game analysis button, Commentary, Pace and the video export. Settings' Game section says "Free board · from the starting position · 5 moves" (or "from a FEN") and keeps Load game… and Back to sample game. Engine sliders stay ("Your moves" applies to the board), as do Flip board, theme and sound.
- **The transport bar** keeps ← → and End, gains a Home that goes to the start position, and drops Play, the times and the track (a `still` mode of `CompositionStage`); Space does nothing there.
- **Before the first move** the Analysis panel only says to drag a piece (or pick a book move); the eval bar shows the position's eval. After a move, `OwnMoveAnalysis` as for own moves. Arrows are not added (own moves have none). (The user dropped a best line before the first move, then asked for it back after testing the preview: the panel shows the start's eval and Stockfish's best line, 2026-10-19.)
- **Player bars** read "White" and "Black", with the captured pieces and "+N" worked out from the material on the board (so a FEN start with a material edge shows it, unlike the replay).
- **The explorer** is board mode only. Its continuations are ordered by how many of the book's named lines go through each move (a popularity proxy; the count isn't shown, per the spec's "no game counts"). Each row: the move as a chip, then the opening it reaches.
- **A pasted FEN** may be wrapped as a PGN tag (`[FEN "…"]`) or have extra spaces; both are accepted.

## Review Focus

1. A stored board whose moves no longer replay (edited localStorage, or a FEN from a later Chess960 plan): `BoardCore.restore` keeps the legal prefix or falls back to the sample, never throws into `Recover` (Task 2 test `restore keeps the legal prefix`).
2. `useBoardInput` extracted from `GameVideo`: a drag, tap-tap, and the promotion picker (Esc, a click off the column) behave exactly as before on a game and a flipped board (Task 3: the existing live tests unchanged and passing).
3. Taking back (←) while Stockfish is still searching the move taken back: the eval bar and Analysis show the earlier position's results, never a late answer for the later one (Task 4 live test steps back during a search; `useMoveEval` keys by move list).
4. Paste FEN with Black to move: move numbers (`12… Kd7`), the side the eval bar favours, and the opening name all agree (Task 5 live test).
5. Clicking a book continuation after taking back two moves: it branches from the shown position (the moves after it are dropped), and the explorer updates to the new position (Task 6 live test).

---

### Task 1: Book continuations

**Files:**
- Modify: `app/openings-core.js` (`tracker` 13–36, `build` 38–62)
- Test: `tests/openings-core.test.cjs`

**Interfaces:**
- Produces: `Openings.book().continuations(ucis: string[], startFen?: string) -> [{ uci, san, eco, name }]` — the book moves from the position after `ucis` (from `startFen`, else the standard start), most book lines through the move first, each with the opening its position is named after (the deepest named position on its line, as `byPly` names positions; `eco`/`name` null if none). `[]` when the position isn't in the book or a move doesn't replay.

- [ ] **Step 1: Write the failing tests**

```js
test('continuations from the start are the book first moves, most lines first', () => {
  const next = window.Openings.book().continuations([]);
  assert.deepEqual(next.slice(0, 2).map((m) => m.uci).sort(), ['d2d4', 'e2e4']);
  assert.ok(next.length >= 15, next.length);
  assert.ok(next.every((m) => m.san && m.uci), 'every move has SAN and UCI');
  assert.equal(new Set(next.map((m) => m.uci)).size, next.length, 'no move twice');
});
test('continuations name the opening each move reaches, from moves or a FEN', () => {
  const book = window.Openings.book();
  const bb5 = book.continuations(['e2e4', 'e7e5', 'g1f3', 'b8c6']).find((m) => m.uci === 'f1b5');
  assert.match(bb5.name, /^Ruy Lopez/); assert.equal(bb5.san, 'Bb5');
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.deepEqual(book.continuations([], fen), book.continuations(['e2e4', 'e7e5', 'g1f3', 'b8c6']));
});
test('continuations out of the book, or after an illegal move, are empty', () => {
  const book = window.Openings.book();
  assert.deepEqual(book.continuations(['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8']), []);
  assert.deepEqual(book.continuations(['e2e5']), []);
  assert.deepEqual(book.continuations([], '4k3/8/8/8/8/8/8/4K2R w - - 0 1'), []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/openings-core.test.cjs`
Expected: FAIL (`book.continuations is not a function`)

- [ ] **Step 3: Implement**

`tracker.san` also records the move's UCI (`t.lastUci`). `build` keeps `edges: Map<key, Map<uci, { san, uci, next, n }>>`, counting `n` once per TSV line through the edge; `continuations` replays `ucis` with a tracker (any `null` → `[]`), reads the current key's edges, sorts by `n` descending (ties in SAN order, so the order is stable), and maps each to `{ uci, san, eco, name }` from `table.get(next)`. The cold-build test (600 ms) must still pass.

- [ ] **Step 4: Run all JS tests** — `node --test --test-concurrency=1 tests/*.test.cjs`, expected all pass; note the book's build time in the commit message if it grew by more than 50 ms.

- [ ] **Step 5: Commit**

```bash
git add app/openings-core.js tests/openings-core.test.cjs
git commit -m "Openings: book continuations from any position"
```

### Task 2: BoardCore, the free board's state

**Files:**
- Create: `app/board-core.js`, `tests/board-core.test.cjs`
- Modify: `build.cjs` (load it after `openings-core.js`), `tests/build.test.cjs` if it lists the units

**Interfaces:**
- Consumes: `ChessCore.parseFen`, `ChessCore.stepFromUci`, `ChessCore.moveNo`, `ChessCore.START_FEN`.
- Produces `window.BoardCore`:
  - `fenFromInput(text: string) -> string` — trims, unwraps `[FEN "…"]`, collapses runs of spaces; then `parseFen` (its messages pass through). Throws `"Paste a FEN first"` on empty input.
  - `fromFen(fen?: string) -> board` — `{ fen, start: { pos, ply0 }, steps: [], upto: -1 }`; `fen` normalised, `START_FEN` when omitted.
  - `restore(saved: { fen, moves: string[], upto: number }) -> board | null` — replays `moves` (UCI) from `fen`, keeping the legal prefix; `upto` clamped; `null` if `fen` itself doesn't parse.
  - `save(board) -> { fen, moves: string[], upto }`
  - `play(board, step) -> board` — drops the steps after `upto`, appends `step` (a `ChessCore` step), `upto` on it.
  - `go(board, upto) -> board` — `upto` clamped to `-1 … steps.length − 1`.
  - `pos(board)`, `ucis(board, n = upto + 1) -> string[]`, `label(board, j) -> '12… Kd7'` (via `moveNo(ply0 + j)`).

- [ ] **Step 1: Write the failing tests**

```js
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js');
const B = window.BoardCore, CC = window.ChessCore;
const step = (b, uci) => CC.stepFromUci(B.pos(b), uci);

test('a new board is the starting position with no moves', () => {
  const b = B.fromFen();
  assert.equal(b.fen, CC.START_FEN); assert.equal(b.upto, -1); assert.equal(B.pos(b).turn, 'w');
});
test('play, go back, and play again branches', () => {
  let b = B.fromFen();
  for (const u of ['e2e4', 'e7e5', 'g1f3']) b = B.play(b, step(b, u));
  assert.deepEqual(B.ucis(b), ['e2e4', 'e7e5', 'g1f3']);
  b = B.go(b, 0);
  assert.deepEqual(B.ucis(b), ['e2e4']); assert.equal(b.steps.length, 3, 'redo kept until a new move');
  b = B.play(b, step(b, 'c7c5'));
  assert.deepEqual(B.ucis(b), ['e2e4', 'c7c5']); assert.equal(b.steps.length, 2);
  assert.equal(B.go(b, 9).upto, 1); assert.equal(B.go(b, -5).upto, -1);
});
test('a FEN with Black to move numbers its moves from the FEN', () => {
  let b = B.fromFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  b = B.play(b, step(b, 'e8d7'));
  assert.equal(B.label(b, 0), '40… Kd7');
});
test('fenFromInput unwraps a PGN tag and passes parseFen\'s messages on', () => {
  assert.equal(B.fenFromInput('  [FEN "4k3/8/8/8/8/8/4P3/4K3  b - - 0 40"] '), '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  assert.throws(() => B.fenFromInput(''), /Paste a FEN/);
  assert.throws(() => B.fenFromInput('8/8/8/8/8/8/8/4K3 w - - 0 1'), /king/i);
});
test('save and restore round-trip; restore keeps the legal prefix', () => {
  let b = B.fromFen();
  for (const u of ['e2e4', 'e7e5']) b = B.play(b, step(b, u));
  b = B.go(b, 0);
  assert.deepEqual(B.save(B.restore(B.save(b))), { fen: CC.START_FEN, moves: ['e2e4', 'e7e5'], upto: 0 });
  const r = B.restore({ fen: CC.START_FEN, moves: ['e2e4', 'e2e4', 'd7d5'], upto: 2 });
  assert.deepEqual(B.ucis(r), ['e2e4']); assert.equal(r.steps.length, 1);
  assert.equal(B.restore({ fen: 'nonsense', moves: [], upto: -1 }), null);
});
```

- [ ] **Step 2: Run them to see them fail** — `node --test tests/board-core.test.cjs`. Expected: FAIL (no `board-core.js`).

- [ ] **Step 3: Implement** `app/board-core.js` as an IIFE setting `window.BoardCore`, in the style of `openings-core.js`; boards are plain objects, never mutated. Add it to `build.cjs`'s unit list after `openings-core.js`.

- [ ] **Step 4: Run all JS tests** — expected all pass (`tests/build.test.cjs` still builds both outputs).

- [ ] **Step 5: Commit**

```bash
git add app/board-core.js tests/board-core.test.cjs build.cjs
git commit -m "BoardCore: a free board's moves, takebacks and stored form"
```

### Task 3: Extract the board's pointer input from GameVideo

**Files:**
- Modify: `app/game-video-core.jsx` (`GameVideo` 794–864, its Esc handling 891)

**Interfaces:**
- Produces: `useBoardInput({ pos, onPick, onMiss, onMove }) -> { sel, drag, promo, targets, handlers: { onDown, onMove, onUp, onCancel }, cancelPromo, clear }`
  - `pos`: the position on the board; `onPick()`: a piece of the side to move was picked up (GameVideo pauses and opens its line); `onMiss()`: a tap or drop that played nothing (GameVideo's `leaveIfEmpty`); `onMove(step) -> void`: a legal move, promotion piece included (a `ChessCore.userMove` step). The hook owns `sel`, `drag`, `promo` and shows the promotion picker itself.

- [ ] **Step 1: Run the live suite before the change** to have a baseline: `LIVE_URLS=local LIVE_BROWSERS=chromium node --test tests/live/site.test.cjs`. Expected: PASS.
- [ ] **Step 2: Move** `sel`/`drag`/`promo`, `targets`, `boardXY`, `touch` and the promotion branch of `playMove` into `useBoardInput`. `GameVideo` keeps `vline`, calls the hook with `pos: touchPos`, `onPick: explore`, `onMiss: leaveIfEmpty`, `onMove: (step) => setVline(…append…)`, clears it when `vline` closes (`clear()`), and its Esc handler calls `cancelPromo()`.
- [ ] **Step 3: Run the live suite again** in both browsers and the JS tests. Expected: the same tests pass, unchanged (own move, promotion, flip, FEN start).
- [ ] **Step 4: Commit**

```bash
git add app/game-video-core.jsx
git commit -m "Board input: drag, tap-tap and the promotion picker as a hook"
```

### Task 4: The free board, from New board

**Files:**
- Create: `app/free-board.jsx` (concatenated into `game-video.jsx` in `build.cjs`, after `stockfish.jsx`, before `game-app.jsx`)
- Modify: `app/game-video-core.jsx` (`EvalBar` split into a drawing part, `EvalBarView({ cp, txt, a })`, used by both), `app/engine.jsx` (`CompositionStage`/`Stage`/`PlaybackBar` `still` prop; `nav.first` for Home), `app/game-app.jsx` (`readStored`, `commit`, board mode, the dock's New board menu, Settings in board mode), `app/shell.html` (menu styles), `build.cjs`
- Test: `tests/live/site.test.cjs`

**Interfaces:**
- Consumes: `BoardCore` (Task 2), `useBoardInput` (Task 3), `useMoveEval`, `OwnMoveAnalysis`, `MoveList`, `Header`, `LineBoard`, `BoardTouch`.
- Produces:
  - stored files `{ board: { fen, moves, upto } }` under the existing `STORE` key (replacing the loaded game, so "Clear the game" is New board).
  - `FreeBoard({ board, onChange(board), tw, sf, nav, orient, book })` — draws the frame from `L`: eval bar, player bars, board, Header (wide only: "White vs Black", "Free board · starting position" or "· from a FEN", the opening name), Moves (the board's moves through `MoveList`, given `{ ply0, plies }` and a still schedule `S = { N, tp: [0, 1, …] }` with `T = upto + 0.999`, so the move shown is highlighted and later ones dim), Commentary box (Task 6 fills it; here "Opening explorer" with nothing yet), Analysis (before a move: a one-line hint; after: `OwnMoveAnalysis`).
  - Keys: ← → step, Home start, End last move; F (existing) flips.
  - `CompositionStage still` — no Play, no times or track, no Space or arrow seeking.

- [ ] **Step 1: Write the failing live test** `desktop: New board sets up the starting position and rates both sides' moves`

In a fresh context on the sample: click `New board`, then `Starting position` in its menu. Assert: 32 pieces (`boardBox`), `.plabel` reads `Start`, no `Play (space)` button, no Ask Queen button. Drag `e2→e4` with the mouse: `.plabel` matches `/1\. e4/` and the Analysis text matches `/your move · .*(stockfish’s choice|cp vs|as good as|can’t run here|stopped)/i` within 45 s. Drag `e7→e5` (Black's move, by the same viewer): `.plabel` matches `/1… e5/`. Drag `g1→f3`, then press `ArrowLeft` at once (while Stockfish still searches `Nf3`): `.plabel` reads `1… e5` and, once settled, the Analysis names `e5`, not `Nf3`. Moves panel text matches `/1\.\s*e4\s*e5\s*Nf3/`. Reload: still the free board, `1… e5` shown, three moves in the list. Open Settings: `Back to sample game` brings the sample back (`.plabel` `Start`, Ask Queen visible). Screenshots: `-board.png` desktop, and phone (390×844) in a second context (`-board-phone.png`; the menu items under "New board"). `errors` empty.

- [ ] **Step 2: Run it to see it fail** — `LIVE_URLS=local LIVE_BROWSERS=chromium node --test tests/live/site.test.cjs` (Global Constraints). Expected: FAIL (no `New board` button).

- [ ] **Step 3: Implement**

`readStored` accepts `s.board` (through `BoardCore.restore`; `null` → the sample). `commit` skips `buildGame` for a board. In board mode `GameApp` renders `FreeBoard` in place of `GameVideo` (M stays the last good game for the hooks that need one) and hides what the "Decisions made here" list says. `FreeBoard` keeps the board in its parent's `files` (each move commits `{ board: BoardCore.save(b) }`), calls `setOrient` and `setLayout` like `GameVideo`, uses `useBoardInput({ pos, onMove: (s) => onChange(BoardCore.play(board, s)) })`, and evaluates `before = ucis(upto)`, `after = ucis(upto + 1)` (both `[]` before the first move) with `useMoveEval(…, board.fen)`; the eval bar shows `after.cp`, "…" while the first depth is pending. Player bars count material on `BoardCore.pos(board).b` against a full set. `PlaybackBar` in `still` mode renders Home (→ `nav.first`), ←, →, End, the label and the menu.

- [ ] **Step 4: Run the live suite in both browsers and the JS tests** — expected all pass. Show the desktop and phone screenshots (Chromium and Firefox) to the user before committing.

- [ ] **Step 5: Commit**

```bash
git add app/free-board.jsx app/game-video-core.jsx app/engine.jsx app/game-app.jsx app/shell.html build.cjs tests/live/site.test.cjs
git commit -m "Free board: New board from the starting position, every move rated"
```

### Task 5: Paste FEN

**Files:**
- Modify: `app/free-board.jsx` (`FenDialog`), `app/game-app.jsx` (the menu item, the dialog), `app/shell.html` (dialog styles, reusing the panel's tokens)
- Test: `tests/live/site.test.cjs`

**Interfaces:**
- Consumes: `BoardCore.fenFromInput`, `BoardCore.fromFen`.
- Produces: `FenDialog({ onSet(fen), onClose })` — a centred box (`role="dialog"`, `aria-label="Paste FEN"`) with one text field (`aria-label="FEN"`), a message line (`role="alert"`) and *Set up* / *Cancel*; Enter sets up, Esc cancels. An error leaves the board and the dialog's text as they were.

- [ ] **Step 1: Write the failing live test** `desktop: Paste FEN sets up a position, and says what's wrong with a bad one`

Fresh context: `New board` → `Paste FEN…`. Type `8/8/8/8/8/8/8/4K3 w - - 0 1`, press Enter: the alert matches `/king/i`, the dialog stays, the sample's board is unchanged (`.plabel` `Start`, 32 pieces). Clear the field, type `4k3/8/8/8/8/8/4P3/4K3 b - - 0 40`, click `Set up`: the dialog closes, 3 pieces on the board, `.plabel` `Start`. Drag `e8→d7`: `.plabel` matches `/40… Kd7/`. Screenshot of the dialog (desktop and phone) before setting up. `errors` empty.

- [ ] **Step 2: Run it to see it fail.** Expected: FAIL (no `Paste FEN…` item).

- [ ] **Step 3: Implement** — the dialog's state lives in `GameApp`; *Set up* commits `{ board: BoardCore.save(BoardCore.fromFen(fen)) }`. The field is focused on open; F, the arrows and Space don't reach the board while typing (the handlers already ignore inputs).

- [ ] **Step 4: Run the live suite in both browsers and the JS tests** — expected all pass. Show the dialog screenshots before committing.

- [ ] **Step 5: Commit**

```bash
git add app/free-board.jsx app/game-app.jsx app/shell.html tests/live/site.test.cjs
git commit -m "Free board: Paste FEN, with a plain message for a bad one"
```

### Task 6: The opening explorer

**Files:**
- Modify: `app/free-board.jsx` (`OpeningExplorer` in the Commentary box), `app/game-app.jsx` (pass the built book: `window.Openings.book()` after the first paint, as `book` is now)
- Test: `tests/live/site.test.cjs`

**Interfaces:**
- Consumes: `Openings.book().continuations` (Task 1), `identify`.
- Produces: `OpeningExplorer({ board, book, onPlay(uci) })` in `L.comment`, titled "Opening explorer", right: `ECO name` of the position (`identify`, which keeps the last named position once out of book). Body: the position's name in the serif (or "Starting position"), then one row per continuation (`role="button"`, the SAN as a chip in the move's colour, then the opening it reaches, dimmed); the box scrolls when they don't fit. Out of book: "Out of book" and, if any, "last book position: …". From a FEN outside the book: "This position isn't in the opening book." Before the book has built: "Loading the opening book…".

- [ ] **Step 1: Write the failing live test** `desktop: the explorer names the opening and plays a book move`

Fresh context: `New board` → `Starting position`. The Commentary box contains a row with text `e4`; click it (mouse): `.plabel` matches `/1\. e4/`, the box's rows include `c5` with `/Sicilian/`; click the `c5` row: the box's heading matches `/Sicilian Defense/`. Press `ArrowLeft` twice (back to the start), click the `d4` row: `.plabel` matches `/1\. d4/` and the Moves panel has no `c5`. Drag `a2→a3`, `h7→h6`, `a3→a4`, `h6→h5` until the box reads `/Out of book/` (or the box is never empty of text). Screenshots `-explorer.png` desktop and phone. `errors` empty.

- [ ] **Step 2: Run it to see it fail.** Expected: FAIL (no explorer rows).

- [ ] **Step 3: Implement** — clicking a row plays `ChessCore.stepFromUci(pos, uci)` through the same `onChange(BoardCore.play(…))` as a drag, so Stockfish rates it. The rows are buttons in the tab order (Enter/Space play), like `LineChips`.

- [ ] **Step 4: Run the live suite in both browsers and the JS tests** — expected all pass. Show the screenshots before committing.

- [ ] **Step 5: Commit**

```bash
git add app/free-board.jsx app/game-app.jsx tests/live/site.test.cjs
git commit -m "Free board: the opening explorer in the Commentary box"
```

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md` (Gotchas), `README.md` (what the page does), the spec's "Carried forward" section

- [ ] **Step 1:** CLAUDE.md Gotchas, one line: "The free board (`files.board`, `app/free-board.jsx`, state in `BoardCore`) is a separate view from `GameVideo`: the replay's timeline never sees a zero-ply game; both take board input through `useBoardInput`". README: New board and Paste FEN, the explorer. In the spec, under "Carried forward", add what this plan's reviews defer.
- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-10-19-free-board-design.md
git commit -m "Docs: the free board and the opening explorer"
```
