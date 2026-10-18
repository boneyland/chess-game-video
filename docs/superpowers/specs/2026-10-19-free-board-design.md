# Free board: play and explore without a game file

2026-10-19. Status: approved 2026-10-19.

## Intent

Today the page needs a game (the sample, or a loaded PGN) and is built around replaying it as a video. The user wants
it to double as a plain chessboard with Stockfish, for three things:

1. **Explore**: play through openings from the starting position and see how Stockfish rates each move.
2. **Study a position**: paste a FEN from a book or puzzle and work from there.
3. **Play**: against another person at the same screen, taking turns, or against Stockfish.

Only the Render site matters (2026-10-18 decision); the claude.ai artifact needs no parity.

## What the user decided

- **Starting points without a file**: the starting position, a pasted FEN, and a way to clear the loaded game. All
  three leave a board with no moves, waiting for a move.
- **Board flipping**: an option to flip the board.
- **Opening explorer** in the existing Commentary box: the known book moves that continue from the current position.
  No win rates or game counts (the page's Lichess table has only names; an online database is out of scope).
- **Play vs human** is its own button. Same screen, turns alternate, and **the board flips after each move** so the
  side to move is at the bottom. **Stockfish doesn't analyse** during a game against a person.
- **Play vs Stockfish** is its own button. **The board doesn't flip** after moves: it stays on the player's side.
- **Stockfish plays at full strength**: no strength or rating setting ("prepare to get crushed").
- **The player picks White, Black or random** against Stockfish.
- **Hints hidden against Stockfish too**, but Stockfish **secretly analyses the player's moves and can criticise bad
  ones**.
- **Takebacks** are allowed in games.
- **Chess clocks**, optional.
- **Played games are kept** (in the browser's storage) and can be browsed, replayed, analysed, and exported as PGN and
  as video, like a loaded game.
- **Games can start from any legal FEN**, custom positions included, and **Chess960** (the only variant).

## Goals

- From any state, one or two clicks reach an empty board (start position or FEN) with Stockfish on.
- Explore mode keeps what own moves already get: the eval bar, Stockfish's verdict on each move, its best move and
  replies, the move list, and now the book continuations.
- Two people can play a full game on one device without the page giving hints to either.
- A Stockfish game is a real game: Stockfish answers each move, and the game ends on mate, stalemate or a draw.

## Non-goals

- Online play, accounts, or anything that leaves the browser.
- Win rates, game counts or master games in the explorer.
- A drag-and-drop position editor (a FEN is pasted instead).
- Changing how loaded games replay or export, beyond what custom start positions need.
- Limiting Stockfish's strength.

## Anti-goals (a failure even if it works)

- Stockfish's eval bar, arrow, ratings or thinking visible during a game against a person.
- The replay of a loaded game getting worse: its title card, timeline, export, or own-move exploration changing.
- A pasted FEN that is illegal or malformed crashing the page instead of saying what's wrong.
- Stockfish's analysis of the viewer's moves fighting the engine's own game moves for the same worker (one stalls the
  other, or a stale result lands on the wrong position).

## Constraints found in the code

These shape the build; none is decided by the user.

- `ChessCore.buildGame` requires at least one move and rejects any `[FEN]` other than the standard start
  (`chess-core.js` ~366–368). Ply parity (`i % 2` for the side, `lineLabel`'s move numbers) assumes White moves first.
- The page is a timeline: `GameVideo` derives scenes, cues and `S.N` from the game's plies. A game with zero plies
  isn't a case it handles.
- Own moves already exist as a "line" off the game (`vline` in `game-video-core.jsx`): a base position, a move list,
  `useMoveEval` for Stockfish's verdict, `OwnMoveAnalysis` for the panel, and the board's `BoardTouch` input
  (drag, tap-tap, the promotion picker).
- Played games must replay through the existing pipeline, so `buildGame` has to accept a `[FEN]` start (and Black
  moving first): this is no longer avoidable by a separate view.
- The engine wrapper (`sf-engine.js`) only sends `position startpos moves …`. A FEN start needs
  `position fen <fen> moves …`, and every caller that keys caches on move lists (`SF_EVAL_CACHE`, `readSfPartial`)
  needs the FEN in its key.
- The opening book (`openings-core.js`) matches positions, not move orders, so it can name positions reached from a
  FEN too. It has no "continuations" query yet: `build()` would also keep, for each position, the book moves that
  leave it (SAN and the opening each one reaches).
- The board has no flipped rendering: square 0 is a8 at the top-left everywhere (`Board`, `BoardTouch`, `LineBoard`,
  arrows, coordinates, `boardBox` in the live tests).
- Stockfish 19 lite supports `UCI_LimitStrength`/`UCI_Elo` and `Skill Level`, if a strength setting is wanted.

## How it should behave

**Entering.** Near "Load game…" (my call: a menu or small group in the dock, and the same items in the phone menu):
*New board* (starting position), *Paste FEN…*, *Play vs human*, *Play vs Stockfish*. "Clear the game" is the same
as New board: the stored game is dropped, and "Back to sample game" in Settings still brings the sample back.

**Explore (New board or FEN).** The board waits for a move. Every move, by either side, gets Stockfish's verdict as own
moves do now; the eval bar follows. The move list shows the moves played, numbered correctly when Black moves first
from a FEN. The Commentary box shows the opening's name (if the position is in the book) and its book continuations;
clicking one plays it (my call). Once out of book it says so briefly (my call). Undo/redo with ← → as lines do now
(my call).

**Paste FEN.** A small dialog with one text field. Accepts a full FEN (the first two fields are required; castling, en
passant and the move number are used when present). An illegal or malformed FEN gets a plain message and nothing
changes. A position with the side not to move in check is rejected (my call).

**Flip.** A Flip board button flips the board, coordinates, player bars and eval bar. My call: it works for loaded
games and their replays too, and the choice is remembered like other settings (but not exported: a video keeps White
at the bottom unless the builder finds it trivial to honour).

**Play vs human.** Starts from the starting position, or from the board's set-up position (a pasted FEN, a variant). No eval bar values, arrows, verdicts, engine replies or book hints (my call: the explorer is a hint,
so it is hidden too). The board flips after each move so the side to move is at the bottom. The game ends on
checkmate, stalemate, threefold repetition, the fifty-move rule or insufficient material, with the result shown
(my call: in the Analysis box), and resign (my call). After the game it can be opened from My games and analysed.

**Play vs Stockfish.** Starts from the starting position or the board's set-up position. The player picks White, Black
or random; the board is drawn from the player's side and never flips. Stockfish plays at full strength and replies
after a short pause. Same end conditions as vs human, plus resign (my call). No eval bar, arrows, verdicts or book
hints during the game. Stockfish also analyses each of the player's moves in the background, and when one is an
inaccuracy, mistake or blunder it says so in the Commentary box (my call: the class and a short line, such as
"Mistake: that drops the knight", without revealing the best move or the eval until the game ends).

**Takebacks.** In both game modes, ← takes back a move (against Stockfish, back to the player's previous turn, so
Stockfish's reply goes too). My call: no limit, and nothing recorded about them.

**Clocks (optional).** Off by default. When on: a time control from presets, none under 5 minutes (5+0, 10+0, 15+10, 30+0; the user dropped
1+0 and 3+2) with increment; the running clock is in the player bars (where replayed clocks already show); a flag fall loses,
unless the opponent has no mating material (draw). Against Stockfish only the player's clock matters; Stockfish's
clock runs while it thinks (my call: its think time is capped so it doesn't flag).

**Played games.** Every game (vs human or Stockfish), finished or not, is saved in the browser as it goes, as a PGN
with headers (players "You"/"Stockfish 19" or "White"/"Black", date, result, `[FEN]`/`[SetUp]` for custom starts,
`[Variant]` for variants, `[TimeControl]` when clocked, `%clk` comments). A "My games" list (my call: in the dock menu)
opens one like a loaded game: replay, own-move exploration, Analyse with Stockfish, Queen, Save PGN and video export.
My call: the list keeps the 50 most recent; each can be deleted. A game in progress can be resumed.

**Variants.** The builder supports, from a FEN, the variants whose rules the page and Stockfish 19 can follow:
- standard chess from any legal position (with the castling rights the FEN gives);
- **Chess960** (Fischer random): its castling rules differ, Stockfish has `UCI_Chess960`, and FENs give the rooks'
  files (X-FEN or Shredder-FEN).
The user chose Chess960 only. Other variants (three-check, King of the Hill, crazyhouse, atomic, horde, antichess,
racing kings) are out of scope: they would need a different rules engine and a variant-capable Stockfish.

**Leaving.** Loading a game, New board, or the other buttons end the current mode. A game in progress asks before it is
thrown away (my call).

**Persistence.** The current board (start FEN, moves, mode, flip) survives a reload (my call), like the loaded game
does now.

## Left to the builder

- Architecture. The likely fork: generalise `GameVideo` to a zero-ply game with a start FEN (touches buildGame, ply
  parity, the timeline and the stores), or add a separate free-board view that reuses `BoardTouch`, `EvalBar`-like
  pieces, `useMoveEval`, `OwnMoveAnalysis` and the panel layout without the timeline. My lean: the separate view, so
  the replay can't regress, but the builder decides after reading `GameVideo`.
- How the engine's own game moves share the worker with analysis (priorities, cancelling).
- Visual details: button labels and placement within the dock, the FEN dialog, the result display. Screenshots of
  desktop (1440×900) and phone (390×844) in Chromium and Firefox before committing, as the project does.
- Tests: unit tests for FEN parsing, flipped coordinates, book continuations, draw detection and the engine's FEN
  command; live tests with real mouse input for New board, FEN, a vs-human game's flip, and a vs-Stockfish reply.
- Splitting the work into commits (likely: FEN in the engine and core; flip; free board explore; explorer; vs human;
  vs Stockfish).

## Order of work

These are several projects. Proposed order, each usable on its own:
1. Custom starts underneath: FEN in `buildGame` (Black first, castling from the FEN), the engine's `position fen`, the
   caches, and board flipping.
2. Free board: New board, Paste FEN, explore with Stockfish, the opening explorer.
3. Play vs human: auto-flip, takebacks, end detection, clocks.
4. Played games: saving, the My games list, opening one in the replay.
5. Play vs Stockfish: colour, full-strength replies, background critique.
6. Chess960.

## Decisions log

- 2026-10-19: the user approved this design, the calls marked "my call" included; clock presets under 5 minutes
  removed; Chess960 is the only variant.
