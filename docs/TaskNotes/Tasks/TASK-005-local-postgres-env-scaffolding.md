---
uid: task-005
status: open
priority: normal
scheduled: 2026-05-15
pomodoros: 0
contexts:
- phase:1
- jscad-mvp
tags:
- task
ai:
  parallelParts: 0
  needsReview: false
  uncertainty: med
  hintsInferred: true
---

# Local Postgres + env scaffolding

**Files:** `docker-compose.yml`, `.env.example`, `src/env.ts`

- [ ] **Step 1: docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16
    container_name: 3dgen-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - 3dgen-pgdata:/var/lib/postgresql/data
volumes:
  3dgen-pgdata:
```

- [ ] **Step 2: .env.example**

```bash
# Database
DATABASE_URL="postgres://app:app@localhost:5432/app"

# NextAuth (Auth.js v5)
AUTH_SECRET=""                # pnpm dlx auth secret to generate
AUTH_RESEND_KEY=""            # from resend.com
AUTH_EMAIL_FROM="auth@yourdomain.com"
AUTH_ALLOWED_EMAILS=""        # comma-separated allowlist

# AI Gateway (preferred) OR direct Anthropic
AI_GATEWAY_API_KEY=""
ANTHROPIC_API_KEY=""

# E2E only
E2E_ALLOW_TEST_LOGIN=""       # set to "1" for Playwright runs
```

- [ ] **Step 3: env loader**

`src/env.ts`:

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_RESEND_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.string().email(),
  AUTH_ALLOWED_EMAILS: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  E2E_ALLOW_TEST_LOGIN: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables')
}

export const env = parsed.data

export const allowedEmails = new Set(
  env.AUTH_ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()),
)
```

- [ ] **Step 4: Bring Postgres up**

```bash
docker compose up -d postgres
docker compose ps
```

Expected: `3dgen-postgres` running.

- [ ] **Step 5: Create your `.env.local`**

```bash
cp .env.example .env.local
# Edit and fill:
#   AUTH_SECRET=$(pnpm dlx auth secret | tail -1)
#   AUTH_RESEND_KEY="re_..."
#   AUTH_EMAIL_FROM="auth@example.com"
#   AUTH_ALLOWED_EMAILS="gustavo.b.paris@gmail.com"
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example src/env.ts
git commit -m "chore: local Postgres + env validation"
```
