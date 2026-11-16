# GAME BOI — PLAY. COMPETE. WIN.
Multi-game tournament + eFootball account marketplace. Static front end + Supabase (Auth, Postgres, RLS).

## Setup
1. Create a project at supabase.com.
2. SQL Editor: run `supabase_schema.sql`, then `supabase_schema_v2.sql`.
3. Settings > API: copy Project URL and **anon** key into `config.js` (never the service-role key).
4. Auth > URL Configuration: set Site URL to your deployed URL. Enable email confirmation.
5. Storage: create a bucket `listing-images` (images only, size-limited) for screenshots.
6. Make yourself admin (SQL editor only): `insert into user_roles values('<your-user-uuid>','admin');`

## Deploy
Push to GitHub, import the repo in Vercel (or Netlify / GitHub Pages). No build step.

## Auth setup
Supabase > Auth > Providers > Email: enable email + confirm email. For one-time codes, edit the **Magic Link** email template to include `{{ .Token }}`. Add your site URL under Auth > URL Configuration (also add it to Redirect URLs so password reset links work).

## Files
index.html, styles.css, extra.css, auth.css, app.js, backend.js, config.js, manifest.json, sw.js, icons/, supabase_schema.sql, supabase_schema_v2.sql

## Status
Working: auth, tournaments, safe registration, fixtures (knockout with byes, league), score report/confirm/dispute, standings, leaderboard, marketplace (list/create/save/report), admin panel (reports, disputes, suspensions, audit log), legal pages (template text, get legal review).
Not yet built: image upload UI, edit/pause/mark-sold listing UI, tournament edit UI, filters, email notifications, payments (off on purpose: verify a Sierra Leone provider first; no escrow or buyer protection is claimed).

## Payments (Monime, optional)
Run `supabase_schema_v3_payments.sql`. Deploy the three functions in `supabase/functions` (Supabase CLI: `supabase functions deploy create-checkout payment-verify` and `supabase functions deploy payment-webhook --no-verify-jwt`). Set secrets: `supabase secrets set MONIME_SPACE_ID=... MONIME_ACCESS_TOKEN=... SITE_URL=https://your-site WEBHOOK_SECRET=<long random>`. In Monime create a webhook pointing to the payment-webhook function URL with custom header `x-webhook-secret: <same secret>`. Test with a very small amount first. Until the secrets are set, paid tournaments show "Payments are not available".


## Upgrade pack (v15)
- **Listing photos**: up to 3 photos per listing (gallery on the listing page, thumbnail on cards). Run `supabase_schema_v5_images.sql` once in Supabase.
- **Edit listing** (`#/edit/<id>`) and **edit tournament** (`#/edit-t/<id>`, text fields only; dates, fee and player limit stay locked).
- **Smart Register button**: shows "You're registered", "Registration closed" or "Tournament full".
- **Fixes**: `extra.css` did not exist, which stopped the offline cache (service worker) from installing; the contact email must be a real address; a prize pool of 0 now shows "None" instead of "Free"; route errors are logged to the browser console.
- New files: `plus.js`, `plus.css`, `supabase_schema_v5_images.sql`.

## Switching on Monime payments (checklist)
1. In Monime, get your **Space ID** and an **access token**.
2. Run `supabase_schema_v3_payments.sql` and `supabase_schema_v4_payments_view.sql` in Supabase.
3. Deploy the functions: `create-checkout`, `payment-verify`, `payment-webhook` (Supabase CLI: `supabase functions deploy <name>`).
4. Set the secrets (Supabase, Edge Functions, Secrets): Monime access token, Monime Space ID and `SITE_URL` (your site address, no trailing slash). See `supabase/functions/_shared/payments.ts` for the exact names.
5. In Monime, add the webhook URL for `payment-webhook`.
6. **Test with a very small paid tournament first.** Check the amount shown on the Monime page. The code sends the fee multiplied by 100 (minor units); if Monime shows 100 times too much or too little, tell me and it is a one-line fix.

## Features pack (v6)
Run `supabase_schema_v6_features.sql` once in Supabase > SQL Editor. It adds: match chat + dispute reasons, prize payout tracking, seller ratings, player stats, stream links and automatic alerts (new match, status changes, chat).
- Fixtures: Host > Fixtures page > Generate fixtures / Next round. Players get a notification when their match is ready.
- Match chat: `Match chat` button on each fixture (players, host and admins only).
- Player profiles: tap a name on the Leaderboard, or Dashboard > My public profile.
- Prize payouts: host records places 1-3 and marks them paid (tracking only, no money moves).
- Invite friends: Invite page and tournament button create a share card image.
- Phone alerts: browser notifications while the app is open or installed. True background push needs a push server (VAPID keys) and email alerts need an email provider; neither is included.
- Seller ratings: on each listing; 3+ ratings averaging 4 stars shows "Trusted seller".
- Stream link: host adds a https link on the Fixtures page; players see "Watch live".
