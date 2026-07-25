# Deploying OceanMind (Vercel + Supabase)

Everything is already wired for your stack. The Supabase database schema is
**already applied and live** (7 `om_`-prefixed tables with Row-Level Security on,
in project `mfyrwjkhlmcaebsmxtzf`). What remains is putting the code on Vercel and
adding three environment variables — the two secrets can't be committed to git.

## What's in place

- **Postgres data layer** — the app auto-detects `DATABASE_URL`: set → Supabase
  Postgres; unset → local SQLite file (for dev). Same code path, one async API.
- **Serverless packaging** — `vercel.json` builds the client and serves it
  statically, and routes `/api/*` to the Express app running as a serverless
  function (`api/index.js`).
- **Schema** — applied to Supabase already. No migration step needed on deploy.

## Step 1 — Get your Supabase connection string

Supabase dashboard → your project → **Project Settings → Database → Connection
string → "Transaction pooler"** (port **6543** — required for serverless).
It looks like:

```
postgresql://postgres.mfyrwjkhlmcaebsmxtzf:YOUR-DB-PASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres
```

## Step 2 — Deploy the code

**Option A — Vercel CLI (fastest):** from this folder,

```bash
npm i -g vercel
vercel link           # pick your existing "oceanmind" project
vercel --prod
```

**Option B — GitHub:** create a repo, push this folder, and import/select it in
the Vercel "oceanmind" project (Vercel auto-builds on every push). A git repo is
already initialised here with an initial commit — just add your remote:

```bash
git remote add origin https://github.com/<you>/oceanmind.git
git push -u origin main
```

## Step 3 — Add environment variables in Vercel

Vercel → project **oceanmind** → **Settings → Environment Variables** (Production):

| Name | Value |
|------|-------|
| `DATABASE_URL` | the pooler string from Step 1 |
| `DEEPSEEK_API_KEY` | your DeepSeek API key (from platform.deepseek.com) |
| `COOKIE_SECRET` | any long random string (e.g. `openssl rand -hex 32`) |

Optional: `OCEANMIND_AI_MODEL=deepseek-v4-flash` (or `deepseek-v4-pro`).

Then **redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the vars take effect.

## That's it

The app boots, connects to Supabase, and uses DeepSeek for every lesson. Because
the key is set as an env var, the in-app Admin → Model screen is optional — the
model is already connected. Sign-ins, sessions, feedback, projects and
notifications all persist in Supabase.

> Note: your Supabase free-tier project pauses after inactivity. If a deploy or
> request ever times out, open the Supabase dashboard to wake it (or upgrade the
> project so it stays warm).
