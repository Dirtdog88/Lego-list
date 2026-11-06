# Lego list: one-time setup

Everything here is free (Cloudflare Free plan). Run the commands in a
terminal in this repo's folder. `npx wrangler@4 login` once first if this computer hasn't signed in
to Cloudflare before.

## 1. (Retired) Rebrickable key

Not needed any more: set lookups use a copy of Rebrickable's free catalog (step 8), because
Rebrickable's API blocks requests from Cloudflare's servers.

## 2. The database

```
npx wrangler@4 d1 create lego-list
```

Copy the `database_id` it prints into `wrangler.toml` (replace `PASTE-THE-D1-DATABASE-ID-HERE`) and
commit that change.

## 3. First deploy

`lego.dirtdogcollective.com` must not already have a DNS record (the deploy makes it). Then:

```
npm run deploy
```

This applies the migration and publishes the site at https://lego.dirtdogcollective.com. The
list loads, but claiming is off and /admin says "not signed in" until steps 4 to 6 are done.

## 4. Secrets

```
npx wrangler@4 secret put ADMIN_EMAILS        # your email (comma-separate more than one)
```

## 5. Turnstile (the "are you a person" check on claims)

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name: `Lego list`. Hostname: `lego.dirtdogcollective.com`. Widget mode: **Managed**.
3. Copy the **site key** into `wrangler.toml` as `TURNSTILE_SITE_KEY` (it's public; commit it).
4. Save the **secret key**:
   ```
   npx wrangler@4 secret put TURNSTILE_SECRET
   ```

## 6. Lock /admin with Cloudflare Access

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.
2. Name `Lego list admin`. Domain `lego.dirtdogcollective.com`, path `admin`.
3. Policy: **Allow**, Include → **Emails** → your email (the same as ADMIN_EMAILS).
4. Save, open the application again, and copy its **Application Audience (AUD) Tag** into
   `wrangler.toml` as `ACCESS_AUD`. Commit.

Only `/admin` is locked; the list itself stays public. The worker also checks the Access sign-in
itself, so if this step is skipped or wrong, /admin refuses everyone rather than opening up.

## 7. Deploy again

```
npm run deploy
```

## 8. Load the set catalog

```
npm run catalog
```

This downloads Rebrickable's free catalog files (about 25,000 sets, no key needed) and loads them
into the database, so the admin Add box and "Bought one that isn't here?" can look sets up. Answer
`y` if it asks to proceed. Run it again now and then (before birthdays and Christmas) to pick up
newly released sets; until then a brand-new set can be added by hand with a name.

## 9. Fill it in

1. Open https://lego.dirtdogcollective.com/admin, sign in, and paste his set numbers (Add to: **Has**).
   They go in one by one; any the catalog doesn't know stay in the box with a note.
2. Add wishlist sets the same way (Add to: **Wishlist**).
3. Open the public page on your phone, claim a set to try it, then **Undo claim** in admin.
4. Send family the link: https://lego.dirtdogcollective.com

## After a birthday or Christmas

In /admin, tap **Received** on each claimed set that arrived. A wrong or joke claim: **Undo claim**
(back to the wishlist) or **Remove** (kept 30 days under Removed).
