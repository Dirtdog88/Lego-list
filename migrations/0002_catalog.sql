-- A copy of Rebrickable's set catalog (its free download files), loaded by `npm run catalog`.
-- Set lookups read this instead of Rebrickable's API, which blocks requests from Cloudflare's
-- servers (2026-11-06). Public data only; nothing about the family. Safe to paste into the D1 console.

CREATE TABLE IF NOT EXISTS catalog (
  set_num TEXT PRIMARY KEY,           -- lower case, e.g. "75192-1"
  name TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',     -- the top-level theme, e.g. "Star Wars"
  year INTEGER,
  pieces INTEGER,
  image_url TEXT NOT NULL DEFAULT ''  -- https://cdn.rebrickable.com/... or empty
);
