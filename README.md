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
