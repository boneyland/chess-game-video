"""
Expected move ratings for analysis-core.test.cjs, from the current Python code.

Replays each game's recorded --analyze evals through EnhancedGameAnalyzer.analyze_game
with a stand-in engine, so the expected values are what chess_game_analyzer.py computes
today (some stored JSONs predate its current rating rules).

Run from the repo root:  ../chess-animator/.venv/bin/python tests/make_rating_expected.py
"""
import json
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn

ROOT = Path(__file__).resolve().parents[2] / "chess-animator"  # the Python project, checked out next to this repo
sys.path.insert(0, str(ROOT))
from chess_game_analyzer import EnhancedGameAnalyzer  # noqa: E402

GAMES = [
    ("byrne-fischer", "sample_game.pgn", "sample_game_analysis.json"),
    ("carlsen-nepo", "games/Carlsen-Nepomniachtchi_2026.pgn", "games/Carlsen-Nepomniachtchi_2026_analysis.json"),
    ("saif-jurgen", "games/lichess_pgn_2025.11.22_Saif_2004_JOR_vs_JurgenSanchez97.WYU9jakw.pgn",
     "games/lichess_pgn_2025.11.22_Saif_2004_JOR_vs_JurgenSanchez97.WYU9jakw_analysis.json"),
    ("boneyland-futurist", "games/lichess_pgn_2026.09.28_boneyland_vs_Futur_ist.NWhLXQYC.pgn",
     "games/lichess_pgn_2026.09.28_boneyland_vs_Futur_ist.NWhLXQYC_analysis.json"),
    ("soda-neo", "games/soda-vs-neo.pgn", "games/soda-vs-neo_analysis.json"),
]


def pov(cp):
    """A White-POV centipawn value (mates as ±(10000 − 10·N)) as a python-chess PovScore."""
    if abs(cp) >= 9000:
        n = round((10000 - abs(cp)) / 10)
        if n == 0:
            score = chess.engine.MateGiven if cp > 0 else chess.engine.Mate(0)
        else:
            score = chess.engine.Mate(n if cp > 0 else -n)
    else:
        score = chess.engine.Cp(int(round(cp)))
    return chess.engine.PovScore(score, chess.WHITE)


def replay(pgn_path, analysis_path):
    data = json.loads((ROOT / analysis_path).read_text())
    game = chess.pgn.read_game(open(ROOT / pgn_path))
    board = game.board()
    infos = []   # the search of each position: before ply 1, ..., after the last ply
    for m in data["moves"]:
        line = [board.parse_san(s) for s in m["best_line"][:1]] if m["best_line"] else []
        if not line and m["best_move_uci"] not in ("-", ""):
            line = [chess.Move.from_uci(m["best_move_uci"])]
        # the rest of the line, legal moves only, for best_line / mate_line
        b2 = board.copy()
        pv = []
        for s in m["best_line"]:
            try:
                mv = b2.parse_san(s)
            except ValueError:
                break
            pv.append(mv)
            b2.push(mv)
        infos.append({"score": pov(m["eval_before"] if not infos else m["best_eval"]), "pv": pv or line})
        board.push_uci(m["move_uci"])
    last = data["moves"][-1]
    infos.append({"score": pov(last["eval_after"]), "pv": []})
    # eval_before of ply 1 is the first search; every later "before" is the previous "after"
    infos[0]["score"] = pov(data["moves"][0]["best_eval"])

    it = iter(infos)
    an = EnhancedGameAnalyzer.__new__(EnhancedGameAnalyzer)
    an.depth, an.time_limit, an.lines, an.engine, an.engine_version = 20, None, 1, None, "replay"
    an._search = lambda board: [next(it)]
    res = an.analyze_game(str(ROOT / pgn_path))
    moves = [{
        "best_eval": m.best_eval, "current_eval": m.eval_after, "is_white": m.is_white_move,
        "played_is_best": m.move_uci == m.best_move_uci, "is_checkmate": m.move_san.endswith("#"),
        "eval_loss": m.eval_loss, "classification": m.classification, "mate_advice": m.mate_advice,
        "mate_line": m.mate_line, "best_line": m.best_line, "move_san": m.move_san,
    } for m in res.moves]
    return {"moves": moves, "white_accuracy": res.white_stats["accuracy"], "black_accuracy": res.black_stats["accuracy"]}


if __name__ == "__main__":
    out = {name: replay(p, a) for name, p, a in GAMES}
    path = Path(__file__).parent / "fixtures" / "rating-expected.json"
    path.write_text(json.dumps(out, indent=1))
    for name, g in out.items():
        cls = {}
        for m in g["moves"]:
            cls[m["classification"]] = cls.get(m["classification"], 0) + 1
        print(name, len(g["moves"]), "moves", cls, sum(1 for m in g["moves"] if m["mate_advice"]), "mate advice")
