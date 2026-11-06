-- The Lego sets: what he has (owned), what he'd like (wishlist) and what someone is getting him
-- (claimed). There are no buyer fields on purpose (Alex, 2026-11-06): nobody, not even the admin
-- page, learns who claimed what. Deletes are soft (deleted_at). Safe to paste into the D1 console.

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_num TEXT NOT NULL,              -- Rebrickable's number, lower case, e.g. "75192-1"
  name TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',     -- the top-level theme, e.g. "Star Wars"
  year INTEGER,
  pieces INTEGER,
  image_url TEXT NOT NULL DEFAULT '', -- only ever https://cdn.rebrickable.com/...
  status TEXT NOT NULL CHECK (status IN ('owned', 'wishlist', 'claimed')),
  added_at TEXT NOT NULL,
  claimed_at TEXT,
  received_at TEXT,
  deleted_at TEXT
);

-- One live row per set, so two people can't claim the same set by adding it twice.
CREATE UNIQUE INDEX IF NOT EXISTS sets_live_num ON sets (set_num) WHERE deleted_at IS NULL;
