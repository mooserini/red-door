-- One short-lived, server-validated offer per caller. No dialogue is stored.
CREATE TABLE tavern_offers (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  id TEXT NOT NULL UNIQUE,
  item TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(typeof(price) = 'integer' AND price BETWEEN 1 AND 20),
  revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX tavern_offers_expiry ON tavern_offers(expires_at);

-- Consuming the offer and saving the debit share the receipt transaction.
-- A concurrent quote replacement, expired offer, or second purchase aborts it.
CREATE TRIGGER purchase_offer_guard BEFORE INSERT ON receipts
WHEN NEW.command LIKE 'buy %' AND NOT EXISTS (
  SELECT 1 FROM tavern_offers WHERE account_id = NEW.account_id
    AND id = substr(NEW.command, 5) AND revision = NEW.expected_revision
    AND expires_at > CAST(strftime('%s', 'now') AS INTEGER)
)
BEGIN
  SELECT RAISE(ABORT, 'offer_conflict');
END;
CREATE TRIGGER purchase_offer_consume AFTER INSERT ON receipts
WHEN NEW.command LIKE 'buy %'
BEGIN
  DELETE FROM tavern_offers WHERE account_id = NEW.account_id AND id = substr(NEW.command, 5);
END;
