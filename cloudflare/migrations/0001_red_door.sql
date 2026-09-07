PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  handle_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE worlds (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  revision INTEGER NOT NULL DEFAULT 0,
  receipt_hash TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE receipts (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  command TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  previous_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, request_id),
  UNIQUE (account_id, revision)
);
-- The insert and checkpoint update are one SQLite transaction. A stale
-- calculation cannot overwrite another caller, including across isolates.
CREATE TRIGGER receipt_revision BEFORE INSERT ON receipts
WHEN NOT EXISTS (
    SELECT 1 FROM worlds WHERE account_id = NEW.account_id
      AND revision = NEW.expected_revision
      AND NEW.revision = revision + 1
      AND receipt_hash = NEW.previous_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'revision_conflict');
END;
CREATE TRIGGER receipt_checkpoint AFTER INSERT ON receipts
BEGIN
  UPDATE worlds SET state_json = NEW.state_json, revision = NEW.revision,
    receipt_hash = NEW.receipt_hash WHERE account_id = NEW.account_id;
END;
CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_limits_expiry ON auth_limits(expires_at);
