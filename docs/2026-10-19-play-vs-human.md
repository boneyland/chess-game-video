# Play vs Human Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people play a full game at one screen, from the starting position or the board's set-up position: the board turns after each move so the side to move is at the bottom, ← takes a move back, the game ends on checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient material, resignation or a flag fall, with optional clocks, and nothing on the page hints at a move.

**Architecture:** A game is a free board with a `game` record: `board.game = { mode: 'human', tc, date, clock, result }`, kept in the same stored files (`{ board: { fen, moves, upto, game } }`), so a reload brings it back and step 4 can save it as a PGN. The rules (end detection, clocks, takebacks, resignation, the PGN) are a pure unit, `PlayCore` (`app/play-core.js`), unit-tested in Node. `FreeBoard` gets a game mode: no Stockfish search, no eval bar, no explorer, the board turned to the side to move, clocks in the player bars, the result and Resign in the Analysis box. `GameApp` gets the Play vs human dialog and a confirm before a game in progress is thrown away.

**Tech Stack:** plain JS units (`app/*.js`) and JSX (`app/*.jsx`, precompiled by `build.cjs`), `node --test`, Playwright live tests (`tests/live/site.test.cjs`).

**Spec:** `docs/superpowers/specs/2026-10-19-free-board-design.md` (this plan is its step 3 of 6: "Play vs human: auto-flip, takebacks, end detection, clocks")

## Global Constraints

