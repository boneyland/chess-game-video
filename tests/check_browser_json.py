"""
The video pipeline accepts the browser's analysis JSON. Run after `node --test tests/*.test.cjs`
(which writes tests/out/scholar_analysis.json), from the repo root:
    ../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "chess-animator"  # the Python project, checked out next to this repo
sys.path.insert(0, str(ROOT))
from animator_game import AnalysisData  # noqa: E402

JSON = Path(__file__).parent / "out" / "scholar_analysis.json"


class BrowserJsonTest(unittest.TestCase):
    def test_animator_loads_browser_analysis(self):
        data = AnalysisData.from_json_file(JSON)
        self.assertEqual(len(data.moves), 7)
        summary = data.engine_summary()
        self.assertTrue(summary.startswith("Stockfish 19 lite (browser) · depth 24"), summary)
        self.assertIn("3s per position", summary)
        self.assertEqual(data.moves[-1].move_san, "Qxf7#")


if __name__ == "__main__":
    unittest.main()
