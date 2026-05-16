# 3D Print Generator

Chat → 3D model → printer-ready file. Internal tool for the Bambu Lab H2D.

See:
- `docs/superpowers/specs/2026-05-15-3dprint-generator-design.md` — overall design
- `docs/superpowers/plans/2026-05-15-phase-1-single-body-mvp.md` — this phase

## Local dev

```bash
docker compose up -d postgres
cp .env.example .env.local           # fill in secrets — see below
pnpm install
pnpm db:migrate
pnpm dev
```

### Required env vars (`.env.local`)

| Var | How to get it |
|---|---|
| `AUTH_SECRET` | `pnpm dlx auth secret \| tail -1` |
| `AUTH_RESEND_KEY` | https://resend.com → API Keys |
| `AUTH_EMAIL_FROM` | A verified Resend sender address |
| `AUTH_ALLOWED_EMAILS` | Comma-separated allowlist |
| `AI_GATEWAY_API_KEY` *or* `ANTHROPIC_API_KEY` | https://vercel.com/dashboard/ai or https://console.anthropic.com |

## Tests

```bash
pnpm test                                # unit + integration (vitest)
pnpm test:e2e                            # E2E (Playwright) — runs with E2E_ALLOW_TEST_LOGIN
```

The Playwright config already sets `E2E_ALLOW_TEST_LOGIN=1` for the dev server it spawns.

## Phase 1 scope

Single-body 3D generation end-to-end: sign in → chat → Claude returns JSCAD → browser runs it in a Web Worker → react-three-fiber viewer renders the mesh. Iterations persist as DB rows.

Future phases:
- **Phase 2** — multi-body convention + multi-extruder viewer (Bambu H2D dual-tool)
- **Phase 3** — image upload + multimodal Claude prompt
- **Phase 4** — OrcaSlicer service on Railway + `/api/slice` + 3MF download
- **Phase 5** — iteration history UI, version tree, sandbox hardening

## Security

LLM-generated code runs in a sandboxed Web Worker. See `src/lib/jscad/sandbox.ts` for the threat model and hardening backlog. The sandbox file is the **only** place dynamic code compilation occurs — `git grep -nE "FunctionCtor|dynamicEval"` must only return hits inside that file.
