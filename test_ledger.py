import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from ledger import Ledger, Conflict


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "world.sqlite3"
        self.initial = {"location": "tavern", "inventory": []}
        self.ledger = Ledger(self.path, self.initial)

    def test_reopen_restores_committed_state(self):
        state = {"location": "woods", "inventory": ["tarnished coin"]}
        receipt = self.ledger.commit("action-1", 0, {"command": "explore"}, state)
        reopened = Ledger(self.path, {"location": "wrong genesis"})
        self.assertEqual(reopened.latest(), receipt)
        self.assertEqual(reopened.verify()["receipts"], 2)

    def test_lost_response_retry_is_exactly_once(self):
        receipt = self.ledger.commit("action-1", 0, {"command": "woods"}, {"location": "woods"})
        duplicate = self.ledger.commit("action-1", 0, {"command": "woods"}, {"location": "woods"})
        self.assertEqual(receipt, duplicate)
        self.assertEqual(len(self.ledger.history()), 2)
        with self.assertRaises(Conflict):
            self.ledger.commit("action-1", 0, {"command": "rest"}, self.initial)

    def test_two_tabs_cannot_overwrite_each_other(self):
        def save(number):
            try:
                return self.ledger.commit(str(number), 0, {"tab": number}, {"winner": number})
            except Conflict:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, [1, 2]))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(self.ledger.latest()["revision"], 1)
        self.ledger.verify()

    def test_invalid_state_never_mutates_ledger(self):
        for state in [[], {"bad": float('nan')}, {"too_large": "x" * 65536}]:
            with self.assertRaises(ValueError):
                self.ledger.commit("bad", 0, {}, state)
        self.assertEqual(self.ledger.latest()["revision"], 0)

    def test_changed_receipt_is_detected(self):
        self.ledger.commit("one", 0, {}, {"location": "woods"})
        with self.ledger.connect() as db:
            db.execute("UPDATE events SET state_json='{}' WHERE revision=1")
        with self.assertRaises(ValueError):
            self.ledger.verify()


if __name__ == '__main__':
    unittest.main()
