import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from game import advance
from ledger import Ledger, Conflict
from server import INITIAL


class ServerWorldTests(unittest.TestCase):
    def test_random_outcome_is_committed_once_even_on_concurrent_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Ledger(Path(directory)/'world.sqlite3', INITIAL)
            def act(_):
                return ledger.apply('one-exploration', 0, {'command':'explore'},
                                    lambda state: advance(state, 'explore'))
            with patch('game.random.random', return_value=.5) as random:
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(act, range(2)))
                self.assertEqual(random.call_count, 1)
            self.assertEqual(results[0], results[1])
            self.assertEqual(results[0]['state']['inventory'], ['tarnished coin'])
            self.assertEqual(ledger.verify()['receipts'], 2)
            with self.assertRaises(Conflict):
                ledger.apply('another-tab', 0, {'command':'rest'}, lambda state: advance(state, 'rest'))

    def test_invalid_command_does_not_append_a_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Ledger(Path(directory)/'world.sqlite3', INITIAL)
            with self.assertRaises(ValueError):
                ledger.apply('bad', 0, {'command':'invent coin'}, lambda state: advance(state, 'invent coin'))
            self.assertEqual(ledger.latest()['revision'], 0)
