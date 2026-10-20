# Played Games Implementation Plan

**Goal:** Every game played at the board is kept in the browser as it goes, and a My games list opens one: a finished game replays like a loaded game (replay, own moves, Analyse with Stockfish, Queen, Save PGN, video export), a game in progress resumes on the board. The list keeps the 50 most recent, and each can be deleted.

**Architecture:** A pure unit, `GamesCore` (`app/games-core.js`), keeps the list: `[{ id, updated, board }]`, newest first, `board` in `BoardCore.save`'s form (so a game in progress resumes with its clocks and result through `BoardCore.restore`), stored under `chess-video.games.v1`. A game gets an `id` in `PlayCore.start`, kept through `PlayCore.resume`. `GameApp.commitBoard` passes every game board to `GamesCore.keep`, reading the stored list afresh each time (another tab's games survive). The PGN is made when a game is opened (`PlayCore.pgn`), not stored.

**Spec:** `docs/superpowers/specs/2026-10-19-free-board-design.md`, step 4 of 6 ("Played games: saving, the My games list, opening one in the replay").

## Decisions made here (the spec left them to the builder)

- **What is kept**: a game from its first move. One with no moves (just started, or every move taken back) isn't, and taking every move back drops it from the list.
- **Entering**: *My games…* is the last item of the Play/Explore menu (dock) and of the phone menu's Play/Explore group. It opens a dialog styled as Paste FEN's.
- **A row**: the result and why ("0–1 · Checkmate") or "In progress · Black to move"; below, the date, the clock, the moves and the start ("20 Oct 2026 · 10+0 · 24 moves · from a set-up position"). A finished game has *Replay*, a game in progress *Resume* (the one on the board now reads *Playing now*, and has no Delete). *Delete* asks in the row: "Delete this game?" *Delete* / *Keep*.
- **Replay** opens the game's PGN as a loaded game (`pgnName` `my-game-<date>.pgn`).
- **Leaving a game in progress** still asks, but now says it is kept: "It stays in My games, to resume later; its clocks pause until the next move."
- **Storage full**: the board still changes; an error says the game couldn't be kept.
- **Clear saved data** (the crash screen) leaves My games alone: the list is read only when the dialog opens or a game is kept, never while the page first renders.

## Tasks

1. `PlayCore`: a game `id` (`start`, `resume`). `GamesCore`: `read`, `keep`, `remove`, `KEEP`. Unit tests. Commit.
2. The page: `GameApp` keeps games, `MyGamesDialog` (`app/free-board.jsx`), styles (`app/shell.html`), the leave text. Live test `desktop: My games keeps played games, replays a finished one and resumes one in progress` (with a phone screenshot of the list). Commit.
3. Docs: CLAUDE.md, README, the spec's carried-forward notes. Commit.
