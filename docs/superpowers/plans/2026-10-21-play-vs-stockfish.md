# Play vs Stockfish Implementation Plan

**Goal:** The viewer plays a full game against Stockfish at full strength, from the starting position or the board's set-up position, as White, Black or a random side. The board stays on the player's side, Stockfish replies after a short pause, ← is a Take back button that goes back to the player's previous turn, the game ends as Play vs human does (bar draw offers), optional clocks run for both sides, and nothing hints at a move; Stockfish quietly rates the player's moves and says in the Commentary box when one is an inaccuracy, mistake or blunder, without the eval or the better move until the game ends.

**Architecture:** A Stockfish game is a game record with `mode: 'stockfish'` and `you: 'w' | 'b'` (`board.game = { mode, you, id, tc, date, clock, result, critique }`), stored, kept in My games and resumed as a vs-human game is. `PlayCore` grows the mode: `start(board, tc, date, { mode, you })`, takebacks to the player's turn (`canTakeback`), `thinkMs` (Stockfish's time for a move), `critique` (the player's flagged moves, trimmed on takebacks), `critiqueText`, and the PGN's names. The engine gets a third priority, `play`, ahead of `own` and `game`, so Stockfish's reply never waits behind analysis. A hook in `app/free-board.jsx`, `useEngineOpponent`, runs Stockfish's side: while the player thinks it searches the position on the board (the "before" of the player's next move, at `own` priority, the engine being idle then); on the player's move it stops that search, searches the new position at `play` priority after at least `REPLY_PAUSE_MS`, plays the best move through `PlayCore.move`, and rates the player's move from the two searches (`AnalysisCore.rateMove`). Every result is checked against the latest board (game id and move list) before it lands, so a takeback, a resign or a new game drops it.

**Spec:** `docs/superpowers/specs/2026-10-19-free-board-design.md`, step 5 ("Play vs Stockfish: colour, full-strength replies, background critique").

## Global Constraints

- Anti-goals: no eval bar, arrows, verdicts, best moves or book hints during a game; analysis and the engine's own moves never stall each other on the worker, and a stale result never lands on the wrong position.
- Play vs human, the free board's explore mode and loaded games behave as before; the existing tests are the guard.
- Stockfish plays at full strength: no `Skill Level`, `UCI_LimitStrength` or `UCI_Elo` set.
- Only the Render site matters; `node build.cjs` must still build the artifact.
- Long one-line statements: split only lines you change (CLAUDE.md).
- Run: `node --test --test-concurrency=1 tests/*.test.cjs`; live: `LIVE_URLS=local FIREFOX_PATH=playwright node --test tests/live/site.test.cjs` (sandbox disabled; no `../chess-animator` here, and nothing touches the analysis JSON).

## Decisions made here (the spec left them to the builder)

- **Entering**: *Play vs Stockfish…* follows *Play vs human…* in the Play/Explore menu and the phone menu's group. Its dialog is Play vs human's with one more row, *You play*: White, Black, Random (remembered as the `playSide` setting, default White; Random is resolved when the game starts).
- **Stockfish's moves**: `go depth 30 movetime <thinkMs>`; without a clock 2 s a move; with one, `min(2 s, its time left / 30 + increment / 2)`, at least 0.1 s, so it never flags. A reply lands at least `REPLY_PAUSE_MS` (600 ms) after the player's move. After a reload with Stockfish to move, it searches again.
- **Takeback**: the Game box's *Take back* removes moves until it is the player's turn with one of the player's moves gone (Stockfish's reply and the player's move, or just the player's move while Stockfish thinks, which stops the search). Hidden when no player's move is on the board (the player is Black and only Stockfish's first move is played). Clocks as in Play vs human (each removed move's increment goes).
- **No draw offers** against Stockfish (it doesn't negotiate); resign, the rules' draws and flag falls end the game. Resign asks "Resign this game?".
- **Input**: the board takes no moves while Stockfish is to move.
- **Names**: "You" and "Stockfish 19" in the player bars, the header and the PGN (`Event "Play vs Stockfish"`). The result line keeps White/Black ("Black resigned").
- **Critique**: a player's move rated inaccuracy, mistake or blunder (`rateMove`, needs both searches finished at depth ≥ 8; otherwise the move goes unrated) is kept in `game.critique` as `{ j, cls, best }` (j its step index, best Stockfish's preferred move in UCI). During the game the Commentary box shows the latest flagged move: "Mistake: 14. Nxe5" and a short line, `critiqueText`: "that drops the knight" when Stockfish's reply line (its first four plies) wins one of the player's pieces net (the most valuable named), "that allows mate" when the eval after it is a mate against the player, else a line per class ("there was a better move", "that gives Stockfish the edge", "that should lose"). After the end the box lists every flagged move with the better move ("Better was Nf3").
- **My games**: a Stockfish game's row reads "vs Stockfish · you played White" in its meta line; replay and resume as before.
- **Engine down**: the Game box says "Stockfish can't run here" (or "Stockfish stopped · Take back or Resign"); a stopped engine starts again on the next search.

## Tasks

1. **Core.** `SFEngine`: priority `play` before `own` before `game` (unit test). `PlayCore`: the mode in `start`, `resume`, `pgn`; `canTakeback` and the mode's takeback; `thinkMs`; `critique` / `addCritique` (only for a step that is still the player's, dropped with its move on takebacks); `critiqueText(pos, pv, you, cls, mate)`. `GamesCore` keeps working for the mode. Unit tests in `tests/play-core.test.cjs`, `tests/sf-engine.test.cjs`, `tests/games-core.test.cjs`. Commit.
2. **The page.** `useEngineOpponent` and the mode in `FreeBoard` (orientation from `you`, no input on Stockfish's turn, names), `GameInfo` and `GameStatus` for the mode, `PlayDialog` with *You play*, the menu items and `playStart` in `GameApp`, `TWEAK_DEFAULTS.playSide`, the dock status, the Settings note, My games' rows. Live tests: `desktop: Play vs Stockfish replies, keeps the board on the player's side, takes back to the player's turn` (as White; then a Black game where Stockfish moves first and the board is drawn from Black), and `desktop: Play vs Stockfish flags a blunder` (from a set-up position where a queen move hangs it). Screenshots desktop 1440×900 and phone 390×844, Chromium and Firefox. Commit.
3. **Docs.** CLAUDE.md (the game record's mode, the `play` priority), README, the spec's carried-forward notes for plan 5. Commit.

## Done

- Task 1: d1e1a80 (core), 956f15b (a critique keeps its line; resign takes a side).
- Task 2: 83a5818 (the page), e783620 (the search while the player thinks capped at depth 22 or 15 s).
- Task 3: this commit (docs).
- Live tests passed in Chromium (31/31) and in Firefox with service workers blocked (28/29; the offline test can't run here).
