import importlib.util
from pathlib import Path
import unittest

script = Path(__file__).resolve().parents[1] / "scripts/update_toto.py"
spec = importlib.util.spec_from_file_location("update_toto", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HistoryMergeTests(unittest.TestCase):
    def test_missing_legacy_rows_and_conflicts_are_retained(self):
        missing = {"draw_number": "1001", "number": "NaN", "date": "NaN"}
        known = {"draw_number": "4230", "number": "['05', '09', '19', '31', '41', '48', '27']", "date": "2026/10/29"}
        conflict = {**known, "number": "['01', '02', '03', '04', '05', '06', '07']"}
        new = {**known, "draw_number": "4231", "date": "2026/11/02"}
        merged, stats = module.merge_history([missing, known], [conflict, new])
        self.assertEqual(merged, [missing, known, new])
        self.assertEqual(stats["conflicts_kept_local"], 1)

    def test_truncated_source_cannot_drop_rows(self):
        row = {"draw_number": "1001", "number": "NaN", "date": "NaN"}
        self.assertEqual(module.merge_history([row], [])[0], [row])

    def test_new_invalid_numbers_are_not_added(self):
        row = {"draw_number": "4231", "number": "[1, 1, 3, 4, 5, 6, 7]", "date": "2026/11/02"}
        self.assertEqual(module.merge_history([], [row])[0], [])

    def test_duplicate_ids_fail_without_discarding_a_row(self):
        text = 'draw_number,number,date\n1,NaN,NaN\n1,NaN,NaN\n'
        with self.assertRaises(ValueError):
            module.read_rows(text)


if __name__ == "__main__":
    unittest.main()
