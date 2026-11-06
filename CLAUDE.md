# Lego list

Alex's public page for his son's Lego sets at lego.dirtdogcollective.com (part of Dirtdog
Collective; tracked as the "Lego list" project in DogHaus). Family see what he has and the wishlist,
and claim a set so nobody buys it twice. Setup: `2026-11-06-setup-guide.md`.

## Stack

Cloudflare Worker (free plan) + D1 + static assets. Plain JavaScript ES modules, no build step,
**no dependencies**. Same shape as DogHouse and the meal planner.

| Path | What it is |
|---|---|
| `src/2026-11-06-index.js` | entry: routing, security headers (CSP, noindex), same-site JSON check, /admin gate |
| `src/2026-11-06-sets.js` | the sets: public list, claim, bought, and the admin add/update/lookup |
| `src/2026-11-06-rebrickable.js` | set lookup from the `catalog` table, set number rules, image host check |
| `scripts/2026-11-06-catalog.js`, `scripts/2026-11-06-catalog-rules.js` | `npm run catalog`: loads Rebrickable's free catalog downloads into `catalog` (rules are pure, tested) |
| `src/2026-11-06-turnstile.js` | Turnstile check on the two public changes; fails closed |
| `src/2026-11-06-ratelimit.js` | in-memory per-IP limit on claims (10/min), best effort |
| `src/2026-11-06-access.js` | Cloudflare Access token check for /admin (from DogHouse), `ADMIN_EMAILS` |
| `public/2026-11-06-lego.*`, `public/2026-11-06-list.js` | the public page; `list.js` is the pure filtering, tested |
| `public/admin/` | the admin page |
| `migrations/NNNN_name.sql` | D1 schema, applied by `npm run deploy` |
| `test/` | `node --test`, fake D1 on `node:sqlite`, fake network, local preview server |

## Rules

- **No buyer is ever stored or shown** (Alex, 2026-11-06): no name, email or note fields on a claim,
  anywhere, including admin. A test checks the table has no such column.
- **No name for the child** on the page (Alex, 2026-11-06). Keep `noindex` (meta, `X-Robots-Tag`,
  robots.txt).
- Public reads never return dates (`PUBLIC_COLS`).
- Claims are fully open to anyone (Alex's choice), so the locks are Turnstile (fails closed with no
  `TURNSTILE_SECRET`), the rate limit, same-site JSON only (403/415), and admin undo.
- `/admin` and `/admin/api/*` check the Access token in code as well as at the edge; with no
  `ADMIN_EMAILS` or `ACCESS_AUD` they refuse everyone. `workers_dev = false` so there's no second door.
- Build pages with `textContent`, never `innerHTML` with data. Images only from
  `https://cdn.rebrickable.com/` (`safeImage` and the CSP).
- Deletes are soft (`deleted_at`); Removed shows the last 30 days.
- Migrations: new numbered file, never edit an applied one; `IF NOT EXISTS`.
- New files use dated names `YYYY-MM-DD-name.ext` (except files tools need by name).
- Set lookups read the `catalog` table, never Rebrickable's API: its bot protection blocks requests from
  Cloudflare's servers (found 2026-11-06). Refresh with `npm run catalog` (upserts; no deletes).
- Secrets (`ADMIN_EMAILS`, `TURNSTILE_SECRET`) live in Cloudflare, never in the repo.

## Deploying

Cloudflare Workers Builds watches `main` (connected 2026-11-06): every push to `main` runs
`npm run deploy` (migrations, then the Worker), so pushing is deploying. `npm run catalog` still runs
on Alex's computer, because it downloads from Rebrickable.

## Checks before pushing

```
npm test
npm run preview   # look at / and /admin at phone width
```
