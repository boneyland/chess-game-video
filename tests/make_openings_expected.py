"""
Expected opening names for openings-core.test.cjs, from chess_openings.OpeningBook.

Cases: the first game of each local PGN, plus every 10th line of the Lichess TSVs played as a game
(those reach castling, en passant and transpositions). Run from the repo root:
    ../chess-animator/.venv/bin/python tests/make_openings_expected.py
"""
import json
import sys
from pathlib import Path

import chess
import chess.pgn

ROOT = Path(__file__).resolve().parents[2] / "chess-animator"  # the Python project, checked out next to this repo
sys.path.insert(0, str(ROOT))
from chess_openings import OpeningBook  # noqa: E402

book = OpeningBook.load()
op = lambda o: {"eco": o.eco, "name": o.name} if o else None


def case(name, sans):
    board, ucis = chess.Board(), []
    for s in sans:
        mv = board.parse_san(s)
        ucis.append(mv.uci())
        board.push(mv)
    return {"name": name, "sans": sans, "ucis": ucis,
            "byPly": [op(o) for o in book.openings_by_ply(ucis)], "identify": op(book.identify(ucis))}


cases = []
for p in [ROOT / "sample_game.pgn", *sorted((ROOT / "games").glob("*.pgn"))]:
    g = chess.pgn.read_game(open(p))
    cases.append(case(p.name, [n.san() for n in g.mainline()]))
# positions whose placement is in book but whose castling rights or en passant are not
cases.append(case("castling rights lost: e4 e5 Ke2 Ke7 Ke1 Ke8", "e4 e5 Ke2 Ke7 Ke1 Ke8".split()))
cases.append(case("legal en passant: e4 Nf6 e5 d5", "e4 Nf6 e5 d5".split()))
rows = []
for t in sorted((ROOT / "openings").glob("*.tsv")):
    rows += [line.split("\t") for line in t.read_text(encoding="utf-8").splitlines()[1:] if line]
for i in range(0, len(rows), 10):
    eco, name, pgn = rows[i]
    cases.append(case(f"tsv {i}: {eco} {name}", [t for t in pgn.split() if not t[0].isdigit()]))

out = Path(__file__).parent / "fixtures" / "openings-expected.json"
out.write_text(json.dumps(cases))
print(len(cases), "cases;", sum(1 for c in cases if c["identify"]), "named")
