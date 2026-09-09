-- Old offers remain untyped. Never infer an item's mechanics from its name.
ALTER TABLE tavern_offers ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'
  CHECK(kind IN ('food', 'drink', 'other'));