- Only the Render site matters; `node build.cjs` must still build the artifact without errors, nothing more.
- Anti-goal: Stockfish's eval bar, arrows, ratings or thinking visible during a game against a person. In a game `FreeBoard` starts no search at all (`useMoveEval` gets no moves), and the explorer, the opening name and the eval bar are not drawn.
- Loaded games and the free board's explore mode behave exactly as before; the existing live tests are the guard.
- Not in this plan: saving played games and My games (step 4), Play vs Stockfish (step 5), Chess960 (step 6). The game record is kept in a shape step 4 can save (`PlayCore.pgn`).
- Long one-line statements: split only lines you change (CLAUDE.md).
- Visual changes: screenshots of desktop (1440×900) and phone (390×844), Chromium and Firefox, in the PR description (CLAUDE.md, the `pr-screenshots` branch).
- Run after JS changes: `node --test --test-concurrency=1 tests/*.test.cjs`; the live suite with `LIVE_URLS=local FIREFOX_PATH=playwright node --test tests/live/site.test.cjs` (this cloud machine reaches cdnjs, so no `LIVE_CDN_DIR`; no `../chess-animator`, so `tests/check_browser_json.py` can't run, and nothing here touches the analysis JSON).

## Decisions made here (the spec left them to the builder)

- **Entering**: *Play vs human…* joins the New board menu (dock) and the phone menu's New board group, and opens a small dialog (styled as Paste FEN's): *Start from* (the starting position, or the board's set-up position when a free board from a FEN is open), *Clock* (Off, 5+0, 10+0, 15+10, 30+0; Off by default, the last choice remembered as the `playClock` setting), *Cancel* / *Start game*.
- **During a game**: no eval bar (an empty bar would read as 0.00), no arrows, no opening name in the header, no explorer. The Commentary box becomes "Play vs human": the start, the time control and how the game works (the board turns, ← takes back). The Analysis box ("Game") says whose move it is (and check), with *Resign* for the side to move.
- **Orientation**: in a game the board is drawn from the side to move in the game's last position, whatever the Flip setting; after the end it stays as it was at the last move, so browsing doesn't spin it. Settings' Flip toggle is hidden in a game, and F does nothing there.
- **Takebacks**: ← (and the transport bar's ←, labelled "Take back (←)") removes the last move while the game is in progress; → Home and End do nothing then. No limit and nothing recorded. Clocks aren't wound back: the time used stays used, and the increment the taken-back move earned is removed. Taking back every move stops the clocks again.
- **End detection** is automatic (no claims): checkmate, stalemate, threefold repetition (same pieces, side to move, castling rights and en-passant capture, counted from the game's start), the fifty-move rule (100 half-moves without a capture or pawn move, counting the FEN's half-move clock), insufficient material (neither side can mate). Checkmate wins over the fifty-move rule on the same move. A FEN start that is already mate or stalemate ends the game at once.
- **Mating material** (insufficient material and flag falls): a side can't mate with a lone king, or a king and one minor piece against a lone king, or when the only pieces left besides the kings are bishops all on squares of one colour. Anything else counts as mating material (K+N against K+N included).
- **Clocks**: they start with the first move (its mover isn't timed for it), then the side to move's clock runs; each move adds the increment. A flag fall ends the game when the clock reaches zero: a loss, or a draw when the opponent has no mating material. The running clock sits in its player bar as replayed clocks do (light while running, red under a minute). A reload pauses the clocks: they run again from the next move (the time between the last move and the reload isn't charged).
- **After the end** the Analysis box shows the result in the move headline's size ("1–0", "½–½") and why ("Checkmate", "Black resigned", "White's flag fell", "Draw by threefold repetition" …), with *Play again* (the same start and clock) and *Analyse on the free board* (the game's moves as a free board, Stockfish on). ← → Home End browse the moves; the board takes no moves.
- **Leaving** a game in progress (at least one move played, no result) asks first in a small dialog, "Leave this game?", with *Keep playing* and *Leave the game*: Load game… (dock and Settings), a dropped file, New board's items, Play vs human…, Back to sample game. A finished game, or one with no moves yet, is left without asking.
- **Settings in a game**: the Game section reads "Play vs human · 10+0 · 12 moves" (or "· no clock"); "Replay these moves as a game" is hidden while the game is in progress.
- **The PGN** (for step 4, tested now): `Event "Play vs human"`, `Site "chess-replay"`, `Date` the game's start, `White "White"`, `Black "Black"`, `Result`, `[SetUp]`/`[FEN]` for a FEN start, `[TimeControl "600+0"]` and `{ [%clk 0:09:58] }` after each move when clocked, `[Termination]` when over.

## Review Focus

1. Threefold repetition with an en-passant square that no pawn can take: the positions after 1. e4 and after a later return to it must count as the same (Task 1 test `repetition ignores an en-passant square nobody can use`).
2. A takeback after the game ended by a flag or resignation is not possible (← browses then); a takeback after checkmate isn't either (Task 2 test `takebacks only in a game in progress`).
3. A flag fall against a lone king is a draw, not a win (Task 2 test `a flag fall loses unless the opponent can't mate`).
4. A stored game with more clock entries than moves, a `since` timestamp, or a result that no longer matches (edited localStorage): `resume` trims, pauses and recomputes, never throws (Task 2 test `resume pauses the clocks and trims what doesn't fit`).
5. No Stockfish output during a game: the live test checks the page's text for eval figures, "Stockfish" and the explorer after each move (Task 3).

---

### Task 1: PlayCore, end detection

**Files:**
- Create: `app/play-core.js`, `tests/play-core.test.cjs`
- Modify: `app/chess-core.js` (export `hasLegal`, `legalTargets` is already out), `build.cjs` (load it after `board-core.js`), `tests/build.test.cjs` (its unit list)

**Interfaces:**
- Produces `window.PlayCore`:
  - `canMate(pos, color) -> boolean` (the mating-material rule above).
  - `positionKey(pos) -> string`: pieces, side to move, castling rights, and the en-passant square only when a pawn of the side to move can take there.
  - `outcome(board) -> null | { result: '1-0' | '0-1' | '1/2-1/2', reason: 'checkmate' | 'stalemate' | 'repetition' | 'fifty' | 'material' }` for the position after the board's last move.

- [ ] **Step 1: Write the failing tests**

```js
const { loadUnit } = require('./load.cjs');
loadUnit('chess-core.js'); loadUnit('board-core.js'); loadUnit('play-core.js');
const B = window.BoardCore, P = window.PlayCore, CC = window.ChessCore;
const playAll = (b, ucis) => ucis.reduce((x, u) => B.play(x, CC.stepFromUci(B.pos(x), u)), b);

test('checkmate and stalemate', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen(), ['f2f3', 'e7e5', 'g2g4', 'd8h4'])), { result: '0-1', reason: 'checkmate' });
  const b = B.fromFen('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
  assert.deepEqual(P.outcome(playAll(b, ['f1f7'])), { result: '1/2-1/2', reason: 'stalemate' });
  assert.deepEqual(P.outcome(playAll(b, ['f1f8'])), { result: '1-0', reason: 'checkmate' });
  assert.equal(P.outcome(b), null);
});
test('threefold repetition, counted from the start', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  assert.equal(P.outcome(playAll(B.fromFen(), shuffle)), null, 'twice is not yet a draw');
  assert.deepEqual(P.outcome(playAll(B.fromFen(), shuffle.concat(shuffle))), { result: '1/2-1/2', reason: 'repetition' });
});
test('repetition ignores an en-passant square nobody can use', () => {
  const b = playAll(B.fromFen(), ['e2e4', 'g8f6', 'g1f3', 'f6g8', 'f3g1', 'g8f6', 'g1f3', 'f6g8', 'f3g1']);
  assert.deepEqual(P.outcome(b), { result: '1/2-1/2', reason: 'repetition' });
});
test('the fifty-move rule counts the FEN\'s half-move clock', () => {
  const b = B.fromFen('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80');
  assert.deepEqual(P.outcome(playAll(b, ['a1a2'])), { result: '1/2-1/2', reason: 'fifty' });
  assert.equal(P.outcome(playAll(b, ['e2e3'])), null, 'a pawn move resets it');
});
test('insufficient material, and what still counts as mating material', () => {
  assert.deepEqual(P.outcome(playAll(B.fromFen('4k3/8/8/8/8/8/3r4/3BK3 w - - 0 1'), ['e1d2'])), { result: '1/2-1/2', reason: 'material' });
  const pos = (fen) => CC.parseFen(fen).pos;
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), false);
  assert.equal(P.canMate(pos('4k2n/8/8/8/8/8/8/3NK3 w - - 0 1'), 'w'), true, 'K+N against K+N');
  assert.equal(P.canMate(pos('4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'), 'w'), false, 'bishops on one colour');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1'), 'w'), true, 'bishops on both colours');
  assert.equal(P.canMate(pos('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 'w'), true, 'a pawn');
});
```

- [ ] **Step 2: Run them to see them fail** — `node --test tests/play-core.test.cjs`. Expected: FAIL (no `play-core.js`).
- [ ] **Step 3: Implement** `app/play-core.js` as an IIFE in the style of `board-core.js`. Half-move clock: the FEN's fifth field, reset by a SAN starting with a file letter (a pawn move) or containing `x`. Repetition: `positionKey` of the start and of every step's `pos`, the last one counted. Add the unit to `build.cjs` and `tests/build.test.cjs`.
- [ ] **Step 4: Run all JS tests** — expected all pass.
- [ ] **Step 5: Commit** — `PlayCore: the end of a game (mate, stalemate, repetition, fifty moves, material)`

### Task 2: PlayCore, the game: clocks, takebacks, resignation, the PGN

**Files:**
- Modify: `app/play-core.js`, `app/board-core.js` (`save`/`restore` carry `game`), `tests/play-core.test.cjs`, `tests/board-core.test.cjs`

**Interfaces:**
- Produces on `window.PlayCore` (all pure; `now` in ms):
  - `TIME_CONTROLS = ['5+0', '10+0', '15+10', '30+0']`
  - `start(board, tc: string | null, date?: string) -> board` with `game = { mode: 'human', tc, date, clock: tc ? { left: { w, b }, since: null, clk: [] } : null, result: outcome(board) && {…} }`
  - `inProgress(board) -> boolean` — a game with no result.
  - `move(board, step, now) -> board` — plays on the last move, charges the mover, adds the increment, records `clk`, starts the opponent's clock, sets `result` from `outcome` or a flag fall.
  - `takeback(board, now) -> board` — in progress only (else the board as it was).
  - `resign(board, now) -> board` — the side to move resigns.
  - `timeLeft(board, side, now) -> ms | null`, `flag(board, now) -> board` — the result when the side to move is out of time.
  - `resultText(result) -> { score: '1–0', why: 'Checkmate' }`.
  - `resume(board, game) -> board` — a stored game back: `clk` trimmed to the moves, `since` null (paused), the result recomputed from the moves when it wasn't a resignation or a flag.
  - `pgn(board) -> string` (the tags under "Decisions"; parses with `ChessCore.buildGame`, clocks included).
- `BoardCore.save(b)` adds `game` when the board has one; `BoardCore.restore(saved)` passes `saved.game` through `PlayCore.resume`.

- [ ] **Step 1: Write the failing tests**: `clocks start with the first move and add the increment` (5+0: after White's first move at 1000 and Black's at 4000, Black has 297 s and `clk` is `[300000, 297000]`; 15+10 adds 10 s to each); `a flag fall loses unless the opponent can't mate` (Black flags at 5:00 against K+R: `1-0`; against a lone king: `1/2-1/2`, reason `time`); `takebacks only in a game in progress` (the move and its `clk` go, the side to move changes back; after mate or resignation `takeback` returns the board unchanged); `resign`; `resume pauses the clocks and trims what doesn't fit`; `the PGN has the result, the time control and the clocks` (`buildGame` reads it: `M.hasClock`, `M.result`); and in `board-core.test.cjs` `save and restore keep a game`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all JS tests** — expected all pass.
- [ ] **Step 5: Commit** — `PlayCore: clocks, takebacks, resignation and the game's PGN`

### Task 3: Play vs human on the page

**Files:**
- Modify: `app/free-board.jsx` (game mode, `PlayDialog`, `GamePanel`, `FreeBar` clocks), `app/game-app.jsx` (the menu item, the dialog, orientation, Settings in a game), `app/engine.jsx` (`nav.current.prevLabel`, `hasFirst`), `app/shell.html` (`playClock` default, dialog styles), `build.cjs` if the dialog's styles need nothing more
- Test: `tests/live/site.test.cjs`

- [ ] **Step 1: Write the failing live test** `desktop: Play vs human turns the board, takes back, and ends in mate`: New board → *Play vs human…* → Clock *5+0* → *Start game*. No eval bar text, no "Opening explorer", no "Stockfish" in the panels. Drag f2→f3 (White at the bottom); the board turns (Black at the bottom: drag e7→e5 on flipped squares); a clock reads `4:5x` or `5:00` in a bar. ← takes back `e5` (the Moves panel loses it; still Black at the bottom); e7→e5 again, g2→g4, d8→h4: the Analysis box reads `0–1` and `Checkmate`. Reload: the result is still there. Screenshots desktop and phone (390×844) of a game in progress with clocks. `errors` empty.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement** the decisions above. `FreeBoard` in a game: `useMoveEval(sf.engine, null, null, …)` (no search), moves through `PlayCore.move(board, step, Date.now())`, a 100 ms tick while a clock runs and `PlayCore.flag` when it reaches zero.
- [ ] **Step 4: Run the live suite in both browsers and the JS tests** — expected all pass.
- [ ] **Step 5: Commit** — `Play vs human: a game at one screen, the board turning to the side to move`

### Task 4: Leaving a game asks first

(Built and committed with Task 3: the guard and its dialog share `GameApp`'s code with the Play vs human dialog. The live test covers both.)

**Files:**
- Modify: `app/free-board.jsx` (`ConfirmDialog`), `app/game-app.jsx` (`guard(run)` around the actions listed in "Decisions")
- Test: `tests/live/site.test.cjs`

- [ ] **Step 1: Extend the live test**: a new game with one move; New board → Starting position shows "Leave this game?"; *Keep playing* keeps the move; again, *Leave the game* gives the free board. A finished game is left without the dialog.
- [ ] **Step 2: Implement**; the dialog's focus and keys work as Paste FEN's (Esc keeps playing).
- [ ] **Step 3: Run all tests.**
- [ ] **Step 4: Commit** — `Play vs human: leaving a game in progress asks first`

### Task 5: Docs

- [ ] CLAUDE.md Gotchas: a game is a free board with `board.game` (`PlayCore`); no Stockfish search in a game. README: Play vs human. The spec: "Carried forward from plan 3".
- [ ] Commit — `Docs: play vs human`

## Changes after review (2026-10-19)

The user tried the PR and asked for these; they replace the decisions above where they differ:
- The dock's **New board** button is now **Play/Explore** (the phone menu's group label too); its items are unchanged.
- **Take back** is a button in the Game box, beside Offer a draw and Resign. ← and the transport bar no longer take moves back (in a game in progress they do nothing).
- **Resign** asks first, in the Game box: "Resign as White?" with *Resign* and *Keep playing*.
- **Draw by agreement**: *Agree a draw* in the Game box (once a move has been played) asks "Do both players agree to a draw?" (*Agree*, *Keep playing*); the result is "½–½ · Draw by agreement" (`PlayCore.agreeDraw`, kept through a reload, `Termination "normal"` in the PGN).
- After the end, **Play again** sits to the right of the score and reason; **Analyse on the free board** stays on the row below.
- Second round: *Agree a draw* is now **Offer a draw**: the side to move offers, and the box asks the other side "Black offers a draw. White, accept?" (*Accept*, *Decline*). The text of the Game box's buttons (all the frame's buttons) can't be selected, so clicking them never highlights it.
