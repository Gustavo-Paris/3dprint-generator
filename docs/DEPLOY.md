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
| `ADMIN_EMAIL` | *(optional)* who may change Settings; defaults to the first `AUTH_ALLOWED_EMAILS` entry |

### AI + Meshy

Either set them as env (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`, and
`MESHY_API_KEY`) **or** leave them empty and configure them after first sign-in via
**⚙ Configurações** (stored encrypted in the DB). The Settings values override env.

### Railway

1. New project → deploy from the GitHub repo (**Settings → Source** connect the
   repo so each push to `main` deploys — CHORE-006). Add a Postgres plugin.
2. Set the env vars above (`DATABASE_URL` is provided by the plugin).
3. **Volume** at `/data` for local meshes/uploads when not using Vercel Blob.
   `railway.json` start command sets:
   `MESH_STORAGE_DIR=/data/meshes` · `UPLOAD_STORAGE_DIR=/data/uploads`
   (files are **not** under `public/` — served only via authenticated routes).
4. Build: `pnpm build` · Start: from `railway.json`.
5. Migrations run automatically: `preDeployCommand: node scripts/migrate.mjs`.

### Optional storage env

| Var | Default | Notes |
|-----|---------|--------|
| `MESH_STORAGE_DIR` | `.data/meshes` | Local mesh files (private) |
| `UPLOAD_STORAGE_DIR` | `.data/uploads` | Local uploads (private) |
| `BLOB_READ_WRITE_TOKEN` | — | If set, assets go to Vercel Blob instead |

### Secrets rotation (CHORE-005)

If keys were ever pasted in chat: rotate `AUTH_RESEND_KEY` (Resend) and
`MESHY_API_KEY` (Meshy), update Railway env + local `.env.local`, redeploy.

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
- [ ] Migrations applied (automatic via `preDeployCommand`; confirm in deploy logs).
- [ ] Sign in works (magic link arrives; your email is in `AUTH_ALLOWED_EMAILS`).
- [ ] **⚙ Configurações** → AI provider configured; a parametric request renders.
- [ ] (Optional) Meshy key set → a freeform request renders.
- [ ] (Optional) `SLICER_URL` reachable → Slice produces a `.3mf`.
- [ ] `E2E_ALLOW_TEST_LOGIN` is **unset** in production.
