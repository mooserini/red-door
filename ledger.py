"""A disk-owned, append-only world ledger. No browser storage or third-party deps."""
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Conflict(Exception):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class Ledger:
    def __init__(self, path, initial_state):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                revision INTEGER PRIMARY KEY,
                request_id TEXT NOT NULL UNIQUE,
                request_json TEXT NOT NULL,
                state_json TEXT NOT NULL,
                previous_hash TEXT NOT NULL,
                receipt_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )""")
            if db.execute("SELECT count(*) FROM events").fetchone()[0] == 0:
                state = encode(initial_state)
                digest = self.digest(0, "genesis", "{}", state, "")
                db.execute("INSERT INTO events (revision,request_id,request_json,state_json,previous_hash,receipt_hash) VALUES (0,'genesis','{}',?,'',?)", (state, digest))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(str(self.path), timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def digest(revision, request_id, request, state, previous):
        return hashlib.sha256(encode([revision, request_id, request, state, previous]).encode()).hexdigest()

    @staticmethod
    def unpack(row):
        return {"revision": row["revision"], "request_id": row["request_id"],
                "state": json.loads(row["state_json"]), "receipt_hash": row["receipt_hash"],
                "created_at": row["created_at"]}

    def latest(self):
        with self.connect() as db:
            return self.unpack(db.execute("SELECT * FROM events ORDER BY revision DESC LIMIT 1").fetchone())

    def commit(self, request_id, expected_revision, action, next_state):
        """Local prototype API; return the original receipt on identical retry."""
        if not isinstance(next_state, dict):
            raise ValueError("State must be an object")
        return self._commit(request_id, expected_revision, action,
                            lambda current: next_state, {"state": next_state})

    def apply(self, request_id, expected_revision, action, transition):
        """Calculate server-owned state under the same lock as deduplication."""
        return self._commit(request_id, expected_revision, action, transition, {})

    def _commit(self, request_id, expected_revision, action, transition, extra):
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise ValueError("A request ID of 1 to 128 characters is required")
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError("A nonnegative expected revision is required")
        if not isinstance(action, dict):
            raise ValueError("Action must be an object")
        request = encode({"expected_revision": expected_revision, "action": action, **extra})
        if len(request.encode()) > 65536:
            raise ValueError("Receipt exceeds 64 KiB")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT * FROM events WHERE request_id=?", (request_id,)).fetchone()
            if prior:
                if prior["request_json"] != request:
                    raise Conflict("Request ID was already used for a different action")
                return self.unpack(prior)
            current = db.execute("SELECT * FROM events ORDER BY revision DESC LIMIT 1").fetchone()
            if current["revision"] != expected_revision:
                raise Conflict("The world changed in another session; reload before acting")
            next_state = transition(json.loads(current["state_json"]))
            if not isinstance(next_state, dict):
                raise ValueError("State must be an object")
            state = encode(next_state)
            if len(state.encode()) > 65536:
                raise ValueError("State exceeds 64 KiB")
            revision = current["revision"] + 1
            digest = self.digest(revision, request_id, request, state, current["receipt_hash"])
            db.execute("INSERT INTO events (revision,request_id,request_json,state_json,previous_hash,receipt_hash) VALUES (?,?,?,?,?,?)",
                       (revision, request_id, request, state, current["receipt_hash"], digest))
            receipt = self.unpack(db.execute("SELECT * FROM events WHERE revision=?", (revision,)).fetchone())
        return receipt  # The transaction is committed before acknowledgment.

    def history(self, limit=20):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM events ORDER BY revision DESC LIMIT ?", (limit,)).fetchall()
            return [{**self.unpack(row), "request": json.loads(row["request_json"])} for row in rows]

    def verify(self):
        previous = ""
        with self.connect() as db:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("SQLite integrity check failed")
            rows = db.execute("SELECT * FROM events ORDER BY revision").fetchall()
            for index, row in enumerate(rows):
                digest = self.digest(index, row["request_id"], row["request_json"], row["state_json"], previous)
                if row["revision"] != index or row["previous_hash"] != previous or row["receipt_hash"] != digest:
                    raise ValueError("Receipt chain failed verification")
                previous = digest
        return {"integrity": "ok", "receipts": len(rows), "latest_hash": previous}
