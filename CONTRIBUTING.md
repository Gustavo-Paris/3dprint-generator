# Contributing

Thanks for your interest in improving Gerador 3D!

## Dev setup

```bash
docker compose up -d postgres
cp .env.example .env.local        # fill in at least DATABASE_URL + AUTH_* + an AI provider
pnpm install
pnpm db:migrate
pnpm dev
```

You can drive the whole flow without paid keys: configure a local model via Ollama
(`AI_BASE_URL=http://localhost:11434/v1`, `AI_MODEL=llama3.1`) in **⚙ Configurações**.
Meshy (freeform) needs a real key, but everything parametric works offline.

## Before opening a PR

Run the gates locally — CI runs the same:

```bash
pnpm lint
npx tsc --noEmit
pnpm test            # unit + integration (needs Postgres up)
pnpm test:e2e        # optional but appreciated for UI/flow changes
```

- Keep user-facing copy in **Portuguese (PT-BR)**; code and comments in English.
- Add/adjust tests for behavior changes. Parametric primitives have unit tests in
  `tests/unit/design-generate.test.ts` and `tests/unit/design-sanitize.test.ts` —
  mirror those when adding a new shape.
- Don't introduce new dynamic code execution. LLM-generated code must only run in
  `src/lib/jscad/sandbox.ts`.
- Never commit real secrets. API keys go in `.env.local` or the Settings page.

## Adding a parametric primitive (example)

A new shape touches a predictable set of files — use the `box` primitive
(`feat(parametric): add box/cube primitive`) as a reference:

1. `src/lib/design/schema.ts` — add the Zod object + the discriminated unions.
2. `src/lib/design/generate.ts` — a `buildX()` builder (+ logo helper if applicable).
3. `src/lib/design/sanitize.ts` — printability clamps.
4. `src/lib/design/parse.ts` — the LLM prompt block + a selection rule + an example.
5. `src/lib/chat/result-label.ts` + `src/components/Chat.tsx` — label + summary.
6. `tests/unit/design-generate.test.ts` + `tests/unit/design-sanitize.test.ts`.

## Commit style

Conventional-ish prefixes (`feat:`, `fix:`, `test:`, `docs:`, `ci:`). Keep PRs
focused; describe what changed and how you verified it.
