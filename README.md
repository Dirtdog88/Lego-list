# Our Lego list

https://lego.dirtdogcollective.com: a public page where family can see which Lego sets he already
has and what's on his wishlist, and tap **I'm getting this** so nobody buys the same set twice.
Nobody, not even the admin, can see who claimed what.

- **Public page:** Wishlist and Has tabs, search, a theme filter, and "Bought one that isn't here?"
  for a set that isn't on the list. Claims need Cloudflare Turnstile and are rate limited.
- **Admin (`/admin`, behind Cloudflare Access):** add sets by number (details and pictures from
  Rebrickable), bulk paste, Received, Undo claim, Remove and Restore.

Cloudflare Worker + D1 on the free plan. Plain JavaScript, no build step, no dependencies.
Setup: [2026-11-06-setup-guide.md](2026-11-06-setup-guide.md).

```
npm test          # node --test
npm run preview   # http://localhost:8788 and /admin, with sample data and no network
npm run deploy    # migrations + deploy (after the setup guide)
```
