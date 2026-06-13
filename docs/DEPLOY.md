# Deploy

Gerador 3D is a standard Next.js (App Router) app + Postgres + an optional slicer
microservice. Any Node host works; below are the two common paths.

## 1. Database

Provision a Postgres instance (Railway, Neon, Supabase, RDS, …) and set
`DATABASE_URL`. Apply migrations on deploy:

```bash
pnpm db:migrate
```

## 2. App (Railway or Vercel)

### Required env

| Var | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | `pnpm dlx auth secret`. Also encrypts Settings-stored API keys — keep it stable. |
| `AUTH_URL` | **Required in production** — the canonical origin (e.g. `https://app.example.com`). Pins magic-link callbacks against Host-header injection. |
| `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_ALLOWED_EMAILS` | Magic-link email + sign-in allowlist |

### AI + Meshy

Either set them as env (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`, and
`MESHY_API_KEY`) **or** leave them empty and configure them after first sign-in via
**⚙ Configurações** (stored encrypted in the DB). The Settings values override env.

### Railway

1. New project → deploy from the GitHub repo. Add a Postgres plugin.
2. Set the env vars above (`DATABASE_URL` is provided by the plugin).
3. Build: `pnpm build` · Start: `pnpm start`.
4. Run `pnpm db:migrate` as a one-off (or a release/predeploy step).

### Vercel

1. Import the repo. Add a Postgres integration from the Marketplace; set
   `DATABASE_URL`.
2. Set the env vars above. `pnpm build` is detected automatically.
3. Run migrations from CI or a one-off (`pnpm db:migrate`) against the prod DB.

## 3. Slicer microservice (optional — needed for `Slice → .3mf`)

The slicer wraps OrcaSlicer/PrusaSlicer behind an HTTP endpoint and is deployed
separately (it ships a CLI binary, not suited to serverless). Deploy it as its own
container/service and point `SLICER_URL` at it. Until then, `Download STL/3MF`
still works for use in your own slicer; the in-app **Slice** button reports the
slicer offline.

## Post-deploy checklist

- [ ] `AUTH_URL` set to the real origin (prod refuses to boot without it).
- [ ] Migrations applied (`pnpm db:migrate`).
- [ ] Sign in works (magic link arrives; your email is in `AUTH_ALLOWED_EMAILS`).
- [ ] **⚙ Configurações** → AI provider configured; a parametric request renders.
- [ ] (Optional) Meshy key set → a freeform request renders.
- [ ] (Optional) `SLICER_URL` reachable → Slice produces a `.3mf`.
- [ ] `E2E_ALLOW_TEST_LOGIN` is **unset** in production.
